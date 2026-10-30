// Whether Claude Code has the plugin installed and enabled, read from Claude Code's own records,
// for the wake hook and the data layer: Claude Code runs nothing of a plugin's when it is
// uninstalled or disabled, so they look for themselves.
//
// The plugin is known by its data layer's place in Claude Code's plugin cache,
// cache/<marketplace>/<plugin>/<version>/, which names its id, `<plugin>@<marketplace>`. A data
// layer anywhere else (a checkout, a --plugin-dir) has no id, and counts as enabled.
//
// Uninstalled means only this: installed_plugins.json reads, is the shape known (version 2, a
// `plugins` object of install lists), and lists no install of a plugin of that name, from any
// marketplace and at any scope, so moving from one marketplace to another is never an uninstall;
// and no folder in $CLAUDE_CODE_PLUGIN_DIRS holds it. A missing file, one that can't be read or
// parsed, or any other shape is unknown, and unknown never counts as uninstalled, since an
// uninstall removes everything. A copy loaded with --plugin-dir leaves no record to find, so it
// can't count. An install at project or local scope counts only for that project's sessions; one
// whose record names no project counts everywhere.
//
// Disabled follows `enabledPlugins` as Claude Code merges it, highest first: the managed settings
// files (managed-settings.json and managed-settings.d/*.json in the system folder; a managed `false`
// anywhere wins), the project's local settings (at its git root, then in the project's folder),
// the project's settings, then the user's settings.json. The first that names an installed copy
// decides for it, and the plugin is enabled if any copy is; none named means enabled. A file that
// can't be read or parsed is passed over, as Claude Code passes over it. Managed settings from MDM,
// the registry or the claude.ai console can't be read here. The project is the session's
// $CLAUDE_PROJECT_DIR when the caller has it, else its folder.
//
// Kept free of zod and the protocol so the wake hook starts fast.

import fs from "node:fs/promises";
import path from "node:path";

export interface Place {
  /** Claude Code's config folder, holding the user's settings.json. */
  claudeDir: string;
  /** Claude Code's plugins folder (`pluginsDir`). */
  plugins: string;
  /** The system folder managed settings files are in (`managedDir`). */
  managed: string;
  /** The folders $CLAUDE_CODE_PLUGIN_DIRS loads plugins from (`pluginDirsOf`). */
  pluginDirs?: string[];
}

export type PluginState = "enabled" | "disabled" | "uninstalled";

/** One install, as installed_plugins.json records it. */
export interface Install {
  id: string;
  scope: string | null;
  projectPath: string | null;
  /** The folder the install loads from: cache/<marketplace>/<plugin>/<version>. */
  installPath: string | null;
  /** The version Claude Code computed for it: plugin.json's, or a commit's SHA when none is pinned. */
  version: string | null;
  /** When it was last installed or updated, as an ISO time. */
  lastUpdated: string | null;
}

/** Claude Code's plugins folder: $CLAUDE_CODE_PLUGIN_CACHE_DIR when it is set, else <claude dir>/plugins. */
export const pluginsDir = (claudeDir: string, env: Record<string, string | undefined>) => env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(claudeDir, "plugins");

/** The folders $CLAUDE_CODE_PLUGIN_DIRS names. */
export const pluginDirsOf = (env: Record<string, string | undefined>) => (env.CLAUDE_CODE_PLUGIN_DIRS ?? "").split(path.delimiter).filter(Boolean);

/** The system folder Claude Code reads managed-settings.json from. */
export function managedDir(platform: NodeJS.Platform): string {
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  return "/etc/claude-code";
}

/** A path as compared: resolved, with forward slashes, and on Windows and macOS without regard to case. */
export function normalPath(p: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(p).replace(/\\/g, "/");
  return platform === "win32" || platform === "darwin" ? resolved.toLowerCase() : resolved;
}

// The parts of `file`'s path below the plugin cache folder `cache`, `<marketplace>/<plugin>/<version>/...`; null outside it.
function cacheParts(cache: string, file: string): string[] | null {
  const relative = path.relative(cache, path.resolve(file));
  if (path.isAbsolute(relative)) return null; // another drive
  const parts = relative.split(path.sep);
  return parts.length >= 4 && parts[0] !== ".." ? parts : null;
}

// cacheParts, with both paths resolved through links and short names; and the cache folder so resolved.
async function realCacheParts(plugins: string, file: string): Promise<{ cache: string; parts: string[] | null }> {
  const cache = await fs.realpath(path.join(plugins, "cache")).catch(() => path.join(plugins, "cache"));
  return { cache, parts: cacheParts(cache, await fs.realpath(file).catch(() => file)) };
}

