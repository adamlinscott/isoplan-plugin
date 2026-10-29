import { PROTOCOL_VERSION, type AskedMessage, type DataLayerMessage, type OfficeServerMessage } from "@isoplan/protocol";
import { expect, test } from "vitest";
import type { SideLink } from "../handoff/connection.js";
import { askRoom, REFUSED, TokenExpired } from "./ask.js";

const SETTINGS = { askPolls: 3, askPollSeconds: 0.02 };
const asked = (state: AskedMessage["state"], more: Partial<AskedMessage> = {}): AskedMessage => ({ type: "asked", v: PROTOCOL_VERSION, question: "q-1", text: "Which branch?", state, ...more });

// A server that answers each message the script sends with what `answer` gives, and can send news of its own.
function fakeServer(answer: (m: DataLayerMessage) => OfficeServerMessage | null) {
  const sent: DataLayerMessage[] = [];
  const inbox: OfficeServerMessage[] = [];
  const link: SideLink = {
    send(m) {
      sent.push(m);
      const reply = answer(m);
      if (reply) inbox.push(reply);
    },
    async next(wanted, ms) {
      const end = Date.now() + ms;
      for (;;) {
        const i = inbox.findIndex((m) => m.type === "error" || wanted(m));
        if (i >= 0) return inbox.splice(i, 1)[0] as never;
        if (Date.now() >= end) throw new Error("the office server didn't answer in time");
        await new Promise((r) => setTimeout(r, 2));
      }
    },
    close: async () => {},
  };
  return { link, sent, push: (m: OfficeServerMessage) => inbox.push(m) };
}

test("ask: a room that answers while the agent waits gives the answer", async () => {
  const s = fakeServer((m) => (m.type === "ask-room" ? asked("asking") : null));
  setTimeout(() => s.push(asked("answered", { answer: "feat/migrate-v2." })), 5);
  expect(await askRoom(s.link, "Which branch?", SETTINGS)).toBe("The room answered your question (q-1), from its lead's own session:\n\nfeat/migrate-v2.");
  expect(s.sent).toEqual([{ type: "ask-room", v: PROTOCOL_VERSION, question: "Which branch?" }]);
});

test("ask: a session that may not ask is told why, and nothing else is sent", async () => {
  const s = fakeServer(() => ({ type: "error", v: PROTOCOL_VERSION, code: "ask-refused", message: "Only a handoff gives the right to ask a room." }));
  expect(await askRoom(s.link, "Which branch?", SETTINGS)).toBe("The room can't be asked: Only a handoff gives the right to ask a room.");
  expect(s.sent).toHaveLength(1);
});

test("ask: an offline machine is polled askPolls times, then the agent is told to carry on, with why", async () => {
  const note = "Queued: Adam's machine isn't reachable now (its runner isn't linked). It is asked again when it is.";
  const s = fakeServer(() => asked("queued", { note }));
  const said = await askRoom(s.link, "Which branch?", SETTINGS);
  expect(s.sent.map((m) => m.type)).toEqual(["ask-room", "ask-check", "ask-check", "ask-check"]);
  expect(s.sent[1]).toEqual({ type: "ask-check", v: PROTOCOL_VERSION, question: "q-1" });
  expect(said).toBe(`The room hasn't answered yet: ${note}\n\nCarry on without the answer, and don't ask again or wait for it. The question (q-1) stays queued, and if an answer comes later it reaches you as a note on one of your next tool results.`);
});

test("ask: a question dropped while it waited says so; a link that goes leaves the agent to carry on", async () => {
  const dropped = fakeServer((m) => (m.type === "ask-room" ? asked("queued") : asked("dropped", { note: "Adam revoked the right to ask this room, so it won't be answered." })));
  expect(await askRoom(dropped.link, "Which branch?", SETTINGS)).toBe("Your question (q-1) was dropped: Adam revoked the right to ask this room, so it won't be answered. Carry on without it.");

  const gone = fakeServer((m) => (m.type === "ask-room" ? asked("asking") : null));
  gone.link.next = ((original) =>
    async function (wanted, ms) {
      if (gone.sent.length > 1) throw new Error("the office server closed the link");
      return original(wanted, ms);
    })(gone.link.next) as SideLink["next"];
  expect(await askRoom(gone.link, "Which branch?", SETTINGS)).toContain("The room hasn't answered yet: the room's lead is still answering");
});

test("ask: a hello the office won't let in tells the agent plainly; an expired token is the caller's to renew", async () => {
  for (const code of ["not-paired", "pairing-ended", "forged-hello"]) {
    const s = fakeServer(() => ({ type: "error", v: PROTOCOL_VERSION, code, message: "the server's own words" }));
    expect(await askRoom(s.link, "Which branch?", SETTINGS)).toBe(`${REFUSED[code]} Carry on without the answer.`);
  }
  const expired = fakeServer(() => ({ type: "error", v: PROTOCOL_VERSION, code: "token-expired", message: "Renew it." }));
  await expect(askRoom(expired.link, "Which branch?", SETTINGS)).rejects.toBeInstanceOf(TokenExpired);
});
