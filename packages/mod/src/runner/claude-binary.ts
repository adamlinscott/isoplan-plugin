// Finding the `claude` binary, for the Claude Code answerer (claude.ts). Install looks for it and
// records it in <claude dir>/isoplan/claude-binary.json, since the runner may be started where PATH
// is shorter (from a hook, or an app opened from the Dock), and the runner falls back to looking
// again when nothing was recorded. The record is plain JSON, `{ "path": "..." }`; install marks its
// own with `"auto": true`, so one set by hand, without it, is kept by later installs.
//
// Kept free of zod and the protocol so install stays small.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export const claudeBinaryPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "claude-binary.json");

const isFile = (p: string) => fs.stat(p).then((s) => s.isFile(), () => false);

/**
 * The `claude` binary's path: PATH first, then where Claude Code's installers put it. On Windows
 * an npm install leaves only a claude.cmd shim, which can't be run without a shell, so its cli.js
 * is used instead (run with node). Null when none is found.
 */
export async function findClaude(env: Record<string, string | undefined>, platform: NodeJS.Platform, home: string, exists: (p: string) => Promise<boolean> = isFile): Promise<string | null> {
  const windows = platform === "win32";
  const join = windows ? path.win32.join : path.posix.join;
  // Windows names it Path; a lookup by exact name would miss it.
  const pathVar = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const dirs = pathVar.split(windows ? ";" : ":").filter(Boolean);
  const candidates = windows
    ? [...dirs.map((d) => join(d, "claude.exe")), join(home, ".local", "bin", "claude.exe")]
    : [...dirs.map((d) => join(d, "claude")), join(home, ".local", "bin", "claude"), join(home, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  if (windows) {
    for (const d of dirs) {
      const cli = join(d, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
      if ((await exists(join(d, "claude.cmd"))) && (await exists(cli))) return cli;
    }
  }
  return null;
}

/** What runs it: the binary itself, or node and the cli.js. */
export const claudeCommand = (binary: string, node = process.execPath): string[] => (binary.endsWith(".js") ? [node, binary] : [binary]);

/** The recorded binary when it is still there, else a fresh lookup. */
export async function claudeBinary(claudeDir: string, env: Record<string, string | undefined>, platform: NodeJS.Platform, home: string): Promise<string | null> {
  try {
    const recorded = (JSON.parse(await fs.readFile(claudeBinaryPath(claudeDir), "utf8")) as { path?: unknown }).path;
    if (typeof recorded === "string" && (await isFile(recorded))) return recorded;
  } catch {
    // No record, or not one that parses: look.
  }
  return findClaude(env, platform, home);
}

/** The oldest Claude Code that can hand a session to the Claude app (`claude --desktop --resume`). */
export const DESKTOP_MIN_VERSION = "2.1.285";

/** The version `claude --version` prints, such as "2.1.317", or null when it can't be run or says none. */
export function claudeVersion(binary: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const [cmd, ...args] = claudeCommand(binary);
  return new Promise((resolve) => {
    execFile(cmd!, [...args, "--version"], { env, timeout: 30000, windowsHide: true }, (err, stdout) => resolve(err ? null : (/\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? null)));
  });
}

/** Whether `version` is `min` or newer, comparing major, minor and patch as numbers. */
export function atLeast(version: string, min: string): boolean {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/** Whether the Claude app can open Claude Code sessions on this OS: a Mac, or Windows on x64. */
export const desktopPlatform = (platform: NodeJS.Platform, arch: string) => platform === "darwin" || (platform === "win32" && arch === "x64");
