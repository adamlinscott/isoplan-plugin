// The runner: one per machine, answering the office server's requests for any of the machine's
// rooms from a fork of the room's lead (src/runner/runner.ts).
//
//   node <claude dir>/isoplan/runner/app/dist/runner.mjs --claude-dir <claude dir>             the supervisor
//   node <claude dir>/isoplan/runner/app/dist/runner.mjs --claude-dir <claude dir> --worker    the worker, which the supervisor starts
//
// Without --claude-dir the config folder is $CLAUDE_CONFIG_DIR or ~/.claude, as Claude Code's own.
// A folder other than ~/.claude is set as CLAUDE_CONFIG_DIR, so the fork finds its sessions there.
//
// It runs from a copy install makes (src/install), not from the plugin's own folder, which a
// plugin update deletes. The copy holds the defaults it reads beside it: config.json, runner.json,
// secret-patterns.json and prompts/.
//
// Install, the plugin's data layer and the wake hook start the supervisor, detached (start.ts). It
// takes <claude dir>/isoplan/runner/lock.json, so a second one exits at once, writes the code it
// runs into it and keeps it fresh, and runs the worker, starting it again after a crash
// (lifecycle.ts). After MAX_FAST_FAILURES quick crashes in a row it gives up and lets the lock go.
// The worker holds one link to the office server, opened with a runner hello, and stays up while
// any session on the machine is inside its lights-off window. A server that doesn't want this
// machine's runner ends it, and it holds off starting again for HOLD_OFF_MS. The worker exits when
// its supervisor has gone too, since its stdin closes then, and ends its forks as it goes.
//
// Its settings are runner.json, overridden per key by ~/.claude/isoplan/runner.json; the secret
// patterns are secret-patterns.json plus ~/.claude/isoplan/secret-patterns.json. Its ledger of
// answers is <claude dir>/isoplan/runner/ledger.json, and it logs to
// <claude dir>/isoplan/logs/runner.log.

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
import { HOLD_OFF_MS, alive, holdOff, lockPath, readLock, refreshLock, releaseLock, takeLock } from "../wake/lock.js";
import { openLedger } from "./caps.js";
import { createClaudeAnswerer, forkableId } from "./claude.js";
import { claudeBinary } from "./claude-binary.js";
import { anyRoomSince, askableMs, NOT_WANTED_CODE, supervise } from "./lifecycle.js";
import { loadPrompts } from "./prompts.js";
import { createRunGit, GIT_FAILED, handoffBranch, handoffNote, HandoffGitError, prepare, pushHandoff } from "../handoff/git.js";
import { takeHandoff, type TakeSettings } from "../handoff/take.js";
import { createRunner, PushFailed, type RunnerSettings } from "./runner.js";
import { loadPatterns, scan } from "./scan.js";
import { runnerEnvPath } from "./environment.js";
import { applyClaudeDir, LOCK_REFRESH_MS, RUNNER_FRESH_MS, runnerCode, runnerLockPath } from "./start.js";

// The runner's log starts over once it is this big.
const LOG_CAP_BYTES = 256 * 1024;
// How often the worker checks whether any room is still lit.
const CHECK_MS = 60000;

const self = fileURLToPath(import.meta.url);
const here = path.dirname(self);
const appDir = path.join(here, "..");
applyClaudeDir(process.argv, process.env, os.homedir());
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
  const code = await runnerCode(self);
  if (!(await takeLock(lock, process.pid, alive, false, Date.now(), { freshMs: RUNNER_FRESH_MS, extra: { code } }).catch(() => false))) return 0;
  log(`runner ${process.pid} started`);
  if (process.argv.includes("--inherited-env")) log(`no environment is recorded in ${runnerEnvPath(claudeDir)}, so the runner runs with its starter's; run the plugin's install script to record one`);
  // Kept fresh, so a lock left by a crash or a reboot goes stale. One another runner took (a
  // newer version, say) ends this one; its worker follows, ending its forks, as its stdin closes.
  const refresh = setInterval(() => {
    void refreshLock(lock, process.pid).then((isHolder) => {
      if (isHolder) return;
      log(`runner ${process.pid} stopped: another runner took its lock`);
      process.exit(0);
    }, () => {});
  }, LOCK_REFRESH_MS);
  const stopped = await supervise({
    log,
    run: () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [self, "--claude-dir", claudeDir, "--worker"], { cwd: claudeDir, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
        // A crash's stack trace goes to the log.
        let stderr = "";
        child.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-4000)));
        child.on("error", (err) => (log(`couldn't start the runner's worker: ${err.message}`), resolve(1)));
        child.on("close", (exit) => {
          if (stderr.trim()) log(`the runner's worker wrote: ${stderr.trim()}`);
          resolve(exit);
        });
      }),
  });
  clearInterval(refresh);
  if (stopped === "done") {
    log(`runner ${process.pid} stopped: no room on this machine is lit`);
    await releaseLock(lock, process.pid).catch(() => {});
  } else {
    // Neither goes away by starting again: it holds off, which a newer version ends for a crash loop.
    const why = stopped === "not-wanted" ? "the office server doesn't want this machine's runner" : "its worker kept crashing as it started";
    log(`runner ${process.pid} stopped: ${why}; it won't start again for ${HOLD_OFF_MS / 60000} minutes`);
    await holdOff(lock, process.pid, Date.now() + HOLD_OFF_MS, { reason: stopped, code }).catch(() => {});
  }
  return 0;
}

