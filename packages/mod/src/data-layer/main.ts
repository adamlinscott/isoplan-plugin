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
// sessions at once (src/wake/backfill.ts), and starts the machine's runner (src/runner) if none is
// running. Each agent's report is secret-checked before it is sent, and one that matches is held
// until its owner releases it (src/data-layer/reports.ts). Only a session in a repo the office takes
// is reported: the data layer reads the office's list of repos (src/data-layer/approved.ts) and opens
// no link for any other, sending nothing of it, its hello included, and says so in the status line.
// An office server that signs people in wants the machine paired first: reading that list pairs it,
// keeping the credential in <claude dir>/isoplan/pairing.json, under the machine's Claude account
// (src/data-layer/pairing.ts).
// It keeps the plugin up to date (src/update): as it starts and every `updateCheckHours` it installs
// a newer version in the background, and once one is on disk it says so in the status line, since
// the session loads it only at /reload-plugins. An outdated data layer installs nothing, so it never
// hands the wake hook and the runner back to older code; a detached one stops, leaving its session
// to the newest one, which the wake hook starts.
// An agent's open question to its owner is reported too, secret-checked like a report, and
// answerable from the floor while this data layer's hooks module marks that it waits for it
// (src/data-layer/owner-answers.ts); a detached one's are read-only.
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
// lock.ts), naming its own script, whether it is detached, when its window's hooks module started
// (`--since`) and that window's Claude Code process, and refreshes it each pass. A detached one
// exits at once if another holds it, and as soon as the plugin's takes it over. The plugin's takes
// it regardless, and goes on without it if the folder can't be written. It takes it back each pass,
// unless the plugin's data layer holding it, with a fresh lock, is the newest copy for this session
// while this one isn't, or runs the same copy, started later in a window whose Claude Code is still
// running (a /reload-plugins, or the session opened in a second window): then it says it is
// `superseded` and exits, never for an older or equal holder.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION, type Facts, type Project } from "@isoplan/protocol";
import { installWake } from "../install/install.js";
import { managedDir, newestDataLayer, normalPath, pluginDirsOf, pluginIdOf, pluginState, pluginsDir, type Place } from "../install/state.js";
import type { DataLayerLine, TitleReply, WaitMark } from "../lines.js";
import { claudeBinary, claudeCommand, findClaude } from "../runner/claude-binary.js";
import { loadPatterns, type Pattern } from "../runner/scan.js";
import { startRunner } from "../runner/start.js";
import { recentSessions } from "../sweep/find.js";
import { checkForUpdate, commandEnv, gitChoices, START_GAP_MS, updatesOffBy } from "../update/update.js";
import { backfill } from "../wake/backfill.js";
import { alive, HOLD_OFF_MS, holdOff, lockHolder, lockPath, readLock, refreshLock, releaseLock, takeLock } from "../wake/lock.js";
import { approvedPath, createApproved, createSessionGate, type Dormancy } from "./approved.js";
import { forOffice } from "./attribution.js";
import { candidatesOf, inRepos } from "./home.js";
import { createClaudeCode } from "./claude-code.js";
import { loadConfig, type Config } from "./config.js";
import { detachedStop } from "./detached.js";
import { createGit, pathKey, type Where } from "./git.js";
import { accountOf, claudePaths, projectOf } from "./identity.js";
import { nodeIo } from "./io.js";
import { createLink, type Link } from "./link.js";
import { lateTake, prepareQuestions, relayOwnerAnswer } from "./owner-answers.js";
import { createPairing, pairingLockPath, pairingPath, pairingWriteLockPath } from "./pairing.js";
import { openReportHold } from "./reports.js";
import { cleanTitle, nextTitle, TITLE_SYSTEM, type TitleCache } from "./titles.js";

