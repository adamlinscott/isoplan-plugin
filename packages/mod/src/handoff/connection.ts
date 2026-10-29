// A short link to the office server for the handoff commands: the session's hello, then one
// exchange (hand-over and its answer; take, its handoff, then taken), then it closes. It sends no
// facts, so the session's own data layer stays the one that reports it.

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
    const timer = setTimeout(() => reject(new Error(`couldn't reach the office server at ${url}`)), timeoutMs);
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
          wake = resolve;
          setTimeout(resolve, left);
        });
      }
    },
    async close() {
      if (closed) return;
      const gone = new Promise<void>((resolve) => (ws.onclose = () => resolve()));
      ws.close();
      await Promise.race([gone, new Promise((r) => setTimeout(r, 2000))]);
    },
  };
}
