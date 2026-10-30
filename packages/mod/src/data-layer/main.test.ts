// The data layer's main loop, run as it ships (dist/data-layer.js, rebuilt with every change), in
// detached mode so it installs nothing and starts no runner, against a stand-in office server, with
// a throwaway Claude config folder: what it sends for a session in a repo the office doesn't take,
// and when the copy of the office's list is too old (adamlinscott/isoplan#91).

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocketServer } from "ws";
import { modDir, tempRoot } from "./fixture.js";

vi.setConfig({ testTimeout: 30000 });

const children: ChildProcess[] = [];
const servers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of children.splice(0)) c.kill();
  for (const close of servers.splice(0)) await close();
});

/** A stand-in office server: GET /data-layer/repos answers `list` (or `status`), and every data-layer socket is kept. */
async function office() {
  const state = { repos: [] as string[], version: 1, status: 200, connections: [] as { messages: { type: string }[]; closed: boolean; close(): void }[] };
  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith("/data-layer/repos")) return void response.writeHead(404).end();
    if (state.status !== 200) return void response.writeHead(state.status).end("{}");
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: `v${state.version}`, repos: state.repos }));
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    const c = { messages: [] as { type: string }[], closed: false, close: () => ws.close() };
    state.connections.push(c);
    ws.on("message", (data) => c.messages.push(JSON.parse(String(data))));
    ws.on("close", () => (c.closed = true));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(() => new Promise((resolve) => (wss.close(), server.close(resolve))));
  return { state, url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/data-layer` };
}

/** A repo with a remote, a session in it with a fresh transcript, and the data layer started for it, detached. */
function start(url: string, config: Record<string, unknown> = {}) {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const repo = path.join(root, "app");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/team/app.git"], { cwd: repo });
  const now = new Date().toISOString();
  const transcript = path.join(claudeDir, "projects", repo.replace(/[^a-zA-Z0-9]/g, "-"), "s1.jsonl");
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, [{ type: "user", cwd: repo, timestamp: now, message: { role: "user", content: "hi" } }, { type: "assistant", cwd: repo, timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }].map((l) => JSON.stringify(l)).join("\n") + "\n");
  fs.mkdirSync(path.join(claudeDir, "isoplan"), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "isoplan", "config.json"), JSON.stringify({ server: url, ...config }));
  const child = spawn(process.execPath, [path.join(modDir, "dist", "data-layer.js"), "--session", "s1", "--cwd", repo, "--detached"], {
    cwd: repo,
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
    stdio: "ignore",
    windowsHide: true,
  });
  children.push(child);
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  return { claudeDir, exited, lock: path.join(claudeDir, "isoplan", "live", "s1.json") };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await wait(20);
  }
}

test("a session in a repo the office doesn't take opens no socket, and its detached data layer holds off, naming the repo for the wake hook", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/other"];
  const { exited, lock } = start(o.url);
  await exited;
  expect(o.state.connections).toEqual([]);
  expect(JSON.parse(fs.readFileSync(lock, "utf8"))).toMatchObject({ pid: 0, reason: "not-approved", projects: ["github.com/team/app"] });
});

test("an approved session connects; once its copy of the list is past its maximum age and can't be checked, its link closes and no other socket opens, reconnects included", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  // Minutes in config.json: a copy is checked every 0.6 s and is too old after 1.2 s.
  start(o.url, { approvedRefreshMinutes: 0.01, approvedMaxAgeMinutes: 0.02 });
  await until(() => o.state.connections[0]?.messages.some((m) => m.type === "hello") ?? false);

  // The list can't be checked: a drop within the copy's age reconnects, after checking; past it, the link closes.
  o.state.status = 500;
  o.state.connections[0]!.close();
  // Past the copy's maximum age (1.2 s) and a pass of the loop, everything is closed.
  await wait(3000);
  expect(o.state.connections.every((c) => c.closed)).toBe(true);
  const opened = o.state.connections.length;
  await wait(4000);
  expect(o.state.connections).toHaveLength(opened);
  expect(o.state.connections.every((c) => c.closed)).toBe(true);

  // The server answers again: the list is checked, and only then does it reconnect.
  o.state.status = 200;
  await until(() => o.state.connections.length === 2 && o.state.connections[1]!.messages.some((m) => m.type === "hello"));
});
