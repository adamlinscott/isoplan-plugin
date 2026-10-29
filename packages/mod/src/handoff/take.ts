// Taking a handoff from the floor (#48): the receiver's runner does it, in order.
//
// 1. The clone: the machine's Claude Code sessions from the last `cloneSearchDays` say which folders
//    the receiver works in. Each is placed with git, newest first, and the main checkout of the first
//    whose remote is the handoff's (the same project id, or the same path for a local remote) is the
//    clone. Without one nothing can be made, so no session opens and the handoff stays to be taken.
// 2. The worktree: a sibling of the clone, <clone>-handoff-<id>, on isoplan/handoff/<id>, tracking
//    the remote's branch, made and moved with the repo's hooks off (they are the sender's, from the
//    branch). One made for this handoff before moves to the branch as handed over now, unless it
//    holds work that isn't in it: uncommitted changes to tracked files, or any commit that is neither
//    in the new tip nor one of the commits this machine took of this handoff before (taken.json in
//    the handoff's folder). Then it is left as it is and the take is refused with a note. A local
//    branch is never reset over such commits.
// 3. The setup script (E11): `worktreeSetup` in isoplan.json at the repo's top, read from the
//    receiver's own copy of the remote's default branch, and never from any other branch, so neither
//    the handoff nor whatever the clone has checked out can change what runs. When the default branch
//    can't be told, setup is skipped and the meeting says why. It runs with the system shell (cmd.exe
//    on Windows, /bin/sh on a Mac) in the worktree, hidden, with ISOPLAN_HANDOFF_ID and
//    ISOPLAN_HANDOFF_BRANCH set, under its timeout. Its output goes to setup.log in the handoff's
//    folder.
// 4. The repos under the session's folder (#56), each at its path in the worktree, parents first.
//    One there already (the setup script's clone, say) with the handoff's remote is fetched and
//    switched to the handoff's branch, by the shortcut's rules below: never over uncommitted changes
//    to tracked files or commits of the receiver's own. Where there is none, or only an empty
//    folder, it is cloned from the recorded remote on that branch, only when that is an https, ssh
//    or host:path remote (never a local path, file:// or a \server share), with Git LFS's download
//    off. A path through a link, or into a .git folder by any name Windows gives one, is refused.
//    The setup script runs before this, so it sees only the repos it clones itself. One that fails is reported with its path, and the rest go on.
//    A handoff from a folder that isn't a repo itself (a plain folder above several) has no
//    worktree to make: its folder is a new plain folder, <workspace>-handoff-<id>, beside the
//    receiver's own workspace, which is the most recent session folder holding a clone of one of
//    its repos at that repo's path. There is no repo there to read isoplan.json from, so no setup
//    script runs.
// 5. Claude Code in the worktree, under the session id the server chose, so that session alone may
//    join the room, told to read the brief, which is in brief.md in the handoff's folder
//    (<claude dir>/isoplan/handoffs/<id>/). As the receiver chose on the floor, and only as they
//    said: a handoff that doesn't say is refused.
//    - `terminal`: a terminal window, the only thing here that opens one, and only for that click
//      (Windows: `start`, a Windows Terminal tab where that is the default; Mac: Terminal.app);
//    - `headless`: a background session, `claude --bg`, with no window. Claude Code starts one only
//      in a folder it trusts, and a new worktree isn't, so the worktree's path alone is recorded as
//      trusted in .claude.json first: the floor told the receiver it would be. The session is
//      confirmed through `claude agents --json`; the receiver opens it with `claude attach`, and a
//      harness that shows the repo's worktrees (Orca, for example) finds the worktree.
//
// A failed setup script or repo checkout doesn't stop the rest: the session still opens, and the step is reported
// with the end of its output. Output leaves the machine only after the secret scan.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { PROTOCOL_VERSION, type Handoff, type HandoffMessage, type HandoffRepo, type TakenMessage } from "@isoplan/protocol";
import os from "node:os";
import { promisify } from "node:util";
import { normalize, pathKey } from "../data-layer/git.js";
import type { NodeIo } from "../data-layer/io.js";
import { claudeCommand } from "../runner/claude-binary.js";
import { forkEnv, killTree } from "../runner/claude.js";
import { handoffBranch, remotesOf, sameRemote, type RunGit } from "./git.js";

/** The repo's own labelled settings file, at its top. */
export const REPO_CONFIG = "isoplan.json";

// The end of a step's output that goes to the meeting.
export const OUTPUT_TAIL = 2000;

type Failure = TakenMessage["failures"][number];

export interface TakeSettings {
  gitTimeoutSeconds: number;
  setupTimeoutMinutes: number;
  cloneSearchDays: number;
}

/** What opens a terminal: a launcher script written to `file`, then the command that runs it. */
export interface Launch {
  file: string;
  text: string;
  command: string[];
}

/** How a background session is started: `argv` in `cwd`, with no window. */
export interface Background {
  argv: string[];
  cwd: string;
}

export interface TakeOptions {
  run: RunGit;
  io: NodeIo;
  claudeDir: string;
  machine: string;
  platform: NodeJS.Platform;
  /** The environment the setup script and the session start from. */
  env: Record<string, string | undefined>;
  settings: () => Promise<TakeSettings>;
  /** The `claude` binary, or null when none can be found. */
  claude: () => Promise<string | null>;
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** Runs a launch; resolves once the terminal has been asked to open. */
  open?: (launch: Launch, env: Record<string, string>) => Promise<void>;
  /** Claude Code's .claude.json, where a folder's trust is kept. */
  claudeJson: string;
  /** Starts a background session; resolves once `claude --bg` has returned. */
  start?: (background: Background, env: Record<string, string>) => Promise<void>;
  /** The session ids of the background sessions Claude Code lists in `cwd`. */
  agents?: (bin: string, cwd: string, env: Record<string, string>) => Promise<string[]>;
  /** How long to wait for a background session to be listed. */
  confirmMs?: number;
  now?: () => number;
  newSession?: () => string;
  /** Which remotes a missing repo under the folder may be cloned from: by default `onTheWire`. */
  cloneFrom?: (remote: string) => boolean;
}

