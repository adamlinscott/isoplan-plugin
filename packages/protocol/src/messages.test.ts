import { describe, expect, test } from "vitest";
import {
  parseDataLayerMessage,
  parseOfficeServerMessage,
  PROTOCOL_VERSION,
  type AgentFact,
  type Facts,
  type Handoff,
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
  questions: [
    {
      id: "toolu_01",
      agent: lead.id,
      at,
      questions: [
        {
          question: "Which branch should the fix go on?",
          header: "Branch",
          options: [
            { label: "main", description: "Straight to main." },
            { label: "A new branch", description: "" },
          ],
          multiSelect: false,
        },
      ],
    },
  ],
};

const v = PROTOCOL_VERSION;
const adam = { id: "4f9c6a2e-0000-4000-8000-000000000000", name: "Adam" };
const sam = { id: "7d21b0c4-0000-4000-8000-000000000000", name: "Sam" };
const handoff: Handoff = {
  id: "h7k2",
  brief: "The tests in src/a.ts fail on Windows paths; the fix is half done.",
  repos: [
    { path: ".", remote: "github.com/adamlinscott/isoplan", branch: "isoplan/handoff/h7k2", commit: "0123456789abcdef0123456789abcdef01234567" },
    { path: "libs/core", remote: "github.com/adamlinscott/core", branch: "isoplan/handoff/h7k2", commit: "89abcdef0123456789abcdef0123456789abcdef" },
  ],
};

const valid = {
  hello: {
    type: "hello",
    v,
    source: "claude-code",
    account: adam,
    machine: { name: "sevengill" },
    session: "claude-code:s1",
    project: { id: "github.com/adamlinscott/isoplan", name: "isoplan" },
  },
  runner: { type: "runner", v, account: adam, machine: { name: "sevengill" } },
  full: { type: "full", v, seq: 0, facts },
  changes: { type: "changes", v, seq: 1, upsert: {}, remove: {} },
  "reply answer-question": { type: "reply", v, id: "r1", kind: "answer-question", answer: "Because of the CRLF check." },
  "reply write-brief": { type: "reply", v, id: "r2", kind: "write-brief", handoff },
  "reply owner-answer": { type: "reply", v, id: "r3", kind: "owner-answer" },
  "refusal over-cap": { type: "refusal", v, id: "r1", reason: "over-cap", cap: "owner-tokens" },
  "refusal withheld": { type: "refusal", v, id: "r1", reason: "withheld" },
  "refusal unavailable": { type: "refusal", v, id: "r2", reason: "unavailable", detail: "The session's folder is gone." },
  "hand-over": { type: "hand-over", v, to: "sam@example.com", handoff },
  take: { type: "take", v, code: "K4P9-2QX" },
  taken: { type: "taken", v, handoff: "h7k2", failures: [{ step: "setup", output: "pnpm: command not found" }, { step: "checkout", repo: "libs/core", output: "" }] },
  repair: { type: "repair", v, reason: "missed seq 4" },
  conflict: { type: "conflict", v, agent: worker.id, file: "src/a.ts", text: "Another agent edited src/a.ts." },
  error: { type: "error", v, code: "not-paired", message: "Pair this machine first." },
  "request answer-question": {
    type: "request",
    v,
    id: "r1",
    kind: "answer-question",
    session: "claude-code:s1",
    room: "room:claude-code:s1",
    from: sam,
    question: "Why does the CRLF check exist?",
  },
  "request write-brief": { type: "request", v, id: "r2", kind: "write-brief", session: "claude-code:s1", room: "room:claude-code:s1", handoff: "h7k2", to: sam },
  "request owner-answer": {
    type: "request",
    v,
    id: "r3",
    kind: "owner-answer",
    session: "claude-code:s1",
    question: "toolu_01",
    answers: { "Which branch should the fix go on?": "A new branch" },
  },
  release: { type: "release", v, id: "r1" },
  handoff: { type: "handoff", v, handoff },
};

