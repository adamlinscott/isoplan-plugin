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

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startRunner } from "../runner/start.js";
import { wake } from "./wake.js";

const STDIN_MS = 500;

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

const claudeDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const start = (args: string[], cwd: string) => spawn(process.execPath, args, { cwd, detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
try {
  await wake(await readStdin(), { claudeDir, spawn: start });
} catch {
  // Nothing to do: a session is never failed for this.
}
// The machine's runner, which answers for its rooms, is started again if it isn't running.
await startRunner({ claudeDir, spawn: start }).catch(() => {});
process.exit(0);
