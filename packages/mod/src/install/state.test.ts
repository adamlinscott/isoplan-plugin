import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { installedPlugins, newestDataLayer, pluginIdOf, pluginState } from "./state.js";

const ID = "isoplan@isoplan";

function setup() {
  const root = tempRoot();
  const place = { claudeDir: path.join(root, ".claude"), plugins: path.join(root, ".claude", "plugins"), managed: path.join(root, "managed") };
  const dataLayer = path.join(place.plugins, "cache", "isoplan", "isoplan", "0.1.0", "dist", "data-layer.js");
  const project = path.join(root, "work");
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  const installed = (plugins: Record<string, unknown>) => write(path.join(place.plugins, "installed_plugins.json"), { version: 2, plugins });
  const enabled = (file: string, value: boolean) => write(file, { enabledPlugins: { [ID]: value } });
  return { root, place, dataLayer, project, write, installed, enabled };
}

test("plugin id: from a data layer's place in the plugin cache; none for one elsewhere", () => {
  const s = setup();
  expect(pluginIdOf(s.place.plugins, s.dataLayer)).toBe(ID);
  expect(pluginIdOf(s.place.plugins, path.join(s.root, "checkout", "dist", "data-layer.js"))).toBeNull();
  expect(pluginIdOf(s.place.plugins, path.join(s.place.plugins, "cache", "isoplan", "data-layer.js"))).toBeNull();
});

test("installed plugins: only a readable record of the shape known counts; anything else is unknown", async () => {
  const s = setup();
  const file = path.join(s.place.plugins, "installed_plugins.json");
  expect(await installedPlugins(s.place.plugins)).toBeNull(); // missing
  s.write(file, "{ broken");
  expect(await installedPlugins(s.place.plugins)).toBeNull();
  s.write(file, { version: 3, plugins: { [ID]: [] } });
  expect(await installedPlugins(s.place.plugins)).toBeNull();
  s.write(file, { version: 2, plugins: { [ID]: { scope: "user" } } });
  expect(await installedPlugins(s.place.plugins)).toBeNull();
  s.installed({ [ID]: [{ scope: "user" }], "other@market": [] });
  // An empty list of installs is no install.
  expect(await installedPlugins(s.place.plugins)).toEqual([ID]);
});

test("uninstalled: only when the record reads and doesn't list the plugin; unknown never is", async () => {
  const s = setup();
  expect(await pluginState(s.place, s.dataLayer)).toBe("enabled"); // no record at all
  s.write(path.join(s.place.plugins, "installed_plugins.json"), { version: 2, plugins: { [ID]: "not a list" } });
  expect(await pluginState(s.place, s.dataLayer)).toBe("enabled");
  s.installed({ [ID]: [{ scope: "user" }] });
  expect(await pluginState(s.place, s.dataLayer)).toBe("enabled");
  s.installed({ "other@market": [{ scope: "user" }] });
  expect(await pluginState(s.place, s.dataLayer)).toBe("uninstalled");
  // A data layer outside the cache has no id to look for.
  expect(await pluginState(s.place, path.join(s.root, "checkout", "dist", "data-layer.js"))).toBe("enabled");
});

test("disabled: enabledPlugins as Claude Code merges it, managed first, then local, project and user", async () => {
  const s = setup();
  s.installed({ [ID]: [{ scope: "user" }] });
  const user = path.join(s.place.claudeDir, "settings.json");
  const projectFile = path.join(s.project, ".claude", "settings.json");
  const local = path.join(s.project, ".claude", "settings.local.json");
  s.enabled(user, false);
  expect(await pluginState(s.place, s.dataLayer)).toBe("disabled");
  expect(await pluginState(s.place, s.dataLayer, s.project)).toBe("disabled");
  // The project's settings count for its sessions, not for the machine.
  s.enabled(projectFile, true);
  expect(await pluginState(s.place, s.dataLayer, s.project)).toBe("enabled");
  expect(await pluginState(s.place, s.dataLayer)).toBe("disabled");
  s.enabled(local, false);
  expect(await pluginState(s.place, s.dataLayer, s.project)).toBe("disabled");
  // A managed false, from the file or any drop-in, wins over everything; a managed true over the person's own.
  s.enabled(user, true);
  s.enabled(local, true);
  s.enabled(path.join(s.place.managed, "managed-settings.json"), true);
  s.enabled(path.join(s.place.managed, "managed-settings.d", "50-team.json"), false);
  expect(await pluginState(s.place, s.dataLayer, s.project)).toBe("disabled");
  fs.rmSync(path.join(s.place.managed, "managed-settings.d"), { recursive: true });
  s.enabled(user, false);
  expect(await pluginState(s.place, s.dataLayer)).toBe("enabled");
  // A settings file that doesn't parse is passed over.
  fs.rmSync(s.place.managed, { recursive: true });
  s.write(user, "{ broken");
  expect(await pluginState(s.place, s.dataLayer)).toBe("enabled");
});

