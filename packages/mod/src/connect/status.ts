// What /isoplan:connect tells the person (commands/connect.md), in one plain sentence each, with no
// file names, tokens or credentials: how a link it just started connecting ended, read from the
// lines its own run wrote to connect.log (resultOf, resultSentence), or, without a link, which
// offices this computer is connected to (statusSentence). main.ts does the reading and the waiting.
//
// These sentences go into Claude's context, and the link may be anyone's, so nothing an office says
// is passed on: a refusal is a fixed sentence, and the email the office gave is shown only when it
// looks like one, after the person pressed Connect.

/** How long `--wait` reads connect.log for an answer: the dialog's five minutes (dialog.ts) and a little. */
export const WAIT_MS = 310 * 1000;

export type Result =
  | { kind: "connected"; email: string | null }
  | { kind: "cancelled" | "gone" | "busy" | "unfinished" | "unreachable" | "no-window" | "settings" | "refused" | "failed" | "died" };

/** The tag main.ts puts on each line the connect it started for `--wait` writes, after the time. */
export const runTag = (run: string) => `[run ${run}]`;

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;

/** How the connect tagged `run` ended, from connect.log's lines, or null while none of its lines says. */
export function resultOf(log: string, run: string): Result | null {
  const tag = ` ${runTag(run)} `;
  for (const line of log.split("\n")) {
    const at = line.indexOf(tag);
    if (at < 0 || !ISO.test(line.slice(0, at))) continue;
    const text = line.slice(at + tag.length).trimEnd();
    const connected = /^connected to \S+ as (.+?)(, added to config\.json)?$/.exec(text);
    if (connected) return { kind: "connected", email: connected[1]!.length <= 254 && EMAIL.test(connected[1]!) ? connected[1]! : null };
    if (/^not connected to \S+: cancelled$/.test(text)) return { kind: "cancelled" };
    if (text.startsWith("paired by ") || text.startsWith("paired with ")) return { kind: "unfinished" };
    if (text.startsWith("refused a connect link:")) return { kind: "busy" };
    if (text.startsWith("couldn't connect:")) return { kind: "failed" };
    if (text.startsWith("not connected: ")) return failure(text.slice("not connected: ".length));
  }
  return null;
}

/** connect.ts's reason, as one of the fixed results. */
function failure(why: string): Result {
  if (why.startsWith("the office said:")) return { kind: why.includes("expired or been used") ? "gone" : "refused" };
  if (why.startsWith("the office answered")) return { kind: "refused" };
  if (why.startsWith("the office couldn't be reached")) return { kind: "unreachable" };
  if (why.startsWith("the confirmation couldn't be shown")) return { kind: "no-window" };
  if (why.includes("config.json")) return { kind: "settings" };
  return { kind: "failed" };
}

/**
 * Reads connect.log (`read`) each second until resultOf has an answer for `run`, for up to `waitMs`;
 * null when none came. Once the connect it started has gone (`alive`) with nothing said, "died".
 */
export async function waitForResult(
  read: () => Promise<string>,
  run: string,
  { waitMs = WAIT_MS, everyMs = 1000, now = Date.now, alive = () => true }: { waitMs?: number; everyMs?: number; now?: () => number; alive?: () => boolean } = {},
): Promise<Result | null> {
  for (const until = now() + waitMs; now() < until; ) {
    await new Promise((r) => setTimeout(r, everyMs));
    const result = resultOf(await read(), run);
    if (result) return result;
    // It may have written its last line between the read and now.
    if (!alive()) return resultOf(await read(), run) ?? { kind: "died" };
  }
  return null;
}

const AGAIN = "press Connect Claude Code on the Isoplan page to try again";

/** The sentence for `result` (null: no answer yet) of connecting to the office at `host`. */
export function resultSentence(result: Result | null, host: string): string {
  if (!result) return `The window on this computer asking to connect to ${host} hasn't been answered yet: answer it, then type /isoplan:connect to check.`;
  const not = (why: string) => `Not connected to ${host}, because ${why}; ${AGAIN}.`;
  switch (result.kind) {
    case "connected":
      return `Connected to ${host}${result.email ? ` as ${result.email}` : ""}. Your Claude Code work shows on its floor in new Claude Code windows.`;
    case "cancelled":
      return not("the window was cancelled or ran out of time");
    case "gone":
      return `Not connected to ${host}, because the link has expired or was already used; press Connect Claude Code on the Isoplan page for a new one.`;
    case "busy":
      return `Not connected to ${host}, because another window asking to connect is already open on this computer; answer that one first.`;
    case "unfinished":
      return `${host} paired this computer, but it couldn't finish setting up here; the window that opened says what to do.`;
    case "unreachable":
      return not("the office couldn't be reached");
    case "no-window":
      return not("the window asking you to connect couldn't be shown on this computer");
    case "settings":
      return not("Isoplan's settings on this computer couldn't be read");
    case "refused":
      return not("the office refused the link");
    case "failed":
      return not("something went wrong on this computer");
    case "died":
      return `Not connected to ${host}, because the window didn't open; ${AGAIN}.`;
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
