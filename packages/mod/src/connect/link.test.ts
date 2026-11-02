import { expect, test } from "vitest";
import type { Config } from "../data-layer/config.js";
import { parseLink, withOffice } from "./link.js";

const CODE = "A".repeat(42) + "b";
const link = (office: string, name = "Team office", code = CODE) => `isoplan://connect?${new URLSearchParams({ office, code, name })}`;

test("a connect link gives the office, its data-layer address, the code and the name", () => {
  expect(parseLink(link("https://office.team.com"))).toEqual({ office: "https://office.team.com", server: "wss://office.team.com/data-layer", host: "office.team.com", code: CODE, name: "Team office" });
  // An office on this machine is http, at 127.0.0.1 as the plugin's own default names it.
  expect(parseLink(link("http://localhost:4750"))).toMatchObject({ office: "http://127.0.0.1:4750", server: "ws://127.0.0.1:4750/data-layer" });
  expect(parseLink(link("http://127.0.0.1:4747/"))).toMatchObject({ server: "ws://127.0.0.1:4747/data-layer" });
});

test("anything else is refused: another scheme, plain http to another machine, an office with more than its origin, a made-up code or name", () => {
  const refused = [
    link("https://office.team.com").replace("isoplan://connect", "isoplan://pair"),
    link("https://office.team.com").replace("isoplan:", "https:"),
    `${link("https://office.team.com")}&office=https://evil.example`,
    `isoplan://connect?office=https://office.team.com&code=${CODE}`,
    link("http://office.team.com"),
    link("http://10.0.0.5:4747"),
    link("ftp://office.team.com"),
    link("https://user@office.team.com"),
    link("https://office.team.com/data-layer"),
    link("https://office.team.com?x=1"),
    link("not a url"),
    link("https://office.team.com", "Team", "short"),
    link("https://office.team.com", "Team", "A".repeat(42) + "/"),
    link("https://office.team.com", ""),
    link("https://office.team.com", "x".repeat(81)),
    link("https://office.team.com", "Team‮evil"),
    link("https://office.team.com", "Team\nYes"),
  ];
  for (const text of refused) expect(typeof parseLink(text), text).toBe("string");
});

const config = (over: Partial<Config> = {}) => ({ server: "ws://127.0.0.1:4747/data-layer", servers: [], allowPlainWs: false, ...over }) as Config;
const team = { server: "wss://office.team.com/data-layer", name: "Team office", host: "office.team.com" };

test("config.json: the office is added to servers, after what is there, under its name; an office already reported to changes nothing", () => {
  const listed = [{ label: "dev", server: "ws://127.0.0.1:4747/data-layer" }];
  const user = { servers: listed, streamSeconds: 2 };
  expect(withOffice(user, config({ servers: listed }), team)).toEqual({ streamSeconds: 2, servers: [...listed, { label: "team-office", server: team.server }] });
  expect(withOffice(user, config({ servers: [...listed, { server: team.server }] }), team)).toBeNull();
  // The default office, reported to with no config.json at all, is already there.
  expect(withOffice({}, config(), { ...team, server: "ws://127.0.0.1:4747/data-layer" })).toBeNull();
});

test("config.json: with only `server`, that office goes into servers first so it is still reported to; a label already taken gets -2", () => {
  const user = { server: "wss://old.team.com/data-layer" };
  expect(withOffice(user, config({ server: user.server }), { ...team, name: "old.team.com" })).toEqual({
    server: user.server,
    servers: [
      { label: "old.team.com", server: user.server },
      { label: "old-team-com", server: team.server },
    ],
  });
  // No config.json: the plugin's default office stays.
  expect(withOffice({}, config(), team)).toEqual({ servers: [{ label: "127.0.0.1:4747", server: "ws://127.0.0.1:4747/data-layer" }, { label: "team-office", server: team.server }] });
  const taken = [{ label: "team-office", server: "wss://a.example/data-layer" }];
  expect((withOffice({ servers: taken }, config({ servers: taken }), team)!.servers as unknown[]).at(-1)).toEqual({ label: "team-office-2", server: team.server });
  // A name with nothing to make a label of is labelled by its host.
  expect((withOffice({}, config(), { ...team, name: "办公室" })!.servers as unknown[]).at(-1)).toEqual({ label: "office.team.com", server: team.server });
});
