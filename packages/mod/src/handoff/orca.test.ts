import { expect, test } from "vitest";
import { findOrca } from "./orca.js";

const only = (...paths: string[]) => async (p: string) => paths.includes(p);

test("Orca's CLI on Windows: PATH first, then where Orca's installer puts it", async () => {
  const env = { Path: "C:\\tools", LOCALAPPDATA: "C:\\Users\\sam\\AppData\\Local" };
  const installed = "C:\\Users\\sam\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe";
  expect(await findOrca(env, "win32", "C:\\Users\\sam", only("C:\\tools\\orca.exe", installed))).toBe("C:\\tools\\orca.exe");
  expect(await findOrca(env, "win32", "C:\\Users\\sam", only(installed))).toBe(installed);
  expect(await findOrca({}, "win32", "C:\\Users\\sam", only(installed))).toBe(installed);
  expect(await findOrca(env, "win32", "C:\\Users\\sam", only())).toBe(null);
});

test("Orca's CLI on a Mac: PATH, then Orca.app in /Applications or ~/Applications", async () => {
  const app = "/Applications/Orca.app/Contents/Resources/bin/orca";
  expect(await findOrca({ PATH: "/usr/bin" }, "darwin", "/Users/sam", only(app))).toBe(app);
  expect(await findOrca({ PATH: "/usr/bin" }, "darwin", "/Users/sam", only("/Users/sam/Applications/Orca.app/Contents/Resources/bin/orca"))).toBe("/Users/sam/Applications/Orca.app/Contents/Resources/bin/orca");
});

test("never on Linux, where orca is the screen reader", async () => {
  expect(await findOrca({ PATH: "/usr/bin" }, "linux", "/home/sam", async () => true)).toBe(null);
});
