import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { readPairing, type Post } from "../data-layer/pairing.js";
import { runnerLockPath } from "../runner/start.js";
import { connect, stopReporting } from "./connect.js";

const DEFAULTS = path.join(import.meta.dirname, "..", "..", "config.json");
const CODE = "c".repeat(43);
const LINK = `isoplan://connect?${new URLSearchParams({ office: "https://office.team.com", code: CODE, name: "Team" })}`;
const ADA = { id: "claude:4f9c", name: "Ada" };
// A fake credential, split so no whole secret-shaped string sits in the source.
const CREDENTIAL = "cred" + ".s3cret";

function setup(answer: { status: number; body: Record<string, unknown> } = { status: 200, body: { credential: CREDENTIAL } }, yes = true) {
  const claudeDir = path.join(tempRoot(), ".claude");
  const calls: { url: string; body: unknown }[] = [];
  const told: [string, boolean][] = [];
  const restarts: number[] = [];
  const post: Post = async (url, body) => (calls.push({ url, body }), answer);
  const run = () =>
    connect(LINK, {
      claudeDir,
      defaultsPath: DEFAULTS,
      account: async () => ADA,
      machine: "desk",
      ask: async () => yes,
      tell: async (_title, text, problem = false) => void told.push([text, problem]),
      restart: async () => (restarts.push(1), []),
      log: () => {},
      post,
    });
  const config = () => path.join(claudeDir, "isoplan", "config.json");
  return { claudeDir, calls, told, restarts, run, config };
}

test("on Yes, the code is swapped for the machine's credential, which is kept in pairing.json, and the office is added to config.json", async () => {
  const s = setup();
  fs.mkdirSync(path.dirname(s.config()), { recursive: true });
  fs.writeFileSync(s.config(), JSON.stringify({ servers: [{ label: "dev", server: "ws://127.0.0.1:4747/data-layer" }] }));
  expect(await s.run()).toBe(true);
  const pairing = await readPairing(path.join(s.claudeDir, "isoplan", "pairing.json"));
  expect(s.calls).toEqual([{ url: "https://office.team.com/data-layer/connect", body: { code: CODE, account: ADA, machine: { name: "desk", id: pairing.machine } } }]);
  expect(pairing.offices).toEqual({ "wss://office.team.com/data-layer": { [ADA.id]: { server: "wss://office.team.com/data-layer", credential: CREDENTIAL } } });
  expect(JSON.parse(fs.readFileSync(s.config(), "utf8")).servers).toEqual([
    { label: "dev", server: "ws://127.0.0.1:4747/data-layer" },
    { label: "team", server: "wss://office.team.com/data-layer" },
  ]);
  // The running data layers start again with the new office.
  expect(s.restarts).toHaveLength(1);
  expect(s.told).toEqual([["Connected to Team. Claude Code reports to it from your next prompt.", false]]);
});

test("on No, or when the office refuses the code, nothing is changed; a config.json that doesn't parse is never overwritten", async () => {
  const no = setup(undefined, false);
  expect(await no.run()).toBe(false);
  expect(no.calls).toEqual([]);
  expect(fs.existsSync(path.join(no.claudeDir, "isoplan"))).toBe(false);

  const refused = setup({ status: 410, body: { error: "this connect link has expired or been used" } });
  expect(await refused.run()).toBe(false);
  expect(fs.existsSync(refused.config())).toBe(false);
  expect((await readPairing(path.join(refused.claudeDir, "isoplan", "pairing.json"))).offices).toBeUndefined();
  expect(refused.told).toEqual([["Claude Code wasn't connected to Team: this connect link has expired or been used. Nothing was changed.", true]]);

  const broken = setup();
  fs.mkdirSync(path.dirname(broken.config()), { recursive: true });
  fs.writeFileSync(broken.config(), "{ not json");
  expect(await broken.run()).toBe(false);
  expect(broken.calls).toEqual([]);
  expect(fs.readFileSync(broken.config(), "utf8")).toBe("{ not json");
});

test("the running data layers are stopped only while their pid still runs a data layer, and the runner with them", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const live = path.join(claudeDir, "isoplan", "live");
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, "s1.json"), JSON.stringify({ pid: 101, dataLayer: "/p/dist/data-layer.js" }));
  fs.writeFileSync(path.join(live, "s2.json"), JSON.stringify({ pid: 102, dataLayer: "/p/dist/data-layer.js" }));
  fs.writeFileSync(path.join(live, "s3.json"), JSON.stringify({ pid: 0, until: Date.now() + 60000 }));
  fs.mkdirSync(path.join(claudeDir, "isoplan", "runner"), { recursive: true });
  fs.writeFileSync(runnerLockPath(claudeDir), JSON.stringify({ pid: 200 }));
  const killed: number[] = [];
  const commands: Record<number, string> = { 101: "node /p/dist/data-layer.js --session s1", 102: "notepad.exe" };
  const stopped = await stopReporting(claudeDir, { isAlive: () => true, commandOf: async (pid) => commands[pid] ?? null, kill: (pid) => void killed.push(pid) });
  expect(killed).toEqual([101, 200]);
  expect(stopped).toHaveLength(2);
});
