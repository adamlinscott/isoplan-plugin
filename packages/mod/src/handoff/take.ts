// Taking a handoff from the floor (#48): the receiver's runner does it, in order.
//
// 1. The clone: the machine's Claude Code sessions from the last `cloneSearchDays` say which folders
//    the receiver works in. Each is placed with git, newest first, and the main checkout of the first
//    whose remote is the handoff's (the same project id, or the same path for a local remote) is the
//    clone. Without one nothing can be made, so no session opens and the handoff stays to be taken.
// 2. The worktree: a sibling of the clone, <clone>-handoff-<id>, on isoplan/handoff/<id>, tracking
//    the remote's branch. One made for this handoff before moves to the branch as handed over now,
//    unless it holds work that isn't in it (uncommitted changes, or commits not on the new tip): then
//    it is left as it is and the take is refused with a note. A local branch is never reset over
//    commits the remote doesn't have.
// 3. The setup script (E11): `worktreeSetup` in isoplan.json at the repo's top, read from the
//    receiver's own copy of the remote's default branch, and never from any other branch, so neither
//    the handoff nor whatever the clone has checked out can change what runs. When the default branch
//    can't be told, setup is skipped and the meeting says why. It runs with the system shell (cmd.exe
//    on Windows, /bin/sh on a Mac) in the worktree, hidden, with ISOPLAN_HANDOFF_ID and
//    ISOPLAN_HANDOFF_BRANCH set, under its timeout. Its output goes to setup.log in the handoff's
//    folder.
// 4. Claude Code in the worktree, under the session id the server chose, so that session alone may
//    join the room, told to read the brief, which is in brief.md in the handoff's folder
//    (<claude dir>/isoplan/handoffs/<id>/). As the receiver chose on the floor:
//    - `terminal`: a terminal window, the only thing here that opens one, and only for that click
//      (Windows: `start`, a Windows Terminal tab where that is the default; Mac: Terminal.app);
//    - `headless`: `claude -p` in the worktree with no window at all. It reads the brief and answers
//      once, then exits, and the receiver resumes it (`claude --resume <id>` in the worktree), where a
//      harness that shows the repo's worktrees (Orca, for example) finds the worktree.
//
// A step that fails is reported with the end of its output, and the rest still runs: a failed setup
// script still opens the session. Output leaves the machine only after the secret scan.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PROTOCOL_VERSION, type Handoff, type HandoffMessage, type HandoffRepo, type TakenMessage } from "@isoplan/protocol";
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

/** How a headless session is started: `argv` in `cwd`, with no window. */
export interface Headless {
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
  /** Starts a headless session; resolves once it has started. */
  start?: (headless: Headless, env: Record<string, string>) => Promise<void>;
  now?: () => number;
  newSession?: () => string;
}

/** The handoff's folder on this machine: its brief, launcher and setup log. */
export const handoffDir = (claudeDir: string, id: string) => path.join(claudeDir, "isoplan", "handoffs", id);

const tail = (text: string) => (text.length > OUTPUT_TAIL ? "…" + text.slice(-OUTPUT_TAIL) : text).trim();

/** The main checkout of a clone of `remote` on this machine, the most recently used first, and that remote's name there; null with none. */
export async function findClone(io: NodeIo, run: RunGit, projectsDir: string, remote: string, since: number, timeoutMs: number): Promise<{ dir: string; remote: string } | null> {
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
  const tried = new Set<string>();
  for (const { cwd } of transcripts) {
    if (tried.has(pathKey(cwd))) continue;
    tried.add(pathKey(cwd));
    if (!(await io.stat(cwd))?.isDir) continue;
    const where = await run(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd, timeoutMs });
    if (where.code !== 0) continue;
    const [toplevel, commonDir] = where.stdout.split(/\r?\n/).map((s) => s.trim());
    if (!toplevel || !commonDir) continue;
    const main = normalize(commonDir).endsWith("/.git") ? path.dirname(commonDir) : toplevel;
    if (tried.has(`main:${pathKey(main)}`)) continue;
    tried.add(`main:${pathKey(main)}`);
    const match = (await remotesOf(run, main, timeoutMs))?.find((r) => sameRemote(r.url, remote));
    if (match) return { dir: path.resolve(main), remote: match.name };
  }
  return null;
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
    const text = ["@echo off", `title ${name}`, ...(configDir ? [`set "CLAUDE_CONFIG_DIR=${configDir.replace(/"/g, "").replace(/%/g, "%%")}"`] : []), `cd /d ${cmdQuote(dir)}`, argv.map(cmdQuote).join(" "), ""].join("\r\n");
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

