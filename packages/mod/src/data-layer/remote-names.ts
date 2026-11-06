// A GitHub repo's current owner and name, for a clone whose remote still names it as it was before
// a rename or a transfer. GitHub serves the old name silently and git never says the repo moved, so
// without this an old clone reports as a second project, and the floor shows a second district.
//
// Only github.com is asked: `GET https://api.github.com/repos/{owner}/{repo}` follows the redirect
// and gives the repo's `full_name` now. Any other host stays as its URL says. A private repo needs
// the machine's own token, found without a prompt or a window: `gh auth token`, then on Windows
// `git credential fill` with every prompt off (Git Credential Manager non-interactive, no askpass,
// no terminal). On macOS the keychain may ask to let git's helper in, a dialog nothing can turn off,
// so there git's credentials aren't read. With no token, a public repo is still answered.
//
// The answers are kept in <claude dir>/isoplan/remote-names.json, by project id, the repo's current
// name with them and never a token. Only the long-lived processes ask GitHub, the data layer and the
// runner: a remote they meet for the first time is asked about before its project is reported, so a
// clone never reports its old name first; a remote they know is answered from the cache at once and
// asked about again in the background once its answer is a day old, so a later rename is still
// caught. A failed ask (offline, a private repo with no token) leaves the remote's own id, and is
// tried again soon, then less often. The one-shot commands only read the cache.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectId, type Project } from "@isoplan/protocol";

/** Where the answers are kept. */
export const remoteNamesPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "remote-names.json");

// An answer is asked for again after a day; a failed ask after five minutes, doubling each time it fails again.
export const ANSWER_MS = 24 * 3600000;
export const RETRY_MS = 5 * 60000;
const ASK_TIMEOUT_MS = 10000;

/** GitHub's `owner/name` for a repo now; null when it couldn't be asked or didn't say. */
export type AskGitHub = (owner: string, repo: string) => Promise<string | null>;

export interface RemoteNames {
  /** The project as its repo is named now: for a github.com repo that moved, its current id and name; any other as given. */
  current(project: Project): Promise<Project>;
  /** The current project id of the repo a remote URL names. */
  idOf(remote: string): Promise<string>;
  /** The remote URL in the same form, naming the repo's current owner and name. */
  urlOf(remote: string): Promise<string>;
}

// One remote's answer: GitHub's `owner/name` when it last said, and how many asks since have failed.
interface Entry {
  at: number;
  name?: string;
  failures?: number;
}

/**
 * The repos' current names. With `ask`, for a long-lived process, GitHub is asked as above; without
 * it the cache is only read.
 */
export function remoteNames({ file, ask = null, now = Date.now }: { file: string; ask?: AskGitHub | null; now?: () => number }): RemoteNames {
  let entries: Promise<Record<string, Entry>> | null = null;
  const asking = new Map<string, Promise<Entry>>();
  const load = () => (entries ??= readEntries(file));
  const stale = (e: Entry) => now() - e.at >= (e.failures ? Math.min(ANSWER_MS, RETRY_MS * 2 ** (e.failures - 1)) : ANSWER_MS);

  // Asks once at a time per remote, unless another process answered it meanwhile.
  const refresh = (id: string, owner: string, repo: string) => {
    const running = asking.get(id);
    if (running) return running;
    const done = (async () => {
      const onDisk = (await readEntries(file))[id];
      const known = await load();
      if (onDisk && !stale(onDisk)) return (known[id] = onDisk);
      const before = onDisk ?? known[id];
      const name = await ask!(owner, repo).catch(() => null);
      const entry: Entry = name ? { at: now(), name } : { at: now(), ...(before?.name && { name: before.name }), failures: (before?.failures ?? 0) + 1 };
      known[id] = entry;
      await writeEntry(file, id, entry).catch(() => {});
      return entry;
    })().finally(() => asking.delete(id));
    asking.set(id, done);
    return done;
  };

  const current = async (project: Project): Promise<Project> => {
    const m = /^github\.com\/([^/]+)\/([^/]+)$/.exec(project.id);
    if (!m) return project;
    let entry: Entry | undefined = (await load())[project.id];
    if (ask && !entry) entry = await refresh(project.id, m[1]!, m[2]!);
    else if (ask && stale(entry!)) void refresh(project.id, m[1]!, m[2]!).catch(() => {});
    const name = entry?.name;
    if (!name || name.toLowerCase() === `${m[1]}/${m[2]}`) return project;
    return { id: `github.com/${name}`.toLowerCase(), name: name.split("/")[1]! };
  };

  const projectOfUrl = (remote: string) => projectId(remote, { machine: "", root: "" });
  return {
    current,
    idOf: async (remote) => (await current(projectOfUrl(remote))).id,
    async urlOf(remote) {
      const was = projectOfUrl(remote);
      const now = await current(was);
      return now.id === was.id ? remote : renamedUrl(remote, now.id.slice("github.com/".length));
    },
  };
}

