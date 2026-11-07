// The runner reporting the sessions no hooks module reports (reporting.ts, ADR 0007 step 1): which
// sessions it takes and when it takes one again, with a stand-in for the reporting itself; then,
// with the data layer's own reporting (report-session.ts) and a stand-in office server, that a
// session reaches the office from the runner alone, again at once after a runner restart, and is
// handed over to the plugin's data layer as it takes the session's lock.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocketServer } from "ws";
import { approvedPath } from "../data-layer/approved-file.js";
import type { Config } from "../data-layer/config.js";
import { defaults, modDir, tempRoot } from "../data-layer/fixture.js";
import { nodeIo, type NodeIo } from "../data-layer/io.js";
import type { DataLayerLine } from "../lines.js";
import { reportSession, sessionLog, type Ended, type ReportSessionOptions } from "../data-layer/report-session.js";
import { lockPath } from "../wake/lock.js";
import { watchSessions, type Reporting, type ToReport } from "./reporting.js";

vi.setConfig({ testTimeout: 30000 });

const OTHER = 4242; // a pid that isn't this process
const watching: Reporting[] = [];
const closing: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const w of watching.splice(0)) await w.stop();
  for (const close of closing.splice(0)) await close();
  vi.unstubAllEnvs();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await wait(20);
  }
}

const line = (cwd: string | null) => JSON.stringify({ type: "user", ...(cwd && { cwd }), timestamp: new Date().toISOString(), message: { role: "user", content: "hi" } }) + "\n";

/** A config folder with a folder `app`, and a way to write session transcripts in it. */
function machine(settings: Partial<Config> = {}) {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const repo = path.join(root, "app");
  fs.mkdirSync(repo, { recursive: true });
  const config: Config = { ...defaults, streamSeconds: 0.05, ...settings };
  const transcript = (id: string) => path.join(claudeDir, "projects", "-app", `${id}.jsonl`);
  const write = (id: string, cwd: string | null = repo, ageMinutes = 0) => {
    fs.mkdirSync(path.dirname(transcript(id)), { recursive: true });
    fs.appendFileSync(transcript(id), line(cwd));
    const t = new Date(Date.now() - ageMinutes * 60000);
    fs.utimesSync(transcript(id), t, t);
  };
  return { claudeDir, repo, config, transcript, write };
}

/** watchSessions with a stand-in report: each session it starts is kept, and ends when told (or when the runner stops). */
function watch(m: ReturnType<typeof machine>, o: { isOff?: (folder: string) => Promise<boolean>; isAlive?: (pid: number) => boolean; gapMs?: number; io?: NodeIo } = {}) {
  const started: { id: string; notWanted: Record<string, number>; end: (ended?: Ended) => void }[] = [];
  const report = (s: ToReport) =>
    new Promise<Ended>((resolve) => {
      started.push({ id: s.sessionId, notWanted: s.notWanted, end: (ended = { why: "done" }) => resolve(ended) });
      void s.closed.then(() => resolve({ why: "stopped" }));
    });
  const w = watchSessions({ claudeDir: m.claudeDir, io: o.io ?? nodeIo(), config: async () => m.config, report, isOff: o.isOff ?? (async () => false), log: () => {}, gapMs: o.gapMs ?? 0, ...(o.isAlive && { isAlive: o.isAlive }) });
  watching.push(w);
  return { w, started, ids: () => started.map((s) => s.id) };
}

test("each session written within idleMinutes is reported, once; one whose transcript names no folder yet only once it does", async () => {
  const m = machine();
  m.write("s1");
  m.write("s2", null);
  m.write("not a plain id");
  const { w, ids } = watch(m);
  await until(() => ids().includes("s1"));
  await w.look();
  expect(ids()).toEqual(["s1"]);
  m.write("s2");
  await until(() => ids().includes("s2"));
  expect(w.reporting().sort()).toEqual(["s1", "s2"]);
});

