// Orca (the agent-workspace app) on this machine, for a take into it: its CLI, found where Orca
// installs it, and run hidden with --json. Only on Windows and a Mac: on Linux `orca` is usually
// the GNOME screen reader, which must never be started by mistake.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { killTree } from "../runner/claude.js";

const isFile = (p: string) => fs.stat(p).then((s) => s.isFile(), () => false);

/**
 * Orca's CLI: PATH first, then where Orca's installer puts it (Windows: %LOCALAPPDATA%\Programs\orca,
 * a Mac: Orca.app in /Applications or ~/Applications). Null when none is found, and always on any
 * other platform.
 */
export async function findOrca(env: Record<string, string | undefined>, platform: NodeJS.Platform, home: string, exists: (p: string) => Promise<boolean> = isFile): Promise<string | null> {
  if (platform !== "win32" && platform !== "darwin") return null;
  const windows = platform === "win32";
  const join = windows ? path.win32.join : path.posix.join;
  const pathVar = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const dirs = pathVar.split(windows ? ";" : ":").filter(Boolean);
  const localAppData = Object.entries(env).find(([key]) => key.toUpperCase() === "LOCALAPPDATA")?.[1] ?? join(home, "AppData", "Local");
  const candidates = windows
    ? [...dirs.map((d) => join(d, "orca.exe")), join(localAppData, "Programs", "orca", "resources", "bin", "orca.exe")]
    : [...dirs.map((d) => join(d, "orca")), "/Applications/Orca.app/Contents/Resources/bin/orca", join(home, "Applications", "Orca.app", "Contents", "Resources", "bin", "orca")];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return null;
}

/** What one Orca command answered: its `result`, or why it failed. */
export type OrcaAnswer = { ok: true; result: Record<string, unknown> } | { ok: false; error: string; code: string | null };

/** Runs Orca's CLI with `args` and --json. */
export type RunOrca = (args: string[]) => Promise<OrcaAnswer>;

/**
 * Runs the CLI at `bin` hidden, with no window of its own, and reads its JSON answer. A .js or .mjs
 * `bin` is run with node (a test's fake Orca).
 */
export function orcaRunner(bin: string, env: Record<string, string>, timeoutMs = 60000): RunOrca {
  const command = /\.m?js$/.test(bin) ? [process.execPath, bin] : [bin];
  return (args) =>
    new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(command[0]!, [...command.slice(1), ...args, "--json"], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      child.stdout.setEncoding("utf8").on("data", (piece: string) => (stdout += piece));
      child.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-2000)));
      const timer = setTimeout(() => killTree(child as never), timeoutMs);
      child.on("error", (err) => (clearTimeout(timer), resolve({ ok: false, error: err.message, code: null })));
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const answer = JSON.parse(stdout) as { ok?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown; data?: { nextSteps?: unknown } } };
          if (answer.ok === true) return resolve({ ok: true, result: (answer.result ?? {}) as Record<string, unknown> });
          const steps = Array.isArray(answer.error?.data?.nextSteps) ? ` ${answer.error.data.nextSteps.join(" ")}` : "";
          const said = typeof answer.error?.code === "string" ? answer.error.code : null;
          return resolve({ ok: false, error: `${String(answer.error?.message ?? said ?? "it failed")}${steps}`, code: said });
        } catch {
          resolve({ ok: false, error: (stderr || stdout).trim() || `orca exited with code ${code}`, code: null });
        }
      });
    });
}
