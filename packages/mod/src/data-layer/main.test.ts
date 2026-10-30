// The data layer's main loop, run as it ships (dist/data-layer.js, rebuilt with every change), in
// detached mode so it installs nothing and starts no runner, against a stand-in office server, with
// a throwaway Claude config folder: what it sends for a session in a repo the office doesn't take,
// and when the copy of the office's list is too old (adamlinscott/isoplan#91); and what a copy in
// the plugin cache does once Claude Code has installed a newer one (adamlinscott/isoplan#96).

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

/** A repo with a remote, and session s1 in it with a fresh transcript; the repo's folder. */
function session(claudeDir: string, root: string): string {
  const repo = path.join(root, "app");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/team/app.git"], { cwd: repo });
  const now = new Date().toISOString();
  const transcript = path.join(claudeDir, "projects", repo.replace(/[^a-zA-Z0-9]/g, "-"), "s1.jsonl");
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, [{ type: "user", cwd: repo, timestamp: now, message: { role: "user", content: "hi" } }, { type: "assistant", cwd: repo, timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }].map((l) => JSON.stringify(l)).join("\n") + "\n");
  fs.mkdirSync(path.join(claudeDir, "isoplan"), { recursive: true });
  return repo;
}

/** session(), and the data layer started for it, detached. */
function start(url: string, config: Record<string, unknown> = {}) {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const repo = session(claudeDir, root);
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

/** Two versions of the plugin in a throwaway plugin cache, Claude Code's record naming the newer, and a way to start either for session s1. */
function versions(server = "ws://127.0.0.1:9/data-layer") {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const plugins = path.join(claudeDir, "plugins");
  const folder = (version: string) => path.join(plugins, "cache", "isoplan", "isoplan", version);
  for (const version of ["0.2.0", "0.3.0"]) {
    fs.mkdirSync(path.join(folder(version), "dist"), { recursive: true });
    fs.mkdirSync(path.join(folder(version), ".claude-plugin"), { recursive: true });
    for (const file of ["data-layer.js", "wake.js", "hooks.js"]) fs.copyFileSync(path.join(modDir, "dist", file), path.join(folder(version), "dist", file));
    fs.copyFileSync(path.join(modDir, "config.json"), path.join(folder(version), "config.json"));
    fs.writeFileSync(path.join(folder(version), ".claude-plugin", "plugin.json"), JSON.stringify({ name: "isoplan", version }));
  }
  fs.writeFileSync(path.join(plugins, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "isoplan@isoplan": [{ scope: "user", installPath: folder("0.3.0"), version: "0.3.0" }] } }));
  const repo = session(claudeDir, root);
  fs.writeFileSync(path.join(claudeDir, "isoplan", "config.json"), JSON.stringify({ server }));
  const lock = path.join(claudeDir, "isoplan", "live", "s1.json");
  const run = (version: string, ...flags: string[]) => {
    const child = spawn(process.execPath, [path.join(folder(version), "dist", "data-layer.js"), "--session", "s1", "--cwd", repo, ...flags], {
      cwd: repo,
      // No update check runs against a real Claude Code here.
      env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_CODE_PLUGIN_CACHE_DIR: "", DISABLE_AUTOUPDATER: "1", FORCE_AUTOUPDATE_PLUGINS: "" },
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    children.push(child);
    let out = "";
    child.stdout!.on("data", (piece) => (out += piece));
    let code: number | null | undefined;
    const exited = new Promise<number | null>((resolve) => child.on("exit", (c) => resolve((code = c))));
    return { pid: child.pid!, hasExited: () => code !== undefined, lines: () => out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; text?: string }), exited };
  };
  return { claudeDir, lock, run, holder: () => JSON.parse(fs.readFileSync(lock, "utf8")).pid as number };
}

test("a copy in the plugin cache that an update left behind says so, installs nothing and checks for nothing; a detached one leaves the session to the new one", async () => {
  const v = versions();
  const loaded = v.run("0.2.0");
  await until(() => loaded.lines().some((l) => l.type === "updated"));
  await wait(1500);
  expect(fs.existsSync(path.join(v.claudeDir, "isoplan", "wake.json"))).toBe(false);
  expect(fs.existsSync(path.join(v.claudeDir, "isoplan", "update.json"))).toBe(false);
  expect(loaded.lines().filter((l) => l.type === "updated")).toHaveLength(1);
  children.splice(0).forEach((c) => c.kill());

  fs.rmSync(path.join(v.claudeDir, "isoplan", "live"), { recursive: true, force: true }); // the killed one's lock
  const detached = v.run("0.2.0", "--detached");
  expect(await detached.exited).toBe(0);
  expect(fs.existsSync(v.lock)).toBe(false);
  expect(fs.readFileSync(path.join(v.claudeDir, "isoplan", "logs", "s1.log"), "utf8")).toMatch(/a newer version of the Isoplan plugin is installed/);
});

test("after /reload-plugins the old version's data layer leaves the session to the new one's, and of one version the later start keeps it", async () => {
  // A session the office takes, so each data layer makes a pass every second.
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  const v = versions(o.url);
  const old = v.run("0.2.0");
  await until(() => fs.existsSync(v.lock) && v.holder() === old.pid);
  const reloaded = v.run("0.3.0");
  expect(await old.exited).toBe(0);
  expect(old.lines().some((l) => l.text?.includes("a reload started reports this session now"))).toBe(true);
  expect(old.lines().at(-1)).toEqual({ type: "superseded" });
  await wait(2500);
  expect(reloaded.hasExited()).toBe(false);
  expect(v.holder()).toBe(reloaded.pid);
  expect(reloaded.lines().some((l) => l.type === "updated")).toBe(false);
  // The old version started again (its hooks module wasn't unloaded) leaves at once, without taking the session.
  const restarted = v.run("0.2.0");
  expect(await restarted.exited).toBe(0);
  expect(restarted.lines()).toContainEqual({ type: "superseded" });
  expect(v.holder()).toBe(reloaded.pid);

  // A reload with no new version: the data layer it starts keeps the session.
  const again = v.run("0.3.0");
  expect(await reloaded.exited).toBe(0);
  await wait(2500);
  expect(again.hasExited()).toBe(false);
  expect(v.holder()).toBe(again.pid);
});