/** The id, `<plugin>@<marketplace>`, of the marketplace install `file` is part of; null for a file outside the plugin cache. */
export function pluginIdOf(plugins: string, file: string): string | null {
  const parts = cacheParts(path.join(plugins, "cache"), file);
  return parts ? `${parts[1]}@${parts[0]}` : null;
}

// Whether an install counts for a session in `project`: one at user or managed scope, or at project
// or local scope for that project (or naming none). Without a project, every install counts.
const appliesTo = (install: Install, project?: string) =>
  !project || !(install.scope === "project" || install.scope === "local") || !install.projectPath || normalPath(install.projectPath) === normalPath(project);

// What a version folder must hold before it counts: a copy Claude Code is still writing doesn't.
const KEY_FILES = [["dist", "data-layer.js"], ["dist", "wake.js"], ["dist", "hooks.js"], [".claude-plugin", "plugin.json"]];

/**
 * The data layer of the newest copy of its plugin Claude Code records for a session in `project`
 * (`appliesTo`, as `pluginState` counts installs): by version when every one is x.y.z, else by
 * which was updated last (`newestFirst`), counting only a folder that holds KEY_FILES and whose
 * plugin.json names the recorded version (a plugin.json naming none counts, its version came from
 * elsewhere). `dataLayer` itself when that copy is its own folder, when it is outside the cache, or
 * when no record reads. A data layer this doesn't return is outdated: an update put another version
 * on disk, which the session loads at its next start or /reload-plugins.
 */
export async function newestDataLayer(plugins: string, dataLayer: string, project?: string): Promise<string> {
  const { cache, parts } = await realCacheParts(plugins, dataLayer);
  if (!parts) return dataLayer;
  const id = `${parts[1]}@${parts[0]}`;
  const root = await realPath(path.join(cache, ...parts.slice(0, 3)));
  const recorded = newestFirst(((await installs(plugins)) ?? []).filter((i) => i.id === id && i.installPath && appliesTo(i, project)));
  for (const install of recorded) {
    if ((await realPath(install.installPath!)) === root) return dataLayer;
    if (await isComplete(install)) return path.join(install.installPath!, ...parts.slice(3));
  }
  return dataLayer;
}

/**
 * Installs newest first, in one order for the whole list: by semantic version when every install's
 * version is one (a pre-release below its release), else by `lastUpdated`, latest first.
 */
export function newestFirst(list: Install[]): Install[] {
  const versions = list.map((i) => semver(i.version));
  if (!versions.every(Boolean)) return [...list].sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? ""));
  return list
    .map((install, k) => ({ install, v: versions[k]! }))
    .sort((a, b) => compareSemver(b.v, a.v))
    .map((x) => x.install);
}

type Semver = { core: number[]; pre: string[] | null };

const semver = (version: string | null): Semver | null => {
  const m = version ? /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version) : null;
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : null } : null;
};

// Semantic version order: the numbers, then a release above its pre-releases, then the
// pre-release's parts in turn (numbers by value and below words; more parts above fewer).
function compareSemver(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i]! - b.core[i]!;
  if (!a.pre || !b.pre) return (a.pre ? -1 : 0) - (b.pre ? -1 : 0);
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const [x, y] = [a.pre[i]!, b.pre[i]!];
    if (x === y) continue;
    const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return a.pre.length - b.pre.length;
}

// Whether an install's folder holds KEY_FILES and its plugin.json agrees with the recorded version.
async function isComplete(install: Install): Promise<boolean> {
  for (const file of KEY_FILES) if (!(await fs.stat(path.join(install.installPath!, ...file)).then((s) => s.isFile(), () => false))) return false;
  const manifest = await readJson(path.join(install.installPath!, ".claude-plugin", "plugin.json"));
  return !!manifest && (typeof manifest.version !== "string" || manifest.version === install.version);
}

// A folder as compared: its real path (links and short names resolved) where it exists, in normalPath's form.
const realPath = async (p: string) => normalPath(await fs.realpath(p).catch(() => p));

const nameOf = (id: string) => id.slice(0, id.lastIndexOf("@"));

