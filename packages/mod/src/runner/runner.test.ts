import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, type HandoffMessage, type HandoffRepo, type RefusalMessage, type ReplyMessage, type RequestMessage, type TakenMessage } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { loadSettings } from "../data-layer/config.js";
import { nodeIo } from "../data-layer/io.js";
import type { Answered, Answerer, Ask, Lead } from "./answerer.js";
import { openLedger, type Entry } from "./caps.js";
import { loadPrompts } from "./prompts.js";
import { COMPACTED_NOTE, createRunner, MAX_HELD, PushFailed, type RunnerOptions, type RunnerSettings } from "./runner.js";
import { loadPatterns, scan, UNREADABLE } from "./scan.js";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const defaults = JSON.parse(fs.readFileSync(path.join(modDir, "runner.json"), "utf8")) as RunnerSettings;

const question = (id: string, room = "room-1", session = "claude-code:lead-1"): RequestMessage => ({
  type: "request",
  v: PROTOCOL_VERSION,
  id,
  kind: "answer-question",
  session,
  room,
  from: { id: "claude:bob", name: "Bob" },
  question: `What was the coverage? (${id})`,
});
const brief = (id: string): RequestMessage => ({ type: "request", v: PROTOCOL_VERSION, id, kind: "write-brief", session: "claude-code:lead-1", room: "room-1", handoff: "h-1", to: { id: "claude:bob", name: "Bob" } });

// A stub answerer whose answers are settled by hand, one deferred per ask, in the order asked.
function stub(lead: Partial<Lead> = {}) {
  const asks: { session: string; ask: Ask; settle: (a: Answered) => void }[] = [];
  const root = tempRoot();
  const answerer: Answerer = {
    lead: async (session) => (session.startsWith("claude-code:") ? { cwd: root, working: false, compacted: false, context: 100000, lastActive: NOW, ...lead } : null),
    ask: (session, _lead, ask) => new Promise((settle) => asks.push({ session, ask, settle })),
    close: () => {},
  };
  return { answerer, asks, root };
}

const usage = { input: 5, output: 300, cacheRead: 200000, cacheWrite: 100000 };
const ok = (text: string): Answered => ({ ok: true, text, usage });

async function setup({ lead, settings, entries, ...opts }: Partial<Omit<RunnerOptions, "settings">> & { lead?: Partial<Lead>; settings?: Partial<RunnerSettings>; entries?: Entry[] } = {}) {
  const s = stub(lead);
  const dir = tempRoot();
  const ledgerFile = path.join(dir, "ledger.json");
  if (entries) fs.writeFileSync(ledgerFile, JSON.stringify(entries));
  const ledger = await openLedger(ledgerFile);
  const sent: (ReplyMessage | RefusalMessage | TakenMessage)[] = [];
  const logs: string[] = [];
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(dir, "none.json"), (t) => logs.push(t));
  const runner = createRunner({
    answerer: s.answerer,
    ledger,
    settings: async () => ({ ...defaults, ...settings }),
    prompts: () => loadPrompts(path.join(modDir, "prompts")),
    scan: async (text) => scan(text, patterns),
    send: (m) => sent.push(m),
    log: (t) => logs.push(t),
    isDir: async (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
    isReported: async () => true,
    now: () => NOW,
    ...opts,
  });
  // Waits until the fork has been asked `n` times in all, or `n` messages have been sent.
  const asked = (n: number) => until(() => s.asks.length >= n);
  const sentN = (n: number) => until(() => sent.length >= n);
  const askFor = (id: string) => s.asks.find((a) => a.ask.request.includes(`(${id})`));
  return { ...s, runner, sent, logs, ledger, ledgerFile, asked, sentN, askFor };
}

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("runner: answers one at a time per room; other rooms don't wait", async () => {
  const t = await setup();
  t.runner.take(question("q1", "room-1"));
  t.runner.take(question("q2", "room-1"));
  t.runner.take(question("q3", "room-2"));
  // q2 waits for q1; q3, in another room, runs beside it.
  await t.asked(2);
  await new Promise((r) => setTimeout(r, 50));
  expect(t.asks).toHaveLength(2);
  expect(t.askFor("q2")).toBe(undefined);
  t.askFor("q1")!.settle(ok("one"));
  await t.sentN(1);
  t.askFor("q3")!.settle(ok("three"));
  await t.sentN(2);
  await t.asked(3);
  t.askFor("q2")!.settle(ok("two"));
  await t.runner.settled();
  expect(t.sent.map((m) => ["id" in m && m.id, m.type === "reply" && m.kind === "answer-question" ? m.answer : m.type])).toEqual([
    ["q1", "one"],
    ["q3", "three"],
    ["q2", "two"],
  ]);
  expect(t.runner.idle()).toBe(true);
});

