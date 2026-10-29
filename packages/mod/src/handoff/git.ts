// The git side of a handoff (#48), for the runner's brief and the /isoplan:handover command.
//
// Sending: the session's tracked changes go in one work-in-progress commit on isoplan/handoff/<id>,
// made from the current branch's HEAD, and only that branch is pushed. The commit is built in a
// temporary index (a copy of the real one, then `git add -u`), so the session's work tree, index and
// branch are never touched: the sender's agent may be working in them. Untracked files aren't
// committed; the brief names them (`untracked`), and files .gitignore matches are never listed. The
// current branch and the default branch are never pushed, so a handoff can't trigger a deploy.
//
// Every git command runs without a prompt (no terminal, credential manager or ssh passphrase
// prompt) and under a timeout, and ends with its whole process tree when that runs out.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectId, type HandoffRepo } from "@isoplan/protocol";
import { killTree } from "../runner/claude.js";
import { pathKey } from "../data-layer/git.js";

/** A new handoff id: short, and safe in a branch name. */
export const newHandoffId = () => randomBytes(5).toString("hex");

/** The handoff's branch. */
export const handoffBranch = (id: string) => `isoplan/handoff/${id}`;

/** Why git couldn't hand the work over, as a kind the server is told and a detail for the local log. */
export type GitFailure = "not-a-repo" | "no-commit" | "no-remote" | "timed-out" | "rejected" | "failed";

export class HandoffGitError extends Error {
  constructor(
    readonly kind: GitFailure,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** What the server is told for each kind of git failure. */
export const GIT_FAILED: Record<GitFailure, string> = {
  "not-a-repo": "the session's folder isn't in a git repo",
  "no-commit": "the session's repo has no commit to hand over from",
  "no-remote": "the session's repo has no remote to push the handoff's branch to",
  "timed-out": "git took too long to push the handoff's branch",
  rejected: "the remote rejected the handoff's branch",
  failed: "git couldn't push the handoff's branch",
};

export interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs git with `args` in `cwd`; never throws, and settles by the timeout at the latest. */
export type RunGit = (args: string[], opts: { cwd: string; env?: Record<string, string>; timeoutMs: number }) => Promise<GitResult>;

// The end of git's own output kept for a failure's detail.
const OUTPUT_CHARS = 2000;

/** The environment git runs with: no terminal prompt, no credential manager window, no ssh prompt. */
export function noPromptEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) out[key] = value;
  out.GIT_TERMINAL_PROMPT = "0";
  out.GCM_INTERACTIVE = "never";
  // An ssh of the person's own choosing (their GIT_SSH_COMMAND, or core.sshCommand, which env would
  // override) is left alone.
  if (!out.GIT_SSH_COMMAND && !out.GIT_SSH) out.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  return out;
}

export function createRunGit(baseEnv: Record<string, string | undefined> = process.env): RunGit {
  return (args, { cwd, env, timeoutMs }) =>
    new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const child = spawn("git", args, { cwd, env: noPromptEnv({ ...baseEnv, ...env }), stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
      child.stdin.end();
      child.stdout.setEncoding("utf8").on("data", (piece: string) => (stdout += piece));
      child.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-OUTPUT_CHARS)));
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: err.message, timedOut });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      });
    });
}

/** A remote URL with any user name and password taken out, so a token in it never leaves. */
export function withoutCredentials(remote: string): string {
  return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}

/** Whether two remote URLs name the same repository: the same project id, or the same local path. */
export function sameRemote(a: string, b: string): boolean {
  const local = { machine: "", root: "" };
  const pa = projectId(withoutCredentials(a), local).id;
  const pb = projectId(withoutCredentials(b), local).id;
  if (!pa.startsWith("local:") || !pb.startsWith("local:")) return pa === pb;
  const asPath = (r: string) => pathKey(path.resolve(r.replace(/^file:\/\//, ""))).replace(/(\/\.git|\.git)$/, "");
  return asPath(a) === asPath(b);
}

// The most untracked files a brief lists; the rest are counted.
const UNTRACKED_MAX = 50;

/**
 * The untracked files in the repo at `cwd` that .gitignore doesn't match, by path from the repo's
 * top. Files git ignores are never listed.
 */
export async function untracked(run: RunGit, cwd: string, timeoutMs: number): Promise<string[]> {
  const r = await run(["ls-files", "--others", "--exclude-standard", "--full-name", "-z", ":/"], { cwd, timeoutMs });
  if (r.code !== 0) return [];
  return r.stdout.split("\0").filter(Boolean).sort();
}

/** The brief request's last line: the untracked files the brief should say the purpose of. */
export const untrackedLine = (files: string[]) =>
  files.length ? `The untracked files are: ${files.map((f) => `\`${f}\``).join(", ")}. Say what each is for.` : "There are no untracked files.";

/** The runner's note at the end of every brief: what was pushed, from where, and what wasn't. */
export function handoffNote({ branch, from, files }: { branch: string; from: string | null; files: string[] }): string {
  const lines = [`Handed over by Isoplan on the branch ${branch}${from ? `, made from ${from}` : ""}, with the tracked changes in a work-in-progress commit.`];
  if (files.length) {
    const named = files.slice(0, UNTRACKED_MAX).map((f) => `\`${f}\``).join(", ");
    const more = files.length > UNTRACKED_MAX ? `, and ${files.length - UNTRACKED_MAX} more` : "";
    lines.push(`Untracked files, not handed over: ${named}${more}.`);
  }
  return lines.join("\n");
}

