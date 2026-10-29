import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import type { Lead } from "./answerer.js";
import { claudeCommand, findClaude } from "./claude-binary.js";
import { createClaudeAnswerer, forkArgs, forkEnv } from "./claude.js";

test("fork: the command line is pinned, flag by flag", () => {
  expect(forkArgs("e8fd707b", "opus")).toEqual([
    "-p",
    "--resume",
    "e8fd707b",
    "--fork-session",
    "--no-session-persistence",
    "--tools",
    "",
    // Reads no settings file, so neither the plugin nor the wake hook loads in the fork.
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--model",
    "opus",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
  ]);
});

test("fork: Claude Code's own variables are taken out of its environment, bar CLAUDE_CONFIG_DIR", () => {
  expect(forkEnv({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CONFIG_DIR: "/c", ANTHROPIC_API_KEY: "k", GONE: undefined })).toEqual({ PATH: "/bin", CLAUDE_CONFIG_DIR: "/c", ANTHROPIC_API_KEY: "k" });
});

// A stand-in for `claude`: it logs its argv and every stdin line, replays two empty results before
// turn 1's real one (as a lead with leftover background tasks does), and answers turn 2.
const FAKE = `
import fs from "node:fs";
const log = (x) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(x) + "\\n");
const out = (x) => process.stdout.write(JSON.stringify(x) + "\\n");
const usage = (input, write, read, output) => ({ input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output });
log({ argv: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env).filter((k) => k.startsWith("CLAUDE")) });
let turn = 0, realSent = false, buf = "";
process.stdin.setEncoding("utf8").on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    turn++;
    log({ turn, text: line.message.content[0].text, afterReal: realSent });
    if (process.env.FAKE_MODE === "hang") continue;
    if (turn === 1) {
      out({ type: "system", subtype: "init" });
      out({ type: "result", subtype: "success", num_turns: 0, result: "", usage: usage(9, 9, 9, 9), total_cost_usd: 4.58 });
      out({ type: "result", subtype: "success", num_turns: 0, result: "", usage: usage(9, 9, 9, 9) });
      setTimeout(() => {
        realSent = true;
        out({ type: "result", subtype: "success", num_turns: 1, result: "ready", usage: usage(2, 570000, 2700, 4), total_cost_usd: 99 });
      }, 50);
    } else {
      out({ type: "result", subtype: "success", num_turns: 1, result: process.env.FAKE_MODE === "error" ? "boom" : "  It was 79.16%.  ", is_error: process.env.FAKE_MODE === "error", usage: usage(3, 400, 572000, 300) });
    }
  }
}).on("end", () => {
  log({ closed: true });
  process.exit(0);
});
`;

function fake(mode = "") {
  const root = tempRoot();
  const bin = path.join(root, "claude.js");
  const logFile = path.join(root, "log.jsonl");
  fs.writeFileSync(bin, FAKE);
  const cwd = fs.mkdtempSync(path.join(root, "lead-"));
  const lead: Lead = { cwd, working: false, compacted: false, context: 572000 };
  const answerer = createClaudeAnswerer({
    claudeDir: path.join(root, ".claude"),
    binary: async () => bin,
    model: async () => "opus",
    config: async () => ({ tailBytes: 1048576, stalledMinutes: 5 }),
    env: { ...process.env, FAKE_LOG: logFile, FAKE_MODE: mode, CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli" },
  });
  const logged = () => fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { answerer, lead, logged, cwd };
}

const ask = { instructions: "Reply with only the word: ready", request: "What was the coverage?", timeoutMs: 10000 };

test("fork: turn 2 goes after turn 1's real result, stdin closes, and the last result is the reply", async () => {
  const f = fake();
  const answered = await f.answerer.ask("claude-code:e8fd707b", f.lead, ask);
  expect(answered).toEqual({ ok: true, text: "It was 79.16%.", usage: { input: 5, output: 304, cacheRead: 574700, cacheWrite: 570400 } });
  const [start, ...rest] = f.logged();
  expect(start.argv).toEqual(forkArgs("e8fd707b", "opus"));
  expect(fs.realpathSync(start.cwd)).toBe(fs.realpathSync(f.cwd));
  expect(start.env).toEqual([]);
  expect(rest).toEqual([
    { turn: 1, text: ask.instructions, afterReal: false },
    { turn: 2, text: ask.request, afterReal: true },
    { closed: true },
  ]);
});

test("fork: an error result fails the answer, keeping what was metered", async () => {
  const f = fake("error");
  expect(await f.answerer.ask("claude-code:s", f.lead, ask)).toEqual({ ok: false, error: "the fork stopped with success: boom", usage: { input: 5, output: 304, cacheRead: 574700, cacheWrite: 570400 } });
});

test("fork: no answer inside the timeout fails it and ends the fork", async () => {
  const f = fake("hang");
  expect(await f.answerer.ask("claude-code:s", f.lead, { ...ask, timeoutMs: 300 })).toEqual({ ok: false, error: "no answer within 0 s", usage: null });
});

test("fork: a session that isn't Claude Code's, or no binary, is a failure with the reason", async () => {
  const f = fake();
  expect(await f.answerer.ask("codex:s", f.lead, ask)).toMatchObject({ ok: false, error: "codex:s isn't a Claude Code session" });
  const none = createClaudeAnswerer({ claudeDir: "/x", binary: async () => null, model: async () => "opus", config: async () => ({ tailBytes: 1, stalledMinutes: 1 }) });
  expect(await none.ask("claude-code:s", f.lead, ask)).toMatchObject({ ok: false, error: expect.stringContaining("claude binary wasn't found") });
  expect(await none.lead("codex:s")).toBe(null);
});

test("binary: PATH first, then the installers' places, on Windows and on Mac", async () => {
  const has = (...files: string[]) => async (p: string) => files.includes(p);
  const win = { Path: "C:\\Tools;C:\\Users\\ada\\AppData\\Roaming\\npm" };
  expect(await findClaude(win, "win32", "C:\\Users\\ada", has("C:\\Tools\\claude.exe", "C:\\Users\\ada\\.local\\bin\\claude.exe"))).toBe("C:\\Tools\\claude.exe");
  expect(await findClaude(win, "win32", "C:\\Users\\ada", has("C:\\Users\\ada\\.local\\bin\\claude.exe"))).toBe("C:\\Users\\ada\\.local\\bin\\claude.exe");
  // An npm install leaves a .cmd shim, which needs a shell: its cli.js runs with node instead.
  const npm = "C:\\Users\\ada\\AppData\\Roaming\\npm";
  const cli = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
  expect(await findClaude(win, "win32", "C:\\Users\\ada", has(`${npm}\\claude.cmd`, cli))).toBe(cli);
  expect(claudeCommand(cli, "node")).toEqual(["node", cli]);
  expect(claudeCommand("C:\\Tools\\claude.exe")).toEqual(["C:\\Tools\\claude.exe"]);

  const mac = { PATH: "/usr/bin:/bin" };
  expect(await findClaude(mac, "darwin", "/Users/ada", has("/Users/ada/.local/bin/claude", "/opt/homebrew/bin/claude"))).toBe("/Users/ada/.local/bin/claude");
  expect(await findClaude(mac, "darwin", "/Users/ada", has("/opt/homebrew/bin/claude"))).toBe("/opt/homebrew/bin/claude");
  expect(await findClaude(mac, "darwin", "/Users/ada", has())).toBe(null);
});
