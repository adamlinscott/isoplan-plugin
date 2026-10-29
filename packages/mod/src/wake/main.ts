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
// It is also how an uninstall through Claude Code (`/plugin uninstall`, the plugin manager, `claude
// plugin uninstall`) takes everything out, since Claude Code runs nothing of a plugin's then: once
// installed_plugins.json no longer lists the plugin whose data layer wake.json records, the hook
// starts no data layer and no runner, and starts itself detached to uninstall it all instead
// (src/install), hooks, runner and files, so the session isn't kept waiting while it does.
//
//   node <claude dir>/isoplan/wake.mjs --uninstall

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRecordedUninstalled, pluginsDir, uninstall } from "../install/install.js";
import { startRunner } from "../runner/start.js";
import { wake } from "./wake.js";

const STDIN_MS = 500;
// Long enough for a detached data layer to see its lock has gone, at the default streamSeconds.
const SETTLE_MS = 3000;

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

const self = fileURLToPath(import.meta.url);
const claudeDir = path.dirname(path.dirname(self));
const paths = { claudeDir, settings: path.join(claudeDir, "settings.json"), plugins: pluginsDir(claudeDir, process.env) };
const start = (args: string[], cwd: string, env?: Record<string, string>) => spawn(process.execPath, args, { cwd, env, detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
if (process.argv.includes("--uninstall")) {
  await uninstall(paths, { settleMs: SETTLE_MS }).catch(() => {});
  process.exit(0);
}
const input = await readStdin();
if (await isRecordedUninstalled(paths)) {
  // Started in the config folder, never inside the isoplan folder it removes.
  start([self, "--uninstall"], claudeDir);
  process.exit(0);
}
try {
  await wake(input, { claudeDir, spawn: start });
} catch {
  // Nothing to do: a session is never failed for this.
}
// The machine's runner, which answers for its rooms, is started again if it isn't running.
await startRunner({ claudeDir, spawn: start }).catch(() => {});
process.exit(0);
