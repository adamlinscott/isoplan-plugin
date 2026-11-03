// Which repos the office takes (isoplan-app/isoplan#91): only those an admin added to it. The data
// layer opens a session's link, and so sends its hello, its facts or anything else, only when the
// session's repo is on this list (a workspace above several repos: when one of them is, which it
// reports as), and the runner answers only for such sessions; a session in any other repo sends
// nothing at all, not even its repo's id.
//
// The list comes from GET <server>/repos beside the data-layer address: every approved repo's
// project id, flat (of repos with no remote, only this machine's). With sign-in on it needs this
// machine's access token, so a machine not paired yet pairs here, from that refusal, as the link
// would from a hello's; pairing sends only the machine's name, its id and the Claude account's
// label, never a repo. It is kept in <claude dir>/isoplan/offices/<id>/approved.json, one per server
// (#105), which every process of the machine shares (approved-file.ts). Every refresh reads it,
// due or not, so a later copy another process kept (/isoplan:repos's, src/repos) is taken at the
// next pass; a copy confirmed within `refreshMs` is used as it is, even by a forced check, so links
// dropping on every session at once ask the server once; only `ask` always asks. An older one is
// asked for again with its version, which the server answers with a 304 while it is current, and one
// not confirmed within `maxAgeMs` approves nothing, so a list the machine can't check fails closed.
// A copy confirmed before this process's last failed check is never taken, so a 404 or a refusal
// isn't undone by the copy it replaced. Two processes writing it keep the newer version, whichever
// confirmed its own last.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Project } from "@isoplan/protocol";
import { freshRepos, readApproved, type ApprovedFile } from "./approved-file.js";
import type { Link } from "./link.js";
import { httpUrl, type Pairing, type Refusal } from "./pairing.js";

export { approvedPath, DEFAULT_MAX_AGE_MINUTES, officeDir } from "./approved-file.js";

/** What GET <server>/repos answers. */
export interface RepoList {
  version: string;
  repos: string[];
}

/** A GET with headers, and its answer: what the list needs of `fetch`. */
export type Get = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: unknown }>;

export const getJson: Get = async (url, headers) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: response.status === 200 || response.status === 401 ? await response.json().catch(() => null) : null };
};

/** What one check of the server found: the list (listed), or why not. */
export type Asked = "listed" | ListProblem;

/** Why the list isn't known: pairing (the machine waits to be paired), unreachable (or older than its maximum age), or too-old (the server lists no repos). */
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
  /** A copy not confirmed by the server for this long approves nothing. */
  maxAgeMs: number;
  log: (text: string) => void;
  get?: Get;
  now?: () => number;
}

export interface Approved {
  /** The approved repos' project ids, lower case; null while there is no list, or it is past its maximum age. */
  repos(): ReadonlySet<string> | null;
  /** The list's version; null with none. */
  version(): string | null;
  /** Why there is no list, or null when there is one. */
  problem(): ListProblem | null;
  /**
   * Takes a later copy another process kept, and asks the server once it is due; `force`, at once
   * unless another process confirmed a copy within `refreshMs`, and after a check already running,
   * never skipped (as the link drops or reconnects, or the server says not-wanted). Never throws.
   */
  refresh(force?: boolean): Promise<void>;
  /** Asks the server now, whatever any copy says, after a check already running (/isoplan:repos); what it found. Never throws. */
  ask(): Promise<Asked>;
}

/** While the machine waits to be paired the list is asked for again this soon, and after a failure this soon. */
const PAIR_POLL_MS = 5000;
const RETRY_MS = 30000;
/** A rename the file system refuses for a moment (a scanner holding the file, on Windows) is tried this often. */
const RENAME_TRIES = 5;

const isList = (value: unknown): value is RepoList => {
  const v = value as RepoList | null;
  return !!v && typeof v.version === "string" && Array.isArray(v.repos) && v.repos.every((r) => typeof r === "string");
};

/** Whether `a` is a later list than `b`: a newer version, by when it was first had, or the same one confirmed later. */
const later = (a: ApprovedFile, b: ApprovedFile | null) => !b || (a.version !== b.version ? a.fetched > b.fetched : a.checked > b.checked);

/**
 * The approved repos as approved.json has them from `server`, for a command that only reads (the
 * handoff and ask-the-room commands); null with no copy, or one past `maxAgeMs`.
 */
