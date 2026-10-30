import { PROTOCOL_VERSION, type Facts, type QuestionFact } from "@isoplan/protocol";
import { expect, test } from "vitest";
import type { DataLayerLine } from "../lines.js";
import { prepareQuestions, relayOwnerAnswer, WITHHELD_QUESTION } from "./owner-answers.js";

const v = PROTOCOL_VERSION;
const at = "2026-10-20T09:00:00.000Z";
const lead = "claude-code:s:lead";
const asked = (id: string, question: string, extra: Partial<QuestionFact> = {}): QuestionFact => ({ id, agent: lead, at, questions: [{ question, header: "", options: [{ label: "main", description: "" }], multiSelect: false }], ...extra });
const facts: Facts = {
  session: { id: "claude-code:s", source: "claude-code", lead, title: "main", titleFrom: "branch", branch: "main", lastActive: at, status: "active", lights: "on" },
  agents: [],
  edits: [],
  reads: [],
  waits: [],
  reports: [],
  questions: [asked("toolu_1", "Which branch?", { answerable: true })],
};
const request = { type: "request", v, id: "r1", kind: "owner-answer", session: "claude-code:s", question: "toolu_1", answers: { "Which branch?": "main" } } as const;
const file = "C:/Users/ada/.claude/isoplan/answers/s/r1.json";
const sk = "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc";

// The hooks module's file: absent for the first `after` looks, then each of `texts` in turn.
function relay(texts: (string | null)[], { after = 2, detached = false, given = [facts as Facts | null] } = {}) {
  const lines: DataLayerLine[] = [];
  let looks = 0;
  const take = async () => (++looks > after ? (texts.shift() ?? null) : null);
  // `given`: the facts sent, the last of them from then on.
  const sent = () => (given.length > 1 ? given.shift()! : given[0]!);
  return { lines, sent: relayOwnerAnswer(request, { detached, facts: sent, file, emit: (l) => void lines.push(l), take, sleep: async () => {}, waitMs: 1000 }) };
}
const refused = async (r: ReturnType<typeof relay>) => {
  const sent = await r.sent;
  return sent.type === "refusal" && sent.reason === "unavailable" ? sent.detail : null;
};

test("owner answer: passed to the hooks module, and a reply once it ended that question's call; another question's word is passed over", async () => {
  const { lines, sent } = relay([JSON.stringify({ question: "toolu_9", taken: true }), JSON.stringify({ question: "toolu_1", taken: true })]);
  expect(await sent).toEqual({ type: "reply", v, id: "r1", kind: "owner-answer" });
  expect(lines).toEqual([{ type: "owner-answer", question: "toolu_1", answers: { "Which branch?": "main" }, file }]);
});

test("owner answer: refused when the terminal answered first, when the hooks module never says and the question is still open, when it isn't open or waited on, and for a wake-only session", async () => {
  expect(await refused(relay([JSON.stringify({ question: "toolu_1", taken: false })]))).toMatch(/answered in the terminal first/);
  expect(await refused(relay([]))).toMatch(/didn't take the answer in time/);
  const closed = relay([], { given: [{ ...facts, questions: [] }] });
  expect(await refused(closed)).toMatch(/isn't waiting for an answer/);
  expect(closed.lines).toEqual([]);
  const unmarked = relay([], { given: [{ ...facts, questions: [asked("toolu_1", "Which branch?")] }] });
  expect(await refused(unmarked)).toMatch(/plugin isn't waiting for this question/);
  expect(unmarked.lines).toEqual([]);
  const wakeOnly = relay([], { detached: true });
  expect(await refused(wakeOnly)).toMatch(/wake hook/);
  expect(wakeOnly.lines).toEqual([]);
});

test("owner answer: a question that closed while the hooks module never said is a reply: the agent got an answer", async () => {
  expect(await relay([], { given: [facts, { ...facts, questions: [] }] }).sent).toEqual({ type: "reply", v, id: "r1", kind: "owner-answer" });
});

test("questions as sent: answerable only while their wait is marked; one the secret check matches, or every one while the patterns can't be read, goes as a placeholder", () => {
  const logged: string[] = [];
  const open: Facts = { ...facts, questions: [asked("toolu_1", "Which branch?"), asked("toolu_2", `Use the key ${sk}?`), asked("toolu_3", "Ship it?")] };
  const patterns = [{ name: "Stripe secret key", regex: /sk_live_[0-9a-zA-Z]{24}/ }];
  const sent = prepareQuestions(open, patterns, new Set(["toolu_1", "toolu_2"]), (t) => void logged.push(t));
  const held = { id: "toolu_2", agent: lead, at, questions: [{ question: WITHHELD_QUESTION, header: "", options: [], multiSelect: false }], withheld: true };
  expect(sent.questions).toEqual([{ ...open.questions![0], answerable: true }, held, open.questions![2]]);
  expect(JSON.stringify(sent)).not.toContain(sk);
  expect(logged).toEqual([`withheld the question toolu_2 of ${lead}: it matches the secret pattern "Stripe secret key"; it is answered in the terminal`]);
  // An option's text is checked too.
  const inOption: Facts = { ...facts, questions: [{ ...asked("toolu_4", "Which key?"), questions: [{ question: "Which key?", header: "", options: [{ label: "This one", description: sk }], multiSelect: false }] }] };
  expect(prepareQuestions(inOption, patterns, new Set(["toolu_4"]), () => {}).questions![0]).toMatchObject({ withheld: true });
  expect(prepareQuestions(open, null, new Set(["toolu_1"]), () => {}).questions!.every((q) => q.withheld && !q.answerable)).toBe(true);
});