test("runner: the fork is asked with the fixed instructions, then the question, under the answer timeout", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  await t.asked(1);
  const p = await loadPrompts(path.join(modDir, "prompts"));
  expect(t.asks[0]!.ask.instructions).toBe(p.instructions);
  expect(p.instructions.endsWith("Reply with only the word: ready")).toBe(true);
  expect(t.asks[0]!.ask.request).toContain("A question from Bob:\n\nWhat was the coverage?");
  expect(t.asks[0]!.ask.timeoutMs).toBe(defaults.answerTimeoutSeconds * 1000);
});

test("runner: a secret in the answer is withheld, and the owner's release sends it", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  await t.asked(1);
  t.asks[0]!.settle(ok("The deploy key is AKIAABCDEFGHIJKLMNOP, in the vault."));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "withheld" }]);
  expect(t.logs.join("\n")).toContain('matches the secret pattern "AWS access key id"');
  // Asking again gets the same refusal, without a second fork.
  t.runner.take(question("q1"));
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "q1" });
  await t.sentN(3);
  expect(t.asks).toHaveLength(1);
  expect(t.sent.slice(1)).toEqual([
    { type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "withheld" },
    { type: "reply", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", answer: "The deploy key is AKIAABCDEFGHIJKLMNOP, in the vault." },
  ]);
  // Nothing held under an id is refused with the reason.
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "nope" });
  await t.sentN(4);
  expect(t.sent.at(-1)).toMatchObject({ id: "nope", reason: "unavailable", detail: expect.stringContaining("nothing is withheld") });
});

test("runner: a brief is scanned too, and carries the repos the handoff pushed", async () => {
  const repos: HandoffRepo[] = [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }];
  const t = await setup({ push: async () => repos });
  t.runner.take(brief("b1"));
  await t.asked(1);
  expect(t.asks[0]!.ask.request).toContain("Write the handoff brief now, for Bob");
  expect(t.asks[0]!.ask.timeoutMs).toBe(defaults.briefTimeoutSeconds * 1000);
  t.asks[0]!.settle(ok('Goal: ship. Set password: "hunter2hunter2" first.'));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "b1", reason: "withheld" }]);
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "b1" });
  await t.sentN(2);
  expect(t.sent[1]).toEqual({ type: "reply", v: PROTOCOL_VERSION, id: "b1", kind: "write-brief", handoff: { id: "h-1", brief: 'Goal: ship. Set password: "hunter2hunter2" first.', repos } });
});

test("runner: a brief is asked for with the untracked files named, ends with the note, and is pushed only once it clears the scan", async () => {
  const repos: HandoffRepo[] = [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }];
  const pushed: string[] = [];
  const t = await setup({ prepareBrief: async () => ({ files: [".env.local"], note: "Handed over by Isoplan on isoplan/handoff/h-1." }), push: async (_s, _l, h) => (pushed.push(h), repos) });
  t.runner.take(brief("b1"));
  await t.asked(1);
  expect(t.asks[0]!.ask.request).toContain("The untracked files are: `.env.local`. Say what each is for.");
  expect(pushed).toEqual([]);
  t.asks[0]!.settle(ok("Goal: ship. `.env.local` points the app at a local API."));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "reply", v: PROTOCOL_VERSION, id: "b1", kind: "write-brief", handoff: { id: "h-1", brief: "Goal: ship. `.env.local` points the app at a local API.\n\nHanded over by Isoplan on isoplan/handoff/h-1.", repos } }]);
  expect(pushed).toEqual(["h-1"]);
});

