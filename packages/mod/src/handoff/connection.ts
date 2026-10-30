// A short link to the office server for the handoff commands: the session's hello, then one
// exchange (hand-over and its answer; take, its handoff, then taken), then it closes. It sends no
// facts, so the session's own data layer stays the one that reports it.
// With sign-in on, the hello carries this machine's pairing token (#23). A command only reads the
// pairing: it renews a token for itself alone when the kept one has run out or the server says so,
// and never takes the pairing's locks, writes pairing.json or starts a pairing; when the machine
// needs pairing it says so and points at the link a Claude Code session shows.

import { parseOfficeServerMessage, type DataLayerMessage, type HelloMessage, type OfficeServerMessage } from "@isoplan/protocol";

export interface SideLink {
  send(message: DataLayerMessage): void;
  /** The next message `wanted` accepts, or the server's error; rejects when the link closes or the time runs out. */
  next<T extends OfficeServerMessage>(wanted: (m: OfficeServerMessage) => m is T, timeoutMs: number): Promise<T | Extract<OfficeServerMessage, { type: "error" }>>;
  /** Closes once what was sent has gone. */
  close(): Promise<void>;
}

export async function openSideLink(url: string, hello: HelloMessage, timeoutMs: number): Promise<SideLink> {
  const ws = new WebSocket(url);
  const inbox: OfficeServerMessage[] = [];
  let wake: () => void = () => {};
  let closed = false;
  ws.onmessage = (event) => {
    let value: unknown;
    try {
      value = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const parsed = parseOfficeServerMessage(value);
    if (parsed.ok) inbox.push(parsed.message);
    wake();
  };
  ws.onclose = () => {
    closed = true;
    wake();
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => (ws.close(), reject(new Error(`couldn't reach the office server at ${url}`))), timeoutMs);
    ws.onopen = () => (clearTimeout(timer), resolve());
    ws.onerror = () => (clearTimeout(timer), reject(new Error(`couldn't reach the office server at ${url}`)));
  });
  ws.onerror = () => {};
  ws.send(JSON.stringify(hello));
  return {
    send: (message) => ws.send(JSON.stringify(message)),
    async next(wanted, ms) {
      const end = Date.now() + ms;
      for (;;) {
        const i = inbox.findIndex((m) => m.type === "error" || wanted(m));
        if (i >= 0) return inbox.splice(i, 1)[0] as never;
        if (closed) throw new Error("the office server closed the link");
        const left = end - Date.now();
        if (left <= 0) throw new Error("the office server didn't answer in time");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, left);
          wake = () => (clearTimeout(timer), resolve());
        });
      }
    },
    async close() {
      if (closed) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const gone = new Promise<void>((resolve) => (ws.onclose = () => resolve()));
      ws.close();
      await Promise.race([gone, new Promise((r) => (timer = setTimeout(r, 2000)))]);
      clearTimeout(timer);
    },
  };
}

/** What a command is told when this machine has to be paired (again) before the office takes it (#23). */
export const NEEDS_PAIRING =
  "This machine needs pairing with the office before it takes this: open Claude Code on this computer to see its \"Pair this machine\" link in the status line, approve it in the office, then run this again.";

/** What a command is told when the office server refuses its hello for this machine's pairing. */
export const PAIRING_REFUSED: Record<"not-paired" | "pairing-ended" | "forged-hello", string> = {
  "not-paired": NEEDS_PAIRING,
  "pairing-ended": `This machine's pairing with the office has ended (it was revoked, or it lapsed). ${NEEDS_PAIRING}`,
  "forged-hello": "The office server says another paired machine reports this session, so it won't take this from here.",
};

/** The office server refused the command's hello for this machine's pairing; the message says what to do. */
export class PairingRefused extends Error {}

/** This machine's pairing, as a command uses it: only ever read, and renewed for the command alone. */
export interface CommandPairing {
  /**
   * The token for the hello, or undefined when this machine holds no credential; with `renew`, a new
   * one even if the kept one looks current. Throws PairingRefused when it can't be had. Never takes
   * the pairing's locks, writes pairing.json or starts a pairing: the session's data layer does those.
   */
  token(renew: boolean): Promise<string | undefined>;
}

/**
 * Opens a side link as this machine's pairing and sends `first`, returning the link and the first
 * answer `wanted` accepts (or the server's error). A hello refused as token-expired is tried once
 * more with a renewed token: the server reads nothing after a hello it refuses, so `first` hadn't
 * been acted on. A refusal for the pairing itself throws PairingRefused, saying what to do.
 */
export async function openPairedLink<T extends OfficeServerMessage>(
  url: string,
  hello: HelloMessage,
  pairing: CommandPairing,
  first: DataLayerMessage,
  wanted: (m: OfficeServerMessage) => m is T,
  timeoutMs: number,
): Promise<{ link: SideLink; answer: T | Extract<OfficeServerMessage, { type: "error" }> }> {
  for (let renewed = false; ; renewed = true) {
    const token = await pairing.token(renewed);
    const link = await openSideLink(url, token ? { ...hello, token } : hello, timeoutMs);
    let answer: T | Extract<OfficeServerMessage, { type: "error" }>;
    try {
      link.send(first);
      answer = await link.next(wanted, timeoutMs);
    } catch (err) {
      await link.close();
      throw err;
    }
    const code = answer.type === "error" ? answer.code : null;
    if (code !== "token-expired" && code !== "not-paired" && code !== "pairing-ended" && code !== "forged-hello") return { link, answer };
    await link.close();
    if (code === "token-expired" && token && !renewed) continue;
    throw new PairingRefused(
      code !== "token-expired"
        ? PAIRING_REFUSED[code]
        : token
          ? `The office server refused this machine's token, even renewed. ${NEEDS_PAIRING}`
          : `The office server says this machine's token has run out, though none was sent: this machine holds no pairing for it. ${NEEDS_PAIRING}`,
    );
  }
}
