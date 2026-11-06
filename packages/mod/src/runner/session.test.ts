import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { MAX_TOOL_NAME_LENGTH, PROTOCOL_VERSION, type DriveMessage, type DrivenMessage } from "@isoplan/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { alive } from "../wake/lock.js";
import type { Spawn } from "./claude.js";
import { createRegistry, registryPath, type ProcessRecord } from "./registry.js";
import { loadPatterns, scan } from "./scan.js";
import { createDriver, drivenArgs, type DriveSettings } from "./session.js";

// Each test starts real (fake) claude processes, which is slow on Windows under load.
vi.setConfig({ testTimeout: 30000 });

// A fake AWS key id, split so no key-shaped string sits in the source.
const AWS_KEY = "AKIA" + "ABCDEFGHIJKLMNOP";
const SERVER = "wss://office.example";
const ADA = { id: "claude:ada", name: "Ada" };
const PROJECT = { id: "github.com/ada/app", name: "app" };
const UUIDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const SETTINGS: DriveSettings = { drivenIdleMinutes: 30, drivenPerProject: 4, drivenCloseSeconds: 5, drivenStartSeconds: 20 };

// A stand-in for `claude -p --input-format stream-json --output-format stream-json`, shaped as the
// probe in session.ts found it: it logs its argv and folder, then answers each user line with a
// `system` init and one `result`. The words of the instruction pick what else it does. A --resume of
// a session it has no transcript of fails as Claude Code does. Stdin's end ends it, unless
// FAKE_LINGER is set.
const FAKE = `
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
const state = process.env.FAKE_STATE;
const log = (x) => fs.appendFileSync(path.join(state, "log.jsonl"), JSON.stringify(x) + "\\n");
const out = (x) => process.stdout.write(JSON.stringify(x) + "\\n");
const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const id = flag("--resume") ?? flag("--session-id");
const transcript = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", "fake", id + ".jsonl");
const missing = flag("--resume") !== undefined && !fs.existsSync(transcript);
log({ argv: args, cwd: process.cwd(), pid: process.pid, grandchild: spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }).pid });
let buf = "";
process.stdin.setEncoding("utf8").on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const text = JSON.parse(buf.slice(0, i)).message.content[0].text;
    buf = buf.slice(i + 1);
    log({ turn: text });
    if (missing) {
      process.stderr.write("No conversation found with session ID: " + id + "\\n");
      out({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, session_id: id, errors: ["No conversation found with session ID: " + id] });
      setTimeout(() => process.exit(1), 20);
      continue;
    }
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(transcript, "");
    if (text.includes("silent")) continue;
    out({ type: "system", subtype: "init", session_id: id });
    if (text.startsWith("/")) {
      // One of Claude Code's own commands: no turn of the model's, a result with num_turns 0 and local_command.
      const said = "Total cost: $0.00 (" + text.slice(1) + ")";
      out({ type: "assistant", parent_tool_use_id: null, local_command_source: text.slice(1), message: { model: "<synthetic>", content: [{ type: "text", text: said }] } });
      out({ type: "result", subtype: "success", is_error: false, num_turns: 0, result: said, local_command: text.slice(1), session_id: id });
      continue;
    }
    if (text.includes("hang")) continue;
    if (text.includes("crash")) { setTimeout(() => process.exit(3), 20); continue; }
    const secretName = "mcp__keys-" + process.env.FAKE_KEY;
    if (text.includes("tool")) {
      const name = text.includes("long") ? "mcp__" + "x".repeat(300) : text.includes("named") ? secretName : "Bash";
      out({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name, input: { command: "echo hi", description: text.includes("leak") ? "Use " + process.env.FAKE_KEY : "Say hi" } }] } });
      out({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "hi" }] } });
    }
    if (text.includes("deny")) out({ type: "system", subtype: "permission_denied", tool_name: text.includes("named") ? secretName : "Write", tool_use_id: "t2", message: "not granted" });
    out({ type: "result", subtype: "success", is_error: false, num_turns: 0, result: "", session_id: id });
    const reply = text.includes("leak") ? "The key is " + process.env.FAKE_KEY : "Done: " + text;
    out({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: reply }] } });
    out({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: reply, session_id: id });
  }
}).on("end", () => {
  log({ closed: true });
  if (process.env.FAKE_LINGER) setInterval(() => {}, 1000);
  else process.exit(0);
});
`;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

type Kind = DrivenMessage["kind"];
type Of<K extends Kind> = Extract<DrivenMessage, { kind: K }>;

