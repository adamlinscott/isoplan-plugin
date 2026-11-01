// What the wake hook does with one hook call: start a detached data layer for the session unless
// one already reports it. Kept free of zod and the protocol so the hook starts fast.

import fs from "node:fs/promises";
import path from "node:path";
import { approvedFiles, DEFAULT_MAX_AGE_MINUTES, freshRepos, readApproved } from "../data-layer/approved-file.js";
import { newestDataLayer } from "../install/state.js";
import { loadConfig, officesOf } from "../data-layer/config.js";
import { alive, isHeld, lockPath, notWantedPath, readLock } from "./lock.js";

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
  // A data layer that has gone (the plugin was removed), or an uninstalled hook, leaves it doing nothing.
  const { dataLayer: recorded } = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")) as { dataLayer?: unknown };
  if (typeof recorded !== "string") return false;
  if (await isHeld(lock, Date.now(), isAlive)) {
    // A data layer that held off because no office took any of its repos (#91) is started again as
    // soon as this machine's copy of one office's list takes one; it checks the list itself. The
    // offices that didn't want the session go in a file of their own, for the new one to leave alone (#105).
    const notWanted = await nowApproved(claudeDir, lock, await configuredServers(claudeDir, recorded));
    if (!notWanted) return false;
    await fs.rm(lock, { force: true });
    if (Object.keys(notWanted).length) await fs.writeFile(notWantedPath(claudeDir, sessionId), JSON.stringify(notWanted));
  }

  // Claude Code may have installed a newer version since: that one reports, until a session that
  // loads it records itself.
  const dataLayer = plugins ? await newestDataLayer(plugins, recorded, project).catch(() => recorded) : recorded;
  if (!(await fs.stat(dataLayer).then((s) => s.isFile(), () => false))) return false;
  spawn([dataLayer, "--session", sessionId, "--cwd", cwd, ...(project ? ["--project", project] : []), "--detached"], cwd);
  return true;
}

/** The office servers config.json names now, by the defaults beside the recorded data layer; none when it can't be read. */
async function configuredServers(claudeDir: string, dataLayer: string): Promise<string[]> {
  const io = { stat: (p: string) => fs.stat(p).then((s) => ({ isDir: s.isDirectory(), mtimeMs: s.mtimeMs, size: s.size }), () => null), read: (p: string) => fs.readFile(p, "utf8") };
  const config = await loadConfig(io, path.join(path.dirname(path.dirname(dataLayer)), "config.json"), path.join(claudeDir, "isoplan", "config.json")).catch(() => null);
  return config ? officesOf(config).map((o) => o.server) : [];
}

/**
 * Whether `lock` is a hold-off for repos no office took, one of which a fresh copy of an office's
 * list now has: then the offices that didn't want the session, each until when, else null. Only the
 * lists of the offices the data layer reported to, or that config.json names now (`configured`),
 * count (a folder left by a server taken out of config.json doesn't), and never one of an office
 * that didn't want the session.
 */
async function nowApproved(claudeDir: string, lock: string, configured: readonly string[]): Promise<Record<string, number> | null> {
  const held = await readLock(lock);
  const { projects, offices, notWanted: said } = held?.extra ?? {};
  if (held?.pid !== null || held.extra.reason !== "not-approved" || !Array.isArray(projects)) return null;
  const now = Date.now();
  const notWanted = Object.fromEntries(Object.entries(said && typeof said === "object" ? said : {}).filter(([, until]) => typeof until === "number" && until > now)) as Record<string, number>;
  for (const file of await approvedFiles(claudeDir)) {
    const copy = await readApproved(file);
    if (!copy || (Array.isArray(offices) && !offices.includes(copy.server) && !configured.includes(copy.server)) || copy.server in notWanted) continue;
    const repos = freshRepos(copy, DEFAULT_MAX_AGE_MINUTES * 60000, now);
    if (repos && projects.some((p) => typeof p === "string" && repos.has(p))) return notWanted;
  }
  return null;
}
