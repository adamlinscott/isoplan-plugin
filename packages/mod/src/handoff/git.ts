// The git side of a handoff (#48), for the runner's brief and the /isoplan:handover command.
//
// Sending: the session's tracked changes go in one work-in-progress commit made from the current
// branch's HEAD, and that commit alone is pushed, to isoplan/handoff/<id> on the remote; no local
// branch is made. The commit is built in a temporary index (a copy of the real one, then
// `git add -u`), so the session's work tree, index and branch are never touched: the sender's agent
// may be working in them. Untracked files aren't committed; the brief names them (`untracked`), and
// untracked files .gitignore matches are never listed (a file that is tracked goes over, whatever
// .gitignore says). The current branch and the default branch are never pushed, so a handoff
// triggers a deploy only if CI builds isoplan/handoff/* too: leave those branches out of it. Every
// commit the push sends that the remote doesn't have is scanned for secrets first, the lines each
// adds; on a match nothing is pushed and the file is named, until its owner says to push that exact
// commit anyway. Binary files can't be read, so they are named as unchecked. A repo that uses Git
// LFS is refused: its pointer files would go without the files themselves.
//
// Every git command runs without a prompt (no terminal, credential manager or ssh passphrase
// prompt), without the sender's hooks or commit signing, and under a timeout, and ends with its
// whole process tree when that runs out.

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
export type GitFailure = "not-a-repo" | "no-commit" | "no-remote" | "lfs" | "timed-out" | "rejected" | "failed";

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
  lfs: "the session's repo uses Git LFS, whose files a handoff can't push yet",
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
// Variables that point git at another repo, index or work tree than the folder it runs in.
const REPO_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_NAMESPACE"];

/**
 * The environment git runs with: no terminal prompt and no credential manager window; ssh in batch
 * mode, unless the person chose their own ssh (GIT_SSH_COMMAND, GIT_SSH, or core.sshCommand in the
 * repo's config, `sshCommandSet`); and none of the inherited variables that would point it at
 * another repo.
 */
export function noPromptEnv(env: Record<string, string | undefined>, sshCommandSet = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined && !REPO_VARIABLES.includes(key.toUpperCase())) out[key] = value;
  out.GIT_TERMINAL_PROMPT = "0";
  out.GCM_INTERACTIVE = "never";
  if (!out.GIT_SSH_COMMAND && !out.GIT_SSH && !sshCommandSet) out.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  return out;
}

