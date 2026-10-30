// Installs the wake hook (src/wake), and takes it out again. The plugin's data layer installs it
// whenever it starts; the install script (main.ts) does the same without a session.
//
// The hook script is copied to <claude dir>/isoplan/wake.mjs, a path that outlives plugin updates
// and their versioned cache folders, and wake.json beside it records where the current data layer
// and the machine's runner (src/runner) are. The runner is copied too, into
// <claude dir>/isoplan/runner/app, with the defaults it reads beside it, for the same reason: a
// runner left running from a versioned folder would lose its files at the next update. A new copy
// replaces the running runner when it is next started (src/runner/start.ts). claude-binary.json
// records the `claude` binary the runner's fork runs, as `{ path, auto: true }`; one without
// `auto` was set by hand and is kept.
//
// settings.json gets one command hook on UserPromptSubmit and one on Stop. They are found again by
// this config folder's wake.mjs path in their command, not by a field of their own, which Claude
// Code's settings check might refuse; so an install updates them in place and never adds a second,
// and every other hook and setting is kept, another config folder's wake hook too, though the
// file's formatting comes back normalised (two-space JSON, no byte order mark). A settings.json
// that doesn't parse is left alone. Each file is written whole beside its target and moved over
// it, so neither Claude Code nor a running hook reads half of one.
//
// Uninstalling takes out everything install and the plugin put in place: the running runner, the
// plugin's files under <claude dir>/isoplan, and last the hooks, so a stop part way never leaves
// settings.json naming a wake.mjs that has gone. The files a person writes there are kept:
// config.json, runner.json, secret-patterns.json, and a claude-binary.json set by hand. The install
// script's uninstall leaves wake.json as `{ "disabled": true }`, so the plugin, if it is still
// installed, doesn't put the hook back when its data layer next starts; only the install script
// takes that away.
//
// Claude Code runs nothing of a plugin's when it is uninstalled, so the wake hook is what notices
// (src/wake/main.ts, with state.ts) and runs the same uninstall in the background. That one asks
// before each step whether the plugin is still uninstalled, and stops if it was installed again;
// and the hooks stay while a session wrote its files again during the wait, so a later prompt
// tries once more.

import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "../data-layer/config.js";
import { nodeIo } from "../data-layer/io.js";
import { claudeBinaryPath } from "../runner/claude-binary.js";
import { RUNNER_FRESH_MS, runnerLockPath } from "../runner/start.js";
import { alive, holdOff, isHeld, readLock, releaseLock, takeLock } from "../wake/lock.js";
import { wakeRecordPath, type WakeRecord } from "../wake/wake.js";
import { normalPath, pluginState, type Place, type PluginState } from "./state.js";

export const WAKE_EVENTS = ["UserPromptSubmit", "Stop"] as const;
// Seconds Claude Code waits for the hook; it is done long before.
const TIMEOUT_SECONDS = 10;

export interface Paths extends Place {
  /** Claude Code's config folder, which gets isoplan/wake.mjs and isoplan/wake.json. */
  claudeDir: string;
  /** The settings.json the hooks go in. */
  settings: string;
}

export const wakeScriptPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "wake.mjs");

/** Where install copies the runner and the defaults it reads, under the plugin's own layout. */
export const runnerAppDir = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "app");

// The runner's files, by their path in the plugin's folder. runner.js goes last, so a runner
// started on new code finds the new defaults beside it.
export const RUNNER_FILES = ["config.json", "runner.json", "secret-patterns.json", "prompts/instructions.md", "prompts/question.md", "prompts/brief.md", "dist/runner.js"];

/** A file's name in the copy: the bundle is an ES module and no package.json beside the copy says so, so it is .mjs, as wake.mjs is. */
export const copiedAs = (file: string) => file.replace(/\.js$/, ".mjs");

/** The uninstall's lock, which also holds off a retry once one has failed. */
export const uninstallLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "uninstall.json");

/** Where an uninstall in the background says what stopped it. */
export const uninstallLogPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "uninstall.log");

/**
 * The hook's command. Shell form, quoted, with forward slashes, so Git Bash, PowerShell and sh all
 * read the path the same way.
 */
export const wakeCommand = (script: string) => `node "${script.replace(/\\/g, "/")}"`;

