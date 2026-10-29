import type { AddressInfo } from "node:net";
import { PROTOCOL_VERSION, type Facts, type HelloMessage, type RunnerHelloMessage } from "@isoplan/protocol";
import { afterEach, expect, test } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import type { DataLayerLine } from "../lines.js";
import { createLink, type Link, type LinkOptions, type ServerAsk } from "./link.js";

const at = "2026-10-20T09:00:00.000Z";
const hello: HelloMessage = {
  type: "hello",
  v: PROTOCOL_VERSION,
  source: "claude-code",
  account: { id: "claude:4f9c", name: "Ada" },
  machine: { name: "sevengill" },
  session: "claude-code:s",
  project: { id: "github.com/adam/isoplan", name: "isoplan" },
};
const facts = (status: "active" | "idle", edits: string[] = []): Facts => ({
  session: { id: "claude-code:s", source: "claude-code", lead: "claude-code:s:lead", title: "main", titleFrom: "branch", branch: "main", lastActive: at, status, lights: "on" },
  agents: [
    {
      id: "claude-code:s:lead",
      source: "claude-code",
      session: "claude-code:s",
      startedBy: null,
      agentType: null,
      task: null,
      status: "working",
      statusSince: at,
      lastActive: at,
      doing: null,
      usage: null,
    },
  ],
  edits: edits.map((file) => ({ agent: "claude-code:s:lead", file, at })),
  reads: [],
  waits: [],
  reports: [],
});

// A fake office server: every message it got, in order, with when, and its open sockets.
async function server() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => wss.once("listening", resolve));
  const got: { type: string; seq?: number; at: number; [key: string]: unknown }[] = [];
  const sockets: ServerSocket[] = [];
  wss.on("connection", (ws) => {
    sockets.push(ws);
    ws.on("message", (data) => got.push({ ...JSON.parse(String(data)), at: Date.now() }));
  });
  const { port } = wss.address() as AddressInfo;
  cleanups.push(() => new Promise((resolve) => wss.close(resolve)));
  return { url: `ws://127.0.0.1:${port}/data-layer`, got, sockets, wss };
}

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function link(url: string, opts: Partial<LinkOptions> = {}): { link: Link; lines: DataLayerLine[] } {
  const lines: DataLayerLine[] = [];
  const l = createLink({ url, hello, emit: (line) => lines.push(line), retryBaseMs: 20, retryCapMs: 100, ...opts });
  cleanups.push(() => l.close());
  return { link: l, lines };
}

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const types = (got: { type: string; seq?: number }[]) => got.map((m) => (m.seq === undefined ? m.type : `${m.type} ${m.seq}`));

test("link: hello, then full, then only what changed, seq going up by one", async () => {
  const s = await server();
  const { link: l, lines } = link(s.url, { minIntervalMs: 0 });
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  expect(types(s.got)).toEqual(["hello", "full 0"]);
  expect(s.got[0]).toMatchObject(hello);
  expect(s.got[1]).toMatchObject({ v: PROTOCOL_VERSION, facts: facts("active") });

  l.update(facts("active")); // nothing changed: nothing sent
  l.update(facts("idle", ["a.md"]));
  await until(() => s.got.length === 3);
  expect(s.got[2]).toMatchObject({ type: "changes", seq: 1, upsert: { session: facts("idle").session, edits: facts("idle", ["a.md"]).edits }, remove: {} });
  expect(lines.filter((x) => x.type === "status").map((x) => x.type === "status" && x.state)).toEqual(["connecting", "connected"]);
});

test("link: a repair gets the facts in full again", async () => {
  const s = await server();
  const { link: l } = link(s.url, { minIntervalMs: 0 });
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  l.update(facts("idle"));
  await until(() => s.got.length === 3);
  s.sockets[0]!.send(JSON.stringify({ type: "repair", v: PROTOCOL_VERSION, reason: "missed seq 1" }));
  await until(() => s.got.length === 4);
  expect(types(s.got)).toEqual(["hello", "full 0", "changes 1", "full 2"]);
  expect(s.got[3]).toMatchObject({ facts: facts("idle") });
});

test("link: a dropped link reconnects with backoff and sends hello and full again; nothing is kept while down", async () => {
  const s = await server();
  const { link: l, lines } = link(s.url, { minIntervalMs: 0 });
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  s.sockets[0]!.terminate();
  await until(() => lines.some((x) => x.type === "status" && x.state === "disconnected"));
  l.update(facts("idle", ["a.md"])); // while down
  await until(() => s.got.length === 4);
  expect(types(s.got)).toEqual(["hello", "full 0", "hello", "full 0"]);
  expect(s.got[3]).toMatchObject({ facts: facts("idle", ["a.md"]) });
  const down = lines.find((x) => x.type === "status" && x.state === "disconnected");
  expect(down).toMatchObject({ server: s.url, retryInMs: expect.any(Number) });
});