test("runner: a brief the fork can't write still goes, marked fallback, with the note; a push that fails is refused with its reason", async () => {
  const repos: HandoffRepo[] = [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }];
  const t = await setup({ prepareBrief: async () => ({ files: [], note: "The note." }), push: async () => repos });
  t.runner.take(brief("b1"));
  await t.asked(1);
  t.asks[0]!.settle({ ok: false, kind: "timed-out", detail: "no answer within 240 s", usage: null });
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "reply", v: PROTOCOL_VERSION, id: "b1", kind: "write-brief", fallback: true, handoff: { id: "h-1", brief: "No brief was written by the session: the fork took too long to answer.\n\nThe note.", repos } }]);

  const over = await setup({ settings: { answersPerMachinePerDay: 1 }, entries: [{ at: NOW - 1000, room: "a", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }], prepareBrief: async () => ({ files: [], note: "The note." }), push: async () => repos });
  over.runner.take(brief("b2"));
  await over.runner.settled();
  expect(over.asks).toEqual([]);
  expect(over.sent[0]).toMatchObject({ kind: "write-brief", fallback: true });

  const rejected = await setup({ push: async () => Promise.reject(new PushFailed("the remote rejected the handoff's branch")) });
  rejected.runner.take(brief("b3"));
  await rejected.asked(1);
  rejected.asks[0]!.settle(ok("Goal: ship."));
  await rejected.runner.settled();
  expect(rejected.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "b3", reason: "unavailable", detail: "the remote rejected the handoff's branch" }]);
});

test("runner: a handoff to take goes to take once at a time, and what it did goes back as taken", async () => {
  let finish: () => void = () => {};
  const taken: string[] = [];
  const t = await setup({
    take: async (h) => {
      taken.push(h.id);
      await new Promise<void>((r) => (finish = r));
      return { type: "taken", v: PROTOCOL_VERSION, handoff: h.id, session: "claude-code:new", failures: [] };
    },
  });
  const handoff: HandoffMessage = { type: "handoff", v: PROTOCOL_VERSION, handoff: { id: "h-1", brief: "b", repos: [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }] } };
  t.runner.take(handoff);
  t.runner.take(handoff);
  expect(taken).toEqual(["h-1"]);
  expect(t.runner.idle()).toBe(false);
  finish();
  await t.sentN(1);
  expect(t.sent).toEqual([{ type: "taken", v: PROTOCOL_VERSION, handoff: "h-1", session: "claude-code:new", failures: [] }]);
});

test("runner: without the handoff's push, a brief is refused before the fork runs", async () => {
  const t = await setup();
  t.runner.take(brief("b1"));
  await t.runner.settled();
  expect(t.asks).toEqual([]);
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "b1", reason: "unavailable", detail: "this plugin version can't hand a room over from the floor yet" }]);
});

test("runner: a session whose worktree was deleted is refused with the reason; its path stays in the local log", async () => {
  const t = await setup({ lead: { cwd: path.join(tempRoot(), "deleted-worktree") } });
  t.runner.take(question("q1"));
  await t.runner.settled();
  expect(t.asks).toEqual([]);
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "unavailable", detail: "the session's folder is gone, so its lead can't be asked" }]);
  expect(t.logs.join("\n")).toContain("deleted-worktree");
});