export async function cachedRepos(file: string, server: string, maxAgeMs: number, now = Date.now()): Promise<ReadonlySet<string> | null> {
  return freshRepos(await readApproved(file, server), maxAgeMs, now);
}

/** Written whole, through a temp file, so a reader never sees half of it; owner-only. A refused rename is tried again, then thrown. */
async function writeFile(file: string, value: ApprovedFile): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  for (let i = 0; ; i++) {
    try {
      await fs.rename(temp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i + 1 < RENAME_TRIES && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await new Promise((r) => setTimeout(r, 25 * 2 ** i));
        continue;
      }
      await fs.rm(temp, { force: true }).catch(() => {});
      throw err;
    }
  }
}

export function createApproved({ server, file, pairing, refreshMs, maxAgeMs, log, get = (url, headers) => getJson(url, headers), now = Date.now }: ApprovedOptions): Approved {
  let list: ApprovedFile | null = null;
  let problem: ListProblem | null = "unreachable";
  let nextAt = -Infinity;
  let failedAt = -Infinity; // when a check last failed: a copy confirmed before it is never taken
  let busy: Promise<Asked | null> | null = null;
  let queued: Promise<Asked | null> | null = null;
  let said = ""; // the last problem logged, so a lasting one is logged once

  const take = (value: ApprovedFile) => {
    list = value;
    problem = null;
    nextAt = value.checked + refreshMs;
  };
  const tell = (text: string) => {
    if (text !== said) log(text);
    said = text;
  };
  // Keeps whichever is later, this process's or the file's, in both.
  async function keep(mine: ApprovedFile): Promise<void> {
    const theirs = await readApproved(file, server);
    const kept = theirs && !later(mine, theirs) ? (theirs.version === mine.version ? { ...theirs, checked: Math.max(theirs.checked, mine.checked) } : theirs) : mine;
    take(kept);
    if (kept === theirs) return;
    await writeFile(file, kept).catch((err: unknown) => tell(`couldn't keep the office's list of repos in ${file}: ${String((err as Error)?.message ?? err)}`));
  }

  // What the server answered; null when the copy was used as it is, without asking.
  async function check(ask: boolean): Promise<Asked | null> {
    // Another process of this machine may have checked it since.
    const shared = await readApproved(file, server);
    if (shared && shared.checked > failedAt && later(shared, list)) take(shared);
    if (!ask && now() < nextAt) return null;
    let token: string | null | undefined;
    try {
      token = pairing ? await pairing.token() : undefined;
    } catch (err) {
      tell(`couldn't read which repos the office takes: ${String((err as Error)?.message ?? err)}`);
      problem = "unreachable";
      failedAt = now();
      nextAt = failedAt + RETRY_MS;
      return "unreachable";
    }
    if (token === null) {
      // A link to pair this machine waits to be clicked; pairing shows it.
      problem = "pairing";
      failedAt = now();
      nextAt = failedAt + PAIR_POLL_MS;
      return "pairing";
    }
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (list) headers["if-none-match"] = `"${list.version}"`;
    let answer: Awaited<ReturnType<Get>>;
    try {
      answer = await get(httpUrl(server, "/repos"), headers);
    } catch (err) {
      answer = { status: 0, body: String((err as Error)?.message ?? err) };
    }
    const code = (answer.body as { code?: unknown } | null)?.code;
    const at = now();
    if (answer.status === 304 && list) {
      said = "";
      await keep({ ...list, checked: at });
      return "listed";
    }
    if (answer.status === 200 && isList(answer.body)) {
      said = "";
      const same = list?.version === answer.body.version;
      await keep({ server, version: answer.body.version, repos: answer.body.repos, fetched: same ? list!.fetched : at, checked: at });
      return "listed";
    }
    failedAt = at;
    if (answer.status === 401 && pairing && (code === "not-paired" || code === "pairing-ended" || code === "token-expired")) {
      // Pairs or renews, as for a hello refused; the list is asked for again at once.
      await pairing.refused(code as Refusal, token).catch(() => {});
      problem = "pairing";
      nextAt = at + (code === "token-expired" || !token ? 0 : PAIR_POLL_MS);
      return "pairing";
    }
    if (answer.status === 404) {
      tell(`${server} is too old to say which repos its office takes, so nothing is sent to it; it needs updating`);
      list = null;
      problem = "too-old";
      nextAt = at + refreshMs;
      return "too-old";
    }
    // Anything else counts as out of reach: the copy stands until its maximum age, then approves nothing.
    tell(`couldn't read which repos the office takes from ${server}: ${answer.status ? `it answered ${answer.status}` : String(answer.body)}`);
    problem = "unreachable";
    nextAt = at + RETRY_MS;
    return "unreachable";
  }

  function run(force: boolean, ask = false): Promise<Asked | null> {
    if (force) nextAt = -Infinity;
    if (busy) {
      if (!force) return busy;
      // Asking waits for the check running, then asks itself.
      if (ask) return busy.then(() => run(true, true));
      // A forced check waits for the one running, then runs: one queued serves every caller meanwhile.
      queued ??= busy.then(() => {
        queued = null;
        return run(true);
      });
      return queued;
    }
    busy = check(ask)
      .catch((err: unknown) => {
        tell(`couldn't read which repos the office takes: ${String((err as Error)?.message ?? err)}`);
        return "unreachable" as const;
      })
      .finally(() => (busy = null));
    return busy;
  }

  return {
    repos: () => freshRepos(list, maxAgeMs, now()),
    version: () => list?.version ?? null,
    problem: () => (list && !freshRepos(list, maxAgeMs, now()) ? "unreachable" : list ? null : problem),
    refresh: (force = false) => run(force).then(() => {}),
    ask: () => run(true, true).then((asked) => asked ?? "unreachable"),
  };
}

