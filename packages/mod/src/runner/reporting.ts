// The runner reports every Claude Code session on the machine that no hooks module reports (ADR
// 0007 step 1): headless ones, those the runner drives from the floor, and sessions without the
// plugin. It looks at <claude dir>/projects every `streamSeconds`, and for each top-level transcript
// written within `idleMinutes` (on its first look, within `lightsOffHours`, so a runner just started
// fills the office back in) it reports the session in its own process (report-session.ts), one link
// per session to each office, as a data layer would. Not while the session's lock in
// <claude dir>/isoplan/live names another live process that keeps it fresh (the plugin's data layer,
// for its hooks module), while the transcript names no folder yet or the folder has gone, or while
// Claude Code lists the plugin as uninstalled or disabled for the folder. A lock counts as fresh for
// three of its holder's slowest passes (lockFreshMs).
//
// A session it stopped reporting (quiet past `idleMinutes`, nothing to report, its link down five
// minutes, or the plugin's data layer took its lock over), or that it found the plugin's data layer
// reporting, is reported again once its transcript moves: so a session with the plugin that closes
// goes unreachable, as it did before, and one whose plugin data layer crashed is taken at its next
// turn. One that ended with a hold-off (no office wants its project, git can't place its folder, or
// no office takes its repo) isn't reported again before the hold-off ends; one no office took is,
// as its transcript moves, once a fresh copy of one office's list takes one of its repos: only of an
// office it reported to or that config.json names now, never of one that didn't want it. The
// offices that didn't want it are left alone, each until its own hold-off ends. The hold-offs live
// here, in the runner's memory: a runner started again asks each office afresh.

import fs from "node:fs/promises";
import path from "node:path";
import { approvedFiles, freshRepos, readApproved } from "../data-layer/approved-file.js";
import { officesOf, type Config } from "../data-layer/config.js";
import type { NodeIo } from "../data-layer/io.js";
import { lockFreshMs, type Ended } from "../data-layer/report-session.js";
import { cwdOf } from "../sweep/find.js";
import { alive, lockPath, readLock } from "../wake/lock.js";

// On its first look, the gap between starting two sessions that are already quiet, so each is
// mostly reported before the next starts; those still at work start at once.
export const GAP_MS = 250;

/** One session for `report`: it reports it until `closed` settles, or until it should stop. */
export interface ToReport {
  sessionId: string;
  cwd: string;
  /** The offices that didn't want it, each until when. */
  notWanted: Record<string, number>;
  closed: Promise<void>;
}

export interface ReportingOptions {
  claudeDir: string;
  io: NodeIo;
  /** config.json as it is now. */
  config: () => Promise<Config>;
  /** Reports one session in this process (reportSession, `by: "runner"`). */
  report: (session: ToReport) => Promise<Ended>;
  /** Whether Claude Code lists the plugin as uninstalled or disabled for a folder. */
  isOff: (folder: string) => Promise<boolean>;
  log: (text: string) => void;
  isAlive?: (pid: number) => boolean;
  /** This process's pid, which its sessions' locks name. */
  pid?: number;
  gapMs?: number;
}

export interface Reporting {
  /** Whether a session is held off now (see above), so the runner answers no question for it. */
  heldOff(sessionId: string): boolean;
  /** The sessions it reports now. */
  reporting(): string[];
  /** Looks once (it looks by itself every `streamSeconds`). */
  look(): Promise<void>;
  /** Stops reporting every session, and looking. */
  stop(): Promise<void>;
}

interface Seen {
  file: string;
  mtimeMs: number;
  size: number;
  cwd: string | null;
  running: { stop: () => void; done: Promise<void> } | null;
  /** Waiting its turn on the first look. */
  queued: boolean;
  /** The transcript's write time as it last ended, or was left; it is reported again once the transcript is written after that. */
  endedAt: number | null;
  holdOff: Ended["holdOff"] | null;
  notWanted: Record<string, number>;
}

