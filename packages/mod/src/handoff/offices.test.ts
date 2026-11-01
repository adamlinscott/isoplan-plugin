import { expect, test } from "vitest";
import { findRoom, handOverOffice, type RoomIo } from "./offices.js";

type O = { label: string };
const internal: O = { label: "internal" };
const dev: O = { label: "dev" };
const other: O = { label: "other" };

/** Offices that know some codes, or answer with what went wrong, and take some repos; and what was asked of which. */
function io(o: { knows?: Map<O, string>; says?: Map<O, string>; takes?: Map<O, string[]> }) {
  const asked: string[] = [];
  const room: RoomIo<O> = {
    ask: async (office) => (asked.push(office.label), o.knows?.has(office) ? { project: o.knows.get(office)! } : { unknown: o.says?.get(office) ?? "The office server says: no handoff has that take code" }),
    takes: async (office, project) => (o.takes?.get(office) ?? []).includes(project),
    label: (office) => office.label,
  };
  return { room, asked };
}

test("findRoom: without --office, the offices are asked in order, stopping at the first that knows the code", async () => {
  const { room, asked } = io({ knows: new Map([[dev, "github.com/team/app"], [other, "github.com/team/app"]]), takes: new Map([[dev, ["github.com/team/app"]]]) });
  expect(await findRoom([internal, dev, other], null, "ABCD-EFGH", room)).toEqual({ office: dev, project: "github.com/team/app" });
  expect(asked).toEqual(["internal", "dev"]);
});

test("findRoom: with --office, only that office is asked, and a take it can't give stops there, naming it", async () => {
  const { room, asked } = io({ knows: new Map([[dev, "github.com/team/app"]]), says: new Map([[internal, "The office server at ws://internal couldn't be reached."]]), takes: new Map([[dev, ["github.com/team/app"]]]) });
  expect(await findRoom([internal, dev], dev, "ABCD-EFGH", room)).toEqual({ office: dev, project: "github.com/team/app" });
  expect(asked).toEqual(["dev"]);
  asked.length = 0;
  expect(await findRoom([internal, dev], internal, "ABCD-EFGH", room)).toEqual({ refused: "The internal office couldn't give that take code: The office server at ws://internal couldn't be reached." });
  expect(asked).toEqual(["internal"]);
});

test("findRoom: none knowing the code says what each said", async () => {
  const { room } = io({ says: new Map([[internal, "This machine needs pairing with the office before it takes this."]]) });
  expect(await findRoom([internal, dev], null, "ABCD-EFGH", room)).toEqual({ refused: "No office here knows that take code.\ninternal: This machine needs pairing with the office before it takes this.\ndev: The office server says: no handoff has that take code" });
});

test("findRoom: the office that knows the code decides, even when this machine's copy of its list doesn't take the repo", async () => {
  const { room, asked } = io({ knows: new Map([[internal, "github.com/team/app"], [dev, "github.com/team/app"]]), takes: new Map([[dev, ["github.com/team/app"]]]) });
  expect(await findRoom([internal, dev], null, "ABCD-EFGH", room)).toEqual({ refused: expect.stringContaining("isn't on this machine's copy of the internal office's list") });
  expect(asked).toEqual(["internal"]);
});

test("findRoom: with one office, what it said is passed on as it was", async () => {
  const { room } = io({});
  expect(await findRoom([internal], null, "ABCD-EFGH", room)).toEqual({ refused: "The office server says: no handoff has that take code" });
  expect(await findRoom([internal], internal, "ABCD-EFGH", room)).toEqual({ refused: "The office server says: no handoff has that take code" });
});

test("handOverOffice: the only office that takes the repo, the one --office names, or why not", () => {
  const label = (o: O) => o.label;
  expect(handOverOffice([{ office: dev, home: "app" }], null, "", label)).toEqual({ office: dev, home: "app", several: false });
  const both = [{ office: internal, home: "app" }, { office: dev, home: "app" }];
  expect(handOverOffice(both, null, "", label)).toEqual({ refused: 'More than one office takes this repo: internal, dev. Ask which one to hand over in, then run this again with --office "<label>".' });
  expect(handOverOffice(both, dev, "", label)).toEqual({ office: dev, home: "app", several: true });
  expect(handOverOffice([{ office: dev, home: "app" }], internal, "", label)).toEqual({ refused: "The internal office doesn't take this repo; dev does." });
  expect(handOverOffice([], null, "This repo isn't one the office takes.", label)).toEqual({ refused: "This repo isn't one the office takes." });
});
