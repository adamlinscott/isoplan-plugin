import { PROTOCOL_VERSION } from "@isoplan/protocol";
import { expect, test } from "vitest";
import type { DataLayerLine } from "../lines.js";
import { REFUSED, relayOwnerMessage } from "./owner-messages.js";

const v = PROTOCOL_VERSION;
const owner = { id: "claude:4f9c", name: "Ada" };
const request = { type: "request", v, id: "m1", kind: "owner-message", session: "claude-code:s1", from: owner, text: "Now run the tests." } as const;

// The hooks module's file: absent for the first `after` looks, then each of `texts` in turn.
function relay(texts: string[], { after = 2, detached = false, takes = true, from = owner, file = "C:/Users/ada/.claude/isoplan/messages/s1/m1.json" } = {}) {
  const lines: DataLayerLine[] = [];
  let looks = 0;
  const take = async () => (++looks > after ? (texts.shift() ?? null) : null);
  const sent = relayOwnerMessage({ ...request, from }, { detached, takes, owner: owner.id, session: "s1", file, emit: (l) => void lines.push(l), take, sleep: async () => {}, waitMs: 1000 });
  return { lines, sent };
}
const refused = async (r: ReturnType<typeof relay>) => {
  const message = await r.sent;
  return message.type === "refusal" && message.reason === "unavailable" ? message.code : null;
};

test.each([
  ["Windows", "C:\\Users\\ada\\.claude\\isoplan\\messages\\s1\\m1.json"],
  ["macOS", "/Users/ada/.claude/isoplan/messages/s1/m1.json"],
])("owner message on %s: passed to the hooks module, and a reply once it went in, marked queued when it waits its turn; a word that isn't one is passed over", async (_os, file) => {
  const now = relay(["{}", JSON.stringify({ taken: true })], { file });
  expect(await now.sent).toEqual({ type: "reply", v, id: "m1", kind: "owner-message" });
  expect(now.lines).toEqual([{ type: "owner-message", session: "s1", text: "Now run the tests.", file }]);
  expect(await relay([JSON.stringify({ taken: true, queued: true })], { file }).sent).toEqual({ type: "reply", v, id: "m1", kind: "owner-message", queued: true });
});

test("owner message: refused, with its code and plain words, from anyone but the owner, for a wake-only session or one that can't submit, with nothing passed on", async () => {
  for (const [opts, code] of [[{ from: { id: "claude:7d21", name: "Sam" } }, "not-owner"], [{ detached: true }, "detached"], [{ takes: false }, "no-submit"]] as const) {
    const r = relay([JSON.stringify({ taken: true })], opts);
    expect(await r.sent).toEqual({ type: "refusal", v, id: "m1", reason: "unavailable", code, detail: REFUSED[code] });
    expect(r.lines).toEqual([]);
  }
});

test("owner message: refused with the hooks module's reason, and when it never says", async () => {
  for (const reason of ["no-submit", "ended", "dropped"] as const) expect(await refused(relay([JSON.stringify({ taken: false, reason })]))).toBe(reason);
  expect(await refused(relay([]))).toBe("no-answer");
  expect(await refused(relay([JSON.stringify({ taken: false, reason: "busy" })]))).toBe("no-answer");
});
