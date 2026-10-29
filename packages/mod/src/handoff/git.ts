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
// Several repos (#56): the session's folder is its repo's top, or the folder itself when it isn't
// in a repo (a plain folder above several, say). Every repo under it, up to `repoSearchDepth`
// folders down, is found whether or not the folder's own repo ignores it; folders whose names start
// with a dot, node_modules and symlinks aren't looked in. The folder's own repo always goes. A repo
// under it goes when it has work its remote's default branch hasn't: uncommitted changes to tracked
// files, or commits that aren't on it. Each one that goes is handed over by every rule above, on
// its own, with its own .gitignore, remote and default branch; all of them are committed and
// scanned before any is pushed, so one match holds them all. A sub-repo with work but no commit or
// no remote is left out, and the note says so. Git submodules are left out too and named: the
// commits a submodule's pointer names would need pushing in the submodule's own remote.
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
export type GitFailure = "not-a-repo" | "no-work" | "no-commit" | "no-remote" | "lfs" | "timed-out" | "rejected" | "failed";

export class HandoffGitError extends Error {
  constructor(
    readonly kind: GitFailure,
    readonly detail: string,
    /** The repo it was in, by path in the session's folder; `.` for the folder's own. */
    readonly repo = ".",
  ) {
    super(detail);
  }
}

/** What the server is told for each kind of git failure. */
export const GIT_FAILED: Record<GitFailure, string> = {
  "not-a-repo": "the session's folder isn't in a git repo, and has none in it",
  "no-work": "none of the repos in the session's folder has work that isn't on its default branch",
  "no-commit": "the session's repo has no commit to hand over from",
  "no-remote": "the session's repo has no remote to push the handoff's branch to",
  lfs: "the session's repo uses Git LFS, whose files a handoff can't push yet",
  "timed-out": "git took too long to push the handoff's branch",
  rejected: "the remote rejected the handoff's branch",
  failed: "git couldn't push the handoff's branch",
};

