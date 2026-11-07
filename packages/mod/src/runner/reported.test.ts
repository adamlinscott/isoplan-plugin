// keepReported (#92): a driven session gets the detached data layer the wake hook would start, at
// once and again whenever none is running, until its process ends.

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { lockPath } from "../wake/lock.js";
import { keepReported } from "./reported.js";

const SESSION = "11111111-1111-4111-8111-111111111111";

function setUp() {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const dataLayer = path.join(root, "mod", "dist", "data-layer.js");
  fs.mkdirSync(path.dirname(dataLayer), { recursive: true });
  fs.writeFileSync(dataLayer, "");
  fs.mkdirSync(path.join(claudeDir, "isoplan"), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "isoplan", "wake.json"), JSON.stringify({ dataLayer }));
  const folder = path.join(root, "app");
  const started: { args: string[]; cwd: string }[] = [];
  const live = new Set<number>();
  const logs: string[] = [];
  const report = keepReported({
    paths: { claudeDir, settings: path.join(claudeDir, "settings.json"), plugins: path.join(claudeDir, "plugins"), managed: path.join(root, "managed"), pluginDirs: [] },
    everySeconds: async () => 0.05,
    log: (t) => void logs.push(t),
    spawn: (args, cwd) => void started.push({ args, cwd }),
    isAlive: (pid) => live.has(pid),
  });
  // The session lock, as a data layer leaves it.
  const holds = (body: Record<string, unknown>) => {
    fs.mkdirSync(path.dirname(lockPath(claudeDir, SESSION)), { recursive: true });
    fs.writeFileSync(lockPath(claudeDir, SESSION), JSON.stringify(body));
  };
  return { dataLayer, folder, started, live, logs, report, holds };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a driven session gets the wake hook's data layer as its process opens, another whenever the one reporting it has gone, and none once it ends", async () => {
  const t = setUp();
  const stop = t.report(SESSION, t.folder);
  await wait(30);
  expect(t.started).toEqual([{ args: [t.dataLayer, "--session", SESSION, "--cwd", t.folder, "--project", t.folder, "--detached"], cwd: t.folder }]);
  expect(t.logs).toEqual([`started a data layer to report driven session ${SESSION}`]);

  // While a live data layer holds the session's lock, nothing more is started.
  t.holds({ pid: 4242, detached: true });
  t.live.add(4242);
  await wait(300);
  expect(t.started).toHaveLength(1);

  // It has gone, without letting the lock go: the next look starts another.
  t.live.delete(4242);
  await wait(200);
  expect(t.started.length).toBeGreaterThanOrEqual(2);

  stop();
  const after = t.started.length;
  await wait(300);
  expect(t.started).toHaveLength(after);
});

test("a driven session held off, as a data layer leaves it when no office takes its repo, gets none", async () => {
  const t = setUp();
  t.holds({ pid: 0, until: Date.now() + 3600000, reason: "not-approved", projects: ["github.com/team/app"] });
  const stop = t.report(SESSION, t.folder);
  await wait(300);
  stop();
  expect(t.started).toEqual([]);
});
