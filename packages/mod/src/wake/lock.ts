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

interface LockBody {
  /** The pid it names, or null for none (a hold-off names 0). */
  pid: number | null;
  /** A hold-off's end, in ms since the epoch. */
  until: number | null;
}

async function readLock(file: string): Promise<LockBody | null> {
  try {
    const { pid, until } = JSON.parse(await fs.readFile(file, "utf8")) as { pid?: unknown; until?: unknown };
    return { pid: Number.isSafeInteger(pid) && (pid as number) > 0 ? (pid as number) : null, until: typeof until === "number" ? until : null };
  } catch {
    return null;
  }
}

/** The pid the lock names, or null when there is none or it can't be read. */
export async function lockHolder(file: string): Promise<number | null> {
  return (await readLock(file))?.pid ?? null;
}

/** Whether the session is held: by a live pid, or by a hold-off that hasn't ended. */
export async function isHeld(file: string, now = Date.now(), isAlive = alive): Promise<boolean> {
  const lock = await readLock(file);
  return !!lock && ((lock.until !== null && lock.until > now) || (lock.pid !== null && isAlive(lock.pid)));
}

/**
 * Takes the lock for `pid`; false when the session is held (`isHeld`). With `force` (the plugin's
 * data layer) it is taken regardless: a detached one holding it sees that and steps aside.
 */
export async function takeLock(file: string, pid: number, isAlive = alive, force = false, now = Date.now()): Promise<boolean> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = JSON.stringify({ pid });
  try {
    // A new lock is created exclusively, so of two data layers starting at once only one gets it.
    await fs.writeFile(file, body, { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  if (!force && (await lockHolder(file)) !== pid && (await isHeld(file, now, isAlive))) return false;
  await fs.writeFile(file, body);
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
