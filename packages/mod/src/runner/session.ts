// The session driver (#41, design R1, R3, R5, R8): a person's own Claude Code session, run by the
// runner on their machine and driven from the floor through the office server (protocol 0.5.0's
// `drive` requests and `driven` messages, packages/protocol/src/messages.ts).
//
//   claude -p (--resume <uuid> | --session-id <uuid>) --input-format stream-json
//     --output-format stream-json --verbose --permission-mode auto --permission-prompts none
//     [--name <name>] [--add-dir <folder>]
//
// - One long-lived process per held session, on the answerer's pattern (claude.ts), but this is the
//   person's own working session: their settings, tools, MCP servers and plugins load, and it is
//   saved, so the plugin's own hooks show it on the floor as their agent. Its environment is the
//   runner's less what ties a process to the session that started the runner (forkEnv).
// - Probed on Claude Code 2.1.318 (6 Nov 2026, Haiku, a temp folder): one process takes turn after
//   turn while stdin stays open; each user line starts a turn (a `system` `init` line first, about
//   0.6 s after the line is written), and each turn ends with exactly one `result`, `num_turns` ≥ 1,
//   `result` the agent's last words. Closing stdin ends the process, exit code 0, within a second.
//   `--resume <uuid>` keeps the same session id (no fork). A missing transcript writes "No
//   conversation found with session ID: <uuid>" to stderr and a `result` with `is_error`,
//   `subtype` "error_during_execution", `num_turns` 0 and that text in `errors`, then exits 1. A tool
//   use comes as an `assistant` line with a `tool_use` block, its result as a `user` line with a
//   `tool_result` block. Something that needs permission, with nobody answering, is denied at once:
//   a `system` line, `subtype` "permission_denied", naming `tool_name`, then an error tool result,
//   whether `--permission-prompts` is the default `host` or `none`.
// - Probed on Claude Code 2.1.318 (6 Nov 2026, Haiku, a temp folder, --no-session-persistence): an
//   instruction that is one of Claude Code's own commands, such as `/cost`, runs no turn of the
//   model's. It gives a `system` `init` line, an `assistant` line with `local_command_source` and
//   the command's text, then one `result`: `subtype` "success", `is_error` false, `num_turns` 0,
//   `local_command` "cost", and that text in `result`. The next instruction runs as usual. So a
//   result with `local_command` ends the turn too, though its `num_turns` is 0.
// - A start opens a new session (--session-id, a fresh uuid) in the folder of the first of the
//   room's sessions this machine has its own record of: Claude Code's transcript of that session
//   says the folder it ran in (`office.folder`, which also needs the folder to be there and in a
//   repo the office takes). Never a path from the server. None: refused `no-folder`.
// - A turn is named by the instruction that started it; one at a time (`busy`). Each tool use is
//   sent as `tool` with a short summary of what for; the turn's `result` text as `reply`; then
//   `turn-ended`. The turn's full output (instruction, the agent's words, tools and their results) is
//   kept in memory for `output`; the whole session's comes from its transcript on disk.
// - Held: while a process holds the session (registry.ts records it). `stop` ends the process at
//   once, mid-turn or not; `hand-back` closes stdin and gives it `drivenCloseSeconds` to finish by
//   itself, then ends it, and answers with `claude --resume <uuid>` and the folder: the session is
//   the person's again and is forgotten here. A process that still hasn't closed after that (or,
//   for a stop, KILL_WAIT_MS after it was ended) keeps the session held, and the request is refused
//   `unavailable`, to try again. A process with no turn running and no output for
//   `drivenIdleMinutes` is closed the same way (`idle-closed`); the next instruction opens it again
//   with --resume (`held reopened`). A process that writes nothing within `drivenStartSeconds` of an
//   instruction is ended as stuck; one that ends by itself is `released crashed`, its turn `failed`.
//   A working turn is never cut short: stopping is the person's to do.
// - At most `drivenPerProject` held sessions per project on the machine (sessions opening and takes
//   about to open count too); a start or reopen past it is refused `cap-reached` with the limit.
// - The runner's restart: a session whose process an earlier run left is ended by the registry
//   (`restore`, under the runner's lock), listed in `holding` as not held, and opened again with
//   --resume on the next instruction (`held restored`).
// - Only the runner's own person acts: every request whose `by` isn't the account the runner links
//   as is refused `not-owner`, and for an existing session `by` must be the person who started it.
//   A session is acted on only through the office it was started through.
// - Everything built from the session (a reply, a tool's name and summary, the words for a tool that
//   wasn't allowed, an output) passes the secret scan first. A matched reply or output is sent as a
//   note with a `withheld` id, and only the owner's `release` sends it, as the runner's withheld
//   answers are released (runner.ts); a tool use whose name or summary matched is sent as `tool`,
//   with no summary, and a tool that wasn't allowed as "a tool". At most MAX_HELD are held, the
//   oldest dropped, each cut to what its release sends.
// - Every message is cut to the protocol's limits and checked against DrivenMessageSchema before it
//   goes, so one bad message can't make the server close the runner's link, and is sent only while
//   the office's link is up (`office.send`), never kept in the reply outbox. After every hello
//   `holding` says where each of the office's sessions stands.
// - A handoff taken as a driven session (handoff/take.ts, mode `driven`): `takeProblem` before
//   anything is made, `prepareTake` once the worktree is ready (the cap), and `taken` once the take
//   has ended. When its `taken` was handed to the link (which sends it now, or after the next hello)
//   and the server hadn't dropped the take, nor the runner given it up, that opens it under the
//   take's uuid with the take's prompt as its first turn, named by that uuid, after `held`
//   `started`; otherwise it only frees the take's place under the cap.
// - Permission prompts, bypassPermissions and drive-policy are #42's: every session runs in `auto`
//   and says so (`permissionArgs`), an `answer` is refused `no-prompt`, and drive-policy is only kept.