/** Every install installed_plugins.json records; null when it is missing, can't be read, or isn't the shape known. */
export async function installs(plugins: string): Promise<Install[] | null> {
  const record = await readJson(path.join(plugins, "installed_plugins.json"));
  const list = record?.plugins;
  if (record?.version !== 2 || !isObject(list) || !Object.values(list).every(Array.isArray)) return null;
  return Object.entries(list).flatMap(([id, entries]) =>
    (entries as unknown[]).map((entry) => {
      const e = isObject(entry) ? entry : {};
      const text = (key: string) => (typeof e[key] === "string" ? (e[key] as string) : null);
      return { id, scope: text("scope"), projectPath: text("projectPath"), installPath: text("installPath"), version: text("version"), lastUpdated: text("lastUpdated") };
    }),
  );
}

/** The ids installed_plugins.json lists; null when it is unknown (`installs`). */
export async function installedPlugins(plugins: string): Promise<string[] | null> {
  const list = await installs(plugins);
  return list && [...new Set(list.map((i) => i.id))];
}

/** Whether `enabledPlugins` names the plugin `id` enabled, disabled, or not at all (null). */
export async function enabledIn(file: string, id: string): Promise<boolean | null> {
  const value = (await readJson(file))?.enabledPlugins;
  return isObject(value) && typeof value[id] === "boolean" ? value[id] : null;
}

/**
 * What Claude Code says of the plugin `dataLayer` belongs to. With `project` (a session's project
 * folder) the project's settings and installs count too; without, only the machine's: the
 * managed files, the user's settings, and every install.
 */
export async function pluginState(place: Place, dataLayer: string, project?: string): Promise<PluginState> {
  const { parts } = await realCacheParts(place.plugins, dataLayer);
  if (!parts) return "enabled";
  const id = `${parts[1]}@${parts[0]}`;
  const name = nameOf(id);
  const all = await installs(place.plugins);
  let ids = [id];
  if (all) {
    const mine = all.filter((i) => nameOf(i.id) === name);
    if (!mine.length) return (await isInPluginDirs(place.pluginDirs ?? [], name)) ? "enabled" : "uninstalled";
    const here = mine.filter((i) => appliesTo(i, project));
    // Installed only for other projects: nothing to report for this one.
    if (!here.length) return "disabled";
    ids = [...new Set(here.map((i) => i.id))];
  }
  const states = await Promise.all(ids.map((one) => enabledFor(place, one, project)));
  return states.includes(true) ? "enabled" : "disabled";
}

// Whether the plugin `id` is enabled, by the settings files that name it.
async function enabledFor(place: Place, id: string, project?: string): Promise<boolean> {
  const managed = await Promise.all((await managedFiles(place.managed)).map((file) => enabledIn(file, id)));
  if (managed.includes(false)) return false;
  if (managed.includes(true)) return true;
  for (const file of await ownFiles(place, project)) {
    const enabled = await enabledIn(file, id);
    if (enabled !== null) return enabled;
  }
  return true;
}

// Whether a folder $CLAUDE_CODE_PLUGIN_DIRS names holds a plugin called `name`.
async function isInPluginDirs(dirs: string[], name: string): Promise<boolean> {
  for (const dir of dirs) if ((await readJson(path.join(dir, ".claude-plugin", "plugin.json")))?.name === name) return true;
  return false;
}

// managed-settings.json and the drop-ins beside it.
async function managedFiles(managed: string): Promise<string[]> {
  const dropIns = await fs.readdir(path.join(managed, "managed-settings.d")).then(
    (names) => names.filter((n) => n.endsWith(".json")).map((n) => path.join(managed, "managed-settings.d", n)),
    () => [],
  );
  return [path.join(managed, "managed-settings.json"), ...dropIns];
}

// The person's own settings files that can name the plugin, highest first.
async function ownFiles({ claudeDir }: Place, project?: string): Promise<string[]> {
  const files: string[] = [];
  if (project) {
    const root = await gitRoot(project);
    if (root && normalPath(root) !== normalPath(project)) files.push(path.join(root, ".claude", "settings.local.json"));
    files.push(path.join(project, ".claude", "settings.local.json"), path.join(project, ".claude", "settings.json"));
  }
  files.push(path.join(claudeDir, "settings.json"));
  return files;
}

// The nearest folder at or above `dir` holding .git, or null.
async function gitRoot(dir: string): Promise<string | null> {
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    if (await fs.stat(path.join(at, ".git")).then(() => true, () => false)) return at;
    if (path.dirname(at) === at) return null;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

// A JSON object from `file`; null when it is missing, can't be read or parsed, or isn't an object.
async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}
