// The shared pairing's link, to the hooks modules whose session waits for it (pair-links.ts).

import { expect, test } from "vitest";
import type { DataLayerLine, PairLine } from "../lines.js";
import { createPairLinks } from "./pair-links.js";

const server = "wss://office.example/data-layer";
const pair = (expires: string): PairLine => ({ type: "pair", server, label: "dev", url: "https://office.example/pair/1", expires });

test("pair links: only a session waiting to pair for that office gets the link, now or once it gets there; never one past its expiry", () => {
  let at = Date.parse("2026-11-07T10:00:00Z");
  const links = createPairLinks(() => at);
  const waiting: DataLayerLine[] = [];
  const connected: DataLayerLine[] = [];
  const sendWaiting = (line: DataLayerLine) => void waiting.push(line);
  const sendConnected = (line: DataLayerLine) => void connected.push(line);
  links.sent("s1", { type: "status", server, state: "pairing" }, sendWaiting);
  links.sent("s2", { type: "status", server, state: "connected" }, sendConnected);
  links.sent("s2", { type: "status", server: "wss://other/data-layer", state: "pairing" }, sendConnected);

  const link = pair("2026-11-07T10:10:00Z");
  links.pair(link);
  expect(waiting).toEqual([link]);
  expect(connected).toEqual([]);

  // A session that gets to pairing later gets the last link, while it works.
  const later: DataLayerLine[] = [];
  links.sent("s3", { type: "status", server, state: "pairing" }, (line) => void later.push(line));
  expect(later).toEqual([link]);
  at = Date.parse("2026-11-07T10:11:00Z");
  const expired: DataLayerLine[] = [];
  links.sent("s4", { type: "status", server, state: "pairing" }, (line) => void expired.push(line));
  expect(expired).toEqual([]);

  // A report that ended gets nothing more.
  links.ended("s1", sendWaiting);
  links.pair(pair("2026-11-07T10:30:00Z"));
  expect(waiting).toEqual([link]);
});