test("link: an unreachable server is retried with growing, capped delays", async () => {
  const s = await server();
  await new Promise((resolve) => s.wss.close(resolve));
  const { link: l, lines } = link(s.url, { random: () => 1, retryBaseMs: 10, retryCapMs: 40 });
  l.update(facts("active"));
  await until(() => lines.filter((x) => x.type === "status" && x.state === "disconnected").length >= 4);
  const delays = lines.flatMap((x) => (x.type === "status" && x.state === "disconnected" ? [x.retryInMs] : []));
  expect(delays.slice(0, 4)).toEqual([10, 20, 40, 40]);
});

test("link: changes go no faster than once a second, carrying the latest facts", async () => {
  const s = await server();
  const { link: l } = link(s.url);
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  l.update(facts("idle"));
  await new Promise((r) => setTimeout(r, 100));
  l.update(facts("idle", ["a.md"]));
  await until(() => s.got.length === 3);
  l.update(facts("idle", ["a.md", "b.md"]));
  await until(() => s.got.length === 4);
  expect(types(s.got)).toEqual(["hello", "full 0", "changes 1", "changes 2"]);
  // Arrival times, less a little for the timers' and the socket's own rounding.
  expect(s.got[2]!.at - s.got[1]!.at).toBeGreaterThanOrEqual(950);
  expect(s.got[3]!.at - s.got[2]!.at).toBeGreaterThanOrEqual(950);
  expect(s.got[2]).toMatchObject({ upsert: { session: facts("idle").session, edits: facts("idle", ["a.md"]).edits } });
});

test("link: the server's conflict notes and errors go out as lines; a message it can't read is logged", async () => {
  const s = await server();
  const { link: l, lines } = link(s.url, { minIntervalMs: 0 });
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  const conflict = { type: "conflict", v: PROTOCOL_VERSION, agent: "claude-code:s:lead", file: "a.md", text: "Bea's agent edited a.md 3 minutes ago." };
  s.sockets[0]!.send(JSON.stringify(conflict));
  s.sockets[0]!.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code: "not-paired", message: "Pair this machine first." }));
  s.sockets[0]!.send(JSON.stringify({ type: "conflict", v: PROTOCOL_VERSION + 1 }));
  await until(() => lines.length >= 5);
  expect(lines.slice(2)).toEqual([conflict, { type: "error", v: PROTOCOL_VERSION, code: "not-paired", message: "Pair this machine first." }, { type: "log", text: expect.stringContaining("unsupported-version") }]);
});

test("link: not-wanted is passed on, then the link waits and asks again only after notWantedRetryMs", async () => {
  const s = await server();
  s.wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code: "not-wanted", message: "this project isn't in any office on this server" }));
    ws.close(1008, "not-wanted");
  });
  let told = 0;
  const { link: l, lines } = link(s.url, { notWantedRetryMs: 300, onNotWanted: () => told++ });
  l.update(facts("active"));
  await until(() => lines.some((x) => x.type === "status" && x.state === "not-wanted"));
  expect(told).toBe(1);
  expect(lines).toContainEqual({ type: "error", v: PROTOCOL_VERSION, code: "not-wanted", message: "this project isn't in any office on this server" });
  expect(lines.some((x) => x.type === "status" && x.state === "disconnected")).toBe(false);
  await new Promise((r) => setTimeout(r, 150)); // the fast backoff would have tried again by now
  expect(s.sockets.length).toBe(1);
  await until(() => s.sockets.length === 2);
});

test("link: a conflict note for an agent outside this session is not passed on", async () => {
  const s = await server();
  const { link: l, lines } = link(s.url, { minIntervalMs: 0 });
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  s.sockets[0]!.send(JSON.stringify({ type: "conflict", v: PROTOCOL_VERSION, agent: "claude-code:someone-else", file: "a.md", text: "Not yours." }));
  await until(() => lines.length >= 3);
  expect(lines[2]).toEqual({ type: "log", text: expect.stringContaining("not an agent of this session") });
});

test("link: a runner's link passes the server's requests on, and a reply sent while down goes after the next hello", async () => {
  const s = await server();
  const runnerHello: RunnerHelloMessage = { type: "runner", v: PROTOCOL_VERSION, account: hello.account, machine: hello.machine };
  const asks: ServerAsk[] = [];
  const { link: l, lines } = link(s.url, { hello: runnerHello, onMessage: (m) => asks.push(m) });
  await until(() => s.got.length === 1);
  expect(s.got[0]).toMatchObject(runnerHello);
  const request = { type: "request", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", session: "claude-code:s", room: "r", from: { id: "claude:bob", name: "Bob" }, question: "Why?" };
  s.sockets[0]!.send(JSON.stringify(request));
  s.sockets[0]!.send(JSON.stringify({ type: "release", v: PROTOCOL_VERSION, id: "q0" }));
  await until(() => asks.length === 2);
  expect(asks).toEqual([request, { type: "release", v: PROTOCOL_VERSION, id: "q0" }]);

  s.sockets[0]!.terminate();
  await until(() => lines.some((x) => x.type === "status" && x.state === "disconnected"));
  l.send({ type: "reply", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", answer: "Because." });
  await until(() => s.got.length === 3);
  expect(types(s.got)).toEqual(["runner", "runner", "reply"]);
  expect(s.got[2]).toMatchObject({ id: "q1", answer: "Because." });
});
