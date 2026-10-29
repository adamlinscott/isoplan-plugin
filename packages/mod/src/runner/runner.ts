// What the runner does with the office server's requests. A question (answer-question) or a brief
// (write-brief) is answered from a fork of the room's lead, through the answerer (answerer.ts):
//
// 1. One at a time per room: a request waits for the one before it in the same room to finish.
// 2. The lead: a session this machine doesn't have, a folder that is gone or a lead mid-turn is
//    refused `unavailable`. A compacted lead is answered, with a note saying so.
// 3. Caps (caps.ts): over one, it is refused `over-cap` with the cap's name. One that passes
//    reserves its estimate at once, so a request in another room counts it.
// 4. The fork answers, and the reservation is settled to what it used.
// 5. The secret scan (scan.ts): a match is refused `withheld` and the reply is held; the owner's
//    `release` sends it. A release that arrives while its request is still running is applied
//    when the reply lands. Held replies are kept in memory, at most MAX_HELD, so a runner that
//    restarted refuses a release with the reason.
//
// Nothing from the fork's output, or from the machine's folders, leaves without the scan: an
// `unavailable` refusal says only what kind of problem it was, and the details go to the local log.
//
// A request id seen before isn't run again: one still running is left to finish, and one that
// finished gets the same answer again, so a server that asks twice doesn't pay twice.
//
// A brief's reply also carries the repos pushed for the handoff, which is the handoff's own work
// (#48); without `push` a write-brief is refused before the fork runs. owner-answer requests go to
// the live session, not the runner (#50), and handoffs to take are #48's; both are refused or logged.

import { PROTOCOL_VERSION, type HandoffRepo, type RefusalMessage, type ReplyMessage, type RequestMessage } from "@isoplan/protocol";
import type { ServerAsk } from "../data-layer/link.js";
import type { Answerer, FailureKind, Lead } from "./answerer.js";
import { estimate, overCap, type Cap, type CapSettings, type Ledger } from "./caps.js";
import { fill, type Prompts } from "./prompts.js";

/** What runner.json says, as the runner uses it. */
export interface RunnerSettings extends CapSettings {
  answerTimeoutSeconds: number;
  briefTimeoutSeconds: number;
}

type Outgoing = ReplyMessage | RefusalMessage;
type Ask = Extract<RequestMessage, { kind: "answer-question" | "write-brief" }>;

export interface RunnerOptions {
  answerer: Answerer;
  ledger: Ledger;
  /** Read for every request, so an edit to a file takes effect without a restart. */
  settings: () => Promise<RunnerSettings>;
  prompts: () => Promise<Prompts>;
  /** The name of the secret pattern `text` matches, or null. */
  scan: (text: string) => Promise<string | null>;
  send: (message: Outgoing) => void;
  log: (text: string) => void;
  isDir: (path: string) => Promise<boolean>;
  /** Pushes the handoff's work and returns its repos (#48); without it, briefs are refused. */
  push?: (session: string, lead: Lead, handoff: string) => Promise<HandoffRepo[]>;
  now?: () => number;
}

export interface Runner {
  take(message: ServerAsk): void;
  /** True when nothing is queued or running. */
  idle(): boolean;
  /** Resolves once everything queued now has finished. */
  settled(): Promise<void>;
}

// Finished requests remembered, newest last, so a repeat gets the same answer.
const REMEMBER = 200;
// Withheld replies kept for release; past this the oldest is dropped.
export const MAX_HELD = 50;

export const COMPACTED_NOTE = "Note from Isoplan: this session was compacted, so its earlier work survives only as a summary and the details may be thin.";

/** What the server is told for each kind of fork failure. */
const FAILED: Record<FailureKind, string> = {
  "timed-out": "the fork took too long to answer",
  failed: "the fork couldn't answer",
  "not-set-up": "this machine can't run the fork; its owner can see why in the runner's log",
};

