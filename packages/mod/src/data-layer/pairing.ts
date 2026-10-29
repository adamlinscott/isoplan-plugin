// Pairing this machine with an office server that signs people in (adamlinscott/isoplan#23). What
// the machine reports belongs to the person who approves the pairing; the Claude account it names
// is only a label. Pairing happens on this machine, in its own browser:
//
// 1. A link the server refuses as `not-paired` or `pairing-ended` starts pairing. One process of
//    this Claude account on this machine does it at a time, holding <claude dir>/isoplan/pairing.lock:
//    it listens on a loopback callback, http://127.0.0.1:<port>/<nonce>, and asks the server
//    (POST <server>/pair) with that callback and the SHA-256 of a PKCE verifier it keeps.
// 2. It shows the link it gets, `<office>/#pair=<code>`, as a `pair` line: the hooks module puts it
//    in the status line and, once per session start, in the transcript; a detached data layer and
//    the runner log it. The other processes show the same link from the file. Nothing opens a
//    browser.
// 3. The person clicks it on this computer and approves it on the floor, and the browser is sent to
//    the callback with a one-time code. The callback swaps the code and the verifier for the
//    machine's credential (POST <server>/pair/token).
// 4. The credential is swapped for an access token (POST <server>/token) that lasts about an hour,
//    sent in each hello, and renewed before it runs out or when the server says `token-expired`.
//
// The credential is dropped only when the server says the pairing has ended (`pairing-ended`, from
// a hello or a renewal). A `not-paired` refusal of a hello that carried a token means the server
// couldn't read it (a server older than the token, say): the credential is kept, and the link
// backs off.
//
// Everything is kept in <claude dir>/isoplan/pairing.json, readable by its owner only (on Windows
// it takes the folder's permissions), one entry per Claude account, each for one server: pointing
// at another server pairs that account again, and leaves the others alone. A server that signs
// nobody in never refuses, so nothing is paired. With no browser on the machine (a headless box)
// there is no way to pair yet.

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { DataLayerLine } from "../lines.js";
import { alive, releaseLock, takeLock } from "../wake/lock.js";

/** Renewed this long before it runs out. */
const RENEW_EARLY_MS = 5 * 60 * 1000;

/** One Claude account's pairing. */
export interface PairingEntry {
  /** The office server's data-layer address, as in config.json. */
  server: string;
  credential?: string;
  token?: string;
  /** Milliseconds since the epoch. */
  tokenExpires?: number;
  /** The link waiting to be clicked, which the process holding the lock answers. */
  waiting?: { url: string; expires: number };
}

/** What pairing.json holds: each Claude account's entry, by its id. */
export interface PairingFile {
  accounts: Record<string, PairingEntry>;
}

export const pairingPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "pairing.json");
export const pairingLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "pairing.lock");

/** A POST of JSON and its answer: what the pairing calls need of `fetch`. */
export type Post = (url: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;

export interface PairingOptions {
  file: string;
  lock: string;
  /** The data-layer address, ws:// or wss://. */
  server: string;
  /** The machine's Claude account, the same for every folder: the entry's key, and its label. */
  account: { id: string; name: string };
  machine: string;
  emit: (line: DataLayerLine) => void;
  post?: Post;
  now?: () => number;
  pid?: number;
  isAlive?: (pid: number) => boolean;
}

export type Refusal = "not-paired" | "pairing-ended" | "token-expired";

export interface Pairing {
  /**
   * The token for the next hello: undefined to send none (nothing is paired, and the server hasn't
   * asked for it), or null while a link waits to be clicked, when the link tries again shortly.
   * Throws when the server can't be reached.
   */
  token(): Promise<string | null | undefined>;
  /**
   * The server refused a hello sent with `sent`. Only what that hello sent is dropped, not what
   * another process of this machine has written since, and a credential only on `pairing-ended`.
   */
  refused(code: Refusal, sent: string | undefined): Promise<void>;
  /** Stops answering a pairing callback, and lets the lock go. */
  close(): Promise<void>;
}

export const postJson: Post = async (url, body) => {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const value = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body: value && typeof value === "object" ? value : {} };
};

/** The server's http address for a data-layer path: ws(s)://host/data-layer → http(s)://host/data-layer/<path>. */
export function httpUrl(server: string, sub: string): string {
  const url = new URL(server);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/$/, "") + sub;
  url.search = "";
  return url.toString();
}

export async function readPairing(file: string): Promise<PairingFile> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as PairingFile;
    return value && typeof value.accounts === "object" && value.accounts ? value : { accounts: {} };
  } catch {
    return { accounts: {} };
  }
}

