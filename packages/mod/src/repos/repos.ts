// What /isoplan:repos (commands/repos.md) does for each office: asks it now which repos it takes,
// past the data layer's `approvedRefreshMinutes`, through the same list the data layers and the
// runner read (data-layer/approved.ts), so the copy every process of the machine shares is the
// server's own at once; and says, in one fixed sentence, whether it takes this folder's repo.
// A running session's data layer takes that copy at its next pass, at most 30 seconds off while it
// sends nothing, so a repo just added shows on the floor within a minute.
//
// It only reads this machine's pairing, as the handoff commands do: a kept token while it is
// current, else one swapped for this command alone, never written back; it never pairs the machine.
// Nothing the office says is passed on, and no token or credential is ever printed.

import type { Project } from "@isoplan/protocol";
import { createApproved, getJson, type Get } from "../data-layer/approved.js";
import { httpUrl, pairingEntry, postJson, readPairing, type Pairing, type Post } from "../data-layer/pairing.js";

/** What an office said of its list just now. */
export type Answer = { kind: "listed"; repos: ReadonlySet<string> } | { kind: "not-paired" | "unreachable" | "too-old" | "plain" };

// A kept token is used while it has longer than this left, as the data layer's renewal would.
const TOKEN_LEFT_MS = 5 * 60 * 1000;

/** This machine's pairing with `server`, only read: undefined with none (an office that signs nobody in), null when the office won't swap its credential. */
export function readOnlyPairing(file: string, server: string, account: string, post: Post = postJson, now = Date.now): Pairing {
  return {
    async token() {
      const entry = pairingEntry(await readPairing(file), server, account);
      if (!entry?.credential) return undefined;
      if (entry.token && (entry.tokenExpires ?? 0) - TOKEN_LEFT_MS > now()) return entry.token;
      const answer = await post(httpUrl(server, "/token"), { credential: entry.credential });
      return answer.status === 200 && typeof answer.body.token === "string" ? answer.body.token : null;
    },
    refused: async () => {},
    close: async () => {},
  };
}

/** Asks `server` for its list now, keeping it in `file` for every process of the machine, and says what it answered. */
export async function checkOffice(options: { server: string; file: string; pairing: Pairing; refreshMs: number; maxAgeMs: number; get?: Get }): Promise<Answer> {
  const get = options.get ?? getJson;
  let status = null as number | null; // null: never asked; 0: couldn't be reached
  const approved = createApproved({
    ...options,
    log: () => {},
    get: async (url, headers) => {
      status = 0;
      const answer = await get(url, headers);
      status = answer.status;
      return answer;
    },
  });
  await approved.refresh(true);
  const repos = approved.repos();
  if ((status === 200 || status === 304) && repos) return { kind: "listed", repos };
  if (status === 401 || (status === null && approved.problem() === "pairing")) return { kind: "not-paired" };
  if (status === 404) return { kind: "too-old" };
  return { kind: "unreachable" };
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
  const home = projects.find((p) => answer.repos.has(p.id.toLowerCase()));
  const ids = projects.map((p) => p.id).join(", ");
  if (home && workspace) return `${label} takes ${home.id}, a repo in this folder: this session shows on its floor within a minute.`;
  if (home) return `${label} takes this repo (${home.id}): this session shows on its floor within a minute.`;
  if (workspace) return `${label} takes none of the repos in this folder (${ids}): an admin can add one under Repos on the floor.`;
  return `${label} doesn't take this repo (${ids}): an admin can add it under Repos on the floor.`;
}