test("a session whose lock another live process keeps fresh isn't reported (the plugin's data layer has it); once that has gone, only once its transcript moves, so a closed session goes unreachable", async () => {
  const m = machine();
  let holderAlive = true;
  fs.mkdirSync(path.dirname(lockPath(m.claudeDir, "s1")), { recursive: true });
  fs.writeFileSync(lockPath(m.claudeDir, "s1"), JSON.stringify({ pid: OTHER, detached: false }));
  m.write("s1");
  const { w, ids } = watch(m, { isAlive: (pid) => pid !== OTHER || holderAlive });
  await w.look();
  await w.look();
  expect(ids()).toEqual([]);
  // The session closes: its data layer lets the lock go.
  holderAlive = false;
  fs.rmSync(lockPath(m.claudeDir, "s1"));
  await w.look();
  await w.look();
  expect(ids()).toEqual([]);
  // Its data layer had crashed, and the session goes on.
  await wait(20);
  m.write("s1");
  await until(() => ids().includes("s1"));
});

test("a lock counts as fresh for three of its holder's slowest passes, which a long streamSeconds makes longer", async () => {
  const m = machine({ streamSeconds: 20 }); // three passes of up to 40 s: two minutes
  const lock = lockPath(m.claudeDir, "s1");
  const age = (seconds: number) => {
    const t = new Date(Date.now() - seconds * 1000);
    fs.utimesSync(lock, t, t);
  };
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: OTHER, detached: false }));
  age(100);
  m.write("s1");
  const { w, ids } = watch(m, { isAlive: () => true });
  await w.look();
  await w.look();
  expect(ids()).toEqual([]);
  age(130);
  await w.look(); // the lock let go before the transcript moved
  await wait(20);
  m.write("s1");
  await w.look();
  expect(ids()).toEqual(["s1"]);
});

test("a session whose last write and lock letting go fall between two looks isn't reported: it closed just after a turn; its next write is", async () => {
  const m = machine();
  fs.mkdirSync(path.dirname(lockPath(m.claudeDir, "s1")), { recursive: true });
  fs.writeFileSync(lockPath(m.claudeDir, "s1"), JSON.stringify({ pid: OTHER, detached: false }));
  m.write("s1");
  const { w, ids } = watch(m, { isAlive: (pid) => pid !== OTHER || fs.existsSync(lockPath(m.claudeDir, "s1")) });
  await w.look();
  await wait(20);
  m.write("s1");
  fs.rmSync(lockPath(m.claudeDir, "s1"));
  await w.look();
  await w.look();
  expect(ids()).toEqual([]);
  await wait(20);
  m.write("s1");
  await until(() => ids().includes("s1"));
});

test("stop waits for a report stuck in a pass at most stopWaitMs", async () => {
  const m = machine();
  m.write("s1");
  const w = watchSessions({ claudeDir: m.claudeDir, io: nodeIo(), config: async () => m.config, report: () => new Promise<Ended>(() => {}), isOff: async () => false, log: () => {}, gapMs: 0, stopWaitMs: 200 });
  await until(() => w.reporting().includes("s1"));
  const started = Date.now();
  await w.stop();
  expect(Date.now() - started).toBeLessThan(2000);
});

test("a session that stopped being reported is reported again only once its transcript moves", async () => {
  const m = machine();
  m.write("s1");
  const { w, started, ids } = watch(m);
  await until(() => ids().length === 1);
  started[0]!.end();
  await until(() => w.reporting().length === 0);
  await w.look();
  await w.look();
  expect(ids()).toEqual(["s1"]);
  await wait(20); // a write time past the one it ended at
  m.write("s1");
  await until(() => ids().length === 2);
});

test("a session that just stopped being reported isn't started again while the runner reads its write time", async () => {
  const m = machine({ streamSeconds: 60 }); // only the first look, and those asked for
  m.write("s1");
  // The next stat after `slow` is set takes a while.
  let slow = false;
  const io = nodeIo();
  const stat: NodeIo["stat"] = async (file) => {
    if (slow) {
      slow = false;
      await wait(300);
    }
    return io.stat(file);
  };
  const { w, started, ids } = watch(m, { io: { ...io, stat } });
  await until(() => ids().length === 1);
  slow = true;
  started[0]!.end();
  await wait(50);
  await w.look();
  await until(() => w.reporting().length === 0);
  await w.look();
  expect(ids()).toEqual(["s1"]);
});

