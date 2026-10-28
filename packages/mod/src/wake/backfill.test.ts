import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { nodeIo } from "../data-layer/io.js";
import { line, NOW, session, tempRoot } from "../data-layer/fixture.js";
import { recentSessions } from "../sweep/find.js";
import { backfill } from "./backfill.js";
import { lockPath, takeLock } from "./lock.js";

test("backfill: starts a detached data layer for each recent session in any repo, unless it is reported or its folder is gone", async () => {
  const home = tempRoot();
  const claudeDir = path.join(home, ".claude");
  const app = path.join(home, "app");
  const api = path.join(home, "api");
  fs.mkdirSync(app);
  fs.mkdirSync(api);
  session(home, "quiet", [line.user(app, "hi", 5 * 3600)], { slug: "a", age: 5 * 3600 });
  session(home, "other-repo", [line.user(api, "hi")], { slug: "b" });
  session(home, "reported", [line.user(app, "hi")], { slug: "a" });
  session(home, "gone", [line.user(path.join(home, "deleted-worktree"), "hi")], { slug: "c" });
  session(home, "too-old", [line.user(app, "hi")], { slug: "a", age: 30 * 3600 });
  await takeLock(lockPath(claudeDir, "reported"), 4242);

  const found = await recentSessions(nodeIo({ run: null }), path.join(claudeDir, "projects"), NOW - 24 * 3600000);
  const spawned: { args: string[]; cwd: string }[] = [];
  const started = await backfill(found, { claudeDir, dataLayer: "dl.js", spawn: (args, cwd) => spawned.push({ args, cwd }), isAlive: () => true, pause: async () => {} });

  expect(started).toBe(2);
  expect(spawned.sort((x, y) => x.args[2]!.localeCompare(y.args[2]!))).toEqual([
    { args: ["dl.js", "--session", "other-repo", "--cwd", api, "--detached"], cwd: api },
    { args: ["dl.js", "--session", "quiet", "--cwd", app, "--detached"], cwd: app },
  ]);
});
