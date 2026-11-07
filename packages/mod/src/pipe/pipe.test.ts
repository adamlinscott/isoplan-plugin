// The runner's pipe (ADR 0007 step 2) on a real pipe: a named pipe with a name of its own for each
// test on Windows (a Unix socket elsewhere), in a throwaway config folder. The hooks module's end
// (client.ts) against the runner's (server.ts), and the ask_room script (dist/ask.js, rebuilt with
// every change) against the runner's.

import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { DataLayerLine } from "../lines.js";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { relay } from "./client.js";
import { pipeAddress, pipeInfoPath, readPipeInfo, writeLine } from "./pipe.js";
import { createPipeServer, keeps, type PipeServer } from "./server.js";

vi.setConfig({ testTimeout: 20000 });

const closing: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0)) await close();
});

async function until(check: () => boolean, ms = 10000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** The runner's end in a throwaway config folder, recording each change it reports and each ask. */
async function runnerEnd(claudeDir = path.join(tempRoot(), "claude")) {
  const changes: string[] = [];
  const asked: unknown[] = [];
  const server = await createPipeServer({ claudeDir, log: () => {}, onChange: (s) => void changes.push(s), ask: async (request) => (asked.push(request), `answered: ${request.question}`) });
  closing.push(() => server.close());
  return { claudeDir, server, changes, asked };
}

/** A hooks module's end for session `session`, in this process, until `stop`. */
function hooksEnd(claudeDir: string, more: { session?: string; since?: number; version?: string } = {}) {
  const out: DataLayerLine[] = [];
  let on = true;
  const started: number[] = [];
  const ended = relay({
    claudeDir,
    hello: { session: more.session ?? "s1", cwd: "C:/w/repo", since: more.since ?? 1, messages: true, root: modDir, version: more.version ?? "0.12.0" },
    out: (line) => void out.push(line),
    goOn: () => on,
    startRunner: async () => void started.push(Date.now()),
    retryMs: async () => 50,
  });
  closing.push(async () => {
    on = false;
  });
  return { out, ended, started };
}

test("pipe: a named pipe with a random name on Windows; a socket in the user's own isoplan folder on macOS and Linux", () => {
  const dir = "C:\\Users\\ada\\.claude";
  expect(pipeAddress(dir, "win32", () => "abc")).toBe("\\\\.\\pipe\\isoplan-runner-abc");
  expect(pipeAddress(dir, "win32")).not.toBe(pipeAddress(dir, "win32"));
  expect(pipeAddress("/Users/ada/.claude", "darwin")).toBe("/Users/ada/.claude/isoplan/pipe/runner.sock");
  expect(pipeAddress("/home/ada/.claude", "linux")).toBe("/home/ada/.claude/isoplan/pipe/runner.sock");
});

test("pipe: of two hooks modules for a session, a newer version's keeps it, and of one version the later window's", () => {
  expect(keeps({ version: "0.12.0", since: 1 }, { version: "0.11.1", since: 9 })).toBe(true);
  expect(keeps({ version: "0.11.1", since: 9 }, { version: "0.12.0", since: 1 })).toBe(false);
  expect(keeps({ version: "0.12.0", since: 9 }, { version: "0.12.0", since: 1 })).toBe(true);
  expect(keeps({ version: "0.12.0", since: 1 }, { version: "0.12.0", since: 9 })).toBe(false);
});

test("pipe: the runner writes where its pipe is with a token; a hello without that token is refused and registers nothing", async () => {
  const { claudeDir, server, changes } = await runnerEnd();
  const info = (await readPipeInfo(claudeDir))!;
  expect(info.address).toBe(server.address);
  expect(info.token).toMatch(/^[0-9a-f]{64}$/);
  if (process.platform !== "win32") expect(fs.statSync(pipeInfoPath(claudeDir)).mode & 0o777).toBe(0o600);
  const socket = net.connect(info.address);
  const closed = new Promise((resolve) => socket.on("close", resolve).on("error", () => {}));
  socket.on("connect", () => writeLine(socket, { type: "hello", v: 1, token: "0".repeat(64), session: "s1", cwd: "C:/w", since: 1, messages: true, root: "C:/p", version: "0.12.0" }));
  await closed;
  expect(server.hooked("s1")).toBeNull();
  expect(changes).toEqual([]);
});

test("pipe: a hooks module's end registers its session and is sent that session's lines alone; another window's later one takes the session and the first is told", async () => {
  const { claudeDir, server, changes } = await runnerEnd();
  const first = hooksEnd(claudeDir, { since: 1 });
  const other = hooksEnd(claudeDir, { session: "s2" });
  await until(() => !!server.hooked("s1") && !!server.hooked("s2"));
  expect(server.hooked("s1")).toMatchObject({ session: "s1", cwd: "C:/w/repo", since: 1, messages: true, root: modDir, version: "0.12.0" });
  const status: DataLayerLine = { type: "status", server: "ws://office/data-layer", label: "dev", state: "connected" };
  server.hooked("s1")!.send(status);
  await until(() => first.out.length > 0);
  expect(first.out).toEqual([status]);
  expect(other.out).toEqual([]);

  const later = hooksEnd(claudeDir, { since: 2 });
  expect(await first.ended).toBe("superseded");
  expect(first.out.at(-1)).toEqual({ type: "superseded", reason: "window" });
  await until(() => server.hooked("s1")?.since === 2);
  // An older version's, for the same session, is told a newer version has it, and the later one keeps it.
  const older = hooksEnd(claudeDir, { since: 3, version: "0.11.1" });
  expect(await older.ended).toBe("superseded");
  expect(older.out).toEqual([{ type: "superseded", reason: "newer" }]);
  expect(server.hooked("s1")?.since).toBe(2);
  expect(changes.filter((s) => s === "s1")).toEqual(["s1", "s1"]);

  expect(later.out).toEqual([]);
});

test("pipe: a hooks module's connection that goes leaves no registration behind, and the runner hears of it", async () => {
  const { claudeDir, server, changes } = await runnerEnd();
  const info = (await readPipeInfo(claudeDir))!;
  const socket = net.connect(info.address);
  socket.on("connect", () => writeLine(socket, { type: "hello", v: 1, token: info.token, session: "s1", cwd: "C:/w", since: 1, messages: false, root: "C:/p", version: "0.12.0" }));
  await until(() => !!server.hooked("s1"));
  const closed = server.hooked("s1")!.closed;
  socket.destroy();
  await closed;
  await until(() => server.hooked("s1") === null);
  expect(changes).toEqual(["s1", "s1"]);
});

test("pipe: when the runner goes, the hooks module's end says so once, starts it, and tries again; with the runner back it says hello afresh", async () => {
  const before = await runnerEnd();
  const end = hooksEnd(before.claudeDir);
  await until(() => !!before.server.hooked("s1"));
  await before.server.close();
  await until(() => end.out.some((l) => l.type === "runner"));
  expect(end.out).toEqual([{ type: "runner", state: "down" }]);
  await until(() => end.started.length >= 3);
  // Still down: said once.
  expect(end.out).toEqual([{ type: "runner", state: "down" }]);

  // A runner started again: a pipe of its own, with a token of its own.
  const after = await runnerEnd(before.claudeDir);
  expect(after.server.address).not.toBe(before.server.address);
  await until(() => !!after.server.hooked("s1"));
  expect(end.out).toEqual([
    { type: "runner", state: "down" },
    { type: "runner", state: "up" },
  ]);
  expect(after.changes).toEqual(["s1"]);
});

/** dist/ask.js run as the hooks module runs it, for session s1, in the config folder `claudeDir`. */
const askScript = (claudeDir: string, question: string) =>
  new Promise<string>((resolve) => {
    const child = execFile(process.execPath, [path.join(modDir, "dist", "ask.js"), "--session", "s1", "--cwd", "C:/w/repo", "--server", "ws://office/data-layer", "--key", "toolu_1"], { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir }, windowsHide: true }, (_err, stdout) => resolve(stdout.trim()));
    child.stdin!.end(question);
  });

test("pipe: the ask_room script asks through the runner only for a session whose hooks module is connected; with no runner it says to carry on", async () => {
  const { claudeDir, server, asked } = await runnerEnd();
  expect(await askScript(claudeDir, "Why?")).toBe("The room can't be asked from here: this session isn't connected to Isoplan's runner. Carry on without the answer.");
  expect(asked).toEqual([]);
  hooksEnd(claudeDir);
  await until(() => !!server.hooked("s1"));
  expect(await askScript(claudeDir, "Why?")).toBe("answered: Why?");
  expect(asked).toEqual([{ type: "ask", v: 1, token: (await readPipeInfo(claudeDir))!.token, session: "s1", cwd: "C:/w/repo", servers: ["ws://office/data-layer"], key: "toolu_1", question: "Why?" }]);
  await server.close();
  expect(await askScript(claudeDir, "Why?")).toMatch(/^The room can't be asked right now: Isoplan's runner isn't running on this machine/);
});
