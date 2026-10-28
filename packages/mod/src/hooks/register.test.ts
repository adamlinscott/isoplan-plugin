import { beforeEach, expect, test, vi } from "vitest";
import type { DataLayerLine } from "../lines.js";
import type { Host, On, ToolCallInput, ToolCallResult } from "./host.js";

type Hooks = { "session.start"?: Function; "session.end"?: Function; "tool.call"?: Function };

interface HostOptions {
  /** How many restart waits end; the one after that never does, so the loop stops there. */
  wakes?: number;
  /** How long each data layer run lasts on the host's clock. */
  runMs?: number;
  /** Keep each data layer running after its lines, rather than exit. */
  stays?: boolean;
  /** `node` can't be started: the child fails before its first output. */
  noNode?: boolean;
}

// A host whose data layer writes `lines` and then exits (or stays up).
function host(lines: DataLayerLine[], { wakes = 0, runMs = 0, stays = false, noNode = false }: HostOptions = {}) {
  const status: (string | undefined)[] = [];
  const written: [string, string][] = [];
  const spawned: (readonly string[])[] = [];
  const spawnedIn: (string | undefined)[] = [];
  const slept: number[] = [];
  const session = { id: "s1" };
  let now = 0;
  const $: Host = {
    plugin: { root: "C:\\plugins\\isoplan" },
    session: { id: async () => session.id, cwd: async () => "C:/w/repo" },
    process: {
      spawn: ({ argv, cwd }) => {
        spawned.push(argv);
        spawnedIn.push(cwd);
        return (async function* () {
          if (noNode) throw new Error("spawn node ENOENT");
          // Split mid-line, as a pipe may.
          const text = lines.map((l) => JSON.stringify(l) + "\n").join("");
          yield { stream: "stdout" as const, text: text.slice(0, 7) };
          yield { stream: "stdout" as const, text: text.slice(7) };
          now += runMs;
          if (stays) await new Promise(() => {});
          return { code: 0, signal: null };
        })();
      },
    },
    model: { complete: async () => ({ isAnswered: true, text: "Fixing the wizard" }) },
    fs: { write: async (p, text) => void written.push([p, text]) },
    ui: { status: (text) => void status.push(text), log: () => {} },
    clock: {
      now: async () => now,
      sleep: (ms) => (slept.push(ms), slept.length <= wakes ? Promise.resolve() : new Promise(() => {})),
      after: (_ms, fn) => (fn(), { cancel: () => {} }),
    },
  };
  return { $, status, written, spawned, spawnedIn, slept, session };
}

let hooks: Hooks;
let catches: Hooks;
beforeEach(async () => {
  vi.resetModules(); // the module keeps the session's state
  const { register } = await import("./register.js");
  hooks = {};
  catches = {};
  const on = ((event: keyof Hooks, hook: Function) => {
    hooks[event] = hook;
    return { catch: (handler: Function) => void (catches[event] = handler) };
  }) as unknown as On;
  register(on);
});

async function start(lines: DataLayerLine[], opts?: HostOptions) {
  const h = host(lines, opts);
  await hooks["session.start"]!(h.$, { cwd: "C:/w/repo" }, async () => ({ cwd: "C:/w/repo" }));
  return h;
}
const stopped = (h: ReturnType<typeof host>) => vi.waitFor(() => expect(h.status.at(-1)).toMatch(/stopped/));

const call = (h: ReturnType<typeof host>, e: Partial<ToolCallInput>, result: ToolCallResult = { result: "ok" }) =>
  hooks["tool.call"]!(h.$, { tool: "Read", tool_use_id: "t", ...e }, async () => result) as Promise<ToolCallResult>;

const connected: DataLayerLine = { type: "status", server: "ws://127.0.0.1:4747/data-layer", state: "connected" };

test("hooks: starts the data layer for its session and shows the link's state, then that it stopped", async () => {
  const h = await start([connected]);
  await stopped(h);
  expect(h.spawned).toEqual([["node", "C:/plugins/isoplan/dist/data-layer.js", "--session", "s1", "--cwd", "C:/w/repo"]]);
  expect(h.status).toEqual(["Isoplan: connected to ws://127.0.0.1:4747/data-layer", "Isoplan: the data layer stopped (node exited with code 0); restarting in 1s"]);
});