async function setUp({ settings = {}, linger = false, records = [] as ProcessRecord[], spawn }: { settings?: Partial<DriveSettings>; linger?: boolean; records?: ProcessRecord[]; spawn?: Spawn } = {}) {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const state = path.join(root, "state");
  fs.mkdirSync(state, { recursive: true });
  const bin = path.join(root, "fake-claude.js");
  fs.writeFileSync(bin, FAKE);
  const folder = path.join(root, "app");
  fs.mkdirSync(folder);
  const file = registryPath(claudeDir);
  if (records.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, processes: records }));
  }
  const logs: string[] = [];
  const log = (t: string) => void logs.push(t);
  const registry = createRegistry({ file, log });
  await registry.restore();
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(root, "none.json"), log);
  const sent: DrivenMessage[] = [];
  const link = { up: true };
  const ids = [...UUIDS];
  const current = { ...SETTINGS, ...settings };
  const driver = createDriver({
    claudeDir,
    account: { id: ADA.id },
    offices: [{ server: SERVER, send: (m) => (link.up ? (sent.push(m), true) : false), folder: async (sessions) => (sessions.includes("claude-code:room-1") ? folder : null) }],
    registry,
    binary: async () => bin,
    settings: async () => current,
    scan: async (text) => scan(text, patterns),
    log,
    projectOf: async () => PROJECT.id,
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, FAKE_STATE: state, FAKE_KEY: AWS_KEY, ...(linger ? { FAKE_LINGER: "1" } : {}) },
    newId: () => ids.shift()!,
    ...(spawn ? { spawn } : {}),
  });
  const fakeLog = () => (fs.existsSync(path.join(state, "log.jsonl")) ? fs.readFileSync(path.join(state, "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  // Every process the fake started ends with the test.
  cleanups.push(() => {
    driver.close();
    for (const l of fakeLog()) for (const pid of [l.pid, l.grandchild]) if (pid && alive(pid)) process.kill(pid);
  });
  const drive = (m: Record<string, unknown>) => driver.take(SERVER, { type: "drive", v: PROTOCOL_VERSION, by: ADA, ...m } as DriveMessage);
  const until = async (check: () => boolean, ms = 15000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error(`timed out; sent: ${JSON.stringify(sent.map((m) => m.kind))}`);
      await new Promise((r) => setTimeout(r, 10));
    }
    await driver.settled();
  };
  const of = <K extends Kind>(kind: K) => sent.filter((m): m is Of<K> => m.kind === kind);
  const saved = () => JSON.parse(fs.readFileSync(file, "utf8")) as { version: number; runner: number; processes: ProcessRecord[] };
  return { root, claudeDir, state, bin, folder, file, driver, registry, sent, link, logs, current, drive, until, of, fakeLog, saved };
}

const start = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "start", room: "room-1", project: PROJECT, roomSessions: ["claude-code:gone", "claude-code:room-1"], permissions: "auto", ...extra });
const S1 = `claude-code:${UUIDS[0]}`;

test("start: a new session in the folder the room's session ran in, its turn's tool, reply and end going out in order, and the registry recording its process", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "use a tool" }));
  await t.until(() => t.of("turn-ended").length === 1);
  expect(t.sent).toEqual([
    { type: "driven", v: 1, kind: "started", id: "d1", session: S1, room: "room-1", permissions: "auto" },
    { type: "driven", v: 1, kind: "held", session: S1, room: "room-1", why: "started", permissions: "auto" },
    { type: "driven", v: 1, kind: "turn-started", session: S1, turn: "d1" },
    { type: "driven", v: 1, kind: "tool", session: S1, turn: "d1", tool: "Bash", summary: "Say hi" },
    { type: "driven", v: 1, kind: "reply", session: S1, turn: "d1", text: "Done: use a tool" },
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d1", outcome: "done" },
  ]);
  const [first] = t.fakeLog();
  expect(first.argv).toEqual(drivenArgs({ uuid: UUIDS[0]!, resume: false, permissions: "auto" }));
  expect(first.argv).toEqual(["-p", "--session-id", UUIDS[0], "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode", "auto", "--permission-prompts", "none"]);
  expect(fs.realpathSync(first.cwd)).toBe(fs.realpathSync(t.folder));
  await t.registry.flushed();
  const saved = t.saved();
  expect(saved).toMatchObject({ version: 1, runner: process.pid });
  expect(saved.processes).toEqual([
    {
      kind: "driven",
      pid: first.pid,
      spawned: expect.any(String),
      session: S1,
      folder: t.folder,
      started: expect.any(String),
      lastActivity: expect.any(String),
      state: "idle",
      driven: { room: "room-1", project: "github.com/ada/app", office: SERVER, owner: ADA.id, permissions: "auto", transcript: true },
    },
  ]);
});