type Json = Record<string, unknown>;

/** The script a hook command runs with node, as `node "<script>"` or `node <script>`; null for any other command. */
export function nodeScriptOf(command: string): string | null {
  const m = /^\s*node(?:\.exe)?\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/i.exec(command);
  return m ? (m[1] ?? m[2] ?? m[3])! : null;
}

// Whether a settings hook runs this config folder's wake.mjs, whatever its spelling (quotes,
// slashes, letter case where the file system ignores it); another folder's is left alone.
const isWakeFor = (claudeDir: string) => {
  const script = normalPath(wakeScriptPath(claudeDir));
  return (hook: unknown) => {
    const command = (hook as Json | null)?.command;
    const runs = typeof command === "string" ? nodeScriptOf(command) : null;
    return runs !== null && normalPath(runs) === script;
  };
};

/** The data layer wake.json records; null when there is none. */
export async function recordedDataLayer(claudeDir: string): Promise<string | null> {
  try {
    const { dataLayer } = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")) as { dataLayer?: unknown };
    return typeof dataLayer === "string" ? dataLayer : null;
  } catch {
    return null;
  }
}

/** What Claude Code says of the plugin whose data layer wake.json records (state.ts); enabled when none is recorded. */
export async function recordedState(paths: Paths, cwd?: string): Promise<PluginState> {
  const dataLayer = await recordedDataLayer(paths.claudeDir);
  return dataLayer ? pluginState(paths, dataLayer, cwd) : "enabled";
}

/**
 * Copies `wakeSource` (dist/wake.js) into place, records `dataLayer`, and adds or updates the hooks.
 * With `runnerFrom` (the plugin's folder) it copies the runner too, and records the copy.
 * Returns what it changed, [] when it was all there. Throws when settings.json can't be merged.
 * With `auto` (the plugin's data layer) it does nothing once the hook has been uninstalled, but
 * finish what that uninstall left (a wake.mjs no hook names), or once Claude Code lists the plugin
 * `dataLayer` belongs to as uninstalled: a session that loaded it before then still runs it.
 *
 * A background uninstall that is running is waited for, up to `waitMs`; one still running then
 * leaves the plugin's data layer doing nothing (its next start tries again), and the install
 * script failing. An uninstall that failed, or whose process has gone, leaves its lock and log,
 * which go now, since the plugin is wanted after all.
 */
