import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { Run } from "./git.js";
import { projectOf } from "./identity.js";
import { ANSWER_MS, credentialToken, ghToken, gitHubAsker, machineTokens, remoteNames, RETRY_MS, type AskGitHub, type Exec } from "./remote-names.js";

const OLD = { id: "github.com/adamlinscott/isoplan", name: "isoplan" };
const TOKEN = "gho_secret123";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function cacheFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "isoplan-remote-names-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "isoplan", "remote-names.json");
}

/** A stand-in for GitHub's answers, by `owner/repo`; one missing fails. Keeps every ask. */
function github(answers: Record<string, string | null>) {
  const asked: string[] = [];
  const ask: AskGitHub = async (owner, repo) => {
    asked.push(`${owner}/${repo}`);
    return answers[`${owner}/${repo}`] ?? null;
  };
  return { ask, asked, answers };
}

const clock = (start = 1_000_000) => {
  const c = { t: start, now: () => c.t };
  return c;
};

test("remote names: a repo that moved is asked about the first time it is seen, before its project is given, and reported as it is named now", async () => {
  const file = cacheFile();
  const gh = github({ "adamlinscott/isoplan": "isoplan-app/isoplan-app" });
  const names = remoteNames({ file, ask: gh.ask });
  expect(await names.current(OLD)).toEqual({ id: "github.com/isoplan-app/isoplan-app", name: "isoplan-app" });
  expect(gh.asked).toEqual(["adamlinscott/isoplan"]);
  // Another process reads the answer from the cache, without asking.
  const other = github({});
  expect(await remoteNames({ file, ask: other.ask }).current(OLD)).toEqual({ id: "github.com/isoplan-app/isoplan-app", name: "isoplan-app" });
  expect(other.asked).toEqual([]);
});

test("remote names: an unchanged repo stays as it is, whatever letter case GitHub gives it", async () => {
  const gh = github({ "team/app": "Team/App" });
  const names = remoteNames({ file: cacheFile(), ask: gh.ask });
  const app = { id: "github.com/team/app", name: "App" };
  expect(await names.current(app)).toBe(app);
  expect(await names.current(app)).toBe(app);
  expect(gh.asked).toEqual(["team/app"]);
});

test("remote names: any host but github.com, and a local project, are never asked about", async () => {
  const gh = github({});
  const names = remoteNames({ file: cacheFile(), ask: gh.ask });
  for (const p of [{ id: "gitlab.com/team/app", name: "app" }, { id: "gitlab.com/group/sub/app", name: "app" }, { id: "github.example.com/team/app", name: "app" }, { id: "local:desk/C:/w/app", name: "app" }]) expect(await names.current(p)).toBe(p);
  expect(await names.idOf("https://gitlab.com/Team/App.git")).toBe("gitlab.com/team/app");
  expect(gh.asked).toEqual([]);
});

test("remote names: a known answer is given at once; after a day it is asked again in the background, so a later rename is caught", async () => {
  const c = clock();
  const gh = github({ "team/app": "team/app" });
  const names = remoteNames({ file: cacheFile(), ask: gh.ask, now: c.now });
  const app = { id: "github.com/team/app", name: "app" };
  await names.current(app);
  c.t += ANSWER_MS - 1;
  expect(await names.current(app)).toBe(app);
  expect(gh.asked).toHaveLength(1);
  gh.answers["team/app"] = "team/app-renamed";
  c.t += 1;
  // Nothing waits on the refresh: the old answer stands until it is in.
  expect(await names.current(app)).toBe(app);
  await vi.waitFor(async () => expect((await names.current(app)).id).toBe("github.com/team/app-renamed"));
  expect(gh.asked).toHaveLength(2);
});

