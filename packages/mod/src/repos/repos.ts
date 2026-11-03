// What /isoplan:repos (commands/repos.md) does for each office: asks it now which repos it takes,
// whatever any copy says (Approved.ask), through the same list the data layers and the runner read
// (data-layer/approved.ts), so the copy every process of the machine shares is the server's own at
// once; and says, in one fixed sentence from what the server answered, whether it takes this
// folder's repo. A session's running data layer takes that copy at its next pass, at most 30 seconds
// off while it sends nothing; one that isn't running (a session without the plugin, or one held off)
// starts again at the session's next message, so the sentence says to send one.
//
// The pairing is used as a session's data layer uses it, short of pairing: a kept token while it is
// current, else one renewed with the credential and kept for every process (keepToken), since the
// server keeps only a few live tokens per pairing. It never pairs the machine, nor drops a credential.
// Nothing the office says is passed on, and no token or credential is ever printed.

import type { Project } from "@isoplan/protocol";
import { createApproved, getJson, type Get } from "../data-layer/approved.js";
import { httpUrl, keepToken, pairingEntry, postJson, readPairing, RENEW_EARLY_MS, type Pairing, type Post } from "../data-layer/pairing.js";

/** What an office answered just now. */
export type Answer = { kind: "listed"; repos: ReadonlySet<string> } | { kind: "not-paired" | "unreachable" | "too-old" | "plain" };

/** Where this machine's pairing with one office is kept. */
export interface PairingPlace {
  file: string;
  writeLock: string;
  server: string;
  account: string;
  legacy?: boolean;
}

/**
 * This machine's pairing with `place.server`: undefined with none (an office that signs nobody in),
 * null when the office says the pairing has ended; throws when the office can't renew the token.
 */
export function commandPairing(place: PairingPlace, log: (text: string) => void, post: Post = postJson, now = Date.now): Pairing {
  return {
    async token() {
      const entry = pairingEntry(await readPairing(place.file), place.server, place.account);
      if (!entry?.credential) return undefined;
      if (entry.token && (entry.tokenExpires ?? 0) - RENEW_EARLY_MS > now()) return entry.token;
      const answer = await post(httpUrl(place.server, "/token"), { credential: entry.credential });
      if (answer.status === 401) return null;
      if (answer.status !== 200 || typeof answer.body.token !== "string") throw new Error(`the office answered ${answer.status} when renewing this machine's token`);
      const expires = Date.parse(String(answer.body.expires));
      await keepToken(place, entry.credential, answer.body.token, Number.isFinite(expires) ? expires : now()).catch((err: unknown) =>
        log(`couldn't keep the renewed token for ${place.server}: ${String((err as Error)?.message ?? err)}`),
      );
      return answer.body.token;
    },
    refused: async () => {},
    close: async () => {},
  };
}

/** Asks `server` for its list now, keeping it in `file` for every process of the machine, and says what it answered. */
export async function checkOffice(options: { server: string; file: string; pairing: Pairing; refreshMs: number; maxAgeMs: number; log: (text: string) => void; get?: Get }): Promise<Answer> {
  const approved = createApproved({ ...options, get: options.get ?? getJson });
  const asked = await approved.ask();
  if (asked === "listed") return { kind: "listed", repos: approved.repos()! };
  return { kind: asked === "pairing" ? "not-paired" : asked };
}

/** The sentence for one office, named by `label`, about this folder's `projects` (one repo, or a workspace's). */
export function sentence(label: string, answer: Answer, projects: readonly Project[], workspace: boolean): string {
  switch (answer.kind) {
    case "plain":
      return `${label} is plain ws:// to another machine, so nothing is sent to it: use wss://, or set "allowPlainWs": true in config.json.`;
    case "not-paired":
      return `This computer isn't connected to ${label}, so nothing of this session is sent to it: press Connect Claude Code on its floor to connect.`;
    case "too-old":
      return `${label} is too old to say which repos it takes, so nothing is sent to it: it needs updating.`;
    case "unreachable":
      return `Couldn't reach ${label} to ask which repos it takes: try /isoplan:repos again in a minute.`;
  }
  if (!projects.length) return `Git couldn't read the repos in this folder, so nothing of this session is sent to ${label}.`;
  const home = projects.find((p) => answer.repos.has(p.id.toLowerCase()));
  const shows = "this session shows on its floor within a minute; if it doesn't, send any message in it.";
  if (home && workspace) return `${label} takes ${home.id}, a repo in this folder: ${shows}`;
  if (home) return `${label} takes this repo (${home.id}): ${shows}`;
  const ids = projects.map((p) => p.id).join(", ");
  if (workspace) return `${label} takes none of the repos in this folder (${ids}): an admin can add one under Repos on the floor.`;
  return `${label} doesn't take this repo (${ids}): an admin can add it under Repos on the floor.`;
}

/** Said in place of every office's sentence when config.json names no office. */
export const NO_OFFICE = "This computer isn't connected to an Isoplan office yet: press Connect Claude Code on your office's Isoplan page.";
