// An agent's questions to its owner, as they leave the machine, and the owner's answers from the
// floor (#50).
//
// Each open question is secret-checked here with the patterns reports use (src/runner/scan.ts): one
// that matches, and every one while the patterns can't be read, goes out only as a placeholder,
// `withheld`, and is answered in the terminal. One that passes is `answerable` only while the hooks
// module (src/hooks/register.ts) has marked that it waits for it, so a question asked before the
// plugin loaded, or a call the hook never saw, stays read-only on the floor.
//
// The office server sends an owner-answer request down this session's link, and the data layer
// passes it to the hooks module, which writes back, in the file the line names, whether the answer
// ended the call; the server is told: a reply only when it did, a refusal saying why when it didn't.
// With no word in TAKEN_WAIT_MS, a question that has closed meanwhile gets a `closed` reply, which
// says it has an answer without saying whose; one still open is refused. Either way the word is
// looked for a minute longer, and a take that comes then is sent as a `late` reply.
// Only the plugin's own data layer can pass it on: a detached one, for a session seen only through
// the wake hook, has no hooks module, so its questions are answered in the terminal.

import { PROTOCOL_VERSION, type Facts, type RefusalMessage, type ReplyMessage, type RequestMessage } from "@isoplan/protocol";
import type { AnswerTaken, DataLayerLine } from "../lines.js";
import { scan, type Pattern } from "../runner/scan.js";

// How long the hooks module has to say whether it took the answer, and how often its file is looked for.
const TAKEN_WAIT_MS = 10000;
const POLL_MS = 100;
// How long a word that came too late is still looked for.
const LATE_MS = 60000;

/** What a withheld question says in place of its text. */
export const WITHHELD_QUESTION = "Held for its owner to check: the secret check found what may be a secret in this question, so it is answered in the terminal.";

/**
 * The facts with their questions as they are sent: each one the scan matches, or every one while
 * `patterns` is null, as a placeholder marked `withheld`; each other one `answerable` while `waiting`
 * holds its id, unless the source left part of it out.
 */
export function prepareQuestions(facts: Facts, patterns: Pattern[] | null, waiting: ReadonlySet<string>, log: (text: string) => void): Facts {
  if (!facts.questions?.length) return facts;
  const questions = facts.questions.map((q) => {
    const text = q.questions.flatMap((x) => [x.question, x.header, ...x.options.flatMap((o) => [o.label, o.description])]).join("\n");
    const matched = scan(text, patterns);
    if (matched) {
      log(`withheld the question ${q.id} of ${q.agent}: ${patterns ? `it matches the secret pattern "${matched}"` : "the secret patterns couldn't be read"}; it is answered in the terminal`);
      return { id: q.id, agent: q.agent, at: q.at, questions: [{ question: WITHHELD_QUESTION, header: "", options: [], multiSelect: false }], withheld: true as const };
    }
    // One the source couldn't take whole (a question or option it left out) can't be answered whole here.
    return waiting.has(q.id) && !q.extra?.incomplete ? { ...q, answerable: true as const } : q;
  });
  return { ...facts, questions };
}

export interface OwnerAnswerOptions {
  detached: boolean;
  /** The facts last sent, whose questions are the ones still open. */
  facts: () => Facts | null;
  /** Where the hooks module writes whether it took the answer. */
  file: string;
  emit: (line: DataLayerLine) => void;
  /** The file's JSON text, or null while it isn't there or doesn't parse; reading it removes it. */
  take: (file: string) => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
}

type OwnerAnswer = Extract<RequestMessage, { kind: "owner-answer" }>;

/**
 * What to send back for a request, and whether the hooks module's word may still come (`gaveUp`):
 * it never wrote it within `waitMs`, so `lateTake` watches for it after.
 */
export interface Relayed {
  message: ReplyMessage | RefusalMessage;
  gaveUp: boolean;
}

/**
 * A reply only once the hooks module says the answer ended the question's call; a refusal saying why
 * not otherwise. With no word from it in `waitMs`, a question that has closed since gets a `closed`
 * reply, which says only that it has an answer, the floor's or the terminal's.
 */
export async function relayOwnerAnswer(request: OwnerAnswer, { detached, facts, file, emit, take, sleep = wait, waitMs = TAKEN_WAIT_MS }: OwnerAnswerOptions): Promise<Relayed> {
  const refuse = (detail: string, gaveUp = false): Relayed => ({ message: { type: "refusal", v: PROTOCOL_VERSION, id: request.id, reason: "unavailable", detail }, gaveUp });
  const open = () => facts()?.questions?.find((q) => q.id === request.question);
  if (detached) return refuse("This session is seen only through Isoplan's wake hook, so its question can only be answered in its terminal.");
  const question = open();
  if (!question) return refuse("The question isn't waiting for an answer any more: it was answered in the terminal, or the agent moved on.");
  if (!question.answerable) return refuse("Isoplan's plugin isn't waiting for this question in its session, so answer it in its terminal.");
  emit({ type: "owner-answer", question: request.question, answers: request.answers, file });
  for (let waited = 0; waited < waitMs; waited += POLL_MS) {
    await sleep(POLL_MS);
    const taken = await takenFrom(take, file, request.question);
    if (taken === null) continue;
    if (taken) return { message: { type: "reply", v: PROTOCOL_VERSION, id: request.id, kind: "owner-answer" }, gaveUp: false };
    return refuse("The question was answered in the terminal first.");
  }
  if (!open()) return { message: { type: "reply", v: PROTOCOL_VERSION, id: request.id, kind: "owner-answer", closed: true }, gaveUp: true };
  return refuse("Claude Code didn't take the answer in time: answer it in the terminal.", true);
}

/**
 * After a request gave up: whether the hooks module still says, within `ms`, that it took the answer
 * (true), that it didn't (false), or nothing at all (null).
 */
export async function lateTake(question: string, file: string, take: OwnerAnswerOptions["take"], { sleep = wait, ms = LATE_MS } = {}): Promise<boolean | null> {
  for (let waited = 0; waited < ms; waited += POLL_MS) {
    await sleep(POLL_MS);
    const taken = await takenFrom(take, file, question);
    if (taken !== null) return taken;
  }
  return null;
}

// The hooks module's word in the file: true or false, or null while there is none for this question
// (another request's word can't be in this request's own file, but is passed over all the same).
async function takenFrom(take: OwnerAnswerOptions["take"], file: string, question: string): Promise<boolean | null> {
  const text = await take(file);
  if (text === null) return null;
  let taken: Partial<AnswerTaken> = {};
  try {
    taken = JSON.parse(text);
  } catch {}
  return taken.question === question ? taken.taken === true : null;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
