import { z } from "zod";
import { FactRemoveSchema, FactsSchema, FactUpsertSchema, ProjectSchema, SourceSchema } from "./facts.js";

/**
 * The protocol version every message carries as `v`. Adding optional fields doesn't change it;
 * changing what a field means, or removing one, does.
 */
export const PROTOCOL_VERSION = 1;

const Version = z.literal(PROTOCOL_VERSION);
const Seq = z.number().int().nonnegative();

const Account = z.object({ id: z.string().min(1), name: z.string() });
const Machine = z.object({ name: z.string().min(1) });

/** Matches a request with its reply or refusal. */
const RequestId = z.string().min(1);

/** A handoff's id. It names the handoff's branch, `isoplan/handoff/<id>`, so it keeps to safe characters. */
const HandoffId = z
  .string()
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes");

/**
 * Whether a path segment is one Windows reads as `.git`: the name before any NTFS stream
 * (`.git::$INDEX_ALLOCATION`), its trailing dots and spaces dropped, in any case, or the 8.3 short
 * name of a folder that starts with `.git`.
 */
export const isGitFolder = (segment: string) => {
  const name = segment.split(":")[0]!.replace(/[. ]+$/, "").toLowerCase();
  return name === ".git" || /^git~\d+$/.test(name);
};

/**
 * One repo a handoff pushed: its path in the session's folder (`.` for the folder itself), remote,
 * branch and commit. A handoff drives git on the receiver's machine, so the path stays inside the
 * folder, out of any `.git` folder (in any spelling Windows reads as one: `.GIT.`, `.git `, `GIT~1`),
 * with no `:` (an NTFS stream, such as `.git::$INDEX_ALLOCATION`), and the remote can't name a transport helper such as `ext::`, which runs a command.
 */
export const HandoffRepoSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((path) => !/^([\\/]|[A-Za-z]:)/.test(path), "a path relative to the session's folder")
    .refine((path) => !path.split(/[\\/]/).includes(".."), "a path inside the session's folder, with no `..`")
    .refine((path) => !path.startsWith("-"), "a path that doesn't start with `-`, which git would read as an option")
    .refine((path) => !path.split(/[\\/]/).some(isGitFolder), "a path that isn't in a `.git` folder")
    .refine((path) => !path.includes(":"), "a path with no `:`, which Windows reads as a drive or a file's stream")
    .refine((path) => path === "." || !path.split(/[\\/]/).some((part) => part === "" || part === "." || part === ".."), "`.` itself, or a path of named folders, with no empty, `.` or `..` part"),
  remote: z
    .string()
    .min(1)
    .refine((remote) => !/^[A-Za-z0-9+.-]+::/.test(remote), "a remote with no transport helper (`<transport>::`)")
    .refine((remote) => !remote.startsWith("-"), "a remote that doesn't start with `-`, which git would read as an option"),
  branch: z.string().min(1),
  commit: z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/, "a full commit hash"),
});

/**
 * What the receiver gets: the brief, and every repo pushed for it, each on the handoff's own branch,
 * `isoplan/handoff/<id>`. Repos that push to the same remote can't share one, so each after the
 * first has `isoplan/handoff/<id>--<its path, as lowercase letters, digits and dashes>`.
 */
export const HandoffSchema = z
  .object({
    id: HandoffId,
    brief: z.string().min(1),
    repos: z.array(HandoffRepoSchema).min(1),
  })
  .superRefine((handoff, context) => {
    handoff.repos.forEach((repo, i) => {
      const own = `isoplan/handoff/${handoff.id}`;
      if (repo.branch !== own && !(repo.branch.startsWith(`${own}--`) && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(repo.branch.slice(own.length + 2)))) {
        context.addIssue({ code: "custom", path: ["repos", i, "branch"], message: `the handoff's branch, isoplan/handoff/${handoff.id} or isoplan/handoff/${handoff.id}--<slug>` });
      }
    });
  });

