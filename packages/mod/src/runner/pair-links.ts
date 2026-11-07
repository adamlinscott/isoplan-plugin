// The runner's shared pairing shows each office's link to pair the machine (src/data-layer/
// pairing.ts) in the status line of the sessions it reports for their hooks modules, but only of
// those waiting for it: a session whose last status line for that office says `pairing` gets the
// link when the pairing shows it, and one that gets to `pairing` later gets the last link then,
// unless it has expired.

import type { DataLayerLine, PairLine } from "../lines.js";

type Send = (line: DataLayerLine) => void;

export interface PairLinks {
  /** The shared pairing showed a link to pair the machine with `line.server`. */
  pair(line: PairLine): void;
  /** A line a report for a hooks module sends it with `send`. */
  sent(session: string, line: DataLayerLine, send: Send): void;
  /** That report ended. */
  ended(session: string, send: Send): void;
}

export function createPairLinks(now: () => number = Date.now): PairLinks {
  const last = new Map<string, PairLine>(); // each office's last link
  const sessions = new Map<string, { send: Send; states: Map<string, string> }>(); // each report's last state for each office
  const fresh = (server: string) => {
    const pair = last.get(server);
    if (pair && !(Date.parse(pair.expires) > now())) last.delete(server);
    return last.get(server);
  };
  return {
    pair(line) {
      last.set(line.server, line);
      for (const { send, states } of sessions.values()) if (states.get(line.server) === "pairing") send(line);
    },
    sent(session, line, send) {
      if (line.type !== "status") return;
      let s = sessions.get(session);
      if (s?.send !== send) sessions.set(session, (s = { send, states: new Map() }));
      s.states.set(line.server, line.state);
      const pair = line.state === "pairing" ? fresh(line.server) : undefined;
      if (pair) send(pair);
    },
    ended(session, send) {
      if (sessions.get(session)?.send === send) sessions.delete(session);
    },
  };
}
