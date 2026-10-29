// Whether Claude Code has the plugin installed and enabled, read from Claude Code's own records,
// for the wake hook and the data layer: Claude Code runs nothing of a plugin's when it is
// uninstalled or disabled, so they look for themselves.
//
// The plugin is known by its data layer's place in Claude Code's plugin cache,
// cache/<marketplace>/<plugin>/<version>/, which names its id, `<plugin>@<marketplace>`. A data
// layer anywhere else (a checkout, a --plugin-dir) has no id, and counts as enabled.
//
// Uninstalled means only this: installed_plugins.json reads, is the shape known (version 2, a
// `plugins` object of install lists), and doesn't list the id. A missing file, one that can't be
// read or parsed, or any other shape is unknown, and unknown never counts as uninstalled, since an
// uninstall removes everything.
//
// Disabled follows `enabledPlugins` as Claude Code merges it, highest first: the managed settings
// files (managed-settings.json and managed-settings.d/*.json in the system folder; a managed `false`
// anywhere wins), the project's local settings (at the git root, or beside the project's own off a
// repository and on Windows), the project's settings in the session's folder, then the user's
// settings.json. The first that names the id decides; none means enabled. A file that can't be read
// or parsed is passed over, as Claude Code passes over it. Managed settings from MDM, the registry
// or the claude.ai console can't be read here.
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
}

export type PluginState = "enabled" | "disabled" | "uninstalled";

/** Claude Code's plugins folder: $CLAUDE_CODE_PLUGIN_CACHE_DIR when it is set, else <claude dir>/plugins. */
export const pluginsDir = (claudeDir: string, env: Record<string, string | undefined>) => env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(claudeDir, "plugins");

/** The system folder Claude Code reads managed-settings.json from. */
export function managedDir(platform: NodeJS.Platform): string {
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  return "/etc/claude-code";
}

/** The id, `<plugin>@<marketplace>`, of the marketplace install `file` is part of; null for a file outside the plugin cache. */
export function pluginIdOf(plugins: string, file: string): string | null {
  const relative = path.relative(path.join(plugins, "cache"), path.resolve(file));
  if (path.isAbsolute(relative)) return null; // another drive
  const parts = relative.split(path.sep);
  return parts.length >= 4 && parts[0] !== ".." ? `${parts[1]}@${parts[0]}` : null;
}

/** The ids installed_plugins.json lists; null when it is missing, can't be read, or isn't the shape known. */
export async function installedPlugins(plugins: string): Promise<string[] | null> {
  const record = await readJson(path.join(plugins, "installed_plugins.json"));
  const list = record?.plugins;
  if (record?.version !== 2 || !isObject(list) || !Object.values(list).every(Array.isArray)) return null;
  return Object.keys(list);
}

/** Whether `enabledPlugins` names the plugin `id` enabled, disabled, or not at all (null). */
export async function enabledIn(file: string, id: string): Promise<boolean | null> {
  const value = (await readJson(file))?.enabledPlugins;
  return isObject(value) && typeof value[id] === "boolean" ? value[id] : null;
}

/**
 * What Claude Code says of the plugin `dataLayer` belongs to. With `cwd` (a session's folder) the
 * project's settings count too; without, only the machine's: the managed files and the user's.
 */
export async function pluginState(place: Place, dataLayer: string, cwd?: string): Promise<PluginState> {
  const id = pluginIdOf(place.plugins, dataLayer);
  if (!id) return "enabled";
  const installed = await installedPlugins(place.plugins);
  if (installed && !installed.includes(id)) return "uninstalled";
  const managed = await Promise.all((await managedFiles(place.managed)).map((file) => enabledIn(file, id)));
  if (managed.includes(false)) return "disabled";
  if (managed.includes(true)) return "enabled";
  for (const file of await ownFiles(place, cwd)) {
    const enabled = await enabledIn(file, id);
    if (enabled !== null) return enabled ? "enabled" : "disabled";
  }
  return "enabled";
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
async function ownFiles({ claudeDir }: Place, cwd?: string): Promise<string[]> {
  const files: string[] = [];
  if (cwd) {
    const root = process.platform === "win32" ? null : await gitRoot(cwd);
    if (root) files.push(path.join(root, ".claude", "settings.local.json"));
    files.push(path.join(cwd, ".claude", "settings.local.json"), path.join(cwd, ".claude", "settings.json"));
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