import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  DrivenMessageSchema,
  MAX_COMMAND_LENGTH,
  MAX_DETAIL_LENGTH,
  MAX_DRIVEN_SESSION_ID_LENGTH,
  MAX_FOLDER_LENGTH,
  MAX_HOLDING,
  MAX_OUTPUT_LENGTH,
  MAX_REPLY_LENGTH,
  MAX_ROOM_ID_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  PROTOCOL_VERSION,
  type DriveMessage,
  type DrivePermissions,
  type DrivePolicyMessage,
  type DrivenMessage,
  type DriveRefusalReason,
} from "@isoplan/protocol";
import { claudeCommand } from "./claude-binary.js";
import { forkEnv, hiddenSpawn, killTree, userTurn, type Spawn } from "./claude.js";
import type { DrivenFields, ProcessRecord, Registry } from "./registry.js";
import { MAX_HELD } from "./runner.js";

/** What runner.json says of driven sessions. */
export interface DriveSettings {
  /** A held session's process is closed after this long with no instruction or output. */
  drivenIdleMinutes: number;
  /** The most sessions a project may have held on this machine at once. */
  drivenPerProject: number;
  /** How long a process asked to end (handed back, or idle) has to exit by itself before it is ended. */
  drivenCloseSeconds: number;
  /** How long a process may take to start on an instruction (its first output) before it is ended as stuck. */
  drivenStartSeconds: number;
}

/** One office server's side of the driver. */
export interface DriveOffice {
  /** The office's address, as the registry records a session's office. */
  server: string;
  /** Sends the message now if the office's link is up; false when it was dropped. Never kept for later. */
  send(message: DrivenMessage): boolean;
  /** The folder of the first of these sessions this machine has its own record of, still there and in a repo the office takes; null with none. */
  folder(roomSessions: string[]): Promise<string | null>;
}

/** A handoff taken as a driven session, once its worktree is ready. */
export interface PreparedTake {
  /** The take's session id, the bare uuid: the session's id and its first turn's name. */
  session: string;
  folder: string;
  prompt: string;
  name: string;
  /** The handoff's own folder, with its brief, which the session reads. */
  addDir: string;
  room: string;
  by: { id: string };
}

export interface DriverOptions {
  claudeDir: string;
  /** The runner's own person: the account its links say hello as. */
  account: { id: string };
  offices: DriveOffice[];
  registry: Registry;
  /** The `claude` binary, or null when none can be found. */
  binary: () => Promise<string | null>;
  settings: () => Promise<DriveSettings>;
  /** The name of the secret pattern `text` matches, or null. */
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** The id of the project a folder is in, for a driven take's cap. */
  projectOf: (folder: string) => Promise<string | null>;
  spawn?: Spawn;
  env?: Record<string, string | undefined>;
  now?: () => number;
  newId?: () => string;
  platform?: NodeJS.Platform;
}

export interface Driver {
  /** A drive request or drive-policy from the office at `server`. */
  take(server: string, message: DriveMessage | DrivePolicyMessage): void;
  /** The office's link has said hello again: where its sessions stand goes now. */
  linked(server: string): void;
  /** How many sessions a process holds now, or is opening. */
  held(): number;
  /** Why this runner won't take a handoff as a driven session for `by`, or null. */
  takeProblem(by: { id: string } | undefined): string | null;
  /** Readies a driven take whose worktree is made: null, or why it can't be opened. */
  prepareTake(server: string, take: PreparedTake): Promise<string | null>;
  /** The take has ended: with `opens` (its `taken` was handed to the link, and it wasn't dropped or given up) its session opens now; without, its place under the cap is freed. */
  taken(session: string, opens: boolean): void;
  /** Ends every process at once, as the worker exits. */
  close(): void;
  /** Resolves once every request and message so far has been handled. */
  settled(): Promise<void>;
}

/** The permission mode every driven session runs in until #42. */
export const DRIVEN_PERMISSIONS: DrivePermissions = "auto";

/**
 * The permission flags of a driven session's process. Until #42 every session runs in Claude Code's
 * `auto` mode and nobody answers its prompts, so whatever still asks is denied at once. #42 puts
 * `--permission-prompts host` here and relays the prompts, and runs bypassPermissions where the
 * office's drive-policy allows it (the policy is kept by office in the driver).
 */
export function permissionArgs(_asked: DrivePermissions): string[] {
  return ["--permission-mode", DRIVEN_PERMISSIONS, "--permission-prompts", "none"];
}

/** Every flag of a driven session's command line, after the binary. --add-dir takes every argument after it, so it is last. */
export function drivenArgs({ uuid, resume, permissions, name, addDir }: { uuid: string; resume: boolean; permissions: DrivePermissions; name?: string; addDir?: string }): string[] {
  return [
    "-p",
    ...(resume ? ["--resume", uuid] : ["--session-id", uuid]),
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    ...permissionArgs(permissions),
    ...(name && !resume ? ["--name", name] : []),
    ...(addDir ? ["--add-dir", addDir] : []),
  ];
}

// The end of a process's stderr kept for the local log.
const STDERR_CHARS = 2000;
// A tool result's text kept in an output.
const TOOL_RESULT_CHARS = 2000;
// The end of a transcript read for a session's output.
const TRANSCRIPT_TAIL_BYTES = 4 * 1024 * 1024;
// Finished turns' outputs kept per session, newest last.
const TURNS_KEPT = 10;
// Start request ids remembered, so one sent twice opens one session.
const STARTS_KEPT = 200;
// Driven takes waiting for their `taken` to be sent.
const TAKES_KEPT = 20;
// How long a process that was ended at once gets to say it has gone.
const KILL_WAIT_MS = 10000;