export interface Prepared {
  /** The repo's top folder. */
  toplevel: string;
  /** The current branch, or null when HEAD is detached. */
  from: string | null;
  files: string[];
}

/** What a handoff from `cwd` would start from: the repo, its current branch and its untracked files. */
export async function prepare(run: RunGit, cwd: string, timeoutMs: number): Promise<Prepared> {
  const top = await run(["rev-parse", "--show-toplevel"], { cwd, timeoutMs });
  if (top.code !== 0) throw new HandoffGitError(top.timedOut ? "timed-out" : "not-a-repo", `git rev-parse in ${cwd}: ${top.stderr.trim()}`);
  const toplevel = top.stdout.trim();
  const head = await run(["symbolic-ref", "--short", "-q", "HEAD"], { cwd: toplevel, timeoutMs });
  return { toplevel, from: head.code === 0 && head.stdout.trim() ? head.stdout.trim() : null, files: await untracked(run, toplevel, timeoutMs) };
}

const IDENTITY = { GIT_AUTHOR_NAME: "Isoplan handoff", GIT_AUTHOR_EMAIL: "handoff@isoplan.invalid", GIT_COMMITTER_NAME: "Isoplan handoff", GIT_COMMITTER_EMAIL: "handoff@isoplan.invalid" };

/**
 * Commits the tracked changes at `cwd` to isoplan/handoff/<id> and pushes that branch alone, with
 * force, since the branch is the handoff's own and a second hand-over of the same room replaces it.
 * Returns the repo as the handoff records it. Throws a HandoffGitError.
 */
export async function pushHandoff(run: RunGit, cwd: string, id: string, timeoutMs: number): Promise<HandoffRepo> {
  const branch = handoffBranch(id);
  const { toplevel, from } = await prepare(run, cwd, timeoutMs);
  const at = { cwd: toplevel, timeoutMs };
  const git = async (args: string[], env?: Record<string, string>) => {
    const r = await run(args, { ...at, env });
    if (r.timedOut) throw new HandoffGitError("timed-out", `git ${args[0]} took longer than ${Math.round(timeoutMs / 1000)} s`);
    return r;
  };
  const must = async (args: string[], kind: GitFailure = "failed", env?: Record<string, string>) => {
    const r = await git(args, env);
    if (r.code !== 0) throw new HandoffGitError(kind, `git ${args.join(" ")}: ${r.stderr.trim()}`);
    return r.stdout.trim();
  };

  const head = await git(["rev-parse", "--verify", "-q", "HEAD"]);
  if (head.code !== 0) throw new HandoffGitError("no-commit", `${toplevel} has no commit yet`);
  const parent = head.stdout.trim();

  // The current branch's own remote, else origin, else the only one there is.
  const remotes = (await must(["remote"])).split(/\r?\n/).filter(Boolean);
  const upstream = from ? (await git(["config", "--get", `branch.${from}.remote`])).stdout.trim() : "";
  const remote = remotes.includes(upstream) ? upstream : remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0]! : null;
  if (!remote) throw new HandoffGitError("no-remote", `${toplevel} has ${remotes.length ? `several remotes and none is origin: ${remotes.join(", ")}` : "no remote"}`);
  const url = await must(["remote", "get-url", remote], "no-remote");

  // The rule this all keeps: the handoff's branch is never the current or the default one.
  const fallback = (await git(["symbolic-ref", "--short", "-q", `refs/remotes/${remote}/HEAD`])).stdout.trim().replace(`${remote}/`, "");
  if (branch === from || branch === fallback) throw new HandoffGitError("failed", `${branch} is the current or the default branch, which a handoff never pushes`);

  const index = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "isoplan-handoff-")), "index");
  try {
    const real = path.resolve(toplevel, await must(["rev-parse", "--git-path", "index"]));
    const copied = await fs.copyFile(real, index).then(() => true, () => false);
    const withIndex = { GIT_INDEX_FILE: index };
    if (!copied) await must(["read-tree", "HEAD"], "failed", withIndex);
    await must(["add", "-u", "--", ":/"], "failed", withIndex);
    const tree = await must(["write-tree"], "failed", withIndex);
    let commit = parent;
    if (tree !== (await must(["rev-parse", `${parent}^{tree}`]))) {
      const named = (await git(["config", "user.email"])).code === 0;
      const message = `WIP: Isoplan handoff ${id}\n\nThe tracked changes${from ? ` on ${from}` : ""}, handed over as they were.`;
      commit = await must(["commit-tree", tree, "-p", parent, "-m", message], "failed", named ? undefined : IDENTITY);
    }
    await must(["update-ref", `refs/heads/${branch}`, commit]);
    const pushed = await git(["push", "--porcelain", remote, `+${commit}:refs/heads/${branch}`]);
    if (pushed.code !== 0) throw new HandoffGitError(/rejected|denied|declined/i.test(pushed.stderr + pushed.stdout) ? "rejected" : "failed", `git push ${remote} ${branch}: ${(pushed.stderr || pushed.stdout).trim()}`);
    return { path: ".", remote: withoutCredentials(url), branch, commit };
  } finally {
    await fs.rm(path.dirname(index), { recursive: true, force: true }).catch(() => {});
  }
}