test("remote names: a failed first ask gives the remote's own id and is tried again soon, in the background, then less often", async () => {
  const c = clock();
  const file = cacheFile();
  const gh = github({});
  const names = remoteNames({ file, ask: gh.ask, now: c.now });
  expect(await names.current(OLD)).toBe(OLD);
  expect(gh.asked).toHaveLength(1);
  c.t += RETRY_MS - 1;
  await names.current(OLD);
  expect(gh.asked).toHaveLength(1);
  c.t += 1;
  await names.current(OLD);
  await vi.waitFor(() => expect(gh.asked).toHaveLength(2));
  await vi.waitFor(() => expect(JSON.parse(readFileSync(file, "utf8"))[OLD.id].failures).toBe(2));
  // The second failure waits twice as long; then the answer comes.
  gh.answers["adamlinscott/isoplan"] = "isoplan-app/isoplan-app";
  c.t += RETRY_MS;
  await names.current(OLD);
  expect(gh.asked).toHaveLength(2);
  c.t += RETRY_MS;
  await names.current(OLD);
  await vi.waitFor(async () => expect((await names.current(OLD)).id).toBe("github.com/isoplan-app/isoplan-app"));
});

test("remote names: a failure after a rename was known keeps the current name", async () => {
  const c = clock();
  const gh = github({ "adamlinscott/isoplan": "isoplan-app/isoplan-app" });
  const names = remoteNames({ file: cacheFile(), ask: gh.ask, now: c.now });
  await names.current(OLD);
  gh.answers["adamlinscott/isoplan"] = null;
  c.t += ANSWER_MS;
  await names.current(OLD);
  await vi.waitFor(() => expect(gh.asked).toHaveLength(2));
  expect((await names.current(OLD)).id).toBe("github.com/isoplan-app/isoplan-app");
});

test("remote names: without an asker (a one-shot command) only the cache is read", async () => {
  const file = cacheFile();
  expect(await remoteNames({ file }).current(OLD)).toBe(OLD);
  await remoteNames({ file, ask: github({ "adamlinscott/isoplan": "isoplan-app/isoplan-app" }).ask }).current(OLD);
  expect(await remoteNames({ file }).current(OLD)).toEqual({ id: "github.com/isoplan-app/isoplan-app", name: "isoplan-app" });
});

test("remote names: a remote URL keeps its form, and the cache holds no credentials", async () => {
  const file = cacheFile();
  const names = remoteNames({ file, ask: github({ "adamlinscott/isoplan": "isoplan-app/isoplan-app" }).ask });
  expect(await names.urlOf("https://github.com/adamlinscott/isoplan.git")).toBe("https://github.com/isoplan-app/isoplan-app.git");
  expect(await names.urlOf("git@github.com:AdamLinscott/Isoplan")).toBe("git@github.com:isoplan-app/isoplan-app");
  expect(await names.urlOf("ssh://git@github.com/adamlinscott/isoplan.git")).toBe("ssh://git@github.com/isoplan-app/isoplan-app.git");
  expect(await names.urlOf("https://github.com/team/other.git")).toBe("https://github.com/team/other.git");
  expect(await names.idOf(`https://x-access-token:${TOKEN}@github.com/adamlinscott/isoplan`)).toBe("github.com/isoplan-app/isoplan-app");
  const text = readFileSync(file, "utf8");
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain("x-access-token");
});

test("project: with names, an old clone's remote is the repo's current project", async () => {
  const run: Run = () => ({ code: 0, stdout: "https://github.com/AdamLinscott/Isoplan.git\n" });
  const names = remoteNames({ file: cacheFile(), ask: github({ "adamlinscott/isoplan": "isoplan-app/isoplan-app" }).ask });
  const where = { toplevel: "C:/w/isoplan", commonDir: "C:/w/isoplan/.git", branch: "main" };
  expect(await projectOf(run, where, "C:/w/isoplan", "desk", { names })).toEqual({ id: "github.com/isoplan-app/isoplan-app", name: "isoplan-app" });
});