test("start: no folder of the room's sessions here is no-folder, a person other than the runner's own is not-owner, and an answer finds no prompt", async () => {
  const t = await setUp();
  t.drive(start("d1", { roomSessions: ["claude-code:elsewhere"] }));
  t.driver.take(SERVER, { type: "drive", v: 1, id: "d2", by: { id: "claude:bob", name: "Bob" }, kind: "start", room: "room-1", project: PROJECT, permissions: "auto" });
  await t.until(() => t.sent.length === 2);
  expect(t.of("refused")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "d1", reason: "no-folder", detail: expect.stringContaining("no folder for this room") }),
      { type: "driven", v: 1, kind: "refused", id: "d2", reason: "not-owner" },
    ]),
  );
  t.drive(start("d3"));
  await t.until(() => t.of("held").length === 1);
  t.drive({ id: "d4", kind: "answer", session: S1, prompt: "p1", answer: "allow" });
  t.drive({ id: "d5", kind: "instruct", session: "claude-code:unknown", text: "hi" });
  t.driver.take(SERVER, { type: "drive", v: 1, id: "d6", by: { id: "claude:bob", name: "Bob" }, kind: "stop", session: S1 });
  await t.until(() => t.of("refused").length === 5);
  expect(t.of("refused").slice(2).map((m) => [m.id, m.reason])).toEqual([
    ["d4", "no-prompt"],
    ["d5", "not-found"],
    ["d6", "not-owner"],
  ]);
  // Only d3 started a process.
  await t.until(() => t.fakeLog().some((l) => l.argv));
  expect(t.fakeLog().filter((l) => l.argv)).toHaveLength(1);
});

test("instruct: the next instruction goes to the same process; one while a turn runs is busy; stop ends the process and its tree mid-turn", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "first" }));
  await t.until(() => t.of("turn-ended").length === 1);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "now hang" });
  await t.until(() => t.fakeLog().some((l) => l.turn === "now hang"));
  t.drive({ id: "d3", kind: "instruct", session: S1, text: "again" });
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "d3", reason: "busy" });
  const [{ pid, grandchild }] = t.fakeLog();
  t.drive({ id: "d4", kind: "stop", session: S1 });
  await t.until(() => t.of("released").length === 1);
  expect(t.sent.slice(-2)).toEqual([
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d2", outcome: "stopped" },
    { type: "driven", v: 1, kind: "released", session: S1, why: "stopped", id: "d4" },
  ]);
  // One process took both turns.
  expect(t.fakeLog().filter((l) => l.argv)).toHaveLength(1);
  expect(t.fakeLog().filter((l) => l.turn).map((l) => l.turn)).toEqual(["first", "now hang"]);
  for (let i = 0; i < 100 && (alive(pid) || alive(grandchild)); i++) await new Promise((r) => setTimeout(r, 50));
  expect([alive(pid), alive(grandchild)]).toEqual([false, false]);
  await t.registry.flushed();
  expect(t.saved().processes).toMatchObject([{ session: S1, pid: null, spawned: null, state: "closed" }]);
});

