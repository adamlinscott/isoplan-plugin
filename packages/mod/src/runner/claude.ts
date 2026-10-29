// The Claude Code answerer: answers from a fork of a session's lead, run as #44's probe settled.
//
//   claude -p --resume <lead> --fork-session --no-session-persistence --tools "" --setting-sources ""
//     --strict-mcp-config --model <model> --input-format stream-json --output-format stream-json --verbose
//
// - The fork runs in the lead's folder, with Claude Code's own CLAUDE* variables taken out of its
//   environment (all but CLAUDE_CONFIG_DIR, which says where the session is). It has no tools and
//   no MCP servers; `--setting-sources ""` reads no settings file, so neither this plugin nor the
//   wake hook loads in it, and nothing it does reaches the office server. It is never saved.
// - Two turns. Turn 1 is the fixed instruction block, the same bytes every time, so its end is a
//   cache breakpoint every later fork of the lead reads; turn 2 is the question or the brief request.
// - A lead with leftover background tasks first replays them as empty results (`num_turns: 0`).
//   Turn 2 goes only after a result with `num_turns` ≥ 1, and the last result is the reply.
// - Stdin closes after turn 2, or the process waits for more.
// - Tokens come from each turn's `result.usage`, never `total_cost_usd` or `modelUsage`, into which
//   a resumed fork restores the lead's own earlier cost.

import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createClaudeCode } from "../data-layer/claude-code.js";
import type { Config } from "../data-layer/config.js";
import { nodeIo } from "../data-layer/io.js";
import type { Answered, Answerer, Ask, Usage } from "./answerer.js";
import { claudeCommand } from "./claude-binary.js";

const PREFIX = "claude-code:";
// The end of the fork's stderr kept for a failure's reason.
const STDERR_CHARS = 2000;

/** Every flag of the fork's command line, after the binary. */
export function forkArgs(sessionId: string, model: string): string[] {
  return [
    "-p",
    "--resume",
    sessionId,
    "--fork-session",
    "--no-session-persistence",
    "--tools",
    "",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--model",
    model,
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
}

/** The fork's environment: this one's, less Claude Code's own variables, bar CLAUDE_CONFIG_DIR. */
export function forkEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined && (!key.startsWith("CLAUDE") || key === "CLAUDE_CONFIG_DIR")) out[key] = value;
  return out;
}

/** One user turn as a stream-json input line. */
export const userTurn = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n";

export type Spawn = (argv: string[], opts: { cwd: string; env: Record<string, string> }) => ChildProcessWithoutNullStreams;

export interface ClaudeAnswererOptions {
  claudeDir: string;
  /** The `claude` binary, or null when none can be found. */
  binary: () => Promise<string | null>;
  /** The model the fork answers with, from runner.json. */
  model: () => Promise<string>;
  /** How the lead's transcript is read and when its turn counts as open. */
  config: () => Promise<Pick<Config, "tailBytes" | "stalledMinutes">>;
  spawn?: Spawn;
  env?: Record<string, string | undefined>;
  now?: () => number;
}

const defaultSpawn: Spawn = ([cmd, ...args], { cwd, env }) => nodeSpawn(cmd!, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

export function createClaudeAnswerer({ claudeDir, binary, model, config, spawn = defaultSpawn, env = process.env, now = Date.now }: ClaudeAnswererOptions): Answerer {
  // A session id names a transcript file, so it must be a plain name.
  const idOf = (session: string) => {
    const id = session.startsWith(PREFIX) ? session.slice(PREFIX.length) : null;
    return id && /^[\w-]+$/.test(id) ? id : null;
  };
  return {
    async lead(session) {
      const id = idOf(session);
      // A fresh read each time: the runner asks rarely, and a cache would keep every session it was asked about.
      return id ? createClaudeCode({ ...nodeIo(), claudeDir }).lead(id, now(), await config()) : null;
    },
    async ask(session, lead, ask) {
      const id = idOf(session);
      if (!id) return { ok: false, error: `${session} isn't a Claude Code session`, usage: null };
      const bin = await binary();
      if (!bin) return { ok: false, error: "the claude binary wasn't found; run the plugin's install script, or set its path in ~/.claude/isoplan/claude-binary.json", usage: null };
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn([...claudeCommand(bin), ...forkArgs(id, await model())], { cwd: lead.cwd, env: forkEnv(env) });
      } catch (err) {
        return { ok: false, error: `couldn't start claude: ${(err as Error).message}`, usage: null };
      }
      return drive(child, ask);
    },
  };
}

/** Runs the two turns over a started fork and settles once it has exited or timed out. */
export function drive(child: ChildProcessWithoutNullStreams, { instructions, request, timeoutMs }: Ask): Promise<Answered> {
  return new Promise((resolve) => {
    const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let metered = false;
    let turn = 1;
    let reply: string | null = null;
    let failure: string | null = null;
    let buffer = "";
    let stderr = "";
    let isDone = false;

    const finish = (answered: Answered) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      resolve(answered);
    };
    const fail = (error: string) => finish({ ok: false, error, usage: metered ? usage : null });
    const timer = setTimeout(() => {
      fail(`no answer within ${Math.round(timeoutMs / 1000)} s`);
      child.kill();
    }, timeoutMs);

    const onResult = (e: Record<string, any>) => {
      // Leftover background tasks replay as empty results before the real one.
      if (!(typeof e.num_turns === "number" && e.num_turns >= 1)) return;
      const u = e.usage && typeof e.usage === "object" ? e.usage : {};
      const n = (key: string) => (Number.isFinite(u[key]) ? (u[key] as number) : 0);
      usage.input += n("input_tokens");
      usage.output += n("output_tokens");
      usage.cacheRead += n("cache_read_input_tokens");
      usage.cacheWrite += n("cache_creation_input_tokens");
      metered = true;
      if (e.is_error || e.subtype !== "success") failure = `the fork stopped with ${String(e.subtype ?? "an error")}${typeof e.result === "string" && e.result ? `: ${e.result}` : ""}`;
      if (turn === 1) {
        if (failure) {
          fail(failure);
          child.kill();
          return;
        }
        turn = 2;
        child.stdin.write(userTurn(request));
        child.stdin.end();
      } else if (!failure) reply = typeof e.result === "string" ? e.result.trim() : "";
    };

    child.stdout.setEncoding("utf8").on("data", (piece: string) => {
      buffer += piece;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const text = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!text) continue;
        try {
          const e = JSON.parse(text);
          if (e && e.type === "result") onResult(e);
        } catch {
          // Not an event: Claude Code's own output, ignored.
        }
      }
    });
    child.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-STDERR_CHARS)));
    // A fork that exits early breaks the pipe; its exit says why.
    child.stdin.on("error", () => {});
    child.on("error", (err) => fail(`couldn't run claude: ${err.message}`));
    child.on("close", (code) => {
      if (failure) fail(failure);
      else if (reply) finish({ ok: true, text: reply, usage });
      else if (reply === "") fail("the fork answered with nothing");
      else fail(`claude exited${code === null ? "" : ` with code ${code}`} before answering${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`);
    });

    child.stdin.write(userTurn(instructions));
  });
}
