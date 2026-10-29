// Asking the room (#49), as the receiver's agent does it through the plugin's ask_room tool: the
// question goes to the office server on the session's short link, and the answer comes back from
// the fork of the room's lead on its owner's machine. It never blocks the session for long (#45):
// it polls askPolls times, askPollSeconds apart (runner.json, with the caps), and the server's own
// news of the question cuts a wait short. With no answer by then, the agent is told to carry on;
// the question stays queued on the server, and a later answer reaches the agent as a note on one of
// its next tool results (hooks/register.ts).

import { PROTOCOL_VERSION, type AskedMessage, type OfficeServerMessage } from "@isoplan/protocol";
import type { SideLink } from "../handoff/connection.js";

/** What runner.json says about asking. */
export interface AskSettings {
  askPolls: number;
  askPollSeconds: number;
}

// How long the server has to answer the ask and each check.
const ANSWER_MS = 20000;

const isAsked = (id: string | null) => (m: OfficeServerMessage): m is AskedMessage => m.type === "asked" && (id === null || m.question === id);

/** The server refused the hello as `token-expired`: the caller renews the token and asks again. */
export class TokenExpired extends Error {}

/** What the agent is told when the office server won't let this session in (pairing, #23). */
export const REFUSED: Record<string, string> = {
  "not-paired": "This machine isn't paired with the office yet, so the room can't be asked from here. Isoplan shows a link to pair it in Claude Code's status line; once the person approves it on the floor, ask again.",
  "pairing-ended": "This machine's pairing with the office has ended (it was revoked, or the machine was away too long), so the room can't be asked from here. Isoplan shows a link to pair it again in Claude Code's status line.",
  "forged-hello": "The office server refused this session: it belongs to someone else's machine in the office, so it can't ask from here.",
};

/** What the agent is told: the answer, or why there is none and that it should carry on. */
export async function askRoom(link: SideLink, question: string, s: AskSettings): Promise<string> {
  link.send({ type: "ask-room", v: PROTOCOL_VERSION, question });
  const first = await link.next(isAsked(null), ANSWER_MS);
  if (first.type === "error") {
    if (first.code === "token-expired") throw new TokenExpired(first.message);
    const refused = REFUSED[first.code];
    return refused ? `${refused} Carry on without the answer.` : `The room can't be asked: ${first.message}`;
  }
  let latest: AskedMessage = first;
  const id = latest.question;
  try {
    for (let poll = 1; poll <= s.askPolls && !over(latest); poll++) {
      // A change the server sends ends the wait early; otherwise the poll asks where it stands.
      const pushed = await link.next(isAsked(id), s.askPollSeconds * 1000).catch(() => null);
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
  } catch {
    // The link went: what the server knows stands, and a later answer still arrives as a note.
  }
  return said(latest);
}

const over = (m: AskedMessage) => m.state === "answered" || m.state === "dropped";

function said(m: AskedMessage): string {
  if (m.state === "answered") return `The room answered your question (${m.question}), from its lead's own session:\n\n${m.answer}`;
  if (m.state === "dropped") return `Your question (${m.question}) was dropped: ${m.note ?? "it won't be answered."} Carry on without it.`;
  const why = m.note ?? (m.state === "withheld" ? "the answer is held on the owner's machine until they release it" : "the room's lead is still answering");
  return [
    `The room hasn't answered yet: ${why}`,
    "",
    `Carry on without the answer, and don't ask again or wait for it. The question (${m.question}) stays queued, and if an answer comes later it reaches you as a note on one of your next tool results.`,
  ].join("\n");
}