/** The handoff's folder on this machine: its brief, launcher and setup log. */
export const handoffDir = (claudeDir: string, id: string) => path.join(claudeDir, "isoplan", "handoffs", id);

const tail = (text: string) => (text.length > OUTPUT_TAIL ? "…" + text.slice(-OUTPUT_TAIL) : text).trim();

/** The main checkout of a clone of `remote` on this machine, the most recently used first, and that remote's name there; null with none. */
export async function findClone(io: NodeIo, run: RunGit, projectsDir: string, remote: string, since: number, timeoutMs: number): Promise<{ dir: string; remote: string } | null> {
  const tried = new Set<string>();
  for (const cwd of await recentFolders(io, projectsDir, since)) {
    const where = await run(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd, timeoutMs });
    if (where.code !== 0) continue;
    const [toplevel, commonDir] = where.stdout.split(/\r?\n/).map((s) => s.trim());
    if (!toplevel || !commonDir) continue;
    const main = normalize(commonDir).endsWith("/.git") ? path.dirname(commonDir) : toplevel;
    if (tried.has(pathKey(main))) continue;
    tried.add(pathKey(main));
    const match = (await remotesOf(run, main, timeoutMs))?.find((r) => r.urls.some((url) => sameRemote(url, remote)));
    if (match) return { dir: path.resolve(main), remote: match.name };
  }
  return null;
}

/**
 * The receiver's own folder for a handoff from a folder that isn't a repo (#56): the most recently
 * used session folder with a clone of one of `repos` at that repo's path in it, or the folder above
 * a session's repo that is one of them; null with none.
 */
export async function findWorkspace(io: NodeIo, run: RunGit, projectsDir: string, repos: HandoffRepo[], since: number, timeoutMs: number): Promise<string | null> {
  const tried = new Set<string>();
  const holds = async (folder: string) => {
    for (const repo of repos) {
      const dir = path.join(folder, repo.path);
      const top = await run(["rev-parse", "--show-toplevel"], { cwd: dir, timeoutMs });
      if (top.code !== 0 || pathKey(top.stdout.trim()) !== pathKey(dir)) continue;
      if ((await remotesOf(run, dir, timeoutMs))?.some((r) => r.urls.some((url) => sameRemote(url, repo.remote)))) return true;
    }
    return false;
  };
  for (const cwd of await recentFolders(io, projectsDir, since)) {
    const top = await run(["rev-parse", "--show-toplevel"], { cwd, timeoutMs });
    const candidates = [cwd];
    // A session in one of the repos: the folder its path in the handoff says is above it.
    if (top.code === 0) {
      const at = top.stdout.trim();
      for (const repo of repos) {
        const above = aboveOf(at, repo.path);
        if (pathKey(path.join(above, repo.path)) === pathKey(at)) candidates.push(above);
      }
    }
    for (const folder of candidates) {
      if (tried.has(pathKey(folder))) continue;
      tried.add(pathKey(folder));
      if (await holds(folder)) return path.resolve(folder);
    }
  }
  return null;
}

// The folders the machine's Claude Code sessions since `since` ran in, the most recent first, each once.
async function recentFolders(io: NodeIo, projectsDir: string, since: number): Promise<string[]> {
  const transcripts: { cwd: string; at: number }[] = [];
  for (const dir of await io.listDir(projectsDir)) {
    if (!dir.isDir) continue;
    for (const entry of await io.listDir(path.join(projectsDir, dir.name))) {
      if (entry.isDir || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(projectsDir, dir.name, entry.name);
      const st = await io.stat(file);
      if (!st || st.mtimeMs < since) continue;
      const cwd = await cwdOf(io, file, st.size);
      if (cwd) transcripts.push({ cwd, at: st.mtimeMs });
    }
  }
  transcripts.sort((a, b) => b.at - a.at);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { cwd } of transcripts) {
    if (seen.has(pathKey(cwd))) continue;
    seen.add(pathKey(cwd));
    if ((await io.stat(cwd))?.isDir) out.push(cwd);
  }
  return out;
}

// The folder a transcript's first lines name.
async function cwdOf(io: NodeIo, file: string, size: number): Promise<string | null> {
  for (const text of (await io.read(file, 0, Math.min(size, 65536)).catch(() => "")).split("\n")) {
    if (!text.includes('"cwd"')) continue;
    try {
      const cwd = (JSON.parse(text) as { cwd?: unknown }).cwd;
      if (typeof cwd === "string" && cwd) return cwd;
    } catch {
      // A line cut by the window's edge.
    }
  }
  return null;
}

export interface WorktreeSetup {
  command: string;
  timeoutMs: number;
}

