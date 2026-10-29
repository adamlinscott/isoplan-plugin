// Installs the wake hook (src/wake), and takes it out again. The plugin's data layer installs it
// whenever it starts; the install script (main.ts) does the same without a session.
//
// The hook script is copied to <claude dir>/isoplan/wake.mjs, a path that outlives plugin updates
// and their versioned cache folders, and wake.json beside it records where the current data layer
// and the machine's runner (src/runner) are; claude-binary.json records the `claude` binary the
// runner's fork runs. settings.json gets one command hook on UserPromptSubmit and one on Stop.
// They are found again by the wake.mjs path in their command, not by a field of their own, which
// Claude Code's settings check might refuse; so an install updates them in place and never adds a second, and every other
// hook and setting is kept, though the file's formatting comes back normalised (two-space JSON, no
// byte order mark). A settings.json that doesn't parse is left alone. Each file is written whole
// beside its target and moved over it, so neither Claude Code nor a running hook reads half of one.
//
// Uninstalling leaves wake.json as `{ "disabled": true }`, so the plugin's data layer doesn't put
// the hook back when it next starts; only the install script takes that away.

import fs from "node:fs/promises";
import path from "node:path";
import { claudeBinaryPath } from "../runner/claude-binary.js";
import { wakeRecordPath, type WakeRecord } from "../wake/wake.js";

export const WAKE_EVENTS = ["UserPromptSubmit", "Stop"] as const;
// Seconds Claude Code waits for the hook; it is done long before.
const TIMEOUT_SECONDS = 10;

export interface Paths {
  /** Claude Code's config folder, which gets isoplan/wake.mjs and isoplan/wake.json. */
  claudeDir: string;
  /** The settings.json the hooks go in. */
  settings: string;
}

export const wakeScriptPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "wake.mjs");

/**
 * The hook's command. Shell form, quoted, with forward slashes, so Git Bash, PowerShell and sh all
 * read the path the same way.
 */
export const wakeCommand = (script: string) => `node "${script.replace(/\\/g, "/")}"`;

type Json = Record<string, unknown>;

const isWake = (hook: unknown) => typeof (hook as Json | null)?.command === "string" && /isoplan[\\/]+wake\.mjs/.test((hook as Json).command as string);

/**
 * Copies `wakeSource` (dist/wake.js) into place, records `dataLayer`, and adds or updates the hooks.
 * Returns what it changed, [] when it was all there. Throws when settings.json can't be merged.
 * With `auto` (the plugin's data layer) it does nothing once the hook has been uninstalled.
 */
export async function installWake(
  { claudeDir, settings }: Paths,
  dataLayer: string,
  wakeSource: string,
  { auto = false, runner, findClaude }: { auto?: boolean; runner?: string; findClaude?: () => Promise<string | null> } = {},
): Promise<string[]> {
  if (auto && (await isOptedOut(claudeDir))) return [];
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
  const record: WakeRecord = runner ? { dataLayer, runner } : { dataLayer };
  const changes: string[] = [];
  await fs.mkdir(path.dirname(script), { recursive: true });
  if (await writeIfChanged(script, await fs.readFile(wakeSource, "utf8"))) changes.push(`copied the wake hook to ${script}`);
  if (await writeIfChanged(wakeRecordPath(claudeDir), JSON.stringify(record, null, 2) + "\n")) changes.push(`recorded the data layer at ${dataLayer}${runner ? ` and the runner at ${runner}` : ""}`);
  // The runner's fork needs the claude binary; a hook's PATH may not name it, so it is found now.
  const claude = findClaude ? await findClaude() : null;
  if (claude && (await writeIfChanged(claudeBinaryPath(claudeDir), JSON.stringify({ path: claude }, null, 2) + "\n"))) changes.push(`recorded the claude binary at ${claude}`);
  if (done.length) await writeSettings(settings, current);
  return [...changes, ...done];
}

/**
 * Takes out the wake hooks and wake.mjs, and marks wake.json as uninstalled; nothing else. Returns
 * what it changed.
 */
export async function uninstallWake({ claudeDir, settings }: Paths): Promise<string[]> {
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
  const script = wakeScriptPath(claudeDir);
  if (await fs.rm(script).then(() => true, () => false)) changes.push(`removed ${script}`);
  const record: WakeRecord = { disabled: true };
  await fs.mkdir(path.dirname(script), { recursive: true });
  if (await writeIfChanged(wakeRecordPath(claudeDir), JSON.stringify(record, null, 2) + "\n")) {
    changes.push(`marked the wake hook as uninstalled in ${wakeRecordPath(claudeDir)}, so the plugin won't put it back`);
  }
  return changes;
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
