// Connect Claude Code, on this computer's side: what the isoplan:// link handler does with the link
// the floor opened (main.ts). It reads the link strictly (link.ts) and works out what config.json
// becomes, then asks the person, in a dialog, whether this office may have the machine's sessions.
// On Yes it swaps the link's code, with the machine and the Claude account pairing.ts names, for
// the machine's credential (POST <office>/data-layer/connect), keeps it in pairing.json as pairing
// does, and adds the office to config.json's `servers`. The data layers and the runner read their
// offices only as they start, so the ones running are stopped, as scripts/dogfood.ps1 stops them:
// the plugin's starts again at once, a detached one and the runner at the next prompt. On No, or
// anything going wrong, nothing is changed, and the dialog says why.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../data-layer/config.js";
import type { Account } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { httpUrl, keepCredential, machineIdOf, pairingPath, pairingWriteLockPath, postJson, type Post } from "../data-layer/pairing.js";
import { killTree, processCommand, stopOurRunner } from "../install/install.js";
import { alive, readLock } from "../wake/lock.js";
import { parseLink, withOffice } from "./link.js";

export interface ConnectOptions {
  claudeDir: string;
  /** The mod's config.json, which the person's overrides. */
  defaultsPath: string;
  /** The machine's Claude account, as its data layers pair as. */
  account: () => Promise<Account>;
  machine: string;
  ask: (title: string, text: string) => Promise<boolean>;
  tell: (title: string, text: string, problem?: boolean) => Promise<void>;
  /** Stops what reads config.json only as it starts; says what it stopped. */
  restart: () => Promise<string[]>;
  log: (text: string) => void;
  post?: Post;
}

const TITLE = "Connect Claude Code to Isoplan";

/** Handles one link; true once the machine is connected. */
export async function connect(text: string, { claudeDir, defaultsPath, account, machine, ask, tell, restart, log, post = postJson }: ConnectOptions): Promise<boolean> {
  const link = parseLink(text);
  const fail = async (why: string, name?: string) => {
    log(`not connected: ${why}`);
    await tell(TITLE, `Claude Code wasn't connected${name ? ` to ${name}` : ""}: ${why}. Nothing was changed.`, true);
    return false;
  };
  if (typeof link === "string") return fail(link);
  const userPath = path.join(claudeDir, "isoplan", "config.json");
  let user: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(userPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(`${userPath} doesn't hold a JSON object; fix it or add the office by hand`, link.name);
    user = parsed as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return fail(`${userPath} couldn't be read as JSON; fix it or add the office by hand`, link.name);
  }
  const config = await loadConfig(nodeIo(), defaultsPath, userPath);
  const next = withOffice(user, config, link);

  const yes = await ask(
    TITLE,
    `Connect Claude Code on this computer to the Isoplan office "${link.name}" at ${link.host}?\n\n` +
      "Your Claude Code sessions in the repos that office's admins approve will be sent to it, as yours.\n\n" +
      "Only say Yes if you just pressed Connect Claude Code in that office.",
  );
  if (!yes) {
    log(`not connected to ${link.server}: the person said no`);
    return false;
  }

  const file = pairingPath(claudeDir);
  const writeLock = pairingWriteLockPath(claudeDir);
  const who = await account();
  let credential: string;
  try {
    const answer = await post(httpUrl(link.server, "/connect"), { code: link.code, account: who, machine: { name: machine, id: await machineIdOf(file, writeLock) } });
    if (answer.status !== 200 || typeof answer.body.credential !== "string") {
      return fail(answer.body.error ? String(answer.body.error) : `the office answered ${answer.status}`, link.name);
    }
    credential = answer.body.credential;
  } catch (err) {
    return fail(`the office couldn't be reached (${String((err as Error)?.message ?? err)})`, link.name);
  }
  try {
    await keepCredential({ file, writeLock, server: link.server, account: who.id, legacy: link.server === config.server }, credential);
    if (next) await writeJson(userPath, next);
  } catch (err) {
    return fail(`this computer's files couldn't be written (${String((err as Error)?.message ?? err)})`, link.name);
  }
  log(`connected to ${link.server}${next ? ", added to config.json" : ""}`);
  if (next) for (const change of await restart().catch((err: unknown) => [`couldn't stop the running data layers: ${String((err as Error)?.message ?? err)}`])) log(change);
  await tell("Isoplan", `Connected to ${link.name}. Claude Code reports to it from your next prompt.`);
  return true;
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
