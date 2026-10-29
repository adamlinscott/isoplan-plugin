// Starting the runner, from the wake hook, install and the plugin's data layer: unless one already
// holds the runner's lock, start the runner wake.json records, detached. Kept free of zod and the
// protocol so the wake hook starts fast.
//
// The supervisor writes `{ pid, code }` into the lock and keeps it fresh every LOCK_REFRESH_MS, so a
// lock not written for RUNNER_FRESH_MS is stale even when its pid is live: after a reboot the pid
// may name another process, which must neither count as the runner nor be killed. `code` names the
// runner.js it runs (its size and write time): a runner running older code than the recorded one
// (a plugin update copied a new one) is stopped and a new one started in its place.

import fs from "node:fs/promises";
import path from "node:path";
import { alive, readLock } from "../wake/lock.js";
import { wakeRecordPath } from "../wake/wake.js";

/** The runner's lock: `{ pid, code }` of the supervisor that holds it. */
export const runnerLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "lock.json");

export const LOCK_REFRESH_MS = 30000;
export const RUNNER_FRESH_MS = 3 * LOCK_REFRESH_MS;

/** What names a runner.js's code: its size and write time. Null when it is gone. */
export async function runnerCode(file: string): Promise<string | null> {
  const st = await fs.stat(file).catch(() => null);
  return st && st.isFile() ? `${st.size}-${Math.round(st.mtimeMs)}` : null;
}

/** The live runner's lock: a hold-off that hasn't ended, or a live pid that keeps it fresh. */
async function liveRunner(claudeDir: string, now: number, isAlive: (pid: number) => boolean) {
  const lock = await readLock(runnerLockPath(claudeDir));
  if (!lock) return null;
  if (lock.until !== null && lock.until > now) return { ...lock, isHoldOff: true };
  if (lock.pid !== null && isAlive(lock.pid) && now - lock.mtimeMs < RUNNER_FRESH_MS) return { ...lock, isHoldOff: false };
  return null;
}

export interface StartOptions {
  claudeDir: string;
  /** Starts `node <args>` in `cwd`, detached, and doesn't wait for it. */
  spawn(args: string[], cwd: string): void;
  isAlive?: (pid: number) => boolean;
  kill?: (pid: number) => void;
  now?: () => number;
}

/**
 * True when a runner was started. Nothing recorded, or a recorded runner that is gone, starts none;
 * a live one running the recorded code is left alone, and one running older code is replaced.
 */
export async function startRunner({ claudeDir, spawn, isAlive = alive, kill = (pid) => process.kill(pid), now = Date.now }: StartOptions): Promise<boolean> {
  let runner: unknown;
  try {
    runner = (JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")) as { runner?: unknown }).runner;
  } catch {
    return false;
  }
  if (typeof runner !== "string") return false;
  const code = await runnerCode(runner);
  if (!code) return false;
  const live = await liveRunner(claudeDir, now(), isAlive);
  if (live && (live.isHoldOff || live.extra.code === code)) return false;
  if (live) await stopRunner(claudeDir, { isAlive, kill, now });
  // The config folder goes with it, so the runner uses the one its starter found, whatever its environment says.
  spawn([runner, "--claude-dir", claudeDir], claudeDir);
  return true;
}

/**
 * Ends the running runner, for uninstall and updates: its worker and forks follow once its
 * supervisor has gone. True when one was running. A stale lock's pid is never killed.
 */
export async function stopRunner(claudeDir: string, { isAlive = alive, kill = (pid: number) => process.kill(pid), now = Date.now }: Omit<StartOptions, "claudeDir" | "spawn"> = {}): Promise<boolean> {
  const live = await liveRunner(claudeDir, now(), isAlive);
  if (!live || live.isHoldOff || live.pid === null) return false;
  try {
    kill(live.pid);
  } catch {
    // Gone already.
  }
  await fs.rm(runnerLockPath(claudeDir), { force: true });
  return true;
}