test("output: a turn's full output from memory, and the whole session's from its transcript, as plain text", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "use a tool" }));
  await t.until(() => t.of("turn-ended").length === 1);
  t.drive({ id: "o1", kind: "output", session: S1, turn: "d1" });
  await t.until(() => t.of("output").length === 1);
  expect(t.of("output")[0]).toEqual({ type: "driven", v: 1, kind: "output", id: "o1", session: S1, turn: "d1", text: "> use a tool\n[Bash] Say hi\nhi\nDone: use a tool" });
  // The whole session comes from Claude Code's transcript, where it keeps the session for its folder.
  const dir = path.join(t.claudeDir, "projects", t.folder.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    { type: "user", message: { role: "user", content: "Earlier, in the terminal" } },
    { type: "assistant", message: { content: [{ type: "text", text: "Sure." }] } },
    { type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "a subagent's own" }] } },
    { type: "summary", summary: "not a message" },
  ];
  fs.writeFileSync(path.join(dir, `${UUIDS[0]}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  t.drive({ id: "o2", kind: "output", session: S1 });
  t.drive({ id: "o3", kind: "output", session: S1, turn: "never" });
  await t.until(() => t.of("output").length === 2 && t.of("refused").length === 1);
  expect(t.of("output")[1]).toEqual({ type: "driven", v: 1, kind: "output", id: "o2", session: S1, text: "> Earlier, in the terminal\nSure." });
  expect(t.of("refused")[0]).toMatchObject({ id: "o3", reason: "unavailable", detail: expect.stringContaining("no longer has that instruction's output") });
});

test("scan: a reply that may hold a secret is held back with an id, a tool whose summary or name may goes with neither, and only the owner's release sends the reply", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "use a tool and leak" }));
  await t.until(() => t.of("turn-ended").length === 1);
  expect(JSON.stringify(t.sent)).not.toContain(AWS_KEY);
  expect(t.of("tool")).toEqual([{ type: "driven", v: 1, kind: "tool", session: S1, turn: "d1", tool: "tool", withheld: true }]);
  const [reply] = t.of("reply");
  expect(reply).toMatchObject({ turn: "d1", text: expect.stringContaining("Held back on this computer"), withheld: { id: expect.any(String) } });
  t.driver.take(SERVER, { type: "drive", v: 1, id: "r0", by: { id: "claude:bob", name: "Bob" }, kind: "release", session: S1, withheld: reply!.withheld!.id });
  t.drive({ id: "r1", kind: "release", session: S1, withheld: reply!.withheld!.id });
  t.drive({ id: "r2", kind: "release", session: S1, withheld: reply!.withheld!.id });
  await t.until(() => t.of("refused").length === 2 && t.of("output").length === 1);
  expect(t.of("output")).toEqual([{ type: "driven", v: 1, kind: "output", id: "r1", session: S1, turn: "d1", text: `The key is ${AWS_KEY}` }]);
  expect(t.of("refused").map((m) => [m.id, m.reason])).toEqual([
    ["r0", "not-owner"],
    ["r2", "not-found"],
  ]);
  // An output that may hold one is held back the same way.
  t.drive({ id: "o1", kind: "output", session: S1, turn: "d1" });
  await t.until(() => t.of("output").length === 2);
  expect(t.of("output")[1]).toMatchObject({ id: "o1", withheld: { id: expect.any(String) } });
  expect(t.logs.filter((l) => l.startsWith("withheld"))).toHaveLength(2);
  // A tool named with one (an MCP server names its own tools), used, and then not allowed.
  const before = t.sent.length;
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "use a named tool, then deny" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(JSON.stringify(t.sent.slice(before))).not.toContain(AWS_KEY);
  expect(t.of("tool")[1]).toEqual({ type: "driven", v: 1, kind: "tool", session: S1, turn: "d2", tool: "tool", withheld: true });
  expect(t.of("error")).toEqual([{ type: "driven", v: 1, kind: "error", session: S1, turn: "d2", text: expect.stringContaining("wanted to use a tool, which needs your permission") }]);
});

test("scan: a whole session's output held back is kept as its release sends it, within the protocol's limit and marked cut when its transcript was", async () => {
  const t = await setUp();
  t.drive(start("d1"));
  await t.until(() => t.of("held").length === 1);
  // A transcript longer than the end read for an output, whose last words hold a secret.
  const dir = path.join(t.claudeDir, "projects", t.folder.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  const lines = [{ type: "summary", summary: "x".repeat(4.5 * 1024 * 1024) }, { type: "user", message: { role: "user", content: `The key is ${AWS_KEY}` } }];
  fs.writeFileSync(path.join(dir, `${UUIDS[0]}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  t.drive({ id: "o1", kind: "output", session: S1 });
  await t.until(() => t.of("output").length === 1);
  const [held] = t.of("output");
  expect(held).toMatchObject({ id: "o1", withheld: { id: expect.any(String) } });
  t.drive({ id: "r1", kind: "release", session: S1, withheld: held!.withheld!.id });
  await t.until(() => t.of("output").length === 2);
  expect(t.of("output")[1]).toEqual({ type: "driven", v: 1, kind: "output", id: "r1", session: S1, text: `> The key is ${AWS_KEY}`, cut: true });
});

test("a Claude Code command as an instruction: its result, with no turn of the model's, ends the instruction, and the next one runs", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "/cost" }));
  await t.until(() => t.of("turn-ended").length === 1);
  expect(t.sent.slice(2)).toEqual([
    { type: "driven", v: 1, kind: "turn-started", session: S1, turn: "d1" },
    { type: "driven", v: 1, kind: "reply", session: S1, turn: "d1", text: "Total cost: $0.00 (cost)" },
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d1", outcome: "done" },
  ]);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "next" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("refused")).toEqual([]);
  expect(t.of("reply").map((m) => m.text)).toEqual(["Total cost: $0.00 (cost)", "Done: next"]);
});