test("runner: a lead mid-turn, or a session this machine doesn't have, is refused; a compacted one is answered with a note", async () => {
  const busy = await setup({ lead: { working: true } });
  busy.runner.take(question("q1"));
  busy.runner.take(question("q2", "room-1", "codex:elsewhere"));
  await busy.runner.settled();
  expect(busy.sent.map((m) => m.type === "refusal" && m.reason === "unavailable" && m.detail)).toEqual(["the session's lead is mid-turn; ask again once its turn ends", "this machine has no such session"]);

  const compacted = await setup({ lead: { compacted: true } });
  compacted.runner.take(question("q1"));
  await compacted.asked(1);
  compacted.asks[0]!.settle(ok("79.16%."));
  await compacted.runner.settled();
  expect(compacted.sent).toEqual([{ type: "reply", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", answer: `${COMPACTED_NOTE}\n\n79.16%.` }]);
});

test("runner: the token budget refuses a request whose estimate would go over, counting cache reads and writes apart", async () => {
  // The budget is 5M; 100k context estimates 100k written (×2) and 200k read (×0.1), plus 2000 out (×5): 230k.
  const spent = (n: number): Entry => ({ at: NOW - 3600000, room: "other", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: n } });
  const under = await setup({ entries: [spent(2_385_000)] }); // 4.77M spent: 4.77M + 230k = 5M, not over
  under.runner.take(question("q1"));
  await under.asked(1);
  expect(under.asks).toHaveLength(1);

  const over = await setup({ entries: [spent(2_385_001)] });
  over.runner.take(question("q1"));
  await over.runner.settled();
  expect(over.asks).toEqual([]);
  expect(over.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "over-cap", cap: "owner-tokens" }]);

  // A day later the spend has rolled off.
  const later = await setup({ entries: [{ ...spent(2_385_001), at: NOW - 24 * 3600000 }] });
  later.runner.take(question("q1"));
  await later.asked(1);
  expect(later.asks).toHaveLength(1);
});

test("runner: what the fork used goes in the ledger, which a restarted runner reads back", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  await t.asked(1);
  t.asks[0]!.settle(ok("fine"));
  await t.runner.settled();
  expect((await openLedger(t.ledgerFile)).entries(NOW)).toEqual([{ at: NOW, room: "room-1", usage }]);
});

test("runner: answers per room per hour and per machine per day are capped", async () => {
  const at = (room: string, ago: number): Entry => ({ at: NOW - ago, room, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  const room = await setup({ settings: { answersPerRoomPerHour: 2 }, entries: [at("room-1", 1000), at("room-1", 2000), at("room-1", 3600001)] });
  room.runner.take(question("q1", "room-1"));
  room.runner.take(question("q2", "room-2"));
  await room.sentN(1);
  await room.asked(1);
  expect(room.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "over-cap", cap: "room-hour" }]);
  expect(room.asks).toHaveLength(1);

  const owner = await setup({ settings: { answersPerMachinePerDay: 2 }, entries: [at("a", 1000), at("b", 5 * 3600000)] });
  owner.runner.take(question("q1", "room-3"));
  await owner.runner.settled();
  expect(owner.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "over-cap", cap: "owner-day" }]);
});

test("runner: a failed fork is refused with its kind alone, the details logged, and still counted", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  t.runner.take(question("q2", "room-2"));
  await t.asked(2);
  t.askFor("q1")!.settle({ ok: false, kind: "timed-out", detail: "no answer within 120 s", usage: null });
  t.askFor("q2")!.settle({ ok: false, kind: "failed", detail: "turn 2 stopped with error_during_execution: AKIAABCDEFGHIJKLMNOP in C:/Users/ada/secret", usage });
  await t.runner.settled();
  expect(t.sent).toEqual([
    { type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "unavailable", detail: "the fork took too long to answer" },
    { type: "refusal", v: PROTOCOL_VERSION, id: "q2", reason: "unavailable", detail: "the fork couldn't answer" },
  ]);
  expect([...t.logs].sort()).toEqual(["q1: no answer within 120 s", expect.stringContaining("q2: turn 2 stopped")]);
});

test("runner: a reservation counts at once, so rooms answering together can't overshoot a machine cap", async () => {
  const t = await setup({ settings: { answersPerMachinePerDay: 2 } });
  for (const room of ["a", "b", "c"]) t.runner.take(question(`q-${room}`, room));
  await t.asked(2);
  await t.sentN(1);
  // Whichever room came third is refused; the other two run.
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: expect.stringMatching(/^q-/), reason: "over-cap", cap: "owner-day" }]);
  await new Promise((r) => setTimeout(r, 50));
  expect(t.asks).toHaveLength(2);
  // The token budget too: two leads whose estimates fit alone, but not together.
  const big = await setup({ lead: { context: 1_000_000 } }); // each estimates 2.21M against 5M
  for (const room of ["a", "b", "c"]) big.runner.take(question(`q-${room}`, room));
  await big.asked(2);
  await big.sentN(1);
  expect(big.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: expect.stringMatching(/^q-/), reason: "over-cap", cap: "owner-tokens" }]);
  await new Promise((r) => setTimeout(r, 50));
  expect(big.asks).toHaveLength(2);
});

