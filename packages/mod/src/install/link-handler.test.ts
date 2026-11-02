import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import type { Exec } from "../connect/dialog.js";
import { tempRoot } from "../data-layer/fixture.js";
import { connectScriptPath, installWake, uninstall } from "./install.js";
import { desktopEntry, macAppPath, macScript, registerLinkHandler, unregisterLinkHandler, windowsCommand } from "./link-handler.js";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const SCRIPT = "C:\\Users\\ada\\.claude\\isoplan\\runner\\app\\dist\\connect.mjs";

/** A stand-in for the operating system's commands: what was run, and what `answer` says to each. */
function fakeOs(answer: (file: string, args: string[]) => { code: number | null; stdout?: string } = () => ({ code: 0 })) {
  const calls: string[][] = [];
  const run: Exec = async (file, args) => {
    calls.push([path.basename(file), ...args]);
    const a = answer(file, args);
    return { code: a.code, stdout: a.stdout ?? "" };
  };
  return { calls, run };
}

const queried = (value: string) => ({ code: 0, stdout: `\r\nHKEY_CURRENT_USER\\Software\\Classes\\isoplan\\shell\\open\\command\r\n    (Default)    REG_SZ    ${value}\r\n\r\n` });

test("Windows: the isoplan URL protocol goes under HKCU, running node on the handler with the link, once", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const os = fakeOs((_, args) => (args[0] === "query" ? { code: 1 } : { code: 0 }));
  const h = { platform: "win32" as const, claudeDir, home: "C:\\Users\\ada", node: NODE, script: SCRIPT, run: os.run };
  expect(await registerLinkHandler(h)).toEqual([`registered isoplan:// links to open ${SCRIPT}`]);
  expect(os.calls).toEqual([
    ["reg", "query", "HKCU\\Software\\Classes\\isoplan\\shell\\open\\command", "/ve"],
    ["reg", "add", "HKCU\\Software\\Classes\\isoplan", "/ve", "/d", "URL:Isoplan", "/f"],
    ["reg", "add", "HKCU\\Software\\Classes\\isoplan", "/v", "URL Protocol", "/d", "", "/f"],
    ["reg", "add", "HKCU\\Software\\Classes\\isoplan\\shell\\open\\command", "/ve", "/d", `"${NODE}" "${SCRIPT}" "%1"`, "/f"],
  ]);
  // Already as wanted: only looked at.
  const again = fakeOs(() => queried(windowsCommand(NODE, SCRIPT)));
  expect(await registerLinkHandler({ ...h, run: again.run })).toEqual([]);
  expect(again.calls).toHaveLength(1);
});

test("Windows: uninstall takes the protocol out only when it runs this config folder's handler", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const h = { platform: "win32" as const, claudeDir, home: "C:\\Users\\ada", script: SCRIPT };
  const mine = fakeOs((_, args) => (args[0] === "query" ? queried(windowsCommand(NODE, SCRIPT.replace(/\\/g, "/"))) : { code: 0 }));
  expect(await unregisterLinkHandler({ ...h, run: mine.run })).toEqual(["removed the isoplan:// link handler"]);
  expect(mine.calls.at(-1)).toEqual(["reg", "delete", "HKCU\\Software\\Classes\\isoplan", "/f"]);
  const another = fakeOs(() => queried(windowsCommand(NODE, "D:\\other\\.claude\\isoplan\\runner\\app\\dist\\connect.mjs")));
  expect(await unregisterLinkHandler({ ...h, run: another.run })).toEqual([]);
  expect(another.calls).toHaveLength(1);
});