/** What the server is told for a git failure, naming the repo when it is one under the session's folder. */
export const gitFailed = (err: HandoffGitError) => {
  const text = GIT_FAILED[err.kind];
  return err.repo === "." ? text : `${text.replace("the session's repo", "a repo in the session's folder")} (in ${err.repo})`;
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

/** A repo under the session's folder that isn't handed over, and why. */
export interface Left {
  path: string;
  why: string;
}

/**
 * The runner's note at the end of every brief: what is pushed, from where, and what isn't, as of
 * `at` (a brief withheld and released later still describes the tree as it was then). With repos
 * under the session's folder, it names each by its path there.
 */
export function handoffNote({ branch, from, files, at, repos = [], left = [] }: { branch: string; from: string | null; files: string[] | null; at: Date; repos?: { path: string; from: string | null }[]; left?: Left[] }): string {
  const when = at.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const lines =
    repos.some((r) => r.path !== ".")
      ? [
          `Handed over by Isoplan on the branch ${branch} in each of these repos, by their paths in the session's folder, with each one's tracked changes in a work-in-progress commit: ${repos.map((r) => `\`${r.path}\`${r.from ? ` (made from ${r.from})` : ""}`).join(", ")}. This describes the work trees as of ${when}.`,
        ]
      : [`Handed over by Isoplan on the branch ${branch}${from ? `, made from ${from}` : ""}, with the tracked changes in a work-in-progress commit. This describes the work tree as of ${when}.`];
  for (const why of new Set(left.map((l) => l.why))) lines.push(`Repos not handed over, ${why}: ${listed(left.filter((l) => l.why === why).map((l) => l.path))}.`);
  if (files === null) lines.push("Untracked files: unknown, since git couldn't list them.");
  else if (files.length) lines.push(`Untracked files, not handed over: ${listed(files)}.`);
  return lines.join("\n");
}

/** A repo a handoff goes out from. */
export interface PreparedRepo {
  /** Its path in the session's folder, with forward slashes; `.` for the folder's own. */
  path: string;
  dir: string;
  /** Its current branch, or null when HEAD is detached. */
  from: string | null;
}

export interface Prepared {
  /** The session's folder: its repo's top, or the folder itself when it isn't in a repo. */
  toplevel: string;
  /** The folder's own repo's current branch; null when HEAD is detached or there is no such repo. */
  from: string | null;
  /** By path in the session's folder; null when git couldn't list them. */
  files: string[] | null;
  /** The repos to hand over: the folder's own first, then those under it with work. */
  repos: PreparedRepo[];
  /** The repos under the folder that aren't handed over. */
  left: Left[];
}

/** How many folders down from the session's folder repos are looked for, unless runner.json says. */
export const REPO_DEPTH = 3;

const WHY = {
  unchanged: "since they have no work that isn't on their remote's default branch",
  "no-commit": "since they have no commit yet",
  "no-remote": "since they have no remote to push to",
  submodule: "since they are git submodules, which a handoff doesn't carry",
} as const;

// Runs git in one repo; a timeout, or with `must` a failure, throws for that repo.
function gitIn(run: RunGit, cwd: string, timeoutMs: number, repo: string) {
  const git = async (args: string[], env?: Record<string, string>) => {
    const r = await run(args, { cwd, timeoutMs, env });
    if (r.timedOut) throw new HandoffGitError("timed-out", `git ${args[0]} in ${cwd} took longer than ${Math.round(timeoutMs / 1000)} s`, repo);
    return r;
  };
  const must = async (args: string[], kind: GitFailure = "failed", env?: Record<string, string>) => {
    const r = await git(args, env);
    if (r.code !== 0) throw new HandoffGitError(kind, `git ${args.join(" ")} in ${cwd}: ${r.stderr.trim()}`, repo);
    return r.stdout.trim();
  };
  return { git, must };
}

/**
 * The folders under `root` that hold a repo (a `.git` folder or file), by path from it, at most
 * `depth` folders down. Folders whose names start with a dot, node_modules and symlinks aren't
 * looked in.
 */
export async function reposUnder(root: string, depth: number): Promise<string[]> {
  const found: string[] = [];
  const walk = async (rel: string, level: number): Promise<void> => {
    if (level >= depth) return;
    const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const sub = rel ? `${rel}/${entry.name}` : entry.name;
      if (await fs.lstat(path.join(root, sub, ".git")).then(() => true, () => false)) found.push(sub);
      await walk(sub, level + 1);
    }
  };
  await walk("", 0);
  return found;
}

/** The current branch, or null when HEAD is detached. */
async function branchOf(run: RunGit, dir: string, timeoutMs: number, repo: string): Promise<string | null> {
  const head = await gitIn(run, dir, timeoutMs, repo).git(["symbolic-ref", "--short", "-q", "HEAD"]);
  return head.code === 0 && head.stdout.trim() ? head.stdout.trim() : null;
}

/** The remote `from` pushes to (branch.<x>.pushRemote, remote.pushDefault, then branch.<x>.remote), else origin, else the only remote there is. */
async function pushRemote(run: RunGit, dir: string, from: string | null, timeoutMs: number, repo: string): Promise<{ remote: string | null; remotes: string[] }> {
  const { git, must } = gitIn(run, dir, timeoutMs, repo);
  const remotes = (await must(["remote"])).split(/\r?\n/).filter(Boolean);
  const setting = async (key: string) => (await git(["config", "--get", key])).stdout.trim();
  const chosen = [from ? await setting(`branch.${from}.pushRemote`) : "", await setting("remote.pushDefault"), from ? await setting(`branch.${from}.remote`) : ""].find((r) => remotes.includes(r));
  return { remote: chosen ?? (remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0]! : null), remotes };
}

// Whether a repo under the folder has work to hand over, or why it is left.
async function workOf(run: RunGit, dir: string, repo: string, timeoutMs: number): Promise<"work" | Exclude<keyof typeof WHY, "submodule">> {
  const { git } = gitIn(run, dir, timeoutMs, repo);
  if ((await git(["rev-parse", "--verify", "-q", "HEAD"])).code !== 0) return "no-commit";
  const { remote } = await pushRemote(run, dir, await branchOf(run, dir, timeoutMs, repo), timeoutMs, repo);
  if (!remote) return "no-remote";
  if ((await git(["status", "--porcelain", "--untracked-files=no"])).stdout.trim()) return "work";
  // With no default branch known, it can't be told to have none, so it goes.
  const fallback = (await git(["symbolic-ref", "-q", `refs/remotes/${remote}/HEAD`])).stdout.trim();
  if (!fallback) return "work";
  const ahead = await git(["rev-list", "--count", "HEAD", "--not", fallback]);
  return ahead.code !== 0 || Number(ahead.stdout.trim()) > 0 ? "work" : "unchanged";
}

/**
 * What a handoff from `cwd` would start from: the session's folder, the repos in it to hand over,
 * their untracked files and the repos left out. Throws a HandoffGitError.
 */
export async function prepare(run: RunGit, cwd: string, timeoutMs: number, depth = REPO_DEPTH): Promise<Prepared> {
  const top = await run(["rev-parse", "--show-toplevel"], { cwd, timeoutMs });
  if (top.timedOut) throw new HandoffGitError("timed-out", `git rev-parse in ${cwd} took longer than ${Math.round(timeoutMs / 1000)} s`);
  const inRepo = top.code === 0;
  const toplevel = inRepo ? top.stdout.trim() : path.resolve(cwd);
  const found = await reposUnder(toplevel, depth);
  if (!inRepo && !found.length) throw new HandoffGitError("not-a-repo", `${cwd} isn't in a git repo and has none under it: ${top.stderr.trim()}`);
  const dirOf = (p: string) => (p === "." ? toplevel : path.join(toplevel, p));
  const from = inRepo ? await branchOf(run, toplevel, timeoutMs, ".") : null;
  const repos: PreparedRepo[] = inRepo ? [{ path: ".", dir: toplevel, from }] : [];
  const left: Left[] = [];
  const listedRepos = inRepo ? ["."] : [];
  for (const sub of found) {
    // A submodule is a gitlink in the repo it sits in, the nearest one above it.
    const above = [...(inRepo ? ["."] : []), ...found].filter((p) => p === "." || sub.startsWith(`${p}/`)).sort((a, b) => a.length - b.length).at(-1);
    if (above) {
      const inside = above === "." ? sub : sub.slice(above.length + 1);
      const staged = await gitIn(run, dirOf(above), timeoutMs, above).git(["ls-files", "--stage", "--", inside]);
      if (staged.stdout.startsWith("160000 ")) {
        left.push({ path: sub, why: WHY.submodule });
        continue;
      }
    }
    listedRepos.push(sub);
    const state = await workOf(run, dirOf(sub), sub, timeoutMs);
    if (state === "work") repos.push({ path: sub, dir: dirOf(sub), from: await branchOf(run, dirOf(sub), timeoutMs, sub) });
    else left.push({ path: sub, why: WHY[state] });
  }
  if (!repos.length) throw new HandoffGitError("no-work", `none of the repos under ${toplevel} has work that isn't on its remote's default branch`);

  // Each repo's untracked files by path in the folder, less the repos under it, which git lists as folders.
  let files: string[] | null = [];
  for (const p of listedRepos) {
    const own = await untracked(run, dirOf(p), timeoutMs);
    if (own === null) {
      files = null;
      break;
    }
    const full = own.map((f) => (p === "." ? f : `${p}/${f}`));
    files.push(...full.filter((f) => !found.some((sub) => f === `${sub}/`)));
  }
  return { toplevel, from, files: files && files.sort(), repos, left };
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
  /** By repo path: pushes this commit, one that was held, as it is, since its owner said to push it anyway. */
  pushAnyway?: Record<string, string>;
  /** How many folders down repos are looked for. */
  depth?: number;
}

