// The data layer's settings: the mod's config.json, overridden per key by the person's own
// ~/.claude/isoplan/config.json. A user value that is missing, null or the wrong shape leaves that
// key at the mod's default.

import type { MaybePromise, Stat } from "./git.js";

export interface Config {
  /** The office server's data-layer address: wss://, or ws:// to this machine, or anywhere with allowPlainWs. */
  server: string;
  /** Lets `server` be plain ws:// to another machine, which sends facts and credentials unencrypted. */
  allowPlainWs: boolean;
  /** A `server` set to plain ws:// to another machine without allowPlainWs: not used, and said why. */
  plainRefused?: string;
  activeMinutes: number;
  idleMinutes: number;
  lightsOffHours: number;
  quietSeconds: number;
  stalledMinutes: number;
  touchedWindowMinutes: number;
  touchedTools: string[];
  shellTools: string[];
  helperPrompts: string[];
  streamSeconds: number;
  tailBytes: number;
  gitCacheSeconds: number;
  /** A session folder git can't place is a workspace when it holds between one and this many repos directly. */
  workspaceRepos: number;
}

export interface ConfigIo {
  stat(path: string): MaybePromise<Stat | null>;
  read(path: string): MaybePromise<string>;
}

export async function loadConfig(io: ConfigIo, defaultsPath: string, userPath: string): Promise<Config> {
  const config = await loadSettings<Config>(io, defaultsPath, userPath);
  const asked = (await readJson(io, userPath, true)).server;
  if (typeof asked === "string" && URL.canParse(asked) && new URL(asked).protocol === "ws:" && !LOOPBACK.has(new URL(asked).hostname)) {
    if (config.allowPlainWs) config.server = asked;
    else config.plainRefused = asked;
  }
  return config;
}

/** The same per-key override for any settings file of the mod's, such as the runner's runner.json. */
export async function loadSettings<T>(io: ConfigIo, defaultsPath: string, userPath: string): Promise<T> {
  const defaults = await readJson(io, defaultsPath);
  const user = await readJson(io, userPath, true);
  const config: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries(defaults)) config[key] = fits(key, user[key], fallback) ? user[key] : fallback;
  return config as unknown as T;
}

// Keys used as a byte count or a file offset, which must be whole numbers.
const BYTE_KEYS = new Set(["tailBytes"]);

// Keys with a floor above zero. The read pace is one: a pass every few milliseconds would spin the
// machine.
const FLOORS = new Map([["streamSeconds", 0.25]]);

// Every number in config.json is a window or a size, so it must be finite and above zero; a
// window in ZERO_OFF may also be 0, which turns its feature off.
const ZERO_OFF = new Set(["lightsOffHours"]);

function fits(key: string, value: unknown, fallback: unknown): boolean {
  if (key === "server") return typeof value === "string" && isWebSocketUrl(value);
  if (typeof fallback === "number") {
    if (BYTE_KEYS.has(key)) return Number.isSafeInteger(value) && (value as number) > 0;
    if (ZERO_OFF.has(key) && value === 0) return true;
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value >= (FLOORS.get(key) ?? 0);
  }
  if (Array.isArray(fallback)) return Array.isArray(value);
  return value != null && typeof value === typeof fallback;
}

// wss:// anywhere; cleartext ws:// only to this machine, since the facts name files and agents' work.
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);

function isWebSocketUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "wss:" || (url.protocol === "ws:" && LOOPBACK.has(url.hostname));
}

async function readJson(io: ConfigIo, p: string, optional = false): Promise<Record<string, unknown>> {
  if (optional && !(await io.stat(p))) return {};
  try {
    const value: unknown = JSON.parse(await io.read(p));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch (err) {
    // A broken override must not take the data layer down; a broken mod default is a bug to see.
    if (optional) return {};
    throw err;
  }
}
