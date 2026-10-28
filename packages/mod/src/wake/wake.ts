// What the wake hook does with one hook call: start a detached data layer for the session unless
// one already reports it. Kept free of zod and the protocol so the hook starts fast.

import fs from "node:fs/promises";
import path from "node:path";
import { alive, isHeld, lockPath } from "./lock.js";

export interface WakeOptions {
  /** Claude Code's config folder, which holds isoplan/wake.json and the session locks. */
  claudeDir: string;
  /** Starts `node <args>` in `cwd`, detached, and doesn't wait for it. */
  spawn(args: string[], cwd: string): void;
  isAlive?: (pid: number) => boolean;
}

/** The record install writes beside wake.mjs: where the current data layer is, or that it was uninstalled. */
export type WakeRecord = { dataLayer: string } | { disabled: true };

export const wakeRecordPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "wake.json");

/**
 * `input` is the hook's stdin JSON (`session_id`, `cwd`, ...). True when a data layer was started.
 * Anything missing or unreadable means nothing to do.
 */
export async function wake(input: string, { claudeDir, spawn, isAlive = alive }: WakeOptions): Promise<boolean> {
  const { session_id: sessionId, cwd } = JSON.parse(input) as { session_id?: unknown; cwd?: unknown };
  // The id names a file in the live folder, so it must be a plain name.
  if (typeof sessionId !== "string" || !/^[\w-]+$/.test(sessionId) || typeof cwd !== "string" || !cwd) return false;
  if (await isHeld(lockPath(claudeDir, sessionId), Date.now(), isAlive)) return false;

  // A data layer that has gone (the plugin was removed), or an uninstalled hook, leaves it doing nothing.
  const { dataLayer } = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")) as { dataLayer?: unknown };
  if (typeof dataLayer !== "string" || !(await fs.stat(dataLayer).then((s) => s.isFile(), () => false))) return false;
  spawn([dataLayer, "--session", sessionId, "--cwd", cwd, "--detached"], cwd);
  return true;
}
