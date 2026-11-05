// Running node with no window on Windows, for what Windows itself starts: an isoplan:// link
// (link-handler.ts) and the login item (login-item.ts). node.exe is a console program, so Windows
// gives it a console window of its own when it starts it straight from a registry command. Instead
// Windows starts wscript.exe, which has no console, on a small JScript file that starts node with
// window style 0 (hidden) and doesn't wait for it. Probed on Windows 11 (26200): node started that
// way ran with no window, saw the link it was given in its environment unchanged (`%41` stayed as
// it was), and wscript exited 0.
//
// Windows Script Host can be turned off by policy, and wscript then shows a message instead of
// running anything, so `scriptHostOff` is checked before anything is registered through it.

import path from "node:path";
import type { Exec } from "../connect/dialog.js";

/** wscript.exe, by its full path, so no other program of that name is found first. */
export const wscriptPath = (env: Record<string, string | undefined> = process.env) => path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "wscript.exe");

/** The command Windows runs: wscript in batch mode (no prompts, no logo) on `launcher`, then `args`. */
export const launchCommand = (launcher: string, args = "") => `"${wscriptPath()}" //B //NoLogo "${launcher}"${args ? ` ${args}` : ""}`;

/** The launcher `launchCommand` names in a command; null for any other command. */
export const launcherOf = (command: string | null) => (command ? (/^"[^"]+\\wscript\.exe" \/\/B \/\/NoLogo "([^"]+)"/i.exec(command)?.[1] ?? null) : null);

/**
 * The launcher: runs `"<node>" "<script>" <args>` hidden. With `link`, the link Windows gives it goes
 * to node in ISOPLAN_CONNECT_URL, never on a command line, as the Mac handler passes it.
 */
export function hiddenLauncher(node: string, script: string, { args = "", link = false }: { args?: string; link?: boolean } = {}): string {
  const command = `"${node}" "${script}"${args ? ` ${args}` : ""}`;
  return [
    "// Isoplan: starts node with no window. The plugin's install wrote this file; uninstall removes it.",
    `var isoplan = ${JSON.stringify({ node, script })};`,
    'var shell = new ActiveXObject("WScript.Shell");',
    ...(link ? ['shell.Environment("PROCESS")("ISOPLAN_CONNECT_URL") = WScript.Arguments(0);'] : []),
    `shell.Run(${JSON.stringify(command)}, 0, false);`,
    "",
  ].join("\r\n");
}

/** The node and script a launcher names, as hiddenLauncher writes them; null when it isn't one. */
export function launcherPaths(text: string | null): { node?: unknown; script?: unknown } | null {
  const line = text ? /^var isoplan = (.*);\r?$/m.exec(text)?.[1] : undefined;
  try {
    return line ? (JSON.parse(line) as { node?: unknown; script?: unknown }) : null;
  } catch {
    return null;
  }
}

const SCRIPT_HOST_KEYS = ["HKCU\\Software\\Microsoft\\Windows Script Host\\Settings", "HKLM\\Software\\Microsoft\\Windows Script Host\\Settings"];

/** Whether Windows Script Host is turned off for this person or this computer (`Enabled` set to 0). */
export async function scriptHostOff(run: Exec): Promise<boolean> {
  for (const key of SCRIPT_HOST_KEYS) {
    const value = /\bEnabled[ \t]+REG_\w+[ \t]+(\S+)/i.exec((await run("reg", ["query", key, "/v", "Enabled"])).stdout)?.[1];
    if (value !== undefined && /^(0|0x0+)$/i.test(value)) return true;
  }
  return false;
}
