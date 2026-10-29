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
// the wake.mjs path in their command, not by a field of their own, which Claude Code's settings
// check might refuse; so an install updates them in place and never adds a second, and every other
// hook and setting is kept, though the file's formatting comes back normalised (two-space JSON, no
// byte order mark). A settings.json that doesn't parse is left alone. Each file is written whole
// beside its target and moved over it, so neither Claude Code nor a running hook reads half of one.
//
// Uninstalling takes out everything install and the plugin put in place: the hooks, the running
// runner, and the plugin's files under <claude dir>/isoplan. The files a person writes there are
// kept: config.json, runner.json, secret-patterns.json, and a claude-binary.json set by hand. The
// install script's uninstall can leave wake.json as `{ "disabled": true }`, so a plugin that is
// still installed doesn't put the hook back when its data layer next starts; only the install
// script takes that away.
//
// Claude Code runs nothing of a plugin's when it is uninstalled, and leaves the version's folder in
// its cache for days, so the wake hook is what notices (src/wake/main.ts): the data layer wake.json
// records sits in that cache, at cache/<marketplace>/<plugin>/<version>/, and once Claude Code's
// installed_plugins.json no longer lists that plugin, the wake hook uninstalls it all.

import fs from "node:fs/promises";
import path from "node:path";
import { claudeBinaryPath } from "../runner/claude-binary.js";
import { stopRunner, type StartOptions } from "../runner/start.js";
import { wakeRecordPath, type WakeRecord } from "../wake/wake.js";

export const WAKE_EVENTS = ["UserPromptSubmit", "Stop"] as const;
// Seconds Claude Code waits for the hook; it is done long before.
const TIMEOUT_SECONDS = 10;

export interface Paths {
  /** Claude Code's config folder, which gets isoplan/wake.mjs and isoplan/wake.json. */
  claudeDir: string;
  /** The settings.json the hooks go in. */
  settings: string;
  /** Claude Code's plugins folder (`pluginsDir`), for whether the plugin is still installed. */
  plugins: string;
}

/** Claude Code's plugins folder: $CLAUDE_CODE_PLUGIN_CACHE_DIR when it is set, else <claude dir>/plugins. */
export const pluginsDir = (claudeDir: string, env: Record<string, string | undefined>) => env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(claudeDir, "plugins");

/**
 * The id, `<plugin>@<marketplace>`, of the marketplace install `file` is part of, from its place in
 * the plugins folder's cache/<marketplace>/<plugin>/<version>/. Null for a file outside it, such as
 * a checkout's.
 */
export function pluginIdOf(plugins: string, file: string): string | null {
  const relative = path.relative(path.join(plugins, "cache"), path.resolve(file));
  if (path.isAbsolute(relative)) return null; // another drive
  const parts = relative.split(path.sep);
  return parts.length >= 4 && parts[0] !== ".." ? `${parts[1]}@${parts[0]}` : null;
}

/**
 * The plugin ids Claude Code's installed_plugins.json lists, [] when there is no such file. Null
 * when it can't be read or isn't the shape known (`{ plugins: { "<id>": [install, ...] } }`), so
 * no one acts on it.
 */
export async function installedPlugins(plugins: string): Promise<string[] | null> {
  let text: string;
  try {
    text = await fs.readFile(path.join(plugins, "installed_plugins.json"), "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? [] : null;
  }
  try {
    const list = (JSON.parse(text) as { plugins?: unknown }).plugins;
    if (!list || typeof list !== "object" || Array.isArray(list)) return null;
    return Object.entries(list).filter(([, installs]) => Array.isArray(installs) && installs.length > 0).map(([id]) => id);
  } catch {
    return null;
  }
}

/** Whether `dataLayer` is a marketplace install's that Claude Code no longer lists as installed. */
export async function isUninstalled(plugins: string, dataLayer: string): Promise<boolean> {
  const id = pluginIdOf(plugins, dataLayer);
  if (!id) return false;
  const installed = await installedPlugins(plugins);
  return installed !== null && !installed.includes(id);
}

/** Whether the data layer wake.json records belongs to a plugin Claude Code has uninstalled. */
export async function isRecordedUninstalled({ claudeDir, plugins }: Paths): Promise<boolean> {
  try {
    const { dataLayer } = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")) as { dataLayer?: unknown };
    return typeof dataLayer === "string" && (await isUninstalled(plugins, dataLayer));
  } catch {
    return false;
  }
}

export const wakeScriptPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "wake.mjs");

/** Where install copies the runner and the defaults it reads, under the plugin's own layout. */
export const runnerAppDir = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "app");

// The runner's files, by their path in the plugin's folder. runner.js goes last, so a runner
// started on new code finds the new defaults beside it.
export const RUNNER_FILES = ["config.json", "runner.json", "secret-patterns.json", "prompts/instructions.md", "prompts/question.md", "prompts/brief.md", "dist/runner.js"];

/** A file's name in the copy: the bundle is an ES module and no package.json beside the copy says so, so it is .mjs, as wake.mjs is. */
export const copiedAs = (file: string) => file.replace(/\.js$/, ".mjs");

