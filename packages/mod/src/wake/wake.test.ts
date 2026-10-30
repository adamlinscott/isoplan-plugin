import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { HOLD_OFF_MS, holdOff, lockPath, takeLock } from "./lock.js";
import { wake, wakeRecordPath } from "./wake.js";

const OTHER = 4242; // a pid that isn't this process

function setup() {
  const claudeDir = path.join(tempRoot(), ".claude");
  const dataLayer = path.join(claudeDir, "..", "dist", "data-layer.js");
  fs.mkdirSync(path.dirname(dataLayer), { recursive: true });
  fs.writeFileSync(dataLayer, "");
  fs.mkdirSync(path.join(claudeDir, "isoplan"), { recursive: true });
  fs.writeFileSync(wakeRecordPath(claudeDir), JSON.stringify({ dataLayer }));
  const spawned: { args: string[]; cwd: string }[] = [];
  const input = JSON.stringify({ session_id: "s-1", cwd: "/repo", transcript_path: "/t.jsonl", hook_event_name: "Stop" });
  const run = (isAlive: (pid: number) => boolean = () => true) => wake(input, { claudeDir, spawn: (args, cwd) => spawned.push({ args, cwd }), isAlive });
  return { claudeDir, dataLayer, spawned, run, lock: lockPath(claudeDir, "s-1") };
}

test("wake: starts a detached data layer for a session no one reports", async () => {
  const s = setup();
  expect(await s.run()).toBe(true);
  expect(s.spawned).toEqual([{ args: [s.dataLayer, "--session", "s-1", "--cwd", "/repo", "--detached"], cwd: "/repo" }]);
});

test("wake: does nothing when a live data layer holds the session's lock", async () => {
  const s = setup();
  await takeLock(s.lock, OTHER);
  expect(await s.run(() => true)).toBe(false);
  expect(await s.run(() => false)).toBe(true); // its pid has gone
  expect(s.spawned).toHaveLength(1);
});

test("wake: does nothing when the recorded data layer is gone", async () => {
  const s = setup();
  fs.rmSync(s.dataLayer);
  expect(await s.run()).toBe(false);
  expect(s.spawned).toEqual([]);
});

test("lock: a hold-off counts as held until it ends, for the wake hook and a detached data layer, not the plugin's", async () => {
  const s = setup();
  await takeLock(s.lock, OTHER);
  await holdOff(s.lock, OTHER, Date.now() + HOLD_OFF_MS);
  expect(await s.run(() => false)).toBe(false);
  expect(await takeLock(s.lock, OTHER + 1, () => false)).toBe(false);
  expect(await takeLock(s.lock, OTHER + 1, () => false, false, Date.now() + HOLD_OFF_MS + 1)).toBe(true);
  await holdOff(s.lock, OTHER + 1, Date.now() + HOLD_OFF_MS);
  expect(await takeLock(s.lock, OTHER + 2, () => false, true)).toBe(true);
  expect(JSON.parse(fs.readFileSync(s.lock, "utf8"))).toEqual({ pid: OTHER + 2 });
});

test("lock: a second data layer is refused while the first lives; a stale lock is taken over", async () => {
  const s = setup();
  expect(await takeLock(s.lock, OTHER)).toBe(true);
  expect(await takeLock(s.lock, OTHER + 1, () => true)).toBe(false);
  // The plugin's data layer takes it from a detached one regardless.
  expect(await takeLock(s.lock, OTHER + 2, () => true, true)).toBe(true);
  expect(await takeLock(s.lock, OTHER + 1, () => false)).toBe(true);
  expect(JSON.parse(fs.readFileSync(s.lock, "utf8"))).toEqual({ pid: OTHER + 1 });
});

test("wake: a data layer held off because the office took none of its repos starts again once the list takes one (#91)", async () => {
  const s = setup();
  await takeLock(s.lock, OTHER);
  await holdOff(s.lock, OTHER, Date.now() + HOLD_OFF_MS, { reason: "not-approved", projects: ["github.com/team/app"] });
  const list = (repos: string[], checked = Date.now()) =>
    fs.writeFileSync(path.join(s.claudeDir, "isoplan", "approved.json"), JSON.stringify({ server: "ws://127.0.0.1:4747/data-layer", version: "v2", repos, fetched: checked, checked }));
  expect(await s.run(() => false)).toBe(false);
  list(["github.com/team/other"]);
  expect(await s.run(() => false)).toBe(false);
  // A copy past its maximum age doesn't count.
  list(["github.com/team/app"], Date.now() - 60 * 60 * 1000);
  expect(await s.run(() => false)).toBe(false);
  list(["github.com/team/app"]);
  expect(await s.run(() => false)).toBe(true);
  expect(s.spawned).toHaveLength(1);
});

test("wake: starts the newest data layer Claude Code has installed, not an older one wake.json still records", async () => {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const plugins = path.join(claudeDir, "plugins");
  const folder = (sha: string) => path.join(plugins, "cache", "isoplan", "isoplan", sha);
  const write = (file: string, text: string) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, text));
  const old = path.join(folder("6658f568c1e1"), "dist", "data-layer.js");
  const now = path.join(folder("a1b2c3d4e5f6"), "dist", "data-layer.js");
  write(old, "");
  write(now, "");
  write(wakeRecordPath(claudeDir), JSON.stringify({ dataLayer: old }));
  write(path.join(plugins, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "isoplan@isoplan": [{ scope: "user", installPath: folder("a1b2c3d4e5f6") }] } }));
  const spawned: string[][] = [];
  const input = JSON.stringify({ session_id: "s-1", cwd: "/repo" });
  expect(await wake(input, { claudeDir, plugins, spawn: (args) => spawned.push(args), isAlive: () => false })).toBe(true);
  expect(spawned[0]![0]).toBe(now);
  // With the newer folder gone (say, cleaned up), the recorded one still runs.
  fs.rmSync(now);
  await wake(input, { claudeDir, plugins, spawn: (args) => spawned.push(args), isAlive: () => false });
  expect(spawned[1]![0]).toBe(old);
});
