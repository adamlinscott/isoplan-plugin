import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { postJson, readPairing, writePairing, type Post } from "../data-layer/pairing.js";
import { runnerLockPath } from "../runner/start.js";
import { connect, connectLockPath, dialogText, stopReporting } from "./connect.js";

const DEFAULTS = path.join(import.meta.dirname, "..", "..", "config.json");
const CODE = "c".repeat(43);
const LINK = `isoplan://connect?${new URLSearchParams({ office: "https://office.team.com", code: CODE, name: "Team" })}`;
const SERVER = "wss://office.team.com/data-layer";
const ADA = { id: "claude:4f9c", name: "Ada" };
const SAM = { name: "Sam", email: "sam@team.com" };
// A fake credential, split so no whole secret-shaped string sits in the source.
const CREDENTIAL = "cred" + ".s3cret";

type Answer = { status: number; body: Record<string, unknown> };
function setup({ redeem = { status: 200, body: { credential: CREDENTIAL } } as Answer, yes = true as boolean | (() => Promise<boolean>) } = {}) {
  const claudeDir = path.join(tempRoot(), ".claude");
  const calls: { url: string; body: unknown }[] = [];
  const asked: string[] = [];
  const told: [string, boolean][] = [];
  const logged: string[] = [];
  const restarts: number[] = [];
  const post: Post = async (url, body) => {
    calls.push({ url, body });
    return url.endsWith("/peek") ? { status: 200, body: { person: SAM, office: "Team" } } : redeem;
  };
  const run = () =>
    connect(LINK, {
      claudeDir,
      defaultsPath: DEFAULTS,
      account: async () => ADA,
      machine: "desk",
      ask: async (_title, text) => (asked.push(text), typeof yes === "function" ? yes() : yes),
      tell: async (_title, text, problem = false) => void told.push([text, problem]),
      restart: async () => (restarts.push(1), []),
      log: (text) => void logged.push(text),
      post,
    });
  const config = () => path.join(claudeDir, "isoplan", "config.json");
  const writeConfig = (value: unknown) => {
    fs.mkdirSync(path.dirname(config()), { recursive: true });
    fs.writeFileSync(config(), typeof value === "string" ? value : JSON.stringify(value));
  };
  return { claudeDir, calls, asked, told, logged, restarts, run, config, writeConfig };
}

test("on Connect, the code is swapped for the machine's credential, kept in pairing.json, and the office is added to config.json", async () => {
  const s = setup();
  s.writeConfig({ servers: [{ label: "dev", server: "ws://127.0.0.1:4747/data-layer" }] });
  expect(await s.run()).toBe(true);
  const pairing = await readPairing(path.join(s.claudeDir, "isoplan", "pairing.json"));
  expect(s.calls).toEqual([
    { url: "https://office.team.com/data-layer/connect/peek", body: { code: CODE } },
    { url: "https://office.team.com/data-layer/connect", body: { code: CODE, account: ADA, machine: { name: "desk", id: pairing.machine } } },
  ]);
  expect(pairing.offices).toEqual({ [SERVER]: { [ADA.id]: { server: SERVER, credential: CREDENTIAL } } });
  expect(JSON.parse(fs.readFileSync(s.config(), "utf8")).servers).toEqual([
    { label: "dev", server: "ws://127.0.0.1:4747/data-layer" },
    { label: "team", server: SERVER },
  ]);
  expect(s.restarts).toHaveLength(1);
  expect(s.told).toEqual([["Connected to office.team.com as Sam. Claude Code reports to it from your next prompt.", false]]);
  expect(fs.existsSync(connectLockPath(s.claudeDir))).toBe(false);
});

test("the dialog names the host first, the person the machine will report as, what the office calls itself, and a pairing it replaces", async () => {
  const s = setup({ yes: false });
  await writePairing(path.join(s.claudeDir, "isoplan", "pairing.json"), { accounts: {}, offices: { [SERVER]: { [ADA.id]: { server: SERVER, credential: "old" } } } });
  expect(await s.run()).toBe(false);
  expect(s.asked).toEqual([dialogText("office.team.com", { person: "Sam", email: "sam@team.com", office: "Team" }, true)]);
  const [first, ...rest] = s.asked[0]!.split("\n");
  expect(first).toBe("Connect to office.team.com?");
  expect(rest.join("\n")).toContain("as Sam (sam@team.com)");
  expect(rest.join("\n")).toContain('The office calls itself "Team".');
  expect(rest.join("\n")).toContain("This replaces this computer's current pairing with office.team.com.");
  expect(dialogText("office.team.com", { person: "Sam", email: "sam@team.com", office: "Team" }, false)).not.toContain("replaces");
  // Cancelled: nothing swapped, nothing written.
  expect(s.calls.map((c) => c.url)).toEqual(["https://office.team.com/data-layer/connect/peek"]);
  expect(fs.existsSync(s.config())).toBe(false);
});

