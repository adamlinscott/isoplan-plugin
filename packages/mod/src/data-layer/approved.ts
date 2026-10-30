// Which repos the office takes (adamlinscott/isoplan#91): only those an admin added to it. The data
// layer opens a session's link, and so sends its hello, its facts or anything else, only when the
// session's project is on this list, and the runner answers only for such sessions; a session in any
// other repo sends nothing at all, not even its repo's id.
//
// The list comes from GET <server>/repos beside the data-layer address, which answers only the
// approved repos' project ids by office (of repos with no remote, only this machine's). With sign-in
// on it needs this machine's access token, so a machine not paired yet pairs here, from that
// refusal, as the link would from a hello's; pairing sends only the machine's name and the Claude
// account's label, never a repo. It is kept in <claude dir>/isoplan/approved.json for the server it
// came from, which every process of the machine shares: a copy fetched within `refreshMs` is used as
// it is, and an older one is asked for again with its version, which the server answers with a 304
// while it is current. A server that can't be reached leaves the copy as it was; with no copy, and
// from a server too old to list its repos, nothing is approved.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Link } from "./link.js";
import { httpUrl, type Pairing, type Refusal } from "./pairing.js";

/** What GET <server>/repos answers. */
export interface RepoList {
  version: string;
  offices: { id: string; name: string; repos: string[] }[];
}

/** What approved.json holds: the list, the server it came from, and when it was last checked. */
interface Cached extends RepoList {
  server: string;
  checked: number;
}

/** A GET with headers, and its answer: what the list needs of `fetch`. */
export type Get = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: unknown }>;

export const getJson: Get = async (url, headers) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: response.status === 200 || response.status === 401 ? await response.json().catch(() => null) : null };
};

export const approvedPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "approved.json");

/** Why the list isn't known: pairing (the machine waits to be paired), unreachable, or too-old (the server lists no repos). */
export type ListProblem = "pairing" | "unreachable" | "too-old";

export interface ApprovedOptions {
  /** The data-layer address, ws:// or wss://. */
  server: string;
  /** approved.json. */
  file: string;
  /** This machine's pairing, for a server that signs people in. */
  pairing?: Pairing;
  /** How long a copy is used before it is checked again. */
  refreshMs: number;
  log: (text: string) => void;
  get?: Get;
  now?: () => number;
}

export interface Approved {
  /** The approved repos' project ids, lower case; null while there is no list. */
  repos(): ReadonlySet<string> | null;
  /** Why there is no list, or null when there is one. */
  problem(): ListProblem | null;
  /**
   * Reads the list again once it is due; `force`, at once (as the link drops or the server says
   * not-wanted), though not more than once in FORCE_MS. Never throws.
   */
  refresh(force?: boolean): Promise<void>;
}

/** A forced refresh comes at most this often. */
const FORCE_MS = 30000;
/** While the machine waits to be paired, or the server can't be reached, the list is asked for again this soon. */
const PAIR_POLL_MS = 5000;
const RETRY_MS = 30000;

const isList = (value: unknown): value is RepoList => {
  const v = value as RepoList | null;
  return !!v && typeof v.version === "string" && Array.isArray(v.offices) && v.offices.every((o) => o && Array.isArray(o.repos) && o.repos.every((r) => typeof r === "string"));
};

async function readCache(file: string, server: string): Promise<Cached | null> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as Cached;
    return value.server === server && typeof value.checked === "number" && isList(value) ? value : null;
  } catch {
    return null;
  }
}

/** Written whole, through a temp file, so a reader never sees half of it; owner-only. */
async function writeCache(file: string, value: Cached): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(temp, file).catch(async (err) => {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw err;
  });
}

const idsOf = (list: RepoList) => new Set(list.offices.flatMap((o) => o.repos.map((r) => r.toLowerCase())));

/**
 * The approved repos as approved.json last had them from `server`, for a command that only reads
 * (the handoff and ask-the-room commands); null with no copy.
 */
export async function cachedRepos(file: string, server: string): Promise<ReadonlySet<string> | null> {
  const cached = await readCache(file, server);
  return cached && idsOf(cached);
}

/** Why a session sends nothing: its repo isn't on the list, there is no list yet, or the machine waits to be paired to read it. */
export type Dormancy = "not-approved" | "no-list" | "pairing";