/** `worktreeSetup` from isoplan.json's text, for this platform: null when it names no command here. Throws when malformed. */
export function parseSetup(text: string, platform: NodeJS.Platform, defaultTimeoutMs: number): WorktreeSetup | null {
  const value = JSON.parse(text) as { worktreeSetup?: unknown };
  const setup = value?.worktreeSetup as { command?: unknown; timeoutMinutes?: unknown } | undefined;
  if (setup === undefined) return null;
  if (!setup || typeof setup !== "object") throw new Error(`"worktreeSetup" in ${REPO_CONFIG} must be an object`);
  const key = platform === "win32" ? "windows" : platform === "darwin" ? "mac" : "linux";
  const c = setup.command;
  const command = c && typeof c === "object" ? (c as Record<string, unknown>)[key] : c;
  if (command !== undefined && (typeof command !== "string" || !command.trim())) throw new Error(`"worktreeSetup.command" in ${REPO_CONFIG} must be a command, or { "windows", "mac" } commands`);
  const t = setup.timeoutMinutes;
  if (t !== undefined && !(typeof t === "number" && Number.isFinite(t) && t > 0)) throw new Error(`"worktreeSetup.timeoutMinutes" in ${REPO_CONFIG} must be a number of minutes above 0`);
  return command ? { command, timeoutMs: typeof t === "number" ? t * 60000 : defaultTimeoutMs } : null;
}

/**
 * isoplan.json from the remote's default branch, as this clone knows it, and never from any other
 * branch. The default branch is `<remote>/HEAD`, else what the remote says its HEAD is; the branch
 * is fetched so the file is current. `problem` says why it couldn't be read; `text` is null when
 * the default branch has no isoplan.json.
 */
export async function readSetupFile(run: RunGit, clone: { dir: string; remote: string }, timeoutMs: number): Promise<{ text: string | null; problem: string | null }> {
  const git = (args: string[]) => run(args, { cwd: clone.dir, timeoutMs });
  let branch = (await git(["symbolic-ref", "-q", "--short", `refs/remotes/${clone.remote}/HEAD`])).stdout.trim().replace(`${clone.remote}/`, "");
  if (!branch) {
    const said = await git(["ls-remote", "--symref", clone.remote, "HEAD"]);
    branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(said.stdout)?.[1] ?? "";
  }
  if (!branch) return { text: null, problem: `Setup was skipped: ${clone.remote}'s default branch couldn't be told, so ${REPO_CONFIG} couldn't be read from it.` };
  const fetched = await git(["fetch", "-q", clone.remote, `+refs/heads/${branch}:refs/remotes/${clone.remote}/${branch}`]);
  if (fetched.code !== 0) return { text: null, problem: `Setup was skipped: ${clone.remote}/${branch} couldn't be fetched to read ${REPO_CONFIG}:\n${fetched.stderr}` };
  const shown = await git(["show", `refs/remotes/${clone.remote}/${branch}:${REPO_CONFIG}`]);
  return { text: shown.code === 0 ? shown.stdout : null, problem: null };
}

/** The setup command isoplan.json on the remote's default branch names for this platform, or null; never throws. */
export async function setupCommand(run: RunGit, clone: { dir: string; remote: string }, platform: NodeJS.Platform, timeoutMs: number): Promise<string | null> {
  const { text } = await readSetupFile(run, clone, timeoutMs);
  try {
    return text === null ? null : (parseSetup(text, platform, 0)?.command ?? null);
  } catch {
    return null;
  }
}

/** Runs `command` with the system shell, hidden; resolves with whether it exited 0, its output's end and whether it timed out. */
export function runShell(command: string, { cwd, env, timeoutMs }: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<{ ok: boolean; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const child = spawn(command, { cwd, env, shell: true, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
    child.stdin.end();
    const keep = (piece: string) => (output = (output + piece).slice(-64 * 1024));
    child.stdout.setEncoding("utf8").on("data", keep);
    child.stderr.setEncoding("utf8").on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: output + err.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, output: timedOut ? `${output}\nIt was stopped after ${Math.round(timeoutMs / 60000)} minutes.` : output, timedOut });
    });
  });
}

// One argument on a .cmd file's line. Inside the quotes & ( ) @ ^ | < > are plain characters; a
// quote can't be in a Windows path, so it is dropped, and % is doubled.
const cmdQuote = (s: string) => `"${s.replace(/"/g, "").replace(/%/g, "%%")}"`;
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The launcher that runs Claude Code in `dir`, and the command that opens it in a terminal: on
 * Windows a .cmd file that `start` opens in a new console (a Windows Terminal tab where that is the
 * default), on a Mac a .command file that Terminal opens. Null on any other platform.
 * CLAUDE_CONFIG_DIR, when set, is written into the launcher, since Terminal.app starts it with its
 * own environment, not the runner's.
 */
