import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { runnerAppDir, wakeScriptPath } from "../install/install.js";
import { launchAgentPath } from "../install/login-item.js";
import { runnerCode, runnerLockPath } from "../runner/start.js";
import { takeLock } from "./lock.js";
import { startFromOutside } from "./outside.js";
import { wakeRecordPath } from "./wake.js";

const ID = "isoplan@isoplan";

// A machine install set up: the runner's copy and its defaults, wake.json naming a data layer in the
// plugin cache and the runner, and Claude Code's record listing the plugin.
function machine() {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const paths = { claudeDir, settings: path.join(claudeDir, "settings.json"), plugins: path.join(claudeDir, "plugins"), managed: path.join(root, "managed") };
  const runner = path.join(runnerAppDir(claudeDir), "dist", "runner.mjs");
  fs.mkdirSync(path.dirname(runner), { recursive: true });
  fs.writeFileSync(runner, "// v1");
  fs.copyFileSync(path.join(import.meta.dirname, "..", "..", "runner.json"), path.join(runnerAppDir(claudeDir), "runner.json"));
  const dataLayer = path.join(paths.plugins, "cache", "isoplan", "isoplan", "0.1.0", "dist", "data-layer.js");
  fs.writeFileSync(wakeRecordPath(claudeDir), JSON.stringify({ dataLayer, runner }));
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  const installed = (ids: string[]) => write(path.join(paths.plugins, "installed_plugins.json"), { version: 2, plugins: Object.fromEntries(ids.map((id) => [id, [{ scope: "user" }]])) });
  installed([ID]);
  const spawned: { args: string[]; cwd: string }[] = [];
  const spawn = (args: string[], cwd: string) => void spawned.push({ args, cwd });
  return { root, claudeDir, paths, runner, write, installed, spawned, spawn };
}

test("from outside a session: starts a stopped runner, and leaves one that runs alone", async () => {
  const m = machine();
  expect(await startFromOutside({ paths: m.paths, spawn: m.spawn })).toBe("started");
  expect(m.spawned).toEqual([{ args: [m.runner, "--claude-dir", m.claudeDir, "--inherited-env"], cwd: m.claudeDir }]);
  // A supervisor took the lock: starting again does nothing.
  await takeLock(runnerLockPath(m.claudeDir), 4242, () => true, false, Date.now(), { extra: { code: await runnerCode(m.runner) } });
  expect(await startFromOutside({ paths: m.paths, spawn: m.spawn, isAlive: () => true })).toBe("running");
  expect(m.spawned).toHaveLength(1);
});

test("from outside a session: nothing while the plugin is disabled; once it is uninstalled, the uninstall in the background", async () => {
  const m = machine();
  m.write(m.paths.settings, { enabledPlugins: { [ID]: false } });
  expect(await startFromOutside({ paths: m.paths, spawn: m.spawn })).toBe("disabled");
  expect(m.spawned).toEqual([]);
  m.installed(["other@market"]);
  expect(await startFromOutside({ paths: m.paths, spawn: m.spawn })).toBe("uninstalling");
  expect(m.spawned).toEqual([{ args: [wakeScriptPath(m.claudeDir), "--uninstall"], cwd: m.claudeDir }]);
});

test("at login: startAtLogin off in the person's runner.json takes the login item out and starts nothing", async () => {
  const m = machine();
  const login = { platform: "darwin" as const, home: m.root, uid: 501, run: async () => ({ code: 0, stdout: "" }) };
  expect(await startFromOutside({ paths: m.paths, spawn: m.spawn, login })).toBe("started");
  const plist = launchAgentPath(m.root, m.claudeDir);
  m.write(plist, "<plist/>");
  m.write(path.join(m.claudeDir, "isoplan", "runner.json"), { startAtLogin: false });
  expect(await startFromOutside({ paths: m.paths, spawn: m.spawn, login })).toBe("off");
  expect(fs.existsSync(plist)).toBe(false);
  expect(m.spawned).toHaveLength(1);
  // The restart link starts it whatever the setting says.
  expect(await startFromOutside({ paths: m.paths, spawn: m.spawn })).toBe("started");
});