const parsers = {
  hello: parseDataLayerMessage,
  runner: parseDataLayerMessage,
  full: parseDataLayerMessage,
  changes: parseDataLayerMessage,
  "reply answer-question": parseDataLayerMessage,
  "reply write-brief": parseDataLayerMessage,
  "reply owner-answer": parseDataLayerMessage,
  "refusal over-cap": parseDataLayerMessage,
  "refusal withheld": parseDataLayerMessage,
  "refusal unavailable": parseDataLayerMessage,
  "hand-over": parseDataLayerMessage,
  take: parseDataLayerMessage,
  taken: parseDataLayerMessage,
  repair: parseOfficeServerMessage,
  conflict: parseOfficeServerMessage,
  error: parseOfficeServerMessage,
  "request answer-question": parseOfficeServerMessage,
  "request write-brief": parseOfficeServerMessage,
  "request owner-answer": parseOfficeServerMessage,
  release: parseOfficeServerMessage,
  handoff: parseOfficeServerMessage,
} satisfies Record<keyof typeof valid, (value: unknown) => ParseResult<unknown>>;

// Each message with one field made wrong, and the path the error should name.
const broken: Record<keyof typeof valid, [unknown, string]> = {
  hello: [{ ...valid.hello, project: { id: "github.com/a/b" } }, "project.name"],
  runner: [{ ...valid.runner, machine: {} }, "machine.name"],
  full: [{ ...valid.full, facts: { ...facts, agents: [{ ...lead, status: "busy" }] } }, "facts.agents[0].status"],
  changes: [{ ...valid.changes, seq: -1 }, "seq"],
  "reply answer-question": [{ ...valid["reply answer-question"], answer: "" }, "answer"],
  "reply write-brief": [{ ...valid["reply write-brief"], handoff: { ...handoff, repos: [] } }, "handoff.repos"],
  "reply owner-answer": [{ ...valid["reply owner-answer"], id: "" }, "id"],
  "refusal over-cap": [{ ...valid["refusal over-cap"], cap: "per-week" }, "cap"],
  "refusal withheld": [{ ...valid["refusal withheld"], reason: "secret" }, "reason"],
  "refusal unavailable": [{ ...valid["refusal unavailable"], detail: undefined }, "detail"],
  "hand-over": [{ ...valid["hand-over"], handoff: { ...handoff, id: "H 7" } }, "handoff.id"],
  take: [{ ...valid.take, code: "" }, "code"],
  taken: [{ ...valid.taken, failures: [{ step: "push", output: "" }] }, "failures[0].step"],
  repair: [{ ...valid.repair, reason: 4 }, "reason"],
  conflict: [{ ...valid.conflict, file: undefined }, "file"],
  error: [{ ...valid.error, code: "" }, "code"],
  "request answer-question": [{ ...valid["request answer-question"], room: undefined }, "room"],
  "request write-brief": [{ ...valid["request write-brief"], to: { name: "Sam" } }, "to.id"],
  "request owner-answer": [{ ...valid["request owner-answer"], answers: { q: 1 } }, "answers.q"],
  release: [{ ...valid.release, id: 3 }, "id"],
  handoff: [{ ...valid.handoff, handoff: { ...handoff, repos: [{ ...handoff.repos[0], commit: "0123abc" }] } }, "handoff.repos[0].commit"],
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

  test.each([v - 1, v + 1])("rejects protocol version %i as unsupported", (other) => {
    const result = parse({ ...valid[type], v: other });
    expect(result).toEqual({
      ok: false,
      kind: "unsupported-version",
      error: `protocol version ${other} is not supported; this side speaks version ${v}`,
    });
  });
});

test("a version that isn't a number is invalid, not unsupported", () => {
  expect(parseDataLayerMessage({ ...valid.hello, v: String(v) })).toMatchObject({ ok: false, kind: "invalid" });
});

test("each side refuses the other side's messages", () => {
  for (const type of Object.keys(valid) as (keyof typeof valid)[]) {
    const other = parsers[type] === parseDataLayerMessage ? parseOfficeServerMessage : parseDataLayerMessage;
    expect(other(valid[type])).toMatchObject({ ok: false, kind: "invalid" });
  }
});

test("a reply or request of a kind the channel doesn't have is invalid, naming the kind", () => {
  for (const message of [
    { ...valid["reply owner-answer"], kind: "approve" },
    { ...valid["request owner-answer"], kind: "approve" },
  ]) {
    const result = message.type === "reply" ? parseDataLayerMessage(message) : parseOfficeServerMessage(message);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain("kind");
  }
});