/** Why a session sends nothing: no repo of it is on the list, there is no list (or it is past its maximum age), or the machine waits to be paired to read it. */
export type Dormancy = "not-approved" | "no-list" | "pairing";

/** A session's link as the office's list allows it (SessionGate). */
export interface SessionGate {
  /**
   * The session's home now: the first of `candidates` on the list (its own repo; a workspace's
   * repos, in order), or why there is none. The link closes when there is none, when the home has
   * changed, and when the list has changed since the server said not-wanted, so it opens afresh.
   */
  home(candidates: readonly Project[]): Promise<{ home: Project | null; dormancy: Dormancy | null }>;
  /** The link for the home `home` gave, opened now if there is none; null while there is no home (a check that finished since said none). */
  link(): Link | null;
  /** The link, while there is one. */
  current(): Link | null;
  /** Closes the link: the session has nothing to report. */
  drop(): void;
  /** The server said not-wanted: the list is checked again now, and the link opens afresh once it has changed. */
  notWanted(): void;
  /** The link asks before each connect, the first and every reconnect: the list checked again now, and whether the home is still on it. */
  mayConnect(): Promise<boolean>;
}

export function createSessionGate({ approved, open }: { approved: Approved; open: (home: Project, mayConnect: () => Promise<boolean>) => Link }): SessionGate {
  let link: Link | null = null;
  let home: Project | null = null;
  let linked: string | null = null; // the home the link says hello from
  let unwanted: string | null | undefined; // the list's version when the server said not-wanted
  const shut = () => {
    link?.close();
    link = null;
    linked = null;
  };
  const mayConnect = async () => {
    await approved.refresh(true);
    const repos = approved.repos();
    return !!repos && linked !== null && repos.has(linked.toLowerCase());
  };
  return {
    async home(candidates) {
      await approved.refresh();
      const repos = approved.repos();
      home = (repos && candidates.find((p) => repos.has(p.id.toLowerCase()))) || null;
      if (!home) {
        shut();
        return { home: null, dormancy: repos ? "not-approved" : approved.problem() === "pairing" ? "pairing" : "no-list" };
      }
      if (linked !== null && linked !== home.id) shut();
      if (unwanted !== undefined && approved.version() !== unwanted) {
        unwanted = undefined;
        shut();
      }
      return { home, dormancy: null };
    },
    link() {
      if (!home) return null;
      if (!link) {
        link = open(home, mayConnect);
        linked = home!.id;
      }
      return link;
    },
    current: () => link,
    drop: shut,
    notWanted() {
      unwanted = approved.version();
      void approved.refresh(true);
    },
    mayConnect,
  };
}