/** Written whole, through a temp file, so a reader never sees half of it; owner-only. */
export async function writePairing(file: string, value: PairingFile): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  try {
    await fs.rename(temp, file);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

const page = (text: string) => `<!doctype html><meta charset="utf-8"><title>Isoplan</title><p style="font:16px system-ui;margin:3em auto;max-width:30em">${text}</p>`;

export function createPairing({ file, lock, server, account, machine, emit, post = postJson, now = Date.now, pid = process.pid, isAlive = alive }: PairingOptions): Pairing {
  let asked = false; // the server wants this machine paired
  let shown: string | null = null; // the link last shown
  let unreadable = false; // said once: the server couldn't read the token sent
  let callback: { server: http.Server; timer: ReturnType<typeof setTimeout> | null } | null = null; // the one this process answers

  const mine = async (): Promise<PairingEntry> => {
    const entry = (await readPairing(file)).accounts[account.id];
    return entry && entry.server === server ? entry : { server };
  };
  // Read, changed and written back with only this account's entry touched.
  const update = async (change: (entry: PairingEntry) => PairingEntry) => {
    const all = await readPairing(file);
    const kept = all.accounts[account.id];
    all.accounts[account.id] = change(kept && kept.server === server ? kept : { server });
    await writePairing(file, all);
  };
  const drop = ({ credential: _, token: __, tokenExpires: ___, ...rest }: PairingEntry): PairingEntry => rest;
  const show = (waiting: { url: string; expires: number }) => {
    if (shown === waiting.url) return;
    shown = waiting.url;
    emit({ type: "pair", server, url: waiting.url, expires: new Date(waiting.expires).toISOString() });
  };

  async function renew(entry: PairingEntry): Promise<string | undefined> {
    const answer = await post(httpUrl(server, "/token"), { credential: entry.credential });
    if (answer.status === 200 && typeof answer.body.token === "string") {
      const token = answer.body.token;
      const tokenExpires = Date.parse(String(answer.body.expires));
      await update((e) => ({ ...e, token, tokenExpires: Number.isFinite(tokenExpires) ? tokenExpires : now() }));
      return token;
    }
    if (answer.status === 401 && answer.body.code === "pairing-ended") {
      emit({ type: "log", text: `the office server says this machine's pairing has ended: ${String(answer.body.error ?? "")}` });
      await update(drop);
      asked = true;
      return undefined;
    }
    throw new Error(`the office server answered ${answer.status} when renewing this machine's token`);
  }

  async function stopAnswering() {
    if (!callback) return;
    if (callback.timer) clearTimeout(callback.timer);
    callback.server.close();
    callback = null;
    await update(({ waiting: _, ...rest }) => rest).catch(() => {});
    await releaseLock(lock, pid).catch(() => {});
  }

  // Listens for the browser coming back from the floor with the authorisation code, and asks the
  // server for a pairing that it sends there.
  async function startPairing(): Promise<void> {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const nonce = randomBytes(16).toString("base64url");
    const listener = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      if (request.method !== "GET" || url.pathname !== `/${nonce}` || !code) {
        response.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end(page("Not found."));
        return;
      }
      void post(httpUrl(server, "/pair/token"), { code, verifier }).then(
        async (answer) => {
          if (answer.status === 200 && typeof answer.body.credential === "string") {
            const credential = answer.body.credential;
            await update(({ waiting: _, ...rest }) => ({ ...rest, credential }));
            emit({ type: "log", text: "this machine is paired with the office server" });
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page("This machine is paired with the office. You can close this tab; Claude Code reports to it within a few seconds."));
          } else {
            emit({ type: "log", text: `the office server didn't pair this machine (${answer.status}): ${String(answer.body.error ?? "")}` });
            response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(page("This machine couldn't be paired: the link was used or has expired. Claude Code shows a new one."));
          }
          await stopAnswering();
        },
        (err: unknown) => {
          response.writeHead(502, { "content-type": "text/html; charset=utf-8" }).end(page("The office server couldn't be reached. Click the link again in a moment."));
          emit({ type: "log", text: `couldn't reach the office server to finish pairing: ${String((err as Error)?.message ?? err)}` });
        },
      );
    });
    await new Promise<void>((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", () => resolve()));
    listener.unref();
    const { port } = listener.address() as AddressInfo;
    callback = { server: listener, timer: null };
    try {
      const answer = await post(httpUrl(server, "/pair"), { account, machine: { name: machine }, callback: `http://127.0.0.1:${port}/${nonce}`, challenge });
      if (answer.status !== 200 || typeof answer.body.url !== "string") {
        throw new Error(`the office server answered ${answer.status} when asked to pair${answer.body.error ? `: ${String(answer.body.error)}` : ""}`);
      }
      const waiting = { url: answer.body.url, expires: Date.parse(String(answer.body.expires)) || now() };
      callback.timer = setTimeout(() => void stopAnswering(), Math.max(0, waiting.expires - now()));
      callback.timer.unref?.();
      await update((e) => ({ ...e, waiting }));
      show(waiting);
    } catch (err) {
      await stopAnswering();
      throw err;
    }
  }

  return {
    async token() {
      const entry = await mine();
      if (entry.token && (entry.tokenExpires ?? 0) - RENEW_EARLY_MS > now()) return entry.token;
      if (entry.credential) {
        const renewed = await renew(entry);
        if (renewed) return renewed;
      }
      if (!asked && !entry.waiting) return undefined;
      if (callback) return null;
      // Another process of this machine is answering a link: it is shown here too.
      await fs.mkdir(path.dirname(lock), { recursive: true });
      if (!(await takeLock(lock, pid, isAlive))) {
        if (entry.waiting && entry.waiting.expires > now()) show(entry.waiting);
        return null;
      }
      await startPairing();
      return null;
    },
    async refused(code, sent) {
      if (code !== "token-expired") asked = true;
      const entry = await mine();
      if (code === "not-paired" && sent) {
        if (!unreadable) emit({ type: "log", text: "the office server didn't find this machine's token in its hello; it may be older than pairing. The credential is kept." });
        unreadable = true;
        return;
      }
      if (!sent || entry.token !== sent) return;
      if (code === "token-expired") return update((e) => ({ ...e, tokenExpires: 0 }));
      if (code === "pairing-ended") await update(drop);
    },
    close: stopAnswering,
  };
}