export async function installWake(
  paths: Paths,
  dataLayer: string,
  wakeSource: string,
  { auto = false, runnerFrom, findClaude, waitMs = INSTALL_WAIT_MS }: { auto?: boolean; runnerFrom?: string; findClaude?: () => Promise<string | null>; waitMs?: number } = {},
): Promise<string[]> {
  const { claudeDir, settings } = paths;
  if (auto && (await isOptedOut(claudeDir))) return finishOptOut(paths);
  if (auto && (await pluginState(paths, dataLayer)) === "uninstalled") return [];
  if (!(await waitForUninstall(claudeDir, waitMs))) {
    if (auto) return [];
    throw new Error(`an uninstall is running (${uninstallLockPath(claudeDir)}); try again once it is done`);
  }
  const isWake = isWakeFor(claudeDir);
  const current = await readSettings(settings);
  const script = wakeScriptPath(claudeDir);
  const hooks = (current.hooks ??= {}) as Json;
  if (typeof hooks !== "object" || Array.isArray(hooks)) throw new Error(`${settings}: "hooks" isn't an object; left it alone`);
  const want = { type: "command", command: wakeCommand(script), timeout: TIMEOUT_SECONDS };
  const done: string[] = [];
  for (const event of WAKE_EVENTS) {
    const groups = (hooks[event] ??= []) as unknown[];
    if (!Array.isArray(groups)) throw new Error(`${settings}: hooks.${event} isn't a list; left it alone`);
    let found = false;
    let changed = false;
    const kept = groups.filter((group) => {
      const list = (group as Json | null)?.hooks;
      if (!Array.isArray(list) || !list.some(isWake)) return true;
      // The first wake hook is brought up to date; any other is a duplicate and goes.
      (group as Json).hooks = list.flatMap((hook) => {
        if (!isWake(hook)) return [hook];
        if (found) {
          changed = true;
          return [];
        }
        found = true;
        if (JSON.stringify(hook) !== JSON.stringify(want)) changed = true;
        return [want];
      });
      return ((group as Json).hooks as unknown[]).length > 0;
    });
    if (!found) kept.push({ hooks: [want] });
    hooks[event] = kept;
    if (!found) done.push(`added the wake hook to ${settings} on ${event}`);
    else if (changed) done.push(`updated the wake hook in ${settings} on ${event}`);
  }

  // The script and its record go first, so the hooks never name a script that isn't there.
  const changes: string[] = [];
  let runner: string | undefined;
  if (runnerFrom) {
    const app = runnerAppDir(claudeDir);
    let copied = false;
    for (const file of RUNNER_FILES) if (await writeIfChanged(path.join(app, copiedAs(file)), await fs.readFile(path.join(runnerFrom, file), "utf8"))) copied = true;
    runner = path.join(app, copiedAs("dist/runner.js"));
    if (copied) changes.push(`copied the runner to ${app}`);
  }
  const record: WakeRecord = runner ? { dataLayer, runner } : { dataLayer };
  await fs.mkdir(path.dirname(script), { recursive: true });
  if (await writeIfChanged(script, await fs.readFile(wakeSource, "utf8"))) changes.push(`copied the wake hook to ${script}`);
  if (await writeIfChanged(wakeRecordPath(claudeDir), JSON.stringify(record, null, 2) + "\n")) changes.push(`recorded the data layer at ${dataLayer}${runner ? ` and the runner at ${runner}` : ""}`);
  // The runner's fork needs the claude binary; a hook's PATH may not name it, so it is found now.
  const binary = claudeBinaryPath(claudeDir);
  const kind = await binaryRecord(binary);
  if (kind === "broken") changes.push(`kept ${binary}, which doesn't parse: it may have been edited by hand`);
  const claude = findClaude && (kind === "none" || kind === "auto") ? await findClaude() : null;
  if (claude && (await writeIfChanged(binary, JSON.stringify({ path: claude, auto: true }, null, 2) + "\n"))) changes.push(`recorded the claude binary at ${claude}`);
  for (const file of [uninstallLogPath(claudeDir), uninstallLockPath(claudeDir)]) {
    if (await fs.rm(file).then(() => true, () => false)) changes.push(`removed ${file}, left by an uninstall that didn't finish`);
  }
  if (done.length) await writeSettings(settings, current);
  return [...changes, ...done];
}

/** How long an install waits for a running background uninstall. */
export const INSTALL_WAIT_MS = 15000;

// True once no background uninstall is running, waiting up to `waitMs`. A failed one's hold-off
// doesn't count: it isn't running.
async function waitForUninstall(claudeDir: string, waitMs: number): Promise<boolean> {
  const file = uninstallLockPath(claudeDir);
  for (const until = Date.now() + waitMs; ; await new Promise((r) => setTimeout(r, 250))) {
    const pid = (await readLock(file))?.pid;
    if (!pid || !alive(pid)) return true;
    if (Date.now() >= until) return false;
  }
}

// After an uninstall that leaves the opt-out, what it left: a wake.mjs no hook names, and its lock and log.
async function finishOptOut({ claudeDir, settings }: Paths): Promise<string[]> {
  const isWake = isWakeFor(claudeDir);
  const hooks = await readSettings(settings).then((current) => current.hooks, () => undefined);
  const named = !!hooks && typeof hooks === "object" && Object.values(hooks as Json).some((groups) => Array.isArray(groups) && groups.some((g) => Array.isArray((g as Json | null)?.hooks) && ((g as Json).hooks as unknown[]).some(isWake)));
  const changes: string[] = [];
  if (named || !(await waitForUninstall(claudeDir, 0))) return changes;
  for (const file of [wakeScriptPath(claudeDir), uninstallLogPath(claudeDir), uninstallLockPath(claudeDir)]) {
    if (await fs.rm(file).then(() => true, () => false)) changes.push(`removed ${file}, left by an uninstall`);
  }
  return changes;
}

