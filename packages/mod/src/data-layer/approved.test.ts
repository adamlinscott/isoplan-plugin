import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PROTOCOL_VERSION, type HelloMessage } from "@isoplan/protocol";
import { afterEach, expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { cachedRepos, createApproved, gateLink, type Get, type RepoList } from "./approved.js";
import { createLink, type Link } from "./link.js";
import type { Pairing, Refusal } from "./pairing.js";

const SERVER = "wss://office.team.example/data-layer";
const APP = "github.com/team/app";
const MINUTE = 60000;

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function folder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "isoplan-approved-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "approved.json");
}

/** A stand-in office server's GET /repos: answers what `list` holds, with a 304 for a current copy, and keeps each request's headers. */
function office(repos: string[] = [APP]) {
  const state = { repos, version: 1, status: 200 as number, asked: [] as Record<string, string>[], fails: false };
  const list = (): RepoList => ({ version: `v${state.version}`, offices: [{ id: "team", name: "Team", repos: state.repos }] });
  const get: Get = async (url, headers) => {
    expect(url).toBe("https://office.team.example/data-layer/repos");
    state.asked.push(headers);
    if (state.fails) throw new Error("ECONNREFUSED");
    if (state.status !== 200) return { status: state.status, body: state.status === 401 ? { code: "not-paired" } : null };
    if (headers["if-none-match"] === `"v${state.version}"`) return { status: 304, body: null };
    return { status: 200, body: list() };
  };
  return {
    state,
    get,
    change(next: string[]) {
      state.repos = next;
      state.version++;
    },
  };
}

test("the list is read once, kept on disk for every process of the machine, and checked again with its version once it is due", async () => {
  const file = folder();
  const o = office();
  let clock = 1_000_000;
  const options = { server: SERVER, file, refreshMs: 5 * MINUTE, log: () => {}, get: o.get, now: () => clock };
  const one = createApproved(options);
  expect(one.repos()).toBeNull();
  await one.refresh();
  expect([...one.repos()!]).toEqual([APP]);
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ server: SERVER, version: "v1" });
  expect(await cachedRepos(file, SERVER)).toEqual(new Set([APP]));
  expect(await cachedRepos(file, "wss://elsewhere.example/data-layer")).toBeNull();

  // Another process uses the copy as it is while it is fresh.
  const two = createApproved(options);
  await two.refresh();
  expect([...two.repos()!]).toEqual([APP]);
  expect(o.state.asked).toHaveLength(1);

  clock += 5 * MINUTE;
  await two.refresh();
  expect(o.state.asked[1]).toEqual({ "if-none-match": '"v1"' });
  expect([...two.repos()!]).toEqual([APP]);

  // A server that can't be reached leaves the copy as it was.
  clock += 5 * MINUTE;
  o.state.fails = true;
  await two.refresh();
  expect([...two.repos()!]).toEqual([APP]);
  expect(two.problem()).toBeNull();
});

test("with no copy, nothing is approved while the server can't be reached or is too old to list its repos", async () => {
  const o = office();
  o.state.fails = true;
  let clock = 0;
  const approved = createApproved({ server: SERVER, file: folder(), refreshMs: 5 * MINUTE, log: () => {}, get: o.get, now: () => clock });
  await approved.refresh();
  expect(approved.repos()).toBeNull();
  expect(approved.problem()).toBe("unreachable");
  o.state.fails = false;
  o.state.status = 404;
  clock += MINUTE;
  await approved.refresh();
  expect(approved.repos()).toBeNull();
  expect(approved.problem()).toBe("too-old");
});

test("a machine not paired yet pairs from the list's refusal, sending no token until it has one, then reads the list with it", async () => {
  const o = office();
  o.state.status = 401;
  const told: [Refusal, string | undefined][] = [];
  let token: string | null | undefined;
  const pairing: Pairing = {
    token: async () => token,
    refused: async (code, sent) => {
      told.push([code, sent]);
      token = null;
    },
    close: async () => {},
  };
  let clock = 0;
  const approved = createApproved({ server: SERVER, file: folder(), pairing, refreshMs: 5 * MINUTE, log: () => {}, get: o.get, now: () => clock });
  await approved.refresh();
  expect(o.state.asked).toEqual([{}]);
  expect(told).toEqual([["not-paired", undefined]]);
  // The pairing link waits to be clicked: the list isn't asked for.
  await approved.refresh();
  expect(approved.problem()).toBe("pairing");
  expect(o.state.asked).toHaveLength(1);

  token = "t0k3n-" + "of-the-machine";
  o.state.status = 200;
  clock += 5000;
  await approved.refresh();
  expect(o.state.asked[1]).toEqual({ authorization: "Bearer t0k3n-of-the-machine" });
  expect([...approved.repos()!]).toEqual([APP]);
});

const hello: HelloMessage = {
  type: "hello",
  v: PROTOCOL_VERSION,
  source: "claude-code",
  account: { id: "claude:4f9c", name: "Ada" },
  machine: { name: "sevengill" },
  session: "claude-code:s",
  project: { id: APP, name: "app" },
};

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("a session in a repo the office doesn't take opens no socket; added, it connects on the next check; taken out, its link closes", async () => {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => wss.once("listening", resolve));
  cleanups.push(() => new Promise((resolve) => wss.close(resolve)));
  const connections: { messages: { type: string }[]; closed: boolean }[] = [];
  wss.on("connection", (ws) => {
    const c = { messages: [] as { type: string }[], closed: false };
    connections.push(c);
    ws.on("message", (data) => c.messages.push(JSON.parse(String(data))));
    ws.on("close", () => (c.closed = true));
  });
  const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/data-layer`;

  const o = office([]);
  let clock = 0;
  const approved = createApproved({ server: url, file: folder(), refreshMs: 5 * MINUTE, log: () => {}, get: async (_u, h) => o.get("https://office.team.example/data-layer/repos", h), now: () => clock });
  let opened = 0;
  const open = (): Link => {
    opened++;
    const l = createLink({ url, hello, emit: () => {}, retryBaseMs: 20 });
    cleanups.push(() => l.close());
    return l;
  };

  let link: Link | null = null;
  let gated = await gateLink(approved, APP, link, open);
  expect(gated).toEqual({ link: null, dormancy: "not-approved" });
  await new Promise((r) => setTimeout(r, 100));
  expect(opened).toBe(0);
  expect(connections).toEqual([]);

  // An admin adds the repo: the next check opens the link, which says hello.
  o.change([APP]);
  clock += 5 * MINUTE;
  gated = await gateLink(approved, APP, link, open);
  link = gated.link;
  expect(gated.dormancy).toBeNull();
  await until(() => connections[0]?.messages.some((m) => m.type === "hello") ?? false);
  // The next pass keeps the same link.
  expect((await gateLink(approved, APP, link, open)).link).toBe(link);
  expect(opened).toBe(1);

  // Taken out: the forced check, as the server's not-wanted or a drop makes, closes it.
  o.change([]);
  clock += MINUTE;
  await approved.refresh(true);
  gated = await gateLink(approved, APP, link, open);
  expect(gated).toEqual({ link: null, dormancy: "not-approved" });
  await until(() => connections[0]!.closed);
  expect(connections).toHaveLength(1);
});
