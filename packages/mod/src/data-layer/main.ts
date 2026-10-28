// The data layer: the process the hooks module spawns for one Claude Code session.
//
//   node dist/data-layer.js --session <session id> --cwd <the session's folder>
//
// Every `streamSeconds` it reads the session's facts from its transcripts and hands them to the
// link, which holds the WebSocket to the office server. It writes JSON lines to stdout for the
// hooks module (src/lines.ts): the link's state, the server's notes, and room titles to write.
// Claude Code ends it with the session; as a backstop it also stops when stdout breaks or its
// parent process has gone. When it starts it also installs the wake hook (src/install), so
// sessions without the plugin are seen too, and the first time, reports the machine's other recent
// sessions at once (src/wake/backfill.ts).
//
//   node dist/data-layer.js --session <session id> --cwd <the session's folder> --detached
//
// The wake hook starts it detached, for a session without the plugin. Then there is no parent and
// no reader: stdout lines are dropped, and log lines go to <claude dir>/isoplan/logs/<session>.log.
// It lives only while the session is at work, since the wake hook starts another on the session's
// next turn: it exits once the session has been quiet longer than `idleMinutes`, once its link has
// been down five minutes in a row (src/data-layer/detached.ts), once the session has nothing to
// report, or when the server says the project isn't wanted. It can't watch the session's own
// process (the hook's parent may be a short-lived shell), so a closed session shows as quiet until
// its data layer exits, then unreachable.
//
// One data layer reports a session: each takes <claude dir>/isoplan/live/<session>.json (src/wake/
// lock.ts). A detached one exits at once if another holds it, and as soon as the plugin's takes it
// over. The plugin's takes it regardless, takes it back each pass if it was lost, and goes on
// without it if the folder can't be written.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION, type Facts } from "@isoplan/protocol";
import { installWake } from "../install/install.js";
import type { DataLayerLine, TitleReply } from "../lines.js";
import { recentSessions } from "../sweep/find.js";
import { backfill } from "../wake/backfill.js";
import { alive, HOLD_OFF_MS, holdOff, lockHolder, lockPath, releaseLock, takeLock } from "../wake/lock.js";
import { createClaudeCode } from "./claude-code.js";
import { loadConfig, type Config } from "./config.js";
import { detachedStop } from "./detached.js";
import { createGit } from "./git.js";
import { accountOf, claudePaths, projectOf } from "./identity.js";
import { nodeIo } from "./io.js";
import { createLink, type Link } from "./link.js";
import { cleanTitle, nextTitle, TITLE_SYSTEM, type TitleCache } from "./titles.js";

// A detached data layer's log starts over once it is this big.
const LOG_CAP_BYTES = 64 * 1024;

const value = (argv: string[], flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : null;
};

