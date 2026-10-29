// The runner: one per machine, answering the office server's requests for any of the machine's
// rooms from a fork of the room's lead (src/runner/runner.ts).
//
//   node dist/runner.js             the supervisor
//   node dist/runner.js --worker    the worker, which the supervisor starts
//
// Install, the plugin's data layer and the wake hook start the supervisor, detached (start.ts). It
// takes <claude dir>/isoplan/runner/lock.json, so a second one exits at once, and runs the worker,
// starting it again after a crash (lifecycle.ts). The worker holds one link to the office server,
// opened with a runner hello, and stays up while any session on the machine is inside its
// lights-off window. It exits when its supervisor has gone too: its stdin closes then.
//
// Its settings are the mod's runner.json, overridden per key by ~/.claude/isoplan/runner.json; the
// secret patterns are the mod's secret-patterns.json plus ~/.claude/isoplan/secret-patterns.json;
// what the fork is told is in the mod's prompts/. Its ledger of answers is
// <claude dir>/isoplan/runner/ledger.json, and it logs to <claude dir>/isoplan/logs/runner.log.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION } from "@isoplan/protocol";
import { loadConfig, loadSettings } from "../data-layer/config.js";
import { accountOf, claudePaths } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { createLink } from "../data-layer/link.js";
import { alive, releaseLock, takeLock } from "../wake/lock.js";
import { openLedger } from "./caps.js";
import { createClaudeAnswerer } from "./claude.js";
import { claudeBinary } from "./claude-binary.js";
import { anyRoomSince, askableMs, supervise } from "./lifecycle.js";
import { loadPrompts } from "./prompts.js";
import { createRunner, type RunnerSettings } from "./runner.js";
import { loadPatterns, scan } from "./scan.js";
import { runnerLockPath } from "./start.js";

// The runner's log starts over once it is this big.
const LOG_CAP_BYTES = 256 * 1024;
// How often the worker checks whether any room is still lit.
const CHECK_MS = 60000;

const self = fileURLToPath(import.meta.url);
const here = path.dirname(self);
const modDir = path.join(here, "..");
const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
const isoplanDir = path.join(claudeDir, "isoplan");
const logFile = path.join(isoplanDir, "logs", "runner.log");

let logging = Promise.resolve();
function log(text: string) {
  const line = `${new Date().toISOString()} ${text}\n`;
  logging = logging.then(() => writeLog(line)).catch(() => {});
}

async function writeLog(text: string): Promise<void> {
  const size = (await fs.stat(logFile).catch(() => null))?.size ?? 0;
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  if (size > LOG_CAP_BYTES) await fs.writeFile(logFile, text);
  else await fs.appendFile(logFile, text);
}

async function supervisor(): Promise<number> {
  const lock = runnerLockPath(claudeDir);
  if (!(await takeLock(lock, process.pid, alive).catch(() => false))) return 0;
  log(`runner ${process.pid} started`);
  await supervise({
    log,
    run: () =>
      new Promise((resolve) => {
        const worker = spawn(process.execPath, [self, "--worker"], { cwd: claudeDir, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
        // A crash's stack trace goes to the log.
        let stderr = "";
        worker.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-4000)));
        worker.on("error", (err) => (log(`couldn't start the runner's worker: ${err.message}`), resolve(1)));
        worker.on("close", (code) => {
          if (stderr.trim()) log(`the runner's worker wrote: ${stderr.trim()}`);
          resolve(code);
        });
      }),
  });
  log(`runner ${process.pid} stopped: no room on this machine is lit`);
  await releaseLock(lock, process.pid).catch(() => {});
  return 0;
}

async function worker(): Promise<number> {
  const io = nodeIo();
  const config = () => loadConfig(io, path.join(modDir, "config.json"), path.join(isoplanDir, "config.json"));
  const settings = () => loadSettings<RunnerSettings & { claudeModel: string }>(io, path.join(modDir, "runner.json"), path.join(isoplanDir, "runner.json"));
  const first = await config();
  await settings(); // a broken runner.json of the mod's is a crash to see at once

  const answerer = createClaudeAnswerer({
    claudeDir,
    binary: () => claudeBinary(claudeDir, process.env, process.platform, os.homedir()),
    model: async () => (await settings()).claudeModel,
    config,
  });
  let send: Parameters<typeof createRunner>[0]["send"] = () => {};
  const runner = createRunner({
    answerer,
    ledger: await openLedger(path.join(isoplanDir, "runner", "ledger.json")),
    settings,
    prompts: () => loadPrompts(path.join(modDir, "prompts")),
    scan: async (text) => scan(text, await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), log)),
    send: (message) => send(message),
    log,
    isDir: (p) => fs.stat(p).then((s) => s.isDirectory(), () => false),
  });

  const link = createLink({
    url: first.server,
    emit: (line) => {
      if (line.type === "log") log(line.text);
      else if (line.type === "error") log(`the office server says: ${line.message} (${line.code})`);
    },
    onMessage: (message) => runner.take(message),
    hello: {
      type: "runner",
      v: PROTOCOL_VERSION,
      account: await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, os.homedir()),
      machine: { name: os.hostname() },
    },
  });
  send = (message) => link.send(message);
  log(`the runner's worker ${process.pid} is answering for this machine through ${first.server}`);

  // The supervisor holds stdin open; it closes when the supervisor has gone.
  let orphaned = false;
  const gone = new Promise<void>((resolve) => process.stdin.on("end", resolve).on("error", resolve).resume()).then(() => (orphaned = true));
  for (;;) {
    await Promise.race([new Promise((r) => setTimeout(r, CHECK_MS)), gone]);
    if (orphaned) break;
    if (!runner.idle()) continue;
    const window = askableMs(await config().catch(() => first));
    if (!(await anyRoomSince(io, path.join(claudeDir, "projects"), Date.now() - window))) break;
  }
  link.close();
  return 0;
}

process.exitCode = await (process.argv.includes("--worker") ? worker() : supervisor());
await logging;
// The link's timers would keep the process up; it is done.
process.exit();