/**
 * The machine's access token from pairing, which an office server that signs people in requires.
 * It refuses a hello without one as `not-paired`, an expired or unknown one as `token-expired`, one
 * whose pairing was revoked or has lapsed as `pairing-ended`, and one for a session another paired
 * machine reports as `forged-hello`. A server that signs nobody in ignores it.
 */
const Token = z.string().min(1).max(200).optional();

// Data layer → office server.

/** The first message on a connection: who is reporting, from where, about which session. */
export const HelloMessageSchema = z.object({
  type: z.literal("hello"),
  v: Version,
  source: SourceSchema,
  account: Account,
  machine: Machine,
  session: z.string().min(1),
  project: ProjectSchema,
  token: Token,
});

/** The first message on a runner's link: the one link per machine that answers requests for its rooms. */
export const RunnerHelloMessageSchema = z.object({
  type: z.literal("runner"),
  v: Version,
  account: Account,
  machine: Machine,
  token: Token,
});

/** All of the session's facts. Sent on connect and on repair. */
export const FullMessageSchema = z.object({
  type: z.literal("full"),
  v: Version,
  seq: Seq,
  facts: FactsSchema,
});

/** What changed since the last message. `seq` goes up by one per message, so a gap shows. */
export const ChangesMessageSchema = z.object({
  type: z.literal("changes"),
  v: Version,
  seq: Seq,
  upsert: FactUpsertSchema,
  remove: FactRemoveSchema,
});

/** The answer to a request, carrying the request's id and kind. */
export const ReplyMessageSchema = z.discriminatedUnion("kind", [
  z.object({ type: z.literal("reply"), v: Version, id: RequestId, kind: z.literal("answer-question"), answer: z.string().min(1) }),
  // `fallback`: the fork couldn't write the brief, so `brief` is only the runner's note of what was
  // pushed, and the server writes the rest from the room's feed. The branch is pushed either way.
  z.object({ type: z.literal("reply"), v: Version, id: RequestId, kind: z.literal("write-brief"), handoff: HandoffSchema, fallback: z.literal(true).optional() }),
  // The owner's answer reached the question that was waiting for it. `closed`: the session never said
  // whether it took the answer, but the question has closed, by this answer or the terminal's. `late`:
  // it took the answer after this request was refused for taking too long, so this reply follows that
  // refusal, with the same id.
  z.object({ type: z.literal("reply"), v: Version, id: RequestId, kind: z.literal("owner-answer"), closed: z.literal(true).optional(), late: z.literal(true).optional() }),
]);

/**
 * A request the machine won't answer, sent in place of its reply. `over-cap` names the cap it would
 * go over. `withheld` means the secret scan matched; the reply follows if the owner releases it.
 * `unavailable` is anything else that stops the room answering now, such as its checkout being gone,
 * its lead being mid-turn or a push being rejected.
 */
export const RefusalMessageSchema = z.discriminatedUnion("reason", [
  z.object({
    type: z.literal("refusal"),
    v: Version,
    id: RequestId,
    reason: z.literal("over-cap"),
    cap: z.enum(["room-hour", "owner-day", "owner-tokens"]),
  }),
  // `file`: what was withheld is the handoff's commit, whose added lines in that file matched (the
  // pattern itself stays on the machine); without it, the brief or answer. With several matches, or
  // several repos (#56), it names every such file by its path in the session's folder, joined by ", ".
  // `unchecked`: files the commit adds that the scan can't read (binary), named so the owner knows.
  z.object({
    type: z.literal("refusal"),
    v: Version,
    id: RequestId,
    reason: z.literal("withheld"),
    file: z.string().min(1).optional(),
    unchecked: z.array(z.string().min(1)).optional(),
  }),
  z.object({ type: z.literal("refusal"), v: Version, id: RequestId, reason: z.literal("unavailable"), detail: z.string().min(1) }),
]);

/**
 * The sender's session handed its room over with the command: its agent wrote the brief and pushed.
 * `to` is the receiver as the sender named them, for the server to find in the office.
 */
export const HandOverMessageSchema = z.object({
  type: z.literal("hand-over"),
  v: Version,
  to: z.string().min(1),
  handoff: HandoffSchema,
});

