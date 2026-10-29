// Asking the room (#49), as the receiver's agent does it through the plugin's ask_room tool: the
// question goes to the office server on the session's short link, and the answer comes back from
// the fork of the room's lead on its owner's machine. It never blocks the session for long (#45):
// it polls askPolls times, askPollSeconds apart (runner.json, with the caps), and the server's own
// news of the question cuts a wait short; however runner.json is set, it waits at most
// MAX_WAIT_MS. With no answer by then, the agent is told to carry on: the question stays queued on
// the server, and its end reaches the agent later as a note on one of its next tool results
// (hooks/register.ts). An end shown here is acked (asked-ack), so the server doesn't send it again.
//
// `key` is the tool call's own id: sent again, the ask is the same question, so a retry after a
// lost reply never asks twice.

import { PROTOCOL_VERSION, type AskedMessage, type OfficeServerMessage } from "@isoplan/protocol";
import type { SideLink } from "../handoff/connection.js";
import { endText, MAX_WAIT_MS } from "./text.js";

export { MAX_WAIT_MS };

/** What runner.json says about asking. */
export interface AskSettings {
  askPolls: number;
  askPollSeconds: number;
}

// How long the server has to answer the ask and each check.
const ANSWER_MS = 20000;

const isAsked = (id: string | null) => (m: OfficeServerMessage): m is AskedMessage => m.type === "asked" && (id === null || m.question === id);

/** The server refused the hello as `token-expired`: the caller renews the token and asks again, under the same key. */
export class TokenExpired extends Error {}

/** What the agent is told when the office server won't let this session in (pairing, #23). */
export const REFUSED: Record<string, string> = {
  "not-paired": "This machine isn't paired with the office yet, so the room can't be asked from here. Isoplan shows a link to pair it in Claude Code's status line; once the person approves it on the floor, ask again.",
  "pairing-ended": "This machine's pairing with the office has ended (it was revoked, or the machine was away too long), so the room can't be asked from here. Isoplan shows a link to pair it again in Claude Code's status line.",
  "forged-hello": "The office server refused this session: it belongs to someone else's machine in the office, so it can't ask from here.",
};

/** What the agent is told when the server didn't confirm the ask: it may have been logged. */
export const UNCONFIRMED =
  "The office server didn't confirm the question in time. It may have been logged all the same, and if so its answer reaches you later as a note on one of your next tool results. Carry on without it, and don't ask it again.";

/** What the agent is told: the answer, or why there is none and that it should carry on. */
export async function askRoom(link: SideLink, question: string, s: AskSettings, key?: string): Promise<string> {
  link.send({ type: "ask-room", v: PROTOCOL_VERSION, question, ...(key ? { key } : {}) });
  const first = await link.next(isAsked(null), ANSWER_MS).catch(() => null);
  if (!first) return UNCONFIRMED;
  if (first.type === "error") {
    if (first.code === "token-expired") throw new TokenExpired(first.message);
    const refused = REFUSED[first.code];
    return refused ? `${refused} Carry on without the answer.` : `The room can't be asked: ${first.message}`;
  }
  let latest: AskedMessage = first;
  const id = latest.question;
  const pollMs = s.askPollSeconds * 1000;
  const polls = Math.min(s.askPolls, Math.floor(MAX_WAIT_MS / Math.max(pollMs, 1)));
  try {
    for (let poll = 1; poll <= polls && !over(latest); poll++) {
      // A change the server sends ends the wait early; otherwise the poll asks where it stands.
      const pushed = await link.next(isAsked(id), pollMs).catch(() => null);
      if (pushed?.type === "error") break;
      if (pushed) {
        latest = pushed;
        continue;
      }
      link.send({ type: "ask-check", v: PROTOCOL_VERSION, question: id });
      const checked = await link.next(isAsked(id), ANSWER_MS);
      if (checked.type === "error") break;
      latest = checked;
    }
    if (over(latest)) link.send({ type: "asked-ack", v: PROTOCOL_VERSION, question: id });
  } catch {
    // The link went: what the server knows stands, and the end still arrives as a note.
  }
  return said(latest);
}

const over = (m: AskedMessage) => m.state === "answered" || m.state === "dropped";

function said(m: AskedMessage): string {
  if (over(m)) return endText(m, false);
  const why = m.note ?? (m.state === "withheld" ? "the answer is held on the owner's machine until they release it" : "the room's lead is still answering");
  return [
    `The room hasn't answered yet: ${why}`,
    "",
    `Carry on without the answer, and don't ask again or wait for it. The question (${m.question}) stays queued, and if an answer comes later it reaches you as a note on one of your next tool results.`,
  ].join("\n");
}