const NO_CLAUDE = "Claude Code for the terminal isn't installed on this computer, so no session can run here.";
const NO_FOLDER = "This computer has no folder for this room: open Claude Code once in the room's repo here, then try again.";
const NOT_STARTED = "Claude Code couldn't be started on this computer. Its runner log says why.";
const BUSY = "The agent is still working on the last instruction. Wait for it to finish, or stop it.";
const NOT_CLOSED = "Claude Code couldn't be closed for this session on this computer, so it is still running there. Try again in a moment.";
const TURN_GONE = "This computer no longer has that instruction's output (Isoplan restarted since, or it was long ago). Ask for the whole session's output instead.";
const RELEASE_GONE = "Nothing is held back under that id on this computer any more: Isoplan may have restarted since.";
const MISSING = "Claude Code can't find this session's saved conversation on this computer any more, so it can't be continued from the floor.";
const WITHHELD = "Held back on this computer: it may contain a secret. Release it from the floor to see it.";
const NOT_YOURS_TAKE = "This handoff was taken from the floor by someone other than this computer's own person, so nothing was opened here.";
const capReached = (limit: number) => `This project already has ${limit} sessions running from the floor on this computer, the most allowed. Stop one, then try again.`;
// runner.json may say 2.5, but the cap is a whole number of sessions, and at least one.
const capOf = (st: DriveSettings) => Math.max(1, Math.floor(st.drivenPerProject));

type Ending = "stopped" | "handed-back" | "idle-closed";

/** A reply or output the secret scan held back, for the owner's release. */
interface Held {
  session: string;
  turn?: string;
  text: string;
  cut: boolean;
}

interface Session {
  record: ProcessRecord & { driven: DrivenFields };
  child: ChildProcessWithoutNullStreams | null;
  opening: boolean;
  /** Resolves once the current process has closed. */
  closed: Promise<void>;
  turn: string | null;
  /** The running turn's output so far, and whether its start was cut off. */
  output: string;
  cut: boolean;
  outputs: Map<string, { text: string; cut: boolean }>;
  /** Why the runner is ending the process, while it does. */
  ending: Ending | null;
  /** What to say when the process ends by itself, when known before it does. */
  failure: string | null;
  /** From before the runner's restart: it opens again as `restored`. */
  fromBefore: boolean;
  stderr: string;
  idle: ReturnType<typeof setTimeout> | null;
  idleToken: number;
  starting: ReturnType<typeof setTimeout> | null;
  /** Requests on the session, one at a time. */
  work: Promise<void>;
  /** Its messages, in order. */
  out: Promise<void>;
}

const uuidOf = (session: string) => session.slice(session.indexOf(":") + 1);
const iso = (ms: number) => new Date(ms).toISOString();

/** `text` within `max`, its start kept, and whether it was cut. */
function cutStart(text: string, max: number): { text: string; cut: boolean } {
  return text.length <= max ? { text, cut: false } : { text: text.slice(0, max - 1) + "…", cut: true };
}

/** `text` within `max`, its end kept, and whether it was cut. */
function cutEnd(text: string, max: number): { text: string; cut: boolean } {
  return text.length <= max ? { text, cut: false } : { text: "…" + text.slice(-(max - 1)), cut: true };
}

/** A short summary of what a tool use was for, from its input: its description, else the file, pattern, command or address it names. */
export function summaryOf(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  for (const key of ["description", "file_path", "notebook_path", "path", "pattern", "command", "url", "query", "prompt", "skill", "subject"]) {
    const value = i[key];
    if (typeof value === "string" && value.trim()) return cutStart(value.replace(/\s+/g, " ").trim(), MAX_SUMMARY_LENGTH).text;
  }
  return undefined;
}

function resultText(block: Record<string, unknown>): string {
  const c = block.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string" ? (x as { text: string }).text : "")).join("\n") : "";
  return cutStart(text.trim(), TOOL_RESULT_CHARS).text;
}

/**
 * The plain text of one message line, as stream-json writes it and as the transcript keeps it: an
 * instruction as `> ...`, the agent's words, `[Tool] what for`, and a tool's result. Empty for
 * anything else, and for a subagent's own lines.
 */
export function messageText(e: unknown): string {
  if (!e || typeof e !== "object") return "";
  const line = e as { type?: unknown; isSidechain?: unknown; isMeta?: unknown; parent_tool_use_id?: unknown; message?: { content?: unknown } };
  if ((line.type !== "user" && line.type !== "assistant") || line.isSidechain === true || line.isMeta === true || line.parent_tool_use_id) return "";
  const content = line.message?.content;
  if (typeof content === "string") return line.type === "user" ? `> ${content.trim()}` : content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as Record<string, unknown>[]) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) parts.push(line.type === "user" ? `> ${block.text.trim()}` : block.text.trim());
    else if (block.type === "tool_use") {
      const summary = summaryOf(block.input);
      parts.push(`[${typeof block.name === "string" ? block.name : "tool"}]${summary ? ` ${summary}` : ""}`);
    } else if (block.type === "tool_result") {
      const text = resultText(block);
      if (text) parts.push(text);
    }
  }
  return parts.join("\n");
}

/** The session's transcript: where Claude Code puts it for the folder, else wherever it is under projects/. */
export async function transcriptOf(claudeDir: string, folder: string, uuid: string): Promise<string | null> {
  const projects = path.join(claudeDir, "projects");
  const exists = (p: string) => fsp.stat(p).then((s) => s.isFile(), () => false);
  const guess = path.join(projects, folder.replace(/[^a-zA-Z0-9]/g, "-"), `${uuid}.jsonl`);
  if (await exists(guess)) return guess;
  for (const dir of await fsp.readdir(projects).catch(() => [] as string[])) {
    const p = path.join(projects, dir, `${uuid}.jsonl`);
    if (await exists(p)) return p;
  }
  return null;
}