/**
 * The hook's command. Shell form, quoted, with forward slashes, so Git Bash, PowerShell and sh all
 * read the path the same way.
 */
export const wakeCommand = (script: string) => `node "${script.replace(/\\/g, "/")}"`;

type Json = Record<string, unknown>;

const isWake = (hook: unknown) => typeof (hook as Json | null)?.command === "string" && /isoplan[\\/]+wake\.mjs/.test((hook as Json).command as string);

/**
 * Copies `wakeSource` (dist/wake.js) into place, records `dataLayer`, and adds or updates the hooks.
 * With `runnerFrom` (the plugin's folder) it copies the runner too, and records the copy.
 * Returns what it changed, [] when it was all there. Throws when settings.json can't be merged.
 * With `auto` (the plugin's data layer) it does nothing once the hook has been uninstalled, or
 * once Claude Code has uninstalled the plugin `dataLayer` belongs to: a session that loaded it
 * before then still runs it.
 */
export async function installWake(
  { claudeDir, settings, plugins }: Paths,
  dataLayer: string,
  wakeSource: string,
  { auto = false, runnerFrom, findClaude }: { auto?: boolean; runnerFrom?: string; findClaude?: () => Promise<string | null> } = {},
): Promise<string[]> {
  if (auto && ((await isOptedOut(claudeDir)) || (await isUninstalled(plugins, dataLayer)))) return [];
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
  const claude = findClaude && !(await isHandSet(claudeBinaryPath(claudeDir))) ? await findClaude() : null;
  if (claude && (await writeIfChanged(claudeBinaryPath(claudeDir), JSON.stringify({ path: claude, auto: true }, null, 2) + "\n"))) changes.push(`recorded the claude binary at ${claude}`);
  if (done.length) await writeSettings(settings, current);
  return [...changes, ...done];
}

/** What uninstall removes under <claude dir>/isoplan, besides an install's own claude-binary.json. */
export const INSTALLED_FILES = ["wake.mjs", "wake.json", "runner", "live", "logs", "titles"];

export interface UninstallOptions {
  /** Leave wake.json as `{ "disabled": true }`, so a plugin still installed doesn't put the hook back. */
  optOut?: boolean;
  /** How long to wait, once the runner is stopped and the session locks are gone, for what they end to stop writing. */
  settleMs?: number;
  /** For stopping the runner (start.ts). */
  runner?: Omit<StartOptions, "claudeDir" | "spawn">;
}

/**
 * Takes out everything install and the plugin put in place: the wake hooks in settings.json, the
 * running runner, and under <claude dir>/isoplan the wake hook, its record, the runner's copy and
 * its records (environment, ledger, lock), the session locks, the logs and the title files, and
 * claude-binary.json unless it was set by hand. The session locks go before the wait, since a
 * detached data layer stops once its lock isn't its own; the runner's worker stops with its
 * supervisor. What else is in the folder, the files a person writes, is kept, and the folder goes
 * once it is empty. Returns what it changed.
 */
export async function uninstall(paths: Paths, { optOut = false, settleMs = 0, runner = {} }: UninstallOptions = {}): Promise<string[]> {
  const changes = await uninstallHooks(paths);
  const dir = path.dirname(wakeScriptPath(paths.claudeDir));
  const remove = async (file: string) => {
    if (!(await fs.stat(file).then(() => true, () => false))) return;
    // Retried, for a file on Windows that a stopping process or a scanner still has open.
    await fs.rm(file, { recursive: true, force: true, maxRetries: 5 });
    if (!changes.includes(`removed ${file}`)) changes.push(`removed ${file}`);
  };
  if (await stopRunner(paths.claudeDir, runner)) changes.push("stopped the runner, which answered for this machine's rooms");
  await remove(path.join(dir, "live"));
  if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
  const record = wakeRecordPath(paths.claudeDir);
  for (const file of INSTALLED_FILES.map((name) => path.join(dir, name))) if (!(optOut && file === record)) await remove(file);
  const binary = claudeBinaryPath(paths.claudeDir);
  if (!(await isHandSet(binary)) && (await fs.rm(binary).then(() => true, () => false))) changes.push(`removed ${binary}`);
  if (optOut) {
    const disabled: WakeRecord = { disabled: true };
    if (await writeIfChanged(record, JSON.stringify(disabled, null, 2) + "\n")) changes.push(`marked the wake hook as uninstalled in ${record}, so the plugin won't put it back`);
  } else if (await fs.rmdir(dir).then(() => true, () => false)) changes.push(`removed ${dir}`);
  return changes;
}

// Takes the wake hooks out of settings.json, keeping every other hook and setting.
async function uninstallHooks({ settings }: Paths): Promise<string[]> {
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

// Whether the claude-binary.json record names a path someone set by hand: one without `auto`.
async function isHandSet(file: string): Promise<boolean> {
  try {
    const record = JSON.parse(await fs.readFile(file, "utf8")) as { path?: unknown; auto?: unknown };
    return typeof record.path === "string" && record.path !== "" && record.auto !== true;
  } catch {
    return false;
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