/**
 * A session's link as the list allows it: while `project` is on it, `link`, or one `open` opens now;
 * while it isn't, none (`link` is closed), and why. Nothing opens a socket before the list says so.
 */
export async function gateLink(approved: Approved, project: string, link: Link | null, open: () => Link): Promise<{ link: Link | null; dormancy: Dormancy | null }> {
  await approved.refresh();
  const repos = approved.repos();
  if (repos?.has(project.toLowerCase())) return { link: link ?? open(), dormancy: null };
  link?.close();
  return { link: null, dormancy: repos ? "not-approved" : approved.problem() === "pairing" ? "pairing" : "no-list" };
}

export function createApproved({ server, file, pairing, refreshMs, log, get = getJson, now = Date.now }: ApprovedOptions): Approved {
  let list: Cached | null = null;
  let ids: ReadonlySet<string> | null = null;
  let problem: ListProblem | null = "unreachable";
  let nextAt = -Infinity;
  let forcedAt = -Infinity;
  let busy: Promise<void> | null = null;
  let said = ""; // the last problem logged, so a lasting one is logged once

  const take = (value: Cached) => {
    list = value;
    ids = idsOf(value);
    problem = null;
    nextAt = value.checked + refreshMs;
  };
  const tell = (text: string) => {
    if (text !== said) log(text);
    said = text;
  };

  async function check(): Promise<void> {
    // Another process of this machine may have checked it since.
    const shared = await readCache(file, server);
    if (shared && shared.checked > (list?.checked ?? -Infinity)) take(shared);
    if (list && now() < nextAt) return;
    let token: string | null | undefined;
    try {
      token = pairing ? await pairing.token() : undefined;
    } catch (err) {
      tell(`couldn't read which repos the office takes: ${String((err as Error)?.message ?? err)}`);
      if (!list) problem = "unreachable";
      nextAt = now() + RETRY_MS;
      return;
    }
    if (token === null) {
      // A link to pair this machine waits to be clicked; pairing shows it.
      if (!list) problem = "pairing";
      nextAt = now() + PAIR_POLL_MS;
      return;
    }
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (list) headers["if-none-match"] = `"${list.version}"`;
    let answer: Awaited<ReturnType<Get>>;
    try {
      answer = await get(httpUrl(server, "/repos"), headers);
    } catch (err) {
      tell(`couldn't read which repos the office takes from ${server}: ${String((err as Error)?.message ?? err)}`);
      if (!list) problem = "unreachable";
      nextAt = now() + RETRY_MS;
      return;
    }
    const code = (answer.body as { code?: unknown } | null)?.code;
    if (answer.status === 304 && list) {
      const kept: Cached = { ...list, checked: now() };
      take(kept);
      await writeCache(file, kept).catch(() => {});
    } else if (answer.status === 200 && isList(answer.body)) {
      const fresh: Cached = { server, version: answer.body.version, offices: answer.body.offices, checked: now() };
      take(fresh);
      said = "";
      await writeCache(file, fresh).catch((err: unknown) => tell(`couldn't keep the office's list of repos in ${file}: ${String((err as Error)?.message ?? err)}`));
    } else if (answer.status === 401 && pairing && (code === "not-paired" || code === "pairing-ended" || code === "token-expired")) {
      // Pairs or renews, as for a hello refused; the list is asked for again at once.
      await pairing.refused(code as Refusal, token).catch(() => {});
      if (!list) problem = "pairing";
      nextAt = now() + (code === "token-expired" || !token ? 0 : PAIR_POLL_MS);
    } else if (answer.status === 404) {
      tell(`${server} is too old to say which repos its office takes, so nothing is sent to it; it needs updating`);
      list = null;
      ids = null;
      problem = "too-old";
      nextAt = now() + refreshMs;
    } else {
      tell(`the office server answered ${answer.status} when asked which repos it takes`);
      if (!list) problem = "unreachable";
      nextAt = now() + RETRY_MS;
    }
  }

  return {
    repos: () => ids,
    problem: () => problem,
    refresh(force = false) {
      if (busy) return busy;
      if (force && now() - forcedAt >= FORCE_MS) {
        forcedAt = now();
        nextAt = -Infinity;
      }
      if (now() < nextAt) return Promise.resolve();
      busy = check()
        .catch((err: unknown) => tell(`couldn't read which repos the office takes: ${String((err as Error)?.message ?? err)}`))
        .finally(() => (busy = null));
      return busy;
    },
  };
}
