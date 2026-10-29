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
// The runner (src/runner) uses the same link with its own hello and no facts. The server's
// requests, releases and handoffs go to `onMessage`, and the runner's replies and refusals go out
// through `send`. One sent while the link is down waits, and goes out after the next hello, within
// OUTBOX_MAX and OUTBOX_MAX_AGE_MS.

import {
  parseOfficeServerMessage,
  PROTOCOL_VERSION,
  type DataLayerMessage,
  type Facts,
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
  onNotWanted?: () => void;
  /** Takes the server's requests, releases and handoffs; without it they are logged as not handled. */
  onMessage?: (message: ServerAsk) => void;
  random?: () => number;
}

/** What a runner sends back: a reply, a refusal, or what it did with a handoff it took. */
type Outgoing = ReplyMessage | RefusalMessage | TakenMessage;

/** What the server asks of a machine, rather than of a session's facts. */
export type ServerAsk = RequestMessage | ReleaseMessage | HandoffMessage;

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
  onNotWanted,
  onMessage,
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

  function connect() {
    retry = null;
    emit({ type: "status", server: url, state: "connecting" });
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      failures = 0;
      isOpen = true;
      seq = 0;
      send(hello);
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
    if (isClosed) return;
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
    } else if (message.type === "conflict" || message.type === "error") {
      emit(message);
      if (message.type === "error" && message.code === "not-wanted") {
        isUnwanted = true;
        onNotWanted?.();
      }
    } else if (onMessage && (message.type === "request" || message.type === "release" || message.type === "handoff")) {
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
      socket?.close();
    },
  };
}
