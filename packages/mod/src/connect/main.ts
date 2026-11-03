// The isoplan:// link handler, which the operating system runs when the floor's Connect Claude Code
// opens a link (connect.ts says what it does; src/install/link-handler.ts registers it):
//
//   node dist/connect.js <isoplan://connect?...>
//
// Install runs it from its copy beside the runner's (<claude dir>/isoplan/runner/app/dist/connect.mjs),
// which outlives plugin updates, with the mod's config.json one folder up as here. Given the link
// as an argument, it starts itself again, hidden and detached, with the link in its environment,
// says so in one line, and returns at once: on Windows the link starts node in a console window of
// its own, which then closes at once, and the floor's set-up message has Claude run it from a shell
// whose command would otherwise wait for the dialog's answer, up to five minutes. (The Mac handler
// passes the link in the environment, already in the background.) What it did, and why it didn't,
// goes to <claude dir>/isoplan/logs/connect.log as well as the dialog.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accountOf, claudePaths } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { connect, stopReporting } from "./connect.js";
import { ask, tell } from "./dialog.js";

const ENV = "ISOPLAN_CONNECT_URL";
const here = path.dirname(fileURLToPath(import.meta.url));
const link = process.env[ENV] ?? process.argv[2];
const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
const logFile = path.join(claudeDir, "isoplan", "logs", "connect.log");

if (!process.env[ENV] && link) {
  spawn(process.execPath, [fileURLToPath(import.meta.url)], { detached: true, windowsHide: true, stdio: "ignore", env: { ...process.env, [ENV]: link } }).unref();
  process.stdout.write(`A window is opening on this computer to connect Claude Code to Isoplan: answer it there. Run this only once. What happens is written to ${logFile}.\n`);
} else if (!link) {
  process.stderr.write("usage: node connect.js <isoplan://connect?...>\n");
  process.exitCode = 2;
} else {
  const log = (text: string) => {
    void fs
      .mkdir(path.dirname(logFile), { recursive: true })
      .then(() => fs.appendFile(logFile, `${new Date().toISOString()} ${text}\n`))
      .catch(() => {});
  };
  try {
    await connect(link, {
      claudeDir,
      defaultsPath: path.join(here, "..", "config.json"),
      account: () => accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: nodeIo().run }, claudeJson, os.homedir()),
      machine: os.hostname(),
      ask: (title, text) => ask(process.platform, title, text),
      tell: (title, text, problem) => tell(process.platform, title, text, problem),
      restart: () => stopReporting(claudeDir),
      log,
    });
  } catch (err) {
    log(`couldn't connect: ${String((err as Error)?.stack ?? err)}`);
    await tell(process.platform, "Connect Claude Code to Isoplan", `Claude Code wasn't connected: ${String((err as Error)?.message ?? err)}`, true).catch(() => {});
    process.exitCode = 1;
  }
}