test("Cancel, a dialog that can't be shown, or an office refusing the code change nothing; a config.json that doesn't parse is never overwritten", async () => {
  const cannot = setup({ yes: () => Promise.reject(new Error("no display")) });
  expect(await cannot.run()).toBe(false);
  expect(cannot.told).toEqual([["Claude Code wasn't connected to office.team.com: the confirmation couldn't be shown (no display). Nothing was changed.", true]]);
  expect(cannot.calls).toHaveLength(1);

  const refused = setup({ redeem: { status: 410, body: { error: "this connect link has expired or been used" + "!".repeat(300) } } });
  expect(await refused.run()).toBe(false);
  expect(fs.existsSync(refused.config())).toBe(false);
  expect((await readPairing(path.join(refused.claudeDir, "isoplan", "pairing.json"))).offices).toBeUndefined();
  // The office's own words, labelled as its, and cut short.
  expect(refused.told[0]![0]).toMatch(/^Claude Code wasn't connected to office\.team\.com: the office said: "this connect link has expired or been used!+"\. Nothing was changed\.$/);
  expect(refused.told[0]![0].length).toBeLessThan(320);

  const broken = setup();
  broken.writeConfig("{ not json");
  expect(await broken.run()).toBe(false);
  expect(broken.calls).toEqual([]);
  expect(fs.readFileSync(broken.config(), "utf8")).toBe("{ not json");
});

test("config.json is read again after the dialog, so a change made meanwhile is kept; an office already there still restarts the data layers", async () => {
  const s = setup({
    yes: async () => {
      s.writeConfig({ servers: [{ label: "made-meanwhile", server: "wss://other.example/data-layer" }] });
      return true;
    },
  });
  expect(await s.run()).toBe(true);
  expect(JSON.parse(fs.readFileSync(s.config(), "utf8")).servers).toEqual([
    { label: "made-meanwhile", server: "wss://other.example/data-layer" },
    { label: "team", server: SERVER },
  ]);
  expect(fs.existsSync(path.join(s.claudeDir, "isoplan", "config.write.lock"))).toBe(false);
  // Connecting again to an office already in config.json changes the credential alone, and still restarts.
  const again = setup();
  again.writeConfig({ servers: [{ label: "team", server: SERVER }] });
  const before = fs.readFileSync(again.config(), "utf8");
  expect(await again.run()).toBe(true);
  expect(fs.readFileSync(again.config(), "utf8")).toBe(before);
  expect(again.restarts).toHaveLength(1);
});

test("after the swap, a config.json that can't be written says the machine is paired and gives the line to add, never that nothing changed", async () => {
  const s = setup({
    yes: async () => {
      s.writeConfig("{ broken meanwhile");
      return true;
    },
  });
  expect(await s.run()).toBe(false);
  const [text, problem] = s.told[0]!;
  expect(problem).toBe(true);
  expect(text).toContain("This computer is paired with office.team.com, but the office couldn't be added to");
  expect(text).toContain(JSON.stringify({ label: "team", server: SERVER }));
  expect(text).not.toContain("Nothing was changed");
  expect((await readPairing(path.join(s.claudeDir, "isoplan", "pairing.json"))).offices?.[SERVER]?.[ADA.id]?.credential).toBe(CREDENTIAL);
});

test("one link at a time: a link that comes while another is being handled is refused, with no dialog", async () => {
  const s = setup();
  fs.mkdirSync(path.dirname(connectLockPath(s.claudeDir)), { recursive: true });
  // A live process holds it: the test runner's parent.
  fs.writeFileSync(connectLockPath(s.claudeDir), JSON.stringify({ pid: process.ppid }));
  expect(await s.run()).toBe(false);
  expect(s.asked).toEqual([]);
  expect(s.calls).toEqual([]);
  expect(s.logged).toEqual(["refused a connect link: another is being handled on this machine"]);
});

test("a redirect from the office is refused, so a code or a credential never follows one", async () => {
  const server = http.createServer((_req, res) => res.writeHead(307, { location: "https://evil.example/steal" }).end());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  try {
    const { port } = server.address() as AddressInfo;
    await expect(postJson(`http://127.0.0.1:${port}/data-layer/connect`, { code: CODE })).rejects.toThrow();
  } finally {
    server.close();
  }
});

test("the running data layers are stopped only while their pid still runs a data layer, and the runner with them", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const live = path.join(claudeDir, "isoplan", "live");
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, "s1.json"), JSON.stringify({ pid: 101, dataLayer: "/p/dist/data-layer.js" }));
  fs.writeFileSync(path.join(live, "s2.json"), JSON.stringify({ pid: 102, dataLayer: "/p/dist/data-layer.js" }));
  fs.writeFileSync(path.join(live, "s3.json"), JSON.stringify({ pid: 0, until: Date.now() + 60000 }));
  fs.mkdirSync(path.dirname(runnerLockPath(claudeDir)), { recursive: true });
  fs.writeFileSync(runnerLockPath(claudeDir), JSON.stringify({ pid: 200 }));
  const killed: number[] = [];
  const commands: Record<number, string> = { 101: "node /p/dist/data-layer.js --session s1", 102: "notepad.exe" };
  const stopped = await stopReporting(claudeDir, { isAlive: () => true, commandOf: async (pid) => commands[pid] ?? null, kill: (pid) => void killed.push(pid) });
  expect(killed).toEqual([101, 200]);
  expect(stopped).toHaveLength(2);
});