// The runner's state, the machine's pairing credential (pairing.json) and its locks (pairing.lock
// while a pairing is under way, pairing.write.lock while the file is written), and the sessions'
// traces: locks, logs, title files, released-report hashes and the projects each office holds.
// Removed before the hooks.
const WRITTEN = ["runner", "pairing.json", "pairing.lock", "pairing.write.lock", "live", "logs", "titles", "released", "office-projects.json"];
// What a session's data layer writes as it runs, so may come back during an uninstall.
const SESSION_TRACES = ["live", "titles", "released", "office-projects.json"];

export interface UninstallOptions {
  /** Leave wake.json as `{ "disabled": true }`, so a plugin still installed doesn't put the hook back. */
  optOut?: boolean;
  /** How long to wait, once the runner is stopped and the session locks are gone, for what they end to stop writing (`settleMs`). */
  settleMs?: number;
  /**
   * Asked before each step that removes something: false (the plugin is installed again) stops
   * there. Given, the hooks also stay while a session wrote its files again during the wait.
   */
  confirm?: () => Promise<boolean>;
  runner?: StopOptions;
}

/** What uninstall changed, and whether it got to the end; one that stopped says why last. */
export interface Uninstalled {
  changes: string[];
  isDone: boolean;
}

/**
 * Takes out everything install and the plugin put in place, in this order: the running runner;
 * under <claude dir>/isoplan the session locks (a detached data layer stops once its lock isn't
 * its own); a wait of `settleMs`; the runner's copy and its records (environment, ledger, lock),
 * the pairing credential, the logs, the title files and the released-report hashes, and
 * claude-binary.json unless it was set by hand; then the wake
 * hooks in settings.json, and wake.mjs and wake.json. What else is in the folder, the files a
 * person writes, is kept, and the folder goes once it is empty. Throws when settings.json can't be
 * merged, with the hooks and wake.mjs still in place and settings.json not written.
 */
export async function uninstall(paths: Paths, { optOut = false, settleMs = 0, confirm, runner = {} }: UninstallOptions = {}): Promise<Uninstalled> {
  const changes: string[] = [];
  const dir = path.dirname(wakeScriptPath(paths.claudeDir));
  const remove = async (file: string) => {
    if (!(await exists(file))) return;
    // Retried, for a file on Windows that a stopping process or a scanner still has open.
    await fs.rm(file, { recursive: true, force: true, maxRetries: 5 });
    if (!changes.includes(`removed ${file}`)) changes.push(`removed ${file}`);
  };
  const isStillGone = async () => !confirm || (await confirm());
  const stopped = (why: string): Uninstalled => ({ changes: [...changes, why], isDone: false });
  const reinstalled = "stopped: Claude Code lists the plugin as installed again";

  if (!(await isStillGone())) return stopped(reinstalled);
  if (await stopOurRunner(paths.claudeDir, runner)) changes.push("stopped the runner, which answered for this machine's rooms");
  await remove(path.join(dir, "live"));
  if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
  for (const name of WRITTEN) {
    if (!(await isStillGone())) return stopped(reinstalled);
    await remove(path.join(dir, name));
  }
  const binary = claudeBinaryPath(paths.claudeDir);
  const kind = await binaryRecord(binary);
  if (kind === "auto") await remove(binary);
  if (kind === "broken") changes.push(`kept ${binary}, which doesn't parse: it may have been edited by hand`);
  if (confirm && (await Promise.all(SESSION_TRACES.map((name) => exists(path.join(dir, name))))).includes(true)) {
    return stopped("stopped: a session still running the plugin wrote its files again; the hook stays, to try again on a later prompt");
  }
  if (!(await isStillGone())) return stopped(reinstalled);
  // The opt-out goes in first, so a stop after the hooks have gone still keeps the plugin from
  // putting them back; its data layer then finishes what is left (installWake).
  const record = wakeRecordPath(paths.claudeDir);
  if (optOut) {
    const disabled: WakeRecord = { disabled: true };
    if (await writeIfChanged(record, JSON.stringify(disabled, null, 2) + "\n")) changes.push(`marked the wake hook as uninstalled in ${record}, so the plugin won't put it back`);
  }
  changes.push(...(await uninstallHooks(paths)));
  await remove(wakeScriptPath(paths.claudeDir));
  if (!optOut) await remove(record);
  await remove(uninstallLogPath(paths.claudeDir));
  await remove(uninstallLockPath(paths.claudeDir));
  if (await fs.rmdir(dir).then(() => true, () => false)) changes.push(`removed ${dir}`);
  return { changes, isDone: true };
}

