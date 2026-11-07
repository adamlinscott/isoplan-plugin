// A message the owner sends their open session from the floor (#77): a session opened in a
// terminal, Orca or anywhere else, not one the runner drives.
//
// The office server sends an owner-message request down this session's link. The data layer takes
// it only from the session's owner (the account its hello names; the server checks too), and only
// when its hooks module said, as it started this data layer (`--messages`), that its Claude Code can
// submit a prompt for a plugin: then the session fact says `takesMessages`, and the floor offers it.
// It passes the text to the hooks module, which submits it as a turn of its own, after the running
// turn and any message before it, and writes in the file the line names whether it went in. The
// server gets a reply once it went in, or with `queued` once the session accepted it to run after
// the running turn (it hasn't gone in yet then), and a refusal with a plain
// reason and its code otherwise. The runner, reporting a session without a hooks module, has none to
// pass it to, so its session takes none.

import { PROTOCOL_VERSION, type OwnerMessageRefusal, type RefusalMessage, type ReplyMessage, type RequestMessage } from "@isoplan/protocol";
import type { DataLayerLine, MessageTaken } from "../lines.js";

// How long the hooks module has to say whether it took the message, and how often its file is looked for.
const TAKEN_WAIT_MS = 10000;
const POLL_MS = 100;

/** What the floor is told for each refusal. */
export const REFUSED: Record<OwnerMessageRefusal, string> = {
  "not-owner": "Only the session's owner can send it messages.",
  detached: "This session runs without Isoplan's plugin loaded, so it can't take messages from the floor. Type the message in its terminal.",
  "no-submit": "This session's version of Claude Code can't take messages from Isoplan. Update Claude Code, or type the message in its terminal.",
  ended: "This session has ended, or carried on as a new one, so the message wasn't sent.",
  dropped: "Claude Code didn't let the message in. Type it in the session's terminal.",
  "no-answer": "The session didn't say whether it took the message, and it may have closed. Check its terminal before sending it again.",
};

export interface OwnerMessageOptions {
  detached: boolean;
  /** The hooks module said, as it started this data layer, that it can submit a message. */
  takes: boolean;
  /** The session owner's account id, as its hello names it. */
  owner: string;
  /** This data layer's session id, which the hooks module checks the process still runs. */
  session: string;
  /** Where the hooks module writes whether it took the message. */
  file: string;
  emit: (line: DataLayerLine) => void;
  /** The file's JSON text, or null while it isn't there or doesn't parse; reading it removes it. */
  take: (file: string) => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
}

type OwnerMessage = Extract<RequestMessage, { kind: "owner-message" }>;

/** A reply once the hooks module says the message went in; a refusal saying why not otherwise. */
export async function relayOwnerMessage(request: OwnerMessage, { detached, takes, owner, session, file, emit, take, sleep = wait, waitMs = TAKEN_WAIT_MS }: OwnerMessageOptions): Promise<ReplyMessage | RefusalMessage> {
  const refuse = (code: OwnerMessageRefusal): RefusalMessage => ({ type: "refusal", v: PROTOCOL_VERSION, id: request.id, reason: "unavailable", detail: REFUSED[code], code });
  if (request.from.id !== owner) return refuse("not-owner");
  if (detached) return refuse("detached");
  if (!takes) return refuse("no-submit");
  emit({ type: "owner-message", session, text: request.text, file });
  for (let waited = 0; waited < waitMs; waited += POLL_MS) {
    await sleep(POLL_MS);
    const taken = parse(await take(file));
    if (!taken) continue;
    if (taken.taken) return { type: "reply", v: PROTOCOL_VERSION, id: request.id, kind: "owner-message", ...(taken.queued ? { queued: true as const } : {}) };
    return refuse(taken.reason);
  }
  return refuse("no-answer");
}

// The hooks module's word, or null while there is none it could have meant.
function parse(text: string | null): MessageTaken | null {
  if (text === null) return null;
  let said: Partial<{ taken: unknown; queued: unknown; reason: unknown }>;
  try {
    said = JSON.parse(text);
  } catch {
    return null;
  }
  if (said?.taken === true) return said.queued === true ? { taken: true, queued: true } : { taken: true };
  if (said?.taken === false && (said.reason === "no-submit" || said.reason === "ended" || said.reason === "dropped")) return { taken: false, reason: said.reason };
  return null;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
