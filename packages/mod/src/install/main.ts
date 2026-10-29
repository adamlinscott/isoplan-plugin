// The install script: puts the wake hook in Claude Code's user settings without a session, as the
// plugin's data layer does when it starts, or takes it out again. Installing also backfills: every
// session written inside the window is reported now rather than on its next turn, so running it
// again fills the office back in. It also records the `claude` binary and starts the machine's
// runner (src/runner), which answers for its rooms.
//
//   node dist/install.js [--uninstall]
//
// The config folder is $CLAUDE_CONFIG_DIR when it is set, else ~/.claude, as Claude Code's own.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudePaths } from "../data-layer/claude-paths.js";
import { loadConfig } from "../data-layer/config.js";
import { nodeIo } from "../data-layer/io.js";
import { claudeBinaryPath, findClaude } from "../runner/claude-binary.js";
import { startRunner, stopRunner } from "../runner/start.js";
import { recentSessions } from "../sweep/find.js";
import { backfill } from "../wake/backfill.js";
import { installWake, uninstallWake } from "./install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const claudeDir = claudePaths(process.env, os.homedir()).dir;
const paths = { claudeDir, settings: path.join(claudeDir, "settings.json") };
const uninstall = process.argv.includes("--uninstall");

const start = (args: string[], cwd: string) => spawn(process.execPath, args, { cwd, detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();

try {
  const changes = uninstall
    ? await uninstallWake(paths)
    : await installWake(paths, path.join(here, "data-layer.js"), path.join(here, "wake.js"), {
        runner: path.join(here, "runner.js"),
        findClaude: () => findClaude(process.env, process.platform, os.homedir()),
      });
  for (const change of changes) console.log(change);
  if (!changes.length) console.log(uninstall ? "The wake hook wasn't installed; nothing to remove." : "The wake hook is already installed; nothing changed.");
  if (uninstall && (await stopRunner(claudeDir))) console.log("Stopped the runner, which answered for this machine's rooms.");
  if (!uninstall) {
    if (!(await fs.stat(claudeBinaryPath(claudeDir)).catch(() => null))) console.log("Couldn't find the claude binary, so the runner can't answer for this machine's rooms; set its path in " + claudeBinaryPath(claudeDir) + ' as { "path": "..." }.');
    console.log((await startRunner({ claudeDir, spawn: start })) ? "Started the runner, which answers for this machine's rooms." : "The runner is already running.");
    const io = nodeIo();
    const config = await loadConfig(io, path.join(here, "..", "config.json"), path.join(claudeDir, "isoplan", "config.json"));
    const found = await recentSessions(io, path.join(claudeDir, "projects"), Date.now() - config.lightsOffHours * 3600000);
    const dataLayer = path.join(here, "data-layer.js");
    const started = await backfill(found, { claudeDir, dataLayer, spawn: start });
    console.log(`Reported ${started} session(s) from the last ${config.lightsOffHours} hours to ${config.server}; ${found.length - started} were already reported or their folder is gone.`);
  }
} catch (err) {
  process.stderr.write(`isoplan install: ${(err as Error).message}\n`);
  process.exitCode = 1;
}