test("bounds: a tool name past the protocol's limit is cut to fit, and a prompt that wasn't allowed is said in plain words", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "use a long tool, then deny" }));
  await t.until(() => t.of("turn-ended").length === 1);
  expect(t.of("tool")[0]!.tool).toHaveLength(MAX_TOOL_NAME_LENGTH);
  expect(t.of("error")).toEqual([{ type: "driven", v: 1, kind: "error", session: S1, turn: "d1", text: expect.stringContaining("wanted to use Write, which needs your permission") }]);
});

test("hand back: stdin closes, the process ends by itself, the command and folder come back, and the session is forgotten here", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "first" }));
  await t.until(() => t.of("turn-ended").length === 1);
  t.drive({ id: "h1", kind: "hand-back", session: S1 });
  await t.until(() => t.of("handed-back").length === 1);
  expect(t.sent.slice(-2)).toEqual([
    { type: "driven", v: 1, kind: "released", session: S1, why: "handed-back", id: "h1" },
    { type: "driven", v: 1, kind: "handed-back", id: "h1", session: S1, command: `claude --resume ${UUIDS[0]}`, folder: t.folder },
  ]);
  expect(t.fakeLog().at(-1)).toEqual({ closed: true });
  await t.registry.flushed();
  expect(t.saved().processes).toEqual([]);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "more" });
  t.driver.linked(SERVER);
  await t.until(() => t.of("refused").length === 1 && t.of("holding").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "d2", reason: "not-found" });
  expect(t.of("holding")[0]!.sessions).toEqual([]);
});

test("hand back: a process that doesn't end within drivenCloseSeconds is ended, its running turn stopped", async () => {
  const t = await setUp({ linger: true, settings: { drivenCloseSeconds: 0.3 } });
  t.drive(start("d1", { instruction: "hang" }));
  await t.until(() => t.fakeLog().some((l) => l.turn === "hang"));
  t.drive({ id: "h1", kind: "hand-back", session: S1 });
  await t.until(() => t.of("handed-back").length === 1);
  expect(t.sent.map((m) => m.kind).slice(-3)).toEqual(["turn-ended", "released", "handed-back"]);
  expect(t.of("turn-ended")[0]).toMatchObject({ outcome: "stopped" });
  expect(t.logs.some((l) => l.includes("didn't end within 0.3 s"))).toBe(true);
  expect(alive(t.fakeLog()[0].pid)).toBe(false);
});

test("stop and hand back: a process that won't close keeps the session held and in the registry, and the request is refused unavailable to try again", async () => {
  // A process that answers nothing and never closes, however it is asked to. It has no pid, so
  // ending it is a no-op here.
  const stuck: Spawn = () => Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: undefined, exitCode: null, signalCode: null, kill: () => true }) as unknown as ChildProcessWithoutNullStreams;
  const t = await setUp({ spawn: stuck });
  t.drive(start("d1"));
  await t.until(() => t.of("held").length === 1);
  // The 10 s a stopped process gets, and drivenCloseSeconds then 10 s for one handed back, pass at once.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    t.drive({ id: "s1", kind: "stop", session: S1 });
    t.drive({ id: "h1", kind: "hand-back", session: S1 });
    await vi.advanceTimersByTimeAsync(10000 + SETTINGS.drivenCloseSeconds * 1000 + 10000 + 1000);
  } finally {
    vi.useRealTimers();
  }
  await t.driver.settled();
  expect(t.of("refused")).toEqual([
    { type: "driven", v: 1, kind: "refused", id: "s1", reason: "unavailable", detail: expect.stringContaining("couldn't be closed for this session on this computer") },
    { type: "driven", v: 1, kind: "refused", id: "h1", reason: "unavailable", detail: expect.stringContaining("couldn't be closed for this session on this computer") },
  ]);
  expect([t.of("released"), t.of("handed-back")]).toEqual([[], []]);
  expect(t.driver.held()).toBe(1);
  expect(t.logs.filter((l) => l.includes("so it is still held"))).toHaveLength(2);
  await t.registry.flushed();
  expect(t.saved().processes).toMatchObject([{ session: S1, state: "idle" }]);
  t.driver.linked(SERVER);
  expect(t.of("holding")[0]!.sessions).toEqual([{ session: S1, room: "room-1", held: true, permissions: "auto" }]);
});