async function main(argv: string[]): Promise<number> {
  const sessionId = value(argv, "--session");
  const cwd = value(argv, "--cwd");
  const detached = argv.includes("--detached");
  if (!sessionId || !cwd) {
    process.stderr.write("usage: node data-layer.js --session <id> --cwd <dir> [--detached]\n");
    return 2;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/data-layer.js sits one folder below the mod's config.json.
  const defaultsPath = path.join(here, "..", "config.json");
  const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
  const lock = lockPath(claudeDir, sessionId);
  const userConfigPath = path.join(claudeDir, "isoplan", "config.json");
  // The person's own folder, not the machine's shared temp folder.
  const titlesDir = path.join(claudeDir, "isoplan", "titles");
  const titleFile = path.join(titlesDir, `${sessionId}.json`);
  const machine = os.hostname();

  const io = nodeIo();
  const git = createGit(io);
  const source = createClaudeCode({ ...io, claudeDir });

  // Ends when stdout can no longer be written, or the parent is gone (checked each pass). On POSIX
  // an orphan is re-parented, so a changed ppid means gone even if the old pid is reused. Detached,
  // neither applies.
  const parent = process.ppid;
  let isOut = !detached;
  const closed = detached ? new Promise<void>(() => {}) : new Promise<void>((resolve) => process.stdout.on("error", () => resolve()));
  void closed.then(() => (isOut = false));
  const logFile = path.join(claudeDir, "isoplan", "logs", `${sessionId}.log`);
  let logging = Promise.resolve();
  let downSince: number | null = Date.now(); // since when the link hasn't been connected; null while it is
  const emit = (line: DataLayerLine) => {
    if (line.type === "status") downSince = line.state === "connected" ? null : (downSince ?? Date.now());
    if (isOut) process.stdout.write(JSON.stringify(line) + "\n");
    else if (detached && (line.type === "log" || line.type === "error")) {
      const text = `${new Date().toISOString()} ${line.type === "log" ? line.text : `the office server says: ${line.message} (${line.code})`}\n`;
      logging = logging.then(() => writeLog(logFile, text)).catch(() => {});
    }
  };
  const wait = (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeUp = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(detached || (process.ppid === parent && alive(parent))), ms)));
    return Promise.race([timeUp, closed.then(() => false)]).finally(() => clearTimeout(timer));
  };

  try {
    if (!(await takeLock(lock, process.pid, alive, !detached))) {
      process.stderr.write(`another data layer already reports session ${sessionId}\n`);
      return 0;
    }
  } catch (err) {
    if (detached) return 0;
    emit({ type: "log", text: `couldn't take the session lock, so going on without it: ${String((err as Error)?.message ?? err)}` });
  }

  const paths = { claudeDir, settings: path.join(claudeDir, "settings.json") };
  const installing = detached
    ? Promise.resolve([])
    : installWake(paths, path.join(here, "data-layer.js"), path.join(here, "wake.js"), { auto: true }).then(
        (changes) => (changes.forEach((text) => emit({ type: "log", text })), changes),
        (err: unknown) => (emit({ type: "log", text: `couldn't install the wake hook: ${String((err as Error)?.message ?? err)}` }), []),
      );

  let config: Config = await loadConfig(io, defaultsPath, userConfigPath);
  // A hook just installed sees other sessions only on their next turn: they are reported now.
  void installing
    .then(async (changes) => {
      if (!changes.length) return;
      const found = await recentSessions(io, path.join(claudeDir, "projects"), Date.now() - config.lightsOffHours * 3600000);
      const started = await backfill(found, {
        claudeDir,
        dataLayer: path.join(here, "data-layer.js"),
        spawn: (args, dir) => spawn(process.execPath, args, { cwd: dir, detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref(),
      });
      emit({ type: "log", text: `reported ${started} other session(s) from the last ${config.lightsOffHours} hours` });
    })
    .catch((err: unknown) => emit({ type: "log", text: `couldn't report the other sessions: ${String((err as Error)?.message ?? err)}` }));
  // The address is read once: a link that moved servers mid-session would leave a room behind.
  const server = config.server;
  emit({ type: "status", server, state: "waiting" });

  let link: Link | null = null;
  let reported = ""; // the last problem logged, so a lasting one is logged once
  let title: TitleCache | null = null;
  let asked: string | null = null; // the key of the title call in flight
  let isUnwanted = false; // detached, and the server said this project isn't wanted
  let isPlaceless = false; // detached, and git couldn't place the session's folder
  let passes = 0;

  do {
    const now = Date.now();
    const isFirstPass = passes++ === 0;
    // A detached data layer that stopped may have deleted this one's lock as it went.
    if (!detached && (await lockHolder(lock)) !== process.pid) await takeLock(lock, process.pid, alive, true).catch(() => {});
    config = await loadConfig(io, defaultsPath, userConfigPath).catch(() => config);
    const gitOpts = { now, maxAgeMs: config.gitCacheSeconds * 1000 };
    const resolve = (dir: string) => git.resolve(dir, gitOpts);
    const read = await source.read({ sessionId, cwd, now, config, resolve }).catch((err: unknown) => ({
      facts: null,
      status: String((err as Error)?.message ?? err),
      errors: { count: 0, first: null },
    }));
    const problem = read.status ?? (read.errors.count ? `${read.errors.count} transcript(s) could not be read: ${read.errors.first}` : "");
    if (problem && problem !== reported) emit({ type: "log", text: problem });
    reported = problem;
    if (!read.facts) {
      // Nothing to report (lights off with no reply, aged out, the transcript gone): the link
      // closes, so the server marks the room unreachable and ages it out. It opens again if facts
      // come back; a detached data layer is done, and the wake hook starts another if they do.
      if (detached) {
        // A folder git can't place won't be placed on the next turn either: the wake hook holds off.
        isPlaceless = isFirstPass && !(await resolve(cwd));
        break;
      }
      if (link) {
        link.close();
        link = null;
        emit({ type: "status", server, state: "waiting" });
      }
      continue;
    }

    // A written title replaces the branch stand-in; the hooks module writes the reply to a file.
    const reply = await takeReply(titleFile);
    if (reply) {
      const text = reply.key === asked ? cleanTitle(reply.text) : null;
      if (text && title) title = { key: reply.key, title: text, at: title.at };
    }
    const ask = nextTitle(read.facts, title, now);
    if (ask && (await fs.mkdir(titlesDir, { recursive: true }).then(() => true, () => false))) {
      title = { key: title?.key ?? null, title: title?.title ?? null, at: now };
      asked = ask.key;
      emit({ type: "title-ask", model: "haiku", system: TITLE_SYSTEM, prompt: ask.prompt, maxTokens: 40, key: ask.key, file: titleFile });
    }
    const facts: Facts = read.facts.session.titleFrom === "branch" && title?.title ? { ...read.facts, session: { ...read.facts.session, title: title.title } } : read.facts;

    if (!link) {
      const where = await resolve(cwd);
      link = createLink({
        url: server,
        emit,
        onNotWanted: () => (isUnwanted = detached),
        hello: {
          type: "hello",
          v: PROTOCOL_VERSION,
          source: "claude-code",
          account: await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, cwd),
          machine: { name: machine },
          session: facts.session.id,
          project: await projectOf(io.run, where, cwd, machine),
        },
      });
    }
    link.update(facts);
    const why = detached ? detachedStop({ now, lastActive: facts.session.lastActive, idleMinutes: config.idleMinutes, downSince }) : null;
    if (why) {
      emit({ type: "log", text: `stopping: ${why}` });
      break;
    }
  } while ((await wait(config.streamSeconds * 1000)) && !isUnwanted && (!detached || (await lockHolder(lock)) === process.pid));

  link?.close();
  if (isUnwanted || isPlaceless) await holdOff(lock, process.pid, Date.now() + HOLD_OFF_MS).catch(() => {});
  else await releaseLock(lock, process.pid).catch(() => {});
  await logging;
  return 0;
}

// Appends to a detached data layer's log, starting it over once it passes LOG_CAP_BYTES.
async function writeLog(file: string, text: string): Promise<void> {
  const size = (await fs.stat(file).catch(() => null))?.size ?? 0;
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (size > LOG_CAP_BYTES) await fs.writeFile(file, text);
  else await fs.appendFile(file, text);
}

// The title reply, if the hooks module has written one; the file goes once it is read. One that
// doesn't parse may still be being written, so it is left for the next pass.
async function takeReply(file: string): Promise<TitleReply | null> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
  await fs.rm(file, { force: true }).catch(() => {});
  const r = value as Partial<TitleReply>;
  return typeof r.key === "string" && typeof r.text === "string" ? { key: r.key, text: r.text } : null;
}

process.exitCode = await main(process.argv.slice(2));
// The link's timers would keep the process up; it is done.
process.exit();
