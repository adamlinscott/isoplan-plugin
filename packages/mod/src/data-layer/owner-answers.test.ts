import { PROTOCOL_VERSION, type Facts } from "@isoplan/protocol";
import { expect, test } from "vitest";
import type { DataLayerLine } from "../lines.js";
import { relayOwnerAnswer } from "./owner-answers.js";

const v = PROTOCOL_VERSION;
const at = "2026-10-20T09:00:00.000Z";
const lead = "claude-code:s:lead";
const facts: Facts = {
  session: { id: "claude-code:s", source: "claude-code", lead, title: "main", titleFrom: "branch", branch: "main", lastActive: at, status: "active", lights: "on" },
  agents: [],
  edits: [],
  reads: [],
  waits: [],
  reports: [],
  questions: [{ id: "toolu_1", agent: lead, at, questions: [{ question: "Which branch?", header: "", options: [], multiSelect: false }], answerable: true }],
};
const request = { type: "request", v, id: "r1", kind: "owner-answer", session: "claude-code:s", question: "toolu_1", answers: { "Which branch?": "main" } } as const;
const file = "C:/Users/ada/.claude/isoplan/answers/s-1.json";

// The hooks module's file: absent for the first `after` looks, then `text`.
function relay(text: string | null, { after = 2, detached = false, given = facts as Facts | null } = {}) {
  const lines: DataLayerLine[] = [];
  let looks = 0;
  const take = async () => (++looks > after ? text : null);
  return { lines, sent: relayOwnerAnswer(request, { detached, facts: given, file, emit: (l) => void lines.push(l), take, sleep: async () => {}, waitMs: 1000 }) };
}

test("owner answer: passed to the hooks module, and a reply once it ended the question's call", async () => {
  const { lines, sent } = relay(JSON.stringify({ question: "toolu_1", taken: true }));
  expect(await sent).toEqual({ type: "reply", v, id: "r1", kind: "owner-answer" });
  expect(lines).toEqual([{ type: "owner-answer", question: "toolu_1", answers: { "Which branch?": "main" }, file }]);
});

test("owner answer: refused when the terminal answered first, when Claude Code never says, when the question isn't open, and for a wake-only session", async () => {
  const refused = async (r: ReturnType<typeof relay>) => {
    const sent = await r.sent;
    return sent.type === "refusal" && sent.reason === "unavailable" ? sent.detail : null;
  };
  expect(await refused(relay(JSON.stringify({ question: "toolu_1", taken: false })))).toMatch(/answered in the terminal first/);
  expect(await refused(relay(null))).toMatch(/didn't take the answer in time/);
  const closed = relay("{}", { given: { ...facts, questions: [] } });
  expect(await refused(closed)).toMatch(/isn't waiting for an answer/);
  expect(closed.lines).toEqual([]);
  const wakeOnly = relay("{}", { detached: true });
  expect(await refused(wakeOnly)).toMatch(/wake hook/);
  expect(wakeOnly.lines).toEqual([]);
});