test("macOS: an AppleScript app claims the isoplan scheme, is signed again and registered with LaunchServices; uninstall unregisters and removes it", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const app = macAppPath(claudeDir);
  let source = "";
  // osacompile makes the app; nothing else here touches the disk.
  const os = fakeOs((file, args) => {
    if (file === "osacompile") {
      source = fs.readFileSync(args[2]!, "utf8");
      fs.mkdirSync(path.join(app, "Contents", "Resources"), { recursive: true });
    }
    return { code: 0 };
  });
  const h = { platform: "darwin" as const, claudeDir, home: "/Users/ada", node: "/opt/homebrew/bin/node", script: "/Users/ada/.claude/isoplan/runner/app/dist/connect.mjs", run: os.run };
  expect(await registerLinkHandler(h)).toHaveLength(1);
  expect(source).toBe(macScript(h.node, h.script));
  expect(source).toContain('do shell script "ISOPLAN_CONNECT_URL=" & quoted form of theURL & " " & quoted form of "/opt/homebrew/bin/node"');
  const plist = path.join(app, "Contents", "Info.plist");
  expect(os.calls.map((c) => c.slice(0, 2))).toEqual([
    ["osacompile", "-o"],
    ["plutil", "-replace"],
    ["plutil", "-replace"],
    ["plutil", "-replace"],
    ["codesign", "--force"],
    ["lsregister", "-f"],
  ]);
  expect(os.calls[2]).toEqual(["plutil", "-replace", "CFBundleURLTypes", "-json", '[{"CFBundleURLName":"Isoplan link","CFBundleURLSchemes":["isoplan"]}]', plist]);
  expect(os.calls).toHaveLength(6);
  // The source it compiled is gone, and a second install leaves the app alone.
  expect(fs.readdirSync(path.join(claudeDir, "isoplan"))).toEqual(["Isoplan Connect.app"]);
  expect(await registerLinkHandler(h)).toEqual([]);
  expect(os.calls).toHaveLength(6);

  expect(await unregisterLinkHandler(h)).toHaveLength(1);
  expect(os.calls.at(-1)).toEqual(["lsregister", "-u", app]);
  expect(fs.existsSync(app)).toBe(false);
});

test("Linux: a desktop entry for x-scheme-handler/isoplan, made the default with xdg-mime; uninstall removes it", async () => {
  const root = tempRoot();
  const os = fakeOs();
  const h = { platform: "linux" as const, claudeDir: path.join(root, ".claude"), home: root, node: "/usr/bin/node", script: "/home/ada/.claude/isoplan/runner/app/dist/connect.mjs", run: os.run };
  const file = path.join(root, ".local", "share", "applications", "isoplan-connect.desktop");
  expect(await registerLinkHandler(h)).toHaveLength(1);
  expect(fs.readFileSync(file, "utf8")).toBe(desktopEntry(h.node, h.script));
  expect(desktopEntry(h.node, h.script)).toContain(`Exec="/usr/bin/node" "${h.script}" %u\nNoDisplay=true\nTerminal=false\nMimeType=x-scheme-handler/isoplan;`);
  expect(os.calls).toContainEqual(["xdg-mime", "default", "isoplan-connect.desktop", "x-scheme-handler/isoplan"]);
  expect(await unregisterLinkHandler(h)).toHaveLength(1);
  expect(fs.existsSync(file)).toBe(false);
});

test("install registers the handler for the copy beside the runner, and uninstall takes it out; an install without a place for it registers nothing", async () => {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const plugin = path.join(root, "plugin");
  fs.mkdirSync(path.join(plugin, "dist"), { recursive: true });
  for (const file of ["config.json", "runner.json", "secret-patterns.json", "prompts/instructions.md", "prompts/question.md", "prompts/brief.md", "dist/connect.js", "dist/runner.js", "dist/wake.js", "dist/data-layer.js"]) {
    fs.mkdirSync(path.dirname(path.join(plugin, file)), { recursive: true });
    fs.writeFileSync(path.join(plugin, file), "");
  }
  const paths = { claudeDir, settings: path.join(claudeDir, "settings.json"), plugins: path.join(claudeDir, "plugins"), managed: path.join(root, "managed") };
  const os = fakeOs();
  const linkHandler = { platform: "linux" as const, home: root, node: "/usr/bin/node", run: os.run };
  const install = (place?: typeof linkHandler) => installWake(paths, path.join(plugin, "dist", "data-layer.js"), path.join(plugin, "dist", "wake.js"), { runnerFrom: plugin, linkHandler: place });
  await install();
  expect(os.calls).toEqual([]);
  expect(await install(linkHandler)).toContainEqual(expect.stringContaining(`registered isoplan:// links to open ${connectScriptPath(claudeDir)}`));
  expect(fs.existsSync(connectScriptPath(claudeDir))).toBe(true);
  const { changes } = await uninstall(paths, { linkHandler });
  expect(changes).toContainEqual(expect.stringContaining("removed the isoplan:// link handler"));
  expect(fs.existsSync(path.join(root, ".local", "share", "applications", "isoplan-connect.desktop"))).toBe(false);
});
