import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { NOW, line, session, tempRoot, touch } from "../data-layer/fixture.js";
import { nodeIo } from "../data-layer/io.js";
import { lockHolder, takeLock } from "../wake/lock.js";
import { wakeRecordPath } from "../wake/wake.js";
import { anyRoomSince, askableMs, supervise } from "./lifecycle.js";
import { runnerLockPath, startRunner, stopRunner } from "./start.js";

const OTHER = 4242; // a pid that isn't this process

function machine({ runner = true } = {}) {
  const claudeDir = path.join(tempRoot(), ".claude");
  const runnerJs = path.join(claudeDir, "..", "dist", "runner.js");
  fs.mkdirSync(path.dirname(runnerJs), { recursive: true });
  fs.writeFileSync(runnerJs, "");
  fs.mkdirSync(path.join(claudeDir, "isoplan"), { recursive: true });
  fs.writeFileSync(wakeRecordPath(claudeDir), JSON.stringify(runner ? { dataLayer: "x", runner: runnerJs } : { dataLayer: "x" }));
  const spawned: { args: string[]; cwd: string }[] = [];
  const start = (isAlive: (pid: number) => boolean = () => true) => startRunner({ claudeDir, spawn: (args, cwd) => spawned.push({ args, cwd }), isAlive });
  return { claudeDir, runnerJs, spawned, start, lock: runnerLockPath(claudeDir) };
}

test("one runner: started when none holds the lock, not while one lives; a dead one's lock is taken over", async () => {
  const m = machine();
  expect(await m.start()).toBe(true);
  expect(m.spawned).toEqual([{ args: [m.runnerJs], cwd: m.claudeDir }]);
  // The supervisor takes the lock as it starts; a second one is refused while it lives.
  expect(await takeLock(m.lock, OTHER)).toBe(true);
  expect(await takeLock(m.lock, OTHER + 1, () => true)).toBe(false);
  expect(await m.start(() => true)).toBe(false);
  // It crashed hard and left its lock: the next start takes over.
  expect(await m.start(() => false)).toBe(true);
  expect(await takeLock(m.lock, OTHER + 1, () => false)).toBe(true);
  expect(await lockHolder(m.lock)).toBe(OTHER + 1);
  expect(m.spawned).toHaveLength(2);
});

test("one runner: nothing starts when install recorded no runner, or it is gone", async () => {
  const none = machine({ runner: false });
  expect(await none.start()).toBe(false);
  const gone = machine();
  fs.rmSync(gone.runnerJs);
  expect(await gone.start()).toBe(false);
  expect([...none.spawned, ...gone.spawned]).toEqual([]);
});

test("one runner: uninstall stops the one running and clears its lock", async () => {
  const m = machine();
  await takeLock(m.lock, process.pid);
  const killed: number[] = [];
  expect(await stopRunner(m.claudeDir, (pid) => killed.push(pid))).toBe(true);
  expect(killed).toEqual([process.pid]);
  expect(fs.existsSync(m.lock)).toBe(false);
  expect(await stopRunner(m.claudeDir, (pid) => killed.push(pid))).toBe(false);
});

test("lifecycle: the supervisor starts a crashed worker again with a backoff, and ends when it exits cleanly", async () => {
  let clock = 0;
  const codes = [1, null, 1, 0];
  const slept: number[] = [];
  const logs: string[] = [];
  let runs = 0;
  await supervise({
    run: async () => {
      runs++;
      // The third run stays up past a minute, so the crash after it starts the backoff over.
      clock += runs === 3 ? 61000 : 10;
      return codes.shift()!;
    },
    sleep: async (ms) => void slept.push(ms),
    now: () => clock,
    log: (t) => logs.push(t),
  });
  expect(runs).toBe(4);
  expect(slept).toEqual([1000, 2000, 1000]);
  expect(logs[1]).toBe("the runner's worker was killed; starting it again in 2 s");
});

test("lifecycle: the worker stays while any room is inside its lights-off window", async () => {
  const home = path.join(tempRoot(), "home");
  const projects = path.join(home, ".claude", "projects");
  const p = session(home, "s", [line.user("/repo", "hi")], { age: 3600 });
  const window = askableMs({ lightsOffHours: 24, idleMinutes: 30 });
  expect(window).toBe(24 * 3600000);
  expect(await anyRoomSince(nodeIo(), projects, NOW - window)).toBe(true);
  touch(p, 24 * 3600 + 1);
  expect(await anyRoomSince(nodeIo(), projects, NOW - window)).toBe(false);
  // With lights-off at 0, a room stays askable through its idle window.
  expect(askableMs({ lightsOffHours: 0, idleMinutes: 30 })).toBe(30 * 60000);
  expect(await anyRoomSince(nodeIo(), path.join(home, "missing"), 0)).toBe(false);
});
