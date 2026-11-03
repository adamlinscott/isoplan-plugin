import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Project } from "@isoplan/protocol";
import { afterEach, expect, test } from "vitest";
import { createApproved, type Get } from "../data-layer/approved.js";
import type { Post } from "../data-layer/pairing.js";
import { checkOffice, readOnlyPairing, sentence } from "./repos.js";

const SERVER = "wss://internal.isoplan.app/data-layer";
const APP = "github.com/isoplan-app/isoplan";
const MINUTE = 60000;
const LIST = { refreshMs: 5 * MINUTE, maxAgeMs: 15 * MINUTE };
const TOKEN = "t0k3n-" + "of-the-machine";
const project = (id: string): Project => ({ id, name: id.split("/").pop()! });

const cleanups: (() => unknown)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function folder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "isoplan-repos-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A pairing.json in a temp folder, holding `entry` for SERVER under the account "claude:a". */
function pairingFile(dir: string, entry: Record<string, unknown> | null): string {
  const file = path.join(dir, "pairing.json");
  writeFileSync(file, JSON.stringify({ accounts: {}, offices: entry ? { [SERVER]: { "claude:a": { server: SERVER, ...entry } } } : {} }));
  return file;
}

const never: Post = async () => {
  throw new Error("not asked");
};

test("the list is asked for now, past a fresh copy, and kept for every process; the sentence names the repo, never the token", async () => {
  const dir = folder();
  const file = path.join(dir, "approved.json");
  let repos: string[] = [];
  let version = 1;
  const asked: Record<string, string>[] = [];
  const get: Get = async (_url, headers) => {
    asked.push(headers);
    return { status: 200, body: { version: `v${version}`, repos } };
  };
  // A session's copy, confirmed a moment ago, from before the admin added the repo.
  const session = createApproved({ ...LIST, server: SERVER, file, get, log: () => {} });
  await session.refresh();
  repos = [APP];
  version++;

  const pairing = readOnlyPairing(pairingFile(dir, { credential: "cred", token: TOKEN, tokenExpires: Date.now() + 60 * MINUTE }), SERVER, "claude:a", never);
  const answer = await checkOffice({ ...LIST, server: SERVER, file, pairing, get });
  expect(asked[1]).toMatchObject({ authorization: `Bearer ${TOKEN}` });
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: "v2", repos: [APP] });
  const said = sentence("internal.isoplan.app", answer, [project(APP)], false);
  expect(said).toBe(`internal.isoplan.app takes this repo (${APP}): this session shows on its floor within a minute.`);
  expect(said).not.toContain(TOKEN);
});

test("an office that doesn't take the repo, one this machine isn't paired with, one out of reach, and one too old each get their sentence", async () => {
  const dir = folder();
  const file = () => path.join(folder(), "approved.json");
  const answering = (status: number, body: unknown = null): Get => async () => ({ status, body });
  const unpaired = readOnlyPairing(pairingFile(dir, null), SERVER, "claude:a", never);
  const say = async (get: Get, pairing = unpaired) => sentence("office", await checkOffice({ ...LIST, server: SERVER, file: file(), pairing, get }), [project(APP)], false);

  expect(await say(answering(200, { version: "v1", repos: ["github.com/isoplan-app/other"] }))).toBe(`office doesn't take this repo (${APP}): an admin can add it under Repos on the floor.`);
  expect(await say(answering(401, { code: "not-paired" }))).toMatch(/^This computer isn't connected to office/);
  // A credential the office won't swap for a token: not paired either, and the list isn't asked for.
  const ended = readOnlyPairing(pairingFile(folder(), { credential: "cred" }), SERVER, "claude:a", async () => ({ status: 401, body: { code: "pairing-ended" } }));
  expect(await say(async () => expect.unreachable(), ended)).toMatch(/^This computer isn't connected to office/);
  expect(await say(async () => Promise.reject(new Error("ECONNREFUSED")))).toBe("Couldn't reach office to ask which repos it takes: try /isoplan:repos again in a minute.");
  expect(await say(answering(404))).toMatch(/^office is too old/);
});

test("a workspace is taken when one of its repos is, and named as that repo", () => {
  const repos = [project("github.com/team/api"), project(APP)];
  expect(sentence("office", { kind: "listed", repos: new Set([APP]) }, repos, true)).toBe(`office takes ${APP}, a repo in this folder: this session shows on its floor within a minute.`);
  expect(sentence("office", { kind: "listed", repos: new Set() }, repos, true)).toMatch(/^office takes none of the repos in this folder \(github\.com\/team\/api, github\.com\/isoplan-app\/isoplan\)/);
});