/** The plain text of the end of a transcript, at most TRANSCRIPT_TAIL_BYTES of it, and whether its start was left out. */
export async function transcriptText(file: string): Promise<{ text: string; cut: boolean }> {
  const handle = await fsp.open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // cut by the window's edge
    const parts: string[] = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const text = messageText(JSON.parse(l));
        if (text) parts.push(text);
      } catch {
        // Not a line of the transcript's own.
      }
    }
    return { text: parts.join("\n"), cut: start > 0 };
  } finally {
    await handle.close();
  }
}

/** The message cut to the protocol's limits in every free-text field it has. */
function fit(m: DrivenMessage): DrivenMessage {
  const out = { ...m } as Record<string, unknown>;
  const limit = (key: string, max: number) => {
    if (typeof out[key] === "string" && (out[key] as string).length > max) out[key] = cutStart(out[key] as string, max).text;
  };
  limit("tool", MAX_TOOL_NAME_LENGTH);
  limit("summary", MAX_SUMMARY_LENGTH);
  limit("room", MAX_ROOM_ID_LENGTH);
  limit("command", MAX_COMMAND_LENGTH);
  limit("folder", MAX_FOLDER_LENGTH);
  limit("detail", MAX_DETAIL_LENGTH);
  limit("text", m.kind === "reply" ? MAX_REPLY_LENGTH : m.kind === "output" ? MAX_OUTPUT_LENGTH : MAX_DETAIL_LENGTH);
  if (m.kind === "holding") out.sessions = m.sessions.map((s) => ({ ...s, room: cutStart(s.room, MAX_ROOM_ID_LENGTH).text, session: s.session.slice(0, MAX_DRIVEN_SESSION_ID_LENGTH) }));
  return out as DrivenMessage;
}

const driven = { type: "driven", v: PROTOCOL_VERSION } as const;

