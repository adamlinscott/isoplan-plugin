import { expect, test } from "vitest";
import { resultOf, resultSentence, statusSentence, waitForResult } from "./status.js";

const SERVER = "wss://office.team.com/data-layer";
const SINCE = "2026-11-03T10:00:00.000Z";
const log = (...lines: string[]) => lines.join("\n") + "\n";

test("a link's result is read from connect.log's lines since it started, for its office", () => {
  expect(resultOf(log(`2026-11-03T10:00:05.000Z connected to ${SERVER} as sam@team.com, added to config.json`), SINCE, SERVER)).toEqual({ kind: "connected", email: "sam@team.com" });
  expect(resultOf(log(`2026-11-03T10:00:05.000Z connected to ${SERVER} as sam@team.com`), SINCE, SERVER)).toEqual({ kind: "connected", email: "sam@team.com" });
  expect(resultOf(log(`2026-11-03T10:00:05.000Z not connected to ${SERVER}: cancelled`), SINCE, SERVER)).toEqual({ kind: "cancelled" });
  // Earlier lines, and another office's, are someone else's link.
  expect(resultOf(log(`2026-11-03T09:59:59.999Z connected to ${SERVER} as sam@team.com`), SINCE, SERVER)).toBeNull();
  expect(resultOf(log(`2026-11-03T10:00:05.000Z connected to wss://other.team.com/data-layer as sam@team.com`), SINCE, SERVER)).toBeNull();
  expect(resultOf(log(`2026-11-03T10:00:05.000Z stopped the runner, to start again with the new office`), SINCE, SERVER)).toBeNull();
  expect(resultOf("", SINCE, SERVER)).toBeNull();
});

test("why it didn't connect is said plainly, an expired or used link apart, with no file names or error details", () => {
  const at = (text: string) => resultOf(log(`2026-11-03T10:00:01.000Z ${text}`), SINCE, SERVER);
  expect(at(`not connected: the office said: "this connect link has expired or been used: press Connect Claude Code on the floor again"`)).toEqual({ kind: "gone" });
  expect(at(`not connected: the office said: "too many connect links"`)).toEqual({ kind: "failed", why: `the office said: "too many connect links"` });
  expect(at("not connected: the office couldn't be reached (fetch failed)")).toEqual({ kind: "failed", why: "the office couldn't be reached" });
  expect(at("not connected: C:\\Users\\sam\\.claude\\isoplan\\config.json isn't valid JSON; fix it or add the office by hand")).toEqual({ kind: "failed", why: "Isoplan's settings on this computer couldn't be read" });
  expect(at("refused a connect link: another is being handled on this machine")).toEqual({ kind: "busy" });
  expect(at(`paired with ${SERVER}, but couldn't add it to config.json: EPERM`)).toEqual({ kind: "unfinished" });
  expect(at("couldn't connect: Error: boom\n    at x")).toEqual({ kind: "failed", why: "something went wrong on this computer" });
});

test("each result is one plain sentence naming the office, and no answer yet says how to check", () => {
  expect(resultSentence({ kind: "connected", email: "sam@team.com" }, "office.team.com")).toBe("Connected to office.team.com as sam@team.com: your Claude Code work shows on its floor from your next message.");
  expect(resultSentence({ kind: "gone" }, "office.team.com")).toContain("the link has expired or was already used");
  expect(resultSentence({ kind: "cancelled" }, "office.team.com")).toContain("cancelled or ran out of time");
  expect(resultSentence(null, "office.team.com")).toContain("type /isoplan:connect to check");
});

test("waiting reads the log until it has an answer, and gives up after the wait", async () => {
  const reads: string[] = [log(), log(`2026-11-03T10:00:05.000Z not connected to ${SERVER}: cancelled`)];
  expect(await waitForResult(async () => reads.shift() ?? "", SINCE, SERVER, { everyMs: 1 })).toEqual({ kind: "cancelled" });
  expect(reads).toEqual([]);
  let clock = 0;
  expect(await waitForResult(async () => log(), SINCE, SERVER, { waitMs: 3000, everyMs: 1, now: () => (clock += 1000) })).toBeNull();
});

test("without a link, it says which offices this computer is connected to, and any it isn't", () => {
  const team = { label: "team", server: SERVER, connected: true };
  const dev = { label: "dev", server: "ws://127.0.0.1:4747/data-layer", connected: false };
  expect(statusSentence([team])).toBe("This computer is connected to Isoplan at team (office.team.com).");
  expect(statusSentence([team, { ...dev, connected: true }])).toBe("This computer is connected to Isoplan at team (office.team.com) and dev (127.0.0.1:4747).");
  expect(statusSentence([team, dev])).toContain("It isn't connected to dev (127.0.0.1:4747)");
  expect(statusSentence([dev])).toBe("This computer isn't connected to an Isoplan office yet: press Connect Claude Code on your office's Isoplan page.");
});