// The URL with its path naming `name` (`owner/repo`), keeping its form and any `.git`.
function renamedUrl(remote: string, name: string): string {
  const git = (p: string) => (/\.git\/?$/.test(p) ? ".git" : "");
  if (remote.includes("://")) {
    const url = new URL(remote);
    url.pathname = `/${name}${git(url.pathname)}`;
    return url.toString();
  }
  return remote.replace(/:([^:]*)$/, (_, p: string) => `:${name}${git(p)}`);
}

async function readEntries(file: string): Promise<Record<string, Entry>> {
  const parsed = await fs.readFile(file, "utf8").then((text) => JSON.parse(text) as unknown, () => null);
  const out: Record<string, Entry> = {};
  if (!parsed || typeof parsed !== "object") return out;
  for (const [id, e] of Object.entries(parsed as Record<string, Partial<Entry>>)) {
    if (!e || typeof e.at !== "number") continue;
    out[id] = { at: e.at, ...(typeof e.name === "string" && { name: e.name }), ...(typeof e.failures === "number" && e.failures > 0 && { failures: e.failures }) };
  }
  return out;
}

// One answer written into the file, the others as they are on disk, through a temporary file.
async function writeEntry(file: string, id: string, entry: Entry): Promise<void> {
  const all = { ...(await readEntries(file)), [id]: entry };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(all, null, 2) + "\n");
  await fs.rename(temp, file).catch(async (err: unknown) => {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw err;
  });
}

/** Runs a command with no window and no shell, `input` on its stdin, and settles by the timeout at the latest. */
export type Exec = (cmd: string, args: string[], opts: { env: Record<string, string | undefined>; input?: string }) => Promise<{ code: number; stdout: string }>;

/** Asks GitHub with the first token a source gives, and without one when there is none or GitHub refuses it. */
export function gitHubAsker({ fetch = globalThis.fetch, tokens, timeoutMs = ASK_TIMEOUT_MS }: { fetch?: typeof globalThis.fetch; tokens: (() => Promise<string | null>)[]; timeoutMs?: number }): AskGitHub {
  return async (owner, repo) => {
    let token: string | null = null;
    for (const source of tokens) if ((token = await source().catch(() => null))) break;
    for (const auth of token ? [token, null] : [null]) {
      const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "isoplan-plugin", "X-GitHub-Api-Version": "2022-11-28" };
      if (auth) headers.Authorization = `Bearer ${auth}`;
      try {
        const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
        // A token GitHub doesn't take any more: asked again without it, for a public repo.
        if (res.status === 401 && auth) continue;
        if (res.status !== 200) return null;
        const name = ((await res.json()) as { full_name?: unknown } | null)?.full_name;
        return typeof name === "string" && /^[^/\s]+\/[^/\s]+$/.test(name) ? name : null;
      } catch {
        return null;
      }
    }
    return null;
  };
}

/** gh's token for github.com, when gh is installed and signed in. */
export async function ghToken(exec: Exec, env: Record<string, string | undefined>): Promise<string | null> {
  const r = await exec("gh", ["auth", "token", "--hostname", "github.com"], { env: { ...env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" } });
  const token = r.stdout.trim();
  return r.code === 0 && /^\S+$/.test(token) ? token : null;
}

/**
 * The password git's credential helper keeps for https://github.com, asked with no prompt of any
 * kind: Git Credential Manager non-interactive, askpass off (an empty GIT_ASKPASS stops git looking
 * for one) and no terminal prompt, so git gives up when no helper has it.
 */
export async function credentialToken(exec: Exec, env: Record<string, string | undefined>): Promise<string | null> {
  const quiet = { ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_ASKPASS: "", SSH_ASKPASS: "" };
  const r = await exec("git", ["-c", "credential.interactive=never", "credential", "fill"], { env: quiet, input: "protocol=https\nhost=github.com\n\n" });
  if (r.code !== 0) return null;
  const password = /^password=(.+)$/m.exec(r.stdout)?.[1]?.trim();
  return password || null;
}

/** The token sources on this machine, in order: gh, then git's credentials on Windows. */
export function machineTokens(platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env, exec: Exec = execHidden): (() => Promise<string | null>)[] {
  return [() => ghToken(exec, env), ...(platform === "win32" ? [() => credentialToken(exec, env)] : [])];
}

/** The resolver a long-lived process uses: it asks GitHub. */
export const askingRemoteNames = (claudeDir: string) => remoteNames({ file: remoteNamesPath(claudeDir), ask: gitHubAsker({ tokens: machineTokens() }) });

/** The resolver a one-shot command uses: it only reads the cache. */
export const cachedRemoteNames = (claudeDir: string) => remoteNames({ file: remoteNamesPath(claudeDir) });

const execHidden: Exec = (cmd, args, { env, input }) =>
  new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd: os.homedir(), env, encoding: "utf8", timeout: ASK_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: stdout || "" });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ?? "");
  });