/** How long a background uninstall that failed holds off trying again. */
export const UNINSTALL_RETRY_MS = 24 * 3600000;

/**
 * One background uninstall, for the wake hook once Claude Code lists the plugin as uninstalled:
 * `uninstall`, asking before each step whether it still does. It holds the uninstall's lock
 * throughout, so two never run at once. One that fails (a settings.json that doesn't parse, say)
 * says why in uninstall.log and holds off for UNINSTALL_RETRY_MS, keeping the hooks and wake.mjs;
 * deleting uninstall.json lets the next prompt try at once. One that stops because a session wrote
 * its files again says so there too, and the next prompt tries again; one that stops because the
 * plugin was installed again just ends.
 */
export async function uninstallInBackground(paths: Paths, { settleMs = 0, runner = {}, now = Date.now }: Pick<UninstallOptions, "settleMs" | "runner"> & { now?: () => number } = {}): Promise<void> {
  const lock = uninstallLockPath(paths.claudeDir);
  if (!(await takeLock(lock, process.pid, alive, false, now()))) return;
  const log = (text: string) => fs.appendFile(uninstallLogPath(paths.claudeDir), `${new Date(now()).toISOString()} ${text}\n`).catch(() => {});
  try {
    const { changes, isDone } = await uninstall(paths, { settleMs, runner, confirm: async () => (await recordedState(paths)) === "uninstalled" });
    if (isDone) return;
    const why = changes[changes.length - 1]!;
    if (!why.includes("installed again")) await log(why);
    await releaseLock(lock, process.pid);
  } catch (err) {
    await log(`couldn't finish uninstalling Isoplan's plugin: ${(err as Error).message}. Trying again in a day, or delete ${lock} to try on the next prompt.`);
    await holdOff(lock, process.pid, now() + UNINSTALL_RETRY_MS);
  }
}

/** Whether a background uninstall is running, or holding off after one failed. */
export const isUninstalling = (claudeDir: string) => isHeld(uninstallLockPath(claudeDir));

/**
 * How long uninstall waits for a detached data layer to see its lock has gone: two of its passes
 * (`streamSeconds`, with `defaultsPath` the mod's config.json and the person's config.json over
 * it) and a second. Ten seconds when the config can't be read.
 */
export async function settleMs(claudeDir: string, defaultsPath: string): Promise<number> {
  const config = await loadConfig(nodeIo(), defaultsPath, path.join(claudeDir, "isoplan", "config.json")).catch(() => null);
  return config ? (2 * config.streamSeconds + 1) * 1000 : 10000;
}

export interface StopOptions {
  isAlive?: (pid: number) => boolean;
  kill?: (pid: number) => void;
  now?: () => number;
  /** A process's command line (`processCommand`); without it, a runner whose lock is stale is left alone. */
  commandOf?: (pid: number) => Promise<string | null>;
  /** How long to wait for it to exit. */
  waitMs?: number;
}

/**
 * Ends the runner its lock names, and waits up to `waitMs` for it to exit; its worker and forks
 * follow its supervisor. One whose lock is stale (not kept fresh, after a sleep, say) is ended only
 * when its pid is alive and its command line runs this folder's copy of the runner, since after a
 * reboot the pid may name another process. True when one was ended.
 */
export async function stopOurRunner(claudeDir: string, { isAlive = alive, kill = killTree, now = Date.now, commandOf, waitMs = 0 }: StopOptions = {}): Promise<boolean> {
  const file = runnerLockPath(claudeDir);
  const lock = await readLock(file);
  const pid = lock?.pid;
  if (!lock || !pid || !isAlive(pid)) return false;
  if (now() - lock.mtimeMs >= RUNNER_FRESH_MS) {
    const command = commandOf ? await commandOf(pid) : null;
    const runner = normalPath(path.join(runnerAppDir(claudeDir), copiedAs("dist/runner.js")));
    if (!command || !command.replace(/\\/g, "/").toLowerCase().includes(runner.toLowerCase())) return false;
  }
  try {
    kill(pid);
  } catch {
    // Gone already.
  }
  for (const until = now() + waitMs; isAlive(pid) && now() < until; ) await new Promise((r) => setTimeout(r, 100));
  await releaseLock(file, pid);
  return true;
}

