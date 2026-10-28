import { expect, test } from "vitest";
import { detachedStop, LINK_DOWN_MS } from "./detached.js";

const now = Date.parse("2026-10-21T09:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

test("detached: goes on while the session is busy and the link is up or only briefly down", () => {
  expect(detachedStop({ now, lastActive: ago(60000), idleMinutes: 30, downSince: null })).toBeNull();
  expect(detachedStop({ now, lastActive: ago(60000), idleMinutes: 30, downSince: now - LINK_DOWN_MS + 1 })).toBeNull();
});

test("detached: a quiet session isn't stopped before its link has connected, so it is reported once", () => {
  expect(detachedStop({ now, lastActive: ago(5 * 3600000), idleMinutes: 30, downSince: now - 1000 })).toBeNull();
});

test("detached: stops once the session is quiet past idleMinutes, or the link has been down five minutes", () => {
  expect(detachedStop({ now, lastActive: ago(31 * 60000), idleMinutes: 30, downSince: null })).toMatch(/quiet more than 30 minutes/);
  expect(detachedStop({ now, lastActive: ago(60000), idleMinutes: 30, downSince: now - LINK_DOWN_MS })).toMatch(/out of reach for 5 minutes/);
});
