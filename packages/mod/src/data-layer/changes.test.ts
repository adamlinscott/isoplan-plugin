import type { Facts } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { diffFacts } from "./changes.js";

const at = "2026-10-20T09:00:00.000Z";
const later = "2026-10-20T09:01:00.000Z";
const lead = "claude-code:s:lead";
const agent = (id: string, status: "working" | "done") => ({
  id,
  source: "claude-code" as const,
  session: "claude-code:s",
  startedBy: id === lead ? null : lead,
  agentType: null,
  task: null,
  status,
  statusSince: at,
  lastActive: at,
  doing: null,
  usage: null,
});
const base: Facts = {
  session: { id: "claude-code:s", source: "claude-code", lead, title: "main", titleFrom: "branch", branch: "main", lastActive: at, status: "active", lights: "on" },
  agents: [agent(lead, "working"), agent("claude-code:w", "working")],
  edits: [{ agent: lead, file: "a.md", at }],
  reads: [{ agent: "claude-code:w", file: "b.md", at }],
  waits: [{ waiter: lead, on: "claude-code:w", since: at }],
  reports: [],
};

test("changes: nothing changed is null; each list upserts what is new or differs and removes by its key", () => {
  expect(diffFacts(base, structuredClone(base))).toBe(null);
  const next: Facts = {
    ...base,
    session: { ...base.session, title: "Fixing the wizard" },
    agents: [agent(lead, "working"), agent("claude-code:w", "done")],
    edits: [{ agent: lead, file: "a.md", at: later }, { agent: "claude-code:w", file: "a.md", at }],
    reads: [],
    waits: [],
    reports: [{ agent: "claude-code:w", at, text: "Done." }],
  };
  expect(diffFacts(base, next)).toEqual({
    upsert: { session: next.session, agents: [next.agents[1]], edits: next.edits, reports: next.reports },
    remove: { reads: [{ agent: "claude-code:w", file: "b.md" }], waits: [{ waiter: lead, on: "claude-code:w" }] },
  });
});

test("changes: a question is upserted when new or changed, and removed by its id; none before counts as none", () => {
  const asked = (id: string, question: string) => ({ id, agent: lead, at, questions: [{ question, header: "", options: [], multiSelect: false }] });
  const one: Facts = { ...base, questions: [asked("toolu_1", "Which branch?")] };
  expect(diffFacts(base, one)).toEqual({ upsert: { questions: one.questions }, remove: {} });
  const two: Facts = { ...base, questions: [{ ...asked("toolu_1", "Which branch?"), answerable: true }, asked("toolu_2", "Ship it?")] };
  expect(diffFacts(one, two)).toEqual({ upsert: { questions: two.questions }, remove: {} });
  expect(diffFacts(two, { ...base, questions: [] })).toEqual({ upsert: {}, remove: { questions: ["toolu_1", "toolu_2"] } });
  expect(diffFacts(one, base)).toEqual({ upsert: {}, remove: { questions: ["toolu_1"] } });
});

test("changes: the same path at home and in another repo is two records, kept apart and removed by project", () => {
  const web = { id: "github.com/team/web", name: "web" };
  const both: Facts = { ...base, edits: [{ agent: lead, file: "a.md", at }, { agent: lead, file: "a.md", at, project: web, away: true }] };
  expect(diffFacts(both, structuredClone(both))).toBe(null);
  expect(diffFacts(both, { ...both, edits: [both.edits[0]!] })).toEqual({ upsert: {}, remove: { edits: [{ agent: lead, file: "a.md", project: web }] } });
  expect(diffFacts(both, { ...both, edits: [both.edits[1]!] })).toEqual({ upsert: {}, remove: { edits: [{ agent: lead, file: "a.md" }] } });
});
