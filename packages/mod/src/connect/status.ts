// What /isoplan:connect tells the person (commands/connect.md), in one plain sentence each, with no
// file names, tokens or credentials: how a link it just started connecting ended, read from the
// lines connect.ts wrote to connect.log since (resultOf, resultSentence), or, without a link, which
// offices this computer is connected to (statusSentence). main.ts does the reading and the waiting.

/** How long `--wait` reads connect.log for an answer: under Claude Code's two-minute default for a command. */
export const WAIT_MS = 110 * 1000;

export type Result = { kind: "connected"; email: string } | { kind: "cancelled" } | { kind: "gone" } | { kind: "busy" } | { kind: "unfinished" } | { kind: "failed"; why: string };

/**
 * How connecting to `server` ended, from connect.log's lines stamped at or after `since` (an ISO
 * time, as the log writes them), or null while none says. connect.lock lets one link through at a
 * time, so a line from then on is this link's, or says another was being handled.
 */
export function resultOf(log: string, since: string, server: string): Result | null {
  for (const line of log.split("\n")) {
    const at = line.indexOf(" ");
    if (at < 0 || line.slice(0, at) < since) continue;
    const text = line.slice(at + 1).trimEnd();
    const connected = /^connected to (\S+) as (.+?)(, added to config\.json)?$/.exec(text);
    if (connected?.[1] === server) return { kind: "connected", email: connected[2]! };
    if (text === `not connected to ${server}: cancelled`) return { kind: "cancelled" };
    if (text.startsWith(`paired by ${server},`) || text.startsWith(`paired with ${server},`)) return { kind: "unfinished" };
    if (text.startsWith("refused a connect link:")) return { kind: "busy" };
    if (text.startsWith("couldn't connect:")) return { kind: "failed", why: "something went wrong on this computer" };
    if (text.startsWith("not connected: ")) return failure(text.slice("not connected: ".length));
  }
  return null;
}

/** Reads connect.log (`read`) each second until resultOf has an answer, for up to `waitMs`; null when none came. */
export async function waitForResult(
  read: () => Promise<string>,
  since: string,
  server: string,
  { waitMs = WAIT_MS, everyMs = 1000, now = Date.now }: { waitMs?: number; everyMs?: number; now?: () => number } = {},
): Promise<Result | null> {
  for (const until = now() + waitMs; now() < until; ) {
    await new Promise((r) => setTimeout(r, everyMs));
    const result = resultOf(await read(), since, server);
    if (result) return result;
  }
  return null;
}

/** connect.ts's reason, in plain words: an expired code apart, and without file names or error details. */
function failure(why: string): Result {
  if (why.includes("expired or been used")) return { kind: "gone" };
  if (why.startsWith("the office said:")) return { kind: "failed", why };
  if (why.startsWith("the office couldn't be reached")) return { kind: "failed", why: "the office couldn't be reached" };
  if (why.startsWith("the confirmation couldn't be shown")) return { kind: "failed", why: "the window asking you to connect couldn't be shown on this computer" };
  if (why.includes("config.json")) return { kind: "failed", why: "Isoplan's settings on this computer couldn't be read" };
  return { kind: "failed", why };
}

const AGAIN = "press Connect Claude Code on the Isoplan page to try again";

/** The sentence for `result` (null: no answer yet) of connecting to the office at `host`. */
export function resultSentence(result: Result | null, host: string): string {
  if (!result) return `The window on this computer asking to connect to ${host} hasn't been answered yet: answer it, then type /isoplan:connect to check.`;
  switch (result.kind) {
    case "connected":
      return `Connected to ${host} as ${result.email}: your Claude Code work shows on its floor from your next message.`;
    case "cancelled":
      return `Not connected to ${host}, because the window was cancelled or ran out of time; ${AGAIN}.`;
    case "gone":
      return `Not connected to ${host}, because the link has expired or was already used; press Connect Claude Code on the Isoplan page for a new one.`;
    case "busy":
      return `Not connected to ${host}, because another window asking to connect is already open on this computer; answer that one first.`;
    case "unfinished":
      return `${host} paired this computer, but it couldn't finish setting up here; the window that opened says what to do.`;
    case "failed":
      return `Not connected to ${host}, because ${result.why}; ${AGAIN}.`;
  }
}

export interface OfficeState {
  label: string;
  /** Its data-layer address. */
  server: string;
  /** Whether this computer holds a credential for it. */
  connected: boolean;
}

const named = (o: OfficeState) => {
  const host = new URL(o.server).host;
  return o.label === host ? host : `${o.label} (${host})`;
};
const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Whether this computer is connected, and to which offices; any it lists but isn't connected to after. */
export function statusSentence(offices: readonly OfficeState[]): string {
  const yes = offices.filter((o) => o.connected).map(named);
  const no = offices.filter((o) => !o.connected).map(named);
  if (!yes.length) return "This computer isn't connected to an Isoplan office yet: press Connect Claude Code on your office's Isoplan page.";
  const also = no.length ? ` It isn't connected to ${list(no)}: press Connect Claude Code on that office's Isoplan page to connect it.` : "";
  return `This computer is connected to Isoplan at ${list(yes)}.${also}`;
}