export function createDriver(o: DriverOptions): Driver {
  const now = o.now ?? Date.now;
  const spawn = o.spawn ?? hiddenSpawn;
  const env = o.env ?? process.env;
  const newId = o.newId ?? randomUUID;
  const platform = o.platform ?? process.platform;
  const offices = new Map(o.offices.map((office) => [office.server, office]));
  const sessions = new Map<string, Session>();
  const withheld = new Map<string, Held>(); // oldest first
  const policies = new Map<string, Set<string>>(); // office → projects that allow bypassPermissions (#42)
  const takes = new Map<string, PreparedTake & { server: string; project: string }>();
  const starts = new Set<string>();

  function newSession(record: ProcessRecord & { driven: DrivenFields }, fromBefore: boolean): Session {
    return { record, child: null, opening: false, closed: Promise.resolve(), turn: null, output: "", cut: false, outputs: new Map(), ending: null, failure: null, fromBefore, stderr: "", idle: null, idleToken: 0, starting: null, work: Promise.resolve(), out: Promise.resolve() };
  }

  // Work and messages still to finish, for `settled`.
  let busy = 0;
  const waiting: (() => void)[] = [];
  function count(p: Promise<void>): Promise<void> {
    busy++;
    void p.finally(() => {
      if (--busy === 0) for (const resolve of waiting.splice(0)) resolve();
    });
    return p;
  }

  function sendTo(server: string, m: DrivenMessage): void {
    const office = offices.get(server);
    if (!office) return;
    const parsed = DrivenMessageSchema.safeParse(fit(m));
    if (!parsed.success) {
      o.log(`a driven ${m.kind} message wasn't sent, as it doesn't fit the protocol: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      return;
    }
    office.send(parsed.data);
  }

  const refuse = (server: string, id: string, reason: DriveRefusalReason, extra: { detail?: string; limit?: number } = {}) =>
    sendTo(server, { ...driven, kind: "refused", id, reason, ...extra } as DrivenMessage);

  // The session's messages go in the order they were made, however long a scan takes.
  function emit(s: Session, make: () => DrivenMessage | null | Promise<DrivenMessage | null>): void {
    const server = s.record.driven.office;
    s.out = count(
      s.out
        .then(async () => {
          const m = await make();
          if (m) sendTo(server, m);
        })
        .catch((err: Error) => o.log(`couldn't send a message of ${s.record.session}: ${err.message}`)),
    );
  }

  function queue(s: Session, run: () => Promise<void>): void {
    s.work = count(s.work.then(run).catch((err: Error) => o.log(`driving ${s.record.session} failed: ${err?.stack ?? String(err)}`)));
  }

  const current = (s: Session) => sessions.get(s.record.session) === s;

  function save(s: Session, patch: Partial<ProcessRecord> = {}): void {
    s.record = { ...s.record, ...patch };
    if (current(s)) o.registry.put(s.record);
  }

  function heldIn(project: string): number {
    let n = 0;
    for (const s of sessions.values()) if ((s.child || s.opening) && s.record.driven.project === project) n++;
    for (const t of takes.values()) if (t.project === project) n++;
    return n;
  }

  // Sessions with no process past MAX_HOLDING are forgotten, the least recently active first.
  function prune(): void {
    const closed = [...sessions.values()].filter((s) => !s.child && !s.opening).sort((a, b) => Date.parse(b.record.lastActivity) - Date.parse(a.record.lastActivity));
    for (const s of closed.slice(Math.max(0, MAX_HOLDING - (sessions.size - closed.length)))) forget(s);
  }

  function forget(s: Session): void {
    clearIdle(s);
    if (s.starting) clearTimeout(s.starting);
    if (!current(s)) return;
    sessions.delete(s.record.session);
    o.registry.remove(s.record.session);
    for (const [id, w] of withheld) if (w.session === s.record.session) withheld.delete(id);
  }

  // Kept as its release sends it: cut to MAX_OUTPUT_LENGTH, so a held output is never the whole transcript's tail.
  function hold({ text, cut = false, ...about }: { session: string; turn?: string; text: string; cut?: boolean }): string {
    const id = `w-${randomUUID()}`;
    const c = cutEnd(text, MAX_OUTPUT_LENGTH);
    withheld.set(id, { ...about, text: c.text, cut: cut || c.cut });
    if (withheld.size > MAX_HELD) withheld.delete(withheld.keys().next().value!);
    return id;
  }

  function clearIdle(s: Session): void {
    s.idleToken++;
    if (s.idle) clearTimeout(s.idle);
    s.idle = null;
  }

  // Counts from now: a process with no turn running and nothing from it closes when it runs out.
  function armIdle(s: Session): void {
    clearIdle(s);
    const token = s.idleToken;
    void o.settings().then((st) => {
      if (token !== s.idleToken || !s.child || s.turn) return;
      s.idle = setTimeout(() => queue(s, () => closeIdle(s)), st.drivenIdleMinutes * 60000);
      s.idle.unref?.();
    });
  }

  function addOutput(s: Session, text: string): void {
    if (!text) return;
    s.output += text + "\n";
    if (s.output.length > MAX_OUTPUT_LENGTH) {
      s.output = s.output.slice(-MAX_OUTPUT_LENGTH);
      s.cut = true;
    }
  }

  function keepTurn(s: Session, turn: string): void {
    s.outputs.set(turn, { text: s.output, cut: s.cut });
    if (s.outputs.size > TURNS_KEPT) s.outputs.delete(s.outputs.keys().next().value!);
  }

  /** Opens the session's process: null, or why it couldn't. */
  async function open(s: Session, bin?: string | null): Promise<{ reason: "no-claude" | "unavailable"; detail: string } | null> {
    s.opening = true;
    try {
      bin ??= await o.binary();
      if (!bin) return { reason: "no-claude", detail: NO_CLAUDE };
      const d = s.record.driven;
      const uuid = uuidOf(s.record.session);
      // A session that crashed in its first turn has a transcript too. One that had a turn end but
      // whose transcript is gone is resumed all the same, and Claude Code says it can't find it.
      const resume = d.transcript || (await transcriptOf(o.claudeDir, s.record.folder, uuid)) !== null;
      const argv = [...claudeCommand(bin), ...drivenArgs({ uuid, resume, permissions: d.permissions, ...(d.name ? { name: d.name } : {}), ...(d.addDir ? { addDir: d.addDir } : {}) })];
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(argv, { cwd: s.record.folder, env: forkEnv(env) });
      } catch (err) {
        o.log(`couldn't start claude for ${s.record.session} in ${s.record.folder}: ${(err as Error).message}`);
        return { reason: "unavailable", detail: NOT_STARTED };
      }
      wire(s, child);
      const at = iso(now());
      save(s, { pid: child.pid ?? null, spawned: at, state: "idle", lastActivity: at });
      o.log(`opened driven session ${s.record.session} in ${s.record.folder} (process ${child.pid})`);
      armIdle(s);
      return null;
    } finally {
      s.opening = false;
    }
  }

  function wire(s: Session, child: ChildProcessWithoutNullStreams): void {
    s.child = child;
    s.stderr = "";
    let closed = () => {};
    s.closed = new Promise<void>((resolve) => (closed = resolve));
    let buffer = "";
    child.stdout.setEncoding("utf8").on("data", (piece: string) => {
      buffer += piece;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const text = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!text) continue;
        let e: Record<string, unknown>;
        try {
          e = JSON.parse(text);
        } catch {
          continue; // Claude Code's own output, not an event
        }
        if (e && typeof e === "object") onEvent(s, child, e);
      }
    });
    child.stderr.setEncoding("utf8").on("data", (piece: string) => (s.stderr = (s.stderr + piece).slice(-STDERR_CHARS)));
    child.stdin.on("error", () => {}); // a process that has gone breaks the pipe; its close says why
    let over = false;
    const end = (code: number | null) => {
      if (over) return;
      over = true;
      closed();
      ended(s, child, code);
    };
    child.on("error", (err) => {
      o.log(`claude for ${s.record.session} failed: ${err.message}`);
      end(null);
    });
    child.on("close", (code) => end(code));
  }

  function onEvent(s: Session, child: ChildProcessWithoutNullStreams, e: Record<string, unknown>): void {
    if (s.child !== child) return;
    if (s.starting) clearTimeout(s.starting);
    s.starting = null;
    s.record.lastActivity = iso(now());
    o.registry.touch(s.record.session, now());
    const turn = s.turn;
    if (!turn) {
      armIdle(s);
      return;
    }
    if (e.parent_tool_use_id) return;
    if (e.type === "assistant" || e.type === "user") {
      addOutput(s, messageText(e));
      if (e.type !== "assistant") return;
      const content = (e.message as { content?: unknown } | undefined)?.content;
      for (const block of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
        if (block?.type !== "tool_use") continue;
        const tool = typeof block.name === "string" && block.name ? block.name : "tool";
        const summary = summaryOf(block.input);
        emit(s, async () => {
          // A tool's name can be anyone's words (an MCP server names its own), so it is scanned with the summary.
          if (await o.scan(summary === undefined ? tool : `${tool} ${summary}`)) return { ...driven, kind: "tool", session: s.record.session, turn, tool: "tool", withheld: true };
          return { ...driven, kind: "tool", session: s.record.session, turn, tool, ...(summary !== undefined ? { summary } : {}) };
        });
      }
    } else if (e.type === "system" && e.subtype === "permission_denied") {
      const tool = typeof e.tool_name === "string" && e.tool_name ? e.tool_name : "a tool";
      addOutput(s, `(${tool} wasn't allowed: it needs your permission)`);
      const said = (name: string) => `The agent wanted to use ${name}, which needs your permission. Sessions run from the floor can't ask for it yet, so it wasn't allowed.`;
      emit(s, async () => ({ ...driven, kind: "error", session: s.record.session, turn, text: (await o.scan(said(tool))) ? said("a tool") : said(tool) }));
    } else if (e.type === "result" && ((typeof e.num_turns === "number" && e.num_turns >= 1) || e.is_error === true || typeof e.local_command === "string")) {
      // A Claude Code command (`/cost`) is answered with num_turns 0 and `local_command`: see the probe above.
      endTurn(s, turn, e);
    }
    // Any other result, with no turn in it, is a leftover background task replayed (claude.ts): the turn goes on.
  }

  function endTurn(s: Session, turn: string, e: Record<string, unknown>): void {
    s.turn = null;
    keepTurn(s, turn);
    const failed = e.is_error === true || e.subtype !== "success";
    const missing = Array.isArray(e.errors) && e.errors.some((x) => typeof x === "string" && x.includes("No conversation found"));
    const session = s.record.session;
    if (missing) s.failure = MISSING;
    else if (failed) {
      const kind = typeof e.subtype === "string" && /^[a-z_]+$/.test(e.subtype) ? ` (${e.subtype})` : "";
      emit(s, () => ({ ...driven, kind: "error", session, turn, text: `Claude Code stopped this instruction with an error${kind}.` }));
    }
    const text = !failed && typeof e.result === "string" ? e.result.trim() : "";
    if (text) {
      emit(s, async () => {
        const matched = await o.scan(text);
        if (matched) {
          o.log(`withheld the reply to ${turn} in ${session}: it matches the secret pattern "${matched}"`);
          return { ...driven, kind: "reply", session, turn, text: WITHHELD, withheld: { id: hold({ session, turn, text }) } };
        }
        const c = cutStart(text, MAX_REPLY_LENGTH);
        return { ...driven, kind: "reply", session, turn, text: c.text, ...(c.cut ? { cut: true as const } : {}) };
      });
    }
    emit(s, () => ({ ...driven, kind: "turn-ended", session, turn, outcome: failed ? "failed" : "done" }));
    save(s, { state: "idle", driven: { ...s.record.driven, transcript: s.record.driven.transcript || !missing } });
    armIdle(s);
  }

  function ended(s: Session, child: ChildProcessWithoutNullStreams, code: number | null): void {
    if (s.child !== child) return;
    s.child = null;
    clearIdle(s);
    if (s.starting) clearTimeout(s.starting);
    s.starting = null;
    const turn = s.turn;
    s.turn = null;
    if (turn) keepTurn(s, turn);
    const session = s.record.session;
    const why = s.ending;
    s.record = { ...s.record, pid: null, spawned: null, state: "closed" };
    if (why) {
      if (turn) emit(s, () => ({ ...driven, kind: "turn-ended", session, turn, outcome: "stopped" }));
      save(s);
      return;
    }
    const missing = s.failure === MISSING || /No conversation found/i.test(s.stderr);
    const said = missing ? MISSING : (s.failure ?? "Claude Code stopped running for this session unexpectedly. Send another instruction to start it again.");
    s.failure = null;
    o.log(`the process of driven session ${session} ended by itself${code === null ? "" : ` with code ${code}`}${s.stderr.trim() ? `: ${s.stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`);
    emit(s, () => ({ ...driven, kind: "error", session, ...(turn ? { turn } : {}), text: said }));
    if (turn) emit(s, () => ({ ...driven, kind: "turn-ended", session, turn, outcome: "failed" }));
    emit(s, () => ({ ...driven, kind: "released", session, why: "crashed" }));
    if (missing) forget(s);
    else save(s);
  }

  async function within(p: Promise<void>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = await Promise.race([p.then(() => true), new Promise<boolean>((r) => (timer = setTimeout(() => r(false), ms)))]);
    clearTimeout(timer);
    return done;
  }

  // Closes stdin and gives the process drivenCloseSeconds to finish by itself, then ends it.
  async function closeGently(s: Session): Promise<void> {
    const st = await o.settings();
    const child = s.child;
    if (!child) return;
    child.stdin.end();
    if (await within(s.closed, st.drivenCloseSeconds * 1000)) return;
    o.log(`driven session ${s.record.session} didn't end within ${st.drivenCloseSeconds} s of being closed, so its process was ended`);
    if (s.child === child) killTree(child, platform);
    await within(s.closed, KILL_WAIT_MS);
  }

  async function beginTurn(s: Session, turn: string, text: string): Promise<void> {
    const st = await o.settings();
    const child = s.child;
    if (!child) return;
    clearIdle(s);
    s.turn = turn;
    s.output = "";
    s.cut = false;
    s.failure = null;
    addOutput(s, `> ${text}`);
    s.starting = setTimeout(() => {
      if (s.child !== child || s.turn !== turn) return;
      o.log(`driven session ${s.record.session} wrote nothing within ${st.drivenStartSeconds} s of instruction ${turn}, so its process was ended`);
      s.failure = `Claude Code didn't start on the instruction within ${st.drivenStartSeconds} seconds, so it was stopped. Send the instruction again to retry.`;
      killTree(child, platform);
    }, st.drivenStartSeconds * 1000);
    s.starting.unref?.();
    save(s, { state: "working", lastActivity: iso(now()) });
    emit(s, () => ({ ...driven, kind: "turn-started", session: s.record.session, turn }));
    child.stdin.write(userTurn(text));
  }

  async function start(server: string, m: Extract<DriveMessage, { kind: "start" }>): Promise<void> {
    if (starts.has(m.id)) {
      o.log(`start ${m.id} was handled already, so it isn't run again`);
      return;
    }
    starts.add(m.id);
    if (starts.size > STARTS_KEPT) starts.delete(starts.values().next().value!);
    const bin = await o.binary();
    if (!bin) return refuse(server, m.id, "no-claude", { detail: NO_CLAUDE });
    const folder = await offices.get(server)!.folder(m.roomSessions ?? []);
    if (!folder) return refuse(server, m.id, "no-folder", { detail: NO_FOLDER });
    const st = await o.settings();
    const project = m.project.id.toLowerCase();
    const cap = capOf(st);
    // Checked and taken with no await between, so two starts can't both take the last place.
    if (heldIn(project) >= cap) return refuse(server, m.id, "cap-reached", { limit: cap, detail: capReached(cap) });
    if (m.permissions !== DRIVEN_PERMISSIONS) o.log(`start ${m.id} asked for ${m.permissions}; it runs in ${DRIVEN_PERMISSIONS}, which is all this runner does yet`);
    const at = iso(now());
    const s = newSession(
      { kind: "driven", pid: null, spawned: null, session: `claude-code:${newId()}`, folder, started: at, lastActivity: at, state: "closed", driven: { room: m.room, project, office: server, owner: m.by.id, permissions: DRIVEN_PERMISSIONS, transcript: false } },
      false,
    );
    s.opening = true;
    sessions.set(s.record.session, s);
    queue(s, async () => {
      const problem = await open(s, bin);
      if (problem) {
        forget(s);
        return refuse(server, m.id, problem.reason, { detail: problem.detail });
      }
      prune();
      emit(s, () => ({ ...driven, kind: "started", id: m.id, session: s.record.session, room: m.room, permissions: DRIVEN_PERMISSIONS }));
      emit(s, () => ({ ...driven, kind: "held", session: s.record.session, room: m.room, why: "started", permissions: DRIVEN_PERMISSIONS }));
      if (m.instruction) await beginTurn(s, m.id, m.instruction);
    });
  }

  async function instruct(s: Session, id: string, text: string): Promise<void> {
    const server = s.record.driven.office;
    if (!current(s)) return refuse(server, id, "not-found");
    if (s.turn) return refuse(server, id, "busy", { detail: BUSY });
    if (!s.child) {
      const cap = capOf(await o.settings());
      if (heldIn(s.record.driven.project) >= cap) return refuse(server, id, "cap-reached", { limit: cap, detail: capReached(cap) });
      const why = s.fromBefore ? "restored" : "reopened";
      const problem = await open(s);
      if (problem) return refuse(server, id, problem.reason, { detail: problem.detail });
      s.fromBefore = false;
      emit(s, () => ({ ...driven, kind: "held", session: s.record.session, room: s.record.driven.room, why, permissions: s.record.driven.permissions }));
    }
    await beginTurn(s, id, text);
  }

  async function stop(s: Session, id: string): Promise<void> {
    if (!current(s)) return refuse(s.record.driven.office, id, "not-found");
    const child = s.child;
    if (child) {
      s.ending = "stopped";
      killTree(child, platform);
      await within(s.closed, KILL_WAIT_MS);
      s.ending = null;
      // Still running: the session stays held, so nothing says it was let go.
      if (s.child === child) {
        o.log(`driven session ${s.record.session}'s process ${child.pid} didn't end when stopped, so it is still held`);
        return refuse(s.record.driven.office, id, "unavailable", { detail: NOT_CLOSED });
      }
    }
    emit(s, () => ({ ...driven, kind: "released", session: s.record.session, why: "stopped", id }));
  }

  async function handBack(s: Session, id: string): Promise<void> {
    if (!current(s)) return refuse(s.record.driven.office, id, "not-found");
    const child = s.child;
    if (child) {
      s.ending = "handed-back";
      await closeGently(s);
      s.ending = null;
      // Still running: resuming it in a terminal would make two writers, so it stays held here.
      if (s.child === child) {
        o.log(`driven session ${s.record.session}'s process ${child.pid} didn't end when handed back, so it is still held`);
        return refuse(s.record.driven.office, id, "unavailable", { detail: NOT_CLOSED });
      }
    }
    const session = s.record.session;
    emit(s, () => ({ ...driven, kind: "released", session, why: "handed-back", id }));
    emit(s, () => ({ ...driven, kind: "handed-back", id, session, command: `claude --resume ${uuidOf(session)}`, folder: s.record.folder }));
    o.log(`handed driven session ${session} back to its person, in ${s.record.folder}`);
    forget(s);
  }

  async function closeIdle(s: Session): Promise<void> {
    if (!current(s) || !s.child || s.turn || s.ending) return;
    s.ending = "idle-closed";
    await closeGently(s);
    s.ending = null;
    o.log(`closed driven session ${s.record.session}: nothing happened in it for a while`);
    emit(s, () => ({ ...driven, kind: "released", session: s.record.session, why: "idle-closed" }));
  }

  async function output(s: Session, id: string, turn: string | undefined): Promise<void> {
    const server = s.record.driven.office;
    const session = s.record.session;
    let found: { text: string; cut: boolean };
    if (turn !== undefined) {
      const kept = s.turn === turn ? { text: s.output, cut: s.cut } : s.outputs.get(turn);
      if (!kept) return refuse(server, id, "unavailable", { detail: TURN_GONE });
      found = kept;
    } else {
      const file = await transcriptOf(o.claudeDir, s.record.folder, uuidOf(session));
      found = file ? await transcriptText(file).catch(() => ({ text: "", cut: false })) : { text: "", cut: false };
    }
    const text = found.text.trim();
    emit(s, async () => {
      const matched = text ? await o.scan(text) : null;
      if (matched) {
        o.log(`withheld the output of ${turn ?? "the whole session"} in ${session}: it matches the secret pattern "${matched}"`);
        return { ...driven, kind: "output", id, session, ...(turn !== undefined ? { turn } : {}), text: WITHHELD, withheld: { id: hold({ session, ...(turn !== undefined ? { turn } : {}), text, cut: found.cut }) } };
      }
      const c = cutEnd(text, MAX_OUTPUT_LENGTH);
      return { ...driven, kind: "output", id, session, ...(turn !== undefined ? { turn } : {}), text: c.text, ...(c.cut || found.cut ? { cut: true as const } : {}) };
    });
  }

  function release(s: Session, id: string, withheldId: string): void {
    const w = withheld.get(withheldId);
    if (!w || w.session !== s.record.session) return refuse(s.record.driven.office, id, "not-found", { detail: RELEASE_GONE });
    withheld.delete(withheldId);
    emit(s, () => ({ ...driven, kind: "output", id, session: w.session, ...(w.turn !== undefined ? { turn: w.turn } : {}), text: w.text, ...(w.cut ? { cut: true as const } : {}) }));
  }

  // The driven sessions an earlier run left, with no process now (registry.restore ended theirs).
  for (const r of o.registry.list()) if (r.kind === "driven" && r.driven) sessions.set(r.session, newSession(r as Session["record"], true));
  prune();

  return {
    take(server, m) {
      if (!offices.has(server)) return;
      if (m.type === "drive-policy") {
        // Kept for #42, which runs bypassPermissions where it allows; until then nothing skips prompts.
        policies.set(server, new Set(m.bypassAllowed.map((p) => p.toLowerCase())));
        return;
      }
      if (m.by.id !== o.account.id) return refuse(server, m.id, "not-owner");
      if (m.kind === "start") {
        void start(server, m).catch((err: Error) => (o.log(`start ${m.id} failed: ${err?.stack ?? String(err)}`), refuse(server, m.id, "unavailable", { detail: NOT_STARTED })));
        return;
      }
      const s = sessions.get(m.session);
      if (!s || s.record.driven.office !== server) return refuse(server, m.id, "not-found");
      if (s.record.driven.owner !== m.by.id) return refuse(server, m.id, "not-owner");
      if (m.kind === "instruct") queue(s, () => instruct(s, m.id, m.text));
      else if (m.kind === "stop") queue(s, () => stop(s, m.id));
      else if (m.kind === "hand-back") queue(s, () => handBack(s, m.id));
      else if (m.kind === "output") void output(s, m.id, m.turn).catch((err: Error) => o.log(`output ${m.id} failed: ${err.message}`));
      else if (m.kind === "release") release(s, m.id, m.withheld);
      // An answer: this runner raises no prompts until #42, so none is waiting.
      else refuse(server, m.id, "no-prompt");
    },
    linked(server) {
      const list = [...sessions.values()]
        .filter((s) => s.record.driven.office === server)
        .sort((a, b) => Number(!!b.child) - Number(!!a.child) || Date.parse(b.record.lastActivity) - Date.parse(a.record.lastActivity))
        .slice(0, MAX_HOLDING)
        .map((s) => ({ session: s.record.session, room: s.record.driven.room, held: !!s.child, permissions: s.record.driven.permissions, ...(s.turn ? { turn: s.turn } : {}) }));
      sendTo(server, { ...driven, kind: "holding", sessions: list });
    },
    held: () => [...sessions.values()].filter((s) => s.child || s.opening).length,
    takeProblem: (by) => (by?.id === o.account.id ? null : NOT_YOURS_TAKE),
    async prepareTake(server, take) {
      const project = ((await o.projectOf(take.folder).catch(() => null)) ?? take.folder).toLowerCase();
      const cap = capOf(await o.settings());
      if (heldIn(project) >= cap) return capReached(cap);
      takes.set(take.session, { ...take, server, project });
      if (takes.size > TAKES_KEPT) takes.delete(takes.keys().next().value!);
      return null;
    },
    taken(uuid, opens) {
      const t = takes.get(uuid);
      if (!t) return;
      takes.delete(uuid);
      if (!opens) {
        o.log(`driven take ${uuid} won't open: the server dropped it, it was given up, or its taken wasn't sent`);
        return;
      }
      const at = iso(now());
      const s = newSession(
        {
          kind: "driven",
          pid: null,
          spawned: null,
          session: `claude-code:${uuid}`,
          folder: t.folder,
          started: at,
          lastActivity: at,
          state: "closed",
          driven: { room: t.room, project: t.project, office: t.server, owner: t.by.id, permissions: DRIVEN_PERMISSIONS, transcript: false, addDir: t.addDir, name: t.name },
        },
        false,
      );
      s.opening = true;
      sessions.set(s.record.session, s);
      queue(s, async () => {
        const problem = await open(s);
        if (problem) {
          emit(s, () => ({ ...driven, kind: "error", session: s.record.session, text: problem.detail }));
          emit(s, () => ({ ...driven, kind: "released", session: s.record.session, why: "crashed" }));
          forget(s);
          return;
        }
        prune();
        emit(s, () => ({ ...driven, kind: "held", session: s.record.session, room: t.room, why: "started", permissions: DRIVEN_PERMISSIONS }));
        await beginTurn(s, uuid, t.prompt);
      });
    },
    close() {
      for (const s of sessions.values()) {
        if (!s.child) continue;
        s.ending = "stopped";
        killTree(s.child, platform);
      }
      o.registry.closeSync();
    },
    settled: () => (busy === 0 ? Promise.resolve() : new Promise<void>((resolve) => waiting.push(resolve))),
  };
}