export function createRunner({ answerer, ledger, settings, prompts, scan, send, log, isDir, push, now = Date.now }: RunnerOptions): Runner {
  const rooms = new Map<string, Promise<void>>(); // each room's last queued request
  const running = new Set<string>(); // ids queued or running
  const finished = new Map<string, Outgoing>(); // id → what was last sent for it
  const held = new Map<string, () => Promise<ReplyMessage>>(); // withheld replies, by id, oldest first
  const released = new Set<string>(); // released while still running

  const unavailable = (id: string, detail: string): RefusalMessage => ({ type: "refusal", v: PROTOCOL_VERSION, id, reason: "unavailable", detail });
  const overCapRefusal = (id: string, cap: Cap): RefusalMessage => ({ type: "refusal", v: PROTOCOL_VERSION, id, reason: "over-cap", cap });

  function deliver(id: string, message: Outgoing) {
    finished.delete(id);
    finished.set(id, message);
    if (finished.size > REMEMBER) finished.delete(finished.keys().next().value!);
    send(message);
  }

  async function answer(request: Ask): Promise<Outgoing> {
    const { id, room, session } = request;
    const lead = await answerer.lead(session);
    if (!lead) return unavailable(id, "this machine has no such session");
    if (!(await isDir(lead.cwd))) {
      log(`${id}: the folder of ${session}, ${lead.cwd}, is gone`);
      return unavailable(id, "the session's folder is gone, so its lead can't be asked");
    }
    if (lead.working) return unavailable(id, "the session's lead is mid-turn; ask again once its turn ends");
    if (request.kind === "write-brief" && !push) return unavailable(id, "this plugin version can't hand a room over from the floor yet");

    const s = await settings();
    const p = await prompts();
    const expected = estimate(lead.context, s);
    // Checked and reserved with no await between, so two rooms can't both take the last of a cap.
    const cap = overCap(ledger.entries(now()), room, expected, now(), s);
    if (cap) return overCapRefusal(id, cap);
    const settle = ledger.reserve({ at: now(), room, usage: expected });

    const isBrief = request.kind === "write-brief";
    const text = isBrief ? fill(p.brief, { to: request.to.name || request.to.id }) : fill(p.question, { from: request.from.name || request.from.id, question: request.question });
    const answered = await answerer.ask(session, lead, { instructions: p.instructions, request: text, timeoutMs: (isBrief ? s.briefTimeoutSeconds : s.answerTimeoutSeconds) * 1000 });
    // A fork that failed before it was metered keeps its estimate.
    await settle(answered.usage ?? expected).catch((err: unknown) => log(`couldn't record ${id} in the ledger: ${(err as Error).message}`));
    if (!answered.ok) {
      log(`${id}: ${answered.detail}`);
      return unavailable(id, FAILED[answered.kind]);
    }

    const body = lead.compacted ? `${COMPACTED_NOTE}\n\n${answered.text}` : answered.text;
    const reply: () => Promise<ReplyMessage> = isBrief
      ? async () => ({ type: "reply", v: PROTOCOL_VERSION, id, kind: "write-brief", handoff: { id: request.handoff, brief: body, repos: await push!(session, lead, request.handoff) } })
      : async () => ({ type: "reply", v: PROTOCOL_VERSION, id, kind: "answer-question", answer: body });
    const matched = await scan(body);
    if (!matched) return reply();
    log(`withheld the ${isBrief ? "brief" : "answer"} for ${id} in ${room}: it matches the secret pattern "${matched}"`);
    if (released.delete(id)) {
      log(`${id} was released while it was being written, so it is sent`);
      return reply();
    }
    held.set(id, reply);
    if (held.size > MAX_HELD) {
      const oldest = held.keys().next().value!;
      held.delete(oldest);
      log(`dropped the withheld reply for ${oldest}: more than ${MAX_HELD} are held`);
    }
    return { type: "refusal", v: PROTOCOL_VERSION, id, reason: "withheld" };
  }

  async function release(id: string) {
    const reply = held.get(id);
    if (!reply) {
      if (running.has(id)) {
        released.add(id);
        return;
      }
      const sent = finished.get(id);
      if (sent?.type === "reply") send(sent);
      else send(unavailable(id, "nothing is withheld under this id here; the runner may have restarted since, so ask again"));
      return;
    }
    held.delete(id);
    try {
      deliver(id, await reply());
    } catch (err) {
      log(`${id}: couldn't send the released reply: ${(err as Error).message}`);
      deliver(id, unavailable(id, "the released reply couldn't be sent"));
    }
  }

  return {
    take(message) {
      if (message.type === "release") {
        void release(message.id);
        return;
      }
      if (message.type === "handoff") {
        log(`the office server sent handoff ${message.handoff.id} to take, which this runner doesn't handle yet`);
        return;
      }
      if (message.kind === "owner-answer") {
        send(unavailable(message.id, "an owner's answer goes to the live session, not the runner"));
        return;
      }
      const request = message;
      const { id, room } = request;
      if (running.has(id)) return;
      const sent = finished.get(id);
      if (sent) {
        send(sent);
        return;
      }
      running.add(id);
      const turn = (rooms.get(room) ?? Promise.resolve())
        .then(() => answer(request))
        .catch((err: unknown) => {
          log(`${id}: the runner failed: ${(err as Error)?.stack ?? String(err)}`);
          return unavailable(id, "the runner failed");
        })
        .then((message) => deliver(id, message))
        .finally(() => {
          running.delete(id);
          released.delete(id);
          if (rooms.get(room) === turn) rooms.delete(room);
        });
      rooms.set(room, turn);
    },
    idle: () => running.size === 0,
    async settled() {
      while (rooms.size) await Promise.all(rooms.values());
    },
  };
}