test("uninstalled: moving to another marketplace isn't, and its settings decide whether it is enabled", async () => {
  const s = setup();
  // wake.json still records marketplace A's copy; Claude Code now lists only B's.
  s.installed({ "isoplan@other-market": [{ scope: "user" }] });
  expect(await pluginState(s.place, s.dataLayer)).toBe("enabled");
  s.write(path.join(s.place.claudeDir, "settings.json"), { enabledPlugins: { "isoplan@other-market": false, [ID]: true } });
  expect(await pluginState(s.place, s.dataLayer)).toBe("disabled");
});

test("uninstalled: not while a folder in CLAUDE_CODE_PLUGIN_DIRS holds the plugin", async () => {
  const s = setup();
  s.installed({});
  expect(await pluginState(s.place, s.dataLayer)).toBe("uninstalled");
  const dir = path.join(s.root, "dev-copy");
  s.write(path.join(dir, ".claude-plugin", "plugin.json"), { name: "isoplan" });
  expect(await pluginState({ ...s.place, pluginDirs: [path.join(s.root, "nothing"), dir] }, s.dataLayer)).toBe("enabled");
});

test("project scope: an install counts only for its project's sessions, or everywhere when its record names none", async () => {
  const s = setup();
  const other = path.join(s.root, "elsewhere");
  s.installed({ [ID]: [{ scope: "project", projectPath: s.project }] });
  expect(await pluginState(s.place, s.dataLayer, s.project)).toBe("enabled");
  expect(await pluginState(s.place, s.dataLayer, other)).toBe("disabled");
  expect(await pluginState(s.place, s.dataLayer)).toBe("enabled"); // the machine still has it: nothing is uninstalled
  s.installed({ [ID]: [{ scope: "local" }] });
  expect(await pluginState(s.place, s.dataLayer, other)).toBe("enabled");
});

test("versions by commit SHA: an update to a new folder is still the same install, and leaves the old data layer outdated", async () => {
  const s = setup();
  const folder = (sha: string) => path.join(s.place.plugins, "cache", "isoplan", "isoplan", sha);
  const old = path.join(folder("6658f568c1e1"), "dist", "data-layer.js");
  const now = path.join(folder("a1b2c3d4e5f6"), "dist", "data-layer.js");
  s.write(old, "");
  s.installed({ [ID]: [{ scope: "user", installPath: folder("6658f568c1e1"), version: "6658f568c1e1" }] });
  expect(pluginIdOf(s.place.plugins, old)).toBe(ID);
  expect(await newestDataLayer(s.place.plugins, old)).toBe(old);
  // Claude Code updated it: the record names the new folder, the old one stays until it is cleaned up.
  s.installed({ [ID]: [{ scope: "user", installPath: folder("a1b2c3d4e5f6"), version: "a1b2c3d4e5f6" }] });
  expect(await newestDataLayer(s.place.plugins, old)).toBe(old); // the new folder isn't there yet
  s.write(now, "");
  expect(await newestDataLayer(s.place.plugins, old)).toBe(now);
  expect(await newestDataLayer(s.place.plugins, now)).toBe(now);
  // Uninstall and disable detection go by the id, whichever folder wake.json still records.
  expect(await pluginState(s.place, old)).toBe("enabled");
  s.enabled(path.join(s.place.claudeDir, "settings.json"), false);
  expect(await pluginState(s.place, old)).toBe("disabled");
  s.installed({});
  expect(await pluginState(s.place, old)).toBe("uninstalled");
});

test("newest data layer: itself while any install still loads its folder, outside the cache, or with no record to read", async () => {
  const s = setup();
  const other = path.join(s.place.plugins, "cache", "isoplan", "isoplan", "b".repeat(12));
  s.write(path.join(other, "dist", "data-layer.js"), "");
  expect(await newestDataLayer(s.place.plugins, s.dataLayer)).toBe(s.dataLayer); // no record
  s.installed({ [ID]: [{ scope: "user", installPath: path.dirname(path.dirname(s.dataLayer)) }, { scope: "project", installPath: other }] });
  // A project still on this version keeps it current.
  expect(await newestDataLayer(s.place.plugins, s.dataLayer)).toBe(s.dataLayer);
  s.installed({ "isoplan@other-market": [{ scope: "user", installPath: other }] });
  expect(await newestDataLayer(s.place.plugins, s.dataLayer)).toBe(s.dataLayer); // another id isn't an update of this one
  const checkout = path.join(s.root, "checkout", "dist", "data-layer.js");
  expect(await newestDataLayer(s.place.plugins, checkout)).toBe(checkout);
});
