import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Project } from "@isoplan/protocol";
import { afterEach, expect, test } from "vitest";
import { createApproved, type Get } from "../data-layer/approved.js";
import type { Post } from "../data-layer/pairing.js";
import { checkOffice, commandPairing, sentence } from "./repos.js";

const SERVER = "wss://internal.isoplan.app/data-layer";
const APP = "github.com/isoplan-app/isoplan";
const MINUTE = 60000;
const LIST = { refreshMs: 5 * MINUTE, maxAgeMs: 15 * MINUTE, log: () => {} };
const TOKEN = "t0k3n-" + "of-the-machine";
const SHOWS = "this session shows on its floor within a minute; if it doesn't, send any message in it.";
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

/** A pairing kept in a temp folder, holding `entry` for SERVER under the account "claude:a", that renews with `post`. */
function pairing(entry: Record<string, unknown> | null, post: Post = async () => expect.unreachable()) {
  const dir = folder();
  const file = path.join(dir, "pairing.json");
  writeFileSync(file, JSON.stringify({ accounts: {}, offices: entry ? { [SERVER]: { "claude:a": { server: SERVER, ...entry } } } : {} }));
  return { file, pairing: commandPairing({ file, writeLock: path.join(dir, "pairing.write.lock"), server: SERVER, account: "claude:a" }, () => {}, post) };
}

/** A copy of the list on disk, as a session confirmed it a minute ago. */
async function sessionCopy(get: Get): Promise<string> {
  const file = path.join(folder(), "approved.json");
  await createApproved({ ...LIST, server: SERVER, file, get }).refresh();
  return file;
}

const listing = (version: string, repos: string[]): Get => async () => ({ status: 200, body: { version, repos } });

test("the list is asked for past a fresh copy and kept for every process; the sentence names the repo, never the token", async () => {
  const file = await sessionCopy(listing("v1", []));
  const asked: Record<string, string>[] = [];
  const get: Get = async (url, headers) => (asked.push(headers), listing("v2", [APP])(url, headers));
  const { pairing: p } = pairing({ credential: "cred", token: TOKEN, tokenExpires: Date.now() + 60 * MINUTE });
  const answer = await checkOffice({ ...LIST, server: SERVER, file, pairing: p, get });
  expect(asked[0]).toMatchObject({ authorization: `Bearer ${TOKEN}` });
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: "v2", repos: [APP] });
  const said = sentence("internal.isoplan.app", answer, [project(APP)], false);
  expect(said).toBe(`internal.isoplan.app takes this repo (${APP}): ${SHOWS}`);
  expect(said).not.toContain(TOKEN);
});

test("a token renewed for the command is kept in pairing.json for the sessions, as the data layer keeps one", async () => {
  const { file, pairing: p } = pairing({ credential: "cred" }, async () => ({ status: 200, body: { token: TOKEN, expires: "2099-01-01T00:00:00.000Z" } }));
  expect(await p.token()).toBe(TOKEN);
  expect(JSON.parse(readFileSync(file, "utf8")).offices[SERVER]["claude:a"]).toMatchObject({ credential: "cred", token: TOKEN });
});

test("with a copy on disk, an ended pairing says not connected and a /token 500 says couldn't reach, from what the server answered", async () => {
  const say = async (renewal: number) => {
    const file = await sessionCopy(listing("v1", [APP]));
    const { pairing: p } = pairing({ credential: "cred" }, async () => ({ status: renewal, body: { code: "pairing-ended" } }));
    return sentence("office", await checkOffice({ ...LIST, server: SERVER, file, pairing: p, get: async () => expect.unreachable() }), [project(APP)], false);
  };
  expect(await say(401)).toMatch(/^This computer isn't connected to office/);
  expect(await say(500)).toBe("Couldn't reach office to ask which repos it takes: try /isoplan:repos again in a minute.");
});

test("an office that doesn't take the repo, refuses this machine, can't be reached, or is too old each get their sentence", async () => {
  const say = async (get: Get) => {
    const file = path.join(folder(), "approved.json");
    return sentence("office", await checkOffice({ ...LIST, server: SERVER, file, pairing: pairing(null).pairing, get }), [project(APP)], false);
  };
  expect(await say(listing("v1", ["github.com/isoplan-app/other"]))).toBe(`office doesn't take this repo (${APP}): an admin can add it under Repos on the floor.`);
  expect(await say(async () => ({ status: 401, body: { code: "not-paired" } }))).toMatch(/^This computer isn't connected to office/);
  expect(await say(async () => Promise.reject(new Error("ECONNREFUSED")))).toMatch(/^Couldn't reach office/);
  expect(await say(async () => ({ status: 404, body: null }))).toMatch(/^office is too old/);
});

test("a workspace is taken when one of its repos is, and named as that repo; one git can't read is said plainly", () => {
  const repos = [project("github.com/team/api"), project(APP)];
  expect(sentence("office", { kind: "listed", repos: new Set([APP]) }, repos, true)).toBe(`office takes ${APP}, a repo in this folder: ${SHOWS}`);
  expect(sentence("office", { kind: "listed", repos: new Set() }, repos, true)).toMatch(/^office takes none of the repos in this folder \(github\.com\/team\/api, github\.com\/isoplan-app\/isoplan\)/);
  expect(sentence("office", { kind: "listed", repos: new Set() }, [], true)).toBe("Git couldn't read the repos in this folder, so nothing of this session is sent to office.");
});
