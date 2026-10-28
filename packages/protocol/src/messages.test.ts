import { describe, expect, test } from "vitest";
import {
  parseDataLayerMessage,
  parseOfficeServerMessage,
  type AgentFact,
  type Facts,
  type ParseResult,
} from "./index.js";

const at = "2026-10-20T09:00:00.000Z";

const lead: AgentFact = {
  id: "claude-code:s1",
  source: "claude-code",
  session: "claude-code:s1",
  startedBy: null,
  agentType: null,
  task: null,
  status: "working",
  statusSince: at,
  lastActive: at,
  doing: { kind: "write", file: "src/a.ts", since: at },
  usage: {
    model: "claude-opus-5-5",
    context: 42000,
    input: 10,
    cacheWrite: 200,
    cacheWrite1h: 0,
    cacheRead: 41790,
    output: 300,
    over100k: { input: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
    at,
  },
};

const worker: AgentFact = {
  ...lead,
  id: "claude-code:w1",
  startedBy: lead.id,
  agentType: "general-purpose",
  task: "Fix the tests",
  status: "done",
  doing: null,
  usage: null,
  checkout: "C:/w/repo-wt",
  branch: null,
  extra: { endState: "completed" },
};

const facts: Facts = {
  session: {
    id: "claude-code:s1",
    source: "claude-code",
    lead: lead.id,
    title: "main",
    titleFrom: "branch",
    branch: "main",
    checkout: "C:/w/repo",
    lastActive: at,
    status: "active",
    lights: "on",
  },
  agents: [lead, worker],
  edits: [{ agent: lead.id, file: "src/a.ts", at }],
  reads: [{ agent: worker.id, file: "src/b.ts", at }],
  waits: [{ waiter: lead.id, on: worker.id, since: at }],
  reports: [{ agent: worker.id, at, text: "Done." }],
};

const valid = {
  hello: {
    type: "hello",
    v: 1,
    source: "claude-code",
    account: { id: "4f9c6a2e-0000-4000-8000-000000000000", name: "Adam" },
    machine: { name: "sevengill" },
    session: "claude-code:s1",
    project: { id: "github.com/adamlinscott/isoplan", name: "isoplan" },
  },
  full: { type: "full", v: 1, seq: 0, facts },
  changes: { type: "changes", v: 1, seq: 1, upsert: {}, remove: {} },
  repair: { type: "repair", v: 1, reason: "missed seq 4" },
  conflict: { type: "conflict", v: 1, agent: worker.id, file: "src/a.ts", text: "Another agent edited src/a.ts." },
  error: { type: "error", v: 1, code: "not-paired", message: "Pair this machine first." },
};

const parsers = {
  hello: parseDataLayerMessage,
  full: parseDataLayerMessage,
  changes: parseDataLayerMessage,
  repair: parseOfficeServerMessage,
  conflict: parseOfficeServerMessage,
  error: parseOfficeServerMessage,
} satisfies Record<keyof typeof valid, (value: unknown) => ParseResult<unknown>>;

// Each message with one field made wrong, and the path the error should name.
const broken: Record<keyof typeof valid, [unknown, string]> = {
  hello: [{ ...valid.hello, project: { id: "github.com/a/b" } }, "project.name"],
  full: [{ ...valid.full, facts: { ...facts, agents: [{ ...lead, status: "busy" }] } }, "facts.agents[0].status"],
  changes: [{ ...valid.changes, seq: -1 }, "seq"],
  repair: [{ ...valid.repair, reason: 4 }, "reason"],
  conflict: [{ ...valid.conflict, file: undefined }, "file"],
  error: [{ ...valid.error, code: "" }, "code"],
};

describe.each(Object.keys(valid) as (keyof typeof valid)[])("%s", (type) => {
  const parse = parsers[type];

  test("parses when valid", () => {
    expect(parse(valid[type])).toEqual({ ok: true, message: valid[type] });
  });

  test("rejects an invalid message, naming the field", () => {
    const [message, path] = broken[type];
    const result = parse(message);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain(path);
  });

  test("rejects another protocol version as unsupported", () => {
    const result = parse({ ...valid[type], v: 2 });
    expect(result).toEqual({
      ok: false,
      kind: "unsupported-version",
      error: "protocol version 2 is not supported; this side speaks version 1",
    });
  });
});

test("a version that isn't a number is invalid, not unsupported", () => {
  expect(parseDataLayerMessage({ ...valid.hello, v: "1" })).toMatchObject({ ok: false, kind: "invalid" });
});

test("each side refuses the other side's messages", () => {
  expect(parseDataLayerMessage(valid.repair)).toMatchObject({ ok: false, kind: "invalid" });
  expect(parseOfficeServerMessage(valid.hello)).toMatchObject({ ok: false, kind: "invalid" });
});

describe("changes", () => {
  test("carries upserted records and the keys of removed ones", () => {
    const message = {
      ...valid.changes,
      upsert: { session: facts.session, agents: [worker], edits: facts.edits, reports: facts.reports },
      remove: {
        agents: ["claude-code:w0"],
        edits: [{ agent: lead.id, file: "src/old.ts" }],
        reads: [{ agent: worker.id, file: "src/b.ts" }],
        waits: [{ waiter: lead.id, on: worker.id }],
        reports: ["claude-code:w0"],
      },
    };
    expect(parseDataLayerMessage(message)).toEqual({ ok: true, message });
  });

  test("rejects a removal key with a part missing", () => {
    const result = parseDataLayerMessage({ ...valid.changes, remove: { waits: [{ waiter: lead.id }] } });
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain("remove.waits[0].on");
  });
});