export function watchSessions(o: ReportingOptions): Reporting {
  const { claudeDir, io, isAlive = alive, pid = process.pid, gapMs = GAP_MS } = o;
  const projectsDir = path.join(claudeDir, "projects");
  const seen = new Map<string, Seen>();
  let first = true;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let said = ""; // a lasting problem is logged once

  const start = (id: string, s: Seen, cwd: string) => {
    let close = () => {};
    const closed = new Promise<void>((resolve) => (close = resolve));
    const now = Date.now();
    const notWanted = Object.fromEntries(Object.entries(s.notWanted).filter(([, until]) => until > now));
    const done = o
      .report({ sessionId: id, cwd, notWanted, closed })
      .then(
        (ended) => {
          if (ended.holdOff) {
            s.holdOff = ended.holdOff;
            s.notWanted = ended.holdOff.notWanted;
          }
        },
        (err: unknown) => o.log(`couldn't report session ${id}: ${String((err as Error)?.stack ?? err)}`),
      )
      .finally(async () => {
        // The write time first: a look between the two would start it again at once.
        s.endedAt = (await io.stat(s.file))?.mtimeMs ?? s.mtimeMs;
        s.running = null;
      });
    s.running = { stop: close, done };
  };

  /** Whether a fresh copy of an office's list takes one of the repos a hold-off names (see above). */
  const nowTaken = async (holdOff: NonNullable<Ended["holdOff"]>, config: Config) => {
    const now = Date.now();
    const configured = officesOf(config).map((office) => office.server);
    for (const file of await approvedFiles(claudeDir)) {
      const copy = await readApproved(file);
      if (!copy || (!holdOff.offices.includes(copy.server) && !configured.includes(copy.server)) || (holdOff.notWanted[copy.server] ?? 0) > now) continue;
      const repos = freshRepos(copy, config.approvedMaxAgeMinutes * 60000, now);
      if (repos && holdOff.projects!.some((p) => repos.has(p))) return true;
    }
    return false;
  };

  /** Whether the session's lock names another live process that keeps it fresh. */
  const heldByAnother = async (id: string, now: number, config: Config) => {
    const lock = await readLock(lockPath(claudeDir, id));
    return !!lock?.pid && lock.pid !== pid && isAlive(lock.pid) && now - lock.mtimeMs < lockFreshMs(config);
  };

  const look = async () => {
    const config = await o.config();
    const now = Date.now();
    const windowMs = Math.max(config.idleMinutes * 60000, first ? config.lightsOffHours * 3600000 : 0);
    const quiet: [string, Seen, string][] = [];
    for (const dir of await io.listDir(projectsDir)) {
      if (!dir.isDir) continue;
      for (const entry of await io.listDir(path.join(projectsDir, dir.name))) {
        const id = entry.name.slice(0, -".jsonl".length);
        // The id names a file in the live folder, so it must be a plain name.
        if (entry.isDir || !entry.name.endsWith(".jsonl") || !/^[\w-]+$/.test(id)) continue;
        const file = path.join(projectsDir, dir.name, entry.name);
        const st = await io.stat(file);
        if (!st) continue;
        let s = seen.get(id);
        if (!s) seen.set(id, (s = { file, mtimeMs: st.mtimeMs, size: st.size, cwd: null, running: null, queued: false, endedAt: null, holdOff: null, notWanted: {} }));
        Object.assign(s, { file, mtimeMs: st.mtimeMs, size: st.size });
        if (s.running || s.queued || st.mtimeMs < now - windowMs || (s.endedAt !== null && st.mtimeMs <= s.endedAt)) continue;
        if (s.holdOff) {
          const ends = s.holdOff.until <= now || (!!s.holdOff.projects && (await nowTaken(s.holdOff, config)));
          if (!ends) {
            s.endedAt = st.mtimeMs; // looked at again as the transcript moves
            continue;
          }
          s.holdOff = null;
        }
        if (await heldByAnother(id, now, config)) {
          s.endedAt = st.mtimeMs;
          continue;
        }
        s.cwd ??= await cwdOf(io, file, st.size);
        if (!s.cwd) continue; // nothing in it names a folder yet: looked at again next time
        if (!(await fs.stat(s.cwd).then((d) => d.isDirectory(), () => false)) || (await o.isOff(s.cwd))) {
          s.endedAt = st.mtimeMs;
          continue;
        }
        if (first && st.mtimeMs < now - config.idleMinutes * 60000) quiet.push([id, s, s.cwd]);
        else start(id, s, s.cwd);
      }
    }
    if (first && quiet.length) {
      for (const [, s] of quiet) s.queued = true;
      void (async () => {
        for (const [id, s, cwd] of quiet) {
          await new Promise((r) => setTimeout(r, gapMs));
          s.queued = false;
          if (!stopped && !s.running) start(id, s, cwd);
        }
      })();
    }
    first = false;
  };

  // One look at a time: a look asked for while one is under way is that one.
  let looking: Promise<void> | null = null;
  const lookOnce = () => (looking ??= look().finally(() => (looking = null)));
  const next = async () => {
    let seconds = 1;
    try {
      await lookOnce();
      seconds = (await o.config()).streamSeconds;
      said = "";
    } catch (err) {
      const text = `couldn't look for this machine's sessions to report: ${String((err as Error)?.message ?? err)}`;
      if (text !== said) o.log(text);
      said = text;
    }
    if (stopped) return;
    timer = setTimeout(() => void next(), seconds * 1000);
    timer.unref?.();
  };
  void next();

  return {
    heldOff: (id) => {
      const holdOff = seen.get(id)?.holdOff;
      return !!holdOff && holdOff.until > Date.now();
    },
    reporting: () => [...seen].filter(([, s]) => s.running).map(([id]) => id),
    look: lookOnce,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      const running = [...seen.values()].flatMap((s) => s.running ?? []);
      for (const r of running) r.stop();
      await Promise.all(running.map((r) => r.done));
    },
  };
}
