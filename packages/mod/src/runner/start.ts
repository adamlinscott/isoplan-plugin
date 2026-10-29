// Starting the runner, from the wake hook, install and the plugin's data layer: unless one already
// holds the runner's lock, start the runner wake.json records, detached. Kept free of zod and the
// protocol so the wake hook starts fast.

import fs from "node:fs/promises";
import path from "node:path";
import { alive, isHeld, lockHolder } from "../wake/lock.js";
import { wakeRecordPath } from "../wake/wake.js";

/** The runner's lock: `{ pid }` of the supervisor that holds it. */
export const runnerLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "lock.json");

export interface StartOptions {
  claudeDir: string;
  /** Starts `node <args>` in `cwd`, detached, and doesn't wait for it. */
  spawn(args: string[], cwd: string): void;
  isAlive?: (pid: number) => boolean;
}

/** True when a runner was started. Nothing recorded, or a recorded runner that is gone, starts none. */
export async function startRunner({ claudeDir, spawn, isAlive = alive }: StartOptions): Promise<boolean> {
  if (await isHeld(runnerLockPath(claudeDir), Date.now(), isAlive)) return false;
  let runner: unknown;
  try {
    runner = (JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")) as { runner?: unknown }).runner;
  } catch {
    return false;
  }
  if (typeof runner !== "string" || !(await fs.stat(runner).then((s) => s.isFile(), () => false))) return false;
  spawn([runner], claudeDir);
  return true;
}

/** Ends the running runner, for uninstall: its worker follows once its supervisor has gone. True when one was running. */
export async function stopRunner(claudeDir: string, kill: (pid: number) => void = (pid) => process.kill(pid)): Promise<boolean> {
  const pid = await lockHolder(runnerLockPath(claudeDir));
  if (pid === null || !alive(pid)) return false;
  kill(pid);
  await fs.rm(runnerLockPath(claudeDir), { force: true });
  return true;
}
