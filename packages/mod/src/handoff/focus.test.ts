import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { fakeOrca } from "./fixture.js";
import { focusHandoff } from "./focus.js";
import { orcaRunner } from "./orca.js";
import { recordOrca } from "./take.js";

/** A machine that took handoff h1 into Orca: its folder with orca.json and the launcher, and the fake Orca with `terminals`. */
async function tookIntoOrca(terminal: string | null, terminals: (worktree: string) => { handle: string; title: string; worktreePath: string }[] = () => []) {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const folder = path.join(claudeDir, "isoplan", "handoffs", "h1");
  const worktree = path.join(root, "app-handoff-h1");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "open.cmd"), "@echo off\r\n");
  await recordOrca(folder, terminal, worktree);
  const orca = fakeOrca(root, { terminals: terminals(worktree) });
  const logs: string[] = [];
  const options = { claudeDir, platform: "win32" as const, orca: async () => orcaRunner(orca.bin, { ...process.env } as Record<string, string>), log: (t: string) => logs.push(t) };
  const kept = () => JSON.parse(fs.readFileSync(path.join(folder, "orca.json"), "utf8")) as { terminal: string | null };
  return { orca, options, worktree, folder, kept, logs };
}

test("focus: the terminal the take opened is switched to, by its handle", async () => {
  const t = await tookIntoOrca("term_7", (worktree) => [{ handle: "term_7", title: "Isoplan handoff h1", worktreePath: worktree }]);
  expect(await focusHandoff("h1", t.options)).toBe(null);
  expect(t.orca.calls()).toEqual([["terminal", "switch", "--terminal", "term_7"]]);
});

test("focus: a handle that is gone falls back to the worktree's terminal, the handoff's first, which is kept for next time", async () => {
  const t = await tookIntoOrca("term_old", (worktree) => [
    { handle: "term_2", title: "pwsh", worktreePath: worktree },
    { handle: "term_3", title: "Isoplan handoff h1", worktreePath: worktree },
  ]);
  expect(await focusHandoff("h1", t.options)).toBe(null);
  expect(t.orca.calls()).toEqual([
    ["terminal", "switch", "--terminal", "term_old"],
    ["terminal", "list", "--worktree", `path:${t.worktree}`],
    ["terminal", "switch", "--terminal", "term_3"],
  ]);
  expect(t.kept().terminal).toBe("term_3");
});

test("focus: with no terminal left in the worktree, the launcher opens again in a new one, in front", async () => {
  const t = await tookIntoOrca("term_old");
  expect(await focusHandoff("h1", t.options)).toBe(null);
  expect(t.orca.calls().slice(2)).toEqual([["terminal", "create", "--worktree", `path:${t.worktree}`, "--title", "Isoplan handoff h1", "--command", `"${path.join(t.folder, "open.cmd")}"`, "--shell", "cmd.exe", "--focus"]]);
  expect(t.kept().terminal).toBe("term_1");
});

test("focus: without Orca, or without a take into it on this machine, it says why in a few words, with no path", async () => {
  const t = await tookIntoOrca("term_7");
  expect(await focusHandoff("h1", { ...t.options, orca: async () => null })).toBe("Orca wasn't found on this machine");
  expect(await focusHandoff("h2", t.options)).toBe("this machine has no record of opening this handoff in Orca: take it into Orca again");
  expect(t.orca.calls()).toEqual([]);
});