test("idle: a process with nothing happening for drivenIdleMinutes is closed; the next instruction opens the session again with --resume", async () => {
  const t = await setUp({ settings: { drivenIdleMinutes: 0.005 } });
  t.drive(start("d1", { instruction: "first" }));
  await t.until(() => t.of("released").length === 1);
  expect(t.of("released")[0]).toEqual({ type: "driven", v: 1, kind: "released", session: S1, why: "idle-closed" });
  expect(t.fakeLog().some((l) => l.closed)).toBe(true);
  t.current.drivenIdleMinutes = 30;
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "second" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("held").map((m) => m.why)).toEqual(["started", "reopened"]);
  const opened = t.fakeLog().filter((l) => l.argv);
  expect(opened[1].argv.slice(0, 3)).toEqual(["-p", "--resume", UUIDS[0]]);
  expect(t.of("reply").map((m) => m.text)).toEqual(["Done: first", "Done: second"]);
});

test("cap: a start or a reopen past drivenPerProject held sessions in the project is refused cap-reached, with the limit", async () => {
  const t = await setUp({ settings: { drivenPerProject: 1 } });
  t.drive(start("d1"));
  await t.until(() => t.of("held").length === 1);
  t.drive(start("d2"));
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "d2", reason: "cap-reached", limit: 1, detail: expect.stringContaining("already has 1 sessions") });
  t.drive({ id: "s1", kind: "stop", session: S1 });
  await t.until(() => t.of("released").length === 1);
  t.drive(start("d3"));
  await t.until(() => t.of("held").length === 2);
  t.drive({ id: "d4", kind: "instruct", session: S1, text: "reopen me" });
  await t.until(() => t.of("refused").length === 2);
  expect(t.of("refused")[1]).toMatchObject({ id: "d4", reason: "cap-reached", limit: 1 });
  expect(t.driver.held()).toBe(1);
});

test("cap: a drivenPerProject that isn't a whole number counts as the whole number below it, at least one, so the refusal fits the protocol", async () => {
  const t = await setUp({ settings: { drivenPerProject: 1.5 } });
  t.drive(start("d1"));
  await t.until(() => t.of("held").length === 1);
  t.drive(start("d2"));
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "d2", reason: "cap-reached", limit: 1, detail: expect.stringContaining("already has 1 sessions") });
  expect(t.driver.held()).toBe(1);
});

test("crash: a process that ends by itself mid-turn fails the turn and is released crashed; the next instruction opens it again", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "crash now" }));
  await t.until(() => t.of("released").length === 1);
  expect(t.sent.slice(-3)).toEqual([
    { type: "driven", v: 1, kind: "error", session: S1, turn: "d1", text: expect.stringContaining("stopped running for this session unexpectedly") },
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d1", outcome: "failed" },
    { type: "driven", v: 1, kind: "released", session: S1, why: "crashed" },
  ]);
  await t.registry.flushed();
  expect(t.saved().processes).toMatchObject([{ session: S1, pid: null, state: "closed" }]);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "again" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("held").map((m) => m.why)).toEqual(["started", "reopened"]);
  // No turn ended before the crash, but Claude Code had saved the conversation: it is resumed.
  expect(t.fakeLog().filter((l) => l.argv)[1].argv.slice(0, 3)).toEqual(["-p", "--resume", UUIDS[0]]);
});

test("timeout: a process that writes nothing within drivenStartSeconds of an instruction is ended as stuck", async () => {
  const t = await setUp({ settings: { drivenStartSeconds: 0.3 } });
  t.drive(start("d1", { instruction: "stay silent" }));
  await t.until(() => t.of("released").length === 1);
  expect(t.of("error")[0]).toMatchObject({ turn: "d1", text: expect.stringContaining("didn't start on the instruction within 0.3 seconds") });
  expect(t.of("turn-ended")[0]).toMatchObject({ outcome: "failed" });
  expect(t.of("released")[0]).toMatchObject({ why: "crashed" });
});

