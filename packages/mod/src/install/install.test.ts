import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { installWake, uninstallWake, wakeCommand, wakeScriptPath } from "./install.js";

const other = { matcher: "Bash", hooks: [{ type: "command", command: "echo other" }] };

// A config folder with a dist/ beside it holding a stand-in data layer and wake script.
function setup(settings?: unknown) {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "data-layer.js"), "");
  fs.writeFileSync(path.join(dist, "wake.js"), "// wake");
  const paths = { claudeDir, settings: path.join(claudeDir, "settings.json") };
  if (settings !== undefined) {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(paths.settings, typeof settings === "string" ? settings : JSON.stringify(settings));
  }
  const install = () => installWake(paths, path.join(dist, "data-layer.js"), path.join(dist, "wake.js"));
  const read = () => JSON.parse(fs.readFileSync(paths.settings, "utf8"));
  const wake = { type: "command", command: wakeCommand(wakeScriptPath(claudeDir)), timeout: 10 };
  return { root, claudeDir, dist, paths, install, read, wake };
}

test("install: adds one hook on UserPromptSubmit and Stop, copies wake.mjs and records the data layer", async () => {
  const s = setup();
  const changes = await s.install();
  expect(changes).toHaveLength(4);
  expect(s.read()).toEqual({ hooks: { UserPromptSubmit: [{ hooks: [s.wake] }], Stop: [{ hooks: [s.wake] }] } });
  expect(s.wake.command).toMatch(/^node ".*\/\.claude\/isoplan\/wake\.mjs"$/);
  expect(fs.readFileSync(path.join(s.claudeDir, "isoplan", "wake.mjs"), "utf8")).toBe("// wake");
  expect(JSON.parse(fs.readFileSync(path.join(s.claudeDir, "isoplan", "wake.json"), "utf8"))).toEqual({ dataLayer: path.join(s.dist, "data-layer.js") });
});

test("install: a second run changes nothing and adds no second hook", async () => {
  const s = setup();
  await s.install();
  const before = fs.readFileSync(s.paths.settings, "utf8");
  expect(await s.install()).toEqual([]);
  expect(fs.readFileSync(s.paths.settings, "utf8")).toBe(before);
});

test("install: other hooks and settings are kept as they were", async () => {
  const s = setup({ model: "opus", hooks: { PreToolUse: [other], Stop: [other] } });
  await s.install();
  expect(s.read()).toEqual({ model: "opus", hooks: { PreToolUse: [other], Stop: [other, { hooks: [s.wake] }], UserPromptSubmit: [{ hooks: [s.wake] }] } });
});

test("install: a hook naming an old wake.mjs path is updated in place, and a duplicate goes", async () => {
  const old = { type: "command", command: 'node "C:/Old/.claude/isoplan/wake.mjs"' };
  const s = setup({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }, old] }, { hooks: [old] }] } });
  expect(await s.install()).toContain(`updated the wake hook in ${s.paths.settings} on Stop`);
  expect(s.read().hooks.Stop).toEqual([{ hooks: [{ type: "command", command: "echo mine" }, s.wake] }]);
});

test("install: a moved data layer is recorded again", async () => {
  const s = setup();
  await s.install();
  const moved = path.join(s.root, "v2", "data-layer.js");
  expect(await installWake(s.paths, moved, path.join(s.dist, "wake.js"))).toEqual([`recorded the data layer at ${moved}`]);
});

test("install: a settings.json that doesn't parse is left alone, and nothing is written", async () => {
  const s = setup("{ broken");
  await expect(s.install()).rejects.toThrow("isn't valid JSON; left it alone");
  expect(fs.readFileSync(s.paths.settings, "utf8")).toBe("{ broken");
  expect(fs.existsSync(path.join(s.claudeDir, "isoplan"))).toBe(false);
});

test("install: a symlinked settings.json stays a link, and a leading byte order mark is read past", async () => {
  const s = setup();
  const real = path.join(s.root, "dotfiles", "settings.json");
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, '﻿{"model":"opus"}');
  fs.mkdirSync(s.claudeDir, { recursive: true });
  fs.symlinkSync(real, s.paths.settings, "file");
  await s.install();
  expect(fs.lstatSync(s.paths.settings).isSymbolicLink()).toBe(true);
  expect(fs.readFileSync(real, "utf8")).toMatch(/^\{\n {2}"model": "opus",/);
  expect(fs.readdirSync(path.dirname(real))).toEqual(["settings.json"]);
});

test("uninstall: removes only the wake hooks and wake.mjs, and marks wake.json so the plugin stays out", async () => {
  const s = setup({ model: "opus", hooks: { Stop: [other] } });
  await s.install();
  fs.writeFileSync(path.join(s.claudeDir, "isoplan", "config.json"), "{}");
  const changes = await uninstallWake(s.paths);
  expect(changes).toHaveLength(4);
  expect(s.read()).toEqual({ model: "opus", hooks: { Stop: [other] } });
  expect(fs.readdirSync(path.join(s.claudeDir, "isoplan")).sort()).toEqual(["config.json", "wake.json"]);
  expect(JSON.parse(fs.readFileSync(path.join(s.claudeDir, "isoplan", "wake.json"), "utf8"))).toEqual({ disabled: true });
  expect(await uninstallWake(s.paths)).toEqual([]);

  // The plugin's own install at start leaves it out; the install script puts it back.
  expect(await installWake(s.paths, path.join(s.dist, "data-layer.js"), path.join(s.dist, "wake.js"), { auto: true })).toEqual([]);
  expect(s.read().hooks.UserPromptSubmit).toBeUndefined();
  await s.install();
  expect(s.read().hooks.UserPromptSubmit).toEqual([{ hooks: [s.wake] }]);
});
