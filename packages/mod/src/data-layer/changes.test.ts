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