/** Starts a headless session: hidden, detached, with nothing to read its output; resolves once it has started. */
export function startHeadless({ argv: [cmd, ...args], cwd }: Headless, env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd!, args, { cwd, env, stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", reject);
    child.on("spawn", () => (child.unref(), resolve()));
  });
}

/** The first thing the new session is told. */
export function takePrompt(id: string, brief: string, setupLog: string | null): string {
  return [
    `Isoplan handoff ${id}: you are taking this work over.`,
    `Read its brief in ${brief} first.`,
    ...(setupLog ? [`The worktree's setup script failed; the end of its output is in ${setupLog}.`] : []),
    "Then say where things stand and what you would do next, and wait for me before changing anything.",
  ].join(" ");
}

/**
 * Claude Code's command line for the new session. The prompt comes first: `--add-dir` takes every
 * argument after it, and would take the prompt too.
 */
export function sessionArgv(bin: string, { prompt, session, name, folder, headless }: { prompt: string; session: string; name: string; folder: string; headless: boolean }): string[] {
  return [...claudeCommand(bin), ...(headless ? ["-p"] : []), prompt, "--session-id", session, "--name", name, "--add-dir", folder];
}

/** Takes the handoff on this machine; never throws. */
export async function takeHandoff(message: Pick<HandoffMessage, "handoff" | "mode" | "session">, o: TakeOptions): Promise<TakenMessage> {
  const { handoff } = message;
  const headless = message.mode === "headless";
  const failures: Failure[] = [];
  const done = (session?: string): TakenMessage => ({ type: "taken", v: PROTOCOL_VERSION, handoff: handoff.id, ...(session ? { session } : {}), failures });
  const fail = async (step: Failure["step"], output: string) => {
    const matched = await o.scan(output);
    failures.push({ step, output: matched ? `The end of its output is withheld here: it matches a secret pattern. It is on ${o.machine}.` : tail(output) });
  };
  try {
    const s = await o.settings();
    const timeoutMs = s.gitTimeoutSeconds * 1000;
    const branch = handoffBranch(handoff.id);
    // #56 adds the sub-repos; here the session's own repo is the one at the folder itself.
    const repo: HandoffRepo = handoff.repos.find((r) => r.path === ".") ?? handoff.repos[0]!;
    const now = (o.now ?? Date.now)();

    const clone = await findClone(o.io, o.run, path.join(o.claudeDir, "projects"), repo.remote, now - s.cloneSearchDays * 86400000, timeoutMs);
    if (!clone) {
      await fail("worktree", `No clone of ${repo.remote} was found on ${o.machine}: none of its Claude Code sessions from the last ${s.cloneSearchDays} days ran in one. Open Claude Code once in your clone of the repo, then take the handoff again, or copy its prompt into a session there.`);
      return done();
    }
    const git = (args: string[], cwd: string) => o.run(args, { cwd, timeoutMs });
    const before = await resolved(o.run, clone.dir, `refs/remotes/${clone.remote}/${branch}`, timeoutMs);
    const fetched = await git(["fetch", clone.remote, `+refs/heads/${branch}:refs/remotes/${clone.remote}/${branch}`], clone.dir);
    if (fetched.code !== 0) {
      await fail("worktree", `git fetch ${clone.remote} ${branch} in ${clone.dir} failed${fetched.timedOut ? " (it took too long)" : ""}:\n${fetched.stderr}`);
      return done();
    }
    const dir = await worktreeFor(o.run, clone.dir, clone.remote, branch, handoff.id, before, timeoutMs);
    if (typeof dir !== "string") {
      await fail("worktree", dir.error);
      return done();
    }

    const folder = handoffDir(o.claudeDir, handoff.id);
    await fs.mkdir(folder, { recursive: true });
    const briefFile = path.join(folder, "brief.md");
    await fs.writeFile(briefFile, handoff.brief + "\n");
    const env = forkEnv(o.env);

    // A new session is spawned, so the setup script always runs.
    let setupLog: string | null = null;
    const config = await readSetupFile(o.run, clone, timeoutMs);
    if (config.problem) await fail("setup", config.problem);
    let setup: WorktreeSetup | null = null;
    try {
      setup = config.text === null ? null : parseSetup(config.text, o.platform, s.setupTimeoutMinutes * 60000);
    } catch (err) {
      await fail("setup", `${REPO_CONFIG} couldn't be read: ${(err as Error).message}`);
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

    const bin = await o.claude();
    if (!bin) {
      await fail("open", "The claude binary wasn't found on this machine: run the plugin's install script, or set its path in ~/.claude/isoplan/claude-binary.json.");
      return done();
    }
    const id = message.session ?? (o.newSession ?? randomUUID)();
    const name = `Isoplan handoff ${handoff.id}`;
    const argv = sessionArgv(bin, { prompt: takePrompt(handoff.id, briefFile, setupLog), session: id, name, folder, headless });
    if (headless) {
      try {
        await (o.start ?? startHeadless)({ argv, cwd: dir }, env);
      } catch (err) {
        await fail("open", `The headless session couldn't be started: ${(err as Error).message}. The worktree is ${dir}.`);
        return done();
      }
      o.log(`handoff ${handoff.id}: started headless Claude Code session ${id} in ${dir}`);
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
 * How many commits `ref` has that neither the new tip nor the one fetched before it (`before`, the
 * handoff as it was last handed over, which a new hand-over replaces) has: the receiver's own work.
 * Null when git can't say.
 */
async function ahead(run: RunGit, cwd: string, tip: string, before: string | null, ref: string, timeoutMs: number): Promise<number | null> {
  const r = await run(["rev-list", "--count", ref, "--not", tip, ...(before ? [before] : [])], { cwd, timeoutMs });
  return r.code === 0 ? Number(r.stdout.trim()) : null;
}

/** What a ref points at now, or null. */
async function resolved(run: RunGit, cwd: string, ref: string, timeoutMs: number): Promise<string | null> {
  const r = await run(["rev-parse", "--verify", "-q", ref], { cwd, timeoutMs });
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * The shortcut's checkout (/isoplan:take): the handoff's branch in the session's own folder, fetched
 * from the remote there that is the handoff's. A local branch of that name moves to the fetched tip,
 * unless it has commits the tip doesn't, which would be lost: then it is left as it is. No setup
 * script runs: the person, or their harness, set up this folder. Returns the failed steps, each with
 * the end of git's output, and the remote's name there.
 */
export async function checkoutHere(run: RunGit, cwd: string, handoff: Handoff, timeoutMs: number): Promise<{ failures: Failure[]; remote: string | null }> {
  const repo = handoff.repos.find((r) => r.path === ".") ?? handoff.repos[0]!;
  const branch = handoffBranch(handoff.id);
  const git = (args: string[]) => run(args, { cwd, timeoutMs });
  const remotes = await remotesOf(run, cwd, timeoutMs);
  const failed = (output: string, remote: string | null = null) => ({ failures: [{ step: "checkout" as const, output: tail(output) }], remote });
  if (!remotes) return failed(`${cwd} isn't in a git repo.`);
  const name = remotes.find((r) => sameRemote(r.url, repo.remote))?.name;
  if (!name) return failed(`No remote of the repo in ${cwd} is ${repo.remote}, the repo the handoff was pushed to.`);
  const tip = `refs/remotes/${name}/${branch}`;
  const before = await resolved(run, cwd, tip, timeoutMs);
  const fetched = await git(["fetch", name, `+refs/heads/${branch}:${tip}`]);
  if (fetched.code !== 0) return failed(`git fetch ${name} ${branch}: ${fetched.stderr}`, name);
  const local = await git(["rev-parse", "--verify", "-q", `refs/heads/${branch}`]);
  if (local.code !== 0) {
    const switched = await git(["switch", "--track", "-c", branch, `${name}/${branch}`]);
    return switched.code === 0 ? { failures: [], remote: name } : failed(`git switch ${branch}: ${switched.stderr}`, name);
  }
  const extra = await ahead(run, cwd, tip, before, `refs/heads/${branch}`, timeoutMs);
  if (extra !== 0) return failed(`The local branch ${branch} has ${extra ?? "some"} commit(s) that aren't in the handoff as handed over now, so it was left as it is. Merge or rebase them onto ${name}/${branch} yourself.`, name);
  const switched = await git(["switch", branch]);
  if (switched.code !== 0) return failed(`git switch ${branch}: ${switched.stderr}`, name);
  const moved = await git(["reset", "-q", "--keep", tip]);
  return moved.code === 0 ? { failures: [], remote: name } : failed(`${branch} couldn't be moved to the handoff as handed over now:\n${moved.stderr}`, name);
}

// The worktree for the handoff: one already made on its branch, moved to the new tip when nothing
// in it would be lost, else a new sibling of the clone.
async function worktreeFor(run: RunGit, clone: string, remote: string, branch: string, id: string, before: string | null, timeoutMs: number): Promise<string | { error: string }> {
  const tip = `refs/remotes/${remote}/${branch}`;
  const base = path.join(path.dirname(clone), `${path.basename(clone)}-handoff-${id}`);
  for (let n = 1; n < 10; n++) {
    const dir = n === 1 ? base : `${base}-${n}`;
    const exists = await fs.stat(dir).then(() => true, () => false);
    if (exists) {
      const head = await run(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, timeoutMs });
      if (head.code !== 0 || head.stdout.trim() !== branch) continue;
      // Untracked files (a setup script's own, say) are kept by the reset, so only tracked changes count.
      const dirty = (await run(["status", "--porcelain", "--untracked-files=no"], { cwd: dir, timeoutMs })).stdout.trim() !== "";
      const extra = await ahead(run, dir, tip, before, "HEAD", timeoutMs);
      if (dirty || extra !== 0) {
        return { error: `${dir}, this handoff's worktree from before, has work that isn't in the handoff as handed over now (${dirty ? "uncommitted changes" : `${extra ?? "some"} commit(s)`}), so it was left as it is. Commit and push it, or move it aside, then take the handoff again.` };
      }
      const moved = await run(["reset", "-q", "--keep", tip], { cwd: dir, timeoutMs });
      return moved.code === 0 ? dir : { error: `${dir} couldn't be moved to the handoff as handed over now:\n${moved.stderr}` };
    }
    // A local branch of the handoff's name with commits the remote's doesn't have is never reset.
    if ((await run(["rev-parse", "--verify", "-q", `refs/heads/${branch}`], { cwd: clone, timeoutMs })).code === 0) {
      const extra = await ahead(run, clone, tip, before, `refs/heads/${branch}`, timeoutMs);
      if (extra !== 0) return { error: `The local branch ${branch} in ${clone} has ${extra ?? "some"} commit(s) that aren't in the handoff as handed over now, so no worktree was made over it. Push or move them, then take the handoff again.` };
    }
    const r = await run(["worktree", "add", "--track", "-B", branch, dir, `${remote}/${branch}`], { cwd: clone, timeoutMs });
    return r.code === 0 ? dir : { error: `git worktree add ${dir} failed${r.timedOut ? " (it took too long)" : ""}:\n${r.stderr}` };
  }
  return { error: `${base} and the next eight names beside it are taken by other folders` };
}