/**
 * The repos as the handoff records them; or, with nothing pushed, the file whose added lines
 * matched a secret pattern (by path in the session's folder), the repo it is in, the commit that
 * would have gone there (for pushing it anyway), and the files the scan couldn't read.
 */
export type Pushed = { repos: HandoffRepo[] } | { held: string; repo: string; commit: string; unchecked: string[] };

// A repo's commit, ready to push.
interface Ready {
  path: string;
  dir: string;
  remote: string;
  url: string;
  commit: string;
}

/**
 * Commits the tracked changes in each repo `prepare` finds at `cwd` and pushes that commit alone to
 * isoplan/handoff/<id> in each, with force, since the branch is the handoff's own and a second
 * hand-over of the same room replaces it. A repo's remote is the one its current branch pushes to
 * (branch.<x>.pushRemote, remote.pushDefault, then branch.<x>.remote, then origin), and the repo it
 * records names its push URL, where the branch is. Nothing is pushed until every repo's commit is
 * made and scanned. Throws a HandoffGitError.
 */
export async function pushHandoff(run: RunGit, cwd: string, id: string, timeoutMs: number, { scan, pushAnyway = {}, depth }: PushOptions = {}): Promise<Pushed> {
  const branch = handoffBranch(id);
  const { repos } = await prepare(run, cwd, timeoutMs, depth);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "isoplan-handoff-"));
  const ready: Ready[] = [];
  try {
    for (const [n, repo] of repos.entries()) {
      const r = await commitIn(run, repo, id, branch, path.join(temp, `index-${n}`), timeoutMs, pushAnyway[repo.path] ?? null, scan);
      if ("held" in r) return r;
      ready.push(r);
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  const pushed: HandoffRepo[] = [];
  for (const r of ready) {
    const { git } = gitIn(run, r.dir, timeoutMs, r.path);
    // The sender's pre-push hook doesn't run here: this push is the handoff's, in the background.
    const sent = await git(["push", "--no-verify", "--porcelain", r.remote, `+${r.commit}:refs/heads/${branch}`]);
    if (sent.code !== 0) throw new HandoffGitError(/rejected|denied|declined/i.test(sent.stderr + sent.stdout) ? "rejected" : "failed", `git push ${r.remote} ${branch} in ${r.dir}: ${(sent.stderr || sent.stdout).trim()}`, r.path);
    pushed.push({ path: r.path, remote: withoutCredentials(r.url), branch, commit: r.commit });
  }
  return { repos: pushed };
}

// One repo's work-in-progress commit, built in a temporary index, checked and scanned; or the hold.
async function commitIn(
  run: RunGit,
  { path: at, dir, from }: PreparedRepo,
  id: string,
  branch: string,
  index: string,
  timeoutMs: number,
  pushAnyway: string | null,
  scan: PushOptions["scan"],
): Promise<Ready | Extract<Pushed, { held: string }>> {
  const { git, must } = gitIn(run, dir, timeoutMs, at);
  const inFolder = (file: string) => (at === "." ? file : `${at}/${file}`);
  const head = await git(["rev-parse", "--verify", "-q", "HEAD"]);
  if (head.code !== 0) throw new HandoffGitError("no-commit", `${dir} has no commit yet`, at);
  const parent = head.stdout.trim();

  const { remote, remotes } = await pushRemote(run, dir, from, timeoutMs, at);
  if (!remote) throw new HandoffGitError("no-remote", `${dir} has ${remotes.length ? `several remotes and none is origin: ${remotes.join(", ")}` : "no remote"}`, at);
  // Where the branch goes, which is what the receiver must fetch from.
  const url = await must(["remote", "get-url", "--push", remote], "no-remote");

  // The rule this all keeps: the handoff's branch is never the current or the default one.
  const fallback = (await git(["symbolic-ref", "--short", "-q", `refs/remotes/${remote}/HEAD`])).stdout.trim().replace(`${remote}/`, "");
  if (branch === from || branch === fallback) throw new HandoffGitError("failed", `${branch} is the current or the default branch of ${dir}, which a handoff never pushes`, at);

  const lfs = async (commit: string) => {
    if ((await git(["grep", "-q", "-I", "filter=lfs", commit, "--", ".gitattributes", "**/.gitattributes"])).code === 0) throw new HandoffGitError("lfs", `${dir} uses Git LFS`, at);
  };
  // Pushing anyway sends the commit that was held, exactly: never the tree as it is by now.
  if (pushAnyway) {
    if ((await git(["cat-file", "-e", `${pushAnyway}^{commit}`])).code !== 0) throw new HandoffGitError("failed", `the held commit ${pushAnyway} is gone from ${dir}`, at);
    await lfs(pushAnyway);
    return { path: at, dir, remote, url, commit: pushAnyway };
  }

  const real = path.resolve(dir, await must(["rev-parse", "--git-path", "index"]));
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
  await lfs(commit);
  if (scan) {
    // Everything the push sends: each commit the remote doesn't have, with the lines it adds.
    const patch = await must(["log", "-p", "-U0", "--no-color", "--no-ext-diff", "--no-renames", "--diff-merges=first-parent", "--format=", commit, "--not", `--remotes=${remote}`]);
    const { lines, binary } = addedLines(patch);
    for (const [file, text] of lines) if (await scan(text)) return { held: inFolder(file), repo: at, commit, unchecked: binary.map(inFolder) };
  }
  return { path: at, dir, remote, url, commit };
}