/**
 * The sender's session asks, before it pushes, whether a hand-over with this id to `to` would be
 * taken: the server answers hand-over-ready, or an error saying why not.
 */
export const HandOverCheckMessageSchema = z.object({
  type: z.literal("hand-over-check"),
  v: Version,
  to: z.string().min(1),
  handoff: HandoffId,
});

/** The receiver's session asks for the handoff a take code stands for. */
export const TakeMessageSchema = z.object({
  type: z.literal("take"),
  v: Version,
  code: z.string().min(1),
});

/**
 * The receiver took the handoff and joins its room. Each step that failed is listed with the repo it
 * was for and the end of its output; a failed setup step doesn't stop the session opening. From a runner, `session` is the
 * session it opened, which joins the room; without one no session opened (no clone to work in, or
 * no terminal), so the handoff is still there to take. From a session, the session itself joins.
 */
export const TakenMessageSchema = z.object({
  type: z.literal("taken"),
  v: Version,
  handoff: HandoffId,
  session: z.string().min(1).optional(),
  failures: z.array(
    z.object({
      step: z.enum(["worktree", "setup", "checkout", "open"]),
      repo: z.string().min(1).optional(),
      output: z.string(),
    }),
  ),
});

/** The longest question a session may ask the room. */
export const MAX_QUESTION_LENGTH = 4000;

/**
 * The receiver's session asks the room it was handed a question (#49), on its own short link with
 * the session's hello: the room's lead, on its owner's machine, answers it. The server answers
 * `asked`, or an error (`ask-refused`) when the session may not ask. `key`, the asking side's own id
 * for this ask, makes a retry of it the same question rather than a second one.
 */
export const AskRoomMessageSchema = z.object({
  type: z.literal("ask-room"),
  v: Version,
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  key: z.string().min(1).max(100).optional(),
});

/** The asking session polls a question it asked: the server answers `asked`. */
export const AskCheckMessageSchema = z.object({
  type: z.literal("ask-check"),
  v: Version,
  question: RequestId,
});

/**
 * The asking session's agent was shown how a question ended (answered or dropped): the server stops
 * sending it again.
 */
export const AskedAckMessageSchema = z.object({
  type: z.literal("asked-ack"),
  v: Version,
  question: RequestId,
});

export const DataLayerMessageSchema = z.discriminatedUnion("type", [
  HelloMessageSchema,
  RunnerHelloMessageSchema,
  FullMessageSchema,
  ChangesMessageSchema,
  ReplyMessageSchema,
  RefusalMessageSchema,
  HandOverMessageSchema,
  HandOverCheckMessageSchema,
  TakeMessageSchema,
  TakenMessageSchema,
  AskRoomMessageSchema,
  AskCheckMessageSchema,
  AskedAckMessageSchema,
]);

// Office server → data layer.

/** Asks the data layer to send its facts in full. */
export const RepairMessageSchema = z.object({
  type: z.literal("repair"),
  v: Version,
  reason: z.string().optional(),
});

/** A note for the later editor of `file`, which the data layer adds to `agent`'s next tool result. */
export const ConflictMessageSchema = z.object({
  type: z.literal("conflict"),
  v: Version,
  agent: z.string().min(1),
  file: z.string().min(1),
  text: z.string().min(1),
});

/**
 * Sent after a hello is let in, by a server that reads where an edit or command lands (#74): the
 * projects the office holds, so the data layer may report a file or command in one of them that is
 * outside the session's own project. A data layer that hasn't had one keeps such files on the
 * machine, as an older server would read them as the session's own.
 */
export const WelcomeMessageSchema = z.object({
  type: z.literal("welcome"),
  v: Version,
  projects: z.array(z.string().min(1)),
});

/** Something the data layer should show. */
export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  v: Version,
  code: z.string().min(1),
  message: z.string(),
});

/**
 * Something for the machine to answer, with a reply or a refusal carrying the same id. `session` is
 * the session it concerns: the lead whose fork answers or writes the brief, or the session whose
 * agent asked its owner. `room` is the room the caps count against.
 */
