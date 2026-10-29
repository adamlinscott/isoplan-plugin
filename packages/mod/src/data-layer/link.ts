// The live link to the office server (#3, #6): on every connect a hello, then the session's facts
// in full, then only what changed, at most once a second, `seq` going up by one per message. A
// repair from the server gets the facts in full again. A dropped link reconnects with capped
// exponential backoff and jitter, and starts over with hello and full. Nothing is kept while the
// link is down: it is a live view, not a log.
//
// The server's conflict notes and errors, and the link's own state, go out through `emit` as
// stdout lines for the hooks module.
//
// A server that answers `not-wanted` holds this project in no office: the link calls `onNotWanted`
// and waits, asking again once an hour rather than backing off fast. Only the plugin's data layer
// sees that hour out; a detached one exits on `onNotWanted` (main.ts).
//
// An office server that signs people in wants the machine paired (pairing.ts): each try first takes
// a token from `pairing`, and sends it in the hello. A hello refused as `not-paired`,
// `pairing-ended` or `token-expired` is told to `pairing`, which pairs or renews, and the link tries
// again: after retryBaseMs the first time, then backing off, doubling up to retryCapMs, until a
// link stays up STABLE_MS. A token that ran out on a link that stayed up (the server closes it then)
// is renewed and the link opened again at once, with no `disconnected` in between. While a link to
// pair waits to be clicked the link shows `pairing` and looks again every `pairPollMs`.
//
// `forged-hello` means the session belongs to someone else on the office: the link shows `taken`
// and stops, asking again only after `takenRetryMs`, in case an admin has released it.
//
// The runner (src/runner) uses the same link with its own hello and no facts. The server's
// requests, releases and handoffs go to `onMessage`, and the runner's replies and refusals go out
// through `send`. One sent while the link is down waits, and goes out after the next hello, within
// OUTBOX_MAX and OUTBOX_MAX_AGE_MS.

import {
  parseOfficeServerMessage,
  PROTOCOL_VERSION,
  type DataLayerMessage,
  type Facts,
  type DropMessage,
  type HandoffMessage,
  type HelloMessage,
  type RefusalMessage,
  type ReleaseMessage,
  type ReplyMessage,
  type RequestMessage,
  type RunnerHelloMessage,
  type TakenMessage,
} from "@isoplan/protocol";
import type { DataLayerLine } from "../lines.js";
import { diffFacts } from "./changes.js";
import type { Pairing } from "./pairing.js";

// A link up this long without being refused counts as let in: refusals are counted from zero again.
const STABLE_MS = 30000;

// Replies kept while the link is down: at most this many, the oldest dropped first, and none older
// than this, which the server will have asked again for by then.
const OUTBOX_MAX = 100;
const OUTBOX_MAX_AGE_MS = 3600000;

export interface LinkOptions {
  url: string;
  hello: HelloMessage | RunnerHelloMessage;
  emit: (line: DataLayerLine) => void;
  /** The least time between two messages of facts; a repair's full doesn't wait. */
  minIntervalMs?: number;
  /** The first retry's delay, doubled per failed try up to `retryCapMs`. */
  retryBaseMs?: number;
  retryCapMs?: number;
  /** How long a link the server didn't want waits before asking again. */
  notWantedRetryMs?: number;
  /** How long a link refused as forged-hello waits before asking again. */
  takenRetryMs?: number;
  onNotWanted?: () => void;
  /** The server said this machine's pairing has ended, once `pairing` has dropped the credential. */
  onPairingEnded?: () => void;
  /** Takes the server's requests, releases and handoffs; without it they are logged as not handled. */
  onMessage?: (message: ServerAsk) => void;
  /** Where the hello's token comes from, for a server that signs people in. */
  pairing?: Pairing;
  /** How often a link waiting for its code to be approved asks again. */
  pairPollMs?: number;
  random?: () => number;
}

/** What a runner sends back: a reply, a refusal, or what it did with a handoff it took. */
type Outgoing = ReplyMessage | RefusalMessage | TakenMessage;

/** What the server asks of a machine, rather than of a session's facts. */
export type ServerAsk = RequestMessage | ReleaseMessage | HandoffMessage | DropMessage;

