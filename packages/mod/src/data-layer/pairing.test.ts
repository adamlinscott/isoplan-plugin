import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { DataLayerLine } from "../lines.js";
import { createPairing, httpUrl, pairingPath, readPairing, type Post } from "./pairing.js";

const SERVER = "wss://office.team.example/data-layer";
const ACCOUNT = { id: "claude:4f9c", name: "Ada" };
const START = Date.parse("2026-10-20T09:00:00Z");
const MINUTE = 60 * 1000;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake office server's pairing routes: what was asked, and whether the code has been approved. */
function office() {
  const calls: string[] = [];
  const state = { approved: false, takes: true, codes: 0, tokens: 0 };
  const post: Post = async (url, body) => {
    const route = new URL(url).pathname.replace("/data-layer", "");
    calls.push(route);
    if (route === "/pair") {
      state.codes++;
      return { status: 200, body: { code: `ABCD-234${state.codes}`, device: `device-${state.codes}`, url: `https://office.team.example/#pair=ABCD-234${state.codes}`, expires: new Date(clock + 10 * MINUTE).toISOString() } };
    }
    if (route === "/pair/collect") {
      expect(body).toEqual({ device: `device-${state.codes}` });
      return state.approved ? { status: 200, body: { credential: "cred.secret" } } : { status: 202, body: { waiting: true } };
    }
    expect(route).toBe("/token");
    if (!state.takes || (body as { credential: string }).credential !== "cred.secret") return { status: 401, body: { code: "not-paired", error: "revoked" } };
    state.tokens++;
    return { status: 200, body: { token: `token-${state.tokens}`, expires: new Date(clock + 60 * MINUTE).toISOString() } };
  };
  return { calls, state, post };
}

let clock = START;
function setUp(server = office(), file?: string) {
  clock = START;
  const dir = mkdtempSync(path.join(tmpdir(), "isoplan-pairing-"));
  dirs.push(dir);
  const lines: DataLayerLine[] = [];
  const at = file ?? pairingPath(dir);
  const make = (account = ACCOUNT, url = SERVER) => createPairing({ file: at, server: url, account, machine: "sevengill", emit: (line) => lines.push(line), post: server.post, now: () => clock });
  return { pairing: make(), make, file: at, lines, ...server };
}

test("the data-layer address gives the pairing routes beside it", () => {
  expect(httpUrl("wss://office.team.example/data-layer", "/pair")).toBe("https://office.team.example/data-layer/pair");
  expect(httpUrl("ws://127.0.0.1:4747/data-layer", "/token")).toBe("http://127.0.0.1:4747/data-layer/token");
});

test("nothing is paired, and no token sent, until the server asks for one", async () => {
  const { pairing, calls } = setUp();
  expect(await pairing.token()).toBeUndefined();
  expect(calls).toEqual([]);
});

test("refused as not-paired: a code, shown once, then the credential and a token once it is approved", async () => {
  const { pairing, file, lines, calls, state } = setUp();
  await pairing.refused("not-paired", undefined);
  expect(await pairing.token()).toBeNull();
  expect(lines).toEqual([{ type: "pair", server: SERVER, code: "ABCD-2341", url: "https://office.team.example/#pair=ABCD-2341", expires: new Date(START + 10 * MINUTE).toISOString() }]);
  // The same code is asked about again, not shown again.
  expect(await pairing.token()).toBeNull();
  expect(lines.filter((l) => l.type === "pair")).toHaveLength(1);
  expect(calls).toEqual(["/pair", "/pair/collect", "/pair/collect"]);

  state.approved = true;
  expect(await pairing.token()).toBe("token-1");
  expect(await readPairing(file)).toEqual({ server: SERVER, account: ACCOUNT.id, credential: "cred.secret", token: "token-1", tokenExpires: START + 60 * MINUTE });
  if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  // Until it nears its end the token is used as it is.
  clock += 50 * MINUTE;
  expect(await pairing.token()).toBe("token-1");
  clock += 6 * MINUTE;
  expect(await pairing.token()).toBe("token-2");
});

test("another data layer of the machine takes the code waiting, and the credential, from the file", async () => {
  const { pairing, make, lines, state } = setUp();
  await pairing.refused("not-paired", undefined);
  await pairing.token();
  const other = make();
  // A code is waiting in the file, so the other pairs with it without being refused first.
  expect(await other.token()).toBeNull();
  expect(state.codes).toBe(1);
  expect(lines.filter((l) => l.type === "pair").map((l) => (l as { code: string }).code)).toEqual(["ABCD-2341", "ABCD-2341"]);
  state.approved = true;
  expect(await other.token()).toBe("token-1");
  expect(await pairing.token()).toBe("token-1");
});

test("a revoked pairing: the credential is dropped and the machine pairs again", async () => {
  const { pairing, file, state } = setUp();
  await pairing.refused("not-paired", undefined);
  state.approved = true;
  expect(await pairing.token()).toBe("token-1");
  state.approved = false;

  // The server refuses the hello that carried token-1, and won't renew the credential.
  state.takes = false;
  await pairing.refused("not-paired", "token-1");
  expect(await readPairing(file)).toEqual({ server: SERVER, account: ACCOUNT.id });
  expect(await pairing.token()).toBeNull();
  expect(state.codes).toBe(2);
});

test("token-expired renews it; a refusal of an older token leaves the newer one alone", async () => {
  const { pairing, file, state } = setUp();
  await pairing.refused("not-paired", undefined);
  state.approved = true;
  expect(await pairing.token()).toBe("token-1");
  await pairing.refused("token-expired", "token-1");
  expect(await pairing.token()).toBe("token-2");
  await pairing.refused("token-expired", "token-1");
  await pairing.refused("not-paired", "token-1");
  expect((await readPairing(file))?.token).toBe("token-2");
  expect(await pairing.token()).toBe("token-2");
});

test("a pairing for another server or another Claude account counts as none", async () => {
  const { pairing, make, state } = setUp();
  await pairing.refused("not-paired", undefined);
  state.approved = true;
  expect(await pairing.token()).toBe("token-1");
  expect(await make({ id: "claude:other", name: "Bo" }).token()).toBeUndefined();
  expect(await make(ACCOUNT, "wss://elsewhere.example/data-layer").token()).toBeUndefined();
});