test("facts from a data layer that doesn't report questions still parse", () => {
  const { questions: _, ...older } = facts;
  expect(parseDataLayerMessage({ ...valid.full, facts: older })).toEqual({ ok: true, message: { ...valid.full, facts: older } });
});

test("a withheld report parses, and withheld can only be true", () => {
  const report = { agent: worker.id, at, text: "Held for its owner to check.", withheld: true };
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, reports: [report] } })).toMatchObject({ ok: true });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, reports: [{ ...report, withheld: false }] } })).toMatchObject({ ok: false, kind: "invalid" });
});

describe("handoff", () => {
  const [repo] = handoff.repos;
  const withRepo = (change: object) => ({ ...valid.handoff, handoff: { ...handoff, repos: [{ ...repo, ...change }] } });

  test.each([
    ["an absolute POSIX path", withRepo({ path: "/home/sam/repo" }), "handoff.repos[0].path"],
    ["a Windows drive path", withRepo({ path: "C:\\work\\repo" }), "handoff.repos[0].path"],
    ["a drive-relative path", withRepo({ path: "C:repo" }), "handoff.repos[0].path"],
    ["a UNC path", withRepo({ path: "\\\\server\\share\\repo" }), "handoff.repos[0].path"],
    ["a path with ..", withRepo({ path: "libs/../../outside" }), "handoff.repos[0].path"],
    ["a path with .. and backslashes", withRepo({ path: "libs\\..\\.." }), "handoff.repos[0].path"],
    ["a path that starts with -", withRepo({ path: "--upload-pack=touch pwned" }), "handoff.repos[0].path"],
    ["a remote that starts with -", withRepo({ remote: "--upload-pack=touch pwned" }), "handoff.repos[0].remote"],
    ["an ext:: remote", withRepo({ remote: "ext::sh -c touch% /tmp/pwned" }), "handoff.repos[0].remote"],
    ["another transport helper", withRepo({ remote: "fd::17" }), "handoff.repos[0].remote"],
    ["a branch that isn't the handoff's", withRepo({ branch: "main" }), "handoff.repos[0].branch"],
    ["another handoff's branch", withRepo({ branch: "isoplan/handoff/other" }), "handoff.repos[0].branch"],
    ["an id over 64 characters", { ...valid.handoff, handoff: { ...handoff, id: "a".repeat(65) } }, "handoff.id"],
    ["a short commit hash", withRepo({ commit: "0123456" }), "handoff.repos[0].commit"],
  ])("refuses %s", (_, message, path) => {
    const result = parseOfficeServerMessage(message);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain(path);
  });

  test.each([
    ["the folder itself", { path: "." }],
    ["a path with a dash inside it", { path: "libs/my-core" }],
    ["a remote with a dash inside it", { remote: "https://github.com/adamlinscott/isoplan-plugin.git" }],
    ["a scp-style remote", { remote: "git@github.com:adamlinscott/isoplan.git" }],
    ["an ssh remote", { remote: "ssh://git@github.com/adamlinscott/isoplan.git" }],
    ["an https remote", { remote: "https://github.com/adamlinscott/isoplan.git" }],
    ["a file remote", { remote: "file:///C:/remotes/isoplan.git" }],
    ["a local bare remote", { remote: "C:\\remotes\\isoplan.git" }],
    ["a SHA-256 commit", { commit: "0123456789abcdef".repeat(4) }],
  ])("accepts %s", (_, change) => {
    const message = withRepo(change);
    expect(parseOfficeServerMessage(message)).toEqual({ ok: true, message });
  });
});

describe("changes", () => {
  test("carries upserted records and the keys of removed ones", () => {
    const message = {
      ...valid.changes,
      upsert: { session: facts.session, agents: [worker], edits: facts.edits, reports: facts.reports, questions: facts.questions },
      remove: {
        agents: ["claude-code:w0"],
        edits: [{ agent: lead.id, file: "src/old.ts" }],
        reads: [{ agent: worker.id, file: "src/b.ts" }],
        waits: [{ waiter: lead.id, on: worker.id }],
        reports: ["claude-code:w0"],
        questions: ["toolu_00"],
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
