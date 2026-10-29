// Taking a handoff from the floor (#48): the receiver's runner does it, in order.
//
// 1. The clone: the machine's Claude Code sessions from the last `cloneSearchDays` say which folders
//    the receiver works in. Each is placed with git, and the main checkout of the first whose remote
//    is the handoff's (the same project id, or the same path for a local remote) is the clone.
//    Without one nothing can be made, so no session opens and the handoff stays to be taken.
// 2. The worktree: a sibling of the clone, <clone>-handoff-<id>, on isoplan/handoff/<id>, tracking
//    the remote's branch. One made for this handoff before is used again.
// 3. The setup script (E11): `worktreeSetup` in isoplan.json at the repo's top, read from the
//    receiver's own copy of the default branch (the remote's HEAD, else the clone's), never from the
//    handoff's branch, so a handoff can't change what runs. It runs with the system shell (cmd.exe on
//    Windows, /bin/sh on a Mac) in the worktree, with ISOPLAN_HANDOFF_ID and ISOPLAN_HANDOFF_BRANCH
//    set, under its timeout. Its output goes to setup.log in the handoff's folder.
// 4. Claude Code, in a terminal in the worktree, under a session id chosen here so the server can
//    put that session in the room: the brief is in brief.md in the handoff's folder
//    (<claude dir>/isoplan/handoffs/<id>/), which the session is told to read first. On Windows the
//    terminal is `start` (Windows Terminal when it is the default); on a Mac, Terminal.app.
//
// A step that fails is reported with the end of its output, and the rest still runs: a failed setup
// script still opens the session. Output leaves the machine only after the secret scan.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PROTOCOL_VERSION, type Handoff, type HandoffRepo, type TakenMessage } from "@isoplan/protocol";
import { normalize, pathKey } from "../data-layer/git.js";
import type { NodeIo } from "../data-layer/io.js";
import { claudeCommand } from "../runner/claude-binary.js";
import { forkEnv, killTree } from "../runner/claude.js";
import { recentSessions } from "../sweep/find.js";
import { handoffBranch, sameRemote, type RunGit } from "./git.js";

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

export interface TakeOptions {
  run: RunGit;
  io: NodeIo;
  claudeDir: string;
  machine: string;
  platform: NodeJS.Platform;
  /** The environment the setup script and the terminal start from. */
  env: Record<string, string | undefined>;
  settings: () => Promise<TakeSettings>;
  /** The `claude` binary, or null when none can be found. */
  claude: () => Promise<string | null>;
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** Runs a launch; resolves once the terminal has been asked to open. */
  open?: (launch: Launch, env: Record<string, string>) => Promise<void>;
  now?: () => number;
  newSession?: () => string;
}

/** The handoff's folder on this machine: its brief, launcher and setup log. */
export const handoffDir = (claudeDir: string, id: string) => path.join(claudeDir, "isoplan", "handoffs", id);

const tail = (text: string) => (text.length > OUTPUT_TAIL ? "…" + text.slice(-OUTPUT_TAIL) : text).trim();

