// Who is reporting and from which project, for the hello (#2, #15).
//
// The person is their Claude account: `oauthAccount.accountUuid` in ~/.claude.json (in
// $CLAUDE_CONFIG_DIR when that is set), the same on each of their machines, named by its
// `displayName` (never the email). Without one (an API key, a gateway) the install's own `userID`,
// so one person on two machines shows as two humans; then git's user.name, as v1 did.
// .credentials.json is never read.

import { projectId, type HelloMessage, type Project } from "@isoplan/protocol";
import type { MaybePromise, Run, Where } from "./git.js";
import { dirname, normalize } from "./git.js";

export type Account = HelloMessage["account"];

export interface IdentityIo {
  /** The whole file, or null when it is missing or can't be read. */
  readText(path: string): MaybePromise<string | null>;
  run: Run | null;
}

export { claudePaths } from "./claude-paths.js";

/** `claudeJson` is the path of .claude.json (`claudePaths`); git runs in `cwd`. */
export async function accountOf(io: IdentityIo, claudeJson: string, cwd: string): Promise<Account> {
  const config = asObject(parseJson(await io.readText(claudeJson)));
  const oauth = asObject(config.oauthAccount);
  const gitName = async () => {
    const r = io.run ? await Promise.resolve(io.run(["git", "config", "user.name"], { cwd })).catch(() => null) : null;
    return r && r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  };
  if (nonEmpty(oauth.accountUuid)) {
    return { id: `claude:${oauth.accountUuid}`, name: nonEmpty(oauth.displayName) ? oauth.displayName : ((await gitName()) ?? "") };
  }
  const name = await gitName();
  if (nonEmpty(config.userID)) return { id: `claude-install:${config.userID}`, name: name ?? "" };
  return { id: `git:${name ?? "unknown"}`, name: name ?? "" };
}

/**
 * The project the session's folder belongs to: its git remote's, or for a repo with no usable
 * remote, the main checkout's folder on this machine (so every worktree of one repo is one
 * project). A folder git can't place is its own local project. On a file system that ignores case
 * (Windows, macOS) a local project's id is lower-cased, so one folder reached in two spellings is
 * one project, in the hello and in every edit alike.
 */
export async function projectOf(run: Run | null, where: Where | null, cwd: string, machine: string, caseless = process.platform === "win32" || process.platform === "darwin"): Promise<Project> {
  let remote: string | null = null;
  if (run && where) {
    const r = await Promise.resolve(run(["git", "remote", "get-url", "origin"], { cwd: where.toplevel })).catch(() => null);
    if (r && r.code === 0 && r.stdout.trim()) remote = r.stdout.trim();
  }
  const root = !where ? normalize(cwd) : /\/\.git$/.test(where.commonDir) ? dirname(where.commonDir) : where.toplevel;
  const project = projectId(remote, { machine, root });
  return caseless && project.id.startsWith("local:") ? { ...project, id: project.id.toLowerCase() } : project;
}

function parseJson(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