test("quiet past idleMinutes, the folder gone, or the plugin off for the folder: not reported", async () => {
  const m = machine({ idleMinutes: 30, lightsOffHours: 0 });
  const offDir = path.join(m.repo, "..", "off");
  fs.mkdirSync(offDir);
  m.write("quiet", m.repo, 31);
  m.write("gone", path.join(m.repo, "..", "gone"));
  m.write("off", offDir);
  m.write("on");
  const { w, ids } = watch(m, { isOff: async (folder) => folder === offDir });
  await until(() => ids().includes("on"));
  await w.look();
  expect(ids()).toEqual(["on"]);
});

test("a runner started again reports each live session at its first look, and then, one at a time, those quiet within lightsOffHours", async () => {
  const m = machine({ idleMinutes: 30, lightsOffHours: 24 });
  m.write("live");
  m.write("quiet-1", m.repo, 60);
  m.write("quiet-2", m.repo, 120);
  m.write("old", m.repo, 25 * 60);
  const { w, ids } = watch(m, { gapMs: 300 });
  await until(() => ids().length >= 1);
  expect(ids()).toEqual(["live"]);
  await until(() => ids().length === 3);
  expect(ids().slice(1).sort()).toEqual(["quiet-1", "quiet-2"]);
  await w.look();
  expect(ids()).not.toContain("old");
});

test("a hold-off: the session isn't reported before it ends; one no office took is, as it moves, once a fresh list of an office takes its repo, but never one that didn't want it", async () => {
  const m = machine();
  m.write("s1");
  const { w, started, ids } = watch(m);
  await until(() => ids().length === 1);
  const until_ = Date.now() + 3600000;
  started[0]!.end({ why: "held", holdOff: { until: until_, projects: ["github.com/team/app"], offices: ["ws://a/data-layer", "ws://b/data-layer"], notWanted: { "ws://b/data-layer": until_ } } });
  await until(() => w.reporting().length === 0);
  expect(w.heldOff("s1")).toBe(true);
  const list = (server: string, repos: string[]) => {
    fs.mkdirSync(path.dirname(approvedPath(m.claudeDir, server)), { recursive: true });
    fs.writeFileSync(approvedPath(m.claudeDir, server), JSON.stringify({ server, version: "v1", repos, fetched: Date.now(), checked: Date.now() }));
  };
  // The office that didn't want it takes the repo: still held off.
  list("ws://b/data-layer", ["github.com/team/app"]);
  await wait(20);
  m.write("s1");
  await w.look();
  await w.look();
  expect(ids()).toEqual(["s1"]);
  // Another it reported to does: reported again, still leaving the other office alone.
  list("ws://a/data-layer", ["github.com/team/app"]);
  await wait(20);
  m.write("s1");
  await until(() => ids().length === 2);
  expect(started[1]!.notWanted).toEqual({ "ws://b/data-layer": until_ });
  expect(w.heldOff("s1")).toBe(false);
});

test("a hold-off with no repos to wait for (no office wants the project) holds until it ends", async () => {
  const m = machine();
  m.write("s1");
  const { w, started, ids } = watch(m);
  await until(() => ids().length === 1);
  started[0]!.end({ why: "held", holdOff: { until: Date.now() + 300, offices: [], notWanted: {} } });
  await until(() => w.reporting().length === 0);
  await wait(20);
  m.write("s1");
  await w.look();
  expect(ids()).toHaveLength(1);
  await wait(400);
  m.write("s1");
  await until(() => ids().length === 2);
});

