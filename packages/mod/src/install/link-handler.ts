// Registers the isoplan:// link handler (src/connect) with the operating system, for this person
// only and without admin rights, and takes it out again. Install does it with the wake hook
// (install.ts), so it follows the plugin's own copy of the handler, which outlives plugin updates.
//
// - Windows: HKCU\Software\Classes\isoplan, a URL protocol whose open command runs node on the
//   handler with the link ("%1").
// - macOS: a small AppleScript app, <claude dir>/isoplan/Isoplan Connect.app, made with osacompile,
//   claiming the isoplan scheme in its Info.plist (CFBundleURLTypes), signed again ad hoc once that
//   is changed, and registered with LaunchServices (lsregister). It hands the link to node in the
//   background, in the environment rather than on a command line.
// - Linux, as far as the desktop allows: isoplan-connect.desktop in ~/.local/share/applications,
//   for x-scheme-handler/isoplan, made the default with xdg-mime.
//
// Each is checked first and left alone when it is already as wanted, since install runs as every
// session starts; and each is taken out only when it runs this config folder's handler, so another
// config folder's, or another program's, is never touched. Every command runs hidden, through `run`.

import fs from "node:fs/promises";
import path from "node:path";
import { exec, type Exec } from "../connect/dialog.js";

export interface LinkHandler {
  platform: NodeJS.Platform;
  claudeDir: string;
  home: string;
  /** $XDG_DATA_HOME, on Linux. */
  dataHome?: string;
  /** The node binary, and the handler it runs. */
  node: string;
  script: string;
  run?: Exec;
}

const KEY = "HKCU\\Software\\Classes\\isoplan";
const COMMAND_KEY = `${KEY}\\shell\\open\\command`;
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const DESKTOP = "isoplan-connect.desktop";

export const macAppPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "Isoplan Connect.app");
const macMarker = (app: string) => path.join(app, "Contents", "Resources", "isoplan-handler.json");
const desktopPath = (h: Pick<LinkHandler, "home" | "dataHome">) => path.join(h.dataHome || path.join(h.home, ".local", "share"), "applications", DESKTOP);

/** The Windows open command: node and the handler, quoted, and the link. */
export const windowsCommand = (node: string, script: string) => `"${node}" "${script}" "%1"`;

// The value `reg query` prints for a key's default, whatever the language of its "(Default)" label.
const regValue = (stdout: string) => /REG_SZ[ \t]+(.*?)\s*$/m.exec(stdout)?.[1] ?? null;
// A path as Windows compares it.
const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

// An AppleScript string literal.
const appleString = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
/** The macOS app's script: the link to node in the background, quoted by the shell's own rules. */
export const macScript = (node: string, script: string) =>
  [
    "on open location theURL",
    `\tdo shell script "ISOPLAN_CONNECT_URL=" & quoted form of theURL & " " & quoted form of ${appleString(node)} & " " & quoted form of ${appleString(script)} & " >/dev/null 2>&1 &"`,
    "end open location",
    "",
  ].join("\n");

// A desktop entry's Exec argument, quoted as the Desktop Entry spec asks, then escaped as its strings are.
const execArg = (value: string) => `"${value.replace(/(["`$\\])/g, "\\$1")}"`.replace(/\\/g, "\\\\");
/** The Linux desktop entry. */
export const desktopEntry = (node: string, script: string) =>
  ["[Desktop Entry]", "Type=Application", "Name=Isoplan Connect", `Exec=${execArg(node)} ${execArg(script)} %u`, "NoDisplay=true", "Terminal=false", "MimeType=x-scheme-handler/isoplan;", ""].join("\n");