test("restart: a recorded process still Isoplan's is ended and its session opened again with --resume as restored; one that can't be shown to be Isoplan's is left running", async () => {
  // Stand-ins for what an earlier run left: processes whose command lines name their session.
  const left = (uuid: string) => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", "--resume", uuid], { stdio: "ignore", windowsHide: true, detached: process.platform !== "win32" });
    cleanups.push(() => child.pid && alive(child.pid) && process.kill(child.pid));
    return child.pid!;
  };
  const at = new Date().toISOString();
  const long = new Date(Date.now() - 3600000).toISOString();
  const driven = (uuid: string, pid: number | null, spawned: string | null, extra: Partial<ProcessRecord["driven"]> = {}): ProcessRecord => ({
    kind: "driven",
    pid,
    spawned,
    session: `claude-code:${uuid}`,
    folder: "",
    started: long,
    lastActivity: at,
    state: "working",
    driven: { room: "room-1", project: PROJECT.id, office: SERVER, owner: ADA.id, permissions: "auto", transcript: true, ...extra },
  });
  const ours = left(UUIDS[1]!);
  const reused = left(UUIDS[2]!);
  const fork = left("44444444-4444-4444-8444-444444444444");
  await new Promise((r) => setTimeout(r, 300));
  const t = await setUp({
    records: [
      driven(UUIDS[1]!, ours, at),
      // Live, but started an hour before the record says: another process has that pid now.
      driven(UUIDS[2]!, reused, long, { owner: "claude:someone-else" }),
      { kind: "fork", pid: fork, spawned: at, session: "claude-code:44444444-4444-4444-8444-444444444444", folder: "", started: at, lastActivity: at, state: "working" },
    ],
  });
  for (let i = 0; i < 100 && (alive(ours) || alive(fork)); i++) await new Promise((r) => setTimeout(r, 50));
  expect([alive(ours), alive(reused), alive(fork)]).toEqual([false, true, false]);
  expect(t.logs.some((l) => l.includes(`left process ${reused} running`))).toBe(true);
  expect(t.saved().processes.map((r) => [r.kind, r.session, r.pid])).toEqual([
    ["driven", `claude-code:${UUIDS[1]}`, null],
    ["driven", `claude-code:${UUIDS[2]}`, null],
  ]);
  t.driver.linked(SERVER);
  expect(t.of("holding")[0]!.sessions).toEqual([
    { session: `claude-code:${UUIDS[1]}`, room: "room-1", held: false, permissions: "auto" },
    { session: `claude-code:${UUIDS[2]}`, room: "room-1", held: false, permissions: "auto" },
  ]);
  // Its transcript is there, so it opens with --resume, in its folder.
  fs.mkdirSync(path.join(t.claudeDir, "projects", "fake"), { recursive: true });
  fs.writeFileSync(path.join(t.claudeDir, "projects", "fake", `${UUIDS[1]}.jsonl`), "");
  t.registry.put({ ...t.registry.list()[0]!, folder: t.folder });
  t.driver.close();
  const again = createDriver({
    claudeDir: t.claudeDir,
    account: { id: ADA.id },
    offices: [{ server: SERVER, send: (m) => (t.sent.push(m), true), folder: async () => null }],
    registry: t.registry,
    binary: async () => t.bin,
    settings: async () => SETTINGS,
    scan: async () => null,
    log: () => {},
    projectOf: async () => PROJECT.id,
    env: { ...process.env, CLAUDE_CONFIG_DIR: t.claudeDir, FAKE_STATE: t.state },
  });
  cleanups.push(() => again.close());
  again.take(SERVER, { type: "drive", v: 1, id: "d1", by: ADA, kind: "instruct", session: `claude-code:${UUIDS[1]}`, text: "carry on" });
  // Started by someone the runner no longer links as: not its person's to act on.
  again.take(SERVER, { type: "drive", v: 1, id: "d2", by: ADA, kind: "instruct", session: `claude-code:${UUIDS[2]}`, text: "carry on" });
  await t.until(() => t.of("turn-ended").length === 1 && t.of("refused").length === 1);
  await again.settled();
  expect(t.of("held")).toEqual([{ type: "driven", v: 1, kind: "held", session: `claude-code:${UUIDS[1]}`, room: "room-1", why: "restored", permissions: "auto" }]);
  expect(t.of("refused")[0]).toMatchObject({ id: "d2", reason: "not-owner" });
  expect(t.fakeLog().find((l) => l.argv).argv.slice(0, 3)).toEqual(["-p", "--resume", UUIDS[1]]);
});

test("restart: a session whose saved conversation is gone fails to reopen and is forgotten", async () => {
  const at = new Date().toISOString();
  const t = await setUp({ records: [] });
  t.registry.put({ kind: "driven", pid: null, spawned: null, session: `claude-code:${UUIDS[1]}`, folder: t.folder, started: at, lastActivity: at, state: "closed", driven: { room: "room-1", project: PROJECT.id, office: SERVER, owner: ADA.id, permissions: "auto", transcript: true } });
  t.driver.close();
  const sent: DrivenMessage[] = [];
  const again = createDriver({
    claudeDir: t.claudeDir,
    account: { id: ADA.id },
    offices: [{ server: SERVER, send: (m) => (sent.push(m), true), folder: async () => null }],
    registry: t.registry,
    binary: async () => t.bin,
    settings: async () => SETTINGS,
    scan: async () => null,
    log: () => {},
    projectOf: async () => PROJECT.id,
    env: { ...process.env, CLAUDE_CONFIG_DIR: t.claudeDir, FAKE_STATE: t.state },
  });
  cleanups.push(() => again.close());
  again.take(SERVER, { type: "drive", v: 1, id: "d1", by: ADA, kind: "instruct", session: `claude-code:${UUIDS[1]}`, text: "carry on" });
  await t.until(() => sent.some((m) => m.kind === "released"));
  await again.settled();
  expect(sent.map((m) => m.kind)).toEqual(["held", "turn-started", "turn-ended", "error", "released"]);
  expect(sent[3]).toMatchObject({ text: expect.stringContaining("can't find this session's saved conversation") });
  expect(t.registry.list()).toEqual([]);
});