export function launch(platform: NodeJS.Platform, { folder, dir, argv, title, configDir }: { folder: string; dir: string; argv: string[]; title: string; configDir: string | null }): Launch | null {
  const name = title.replace(/["%^&|<>!()@]/g, "");
  if (platform === "win32") {
    const file = path.win32.join(folder, "open.cmd");
    // UTF-8 from the first line on, so a path with letters outside the console's code page works.
    const text = ["@echo off", "chcp 65001>nul", `title ${name}`, ...(configDir ? [`set "CLAUDE_CONFIG_DIR=${configDir.replace(/"/g, "").replace(/%/g, "%%")}"`] : []), `cd /d ${cmdQuote(dir)}`, argv.map(cmdQuote).join(" "), ""].join("\r\n");
    // cmd /k keeps a quoted path's quotes only when nothing special is in it, else it takes off the
    // outer pair: with two pairs, the path keeps one either way.
    return { file, text, command: [process.env.ComSpec || "cmd.exe", "/d", "/c", "start", `"${name}"`, "cmd.exe", "/k", `""${file}""`] };
  }
  if (platform === "darwin") {
    const file = path.posix.join(folder, "open.command");
    const text = ["#!/bin/sh", ...(configDir ? [`export CLAUDE_CONFIG_DIR=${shQuote(configDir)}`] : []), `cd ${shQuote(dir)} || exit 1`, `exec ${argv.map(shQuote).join(" ")}`, ""].join("\n");
    return { file, text, command: ["open", "-a", "Terminal", file] };
  }
  return null;
}

/** Writes the launcher and runs the command that opens it; rejects when it couldn't. */
export async function openLaunch(l: Launch, env: Record<string, string>): Promise<void> {
  await fs.writeFile(l.file, l.text, { mode: 0o755 });
  const [cmd, ...args] = l.command;
  await new Promise<void>((resolve, reject) => {
    // `start` and `open` return once the terminal has the launcher; Windows' quoting is written out.
    const child = spawn(cmd!, args, { env, stdio: "ignore", detached: true, windowsHide: true, windowsVerbatimArguments: process.platform === "win32" });
    const timer = setTimeout(() => (child.unref(), resolve()), 15000);
    child.on("error", (err) => (clearTimeout(timer), reject(err)));
    child.on("exit", (code) => (clearTimeout(timer), code === 0 ? resolve() : reject(new Error(`${path.basename(cmd!)} exited with code ${code}`))));
  });
}

// Runs a command hidden and waits for it, with its output; never opens a window.
function hidden([cmd, ...args]: string[], cwd: string, env: Record<string, string>, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd!, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stdout.setEncoding("utf8").on("data", (piece: string) => (stdout += piece));
    child.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-OUTPUT_TAIL)));
    const timer = setTimeout(() => killTree(child as never), timeoutMs);
    child.on("error", (err) => (clearTimeout(timer), resolve({ code: null, stdout, stderr: err.message })));
    child.on("close", (code) => (clearTimeout(timer), resolve({ code, stdout, stderr })));
  });
}

/** Starts `claude --bg`, hidden, which returns once the background session is up; rejects when it couldn't. */
export async function startBackground({ argv, cwd }: Background, env: Record<string, string>): Promise<void> {
  const r = await hidden(argv, cwd, env, 60000);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `claude exited with code ${r.code}`);
}

/** The session ids of the background sessions `claude agents --json --all --cwd <cwd>` lists. */
export async function listAgents(bin: string, cwd: string, env: Record<string, string>): Promise<string[]> {
  const r = await hidden([...claudeCommand(bin), "agents", "--json", "--all", "--cwd", cwd], cwd, env, 30000);
  if (r.code !== 0) return [];
  try {
    const listed = JSON.parse(r.stdout) as unknown;
    const rows = Array.isArray(listed) ? listed : ((listed as { agents?: unknown })?.agents ?? []);
    return (rows as { sessionId?: unknown }[]).map((a) => a?.sessionId).filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** The key Claude Code keeps a folder under in .claude.json's projects: forward slashes on Windows too. */
export const trustKey = (dir: string, platform: NodeJS.Platform) => (platform === "win32" ? path.win32.resolve(dir).replace(/\\/g, "/") : path.posix.resolve(dir));

/**
 * Records Claude Code's trust for `dir` alone in .claude.json (projects[dir].hasTrustDialogAccepted),
 * changing nothing else in the file: it is read, changed in that one place, written beside itself
 * and moved over it.
 */
export async function trustFolder(claudeJson: string, dir: string, platform: NodeJS.Platform): Promise<void> {
  const text = await fs.readFile(claudeJson, "utf8").catch((err: NodeJS.ErrnoException) => (err.code === "ENOENT" ? "{}" : Promise.reject(err)));
  const config = JSON.parse(text) as { projects?: Record<string, Record<string, unknown>> };
  const key = trustKey(dir, platform);
  if (config.projects?.[key]?.hasTrustDialogAccepted === true) return;
  config.projects = config.projects ?? {};
  config.projects[key] = { ...(config.projects[key] ?? {}), hasTrustDialogAccepted: true };
  const temp = `${claudeJson}.isoplan-${process.pid}`;
  await fs.writeFile(temp, JSON.stringify(config, null, 2) + (text.endsWith("\n") ? "\n" : ""), { mode: 0o600 });
  await fs.rename(temp, claudeJson);
}

/** The first thing the new session is told. */
export function takePrompt(id: string, brief: string, setupLog: string | null, failedRepos: string[] = []): string {
  return [
    `Isoplan handoff ${id}: you are taking this work over.`,
    `Read its brief in ${brief} first.`,
    ...(setupLog ? [`The worktree's setup script failed; the end of its output is in ${setupLog}.`] : []),
    ...(failedRepos.length ? [`These repos in this folder couldn't be put on the handoff's branch, so check them first: ${failedRepos.join(", ")}.`] : []),
    "Then say where things stand and what you would do next, and wait for me before changing anything.",
  ].join(" ");
}

/**
 * Claude Code's command line for the new session. The prompt comes first: `--add-dir` takes every
 * argument after it, and would take the prompt too.
 */
export function sessionArgv(bin: string, { prompt, session, name, folder, headless }: { prompt: string; session: string; name: string; folder: string; headless: boolean }): string[] {
  return [...claudeCommand(bin), prompt, ...(headless ? ["--bg"] : []), "--session-id", session, "--name", name, "--add-dir", folder];
}

/** The commits this machine took of a handoff before, which a re-take may move past. */
async function takenBefore(folder: string): Promise<string[]> {
  try {
    const { commits } = JSON.parse(await fs.readFile(path.join(folder, "taken.json"), "utf8")) as { commits?: unknown };
    return Array.isArray(commits) ? commits.filter((c): c is string => typeof c === "string" && /^[0-9a-f]{40,64}$/.test(c)) : [];
  } catch {
    return [];
  }
}

async function recordTaken(folder: string, commit: string): Promise<void> {
  const commits = [...new Set([...(await takenBefore(folder)), commit])].slice(-50);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "taken.json"), JSON.stringify({ about: "The commits of this handoff taken on this machine, which a later take may replace.", commits }, null, 2) + "\n");
}

