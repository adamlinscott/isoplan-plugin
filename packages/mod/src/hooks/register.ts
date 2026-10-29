// Isoplan's hooks module: Claude Code loads it through hooks/hooks.json. It draws nothing. It
// starts the data layer (dist/data-layer.js) for the session and keeps it running, shows the link
// in one status line, writes the room titles the data layer asks for on the owner's own login,
// and adds the office server's conflict notes to the agent's next tool result. When the office
// server wants the machine paired, a "Pair this machine" link is in the status line while it waits,
// and in the transcript once per session start, so nobody types a command or is nagged.
//
// It also gives the session's agent the ask_room tool (#49): in a room that was handed to this
// session's person, it asks the room's lead a question through the office server (dist/ask.js),
// with no one typing anything. The script waits only as long as runner.json says, then tells the
// agent to carry on; an answer that comes after that arrives as an `asked` line and goes on the
// lead's next tool result, as a conflict note does.
//
// The data layer talks back as JSON lines on stdout (src/lines.ts). Claude Code closes the child's
// stdin at launch, so what goes the other way, a title, goes through a file the line names. A data
// layer that ends is started again, backing off while it keeps failing; one running for a session
// id the process has left (a /clear, a resume) is started again for the new id.

import type { AskedMessage, ConflictMessage } from "@isoplan/protocol";
import type { DataLayerLine, PairLine, StatusLine, TitleAskLine } from "../lines.js";
import type { Host, On, ToolCallInput, ToolCallResult } from "./host.js";

const RETRY_CAP_MS = 30000;
// A run that stayed up this long was healthy: the next failure starts the backoff over.
const STABLE_MS = 60000;
// After a session ends, the process may go on under a new id (a /clear, a resume) with no
// session.start; the id is looked at again this long after.
const SWITCH_CHECK_MS = 1000;
// The most of a server's note that reaches the model, and of a late answer from the room.
const NOTE_MAX = 1000;
const ANSWER_MAX = 8000;
/** The ask_room tool, as the model calls it. */
export const ASK_TOOL = "mcp__isoplan__ask_room";
// Longer than the script ever waits (runner.json's polls), which ends it first.
const ASK_TIMEOUT_MS = 10 * 60 * 1000;

let running: string | null = null; // the session id the data layer runs for
let lead: string | null = null; // that session's lead, as the facts name it
let stop: (() => void) | null = null; // ends the current run, for a new session id
let started = false;
// Notes waiting for their agent's next tool result, by agent id.
const notes = new Map<string, string[]>();
let asking = false; // one title call at a time
let lastError: string | null = null;
let pairing: PairLine | null = null; // the link waiting to be clicked, last shown
let pairSaid = false; // a link was put in the transcript since the session started

export function register(on: On): void {
  on("session.start", async ($, e, next) => {
    await $.tool
      .register({
        name: "ask_room",
        description:
          "Ask the lead of the room that was handed to you through Isoplan a question about its work, such as why something was done or what was left unfinished. It answers from the original session's own context, on its owner's machine. Use it only in a session that took an Isoplan handoff; anywhere else it is refused. If no answer comes soon, carry on: a later answer arrives as a note.",
        inputSchema: { type: "object", properties: { question: { type: "string", description: "The question, on its own: the lead hasn't seen this conversation." } }, required: ["question"] },
      })
      .catch((err) => $.ui.log("isoplan: the ask_room tool couldn't be added: " + message(err), { to: "debug" }));
    const result = await next(e);
    pairSaid = false;
    if (!started) {
      started = true;
      void run($).catch((err) => $.ui.log("isoplan: the data layer loop failed: " + message(err), { to: "debug" }));
    } else void checkSession($);
    return result;
  });

  on("session.end", async ($, e, next) => {
    const result = await next(e);
    $.clock.after(SWITCH_CHECK_MS, () => void checkSession($));
    return result;
  });

  // The note goes after the tool's own result, for the model alone. A refused or failed call gets
  // none: the note waits for the next one that ran. Nothing after `next` can throw, so the catch
  // handler answers only when `next` itself rejected; there `next(e)` replays what that call
  // settled to (the mod API's documented guard pattern), and the tool never runs twice.
  on("tool.call", async ($, e, next) => {
    if (e.tool === ASK_TOOL) return askRoom($, e);
    const r = await next(e);
    try {
      void checkSession($);
      if (!lead || r.deny || r.isError) return r;
      const agent = e.agentId ? "claude-code:" + e.agentId : lead;
      const waiting = notes.get(agent);
      if (!waiting) return r;
      notes.delete(agent);
      return { ...r, context: [...(r.context ?? []), ...waiting] };
    } catch {
      return r;
    }
  }).catch(($, e, next) => next(e));
}