/** A stand-in office server taking github.com/team/app, which keeps every data-layer socket. */
async function office() {
  const connections: { messages: { type: string }[]; closed: boolean; at: number; drop: () => void }[] = [];
  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith("/data-layer/repos")) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: "v1", repos: ["github.com/team/app"] }));
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    const c = { messages: [] as { type: string }[], closed: false, at: Date.now(), drop: () => ws.terminate() };
    connections.push(c);
    ws.on("message", (data) => c.messages.push(JSON.parse(String(data)) as { type: string }));
    ws.on("close", () => (c.closed = true));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closing.push(() => new Promise((resolve) => (wss.close(), server.closeAllConnections(), server.close(resolve))));
  return { connections, url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/data-layer` };
}

/** watchSessions as the runner's worker runs it, reporting with the data layer's own loop. */
function runner(m: ReturnType<typeof machine>) {
  vi.stubEnv("CLAUDE_CONFIG_DIR", m.claudeDir);
  const report = async ({ sessionId, cwd, notWanted, closed }: ToReport) => {
    const log = sessionLog(m.claudeDir, sessionId);
    const ended = await reportSession({ sessionId, cwd, by: "runner", appDir: modDir, emit: log.emit, closed, notWanted, isOff: async () => false });
    await log.flushed();
    return ended;
  };
  const w = watchSessions({ claudeDir: m.claudeDir, io: nodeIo(), config: async () => m.config, report, isOff: async () => false, log: () => {} });
  watching.push(w);
  return w;
}

test("with no hooks module and no wake hook, a session reaches the office from the runner; a runner started again reports it within one streamSeconds; the plugin's data layer taking the lock ends the runner's link", async () => {
  const o = await office();
  const m = machine({ streamSeconds: 2 });
  execFileSync("git", ["init", "-q"], { cwd: m.repo });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/team/app.git"], { cwd: m.repo });
  fs.mkdirSync(path.join(m.claudeDir, "isoplan"), { recursive: true });
  fs.writeFileSync(path.join(m.claudeDir, "isoplan", "config.json"), JSON.stringify({ server: o.url, streamSeconds: 2 }));
  fs.mkdirSync(path.dirname(m.transcript("s1")), { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(m.transcript("s1"), [{ type: "user", cwd: m.repo, timestamp: now, message: { role: "user", content: "hi" } }, { type: "assistant", cwd: m.repo, timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }].map((l) => JSON.stringify(l) + "\n").join(""));
  const full = (i: number) => o.connections[i]?.messages.some((msg) => msg.type === "full") ?? false;

  const first = runner(m);
  await until(() => full(0));
  expect(JSON.parse(fs.readFileSync(lockPath(m.claudeDir, "s1"), "utf8"))).toMatchObject({ pid: process.pid, runner: true });

  // The runner stops (its worker ends with its links) and starts again.
  await first.stop();
  await until(() => o.connections[0]!.closed);
  const restarted = Date.now();
  runner(m);
  await until(() => full(1));
  expect(Date.now() - restarted).toBeLessThan(m.config.streamSeconds * 1000);

  // The plugin's data layer takes the session's lock, as it does from the runner (by force): the runner's link closes, and stays closed.
  fs.writeFileSync(lockPath(m.claudeDir, "s1"), JSON.stringify({ pid: process.ppid, detached: false }));
  await until(() => o.connections[1]!.closed, 10000);
  await wait(2500);
  expect(o.connections).toHaveLength(2);
});

/** Sessions s1 and s2 in one repo the stand-in office takes, at work, the runner's to report. */
async function twoSessions() {
  const o = await office();
  const m = machine({ streamSeconds: 1 });
  execFileSync("git", ["init", "-q"], { cwd: m.repo });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/team/app.git"], { cwd: m.repo });
  fs.mkdirSync(path.join(m.claudeDir, "isoplan"), { recursive: true });
  fs.writeFileSync(path.join(m.claudeDir, "isoplan", "config.json"), JSON.stringify({ server: o.url, streamSeconds: 1 }));
  fs.mkdirSync(path.dirname(m.transcript("s1")), { recursive: true });
  const now = new Date().toISOString();
  for (const id of ["s1", "s2"]) fs.writeFileSync(m.transcript(id), [{ type: "user", cwd: m.repo, timestamp: now, message: { role: "user", content: "hi" } }, { type: "assistant", cwd: m.repo, timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }].map((l) => JSON.stringify(l) + "\n").join(""));
  const of = (id: string) => o.connections.find((c) => c.messages.some((msg) => msg.type === "full" && (msg as { facts?: { session?: { id?: string } } }).facts?.session?.id === `claude-code:${id}`));
  const logOf = (id: string) => fs.readFileSync(path.join(m.claudeDir, "isoplan", "logs", `${id}.log`), "utf8");
  return { o, m, of, logOf };
}

/** watchSessions as the worker runs it, with s1's report given `s1` in place of its own emit or shared pairing and list; how many times each session was started. */
function runnerWith(m: ReturnType<typeof machine>, s1: { emit?: (line: DataLayerLine, emit: (line: DataLayerLine) => void) => void; shared?: ReportSessionOptions["shared"] }) {
  vi.stubEnv("CLAUDE_CONFIG_DIR", m.claudeDir);
  const starts: string[] = [];
  const report = async ({ sessionId, cwd, notWanted, closed }: ToReport) => {
    starts.push(sessionId);
    const log = sessionLog(m.claudeDir, sessionId);
    const injected = sessionId === "s1" ? s1 : {};
    const emit = injected.emit ? (line: DataLayerLine) => injected.emit!(line, log.emit) : log.emit;
    const ended = await reportSession({ sessionId, cwd, by: "runner", appDir: modDir, emit, closed, notWanted, isOff: async () => false, ...(injected.shared && { shared: injected.shared }) });
    await log.flushed();
    return ended;
  };
  const w = watchSessions({ claudeDir: m.claudeDir, io: nodeIo(), config: async () => m.config, report, isOff: async () => false, log: () => {} });
  watching.push(w);
  return { w, started: (id: string) => starts.filter((s) => s === id).length };
}

test("a session whose report throws in one of its link's handlers ends alone, its lock gone and its log saying why, while another session the runner reports goes on; it starts again once its transcript moves", async () => {
  const { m, of, logOf } = await twoSessions();
  // The throw comes from the link's socket handler as it opens: before #104 it reached the worker's process.
  const { w, started } = runnerWith(m, {
    emit: (line, emit) => {
      if (line.type === "status" && line.state === "connected") throw new Error("boom: a handler broke");
      emit(line);
    },
  });
  await until(() => !!of("s1") && !!of("s2"));
  await until(() => of("s1")!.closed && !w.reporting().includes("s1"));
  expect(logOf("s1")).toMatch(/stopping: something went wrong in reporting it: Error: boom: a handler broke/);
  expect(fs.existsSync(lockPath(m.claudeDir, "s1"))).toBe(false);
  // The other session goes on.
  await wait(1500);
  expect(w.reporting()).toEqual(["s2"]);
  expect(of("s2")!.closed).toBe(false);
  expect(JSON.parse(fs.readFileSync(lockPath(m.claudeDir, "s2"), "utf8"))).toMatchObject({ pid: process.pid });
  // Like any other end: not again until its transcript moves.
  await w.look();
  expect(started("s1")).toBe(1);
  fs.appendFileSync(m.transcript("s1"), line(m.repo));
  await until(() => started("s1") === 2);
});

test("a session whose report rejects in a promise nothing waits for ends alone, logged, while another session the runner reports goes on", async () => {
  const { m, of, logOf } = await twoSessions();
  let broken = false;
  const approved = {
    repos: () => new Set(["github.com/team/app"]),
    version: () => "v1",
    problem: () => null,
    refresh: async (force?: boolean) => {
      if (force && broken) throw new Error("boom: the list broke");
    },
    ask: async () => "listed" as const,
  };
  const pairing = { token: async () => undefined, refused: async () => {}, close: async () => {} };
  const { w } = runnerWith(m, { shared: () => ({ pairing, approved }) });
  await until(() => !!of("s1") && !!of("s2"));
  // The office drops s1's link: the session reads the office's list again, which rejects.
  broken = true;
  of("s1")!.drop();
  await until(() => !w.reporting().includes("s1"));
  expect(logOf("s1")).toMatch(/stopping: something went wrong in reporting it: Error: boom: the list broke/);
  expect(fs.existsSync(lockPath(m.claudeDir, "s1"))).toBe(false);
  await wait(1500);
  expect(w.reporting()).toEqual(["s2"]);
  expect(of("s2")!.closed).toBe(false);
});

test("a session whose error text matches a secret pattern logs that it is left out, not the text", async () => {
  const { m, of, logOf } = await twoSessions();
  const secret = "ghp_" + "a".repeat(36);
  const { w } = runnerWith(m, {
    emit: (line, emit) => {
      if (line.type === "status" && line.state === "connected") throw new Error(`boom: ${secret}`);
      emit(line);
    },
  });
  await until(() => !!of("s1"));
  await until(() => !w.reporting().includes("s1"));
  expect(logOf("s1")).toMatch(/something went wrong in reporting it: \(its text is left out: it matches the secret pattern /);
  expect(logOf("s1")).not.toContain(secret);
});
