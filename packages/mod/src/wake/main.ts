// The wake hook: a Claude Code command hook on UserPromptSubmit and Stop, once per turn, from the
// user's settings.json (src/install). It starts a detached data layer for a session that has no
// data layer reporting it, so every session is seen without the plugin loaded in it, and starts
// the machine's runner (src/runner) when none is running.
//
//   node <claude dir>/isoplan/wake.mjs     (the hook's JSON on stdin)
//
// It must never get in a session's way: it writes nothing to stdout (UserPromptSubmit would add it
// to the model's context), every error it can catch exits 0, and it is done well inside a second.
// What happens before this script runs can't be caught here: a `node` missing from PATH fails the
// hook with Claude Code's own non-blocking error. A half-written wake.mjs can't happen, since
// install moves a whole new copy over the old one.
//
// It runs as a copy at <claude dir>/isoplan/wake.mjs, so its own folder's parent is the config
// folder, whichever one Claude Code was started with.
//
// It is also how Claude Code's uninstall and disable reach the plugin, since Claude Code runs
// nothing of a plugin's then; state.ts reads what Claude Code records, for the plugin whose data
// layer wake.json records:
//
// - Uninstalled (`/plugin uninstall`, the plugin manager, `claude plugin uninstall`): it starts no
//   data layer and no runner, and starts itself in the background to uninstall it all (src/install),
//   so the session isn't kept waiting while it does; unless one is running or holding off.
// - Disabled for the machine: it stops the runner, starts nothing, and every file stays. Disabled
//   for this session's project only: it starts nothing for this session. Enabled again, the next
//   prompt starts them again.
//
//   node <claude dir>/isoplan/wake.mjs --uninstall

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isUninstalling, processCommand, recordedState, runnerAppDir, settleMs, stopOurRunner, uninstallInBackground } from "../install/install.js";
import { managedDir, pluginDirsOf, pluginsDir } from "../install/state.js";
import { startRunner } from "../runner/start.js";
import { wake } from "./wake.js";

const STDIN_MS = 500;
// How long the background uninstall waits for the runner to exit before it removes its files.
const RUNNER_EXIT_MS = 10000;

process.on("uncaughtException", () => process.exit(0));

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    const timer = setTimeout(() => resolve(text), STDIN_MS);
    const done = () => {
      clearTimeout(timer);
      resolve(text);
    };
    process.stdin.setEncoding("utf8").on("data", (piece: string) => (text += piece)).on("end", done).on("error", done);
  });
}

// The session's folder, from the hook's stdin JSON; undefined when there is none.
function cwdOf(input: string): string | undefined {
  try {
    const { cwd } = JSON.parse(input) as { cwd?: unknown };
    return typeof cwd === "string" && cwd ? cwd : undefined;
  } catch {
    return undefined;
  }
}

const self = fileURLToPath(import.meta.url);
const claudeDir = path.dirname(path.dirname(self));
const paths = { claudeDir, settings: path.join(claudeDir, "settings.json"), plugins: pluginsDir(claudeDir, process.env), managed: managedDir(process.platform), pluginDirs: pluginDirsOf(process.env) };
const start = (args: string[], cwd: string, env?: Record<string, string>) => spawn(process.execPath, args, { cwd, env, detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
if (process.argv.includes("--uninstall")) {
  const settle = await settleMs(claudeDir, path.join(runnerAppDir(claudeDir), "config.json"));
  await uninstallInBackground(paths, { settleMs: settle, runner: { commandOf: processCommand, waitMs: RUNNER_EXIT_MS } }).catch(() => {});
  process.exit(0);
}
const input = await readStdin();
const cwd = cwdOf(input);
// Claude Code gives a hook the session's project folder; the session's own folder stands in without it.
const project = process.env.CLAUDE_PROJECT_DIR || cwd;
const session = await recordedState(paths, project).catch(() => "enabled" as const);
if (session === "uninstalled") {
  // Started in the config folder, never inside the isoplan folder it removes.
  if (!(await isUninstalling(claudeDir))) start([self, "--uninstall"], claudeDir);
  process.exit(0);
}
const machine = project ? await recordedState(paths).catch(() => "enabled" as const) : session;
if (machine === "disabled") await stopOurRunner(claudeDir).catch(() => {});
if (session === "enabled") {
  try {
    await wake(input, { claudeDir, spawn: start, project });
  } catch {
    // Nothing to do: a session is never failed for this.
  }
  // The machine's runner, which answers for its rooms, is started again if it isn't running.
  if (machine === "enabled") await startRunner({ claudeDir, spawn: start }).catch(() => {});
}
process.exit(0);