// Restarts the data layer when the session's id is no longer the one it runs for.
async function checkSession($: Host): Promise<void> {
  const id = await $.session.id().catch(() => null);
  if (id && running && id !== running) stop?.();
}

async function run($: Host): Promise<void> {
  const script = $.plugin.root.replace(/\\/g, "/") + "/dist/data-layer.js";
  let failures = 0;
  for (;;) {
    const session = await $.session.id();
    const cwd = await $.session.cwd();
    if (session !== running) notes.clear();
    running = session;
    lead = `claude-code:${session}:lead`;
    let switched = false;
    const switching = new Promise<null>((resolve) => {
      stop = () => {
        switched = true;
        resolve(null);
      };
    });
    let began = false; // the first pull came back, so `node` did start
    let code: number | null = null;
    const startedAt = await $.clock.now();
    try {
      const child = $.process.spawn({ argv: ["node", script, "--session", session, "--cwd", cwd], cwd });
      let buffer = "";
      for (;;) {
        const piece = await Promise.race([child.next(), switching]);
        if (piece === null) {
          // Leaving the loop over the stream ends the child.
          void child.return({ code: null, signal: null }).catch(() => {});
          break;
        }
        began = true;
        if (piece.done) {
          code = piece.value?.code ?? null;
          break;
        }
        if (piece.value.stream === "stderr") {
          $.ui.log("isoplan: data layer: " + piece.value.text.trim(), { to: "debug" });
          continue;
        }
        buffer += piece.value.text;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) handle($, line);
        }
      }
    } catch (err) {
      $.ui.log("isoplan: the data layer could not run: " + message(err), { to: "debug" });
    }
    stop = null;
    if (switched) {
      failures = 0;
      continue;
    }
    // Only a run that stayed up a while starts the count again: one that dies soon after starting
    // backs off, however many lines it wrote first.
    failures = (await $.clock.now()) - startedAt >= STABLE_MS ? 1 : failures + 1;
    const delay = Math.min(RETRY_CAP_MS, 1000 * failures);
    $.ui.status(
      !began
        ? "Isoplan needs Node.js on PATH (couldn't start `node`)"
        : `Isoplan: the data layer stopped${code === null ? "" : ` (node exited with code ${code})`}; restarting in ${Math.round(delay / 1000)}s`,
    );
    await $.clock.sleep(delay);
  }
}

// One line from the data layer.
function handle($: Host, text: string): void {
  let line: DataLayerLine;
  try {
    line = JSON.parse(text);
  } catch {
    $.ui.log("isoplan: data layer: " + text, { to: "debug" });
    return;
  }
  switch (line.type) {
    case "status":
      $.ui.status(statusText(line));
      break;
    case "title-ask":
      writeTitle($, line);
      break;
    case "log":
      $.ui.log("isoplan: " + line.text, { to: "debug" });
      break;
    case "pair":
      // In the transcript once per session start; the status line keeps the newest while it waits.
      if (!pairSaid) $.ui.log(`Isoplan: to report to ${line.server}, pair this machine: click ${line.url} on this computer and approve it in the office.`);
      pairSaid = true;
      pairing = line;
      $.ui.status(pairText(line));
      break;
    case "conflict":
      addNote(line);
      break;
    case "asked":
      addAnswer(line);
      break;
    case "error": {
      // Shown once in the transcript (never to the model), not on every reconnect.
      const said = `Isoplan: the office server says: ${line.message} (${line.code})`;
      if (said !== lastError) $.ui.log(said);
      lastError = said;
      break;
    }
  }
}

