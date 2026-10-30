// Keeping the plugin up to date (#96). The plugin pins no version, so Claude Code names each commit
// of the marketplace by its SHA and every commit on main is an update. A session's data layer runs
// this as it starts and every `updateCheckHours`, hidden and in the background:
//
// - it turns on Claude Code's own auto-update for the plugin's marketplace, by setting
//   `"autoUpdate": true` on the marketplace's entry under `extraKnownMarketplaces` in the user's
//   settings.json, a documented setting, which `claude plugin marketplace add` writes. Only an entry
//   that is there, with a source and no `autoUpdate` of its own, is changed: a person who turned it
//   off keeps it off, and no entry or source is ever made up. Claude Code's own records
//   (known_marketplaces.json and the rest) are never written.
// - it runs `claude plugin marketplace update <marketplace>`, then `claude plugin update <id>`,
//   which put a newer version in Claude Code's plugin cache if there is one. A running session keeps
//   the version it loaded until /reload-plugins, which the status line asks for (state.ts,
//   `newestDataLayer`).
//
// One check runs at a time on the machine (update.lock), and update.json records when the last one
// started, so a check at session start is skipped when one ran in the last START_GAP_MS, and the
// timed one runs once per interval whatever number of sessions are open. Nothing runs when
// DISABLE_UPDATES, DISABLE_AUTOUPDATER or CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set, as with
// Claude Code's own plugin auto-update, unless FORCE_AUTOUPDATE_PLUGINS is set too. A data layer
// outside the plugin cache (a checkout, --plugin-dir, a marketplace added from a local folder, which
// loads in place) has nothing to update, and its caller doesn't run this.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { readSettings, writeSettings } from "../install/install.js";
import { alive, releaseLock, takeLock } from "../wake/lock.js";

export const updateRecordPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "update.json");
export const updateLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "update.lock");

/** A check at session start is skipped when one started this recently. */
export const START_GAP_MS = 10 * 60000;
// The most each `claude plugin` command may take; a lock older than both together is stale.
const COMMAND_TIMEOUT_MS = 5 * 60000;

/** The variables that turn updates off, and the one that turns plugin updates back on. */
export const OFF_VARIABLES = ["DISABLE_UPDATES", "DISABLE_AUTOUPDATER", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] as const;
export const FORCE_VARIABLE = "FORCE_AUTOUPDATE_PLUGINS";

const isSet = (value: string | undefined) => !!value && !/^(0|false|no|off)$/i.test(value.trim());

/** The variable that turns updates off here; null when none does, or FORCE_AUTOUPDATE_PLUGINS turns them back on. */
export function updatesOffBy(env: Record<string, string | undefined>): string | null {
  if (isSet(env[FORCE_VARIABLE])) return null;
  return OFF_VARIABLES.find((name) => isSet(env[name])) ?? null;
}

/** What a command run said: its exit code (null when it couldn't run or timed out) and its output. */
export interface Ran {
  code: number | null;
  output: string;
}

export interface UpdateOptions {
  claudeDir: string;
  /** The user's settings.json, which declares the marketplace. */
  settings: string;
  /** The plugin's id, `<plugin>@<marketplace>`. */
  id: string;
  /** The folder the commands run in: the session's project, so `plugin update` finds a project-scope install. */
  cwd: string;
  /** What runs `claude`: the binary, or node and its cli.js (claude-binary.ts). */
  claude: string[];
  /** Skipped when a check started this recently, on any session. */
  gapMs: number;
  run?: (argv: string[], cwd: string) => Promise<Ran>;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
}

/** What a check did, each step as a line for the log; `ran` is false when it was skipped. */
export interface Checked {
  ran: boolean;
  said: string[];
}

/** Turns on Claude Code's auto-update for `marketplace` in `settings` (see above); what it changed, or null. */
export async function turnOnAutoUpdate(settings: string, marketplace: string): Promise<string | null> {
  const current = await readSettings(settings);
  const known = current.extraKnownMarketplaces;
  const entry = isObject(known) ? known[marketplace] : undefined;
  if (!isObject(entry) || !isObject(entry.source) || "autoUpdate" in entry) return null;
  entry.autoUpdate = true;
  await writeSettings(settings, current);
  return `turned on Claude Code's auto-update for the ${marketplace} marketplace in ${settings}`;
}

/** One check (see above), unless another is running or one started within `gapMs`. */
export async function checkForUpdate({ claudeDir, settings, id, cwd, claude, gapMs, run = runHidden, now = Date.now, isAlive = alive }: UpdateOptions): Promise<Checked> {
  const lock = updateLockPath(claudeDir);
  if (!(await takeLock(lock, process.pid, isAlive, false, now(), { freshMs: 2 * COMMAND_TIMEOUT_MS + 60000 }))) return { ran: false, said: [] };
  try {
    const record = updateRecordPath(claudeDir);
    const last = await fs.readFile(record, "utf8").then((text) => (JSON.parse(text) as { checkedAt?: unknown }).checkedAt, () => null);
    if (typeof last === "number" && now() - last < gapMs) return { ran: false, said: [] };
    await fs.writeFile(record, JSON.stringify({ checkedAt: now() }) + "\n");
    const marketplace = id.slice(id.lastIndexOf("@") + 1);
    const said: string[] = [];
    const turnedOn = await turnOnAutoUpdate(settings, marketplace).catch((err: unknown) => `couldn't turn on Claude Code's auto-update for ${marketplace}: ${(err as Error).message}`);
    if (turnedOn) said.push(turnedOn);
    for (const args of [["plugin", "marketplace", "update", marketplace], ["plugin", "update", id]]) {
      const [file, ...rest] = [...claude, ...args];
      const r = await run([file!, ...rest], cwd);
      const tail = lastLine(r.output);
      const failed = r.code === null ? "didn't finish" : r.code !== 0 ? `failed with exit code ${r.code}` : null;
      said.push(`claude ${args.join(" ")}: ${[failed, tail].filter(Boolean).join(": ")}`);
      if (r.code !== 0) break;
    }
    return { ran: true, said };
  } finally {
    await releaseLock(lock, process.pid).catch(() => {});
  }
}

// Runs a command by argv, with no shell and no window, and collects what it printed.
function runHidden(argv: string[], cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(argv[0]!, argv.slice(1), { cwd, windowsHide: true, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code = !err ? 0 : typeof (err as { code?: unknown }).code === "number" && !(err as { killed?: boolean }).killed ? ((err as { code: number }).code) : null;
      resolve({ code, output: `${stdout}\n${stderr}` });
    });
  });
}

// The last line a command printed that says something, without the terminal's colour codes.
const lastLine = (output: string) =>
  output
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1) ?? "";

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
