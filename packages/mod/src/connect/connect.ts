// Connect Claude Code, on this computer's side: what the isoplan:// link handler does with the link
// the floor opened (main.ts). One link at a time on the machine (connect.lock): another that comes
// while a dialog is open is refused, so a page can't stack them. It reads the link strictly
// (link.ts), then asks the office whose code it is (POST <office>/data-layer/connect/peek, which
// doesn't use it up), since a link can come from someone else: the dialog names the office's host
// first, the person this machine will report as, what the office calls itself, and whether this
// replaces the machine's pairing with it. On Connect it swaps the code, with the machine and the
// Claude account pairing.ts names, for the machine's credential (POST <office>/data-layer/connect),
// keeps it in pairing.json as pairing does, and adds the office to config.json's `servers`, read
// again and written under config.write.lock so a change made meanwhile isn't lost. The data layers
// and the runner read their offices and credentials as they start, so the ones running are
// stopped, as scripts/dogfood.ps1 stops them: the plugin's starts again at once, a detached one and
// the runner at the next prompt. Cancel, or anything going wrong before the swap, changes nothing,
// and the dialog says why; after the swap it says exactly what was done and what wasn't.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../data-layer/config.js";
import type { Account } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { httpUrl, keepCredential, machineIdOf, pairingEntry, pairingPath, pairingWriteLockPath, postJson, readPairing, type Post } from "../data-layer/pairing.js";
import { killTree, processCommand, stopOurRunner } from "../install/install.js";
import { alive, readLock, releaseLock, takeLock } from "../wake/lock.js";
import { labelOf, parseLink, shown, withOffice } from "./link.js";

export interface ConnectOptions {
  claudeDir: string;
  /** The mod's config.json, which the person's overrides. */
  defaultsPath: string;
  /** The machine's Claude account, as its data layers pair as. */
  account: () => Promise<Account>;
  machine: string;
  /** Connect or Cancel; throws when it couldn't be shown. */
  ask: (title: string, text: string) => Promise<boolean>;
  tell: (title: string, text: string, problem?: boolean) => Promise<void>;
  /** Stops what reads config.json and pairing.json only as it starts; says what it stopped. */
  restart: () => Promise<string[]>;
  log: (text: string) => void;
  post?: Post;
}

const TITLE = "Connect Claude Code to Isoplan";
/** How much of an office's own message is shown. */
const MAX_SAID = 200;
/** config.write.lock: free once this old, and waited for at most this long. */
const CONFIG_LOCK_MS = 10 * 1000;

export const connectLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "connect.lock");
const configLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "config.write.lock");

/** An office's refusal, as the person sees it: its own words, cut short and labelled as its. */
const refusal = (answer: { status: number; body: Record<string, unknown> }) =>
  typeof answer.body.error === "string" && answer.body.error ? `the office said: "${shown(answer.body.error, MAX_SAID) ?? ""}"` : `the office answered ${answer.status}`;

/** Handles one link; true once the machine is connected. */
export async function connect(text: string, o: ConnectOptions): Promise<boolean> {
  const lock = connectLockPath(o.claudeDir);
  if (!(await takeLock(lock, process.pid, alive, false))) {
    o.log("refused a connect link: another is being handled on this machine");
    return false;
  }
  try {
    return await connectOne(text, o);
  } finally {
    await releaseLock(lock, process.pid).catch(() => {});
  }
}