export interface Link {
  /** The session's facts now; what differs from what the server has goes out when the pace allows. */
  update(facts: Facts): void;
  /** A reply, refusal or taken. One sent while the link is down goes out after the next hello. */
  send(message: Outgoing): void;
  close(): void;
}

export function createLink({
  url,
  hello,
  emit,
  minIntervalMs = 1000,
  retryBaseMs = 1000,
  retryCapMs = 30000,
  notWantedRetryMs = 3600000,
  takenRetryMs = 3600000,
  onNotWanted,
  onPairingEnded,
  onMessage,
  pairing,
  pairPollMs = 5000,
  random = Math.random,
}: LinkOptions): Link {
  const outbox: { message: Outgoing; at: number }[] = [];
  let latest: Facts | null = null;
  let socket: WebSocket | null = null;
  let isOpen = false;
  let sent: Facts | null = null; // what the server has, on this connection
  let seq = 0;
  let sentAt = -Infinity;
  let failures = 0; // tries in a row that didn't open
  let pacing: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let isClosed = false;
  let isUnwanted = false; // the server said not-wanted on this connection
  let sentToken: string | undefined; // the token this connection's hello carried
  let refusing: Promise<void> = Promise.resolve(); // telling `pairing` of a refused hello
  let isRefused = false; // the server refused this connection's hello for its token
  let refusedFor: string | null = null; // why
  let isTaken = false; // the server said the session belongs to someone else
  let refusals = 0; // hellos refused for their token, in a row
  let stable: ReturnType<typeof setTimeout> | null = null; // counts refusals from zero once the link has stayed up

  function connect() {
    retry = null;
    if (!pairing) return open(undefined);
    void refusing
      .then(() => pairing.token())
      .then(
        (token) => {
          if (isClosed) return;
          if (token !== null) return open(token);
          emit({ type: "status", server: url, state: "pairing" });
          retry = setTimeout(connect, pairPollMs);
        },
        (err: unknown) => {
          if (isClosed) return;
          emit({ type: "log", text: `couldn't pair with the office server: ${String((err as Error)?.message ?? err)}` });
          dropped();
        },
      );
  }

  function open(token: string | undefined) {
    emit({ type: "status", server: url, state: "connecting" });
    const ws = new WebSocket(url);
    socket = ws;
    sentToken = token;
    ws.onopen = () => {
      if (socket !== ws) return;
      failures = 0;
      isOpen = true;
      seq = 0;
      stable = setTimeout(() => (refusals = 0), STABLE_MS);
      send(token ? { ...hello, token } : hello);
      for (const { message, at } of outbox.splice(0)) if (Date.now() - at < OUTBOX_MAX_AGE_MS) send(message);
      sendFull();
      emit({ type: "status", server: url, state: "connected" });
    };
    ws.onmessage = (event) => {
      if (socket === ws) receive(event.data);
    };
    // Either event is the drop, handled once per socket: Node 22's WebSocket fires only `error`
    // for a connection that never opened (refused, failed handshake), with no `close` after it.
    ws.onerror = () => {
      if (socket !== ws) return;
      dropped();
      try {
        ws.close();
      } catch {
        // Not open yet: nothing to close.
      }
    };
    ws.onclose = () => {
      if (socket === ws) dropped();
    };
  }

  function dropped() {
    socket = null;
    isOpen = false;
    sent = null;
    if (pacing) clearTimeout(pacing);
    pacing = null;
    if (stable) clearTimeout(stable);
    stable = null;
    if (isClosed) return;
    if (isTaken) {
      isTaken = false;
      emit({ type: "status", server: url, state: "taken" });
      retry = setTimeout(connect, takenRetryMs);
      return;
    }
    // Refusals back off on their own count: the socket opened each time, which resets `failures`.
    if (isRefused) {
      isRefused = false;
      // A token that ran out on a link that had stayed up is renewed at once, unseen.
      if (refusedFor === "token-expired" && refusals === 0) {
        refusals++;
        retry = setTimeout(connect, 0);
        return;
      }
      const delay = Math.min(retryCapMs, retryBaseMs * 2 ** refusals++);
      emit({ type: "status", server: url, state: "disconnected", retryInMs: delay });
      retry = setTimeout(connect, delay);
      return;
    }
    if (isUnwanted) {
      isUnwanted = false;
      failures = 0;
      emit({ type: "status", server: url, state: "not-wanted" });
      retry = setTimeout(connect, notWantedRetryMs);
      return;
    }
    const delay = Math.min(retryCapMs, retryBaseMs * 2 ** failures++);
    // Equal jitter: half the delay fixed, half random, so a server restart isn't met by every
    // data layer at once.
    const retryInMs = Math.round(delay / 2 + (random() * delay) / 2);
    emit({ type: "status", server: url, state: "disconnected", retryInMs });
    retry = setTimeout(connect, retryInMs);
  }

  function send(message: DataLayerMessage) {
    socket!.send(JSON.stringify(message));
  }

  function sendFull() {
    if (!latest) return;
    send({ type: "full", v: PROTOCOL_VERSION, seq: seq++, facts: latest });
    sent = latest;
    sentAt = Date.now();
  }

  function flush() {
    pacing = null;
    if (!isOpen || !latest || !sent) return;
    const changed = diffFacts(sent, latest);
    if (!changed) return;
    const wait = sentAt + minIntervalMs - Date.now();
    if (wait > 0) {
      pacing = setTimeout(flush, wait);
      return;
    }
    send({ type: "changes", v: PROTOCOL_VERSION, seq: seq++, ...changed });
    sent = latest;
    sentAt = Date.now();
  }

  function receive(data: unknown) {
    let value: unknown;
    try {
      value = JSON.parse(String(data));
    } catch {
      emit({ type: "log", text: "the office server sent a message that isn't JSON" });
      return;
    }
    const parsed = parseOfficeServerMessage(value);
    if (!parsed.ok) {
      emit({ type: "log", text: `the office server sent a message this data layer can't read (${parsed.kind}): ${parsed.error}` });
      return;
    }
    const message = parsed.message;
    if (message.type === "repair") {
      if (pacing) clearTimeout(pacing);
      pacing = null;
      sendFull();
    } else if (message.type === "conflict" && !latest?.agents.some((a) => a.id === message.agent)) {
      // A note reaches a model's context, so only one for an agent of this session is taken.
      emit({ type: "log", text: `the office server sent a note for ${message.agent}, not an agent of this session` });
    } else if (pairing && message.type === "error" && (message.code === "not-paired" || message.code === "pairing-ended" || message.code === "token-expired")) {
      isRefused = true;
      refusedFor = message.code;
      refusing = pairing.refused(message.code, sentToken).catch(() => {});
      if (message.code === "pairing-ended" && onPairingEnded) void refusing.then(onPairingEnded);
      // The server's own words on how to pair are passed on; a renewal is the link's own business.
      emit(message.code === "token-expired" ? { type: "log", text: "the office server says this machine's token has expired; renewing it" } : message);
    } else if (message.type === "error" && message.code === "forged-hello") {
      isTaken = true;
      emit(message);
    } else if (message.type === "conflict" || message.type === "error") {
      emit(message);
      if (message.type === "error" && message.code === "not-wanted") {
        isUnwanted = true;
        onNotWanted?.();
      }
    } else if (onMessage && (message.type === "request" || message.type === "release" || message.type === "handoff" || message.type === "drop")) {
      onMessage(message);
    } else {
      emit({ type: "log", text: `the office server sent a ${message.type} message, which this data layer doesn't handle yet` });
    }
  }

  connect();

  return {
    update(facts) {
      latest = facts;
      if (isOpen && !sent) sendFull();
      else if (!pacing) flush();
    },
    send(message) {
      if (isOpen && socket!.readyState === WebSocket.OPEN) send(message);
      else {
        outbox.push({ message, at: Date.now() });
        if (outbox.length > OUTBOX_MAX) outbox.shift();
      }
    },
    close() {
      isClosed = true;
      if (pacing) clearTimeout(pacing);
      if (retry) clearTimeout(retry);
      if (stable) clearTimeout(stable);
      void pairing?.close();
      socket?.close();
    },
  };
}
