// Which office a take code is taken from, with several office servers in config.json (#105). A take
// code doesn't name its office, but the floor's take prompt may (`--office`): that office is asked
// first, then the others in config.json's order. Only an office that may be asked is: one whose
// fresh list takes at least one repo, or, with no fresh list to tell by, one this machine is paired
// with; a code is never sent to any other. The first office that knows the code decides, even when
// this machine's copy of its list doesn't take the code's repo: then the take is refused there,
// rather than tried in the next office.

export interface RoomIo<O> {
  /** True when the office may be asked for the code, else why not. */
  askable(office: O): Promise<true | string>;
  /** The project of the room the code takes into, or what the office said when it doesn't know it. */
  ask(office: O, code: string): Promise<{ project: string } | { unknown: string }>;
  /** Whether this machine's fresh copy of the office's list takes `project`. */
  takes(office: O, project: string): Promise<boolean>;
  label(office: O): string;
}

export async function findRoom<O>(offices: readonly O[], hint: O | null, code: string, io: RoomIo<O>): Promise<{ office: O; project: string } | { refused: string }> {
  const order = hint ? [hint, ...offices.filter((o) => o !== hint)] : [...offices];
  const said: string[] = [];
  for (const office of order) {
    const askable = await io.askable(office);
    const answer = askable === true ? await io.ask(office, code) : { unknown: askable };
    if ("unknown" in answer) {
      said.push(offices.length > 1 ? `${io.label(office)}: ${answer.unknown}` : answer.unknown);
      continue;
    }
    if (!(await io.takes(office, answer.project)))
      return {
        refused: `The handoff's repo, ${answer.project}, isn't on this machine's copy of ${offices.length > 1 ? `the ${io.label(office)} office's` : "the office's"} list, so nothing is sent. A Claude Code session with the Isoplan plugin reads it again within a few minutes; take it then.`,
      };
    return { office, project: answer.project };
  }
  return { refused: offices.length > 1 ? `No office here knows that take code.\n${said.join("\n")}` : said[0]! };
}

/**
 * The office a hand-over goes to, of those whose list takes the session's repo (`taking`, in
 * config.json's order): the one `--office` names (`picked`), else the only one; with none, or several
 * and none named, why not. `refused` is what the first office not taking it said.
 */
export function handOverOffice<O, H>(taking: readonly { office: O; home: H }[], picked: O | null, refused: string, label: (office: O) => string): { office: O; home: H; several: boolean } | { refused: string } {
  const several = taking.length > 1;
  if (picked) {
    const chosen = taking.find((t) => t.office === picked);
    return chosen ? { ...chosen, several } : { refused: `The ${label(picked)} office doesn't take this repo${taking.length ? `; ${taking.map((t) => label(t.office)).join(", ")} does` : ""}. ${refused}`.trim() };
  }
  if (several) return { refused: `More than one office takes this repo: ${taking.map((t) => label(t.office)).join(", ")}. Ask which one to hand over in, then run this again with --office "<label>".` };
  return taking[0] ? { ...taking[0], several } : { refused };
}
