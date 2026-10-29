// One data layer per session: <claude dir>/isoplan/live/<session id>.json holds `{ pid }` of the
// one reporting it. Every data layer takes it, the plugin's and the detached one the wake hook
// starts; one that finds another live pid there exits, except the plugin's, which takes it over
// from a detached one (that one notices on its next pass and exits). A lock whose pid has gone is
// stale and is taken over. The wake hook reads it to see whether the session is already reported.
//
// A detached data layer that stops for a reason the next turn won't change (the server doesn't want
// the project, git can't place the folder) leaves `{ pid: 0, until }` instead: until then the
// session counts as held, so the wake hook doesn't start another on every turn. The plugin's data
// layer still takes it.

import fs from "node:fs/promises";
import path from "node:path";

export const lockPath = (claudeDir: string, sessionId: string) => path.join(claudeDir, "isoplan", "live", `${sessionId}.json`);

// How long a hold-off keeps the wake hook from starting another data layer.
export const HOLD_OFF_MS = 3600000;

export interface LockBody {
  /** The pid it names, or null for none (a hold-off names 0). */
  pid: number | null;
  /** A hold-off's end, in ms since the epoch. */
  until: number | null;
  /** The file's last write, which a holder that keeps it fresh (`refreshLock`) moves. */
  mtimeMs: number;
  /** Anything else the holder wrote into it. */
  extra: Record<string, unknown>;
}

/**
 * How a lock counts as held. `freshMs` is for a holder that keeps its lock fresh: a lock not
 * written for that long counts as stale even if its pid is live, since the pid may have been
 * reused by another process (after a reboot, say).
 */
export interface HoldRule {
  isAlive?: (pid: number) => boolean;
  freshMs?: number;
}

async function readText(file: string): Promise<{ text: string; mtimeMs: number } | null> {
  try {
    const [text, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    return { text, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

function parseLock(text: string, mtimeMs: number): LockBody | null {
  try {
    const { pid, until, ...extra } = JSON.parse(text) as { pid?: unknown; until?: unknown };
    return { pid: Number.isSafeInteger(pid) && (pid as number) > 0 ? (pid as number) : null, until: typeof until === "number" ? until : null, mtimeMs, extra };
  } catch {
    return null;
  }
}

export async function readLock(file: string): Promise<LockBody | null> {
  const r = await readText(file);
  return r && parseLock(r.text, r.mtimeMs);
}

/** The pid the lock names, or null when there is none or it can't be read. */
export async function lockHolder(file: string): Promise<number | null> {
  return (await readLock(file))?.pid ?? null;
}

const held = (lock: LockBody | null, now: number, { isAlive = alive, freshMs }: HoldRule) =>
  !!lock && ((lock.until !== null && lock.until > now) || (lock.pid !== null && isAlive(lock.pid) && (freshMs === undefined || now - lock.mtimeMs < freshMs)));

/** Whether the lock is held: by a live pid (kept fresh, under `freshMs`), or by a hold-off that hasn't ended. */
export async function isHeld(file: string, now = Date.now(), isAlive = alive, rule: Omit<HoldRule, "isAlive"> = {}): Promise<boolean> {
  return held(await readLock(file), now, { ...rule, isAlive });
}

/**
 * Takes the lock for `pid`; false when it is held (`isHeld`). With `force` (the plugin's data
 * layer) it is taken regardless: a detached one holding it sees that and steps aside. `extra` is
 * written into the lock beside the pid.
 *
 * A new lock is created exclusively, so of two takers at once only one gets it. A stale one is
 * moved aside by rename, which only one taker can do to the same file, and the taker checks that
 * what it moved is the lock it judged stale: one that moved another taker's new lock instead puts
 * it back and loses.
 */
export async function takeLock(file: string, pid: number, isAlive = alive, force = false, now = Date.now(), { freshMs, extra = {} }: { freshMs?: number; extra?: Record<string, unknown> } = {}): Promise<boolean> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = JSON.stringify({ pid, ...extra });
  for (let tries = 0; tries < 5; tries++) {
    try {
      await fs.writeFile(file, body, { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const seen = await readText(file);
    if (!seen) continue; // gone since: try to create it again
    const lock = parseLock(seen.text, seen.mtimeMs);
    if (!force && lock?.pid !== pid && held(lock, now, { isAlive, freshMs })) return false;
    const aside = `${file}.${pid}-${Math.random().toString(36).slice(2)}`;
    try {
      await fs.rename(file, aside);
    } catch (err) {
      // Another taker moved it first (or, on Windows, a reader has it open): look again.
      if (["ENOENT", "EPERM", "EBUSY", "EACCES"].includes((err as NodeJS.ErrnoException).code ?? "")) continue;
      throw err;
    }
    const moved = await fs.readFile(aside, "utf8").catch(() => null);
    if (moved !== seen.text) {
      // That was another taker's new lock: it goes back, unless a newer one is there already.
      await fs.link(aside, file).catch(() => {});
      await fs.rm(aside, { force: true });
      if (!force) return false;
      continue;
    }
    await fs.rm(aside, { force: true });
  }
  return false;
}

/** Marks the lock `pid` holds as fresh; false when another has taken it. */
export async function refreshLock(file: string, pid: number, now = Date.now()): Promise<boolean> {
  if ((await lockHolder(file)) !== pid) return false;
  const t = new Date(now);
  await fs.utimes(file, t, t);
  return true;
}

/** Removes the lock if it still names `pid`. */
export async function releaseLock(file: string, pid: number): Promise<void> {
  if ((await lockHolder(file)) === pid) await fs.rm(file, { force: true });
}

/** Turns the lock `pid` holds into a hold-off until `until`; one another has taken is left. */
export async function holdOff(file: string, pid: number, until: number): Promise<void> {
  if ((await lockHolder(file)) === pid) await fs.writeFile(file, JSON.stringify({ pid: 0, until }));
}

// Signal 0 tests for a process without touching it: ESRCH means it is gone, EPERM that it exists.
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
