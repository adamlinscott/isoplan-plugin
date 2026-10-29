// Pairing this machine with an office server that signs people in (adamlinscott/isoplan#23). The
// server can't tell which Claude account a data layer runs under, so a person vouches for it once:
//
// 1. A link the server refuses as `not-paired` asks the server for a code (POST <server>/pair) and
//    shows it, with a link to the office, as a `pair` line: the hooks module puts it in the status
//    line and once in the transcript, and a detached data layer or the runner logs it.
// 2. The person approves it on the floor. Meanwhile each try asks whether it has been
//    (POST <server>/pair/collect), and once it has, keeps the machine's credential.
// 3. The credential is swapped for an access token (POST <server>/token) that lasts about an hour,
//    sent in each hello, and renewed before it runs out or when the server says `token-expired`.
//    A credential the server no longer takes (revoked, lapsed, its person gone) is dropped, and the
//    next refusal pairs again.
//
// Everything is kept in one file, <claude dir>/isoplan/pairing.json, readable by its owner only
// (on Windows it takes the folder's permissions), and shared by every data layer and the runner of
// this Claude account on this machine: one code, one credential. It is for one server and one
// account; pointing at another server or signing in to another account pairs again. A server that
// signs nobody in never refuses, so nothing is paired.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DataLayerLine } from "../lines.js";

/** Renewed this long before it runs out. */
const RENEW_EARLY_MS = 5 * 60 * 1000;

/** What pairing.json holds. */
export interface PairingFile {
  /** The office server's data-layer address, as in config.json. */
  server: string;
  /** The Claude account it is paired as. */
  account: string;
  credential?: string;
  token?: string;
  /** Milliseconds since the epoch. */
  tokenExpires?: number;
  /** A code waiting to be approved. */
  waiting?: { code: string; device: string; url: string; expires: number };
}

export const pairingPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "pairing.json");

/** A POST of JSON and its answer: what the pairing calls need of `fetch`. */
export type Post = (url: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;

export interface PairingOptions {
  file: string;
  /** The data-layer address, ws:// or wss://. */
  server: string;
  account: { id: string; name: string };
  machine: string;
  emit: (line: DataLayerLine) => void;
  post?: Post;
  now?: () => number;
}

export interface Pairing {
  /**
   * The token for the next hello: undefined to send none (nothing is paired, and the server hasn't
   * asked for it), or null while a code waits to be approved, when the link tries again shortly.
   * Throws when the server can't be reached.
   */
  token(): Promise<string | null | undefined>;
  /**
   * The server refused a hello sent with `sent`: `not-paired` pairs from the next try on, and
   * `token-expired` renews. Only what that hello sent is dropped, not what another process of this
   * machine has written since.
   */
  refused(code: "not-paired" | "token-expired", sent: string | undefined): Promise<void>;
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

export async function readPairing(file: string): Promise<PairingFile | null> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as PairingFile;
    return value && typeof value.server === "string" && typeof value.account === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Written whole, through a temp file, so a reader never sees half of it; owner-only. */
async function writePairing(file: string, value: PairingFile): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(temp, file);
}

export function createPairing({ file, server, account, machine, emit, post = postJson, now = Date.now }: PairingOptions): Pairing {
  let asked = false; // the server refused this process's hello as not-paired
  let shown: string | null = null; // the code last shown

  // The file's entry for this server and account; another one's is as good as none.
  const mine = async (): Promise<PairingFile> => {
    const kept = await readPairing(file);
    return kept && kept.server === server && kept.account === account.id ? kept : { server, account: account.id };
  };

  async function renew(kept: PairingFile): Promise<string | undefined> {
    const answer = await post(httpUrl(server, "/token"), { credential: kept.credential });
    if (answer.status === 200 && typeof answer.body.token === "string") {
      const tokenExpires = Date.parse(String(answer.body.expires));
      await writePairing(file, { ...kept, token: answer.body.token, tokenExpires: Number.isFinite(tokenExpires) ? tokenExpires : now() });
      return answer.body.token;
    }
    if (answer.status === 401) {
      emit({ type: "log", text: `the office server no longer takes this machine's pairing: ${String(answer.body.error ?? "refused")}` });
      const { credential: _, token: __, tokenExpires: ___, ...rest } = kept;
      await writePairing(file, rest);
      asked = true;
      return undefined;
    }
    throw new Error(`the office server answered ${answer.status} when renewing this machine's token`);
  }

  async function pair(kept: PairingFile): Promise<string | null | undefined> {
    let waiting = kept.waiting && kept.waiting.expires > now() ? kept.waiting : null;
    if (!waiting) {
      const answer = await post(httpUrl(server, "/pair"), { account, machine: { name: machine } });
      const { code, device, url, expires } = answer.body;
      if (answer.status !== 200 || typeof code !== "string" || typeof device !== "string" || typeof url !== "string") {
        throw new Error(`the office server answered ${answer.status} when asked for a pairing code${answer.body.error ? `: ${String(answer.body.error)}` : ""}`);
      }
      waiting = { code, device, url, expires: Date.parse(String(expires)) || now() };
      await writePairing(file, { ...kept, waiting });
    }
    if (shown !== waiting.code) {
      shown = waiting.code;
      emit({ type: "pair", server, code: waiting.code, url: waiting.url, expires: new Date(waiting.expires).toISOString() });
    }
    const answer = await post(httpUrl(server, "/pair/collect"), { device: waiting.device });
    if (answer.status === 202) return null;
    const { waiting: _, ...rest } = kept;
    if (answer.status === 200 && typeof answer.body.credential === "string") {
      emit({ type: "log", text: "this machine is paired with the office server" });
      return renew({ ...rest, credential: answer.body.credential });
    }
    // Expired, or the server restarted: the next try asks for a new code.
    await writePairing(file, rest);
    return null;
  }

  return {
    async token() {
      const kept = await mine();
      if (kept.token && (kept.tokenExpires ?? 0) - RENEW_EARLY_MS > now()) return kept.token;
      if (kept.credential) {
        const renewed = await renew(kept);
        if (renewed) return renewed;
      }
      return asked || kept.waiting ? pair(await mine()) : undefined;
    },
    async refused(code, sent) {
      if (code === "not-paired") asked = true;
      const kept = await mine();
      if (!sent || kept.token !== sent) return;
      if (code === "token-expired") return writePairing(file, { ...kept, tokenExpires: 0 });
      const { credential: _, token: __, tokenExpires: ___, ...rest } = kept;
      await writePairing(file, rest);
    },
  };
}