/** Registers the handler when it isn't already, as wanted; says what it changed. */
export async function registerLinkHandler(given: LinkHandler): Promise<string[]> {
  // A version manager's node may be a link in a folder of the shell's own (fnm's multishells), gone with it.
  const h = { ...given, node: await fs.realpath(given.node).catch(() => given.node) };
  const run = h.run ?? exec;
  const must = async (file: string, args: string[]) => {
    const r = await run(file, args);
    if (r.code !== 0) throw new Error(`${path.basename(file)} ${args[0] ?? ""} failed${r.code === null ? " to start" : ` (${r.code})`}`);
  };
  if (h.platform === "win32") {
    const want = windowsCommand(h.node, h.script);
    if (regValue((await run("reg", ["query", COMMAND_KEY, "/ve"])).stdout) === want) return [];
    await must("reg", ["add", KEY, "/ve", "/d", "URL:Isoplan", "/f"]);
    await must("reg", ["add", KEY, "/v", "URL Protocol", "/d", "", "/f"]);
    await must("reg", ["add", COMMAND_KEY, "/ve", "/d", want, "/f"]);
    return [`registered isoplan:// links to open ${h.script}`];
  }
  if (h.platform === "darwin") {
    const app = macAppPath(h.claudeDir);
    const marker = JSON.stringify({ node: h.node, script: h.script });
    if ((await fs.readFile(macMarker(app), "utf8").catch(() => null)) === marker) return [];
    const source = path.join(h.claudeDir, "isoplan", "connect.applescript");
    await fs.rm(app, { recursive: true, force: true });
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, macScript(h.node, h.script));
    try {
      await must("osacompile", ["-o", app, source]);
    } finally {
      await fs.rm(source, { force: true });
    }
    const plist = path.join(app, "Contents", "Info.plist");
    await must("plutil", ["-replace", "CFBundleIdentifier", "-string", "dev.isoplan.connect", plist]);
    await must("plutil", ["-replace", "CFBundleURLTypes", "-json", JSON.stringify([{ CFBundleURLName: "Isoplan link", CFBundleURLSchemes: ["isoplan"] }]), plist]);
    await must("plutil", ["-replace", "LSUIElement", "-bool", "true", plist]);
    await must("codesign", ["--force", "--deep", "--sign", "-", app]);
    await fs.writeFile(macMarker(app), marker);
    await must(LSREGISTER, ["-f", app]);
    return [`registered isoplan:// links to open ${h.script}, through ${app}`];
  }
  if (h.platform === "linux") {
    const file = desktopPath(h);
    const want = desktopEntry(h.node, h.script);
    if ((await fs.readFile(file, "utf8").catch(() => null)) === want && (await run("xdg-mime", ["query", "default", "x-scheme-handler/isoplan"])).stdout.trim() === DESKTOP) return [];
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, want);
    await must("xdg-mime", ["default", DESKTOP, "x-scheme-handler/isoplan"]);
    await run("update-desktop-database", [path.dirname(file)]);
    return [`registered isoplan:// links to open ${h.script}, through ${file}`];
  }
  return [];
}

/** Takes the handler out when it is this config folder's; says what it changed. */
export async function unregisterLinkHandler(h: Omit<LinkHandler, "node">): Promise<string[]> {
  const run = h.run ?? exec;
  if (h.platform === "win32") {
    const value = regValue((await run("reg", ["query", COMMAND_KEY, "/ve"])).stdout);
    if (!value || !norm(value).includes(norm(h.script))) return [];
    await run("reg", ["delete", KEY, "/f"]);
    return ["removed the isoplan:// link handler"];
  }
  if (h.platform === "darwin") {
    const app = macAppPath(h.claudeDir);
    if (!(await fs.stat(app).catch(() => null))) return [];
    await run(LSREGISTER, ["-u", app]);
    await fs.rm(app, { recursive: true, force: true });
    return [`removed the isoplan:// link handler, ${app}`];
  }
  if (h.platform === "linux") {
    const file = desktopPath(h);
    if (!(await fs.readFile(file, "utf8").catch(() => "")).includes(execArg(h.script))) return [];
    await fs.rm(file, { force: true });
    await run("update-desktop-database", [path.dirname(file)]);
    return [`removed the isoplan:// link handler, ${file}`];
  }
  return [];
}