test("hooks: a data layer that keeps dying soon after starting backs off, whatever it wrote; one that stayed up a minute starts over", async () => {
  const quick = await start([connected], { wakes: 3 });
  await vi.waitFor(() => expect(quick.slept).toHaveLength(4));
  expect(quick.slept).toEqual([1000, 2000, 3000, 4000]);

  vi.resetModules();
  const { register } = await import("./register.js");
  register(((event: keyof Hooks, hook: Function) => ((hooks[event] = hook), { catch: () => {} })) as unknown as On);
  const steady = await start([connected], { wakes: 2, runMs: 60000 });
  await vi.waitFor(() => expect(steady.slept).toHaveLength(3));
  expect(steady.slept).toEqual([1000, 1000, 1000]);
});

test("hooks: when the session goes on under a new id (a /clear, a resume), the data layer starts again for it", async () => {
  const h = await start([{ type: "conflict", v: 1, agent: "claude-code:s1:lead", file: "a.md", text: "Old note." }], { stays: true });
  await vi.waitFor(() => expect(h.spawned).toHaveLength(1));
  h.session.id = "s2";
  await hooks["session.end"]!(h.$, { reason: "clear", sessionId: "s1" }, async () => ({ sessionId: "s1" }));
  await vi.waitFor(() => expect(h.spawned).toHaveLength(2));
  expect(h.spawned[1]).toContain("s2");
  expect(h.slept).toEqual([]); // no backoff for a switch
  expect(await call(h, {})).toEqual({ result: "ok" }); // the old session's note went with it
});

test("hooks: a conflict note goes on that agent's next tool result that ran, once, cut to 1,000 characters", async () => {
  const long = "x".repeat(5000);
  const h = await start([
    { type: "conflict", v: 1, agent: "claude-code:w1", file: "a.md", text: "Bea's agent edited a.md 3 minutes ago." },
    { type: "conflict", v: 1, agent: "claude-code:s1:lead", file: "b.md", text: long },
  ]);
  await stopped(h);
  expect(await call(h, { agentId: "w1" }, { deny: "no" })).toEqual({ deny: "no" });
  expect(await call(h, { agentId: "w1" }, { result: "ok", context: ["earlier"] })).toEqual({ result: "ok", context: ["earlier", "Bea's agent edited a.md 3 minutes ago."] });
  expect(await call(h, { agentId: "w1" })).toEqual({ result: "ok" });
  expect(await call(h, {})).toEqual({ result: "ok", context: ["x".repeat(999) + "…"] });
});

test("hooks: the data layer runs in the session's folder; a new session id seen on a tool call starts it again", async () => {
  const h = await start([connected], { stays: true });
  await vi.waitFor(() => expect(h.spawned).toHaveLength(1));
  h.session.id = "s2";
  await call(h, {});
  await vi.waitFor(() => expect(h.spawned).toHaveLength(2));
  expect(h.spawned[1]).toContain("s2");
  expect(h.spawnedIn).toEqual(["C:/w/repo", "C:/w/repo"]);
});

test("hooks: the backoff stops at 30 s; a data layer that never starts says Node.js is needed", async () => {
  const h = await start([], { wakes: 31, noNode: true });
  await vi.waitFor(() => expect(h.slept).toHaveLength(32));
  expect(h.slept.slice(28)).toEqual([29000, 30000, 30000, 30000]);
  expect(h.status.at(-1)).toBe("Isoplan needs Node.js on PATH (couldn't start `node`)");
});

test("hooks: a failed tool call leaves the note for the next; a hook that threw answers with what the tool settled to", async () => {
  const h = await start([{ type: "conflict", v: 1, agent: "claude-code:s1:lead", file: "a.md", text: "Bea is in a.md." }]);
  await stopped(h);
  expect(await call(h, {}, { result: "boom", isError: true })).toEqual({ result: "boom", isError: true });
  expect(await call(h, {})).toEqual({ result: "ok", context: ["Bea is in a.md."] });
  const next = vi.fn(async () => ({ result: "settled" }));
  expect(await catches["tool.call"]!(h.$, { tool: "Read", tool_use_id: "t" }, next)).toEqual({ result: "settled" });
});

test("hooks: tool.call runs the tool exactly once", async () => {
  const h = await start([connected]);
  await stopped(h);
  const next = vi.fn(async () => ({ result: "ok" }));
  await hooks["tool.call"]!(h.$, { tool: "Read", tool_use_id: "t" }, next);
  expect(next).toHaveBeenCalledTimes(1);
});

test("hooks: a title ask is answered by the model and written where the line says", async () => {
  const file = "C:/Users/ada/.claude/isoplan/titles/s1.json";
  const h = await start([{ type: "title-ask", model: "haiku", system: "Name it.", prompt: "Branch: fix/wizard", maxTokens: 40, key: "k1", file }]);
  await vi.waitFor(() => expect(h.written).toEqual([[file, JSON.stringify({ key: "k1", text: "Fixing the wizard" })]]));
});
