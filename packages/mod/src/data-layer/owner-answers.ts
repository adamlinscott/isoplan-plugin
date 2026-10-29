// An owner's answer from the floor (#50): the office server sends an owner-answer request down this
// session's link, and the data layer passes it to the hooks module (src/hooks/register.ts), whose
// AskUserQuestion call is waiting for it. The hooks module writes back, in the file the line names,
// whether the answer ended the call, and the server is told: a reply when it did, a refusal saying
// why when it didn't. Only the plugin's own data layer can pass it on: a detached one, for a session
// seen only through the wake hook, has no hooks module, so its questions are answered in the terminal.

import { PROTOCOL_VERSION, type Facts, type RefusalMessage, type ReplyMessage, type RequestMessage } from "@isoplan/protocol";
import type { AnswerTaken, DataLayerLine } from "../lines.js";

// How long the hooks module has to say whether it took the answer, and how often its file is looked for.
const TAKEN_WAIT_MS = 10000;
const POLL_MS = 100;

export interface OwnerAnswerOptions {
  detached: boolean;
  /** The facts last sent, whose questions are the ones still open. */
  facts: Facts | null;
  /** Where the hooks module writes whether it took the answer. */
  file: string;
  emit: (line: DataLayerLine) => void;
  /** The file's JSON text, or null while it isn't there or doesn't parse; reading it removes it. */
  take: (file: string) => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
}

type OwnerAnswer = Extract<RequestMessage, { kind: "owner-answer" }>;

/** What to send back for the request: a reply once the answer ended the question's call, or a refusal saying why not. */
export async function relayOwnerAnswer(request: OwnerAnswer, { detached, facts, file, emit, take, sleep = wait, waitMs = TAKEN_WAIT_MS }: OwnerAnswerOptions): Promise<ReplyMessage | RefusalMessage> {
  const refuse = (detail: string): RefusalMessage => ({ type: "refusal", v: PROTOCOL_VERSION, id: request.id, reason: "unavailable", detail });
  if (detached) return refuse("This session is seen only through Isoplan's wake hook, so its question can only be answered in its terminal.");
  if (!facts?.questions?.some((q) => q.id === request.question)) return refuse("The question isn't waiting for an answer any more: it was answered in the terminal, or the agent moved on.");
  emit({ type: "owner-answer", question: request.question, answers: request.answers, file });
  for (let waited = 0; waited < waitMs; waited += POLL_MS) {
    await sleep(POLL_MS);
    const text = await take(file);
    if (text === null) continue;
    let taken: Partial<AnswerTaken> = {};
    try {
      taken = JSON.parse(text);
    } catch {}
    if (taken.taken === true) return { type: "reply", v: PROTOCOL_VERSION, id: request.id, kind: "owner-answer" };
    return refuse("The question was answered in the terminal first.");
  }
  return refuse("Claude Code didn't take the answer in time: answer it in the terminal.");
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