async function worker(): Promise<number> {
  const io = nodeIo();
  const config = () => loadConfig(io, path.join(appDir, "config.json"), path.join(isoplanDir, "config.json"));
  const settings = () => loadSettings<RunnerSettings & TakeSettings & { claudeModel: string }>(io, path.join(appDir, "runner.json"), path.join(isoplanDir, "runner.json"));
  const first = await config();
  await settings(); // a broken runner.json of the plugin's is a crash to see at once

  const answerer = createClaudeAnswerer({
    claudeDir,
    binary: () => claudeBinary(claudeDir, process.env, process.platform, os.homedir()),
    model: async () => (await settings()).claudeModel,
    config,
  });
  // However the worker ends, its forks end with it.
  process.on("exit", () => answerer.close());
  const git = createRunGit();
  const gitMs = async () => (await settings()).gitTimeoutSeconds * 1000;
  // A git failure is told by its kind; git's own words stay in the log.
  const told = (err: unknown) => {
    if (!(err instanceof HandoffGitError)) throw err;
    log(`handoff git: ${err.detail}`);
    return new PushFailed(GIT_FAILED[err.kind]);
  };
  const scanText = async (text: string) => scan(text, await loadPatterns(path.join(appDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), log));
  let send: Parameters<typeof createRunner>[0]["send"] = () => {};
  const runner = createRunner({
    answerer,
    ledger: await openLedger(path.join(isoplanDir, "runner", "ledger.json")),
    settings,
    prompts: () => loadPrompts(path.join(appDir, "prompts")),
    scan: scanText,
    send: (message) => send(message),
    log,
    isDir: (p) => fs.stat(p).then((s) => s.isDirectory(), () => false),
    // Only the rooms the data layer would report: inside the askable window, and not held off,
    // which a detached data layer leaves when the server doesn't want the session's project (or git
    // can't place its folder). That hold-off in isoplan/live/<id>.json is the only record of it.
    isReported: async (session, lead) => {
      const id = forkableId(session);
      const lock = id ? await readLock(lockPath(claudeDir, id)) : null;
      if (!id || (lock && lock.pid === null && lock.until !== null && lock.until > Date.now())) return false;
      return Date.now() - lead.lastActive <= askableMs(await config().catch(() => first));
    },
    // The handoff (#48): the brief names the untracked files, then the branch is pushed, both from
    // the lead's folder, in the background, with no prompts and under gitTimeoutSeconds.
    prepareBrief: async (lead, handoff) => {
      const { from, files } = await prepare(git, lead.cwd, await gitMs()).catch((err) => Promise.reject(told(err)));
      return { files, note: handoffNote({ branch: handoffBranch(handoff), from, files, at: new Date() }) };
    },
    push: async (_session, lead, handoff, pushAnyway) => {
      const pushed = await pushHandoff(git, lead.cwd, handoff, await gitMs(), { scan: scanText, pushAnyway }).catch((err) => Promise.reject(told(err)));
      return "held" in pushed ? pushed : [pushed.repo];
    },
    take: (message) =>
      takeHandoff(message, {
        run: git,
        io,
        claudeDir,
        machine: os.hostname(),
        platform: process.platform,
        env: process.env,
        settings,
        claude: () => claudeBinary(claudeDir, process.env, process.platform, os.homedir()),
        scan: scanText,
        log,
      }),
  });

  let notWanted = false;
  let wake: () => void = () => {};
  const link = createLink({
    url: first.server,
    emit: (line) => {
      if (line.type === "log") log(line.text);
      else if (line.type === "error") log(`the office server says: ${line.message} (${line.code})`);
    },
    onMessage: (message) => runner.take(message),
    onNotWanted: () => {
      notWanted = true;
      wake();
    },
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
    await Promise.race([new Promise<void>((r) => ((wake = r), setTimeout(r, CHECK_MS))), gone]);
    if (orphaned || notWanted) break;
    if (!runner.idle()) continue;
    const window = askableMs(await config().catch(() => first));
    if (!(await anyRoomSince(io, path.join(claudeDir, "projects"), Date.now() - window))) break;
  }
  link.close();
  return notWanted ? NOT_WANTED_CODE : 0;
}

process.exitCode = await (process.argv.includes("--worker") ? worker() : supervisor());
await logging;
// The link's timers would keep the process up; it is done.
process.exit();
