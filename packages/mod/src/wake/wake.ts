// What the wake hook does with one hook call: start a detached data layer for the session unless
// one already reports it. Kept free of zod and the protocol so the hook starts fast.

import fs from "node:fs/promises";
import path from "node:path";
import { approvedPath, DEFAULT_MAX_AGE_MINUTES, freshRepos, readApproved } from "../data-layer/approved-file.js";
import { newestDataLayer } from "../install/state.js";
import { alive, isHeld, lockPath, readLock } from "./lock.js";

export interface WakeOptions {
  /** Claude Code's config folder, which holds isoplan/wake.json and the session locks. */
  claudeDir: string;
  /** Starts `node <args>` in `cwd`, detached, and doesn't wait for it. */
  spawn(args: string[], cwd: string): void;
  isAlive?: (pid: number) => boolean;
  /** The session's project folder ($CLAUDE_PROJECT_DIR), passed on to the data layer for its settings. */
  project?: string;
  /** Claude Code's plugins folder (state.ts `pluginsDir`): an update there since the data layer was recorded starts the newer one. */
  plugins?: string;
}

/** The record install writes beside wake.mjs: where the current data layer and runner are, or that it was uninstalled. */
export type WakeRecord = { dataLayer: string; runner?: string } | { disabled: true };

export const wakeRecordPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "wake.json");

/**
 * `input` is the hook's stdin JSON (`session_id`, `cwd`, ...). True when a data layer was started.
 * Anything missing or unreadable means nothing to do.
 */
export async function wake(input: string, { claudeDir, spawn, isAlive = alive, project, plugins }: WakeOptions): Promise<boolean> {
  const { session_id: sessionId, cwd } = JSON.parse(input) as { session_id?: unknown; cwd?: unknown };
  // The id names a file in the live folder, so it must be a plain name.
  if (typeof sessionId !== "string" || !/^[\w-]+$/.test(sessionId) || typeof cwd !== "string" || !cwd) return false;
  const lock = lockPath(claudeDir, sessionId);
  if (await isHeld(lock, Date.now(), isAlive)) {
    // A data layer that held off because the office took none of its repos (#91) is started again
    // as soon as this machine's copy of the list takes one; it checks the list itself.
    if (!(await nowApproved(claudeDir, lock))) return false;
    await fs.rm(lock, { force: true });
  }

  // A data layer that has gone (the plugin was removed), or an uninstalled hook, leaves it doing nothing.
  const { dataLayer: recorded } = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")) as { dataLayer?: unknown };
  if (typeof recorded !== "string") return false;
  // Claude Code may have installed a newer version since: that one reports, until a session that
  // loads it records itself.
  const dataLayer = plugins ? await newestDataLayer(plugins, recorded, project).catch(() => recorded) : recorded;
  if (!(await fs.stat(dataLayer).then((s) => s.isFile(), () => false))) return false;
  spawn([dataLayer, "--session", sessionId, "--cwd", cwd, ...(project ? ["--project", project] : []), "--detached"], cwd);
  return true;
}

/** Whether `lock` is a hold-off for repos the office didn't take, one of which a fresh copy of its list now has. */
async function nowApproved(claudeDir: string, lock: string): Promise<boolean> {
  const held = await readLock(lock);
  const projects = held?.extra.projects;
  if (held?.pid !== null || held.extra.reason !== "not-approved" || !Array.isArray(projects)) return false;
  const repos = freshRepos(await readApproved(approvedPath(claudeDir)), DEFAULT_MAX_AGE_MINUTES * 60000, Date.now());
  return !!repos && projects.some((p) => typeof p === "string" && repos.has(p));
}
