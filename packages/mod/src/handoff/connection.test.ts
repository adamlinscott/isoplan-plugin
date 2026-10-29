import type { AddressInfo } from "node:net";
import { PROTOCOL_VERSION, type HelloMessage, type HandOverReadyMessage, type OfficeServerMessage } from "@isoplan/protocol";
import { afterEach, expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { openPairedLink, PAIRING_REFUSED, PairingRefused, type CommandPairing } from "./connection.js";

const hello: HelloMessage = {
  type: "hello",
  v: PROTOCOL_VERSION,
  source: "claude-code",
  account: { id: "claude:4f9c", name: "Ada" },
  machine: { name: "sevengill" },
  session: "claude-code:s",
  project: { id: "github.com/adam/isoplan", name: "isoplan" },
};
// Fake tokens, split so no token-shaped string sits in the source.
const OLD = "tok" + "en-old";
const NEW = "tok" + "en-new";
const check = { type: "hand-over-check", v: PROTOCOL_VERSION, to: "Sam", handoff: "h1" } as const;
const ready = (m: OfficeServerMessage): m is HandOverReadyMessage => m.type === "hand-over-ready";

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

// An office server that answers each connection's hello as `answer` says: a refusal code, or none to take it.
async function office(answer: (token: unknown) => string | null) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => wss.once("listening", resolve));
  const hellos: unknown[] = [];
  const seen: string[] = [];
  wss.on("connection", (ws) => {
    let first = true;
    ws.on("message", (data) => {
      const m = JSON.parse(String(data));
      if (!first) {
        // Only a link whose hello was taken gets this far.
        seen.push(m.type);
        ws.send(JSON.stringify({ type: "hand-over-ready", v: PROTOCOL_VERSION, handoff: "h1", to: { id: "claude:sam", name: "Sam" } }));
        return;
      }
      first = false;
      hellos.push(m.token);
      const code = answer(m.token);
      if (code) {
        // As the office server does: what follows a refused hello is never read.
        ws.removeAllListeners("message");
        ws.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code, message: code }));
        ws.close(1008, code);
      }
    });
  });
  closers.push(() => new Promise((resolve) => wss.close(resolve)));
  return { url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/data-layer`, hellos, seen };
}

function pairing(tokens: (string | undefined)[]) {
  const refused: [string, string | undefined][] = [];
  const p: CommandPairing = { token: async () => tokens.shift(), refused: async (code, sent) => void refused.push([code, sent]) };
  return { p, refused };
}

test("the hello carries the machine's token; one refused as token-expired is sent again, renewed, and what it carried is acted on once", async () => {
  const server = await office((token) => (token === OLD ? "token-expired" : null));
  const { p, refused } = pairing([OLD, NEW]);
  const { link, answer } = await openPairedLink(server.url, hello, p, check, ready, 5000);
  await link.close();
  expect(answer.type).toBe("hand-over-ready");
  expect(server.hellos).toEqual([OLD, NEW]);
  expect(server.seen).toEqual(["hand-over-check"]);
  expect(refused).toEqual([["token-expired", OLD]]);
});

test("with no credential the hello has no token; a server that signs nobody in takes it", async () => {
  const server = await office(() => null);
  const { link } = await openPairedLink(server.url, hello, pairing([undefined]).p, check, ready, 5000);
  await link.close();
  expect(server.hellos).toEqual([undefined]);
});

test("not-paired, pairing-ended and forged-hello end the command with what to do, and never pair; pairing-ended drops what it sent", async () => {
  for (const code of ["not-paired", "pairing-ended", "forged-hello"] as const) {
    const server = await office(() => code);
    const { p, refused } = pairing([code === "not-paired" ? undefined : OLD]);
    const failed = await openPairedLink(server.url, hello, p, check, ready, 5000).catch((err: unknown) => err);
    expect(failed, code).toBeInstanceOf(PairingRefused);
    expect((failed as Error).message).toBe(PAIRING_REFUSED[code]);
    expect(refused).toEqual(code === "pairing-ended" ? [["pairing-ended", OLD]] : []);
    expect(server.seen).toEqual([]);
  }
  // A renewed token refused again isn't tried a third time.
  const server = await office(() => "token-expired");
  const failed = await openPairedLink(server.url, hello, pairing([OLD, NEW, NEW]).p, check, ready, 5000).catch((err: unknown) => err);
  expect((failed as Error).message).toContain("even renewed");
  expect(server.hellos).toEqual([OLD, NEW]);
});