/** The main checkout of a clone of `remote` on this machine, and that remote's name there; null with none. */
export async function findClone(io: NodeIo, run: RunGit, projectsDir: string, remote: string, since: number, timeoutMs: number): Promise<{ dir: string; remote: string } | null> {
  const tried = new Set<string>();
  for (const { cwd } of await recentSessions(io, projectsDir, since)) {
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
    const remotes = await run(["remote", "-v"], { cwd: main, timeoutMs });
    for (const line of remotes.code === 0 ? remotes.stdout.split(/\r?\n/) : []) {
      const [name, url] = line.split(/\s+/);
      if (name && url && sameRemote(url, remote)) return { dir: path.resolve(main), remote: name };
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

/** Runs `command` with the system shell; resolves with whether it exited 0, its output's end and whether it timed out. */
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

// A launcher's text can't hold a quote; everything else in a Windows path is kept, % doubled.
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
  const name = title.replace(/["%^&|<>!]/g, "");
  if (platform === "win32") {
    const file = path.win32.join(folder, "open.cmd");
    const text = ["@echo off", `title ${name}`, ...(configDir ? [`set "CLAUDE_CONFIG_DIR=${configDir.replace(/"/g, "").replace(/%/g, "%%")}"`] : []), `cd /d ${cmdQuote(dir)}`, argv.map(cmdQuote).join(" "), ""].join("\r\n");
    return { file, text, command: [process.env.ComSpec || "cmd.exe", "/d", "/c", "start", `"${name}"`, "cmd.exe", "/k", `"${file}"`] };
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

/** The first thing the new session is told. */
export function takePrompt(id: string, brief: string, setupLog: string | null): string {
  return [
    `Isoplan handoff ${id}: you are taking this work over.`,
    `Read its brief in ${brief} first.`,
    ...(setupLog ? [`The worktree's setup script failed; the end of its output is in ${setupLog}.`] : []),
    "Then say where things stand and what you would do next, and wait for me before changing anything.",
  ].join(" ");
}

/** Takes the handoff on this machine; never throws. */
export async function takeHandoff(handoff: Handoff, o: TakeOptions): Promise<TakenMessage> {
  const failures: Failure[] = [];
  const done = (session?: string): TakenMessage => ({ type: "taken", v: PROTOCOL_VERSION, handoff: handoff.id, ...(session ? { session } : {}), failures });
  const fail = async (step: Failure["step"], output: string) => {
    const matched = await o.scan(output);
    failures.push({ step, output: matched ? `The end of its output is withheld here: it matches the secret pattern "${matched}". It is on ${o.machine}.` : tail(output) });
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
      await fail("worktree", `No clone of ${repo.remote} was found on ${o.machine}: none of its Claude Code sessions from the last ${s.cloneSearchDays} days ran in one. Open Claude Code once in your clone of the repo, then take the handoff again, or run /isoplan:take with its code in a session there.`);
      return done();
    }
    const git = (args: string[], cwd: string) => o.run(args, { cwd, timeoutMs });
    const fetched = await git(["fetch", clone.remote, `+refs/heads/${branch}:refs/remotes/${clone.remote}/${branch}`], clone.dir);
    if (fetched.code !== 0) {
      await fail("worktree", `git fetch ${clone.remote} ${branch} in ${clone.dir} failed${fetched.timedOut ? " (it took too long)" : ""}:\n${fetched.stderr}`);
      return done();
    }
    const dir = await worktreeFor(o.run, clone.dir, clone.remote, branch, handoff.id, timeoutMs);
    if (typeof dir !== "string") {
      await fail("worktree", dir.error);
      return done();
    }

    const folder = handoffDir(o.claudeDir, handoff.id);
    await fs.mkdir(folder, { recursive: true });
    const briefFile = path.join(folder, "brief.md");
    await fs.writeFile(briefFile, handoff.brief + "\n");
    const env = forkEnv(o.env);

    let setupLog: string | null = null;
    const config = await readSetupFile(o.run, clone, timeoutMs);
    let setup: WorktreeSetup | null = null;
    try {
      setup = config === null ? null : parseSetup(config, o.platform, s.setupTimeoutMinutes * 60000);
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
    const id = (o.newSession ?? randomUUID)();
    const argv = [...claudeCommand(bin), "--session-id", id, "--name", `Isoplan handoff ${handoff.id}`, "--add-dir", folder, takePrompt(handoff.id, briefFile, setupLog)];
    const l = launch(o.platform, { folder, dir, argv, title: `Isoplan handoff ${handoff.id}`, configDir: o.env.CLAUDE_CONFIG_DIR ?? null });
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
 * The shortcut's checkout (/isoplan:take): the handoff's branch in the session's own folder, fetched
 * from the remote there that is the handoff's. No setup script runs: the person's own harness does
 * that. Returns the failed steps, each with the end of git's output.
 */
export async function checkoutHere(run: RunGit, cwd: string, handoff: Handoff, timeoutMs: number): Promise<Failure[]> {
  const repo = handoff.repos.find((r) => r.path === ".") ?? handoff.repos[0]!;
  const branch = handoffBranch(handoff.id);
  const git = (args: string[]) => run(args, { cwd, timeoutMs });
  const failed = (output: string): Failure[] => [{ step: "checkout", output: tail(output) }];
  const remotes = await git(["remote", "-v"]);
  if (remotes.code !== 0) return failed(`${cwd} isn't in a git repo: ${remotes.stderr}`);
  const name = remotes.stdout
    .split(/\r?\n/)
    .map((line) => line.split(/\s+/))
    .find(([n, url]) => n && url && sameRemote(url, repo.remote))?.[0];
  if (!name) return failed(`No remote of the repo in ${cwd} is ${repo.remote}, the repo the handoff was pushed to.`);
  const fetched = await git(["fetch", name, `+refs/heads/${branch}:refs/remotes/${name}/${branch}`]);
  if (fetched.code !== 0) return failed(`git fetch ${name} ${branch}: ${fetched.stderr}`);
  const local = await git(["rev-parse", "--verify", "-q", `refs/heads/${branch}`]);
  const switched = await git(local.code === 0 ? ["switch", branch] : ["switch", "--track", "-c", branch, `${name}/${branch}`]);
  return switched.code === 0 ? [] : failed(`git switch ${branch}: ${switched.stderr}`);
}

// The worktree for the handoff: one already made on its branch, else a new sibling of the clone.
async function worktreeFor(run: RunGit, clone: string, remote: string, branch: string, id: string, timeoutMs: number): Promise<string | { error: string }> {
  const base = path.join(path.dirname(clone), `${path.basename(clone)}-handoff-${id}`);
  for (let n = 1; n < 10; n++) {
    const dir = n === 1 ? base : `${base}-${n}`;
    const exists = await fs.stat(dir).then(() => true, () => false);
    if (exists) {
      const head = await run(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, timeoutMs });
      if (head.code !== 0 || head.stdout.trim() !== branch) continue;
      // Handed over again, the branch was replaced: the worktree moves to it, keeping local changes.
      const moved = await run(["reset", "-q", "--keep", `${remote}/${branch}`], { cwd: dir, timeoutMs });
      return moved.code === 0 ? dir : { error: `${dir} is on ${branch} already, but couldn't be moved to the branch as handed over now:\n${moved.stderr}` };
    }
    const r = await run(["worktree", "add", "--track", "-B", branch, dir, `${remote}/${branch}`], { cwd: clone, timeoutMs });
    return r.code === 0 ? dir : { error: `git worktree add ${dir} failed${r.timedOut ? " (it took too long)" : ""}:\n${r.stderr}` };
  }
  return { error: `${base} and the next eight names beside it are taken by other folders` };
}

// isoplan.json from the receiver's copy of the default branch: the remote's HEAD, else the clone's.
async function readSetupFile(run: RunGit, clone: { dir: string; remote: string }, timeoutMs: number): Promise<string | null> {
  for (const rev of [`${clone.remote}/HEAD`, "HEAD"]) {
    const r = await run(["show", `${rev}:${REPO_CONFIG}`], { cwd: clone.dir, timeoutMs });
    if (r.code === 0) return r.stdout;
  }
  return null;
}
