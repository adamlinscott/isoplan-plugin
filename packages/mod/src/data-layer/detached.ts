// When the runner stops reporting a session (report-session.ts), so it reports none past its work:
// it reports the session again once its transcript moves (src/runner/reporting.ts).

// A link down this long in a row (no server running, say) ends the runner's report of a session.
export const LINK_DOWN_MS = 5 * 60000;

export interface DetachedState {
  now: number;
  /** The session's last activity, as its facts give it. */
  lastActive: string;
  idleMinutes: number;
  /** When the link was last seen not connected, after being connected or from the start; null while connected. */
  downSince: number | null;
}

/**
 * Why the runner should stop reporting a session now, or null to go on. A quiet session is still reported
 * once: the quiet rule waits for the link to connect, which sends the facts in full.
 */
export function detachedStop({ now, lastActive, idleMinutes, downSince }: DetachedState): string | null {
  if (downSince === null && now - Date.parse(lastActive) > idleMinutes * 60000) return `the session has been quiet more than ${idleMinutes} minutes`;
  if (downSince !== null && now - downSince >= LINK_DOWN_MS) return `the office server has been out of reach for ${LINK_DOWN_MS / 60000} minutes`;
  return null;
}