function spawnGit(args: string[], cwd: string, env: Record<string, string>, timeoutMs: number): Promise<GitResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn("git", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
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

export function createRunGit(baseEnv: Record<string, string | undefined> = process.env): RunGit {
  // Whether each folder's config sets core.sshCommand, asked once per folder.
  const sshCommand = new Map<string, Promise<boolean>>();
  return async (args, { cwd, env, timeoutMs }) => {
    const key = pathKey(cwd);
    if (!sshCommand.has(key)) sshCommand.set(key, spawnGit(["config", "--get", "core.sshCommand"], cwd, noPromptEnv(baseEnv, true), timeoutMs).then((r) => r.code === 0 && r.stdout.trim() !== ""));
    return spawnGit(args, cwd, { ...noPromptEnv(baseEnv, await sshCommand.get(key)!), ...env }, timeoutMs);
  };
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

/** The repo's remotes with their fetch and push URLs (which may hold spaces: a local path). */
export async function remotesOf(run: RunGit, cwd: string, timeoutMs: number): Promise<{ name: string; urls: string[] }[] | null> {
  // The repo's own config: outside a repo that is an error, not the person's global settings.
  const r = await run(["config", "--local", "--get-regexp", "^remote\\..*\\.(url|pushurl)$"], { cwd, timeoutMs });
  // Exit 1 is no remotes at all; anything else is a folder git can't read.
  if (r.code !== 0) return r.code === 1 ? [] : null;
  const out = new Map<string, string[]>();
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^remote\.(.+)\.(?:url|pushurl) (.*)$/.exec(line);
    if (m) out.set(m[1]!, [...(out.get(m[1]!) ?? []), m[2]!]);
  }
  return [...out].map(([name, urls]) => ({ name, urls }));
}

// The most untracked files a brief lists; the rest are counted.
const UNTRACKED_MAX = 50;

/**
 * The untracked files in the repo at `cwd` that .gitignore doesn't match, by path from the repo's
 * top; null when git couldn't list them. Files git ignores are never listed.
 */
export async function untracked(run: RunGit, cwd: string, timeoutMs: number): Promise<string[] | null> {
  const r = await run(["ls-files", "--others", "--exclude-standard", "--full-name", "-z", ":/"], { cwd, timeoutMs });
  if (r.code !== 0) return null;
  return r.stdout.split("\0").filter(Boolean).sort();
}

const listed = (files: string[]) => files.slice(0, UNTRACKED_MAX).map((f) => `\`${f}\``).join(", ") + (files.length > UNTRACKED_MAX ? `, and ${files.length - UNTRACKED_MAX} more` : "");

/** The brief request's last line: the untracked files the brief should say the purpose of. */
export const untrackedLine = (files: string[] | null) =>
  files === null ? "The untracked files couldn't be listed, so don't name any." : files.length ? `The untracked files are: ${listed(files)}. Say what each is for.` : "There are no untracked files.";

/**
 * The runner's note at the end of every brief: what is pushed, from where, and what isn't, as of
 * `at` (a brief withheld and released later still describes the tree as it was then).
 */
export function handoffNote({ branch, from, files, at }: { branch: string; from: string | null; files: string[] | null; at: Date }): string {
  const when = at.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const lines = [`Handed over by Isoplan on the branch ${branch}${from ? `, made from ${from}` : ""}, with the tracked changes in a work-in-progress commit. This describes the work tree as of ${when}.`];
  if (files === null) lines.push("Untracked files: unknown, since git couldn't list them.");
  else if (files.length) lines.push(`Untracked files, not handed over: ${listed(files)}.`);
  return lines.join("\n");
}

export interface Prepared {
  /** The repo's top folder. */
  toplevel: string;
  /** The current branch, or null when HEAD is detached. */
  from: string | null;
  /** Null when git couldn't list them. */
  files: string[] | null;
}

/** What a handoff from `cwd` would start from: the repo, its current branch and its untracked files. */
export async function prepare(run: RunGit, cwd: string, timeoutMs: number): Promise<Prepared> {
  const top = await run(["rev-parse", "--show-toplevel"], { cwd, timeoutMs });
  if (top.code !== 0) throw new HandoffGitError(top.timedOut ? "timed-out" : "not-a-repo", `git rev-parse in ${cwd}: ${top.stderr.trim()}`);
  const toplevel = top.stdout.trim();
  const head = await run(["symbolic-ref", "--short", "-q", "HEAD"], { cwd: toplevel, timeoutMs });
  return { toplevel, from: head.code === 0 && head.stdout.trim() ? head.stdout.trim() : null, files: await untracked(run, toplevel, timeoutMs) };
}

/**
 * The files a patch (`git log -p -U0`) adds lines to, with those lines, and the binary files it adds
 * or changes, which can't be read. A `+++ ` line is a file's header only right after its `--- `
 * line; anywhere else it is an added line that starts with `++`.
 */
export function addedLines(diff: string): { lines: Map<string, string>; binary: string[] } {
  const lines = new Map<string, string>();
  const binary = new Set<string>();
  let file: string | null = null;
  let previous = "";
  for (const line of diff.split("\n")) {
    const header = line.startsWith("+++ ") && previous.startsWith("--- ");
    const bin = /^Binary files .* and (?:b\/)?(.+) differ$/.exec(line);
    if (header) file = line === "+++ /dev/null" ? null : line.slice(4).replace(/^b\//, "");
    else if (line.startsWith("diff --git ")) file = null;
    else if (bin && bin[1] !== "/dev/null") binary.add(bin[1]!);
    else if (file && line.startsWith("+")) lines.set(file, (lines.get(file) ?? "") + line.slice(1) + "\n");
    previous = line;
  }
  return { lines, binary: [...binary].sort() };
}

const IDENTITY = { GIT_AUTHOR_NAME: "Isoplan handoff", GIT_AUTHOR_EMAIL: "handoff@isoplan.invalid", GIT_COMMITTER_NAME: "Isoplan handoff", GIT_COMMITTER_EMAIL: "handoff@isoplan.invalid" };

export interface PushOptions {
  /** Names the secret pattern text matches, or null. Without it nothing is scanned. */
  scan?: (text: string) => Promise<string | null>;
  /** Pushes this commit, one that was held, as it is: its owner said to push it anyway. */
  pushAnyway?: string;
}

/**
 * The repo as the handoff records it; or, with nothing pushed, the file whose added lines matched a
 * secret pattern, the commit that would have gone (for pushing it anyway), and the files the scan
 * couldn't read.
 */
export type Pushed = { repo: HandoffRepo } | { held: string; commit: string; unchecked: string[] };

/**
 * Commits the tracked changes at `cwd` and pushes that commit alone to isoplan/handoff/<id>, with
 * force, since the branch is the handoff's own and a second hand-over of the same room replaces it.
 * The remote is the one the current branch pushes to (branch.<x>.pushRemote, remote.pushDefault,
 * then branch.<x>.remote, then origin), and the repo it records names its push URL, where the branch
 * is. Throws a HandoffGitError.
 */
export async function pushHandoff(run: RunGit, cwd: string, id: string, timeoutMs: number, { scan, pushAnyway }: PushOptions = {}): Promise<Pushed> {
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

  // Where the current branch pushes, else origin, else the only remote there is.
  const remotes = (await must(["remote"])).split(/\r?\n/).filter(Boolean);
  const setting = async (key: string) => (await git(["config", "--get", key])).stdout.trim();
  const chosen = [from ? await setting(`branch.${from}.pushRemote`) : "", await setting("remote.pushDefault"), from ? await setting(`branch.${from}.remote`) : ""].find((r) => remotes.includes(r));
  const remote = chosen ?? (remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0]! : null);
  if (!remote) throw new HandoffGitError("no-remote", `${toplevel} has ${remotes.length ? `several remotes and none is origin: ${remotes.join(", ")}` : "no remote"}`);
  // Where the branch goes, which is what the receiver must fetch from.
  const url = await must(["remote", "get-url", "--push", remote], "no-remote");

  // The rule this all keeps: the handoff's branch is never the current or the default one.
  const fallback = (await git(["symbolic-ref", "--short", "-q", `refs/remotes/${remote}/HEAD`])).stdout.trim().replace(`${remote}/`, "");
  if (branch === from || branch === fallback) throw new HandoffGitError("failed", `${branch} is the current or the default branch, which a handoff never pushes`);

  // Pushing anyway sends the commit that was held, exactly: never the tree as it is by now.
  if (pushAnyway) {
    if ((await git(["cat-file", "-e", `${pushAnyway}^{commit}`])).code !== 0) throw new HandoffGitError("failed", `the held commit ${pushAnyway} is gone from ${toplevel}`);
    return { repo: await send(pushAnyway) };
  }

  async function send(commit: string): Promise<HandoffRepo> {
    if ((await git(["grep", "-q", "-I", "filter=lfs", commit, "--", ".gitattributes", "**/.gitattributes"])).code === 0) throw new HandoffGitError("lfs", `${toplevel} uses Git LFS`);
    // The sender's pre-push hook doesn't run here: this push is the handoff's, in the background.
    const pushed = await git(["push", "--no-verify", "--porcelain", remote!, `+${commit}:refs/heads/${branch}`]);
    if (pushed.code !== 0) throw new HandoffGitError(/rejected|denied|declined/i.test(pushed.stderr + pushed.stdout) ? "rejected" : "failed", `git push ${remote} ${branch}: ${(pushed.stderr || pushed.stdout).trim()}`);
    return { path: ".", remote: withoutCredentials(url), branch, commit };
  }

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
      commit = await must(["-c", "commit.gpgSign=false", "commit-tree", "--no-gpg-sign", tree, "-p", parent, "-m", message], "failed", named ? undefined : IDENTITY);
    }
    if (scan) {
      // Everything the push sends: each commit the remote doesn't have, with the lines it adds.
      const patch = await must(["log", "-p", "-U0", "--no-color", "--no-ext-diff", "--no-renames", "--diff-merges=first-parent", "--format=", commit, "--not", `--remotes=${remote}`]);
      const { lines, binary } = addedLines(patch);
      for (const [file, text] of lines) if (await scan(text)) return { held: file, commit, unchecked: binary };
    }
    return { repo: await send(commit) };
  } finally {
    await fs.rm(path.dirname(index), { recursive: true, force: true }).catch(() => {});
  }
}
