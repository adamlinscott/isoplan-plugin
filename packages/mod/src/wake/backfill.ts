// The backfill: the wake hook sees a session only on its next turn, so when the hook is installed
// every session written inside the window gets a detached data layer at once, as the wake hook
// would start. One that is busy stays and reports; a quiet one reports once and stops, and the
// server keeps it, unreachable, until its lights go off.

import fs from "node:fs/promises";
import type { Found } from "../sweep/find.js";
import { alive, isHeld, lockPath } from "./lock.js";

// The gap between two starts, so a quiet session's data layer is mostly done before the next starts.
export const GAP_MS = 250;

export interface BackfillOptions {
  claudeDir: string;
  dataLayer: string;
  /** Starts `node <args>` in `cwd`, detached, and doesn't wait for it. */
  spawn(args: string[], cwd: string): void;
  isAlive?: (pid: number) => boolean;
  pause?: (ms: number) => Promise<void>;
}

/** Starts a data layer for each session no one reports whose folder is still there; returns how many. */
export async function backfill(found: Found[], { claudeDir, dataLayer, spawn, isAlive = alive, pause = (ms) => new Promise((r) => setTimeout(r, ms)) }: BackfillOptions): Promise<number> {
  let started = 0;
  for (const { id, cwd } of found) {
    if (!/^[\w-]+$/.test(id) || (await isHeld(lockPath(claudeDir, id), Date.now(), isAlive))) continue;
    if (!(await fs.stat(cwd).then((s) => s.isDirectory(), () => false))) continue;
    if (started++) await pause(GAP_MS);
    spawn([dataLayer, "--session", id, "--cwd", cwd, "--detached"], cwd);
  }
  return started;
}