test("runner: a release that arrives while its answer is being written is applied when it lands", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  await t.asked(1);
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "q1" });
  t.asks[0]!.settle(ok("The key is AKIAABCDEFGHIJKLMNOP."));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "reply", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", answer: "The key is AKIAABCDEFGHIJKLMNOP." }]);
  // A release doesn't carry over to a later answer under another id.
  t.runner.take(question("q2"));
  await t.asked(2);
  t.asks[1]!.settle(ok("The key is AKIAABCDEFGHIJKLMNOP."));
  await t.runner.settled();
  expect(t.sent[1]).toEqual({ type: "refusal", v: PROTOCOL_VERSION, id: "q2", reason: "withheld" });
});

test("runner: at most MAX_HELD replies are held; the oldest goes first", async () => {
  const t = await setup({ settings: { answersPerRoomPerHour: 1000, answersPerMachinePerDay: 1000, tokenBudgetPerMachinePerDay: 1e12 } });
  for (let i = 0; i <= MAX_HELD; i++) {
    t.runner.take(question(`q${i}`, `room-${i}`));
    await t.asked(i + 1);
    t.asks[i]!.settle(ok("AKIAABCDEFGHIJKLMNOP"));
  }
  await t.runner.settled();
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "q0" });
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: `q${MAX_HELD}` });
  await t.sentN(MAX_HELD + 3);
  expect(t.sent.slice(-2)).toEqual([
    { type: "refusal", v: PROTOCOL_VERSION, id: "q0", reason: "unavailable", detail: `its withheld reply was dropped to make room: more than ${MAX_HELD} were held at once, so ask again` },
    { type: "reply", v: PROTOCOL_VERSION, id: `q${MAX_HELD}`, kind: "answer-question", answer: "AKIAABCDEFGHIJKLMNOP" },
  ]);
});

test("runner: the ledger entry of an unmetered failure keeps its estimate", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  await t.asked(1);
  t.asks[0]!.settle({ ok: false, kind: "timed-out", detail: "no answer within 120 s", usage: null });
  await t.runner.settled();
  // Unmetered, it counts at its estimate.
  expect(t.ledger.entries(NOW)).toEqual([{ at: NOW, room: "room-1", usage: { input: 0, output: 2000, cacheWrite: 100000, cacheRead: 200000 } }]);
});

test("runner: a fork that couldn't be started gives its answer and tokens back", async () => {
  const t = await setup({ settings: { answersPerMachinePerDay: 1 } });
  t.runner.take(question("q1"));
  await t.asked(1);
  t.asks[0]!.settle({ ok: false, kind: "not-set-up", detail: "the claude binary wasn't found", usage: null });
  await t.runner.settled();
  expect(t.sent[0]).toMatchObject({ id: "q1", reason: "unavailable", detail: expect.stringContaining("can't run the fork") });
  expect(t.ledger.entries(NOW)).toEqual([]);
  // The one answer the day allows is still there.
  t.runner.take(question("q2"));
  await t.asked(2);
});

test("runner: at most maxForks run at once across rooms; the rest wait, their timeout not yet running", async () => {
  const t = await setup({ settings: { maxForks: 2 } });
  for (const room of ["a", "b", "c"]) t.runner.take(question(`q-${room}`, room));
  await t.asked(2);
  await new Promise((r) => setTimeout(r, 50));
  expect(t.asks).toHaveLength(2);
  t.asks[0]!.settle(ok("one"));
  await t.asked(3);
  expect(t.asks[2]!.ask.timeoutMs).toBe(defaults.answerTimeoutSeconds * 1000);
  t.asks[1]!.settle(ok("two"));
  t.asks[2]!.settle(ok("three"));
  await t.runner.settled();
  expect(t.sent).toHaveLength(3);
});