test("live: what is sent while the office's link is down is dropped, and after a hello holding says where each session stands, held first", async () => {
  const t = await setUp();
  t.drive(start("d1"));
  await t.until(() => t.of("held").length === 1);
  t.drive({ id: "s1", kind: "stop", session: S1 });
  await t.until(() => t.of("released").length === 1);
  t.drive(start("d2", { instruction: "hang" }));
  await t.until(() => t.fakeLog().some((l) => l.turn === "hang"));
  t.link.up = false;
  t.drive({ id: "d3", kind: "instruct", session: `claude-code:${UUIDS[1]}`, text: "more" });
  await t.driver.settled();
  t.link.up = true;
  const before = t.sent.length;
  t.driver.linked(SERVER);
  expect(t.sent.length).toBe(before + 1);
  expect(t.sent.at(-1)).toEqual({
    type: "driven",
    v: 1,
    kind: "holding",
    sessions: [
      { session: `claude-code:${UUIDS[1]}`, room: "room-1", held: true, permissions: "auto", turn: "d2" },
      { session: S1, room: "room-1", held: false, permissions: "auto" },
    ],
  });
});

test("a driven take: only for the runner's own person; past the cap it isn't readied; readied, it opens once its taken went, its first turn named by its uuid; one that won't open frees its place", async () => {
  const t = await setUp({ settings: { drivenPerProject: 1 } });
  expect(t.driver.takeProblem({ id: "claude:bob" })).toContain("someone other than this computer's own person");
  expect(t.driver.takeProblem(ADA)).toBe(null);
  const take = { session: UUIDS[2]!, folder: t.folder, prompt: "Isoplan handoff h1: read the brief", name: "Isoplan handoff h1", addDir: path.join(t.root, "brief"), room: "room-2", by: ADA };
  expect(await t.driver.prepareTake(SERVER, take)).toBe(null);
  // The take about to open counts against the cap.
  t.drive(start("d1"));
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ reason: "cap-reached" });
  t.driver.taken(UUIDS[2]!, true);
  await t.until(() => t.of("turn-ended").length === 1);
  const session = `claude-code:${UUIDS[2]}`;
  expect(t.sent.slice(1).map((m) => m.kind)).toEqual(["held", "turn-started", "reply", "turn-ended"]);
  expect(t.sent[1]).toEqual({ type: "driven", v: 1, kind: "held", session, room: "room-2", why: "started", permissions: "auto" });
  expect(t.sent[2]).toEqual({ type: "driven", v: 1, kind: "turn-started", session, turn: UUIDS[2] });
  expect(t.fakeLog()[0].argv).toEqual(drivenArgs({ uuid: UUIDS[2]!, resume: false, permissions: "auto", name: "Isoplan handoff h1", addDir: take.addDir }));
  expect(t.fakeLog()[0].argv.slice(-4)).toEqual(["--name", "Isoplan handoff h1", "--add-dir", take.addDir]);
  expect(await t.driver.prepareTake(SERVER, { ...take, session: UUIDS[1]! })).toContain("already has 1 sessions");
  // A take the server dropped, or the runner gave up, opens nothing and frees its place.
  t.drive({ id: "s1", kind: "stop", session });
  await t.until(() => t.of("released").length === 1);
  expect(await t.driver.prepareTake(SERVER, { ...take, session: UUIDS[1]! })).toBe(null);
  t.driver.taken(UUIDS[1]!, false);
  expect(await t.driver.prepareTake(SERVER, { ...take, session: UUIDS[0]! })).toBe(null);
  t.driver.taken(UUIDS[0]!, false);
  await t.driver.settled();
  expect(t.driver.held()).toBe(0);
  expect(t.fakeLog().filter((l) => l.argv)).toHaveLength(1);
});