// An empty folder as core.hooksPath, so no hook of the repo's runs while the handoff's branch is
// checked out: they would be the sender's, from that branch.
let emptyHooks: Promise<string> | null = null;
const noHooks = async () => ["-c", `core.hooksPath=${await (emptyHooks ??= fs.mkdtemp(path.join(os.tmpdir(), "isoplan-no-hooks-")))}`];

/** Takes the handoff on this machine; never throws. */
export async function takeHandoff(message: Pick<HandoffMessage, "handoff" | "mode" | "session">, o: TakeOptions): Promise<TakenMessage> {
  const { handoff } = message;
  const headless = message.mode === "headless";
  const failures: Failure[] = [];
  const done = (session?: string): TakenMessage => ({ type: "taken", v: PROTOCOL_VERSION, handoff: handoff.id, ...(session ? { session } : {}), failures });
  const fail = async (step: Failure["step"], output: string, repo?: string) => {
    const matched = await o.scan(output);
    failures.push({ step, ...(repo ? { repo } : {}), output: matched ? `The end of its output is withheld here: it matches a secret pattern. It is on ${o.machine}.` : tail(output) });
  };
  // A window opens only when the receiver asked for a terminal: a handoff that doesn't say is refused.
  if (message.mode !== "terminal" && message.mode !== "headless") {
    await fail("open", "The office server didn't say how to open the session, so none was opened: take it again from the floor.");
    return done();
  }
  try {
    const s = await o.settings();
    const timeoutMs = s.gitTimeoutSeconds * 1000;
    const repo = handoff.repos.find((r) => r.path === ".");
    const branch = repo?.branch ?? handoffBranch(handoff.id);
    const subs = byDepth(handoff.repos.filter((r) => r.path !== "."));
    const now = (o.now ?? Date.now)();
    const since = now - s.cloneSearchDays * 86400000;
    const projects = path.join(o.claudeDir, "projects");
    const folder = handoffDir(o.claudeDir, handoff.id);

    let dir: string;
    let clone: { dir: string; remote: string } | null = null;
    if (repo) {
      clone = await findClone(o.io, o.run, projects, repo.remote, since, timeoutMs);
      if (!clone) {
        await fail("worktree", `No clone of ${repo.remote} was found on ${o.machine}: none of its Claude Code sessions from the last ${s.cloneSearchDays} days ran in one. Open Claude Code once in your clone of the repo, then take the handoff again, or copy its prompt into a session there.`);
        return done();
      }
      const fetched = await o.run(["fetch", clone.remote, `+refs/heads/${branch}:refs/remotes/${clone.remote}/${branch}`], { cwd: clone.dir, timeoutMs });
      if (fetched.code !== 0) {
        await fail("worktree", `git fetch ${clone.remote} ${branch} in ${clone.dir} failed${fetched.timedOut ? " (it took too long)" : ""}:\n${fetched.stderr}`);
        return done();
      }
      const made = await worktreeFor(o.run, clone.dir, clone.remote, branch, handoff.id, await takenBefore(folder), timeoutMs);
      if (typeof made !== "string") {
        await fail("worktree", made.error);
        return done();
      }
      dir = made;
      await recordTaken(folder, (await resolved(o.run, dir, "HEAD", timeoutMs)) ?? repo.commit);
    } else {
      // A handoff from a plain folder above its repos: a plain folder beside the receiver's own.
      const workspace = await findWorkspace(o.io, o.run, projects, subs, since, timeoutMs);
      if (!workspace) {
        await fail("worktree", `No folder holding a clone of ${subs.map((r) => r.remote).join(" or ")} at its path in the handoff (${subs.map((r) => r.path).join(", ")}) was found on ${o.machine}: none of its Claude Code sessions from the last ${s.cloneSearchDays} days ran in one. Open Claude Code once in your folder of these repos, then take the handoff again, or copy its prompt into a session there.`);
        return done();
      }
      const own = `-handoff-${handoff.id}`;
      dir = path.basename(workspace).endsWith(own) ? workspace : `${workspace}${own}`;
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.mkdir(folder, { recursive: true });
    const briefFile = path.join(folder, "brief.md");
    await fs.writeFile(briefFile, handoff.brief + "\n");
    const env = forkEnv(o.env);

    // A new session is spawned, so the setup script always runs, when there is a repo to read it from.
    let setupLog: string | null = null;
    let setup: WorktreeSetup | null = null;
    if (clone) {
      const config = await readSetupFile(o.run, clone, timeoutMs);
      if (config.problem) await fail("setup", config.problem);
      try {
        setup = config.text === null ? null : parseSetup(config.text, o.platform, s.setupTimeoutMinutes * 60000);
      } catch (err) {
        await fail("setup", `${REPO_CONFIG} couldn't be read: ${(err as Error).message}`);
      }
    }
    if (setup) {
      o.log(`handoff ${handoff.id}: running the worktree setup script in ${dir}`);
      const r = await runShell(setup.command, { cwd: dir, env: { ...env, ISOPLAN_HANDOFF_ID: handoff.id, ISOPLAN_HANDOFF_BRANCH: branch }, timeoutMs: setup.timeoutMs });
      if (!r.ok) {
        setupLog = path.join(folder, "setup.log");
        await fs.writeFile(setupLog, r.output);
        await fail("setup", r.output || "The setup script failed with no output.");
      }
    }

    // The repos under the folder, after setup, which may have cloned some of them on main.
    const failedRepos: string[] = [];
    for (const sub of subs) {
      const error = await repoAt(o.run, dir, sub, folder, timeoutMs, o.cloneFrom ?? onTheWire);
      if (!error) continue;
      failedRepos.push(sub.path);
      await fail("checkout", error, sub.path);
    }

    const bin = await o.claude();
    if (!bin) {
      await fail("open", "The claude binary wasn't found on this machine: run the plugin's install script, or set its path in ~/.claude/isoplan/claude-binary.json.");
      return done();
    }
    const id = message.session ?? (o.newSession ?? randomUUID)();
    const name = `Isoplan handoff ${handoff.id}`;
    const argv = sessionArgv(bin, { prompt: takePrompt(handoff.id, briefFile, setupLog, failedRepos), session: id, name, folder, headless });
    if (headless) {
      try {
        // The floor told the receiver: this trusts the worktree, so its settings, hooks and scripts run.
        await trustFolder(o.claudeJson, dir, o.platform);
        await (o.start ?? startBackground)({ argv, cwd: dir }, env);
      } catch (err) {
        await fail("open", `The headless session couldn't be started: ${(err as Error).message}. The worktree is ${dir}.`);
        return done();
      }
      const end = Date.now() + (o.confirmMs ?? 15000);
      let listed = false;
      while (!listed && Date.now() < end) {
        listed = (await (o.agents ?? listAgents)(bin, dir, env)).includes(id);
        if (!listed) await new Promise((r) => setTimeout(r, 500));
      }
      if (!listed) {
        await fail("open", `claude --bg returned, but \`claude agents\` doesn't list session ${id} in ${dir}, so it may not have started. Open Claude Code there yourself.`);
        return done();
      }
      o.log(`handoff ${handoff.id}: started background Claude Code session ${id} in ${dir}`);
      return done(`claude-code:${id}`);
    }
    const l = launch(o.platform, { folder, dir, argv, title: name, configDir: o.env.CLAUDE_CONFIG_DIR ?? null });
    if (!l) {
      await fail("open", `Opening a terminal isn't supported on ${o.platform} yet. The worktree is ${dir} and the brief is ${briefFile}: open Claude Code there yourself.`);
      return done();
    }
    try {
      await (o.open ?? openLaunch)(l, env);
    } catch (err) {
      await fail("open", `The terminal couldn't be opened: ${(err as Error).message}. The worktree is ${dir}.`);
      return done();
    }
    o.log(`handoff ${handoff.id}: opened Claude Code session ${id} in ${dir}`);
    return done(`claude-code:${id}`);
  } catch (err) {
    o.log(`handoff ${handoff.id}: taking it failed: ${(err as Error)?.stack ?? String(err)}`);
    if (!failures.length) failures.push({ step: "worktree", output: "The runner failed while taking the handoff; its log on this machine says why." });
    return done();
  }
}

/**
 * How many commits `ref` has that neither the new tip nor any commit this machine took of the
 * handoff before (`exempt`, which a new hand-over replaces) has: the receiver's own work. Null when
 * git can't say.
 */
async function ahead(run: RunGit, cwd: string, tip: string, exempt: string[], ref: string, timeoutMs: number): Promise<number | null> {
  const known: string[] = [];
  for (const c of exempt) if ((await run(["cat-file", "-e", `${c}^{commit}`], { cwd, timeoutMs })).code === 0) known.push(c);
  const r = await run(["rev-list", "--count", ref, "--not", tip, ...known], { cwd, timeoutMs });
  return r.code === 0 ? Number(r.stdout.trim()) : null;
}

/** What a ref points at now, or null. */
async function resolved(run: RunGit, cwd: string, ref: string, timeoutMs: number): Promise<string | null> {
  const r = await run(["rev-parse", "--verify", "-q", ref], { cwd, timeoutMs });
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * The shortcut's checkout (/isoplan:take): the handoff's branch in the session's own folder, fetched
 * from the remote there that is the handoff's, with the repo's hooks off. A folder with uncommitted
 * changes to tracked files is left as it is, rather than carrying them over. A local branch of that
 * name moves to the fetched tip, unless it has commits that are neither in the tip nor ones this
 * machine took of the handoff before (recorded in `folder`), which would be lost: then it is left as
 * it is. The repos under the folder (#56) follow, each at its path in the folder, cloned where
 * missing, as on the floor; they are left alone when the folder's own repo fails. The folder is the
 * session's repo's top, or the session's folder for a handoff from a plain folder; a session in one
 * of the handoff's repos under the folder works from the folder above it, and a plain folder's
 * handoff isn't taken inside some other repo. No setup script runs: the person, or their harness,
 * set up this folder. Returns the failed steps, each with the end of git's output and the repo it
 * was in when that is one under the folder, and the folder's own repo's remote name.
 */
export async function checkoutHere(run: RunGit, cwd: string, handoff: Handoff, folder: string, timeoutMs: number, { cloneFrom = onTheWire }: { cloneFrom?: (remote: string) => boolean } = {}): Promise<{ failures: Failure[]; remote: string | null; dir: string }> {
  const repo = handoff.repos.find((r) => r.path === ".");
  const subs = byDepth(handoff.repos.filter((r) => r.path !== "."));
  const refused = (output: string, remote: string | null = null) => ({ failures: [{ step: "checkout" as const, output: tail(output) }], remote, dir: at ?? cwd });
  const top = await run(["rev-parse", "--show-toplevel"], { cwd, timeoutMs });
  const at = top.code === 0 ? top.stdout.trim() : null;
  let inside: HandoffRepo | undefined;
  for (const sub of at ? subs : []) {
    if (pathKey(path.join(aboveOf(at!, sub.path), sub.path)) !== pathKey(at!)) continue;
    if ((await remotesOf(run, at!, timeoutMs))?.some((r) => r.urls.some((url) => sameRemote(url, sub.remote)))) inside = sub;
  }
  const base = inside ? aboveOf(at!, inside.path) : (at ?? cwd);
  let remote: string | null = null;
  if (repo) {
    const own = at ? await checkoutIn(run, base, repo, repo.branch, folder, timeoutMs) : { error: `${cwd} isn't in a git repo.`, remote: null };
    if (own.error) return refused(own.error, own.remote);
    remote = own.remote;
  } else if (at && !inside) {
    return refused(`${cwd} is inside the repo at ${at}, which isn't one of this handoff's repos (${subs.map((r) => r.path).join(", ")}), so nothing was cloned into it. Take it from the folder that holds them, or an empty one.`);
  }
  const failures: Failure[] = [];
  for (const sub of subs) {
    const error = await repoAt(run, base, sub, folder, timeoutMs, cloneFrom);
    if (error) failures.push({ step: "checkout", repo: sub.path, output: tail(error) });
  }
  return { failures, remote, dir: base };
}

// The handoff's branch checked out in the repo at `cwd`, by the shortcut's rules; the error, else null.
async function checkoutIn(run: RunGit, cwd: string, repo: HandoffRepo, branch: string, folder: string, timeoutMs: number): Promise<{ error: string | null; remote: string | null }> {
  const git = (args: string[]) => run(args, { cwd, timeoutMs });
  const remotes = await remotesOf(run, cwd, timeoutMs);
  const failed = (error: string, remote: string | null = null) => ({ error, remote });
  if (!remotes) return failed(`${cwd} isn't in a git repo.`);
  const name = remotes.find((r) => r.urls.some((url) => sameRemote(url, repo.remote)))?.name;
  if (!name) return failed(`No remote of the repo in ${cwd} is ${repo.remote}, the repo the handoff was pushed to.`);
  if ((await git(["status", "--porcelain", "--untracked-files=no"])).stdout.trim()) {
    return failed(`${cwd} has uncommitted changes to tracked files, so the handoff's branch wasn't checked out over them. Commit or stash them, then take it again.`, name);
  }
  const tip = `refs/remotes/${name}/${branch}`;
  const fetched = await git(["fetch", name, `+refs/heads/${branch}:${tip}`]);
  if (fetched.code !== 0) return failed(`git fetch ${name} ${branch}: ${fetched.stderr}`, name);
  const hooksOff = await noHooks();
  const ok = async () => {
    await recordTaken(folder, (await resolved(run, cwd, "HEAD", timeoutMs)) ?? repo.commit);
    return { error: null, remote: name };
  };
  const local = await git(["rev-parse", "--verify", "-q", `refs/heads/${branch}`]);
  if (local.code !== 0) {
    const switched = await git([...hooksOff, "switch", "--track", "-c", branch, `${name}/${branch}`]);
    return switched.code === 0 ? ok() : failed(`git switch ${branch}: ${switched.stderr}`, name);
  }
  const extra = await ahead(run, cwd, tip, await takenBefore(folder), `refs/heads/${branch}`, timeoutMs);
  if (extra !== 0) return failed(`The local branch ${branch} has ${extra ?? "some"} commit(s) that aren't in the handoff as handed over now, so it was left as it is. Merge or rebase them onto ${name}/${branch} yourself.`, name);
  const switched = await git([...hooksOff, "switch", branch]);
  if (switched.code !== 0) return failed(`git switch ${branch}: ${switched.stderr}`, name);
  const moved = await git([...hooksOff, "reset", "-q", "--keep", tip]);
  return moved.code === 0 ? ok() : failed(`${branch} couldn't be moved to the handoff as handed over now:\n${moved.stderr}`, name);
}

// Repos parents first, so one under another is checked out after it.
const byDepth = (repos: HandoffRepo[]) => [...repos].sort((a, b) => a.path.split("/").length - b.path.split("/").length);

// The folder above a repo at `at` whose path in that folder is `p`.
const aboveOf = (at: string, p: string) => path.resolve(at, ...p.split("/").map(() => ".."));

/**
 * Whether a missing repo may be cloned from `remote`: https, ssh or scp-style (host:path) only, so
 * a handoff never points git at a local path, a file:// URL or a \\server share on this machine.
 */
export function onTheWire(remote: string): boolean {
  const url = /^([a-z][a-z0-9+.-]*):\/\//i.exec(remote);
  if (url) return ["https", "ssh", "git+ssh", "ssh+git"].includes(url[1]!.toLowerCase());
  // scp-style: a colon before any slash, after more than a drive letter.
  const scp = /^([^/\\]*):/.exec(remote);
  return !!scp && scp[1]!.length > 1 && !remote.startsWith("\\");
}

// The real path, with Windows' short 8.3 names spelled out long.
const realpathNative = promisify(realpath.native);

// A path segment Windows reads as `.git`: trailing dots and spaces dropped, in any case, or a short 8.3 name.
const isGitFolder = (segment: string) => {
  const name = segment.replace(/[. ]+$/, "").toLowerCase();
  return name === ".git" || /^git~\d+$/.test(name);
};

/**
 * A repo under the folder (#56) on its handoff branch at its path in `base`: switched where a clone
 * of it is there, cloned where there is nothing or an empty folder, from a remote `cloneFrom`
 * allows, with Git LFS's download off (a handoff never carries LFS files). The error, else null.
 */
async function repoAt(run: RunGit, base: string, repo: HandoffRepo, folder: string, timeoutMs: number, cloneFrom: (remote: string) => boolean): Promise<string | null> {
  if (repo.path.split(/[\\/]/).some(isGitFolder)) return `${repo.path} is inside a .git folder, so nothing was checked out there.`;
  const target = path.join(base, repo.path);
  // The path stays inside the folder: no link on the way (one the handoff's branch made, say)
  // leads out, and no folder on it is a .git folder by its real, long name.
  let existing = target;
  while (!(await fs.lstat(existing).then(() => true, () => false))) existing = path.dirname(existing);
  const realBase = await realpathNative(base);
  const real = await realpathNative(existing);
  if (pathKey(real) !== pathKey(path.join(realBase, path.relative(base, existing)))) return `${target} leads outside ${base} through a link, so nothing was checked out there.`;
  if (path.relative(realBase, real).split(/[\\/]/).some(isGitFolder)) return `${repo.path} is inside a .git folder, so nothing was checked out there.`;
  const st = await fs.lstat(target).catch(() => null);
  if (st && !st.isDirectory()) return `${target} is there already and isn't a folder, so ${repo.remote} wasn't cloned there.`;
  if (!st || (await fs.readdir(target)).length === 0) {
    if (!cloneFrom(repo.remote)) return `${repo.path} isn't here, and ${repo.remote} isn't an https, ssh or host:path remote, so it wasn't cloned: a handoff never clones from a local path, a file:// URL or a \\\\server share. Clone it at ${target} yourself, then take the handoff again.`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    const cloned = await run([...(await noHooks()), "clone", "-q", "--branch", repo.branch, "--", repo.remote, target], { cwd: base, timeoutMs, env: { GIT_LFS_SKIP_SMUDGE: "1" } });
    if (cloned.code !== 0) return `git clone ${repo.remote} ${repo.path} failed${cloned.timedOut ? " (it took too long)" : ""}:\n${cloned.stderr}`;
    await recordTaken(folder, (await resolved(run, target, "HEAD", timeoutMs)) ?? repo.commit);
    return null;
  }
  const top = await run(["rev-parse", "--show-toplevel"], { cwd: target, timeoutMs });
  if (top.code !== 0 || pathKey(top.stdout.trim()) !== pathKey(target)) return `${target} is there already and isn't a repo of its own, so ${repo.remote} wasn't cloned into it.`;
  return (await checkoutIn(run, target, repo, repo.branch, folder, timeoutMs)).error;
}

// The worktree for the handoff: one already made on its branch, moved to the new tip when nothing
// in it would be lost, else a new sibling of the clone.
async function worktreeFor(run: RunGit, clone: string, remote: string, branch: string, id: string, exempt: string[], timeoutMs: number): Promise<string | { error: string }> {
  const tip = `refs/remotes/${remote}/${branch}`;
  const hooksOff = await noHooks();
  const base = path.join(path.dirname(clone), `${path.basename(clone)}-handoff-${id}`);
  for (let n = 1; n < 10; n++) {
    const dir = n === 1 ? base : `${base}-${n}`;
    const exists = await fs.stat(dir).then(() => true, () => false);
    if (exists) {
      const head = await run(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, timeoutMs });
      if (head.code !== 0 || head.stdout.trim() !== branch) continue;
      // Untracked files (a setup script's own, say) are kept by the reset, so only tracked changes count.
      const dirty = (await run(["status", "--porcelain", "--untracked-files=no"], { cwd: dir, timeoutMs })).stdout.trim() !== "";
      const extra = await ahead(run, dir, tip, exempt, "HEAD", timeoutMs);
      if (dirty || extra !== 0) {
        return { error: `${dir}, this handoff's worktree from before, has work that isn't in the handoff as handed over now (${dirty ? "uncommitted changes" : `${extra ?? "some"} commit(s)`}), so it was left as it is. Commit and push it, or move it aside, then take the handoff again.` };
      }
      const moved = await run([...hooksOff, "reset", "-q", "--keep", tip], { cwd: dir, timeoutMs });
      return moved.code === 0 ? dir : { error: `${dir} couldn't be moved to the handoff as handed over now:\n${moved.stderr}` };
    }
    // A local branch of the handoff's name with commits the remote's doesn't have is never reset.
    if ((await run(["rev-parse", "--verify", "-q", `refs/heads/${branch}`], { cwd: clone, timeoutMs })).code === 0) {
      const extra = await ahead(run, clone, tip, exempt, `refs/heads/${branch}`, timeoutMs);
      if (extra !== 0) return { error: `The local branch ${branch} in ${clone} has ${extra ?? "some"} commit(s) that aren't in the handoff as handed over now, so no worktree was made over it. Push or move them, then take the handoff again.` };
    }
    const r = await run([...hooksOff, "worktree", "add", "--track", "-B", branch, dir, `${remote}/${branch}`], { cwd: clone, timeoutMs });
    return r.code === 0 ? dir : { error: `git worktree add ${dir} failed${r.timedOut ? " (it took too long)" : ""}:\n${r.stderr}` };
  }
  return { error: `${base} and the next eight names beside it are taken by other folders` };
}