test("runner: a session this machine doesn't report isn't answered for, whatever the server asks", async () => {
  const seen: string[] = [];
  const t = await setup({ isReported: async (session) => (seen.push(session), false) });
  t.runner.take(question("q1", "room-1", "claude-code:not-reported"));
  await t.runner.settled();
  expect(t.asks).toEqual([]);
  expect(seen).toEqual(["claude-code:not-reported"]);
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "unavailable", detail: "this machine doesn't report that session" }]);
});

test("runner: an owner's answer isn't the runner's; a handoff to take is logged", async () => {
  const t = await setup();
  t.runner.take({ type: "request", v: PROTOCOL_VERSION, id: "o1", kind: "owner-answer", session: "claude-code:s", question: "q", answers: {} });
  t.runner.take({ type: "handoff", v: PROTOCOL_VERSION, handoff: { id: "h-1", brief: "b", repos: [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }] } });
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "o1", reason: "unavailable", detail: "an owner's answer goes to the live session, not the runner" }]);
  expect(t.logs).toEqual([expect.stringContaining("handoff h-1")]);
});

test("runner.json: the labelled defaults load, and the owner's file overrides them per key", async () => {
  const user = path.join(tempRoot(), "runner.json");
  fs.writeFileSync(user, JSON.stringify({ claudeModel: "sonnet", answersPerRoomPerHour: 3, tokenBudgetPerMachinePerDay: -1 }));
  const s = await loadSettings<RunnerSettings & { claudeModel: string }>(nodeIo(), path.join(modDir, "runner.json"), user);
  expect(defaults).toMatchObject({ claudeModel: "opus" });
  expect(s).toEqual({ ...defaults, claudeModel: "sonnet", answersPerRoomPerHour: 3 });
});

test("secret patterns: the owner's file adds patterns", async () => {
  const owner = path.join(tempRoot(), "secret-patterns.json");
  fs.writeFileSync(owner, JSON.stringify({ patterns: [{ name: "internal host", regex: "corp\.internal" }] }));
  const logs: string[] = [];
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), owner, (t) => logs.push(t));
  expect(scan("db at build.corp.internal", patterns)).toBe("internal host");
  expect(scan("-----BEGIN OPENSSH PRIVATE KEY-----", patterns)).toBe("private key");
  expect(scan("Coverage was 79.16% against an 80% floor, on handover-polish.", patterns)).toBe(null);
  expect(logs).toEqual([]);
});

test("secret patterns: an owner's file that can't be used makes them unreadable, so everything is held, with the reason logged", async () => {
  const dir = tempRoot();
  const cases: [string, string | null, string][] = [
    ["broken.json", JSON.stringify({ patterns: [{ name: "internal host", regex: "corp" }, { name: "broken", regex: "(" }] }), `"broken" doesn't compile`],
    ["global.json", JSON.stringify({ patterns: [{ name: "global", regex: "x", flags: "g" }] }), 'flags "g"'],
    ["not-json.json", "{ patterns: ", "JSON"],
    ["no-list.json", JSON.stringify({ pattern: [] }), 'no "patterns" list'],
    // A folder where the file should be: a read error other than a missing file, as a locked or unreadable file is.
    ["folder.json", null, "EISDIR"],
  ];
  for (const [name, text, reason] of cases) {
    const file = path.join(dir, name);
    if (text === null) fs.mkdirSync(file);
    else fs.writeFileSync(file, text);
    const logs: string[] = [];
    const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), file, (t) => logs.push(t));
    expect(patterns, name).toBe(null);
    expect(scan("Coverage was 79.16%.", patterns), name).toBe(UNREADABLE);
    expect(logs, name).toHaveLength(1);
    expect(logs[0], name).toContain("can't be used, so every answer, brief and report is held: ");
    expect(logs[0], name).toContain(reason);
  }
});

test("runner: with the secret patterns unreadable, an answer is refused withheld", async () => {
  const t = await setup({ scan: async (text) => scan(text, null) });
  t.runner.take(question("q1"));
  await t.asked(1);
  t.asks[0]!.settle(ok("Coverage is 81%."));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "withheld" }]);
});