function statusText(line: StatusLine): string {
  switch (line.state) {
    case "waiting":
      return `Isoplan: ${line.server}, not connected yet (nothing to report)`;
    case "connecting":
      return `Isoplan: connecting to ${line.server}…`;
    case "connected":
      lastError = null;
      return `Isoplan: connected to ${line.server}`;
    case "not-wanted":
      return `Isoplan: this repo isn't in any office on ${line.server}`;
    case "taken":
      return "Isoplan: this session belongs to someone else on the office, so it isn't reported";
    case "insecure":
      return `Isoplan: not reporting: ${line.server} is plain ws:// to another machine; use wss://, or set "allowPlainWs": true in config.json`;
    case "pairing":
      return pairing ? pairText(pairing) : `Isoplan: waiting for this machine to be paired with ${line.server}`;
    case "disconnected":
      return `Isoplan: can't reach ${line.server}; retrying in ${Math.max(1, Math.round((line.retryInMs ?? 0) / 1000))}s`;
  }
}

const pairText = (line: PairLine) => `Isoplan: Pair this machine: ${line.url}`;

function addNote(line: ConflictMessage): void {
  const waiting = notes.get(line.agent) ?? [];
  waiting.push(line.text.length > NOTE_MAX ? line.text.slice(0, NOTE_MAX - 1) + "…" : line.text);
  notes.set(line.agent, waiting);
}

// A late answer from the room goes to the lead, which asked; the rest of a question's news reached it while it waited.
function addAnswer(line: AskedMessage): void {
  if (line.state !== "answered" || !line.answer || !lead) return;
  const answer = line.answer.length > ANSWER_MAX ? line.answer.slice(0, ANSWER_MAX - 1) + "…" : line.answer;
  const waiting = notes.get(lead) ?? [];
  waiting.push(`Isoplan: the room you asked has answered your question (${line.question}), "${line.text}", from its lead's own session:\n\n${answer}`);
  notes.set(lead, waiting);
}

// The ask_room tool: the script asks as this session and prints what the agent is told.
async function askRoom($: Host, e: ToolCallInput): Promise<ToolCallResult> {
  const question = typeof e.question === "string" ? e.question.trim() : "";
  if (!question) return { result: "Give the question to ask the room as `question`." };
  try {
    const script = $.plugin.root.replace(/\\/g, "/") + "/dist/ask.js";
    const session = await $.session.id();
    const cwd = await $.session.cwd();
    const r = await $.process.run(["node", script, "--session", session, "--cwd", cwd], { cwd, stdin: question, timeoutMs: ASK_TIMEOUT_MS });
    if (r.stdout.trim()) return { result: r.stdout.trim() };
    $.ui.log("isoplan: ask_room: " + (r.stderr.trim() || `node exited with code ${r.exitCode}`), { to: "debug" });
    return { result: "The room couldn't be asked here. Carry on without the answer." };
  } catch (err) {
    $.ui.log("isoplan: ask_room couldn't run: " + message(err), { to: "debug" });
    return { result: "The room couldn't be asked here (Node.js is needed on PATH). Carry on without the answer." };
  }
}

// The data layer decides when a title is due and keeps it; this only makes the call it can't.
function writeTitle($: Host, ask: TitleAskLine): void {
  if (asking) return;
  asking = true;
  $.model
    .complete({ model: ask.model, system: ask.system, prompt: ask.prompt, maxTokens: ask.maxTokens })
    .then((r) => {
      if (r.isAnswered) return $.fs.write(ask.file, JSON.stringify({ key: ask.key, text: r.text }));
      $.ui.log("isoplan: no room title: " + r.reason, { to: "debug" });
    })
    .catch((err) => $.ui.log("isoplan: could not write a room title: " + message(err), { to: "debug" }))
    .finally(() => {
      asking = false;
    });
}

const message = (err: unknown) => String((err && (err as Error).message) || err);