export const RequestMessageSchema = z.discriminatedUnion("kind", [
  // Someone the room was handed to asks it a question.
  z.object({
    type: z.literal("request"),
    v: Version,
    id: RequestId,
    kind: z.literal("answer-question"),
    session: z.string().min(1),
    room: z.string().min(1),
    from: Account,
    question: z.string().min(1),
  }),
  // The sender handed the room over from the floor: write the brief and push, for this handoff.
  z.object({
    type: z.literal("request"),
    v: Version,
    id: RequestId,
    kind: z.literal("write-brief"),
    session: z.string().min(1),
    room: z.string().min(1),
    handoff: HandoffId,
    to: Account,
  }),
  // The owner answered their agent's question from the floor. `question` is the question fact's id,
  // and `answers` maps each question's text to its answer.
  z.object({
    type: z.literal("request"),
    v: Version,
    id: RequestId,
    kind: z.literal("owner-answer"),
    session: z.string().min(1),
    question: z.string().min(1),
    answers: z.record(z.string(), z.string()),
  }),
]);

/**
 * The request is over (its handoff was cancelled, dismissed or replaced): the machine drops what it
 * holds for it, and doesn't send or push what it was still writing.
 */
export const DropMessageSchema = z.object({
  type: z.literal("drop"),
  v: Version,
  id: RequestId,
});

/**
 * The owner released what the secret scan withheld, so the machine sends it now. On the runner's
 * link `id` is the request whose reply was withheld; on a session's link it is the withheld
 * report's `withheld.id`, and only that exact report is released.
 */
export const ReleaseMessageSchema = z.object({
  type: z.literal("release"),
  v: Version,
  id: RequestId,
});

/**
 * A handoff for the receiver to take: sent to their runner when they take it from the floor, or to
 * their session in answer to a take code.
 */
export const HandoffMessageSchema = z.object({
  type: z.literal("handoff"),
  v: Version,
  handoff: HandoffSchema,
  // To a runner: how to open the session (a terminal, by default, or headless, with no window), and
  // the session id to open it under, which is the one the server will let join the room.
  mode: z.enum(["terminal", "headless"]).optional(),
  session: z.string().uuid().optional(),
});

/** A hand-over-check passed: `to` is the receiver the server found for the name given. */
export const HandOverReadyMessageSchema = z.object({
  type: z.literal("hand-over-ready"),
  v: Version,
  handoff: HandoffId,
  to: Account,
});

/** The sender's hand-over reached the room: `to` is the receiver the server found for the name given. */
export const HandedOverMessageSchema = z.object({
  type: z.literal("handed-over"),
  v: Version,
  handoff: HandoffId,
  to: Account,
});

/**
 * Where a question asked of the room stands (#49), sent in answer to ask-room and ask-check, and
 * down the asking session's own link when an answer arrives after it stopped polling. `queued`: the
 * owner's machine can't answer now (it is off, its runner is away, a cap is reached, or the fork
 * couldn't answer), and it is asked again later; `note` says why. `asking`: the owner's runner is
 * answering. `withheld`: the answer matched a secret pattern on the owner's machine, which keeps it
 * until they release it. `answered`, with `answer`. `dropped`: it won't be answered (the owner
 * turned asking off, the handoff was dismissed, or it ran out of tries or time); `note` says why.
 * `text` is the question as it was asked, `owner` the name of the person whose session answers, and
 * `key` the ask's own key.
 * An answered or dropped question is sent again down the session's own link until it is acked.
 */
export const AskedMessageSchema = z.object({
  type: z.literal("asked"),
  v: Version,
  question: RequestId,
  text: z.string().min(1),
  state: z.enum(["queued", "asking", "withheld", "answered", "dropped"]),
  answer: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  owner: z.string().optional(),
  /** The `key` the question was asked under, so the asking side knows which of its asks it was. */
  key: z.string().min(1).max(100).optional(),
});

/**
 * Whether this session may ask `room` now (#49), sent down its own link when it connects in a room
 * that was handed to its person, and whenever that changes: a take grants it, and the owner can
 * turn it off and on again.
 */
