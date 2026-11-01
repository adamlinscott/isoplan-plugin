// Which office a take code is taken from, with several office servers in config.json (#105). A take
// code doesn't name its office, but the floor's take prompt may (`--office`): then that office alone
// is asked, and a take it can't give (it can't be reached, this machine isn't paired with it, it
// doesn't know the code) stops there, naming it. Without `--office` each office is asked in
// config.json's order, with this machine's token where it is paired, and the first that knows the
// code decides, even when this machine's copy of its list doesn't take the code's repo: then the
// take is refused rather than tried in the next office. A take code is single-use and bound to the
// person taking it, so an office that doesn't know it learns nothing it can use.

export interface RoomIo<O> {
  /** The project of the room the code takes into, or what the office said when it gave none. */
  ask(office: O, code: string): Promise<{ project: string } | { unknown: string }>;
  /** Whether this machine's fresh copy of the office's list takes `project`. */
  takes(office: O, project: string): Promise<boolean>;
  label(office: O): string;
}

export async function findRoom<O>(offices: readonly O[], hint: O | null, code: string, io: RoomIo<O>): Promise<{ office: O; project: string } | { refused: string }> {
  const decide = async (office: O, project: string) =>
    (await io.takes(office, project))
      ? { office, project }
      : { refused: `The handoff's repo, ${project}, isn't on this machine's copy of ${offices.length > 1 ? `the ${io.label(office)} office's` : "the office's"} list, so nothing is sent. A Claude Code session with the Isoplan plugin reads it again within a few minutes; take it then.` };
  if (hint) {
    const answer = await io.ask(hint, code);
    return "unknown" in answer ? { refused: offices.length > 1 ? `The ${io.label(hint)} office couldn't give that take code: ${answer.unknown}` : answer.unknown } : decide(hint, answer.project);
  }
  const said: string[] = [];
  for (const office of offices) {
    const answer = await io.ask(office, code);
    if ("project" in answer) return decide(office, answer.project);
    said.push(offices.length > 1 ? `${io.label(office)}: ${answer.unknown}` : answer.unknown);
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