async function connectOne(text: string, { claudeDir, defaultsPath, account, machine, ask, tell, restart, log, post = postJson }: ConnectOptions): Promise<boolean> {
  const link = parseLink(text);
  // Before the swap, nothing here has changed anything.
  const fail = async (why: string, host?: string) => {
    log(`not connected: ${why}`);
    await tell(TITLE, `Claude Code wasn't connected${host ? ` to ${host}` : ""}: ${why}. Nothing was changed.`, true);
    return false;
  };
  if (typeof link === "string") return fail(link);
  const userPath = path.join(claudeDir, "isoplan", "config.json");
  const unreadable = await readUser(userPath).then(() => null, (why: string) => why);
  if (unreadable) return fail(unreadable, link.host);

  let whose: { person: string; email: string; office: string };
  try {
    const answer = await post(httpUrl(link.server, "/connect/peek"), { code: link.code });
    const body = answer.body as { person?: { name?: unknown; email?: unknown }; office?: unknown };
    const person = typeof body.person?.name === "string" ? shown(body.person.name) : null;
    const email = typeof body.person?.email === "string" ? shown(body.person.email, MAX_SAID) : null;
    if (answer.status !== 200 || !person || !email) return fail(answer.status === 200 ? "the office didn't say whose link this is" : refusal(answer), link.host);
    whose = { person, email, office: (typeof body.office === "string" && shown(body.office)) || link.name };
  } catch (err) {
    return fail(`the office couldn't be reached (${String((err as Error)?.message ?? err)})`, link.host);
  }

  const who = await account();
  const file = pairingPath(claudeDir);
  const writeLock = pairingWriteLockPath(claudeDir);
  const replaces = !!pairingEntry(await readPairing(file), link.server, who.id)?.credential;
  let yes: boolean;
  try {
    yes = await ask(TITLE, dialogText(link.host, whose, replaces));
  } catch (err) {
    return fail(`the confirmation couldn't be shown (${String((err as Error)?.message ?? err)})`, link.host);
  }
  if (!yes) {
    log(`not connected to ${link.server}: cancelled`);
    return false;
  }

  let credential: string;
  try {
    const answer = await post(httpUrl(link.server, "/connect"), { code: link.code, account: who, machine: { name: machine, id: await machineIdOf(file, writeLock) } });
    if (answer.status !== 200 || typeof answer.body.credential !== "string") return fail(refusal(answer), link.host);
    credential = answer.body.credential;
  } catch (err) {
    return fail(`the office couldn't be reached (${String((err as Error)?.message ?? err)})`, link.host);
  }

  // The office has paired the machine now: from here on, say what was done.
  const config = await loadConfig(nodeIo(), defaultsPath, userPath);
  try {
    await keepCredential({ file, writeLock, server: link.server, account: who.id, legacy: link.server === config.server }, credential);
  } catch (err) {
    const why = String((err as Error)?.message ?? err);
    log(`paired by ${link.server}, but its credential couldn't be saved: ${why}`);
    await tell(TITLE, `${link.host} paired this computer, but its credential couldn't be saved here (${why}), so Claude Code can't report to it. Press Connect Claude Code on the floor again.`, true);
    return false;
  }
  let added: boolean;
  try {
    added = await addOffice(claudeDir, defaultsPath, link);
  } catch (err) {
    const why = String((err as Error)?.message ?? err);
    const line = JSON.stringify({ label: labelOf(link.name) || link.host, server: link.server });
    log(`paired with ${link.server}, but couldn't add it to config.json: ${why}`);
    await tell(TITLE, `This computer is paired with ${link.host}, but the office couldn't be added to ${userPath} (${why}). Add this entry to "servers" there, keeping any already there, then start a new session:\n\n${line}`, true);
    return false;
  }
  log(`connected to ${link.server} as ${whose.email}${added ? ", added to config.json" : ""}`);
  for (const change of await restart().catch((err: unknown) => [`couldn't stop the running data layers: ${String((err as Error)?.message ?? err)}`])) log(change);
  await tell("Isoplan", `Connected to ${link.host} as ${whose.person}. Claude Code reports to it from your next prompt.`);
  return true;
}

/** What the person is asked: the host first, then who this machine reports as, then what the office calls itself. */
export function dialogText(host: string, whose: { person: string; email: string; office: string }, replaces: boolean): string {
  return [
    `Connect to ${host}?`,
    "",
    `This computer's Claude Code sessions, in the repos that office's admins approve, will be reported to ${host} as ${whose.person} (${whose.email}).`,
    `The office calls itself "${whose.office}".`,
    ...(replaces ? ["", `This replaces this computer's current pairing with ${host}.`] : []),
    "",
    `Only connect if you just pressed Connect Claude Code there, signed in as ${whose.person}.`,
  ].join("\n");
}

/** The person's config.json, or {} when there is none; rejects with why when it isn't a JSON object. */
async function readUser(userPath: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await fs.readFile(userPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw `${userPath} couldn't be read`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw `${userPath} isn't valid JSON; fix it or add the office by hand`;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw `${userPath} doesn't hold a JSON object; fix it or add the office by hand`;
  return parsed as Record<string, unknown>;
}

/** Adds the office to config.json, read again under config.write.lock; false when the plugin already reports to it. */
async function addOffice(claudeDir: string, defaultsPath: string, link: Parameters<typeof withOffice>[2]): Promise<boolean> {
  const lock = configLockPath(claudeDir);
  const until = Date.now() + CONFIG_LOCK_MS;
  while (!(await takeLock(lock, process.pid, alive, false, Date.now(), { freshMs: CONFIG_LOCK_MS }))) {
    if (Date.now() > until) throw new Error(`couldn't take ${lock}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  try {
    const userPath = path.join(claudeDir, "isoplan", "config.json");
    const user = await readUser(userPath).catch((why: string) => Promise.reject(new Error(why)));
    const next = withOffice(user, await loadConfig(nodeIo(), defaultsPath, userPath), link);
    if (next) await writeJson(userPath, next);
    return !!next;
  } finally {
    await releaseLock(lock, process.pid).catch(() => {});
  }
}

/** Written whole, through a temp file, so a data layer never reads half of it. */
async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  try {
    await fs.rename(temp, file);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

export interface StopReporting {
  isAlive?: (pid: number) => boolean;
  commandOf?: (pid: number) => Promise<string | null>;
  kill?: (pid: number) => void;
}

/**
 * Stops the data layers the session locks name (<claude dir>/isoplan/live/), each only while its
 * command line still runs a data layer, since a pid may have been reused, and the runner.
 */
export async function stopReporting(claudeDir: string, { isAlive = alive, commandOf = processCommand, kill = killTree }: StopReporting = {}): Promise<string[]> {
  const dir = path.join(claudeDir, "isoplan", "live");
  const stopped: string[] = [];
  for (const name of (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json"))) {
    const lock = await readLock(path.join(dir, name));
    const pid = lock?.pid;
    if (!pid || typeof lock.extra.dataLayer !== "string" || !isAlive(pid) || !(await commandOf(pid))?.includes("data-layer")) continue;
    try {
      kill(pid);
      stopped.push(`stopped the data layer of session ${name.slice(0, -".json".length)}, to start again with the new office`);
    } catch {
      // Gone already.
    }
  }
  if (await stopOurRunner(claudeDir, { isAlive, commandOf, kill })) stopped.push("stopped the runner, to start again with the new office");
  return stopped;
}