export const AskRightsMessageSchema = z.object({
  type: z.literal("ask-rights"),
  v: Version,
  room: z.string().min(1),
  owner: Account,
  granted: z.boolean(),
});

export const OfficeServerMessageSchema = z.discriminatedUnion("type", [
  RepairMessageSchema,
  WelcomeMessageSchema,
  ConflictMessageSchema,
  ErrorMessageSchema,
  RequestMessageSchema,
  ReleaseMessageSchema,
  HandoffMessageSchema,
  HandedOverMessageSchema,
  HandOverReadyMessageSchema,
  DropMessageSchema,
  AskedMessageSchema,
  AskRightsMessageSchema,
]);

export type HandoffRepo = z.infer<typeof HandoffRepoSchema>;
export type Handoff = z.infer<typeof HandoffSchema>;
export type HelloMessage = z.infer<typeof HelloMessageSchema>;
export type RunnerHelloMessage = z.infer<typeof RunnerHelloMessageSchema>;
export type FullMessage = z.infer<typeof FullMessageSchema>;
export type ChangesMessage = z.infer<typeof ChangesMessageSchema>;
export type ReplyMessage = z.infer<typeof ReplyMessageSchema>;
export type RefusalMessage = z.infer<typeof RefusalMessageSchema>;
export type HandOverMessage = z.infer<typeof HandOverMessageSchema>;
export type TakeMessage = z.infer<typeof TakeMessageSchema>;
export type TakenMessage = z.infer<typeof TakenMessageSchema>;
export type DataLayerMessage = z.infer<typeof DataLayerMessageSchema>;
export type RepairMessage = z.infer<typeof RepairMessageSchema>;
export type ConflictMessage = z.infer<typeof ConflictMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type RequestMessage = z.infer<typeof RequestMessageSchema>;
export type RequestKind = RequestMessage["kind"];
export type ReleaseMessage = z.infer<typeof ReleaseMessageSchema>;
export type HandoffMessage = z.infer<typeof HandoffMessageSchema>;
export type HandedOverMessage = z.infer<typeof HandedOverMessageSchema>;
export type HandOverCheckMessage = z.infer<typeof HandOverCheckMessageSchema>;
export type HandOverReadyMessage = z.infer<typeof HandOverReadyMessageSchema>;
export type DropMessage = z.infer<typeof DropMessageSchema>;
export type AskRoomMessage = z.infer<typeof AskRoomMessageSchema>;
export type AskCheckMessage = z.infer<typeof AskCheckMessageSchema>;
export type AskedMessage = z.infer<typeof AskedMessageSchema>;
export type AskedAckMessage = z.infer<typeof AskedAckMessageSchema>;
export type AskRightsMessage = z.infer<typeof AskRightsMessageSchema>;
export type OfficeServerMessage = z.infer<typeof OfficeServerMessageSchema>;
export type WelcomeMessage = z.infer<typeof WelcomeMessageSchema>;

/**
 * A parsed message, or why it was refused: `unsupported-version` when it carries a protocol
 * version this side doesn't speak, `invalid` for anything else wrong with it.
 */
export type ParseResult<T> =
  | { ok: true; message: T }
  | { ok: false; kind: "invalid" | "unsupported-version"; error: string };

/** Validates a message an office server received from a data layer. */
export function parseDataLayerMessage(value: unknown): ParseResult<DataLayerMessage> {
  return parse(DataLayerMessageSchema, value);
}

/** Validates a message a data layer received from an office server. */
export function parseOfficeServerMessage(value: unknown): ParseResult<OfficeServerMessage> {
  return parse(OfficeServerMessageSchema, value);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  // The version is checked first, so a newer peer is told so rather than given a field-by-field
  // list of what changed.
  if (typeof value === "object" && value !== null && "v" in value && typeof value.v === "number" && value.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      kind: "unsupported-version",
      error: `protocol version ${JSON.stringify(value.v)} is not supported; this side speaks version ${PROTOCOL_VERSION}`,
    };
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, message: result.data };
  return { ok: false, kind: "invalid", error: z.prettifyError(result.error) };
}