// A detached data layer's log starts over once it is this big.
const LOG_CAP_BYTES = 64 * 1024;
// How long a session the office doesn't take waits between passes.
const DORMANT_MS = 30000;
// A session lock its holder hasn't refreshed for this long (three of its slowest passes) counts for
// nothing when a data layer decides whether to give the session up: the pid may have been reused.
const LOCK_FRESH_MS = 3 * DORMANT_MS;

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
  // Where the hooks module says whether it took an owner's answer, one file per request, and where it
  // marks the questions it waits on: this session's own folders, cleared as the data layer starts.
  const answersDir = path.join(claudeDir, "isoplan", "answers", sessionId);
  const waitsDir = path.join(claudeDir, "isoplan", "waits", sessionId);
  const modPatterns = path.join(here, "..", "secret-patterns.json");
  const ownerPatterns = path.join(claudeDir, "isoplan", "secret-patterns.json");
  const machine = os.hostname();

  const io = nodeIo();
  const git = createGit(io);
  // The project of each repo an edit or command lands in, by its common dir, looked up again as
  // git's answers are (#74).
  const projects = new Map<string, { at: number; project: ReturnType<typeof projectOf> }>();
  const source = createClaudeCode({ ...io, claudeDir, home: os.homedir() });

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
  // A link that drops has the list of repos the office takes read again, in case that is why.
  let dropped = () => {};
  const emit = (line: DataLayerLine) => {
    if (line.type === "status") downSince = line.state === "connected" ? null : (downSince ?? Date.now());
    if (line.type === "status" && line.state === "disconnected") dropped();
    if (isOut) process.stdout.write(JSON.stringify(line) + "\n");
    else if (detached && (line.type === "log" || line.type === "error" || line.type === "pair")) {
      const said = line.type === "log" ? line.text : line.type === "pair" ? pairNote(line) : `the office server says: ${line.message} (${line.code})`;
      const text = `${new Date().toISOString()} ${said}\n`;
      logging = logging.then(() => writeLog(logFile, text)).catch(() => {});
    }
  };
  const wait = (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeUp = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(detached || (process.ppid === parent && alive(parent))), ms)));
    return Promise.race([timeUp, closed.then(() => false)]).finally(() => clearTimeout(timer));
  };

  // Claude Code runs nothing of a plugin's when it is uninstalled or disabled, so this looks itself
  // (src/install/state.ts), before it takes the session's lock and on every pass: a data layer whose
  // plugin is uninstalled or disabled for this session reports nothing and exits.
  const place: Place = { claudeDir, plugins: pluginsDir(claudeDir, process.env), managed: managedDir(process.platform), pluginDirs: pluginDirsOf(process.env) };
  // The project folder the wake hook passes on ($CLAUDE_PROJECT_DIR); the session's folder without it.
  const project = value(argv, "--project") ?? cwd;
  const self = path.join(here, "data-layer.js");
  const isOff = async () => (await pluginState(place, self, project).catch(() => "enabled")) !== "enabled";
  if (await isOff()) {
    emit({ type: "log", text: "Claude Code lists the Isoplan plugin as uninstalled or disabled here, so this session isn't reported" });
    return 0;
  }
  // When this window's hooks module started: one it starts again keeps its window's place.
  const since = Number(value(argv, "--since")) || Date.now();
  const lockExtra = { dataLayer: self, detached, since, parent: process.ppid };
  // The newest copy of the plugin installed for this session (state.ts): another one means this one is outdated.
  const newest = () => newestDataLayer(place.plugins, self, project).catch(() => self);
  const isOutdated = async () => (await newest()) !== self;
  let outdated = await isOutdated();
  if (detached && outdated) {
    emit({ type: "log", text: "a newer version of the Isoplan plugin is installed, so it reports this session instead" });
    await logging;
    return 0;
  }

  // Why this data layer gives the session up to the plugin's data layer holding it (see above), or null.
  const supersededBy = async (): Promise<"newer" | "window" | null> => {
    const held = await readLock(lock);
    if (!held?.pid || held.pid === process.pid || !alive(held.pid) || Date.now() - held.mtimeMs >= LOCK_FRESH_MS) return null;
    const { dataLayer: other, detached: otherDetached, since: otherSince, parent } = held.extra;
    if (otherDetached !== false || typeof other !== "string") return null;
    if (normalPath(other) === normalPath(self)) return typeof otherSince === "number" && otherSince > since && typeof parent === "number" && alive(parent) ? "window" : null;
    const current = await newest();
    outdated = current !== self;
    return outdated && normalPath(current) === normalPath(other) ? "newer" : null;
  };
  const leave = (reason: "newer" | "window") => {
    emit({ type: "log", text: reason === "newer" ? "stopping: the newer version's data layer that a reload started reports this session now" : "stopping: the session's newer window reports it now" });
    emit({ type: "superseded", reason });
  };
  if (!detached) {
    const reason = await supersededBy();
    if (reason) {
      leave(reason);
      return 0;
    }
  }

  try {
    if (!(await takeLock(lock, process.pid, alive, !detached, Date.now(), { extra: lockExtra }))) {
      process.stderr.write(`another data layer already reports session ${sessionId}\n`);
      return 0;
    }
  } catch (err) {
    if (detached) return 0;
    emit({ type: "log", text: `couldn't take the session lock, so going on without it: ${String((err as Error)?.message ?? err)}` });
  }

  const paths = { ...place, settings: path.join(claudeDir, "settings.json") };
  const start = (args: string[], dir: string, env?: Record<string, string>) => spawn(process.execPath, args, { cwd: dir, env, detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
  const installing = detached || outdated
    ? Promise.resolve([])
    : installWake(paths, path.join(here, "data-layer.js"), path.join(here, "wake.js"), {
        auto: true,
        runnerFrom: path.join(here, ".."),
        findClaude: () => findClaude(process.env, process.platform, os.homedir()),
      }).then(
        (changes) => (changes.forEach((text) => emit({ type: "log", text })), changes),
        (err: unknown) => (emit({ type: "log", text: `couldn't install the wake hook: ${String((err as Error)?.message ?? err)}` }), []),
      );
  // The machine's runner answers for its rooms; it is started here as well as by the wake hook.
  // Not while the plugin is disabled for the machine, though this session's project enables it.
  if (!detached && !outdated) void installing.then(async () => (await pluginState(place, self)) === "enabled" && startRunner({ claudeDir, spawn: start })).catch(() => {});

  let config: Config = await loadConfig(io, defaultsPath, userConfigPath);
  if (outdated) emit({ type: "updated" });
  // The update check (src/update), for a copy in Claude Code's plugin cache: there is nothing to
  // update in a checkout or a folder loaded in place. One at a time in this process; the machine's
  // lock and record keep sessions from checking together.
  const pluginId = pluginIdOf(place.plugins, self);
  let checking = false;
  let checkedAt = Date.now(); // the timed checks count from the one at start
  const checkUpdate = (gapMs: number) => {
    if (detached || !pluginId || outdated || checking || !config.updateCheckHours) return;
    checkedAt = Date.now();
    const off = updatesOffBy(process.env);
    if (off) return emit({ type: "log", text: `not checking for a newer version of the plugin: ${off} is set (FORCE_AUTOUPDATE_PLUGINS=1 turns plugin updates back on)` });
    checking = true;
    void (async () => {
      if ((await pluginState(place, self).catch(() => "enabled")) !== "enabled") return emit({ type: "log", text: "not checking for a newer version of the plugin: it is disabled for this machine" });
      const binary = await claudeBinary(claudeDir, process.env, process.platform, os.homedir());
      if (!binary) return emit({ type: "log", text: "couldn't find the claude binary, so the plugin can't update itself" });
      const checked = await checkForUpdate({ claudeDir, settings: paths.settings, plugins: place.plugins, id: pluginId, cwd: project, claude: claudeCommand(binary), env: commandEnv(process.env, await gitChoices(project)), gapMs });
      for (const text of checked.said) emit({ type: "log", text: `update check: ${text}` });
    })()
      .catch((err: unknown) => emit({ type: "log", text: `couldn't check for a newer version of the plugin: ${String((err as Error)?.message ?? err)}` }))
      .finally(() => (checking = false));
  };
  // After the wake hook's install, which writes settings.json too: neither then loses the other's change.
  void installing.then(() => checkUpdate(START_GAP_MS));
  // A hook just installed sees other sessions only on their next turn: they are reported now.
  void installing
    .then(async (changes) => {
      if (!changes.length) return;
      const found = await recentSessions(io, path.join(claudeDir, "projects"), Date.now() - config.lightsOffHours * 3600000);
      const started = await backfill(found, { claudeDir, dataLayer: path.join(here, "data-layer.js"), spawn: start });
      emit({ type: "log", text: `reported ${started} other session(s) from the last ${config.lightsOffHours} hours` });
    })
    .catch((err: unknown) => emit({ type: "log", text: `couldn't report the other sessions: ${String((err as Error)?.message ?? err)}` }));
  // The address is read once: a link that moved servers mid-session would leave a room behind.
  const server = config.server;
  // Plain ws:// to another machine would send facts and the machine's credential unencrypted.
  if (config.plainRefused) {
    emit({ type: "status", server: config.plainRefused, state: "insecure" });
    emit({ type: "log", text: `not reporting: ${config.plainRefused} is plain ws:// to another machine; use wss://, or set "allowPlainWs": true in config.json` });
    if (!detached) await closed;
    await logging;
    return 0;
  }
  emit({ type: "status", server, state: "waiting" });
  if (!detached) {
    for (const dir of [answersDir, waitsDir]) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    if (await fs.mkdir(waitsDir, { recursive: true }).then(() => true, () => false)) emit({ type: "waits", dir: waitsDir });
  }

  // The pairing is the machine's, whichever folder the session is in. The list of repos the office
  // takes is read with it, which pairs a machine not paired yet (approved.ts).
  const machineAccount = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, os.homedir());
  const pairing = createPairing({
    file: pairingPath(claudeDir),
    lock: pairingLockPath(claudeDir),
    writeLock: pairingWriteLockPath(claudeDir),
    server,
    account: machineAccount,
    machine,
    emit,
    allowPlainWs: config.allowPlainWs,
  });
  const approved = createApproved({
    server,
    file: approvedPath(claudeDir),
    pairing,
    refreshMs: config.approvedRefreshMinutes * 60000,
    maxAgeMs: config.approvedMaxAgeMinutes * 60000,
    log: (text) => emit({ type: "log", text }),
  });
  dropped = () => void approved.refresh(true);
  // The projects the session may report as (home.ts), looked up again as git's answers are.
  let candidates: { projects: Project[]; workspace: boolean } | null = null;
  let candidatesAt = -Infinity;
  let dormant: Dormancy | null = null; // why nothing is sent, while it isn't
  let notApproved: string[] | null = null; // detached, and the office takes none of these: it holds off
  let factsSession = ""; // the session's id as its facts give it, for the hello
  let link: Link | null = null;
  let reported = ""; // the last problem logged, so a lasting one is logged once
  let title: TitleCache | null = null;
  let asked: string | null = null; // the key of the title call in flight
  let isUnwanted = false; // detached, and the server said this project isn't wanted
  let isPlaceless = false; // detached, and git couldn't place the session's folder
  let passes = 0;
  const hold = await openReportHold(path.join(claudeDir, "isoplan", "released", `${sessionId}.json`), (text) => emit({ type: "log", text }));
  let shown: Parameters<typeof hold.apply> | null = null; // the last facts and patterns the hold was applied to
  let waiting: ReadonlySet<string> = new Set(); // the open questions the hooks module marks it waits on
  let sent: Facts | null = null; // the facts last given to the link
  const said = new Set<string>(); // the pattern files' problems, logged once each, since they are read every pass
  const patternLog = (text: string) => {
    if (!said.has(text)) emit({ type: "log", text });
    said.add(text);
  };
  // What goes to the link: the reports the scan holds held, and the questions checked and marked.
  const outgoing = (facts: Facts, patterns: Pattern[] | null) => prepareQuestions(hold.apply(facts, patterns), patterns, waiting, patternLog);
  // The project of each subagent working in a worktree of another repo, from the latest read.
  let checkouts: Record<string, string> = {};
  // Whether a question got an answer, from the latest read, so one that closed says how.
  let answered = (_id: string) => false;

  const account = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, cwd);
  // The session's link, opened by the gate only while the office takes its home (approved.ts), which
  // it asks again before every reconnect, so a hello never goes on a list that changed or aged out.
  const gate = createSessionGate({
    approved,
    open: (home, mayConnect) =>
    createLink({
      url: server,
      emit,
      pairing,
      admit: mayConnect,
      // The list may have changed: it is read again, and the link opens afresh once it has.
      onNotWanted: () => {
        isUnwanted = detached;
        gate.notWanted();
      },
      // Another repo's files, commands and checkouts go only to a server that welcomed them, and
      // only for its office's repos; the link applies this at every send, on every connection.
      filter: (f, projects) => forOffice(candidates?.workspace ? inRepos(f) : f, projects, checkouts),
      answered: (id) => answered(id),
      // The owner released a withheld report: it goes to the link now, not on the next pass.
      // The owner answered a question from the floor: it goes to the hooks module.
      onMessage: (message) => {
        if (message.type === "request" && message.kind === "owner-answer") {
          const file = path.join(answersDir, `${randomUUID()}.json`);
          void fs
            .mkdir(answersDir, { recursive: true })
            .then(async () => {
              const relayed = await relayOwnerAnswer(message, { detached, facts: () => sent, file, emit, take: takeFile });
              link?.send(relayed.message);
              if (!relayed.gaveUp) return;
              // The hooks module's word may still come: a take that does follows as a late reply.
              const late = await lateTake(message.question, file, takeFile);
              if (late === null) return;
              emit({ type: "log", text: `the hooks module said late that it ${late ? "took" : "didn't take"} the owner's answer to ${message.question}` });
              if (late) link?.send({ type: "reply", v: PROTOCOL_VERSION, id: message.id, kind: "owner-answer", late: true });
            })
            // A word that came later still, or not at all, is left over: it goes.
            .finally(() => fs.rm(file, { force: true }).catch(() => {}))
            .catch((err: unknown) => emit({ type: "log", text: `couldn't pass the owner's answer on: ${String((err as Error)?.message ?? err)}` }));
          return;
        }
        if (message.type !== "release") return emit({ type: "log", text: `the office server sent a ${message.type} message, which this data layer doesn't handle yet` });
        void hold.release(message.id).then((released) => {
          if (released && shown) link?.update((sent = outgoing(...shown)));
        });
      },
      hello: {
        type: "hello",
        v: PROTOCOL_VERSION,
        source: "claude-code",
        account,
        machine: { name: machine },
        session: factsSession,
        project: home,
      },
    }),
  });

  do {
    const now = Date.now();
    const isFirstPass = passes++ === 0;
    // A detached data layer that stopped may have deleted this one's lock as it went.
    if (!detached) {
      if ((await lockHolder(lock)) !== process.pid) {
        const reason = await supersededBy();
        if (reason) {
          leave(reason);
          break;
        }
        await takeLock(lock, process.pid, alive, true, Date.now(), { extra: lockExtra }).catch(() => {});
      } else await refreshLock(lock, process.pid).catch(() => {});
    }
    config = await loadConfig(io, defaultsPath, userConfigPath).catch(() => config);
    if (!outdated && (outdated = await isOutdated())) {
      if (detached) {
        emit({ type: "log", text: "stopping: a newer version of the Isoplan plugin is installed, which the wake hook starts next" });
        break;
      }
      emit({ type: "updated" });
    }
    if (now - checkedAt >= config.updateCheckHours * 3600000) checkUpdate(config.updateCheckHours * 3600000);
    const gitOpts = { now, maxAgeMs: config.gitCacheSeconds * 1000 };
    const resolve = (dir: string) => git.resolve(dir, gitOpts);
    const projectOfRepo = (where: Where) => {
      const key = pathKey(where.commonDir);
      const hit = projects.get(key);
      if (hit && now - hit.at <= gitOpts.maxAgeMs) return hit.project;
      const project = projectOf(io.run, where, where.toplevel, machine);
      projects.set(key, { at: now, project });
      return project;
    };
    // Only a repo the office takes is reported (#91): for any other, no link opens and nothing is
    // sent, not even a hello; one already open closes. A workspace reports as the first of its repos
    // the office takes. It connects once the list has one.
    if (!candidates || now - candidatesAt > gitOpts.maxAgeMs) {
      const io2 = { resolve, projectOf: (where: Where | null, dir: string) => projectOf(io.run, where, dir, machine), stat: (f: string) => io.stat(f), listDir: (d: string) => io.listDir(d) };
      candidates = await candidatesOf(cwd, { ...io2, home: os.homedir(), workspaceRepos: config.workspaceRepos });
      candidatesAt = now;
    }
    const gated = await gate.home(candidates.projects);
    link = gate.current();
    if (gated.dormancy !== dormant) {
      if (gated.dormancy) emit({ type: "status", server, state: gated.dormancy, ...(candidates.workspace && { workspace: true as const }) });
      const what = candidates.workspace ? "none of the repos in this folder is" : `${candidates.projects[0]?.id ?? cwd} isn't`;
      if (gated.dormancy === "not-approved") emit({ type: "log", text: `${what} one the office at ${server} takes, so nothing of this session is sent` });
      if (gated.dormancy === "no-list") emit({ type: "log", text: `can't tell which repos ${server} takes (no list, or one older than ${config.approvedMaxAgeMinutes} minutes), so nothing of this session is sent` });
    }
    dormant = gated.dormancy;
    if (!gated.home) {
      // A detached one holds off, as for not-wanted, until the wake hook finds the list takes one of
      // these repos, or the hold ends; one with no list stops once that has lasted LINK_DOWN_MS.
      if (detached && gated.dormancy === "not-approved") {
        notApproved = candidates.projects.map((p) => p.id.toLowerCase());
        break;
      }
      const why = detached ? detachedStop({ now, lastActive: new Date(now).toISOString(), idleMinutes: config.idleMinutes, downSince }) : null;
      if (why) {
        emit({ type: "log", text: `stopping: ${why}` });
        break;
      }
      continue;
    }

    const read = await source.read({ sessionId, cwd, now, config, resolve, projectOf: projectOfRepo }).catch((err: unknown) => ({
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
        gate.drop();
        link = null;
        emit({ type: "status", server, state: "waiting" });
      }
      continue;
    }
    factsSession = read.facts.session.id;
    link = gate.link();

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

    checkouts = read.checkouts ?? {};
    answered = read.answered ?? answered;

    const patterns = await loadPatterns(modPatterns, ownerPatterns, patternLog).catch((err: unknown) => {
      patternLog(`couldn't read the secret patterns, so every report is withheld: ${String((err as Error)?.message ?? err)}`);
      return null;
    });
    waiting = detached ? new Set() : await waitsOf(waitsDir, facts);
    shown = [facts, patterns];
    link.update((sent = outgoing(facts, patterns)));
    const why = detached ? detachedStop({ now, lastActive: facts.session.lastActive, idleMinutes: config.idleMinutes, downSince }) : null;
    if (why) {
      emit({ type: "log", text: `stopping: ${why}` });
      break;
    }
    // A dormant session waits longer between passes: there is nothing to send, only the list to check.
  } while ((await wait(dormant ? DORMANT_MS : config.streamSeconds * 1000)) && !isUnwanted && (!detached || (await lockHolder(lock)) === process.pid) && !(await isOff()));

  link?.close();
  if (isUnwanted || isPlaceless) await holdOff(lock, process.pid, Date.now() + HOLD_OFF_MS).catch(() => {});
  else if (notApproved) await holdOff(lock, process.pid, Date.now() + HOLD_OFF_MS, { reason: "not-approved", projects: notApproved }).catch(() => {});
  else await releaseLock(lock, process.pid).catch(() => {});
  await logging;
  return 0;
}