/** A stand-in for fetch: answers by the token it is sent ("none" without one), and keeps each request's headers. */
function api(byToken: Record<string, { status: number; body?: unknown }>) {
  const sent: Record<string, string>[] = [];
  const fetch = (async (_url: string, init: { headers: Record<string, string> }) => {
    sent.push(init.headers);
    const auth = init.headers.Authorization?.replace(/^Bearer /, "") ?? "none";
    const a = byToken[auth] ?? { status: 404 };
    return { status: a.status, json: async () => a.body };
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

test("GitHub: a private repo is answered with the first token a source gives", async () => {
  const { fetch, sent } = api({ [TOKEN]: { status: 200, body: { full_name: "isoplan-app/isoplan-app" } } });
  const second = vi.fn(async () => "other");
  const ask = gitHubAsker({ fetch, tokens: [async () => null, async () => TOKEN, second] });
  expect(await ask("adamlinscott", "isoplan")).toBe("isoplan-app/isoplan-app");
  expect(second).not.toHaveBeenCalled();
  expect(sent.map((h) => h.Authorization)).toEqual([`Bearer ${TOKEN}`]);
});

test("GitHub: with no token, a public repo is asked without one; a private one isn't known", async () => {
  const { fetch, sent } = api({ none: { status: 200, body: { full_name: "team/app" } } });
  const failing = async () => Promise.reject(new Error("gh isn't installed"));
  expect(await gitHubAsker({ fetch, tokens: [failing, async () => null] })("team", "app")).toBe("team/app");
  expect(sent[0]!.Authorization).toBeUndefined();
  expect(await gitHubAsker({ fetch: api({}).fetch, tokens: [] })("team", "private")).toBeNull();
});

test("GitHub: a token it refuses is dropped and the repo asked without it", async () => {
  const { fetch, sent } = api({ [TOKEN]: { status: 401 }, none: { status: 200, body: { full_name: "team/app" } } });
  expect(await gitHubAsker({ fetch, tokens: [async () => TOKEN] })("team", "app")).toBe("team/app");
  expect(sent).toHaveLength(2);
});

test("GitHub: a timeout, a network failure or an odd answer is no answer, with no token in what it throws", async () => {
  const hang = ((_url: string, init: { signal: AbortSignal }) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))) as unknown as typeof globalThis.fetch;
  expect(await gitHubAsker({ fetch: hang, tokens: [async () => TOKEN], timeoutMs: 20 })("team", "app")).toBeNull();
  const offline = (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof globalThis.fetch;
  expect(await gitHubAsker({ fetch: offline, tokens: [] })("team", "app")).toBeNull();
  expect(await gitHubAsker({ fetch: api({ none: { status: 200, body: { full_name: "not a name" } } }).fetch, tokens: [] })("team", "app")).toBeNull();
  expect(await gitHubAsker({ fetch: api({ none: { status: 500 } }).fetch, tokens: [] })("team", "app")).toBeNull();
});

/** A stand-in for running a command: answers by command name, and keeps each call. */
function commands(answers: Record<string, { code: number; stdout: string }>) {
  const calls: { cmd: string; args: string[]; env: Record<string, string | undefined>; input?: string }[] = [];
  const exec: Exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, ...opts });
    return answers[cmd] ?? { code: 1, stdout: "" };
  };
  return { exec, calls };
}

test("tokens: gh's when it is signed in, with its prompts off", async () => {
  const { exec, calls } = commands({ gh: { code: 0, stdout: `${TOKEN}\n` } });
  expect(await ghToken(exec, { PATH: "/bin" })).toBe(TOKEN);
  expect(calls[0]).toMatchObject({ cmd: "gh", args: ["auth", "token", "--hostname", "github.com"], env: { PATH: "/bin", GH_PROMPT_DISABLED: "1" } });
  expect(await ghToken(commands({ gh: { code: 1, stdout: "" } }).exec, {})).toBeNull();
});

test("tokens: git's stored credential for github.com, asked with every prompt off", async () => {
  const { exec, calls } = commands({ git: { code: 0, stdout: `protocol=https\nhost=github.com\nusername=ada\npassword=${TOKEN}\n` } });
  expect(await credentialToken(exec, { GIT_ASKPASS: "/usr/bin/code-askpass" })).toBe(TOKEN);
  expect(calls[0]!.input).toBe("protocol=https\nhost=github.com\n\n");
  expect(calls[0]!.env).toMatchObject({ GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_ASKPASS: "", SSH_ASKPASS: "" });
  expect(await credentialToken(commands({ git: { code: 128, stdout: "" } }).exec, {})).toBeNull();
});

test("tokens: gh first, then git's credentials on Windows only (the macOS keychain may show a dialog)", async () => {
  const { exec, calls } = commands({});
  for (const source of machineTokens("win32", {}, exec)) await source();
  expect(calls.map((c) => c.cmd)).toEqual(["gh", "git"]);
  expect(machineTokens("darwin", {}, exec)).toHaveLength(1);
});