/**
 * Ends `pid` and what it started. On Windows a child outlives its parent, so the whole tree goes
 * at once (taskkill /T, hidden), and no fork keeps the runner's files open; elsewhere the
 * supervisor's worker follows it, as its stdin closes, and ends its forks.
 */
export function killTree(pid: number): void {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else process.kill(pid);
}

/** The command line of process `pid`; null when it can't be read. */
export async function processCommand(pid: number, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  try {
    if (platform === "linux") return (await fs.readFile(`/proc/${pid}/cmdline`, "utf8")).replace(/\0/g, " ").trim() || null;
    const [file, args] =
      platform === "win32"
        ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]]
        : ["ps", ["-o", "command=", "-p", String(pid)]];
    const { stdout } = await promisify(execFile)(file, args, { windowsHide: true, timeout: 15000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// Takes this config folder's wake hooks out of settings.json, keeping every other hook and setting.
async function uninstallHooks({ claudeDir, settings }: Paths): Promise<string[]> {
  const isWake = isWakeFor(claudeDir);
  const current = await readSettings(settings);
  const changes: string[] = [];
  const hooks = current.hooks as Json | undefined;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      let removed = false;
      const kept = groups.filter((group) => {
        const list = (group as Json | null)?.hooks;
        if (!Array.isArray(list) || !list.some(isWake)) return true;
        removed = true;
        (group as Json).hooks = list.filter((hook) => !isWake(hook));
        return ((group as Json).hooks as unknown[]).length > 0;
      });
      if (!removed) continue;
      changes.push(`removed the wake hook from ${settings} on ${event}`);
      if (kept.length) hooks[event] = kept;
      else delete hooks[event];
    }
    if (changes.length && !Object.keys(hooks).length) delete current.hooks;
  }
  if (changes.length) await writeSettings(settings, current);
  return changes;
}

const exists = (file: string) => fs.stat(file).then(() => true, () => false);

// What claude-binary.json is: missing, an install's own (`auto`), set by hand, or one that
// doesn't parse, which may be a hand edit gone wrong and is left alone.
async function binaryRecord(file: string): Promise<"none" | "auto" | "hand" | "broken"> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return "none";
  }
  try {
    const record = JSON.parse(text) as { path?: unknown; auto?: unknown } | null;
    if (record?.auto === true) return "auto";
    return typeof record?.path === "string" && record.path !== "" ? "hand" : "broken";
  } catch {
    return "broken";
  }
}

// Whether wake.json says the hook was uninstalled.
async function isOptedOut(claudeDir: string): Promise<boolean> {
  try {
    return (JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")) as Partial<{ disabled: unknown }>).disabled === true;
  } catch {
    return false;
  }
}

// The settings as an object; {} when there is no file yet. A leading byte order mark is skipped.
async function readSettings(file: string): Promise<Json> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error(`${file} isn't valid JSON; left it alone`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} isn't a JSON object; left it alone`);
  return value as Json;
}

const writeSettings = (file: string, settings: Json) => writeWhole(file, JSON.stringify(settings, null, 2) + "\n");

async function writeIfChanged(file: string, text: string): Promise<boolean> {
  if ((await fs.readFile(file, "utf8").catch(() => null)) === text) return false;
  await writeWhole(file, text);
  return true;
}

// Writes `text` to a file beside the target, then moves it over the target, so a reader never sees
// half of it. A symlink is followed, so the link stays and the file it points at is replaced; the
// file's mode is kept.
async function writeWhole(file: string, text: string): Promise<void> {
  const target = await fs.realpath(file).catch(() => file);
  const mode = (await fs.stat(target).catch(() => null))?.mode;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.isoplan-${process.pid}`;
  try {
    await fs.writeFile(temp, text);
    if (mode !== undefined) await fs.chmod(temp, mode & 0o7777);
    await fs.rename(temp, target);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}
