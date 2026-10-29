// The runner's environment. The runner is started from hooks inside whichever session happens to
// fire one, and that session's process carries whatever its project's settings `env` block put
// there. So the install script records a base environment from the shell that ran it, in
// <claude dir>/isoplan/runner/environment.json, and startRunner starts the supervisor with exactly
// that. The forks get it too, less the variables that tie a process to a session (claude.ts).
//
// Only these are taken: the operating system's basics (PATH, the home and temp folders, the user,
// locale, Windows' system folders), proxy and certificate settings, and what Claude Code's login
// and providers read (ANTHROPIC_*, CLAUDE_CODE_USE_BEDROCK and _VERTEX, CLAUDE_CODE_OAUTH_TOKEN,
// AWS_*, Google Cloud's, CLAUDE_CONFIG_DIR). The file can be edited; each run of the install script
// writes it again. With no file (an install from before it), the runner inherits its starter's
// environment, and logs that it did.
//
// Kept free of zod and the protocol so the wake hook starts fast.

import fs from "node:fs/promises";
import path from "node:path";

export const runnerEnvPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "environment.json");

const KEYS = new Set(
  [
    // The operating system's basics.
    "PATH", "PATHEXT", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "USER", "USERNAME", "LOGNAME", "SHELL",
    "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
    "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES", "OS",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
    // Proxies and certificates.
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
    // Claude Code's login and providers.
    "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH", "CLAUDE_CODE_SKIP_VERTEX_AUTH", "CLOUD_ML_REGION",
  ],
);
const PREFIXES = ["ANTHROPIC_", "AWS_", "GOOGLE_", "GCLOUD_", "CLOUDSDK_", "VERTEX_REGION_"];

/** The part of `env` the runner keeps: names are matched without regard to case, as Windows does. */
export function captureEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const name = key.toUpperCase();
    if (value !== undefined && (KEYS.has(name) || PREFIXES.some((p) => name.startsWith(p)))) out[key] = value;
  }
  return out;
}

const NOTE =
  "Isoplan's runner starts with exactly this environment, recorded from the shell that ran the plugin's install script, so a session's settings can't change what the runner and its forks see. Edit it if you need to; each run of the install script writes it again.";

/** Writes the captured environment; true when it changed. Readable by its owner alone where that can be set. */
export async function recordEnv(claudeDir: string, env: Record<string, string | undefined>): Promise<boolean> {
  const file = runnerEnvPath(claudeDir);
  const text = JSON.stringify({ about: NOTE, env: captureEnv(env) }, null, 2) + "\n";
  if ((await fs.readFile(file, "utf8").catch(() => null)) === text) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}`;
  await fs.writeFile(temp, text, { mode: 0o600 });
  await fs.rename(temp, file);
  return true;
}

/** The recorded environment, or null when there is none, or it doesn't parse, so the starter's is used. */
export async function recordedEnv(claudeDir: string): Promise<Record<string, string> | null> {
  try {
    const { env } = JSON.parse(await fs.readFile(runnerEnvPath(claudeDir), "utf8")) as { env?: unknown };
    if (!env || typeof env !== "object" || Array.isArray(env)) return null;
    return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return null;
  }
}