/** A pair line as the log says it. */
const pairNote = (line: { server: string; url: string; expires: string }) =>
  `to report to ${line.server}, pair this machine: click ${line.url} on this computer and approve it in the office (it works until ${line.expires})`;

// Appends to a detached data layer's log, starting it over once it passes LOG_CAP_BYTES.
async function writeLog(file: string, text: string): Promise<void> {
  const size = (await fs.stat(file).catch(() => null))?.size ?? 0;
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (size > LOG_CAP_BYTES) await fs.writeFile(file, text);
  else await fs.appendFile(file, text);
}

// The open questions the hooks module marks it waits on, each in <dir>/<call id>.json.
async function waitsOf(dir: string, facts: Facts): Promise<Set<string>> {
  const out = new Set<string>();
  for (const q of facts.questions ?? []) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(q.id)) continue;
    const mark = await fs.readFile(path.join(dir, `${q.id}.json`), "utf8").then((text) => JSON.parse(text) as Partial<WaitMark>, () => null);
    if (mark?.question === q.id && mark.waiting === true) out.add(q.id);
  }
  return out;
}

// A JSON file the hooks module wrote, which goes once it is read; null while it isn't there, or
// doesn't parse yet (it may still be being written).
async function takeFile(file: string): Promise<string | null> {
  const text = await fs.readFile(file, "utf8").catch(() => null);
  try {
    JSON.parse(text ?? "");
  } catch {
    return null;
  }
  await fs.rm(file, { force: true }).catch(() => {});
  return text;
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
