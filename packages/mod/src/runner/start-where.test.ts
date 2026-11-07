import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { createRunGit } from "../handoff/git.js";
import type { RunOrca } from "../handoff/orca.js";
import { trustKey, type Background, type Launch, type TakeSettings } from "../handoff/take.js";
import type { StartElsewhere } from "./session.js";
import { onCommandLine, startDir, startPlaces, startWhere, taskPrompt, type StartWhereOptions } from "./start-where.js";

const SESSION = "0b5c4d3e-0000-4000-8000-000000000085";
const SETTINGS: TakeSettings = { gitTimeoutSeconds: 30, setupTimeoutMinutes: 1, cloneSearchDays: 30, desktopReadTimeoutMinutes: 1, desktopReadMaxTurns: 2, desktopTakeBudgetMinutes: 2 };

test.each([
  ["win32", true, true, ["terminal", "headless", "orca", "desktop"]],
  ["darwin", false, true, ["terminal", "headless", "desktop"]],
  ["linux", true, false, ["headless", "orca"]],
] as const)("%s: a start may open in a terminal only where one can be opened, and in Orca and the Claude app only where they are found", (platform, orca, desktop, places) => {
  expect(startPlaces(platform, orca, desktop)).toEqual(places);
});

test("a task goes on the command line as it is, unless it starts with - anywhere, or, in a Windows terminal's launcher, has a quote, a line break or a \\ at its end", () => {
  for (const platform of ["win32", "darwin"] as const) {
    for (const mode of ["terminal", "headless", "orca", "desktop"] as const) {
      expect(onCommandLine("Write the docs page for 50% of users & more (soon) ^ <now>", mode, platform)).toBe(true);
      expect(onCommandLine("--dangerously-skip-permissions", mode, platform)).toBe(false);
      const launcher = platform === "win32" && (mode === "terminal" || mode === "orca");
      for (const task of ['Say "hi"', "one\ntwo", "one\r\ntwo", "C:\\docs\\"]) expect(onCommandLine(task, mode, platform)).toBe(!launcher);
    }
  }
});

function setUp(platform: NodeJS.Platform, extra: Partial<StartWhereOptions> = {}) {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const checkout = path.join(root, "app");
  fs.mkdirSync(checkout, { recursive: true });
  const opened: Launch[] = [];
  const started: Background[] = [];
  const asked: string[] = [];
  const logs: string[] = [];
  const options: StartWhereOptions = {
    run: createRunGit(),
    claudeDir,
    claudeJson: path.join(root, ".claude.json"),
    platform,
    env: {},
    log: (t) => void logs.push(t),
    machine: "sam-laptop",
    settings: async () => SETTINGS,
    orca: async () => null,
    branchFolder: async (folder, branch) => (asked.push(`${folder} ${branch}`), path.join(root, `app-branch-${branch}`)),
    orcaFolder: async () => ({ error: "no Orca folder in this test" }),
    // Nothing opens: the launcher is kept, and a background session is only recorded.
    open: async (l) => void opened.push(l),
    start: async (b) => void started.push(b),
    agents: async () => [SESSION],
    confirmMs: 1000,
    ...extra,
  };
  const start = (fields: Partial<StartElsewhere>): StartElsewhere => ({ id: "d1", mode: "terminal", folder: checkout, instruction: "Write the docs page.", session: SESSION, ...fields });
  return { root, claudeDir, checkout, opened, started, asked, logs, options, start };
}

test.each([
  ["win32", "open.cmd", `cd /d "%DIR%"`, `"Write the docs page." "--session-id" "${SESSION}" "--name" "Isoplan new session"`],
  ["darwin", "open.command", `cd '%DIR%' || exit 1`, `'Write the docs page.' '--session-id' '${SESSION}' '--name' 'Isoplan new session'`],
] as const)("%s, in a terminal: the folder offered for the branch, the typed task the first message, under the start's session id, in a window of the person's own pick", async (platform, file, cd, argv) => {
  const t = setUp(platform);
  const r = await startWhere(t.start({ branch: "feat/docs" }), "/bin/claude", t.options);
  expect(r).toEqual({ opened: true, problem: null });
  const dir = path.join(t.root, "app-branch-feat/docs");
  expect(t.asked).toEqual([`${t.checkout} feat/docs`]);
  expect(t.opened).toHaveLength(1);
  const l = t.opened[0]!;
  expect(path.basename(l.file)).toBe(file);
  expect(path.dirname(l.file)).toBe(startDir(t.claudeDir, SESSION));
  expect(l.text).toContain(cd.replace("%DIR%", dir));
  expect(l.text).toContain(argv);
  expect(l.text).not.toContain("--add-dir");
  expect(t.started).toEqual([]);
});

test("win32, in a terminal: a task with quotes and line breaks goes in task.md, as typed, and the first message says to read it, with its folder added", async () => {
  const t = setUp("win32");
  const task = 'Write the "Sessions" page:\r\n- what a handoff is\n- & what it isn\'t';
  expect(await startWhere(t.start({ instruction: task }), "/bin/claude", t.options)).toEqual({ opened: true, problem: null });
  const folder = startDir(t.claudeDir, SESSION);
  const file = path.join(folder, "task.md");
  expect(fs.readFileSync(file, "utf8")).toBe(task + "\n");
  const l = t.opened[0]!;
  expect(l.text).toContain(`"${taskPrompt(file)}"`);
  expect(l.text).toContain(`"--add-dir" "${folder}"`);
  expect(l.text.split("\r\n").filter((line) => line.includes("Sessions"))).toEqual([]);
  // No branch named: the listed folder as it is.
  expect(t.asked).toEqual([]);
  expect(l.text).toContain(`cd /d "${t.checkout}"`);
});

test("headless: a background session in the folder, which is trusted, with the task as its first message, and one that would read as an option goes in task.md", async () => {
  const t = setUp("darwin");
  expect(await startWhere(t.start({ mode: "headless" }), "/bin/claude", t.options)).toEqual({ opened: true, problem: null });
  expect(t.started).toEqual([{ cwd: t.checkout, argv: ["/bin/claude", "Write the docs page.", "--bg", "--session-id", SESSION, "--name", "Isoplan new session"] }]);
  expect(JSON.parse(fs.readFileSync(t.options.claudeJson, "utf8")).projects[trustKey(t.checkout, "darwin")]).toEqual({ hasTrustDialogAccepted: true });
  expect(t.opened).toEqual([]);
  await startWhere(t.start({ mode: "headless", instruction: "--help me" }), "/bin/claude", t.options);
  const folder = startDir(t.claudeDir, SESSION);
  expect(t.started[1]!.argv.slice(0, 2)).toEqual(["/bin/claude", taskPrompt(path.join(folder, "task.md"))]);
  expect(t.started[1]!.argv.slice(-2)).toEqual(["--add-dir", folder]);
});

test("in Orca: the folder Orca gives for the branch, trusted, and a terminal there in Orca, not brought to the front; without Orca, or a folder for the branch, nothing opens", async () => {
  const calls: string[][] = [];
  const orca: RunOrca = async (args) => (calls.push(args), { ok: true, result: { terminal: { handle: "term_1" } } });
  const t = setUp("win32", { orca: async () => orca, orcaFolder: async (o, folder, branch) => (expect(o).toBe(orca), path.join(path.dirname(folder), "orca", `${branch}`)) });
  expect(await startWhere(t.start({ mode: "orca", branch: "docs" }), "/bin/claude", t.options)).toEqual({ opened: true, problem: null, terminal: "term_1" });
  const dir = path.join(t.root, "orca", "docs");
  const launcher = path.join(startDir(t.claudeDir, SESSION), "open.cmd");
  expect(calls).toEqual([["terminal", "create", "--worktree", `path:${dir}`, "--title", "Isoplan new session", "--command", `"${launcher}"`, "--shell", "cmd.exe"]]);
  expect(fs.readFileSync(launcher, "utf8")).toContain(`"Write the docs page."`);
  expect(t.opened).toEqual([]);

  const none = setUp("win32");
  expect(await startWhere(none.start({ mode: "orca" }), "/bin/claude", none.options)).toEqual({ opened: false, problem: "Orca wasn't found on sam-laptop, so nothing was started: start it again from the floor another way." });
  const noFolder = setUp("darwin", { orca: async () => orca });
  const r = await startWhere(noFolder.start({ mode: "orca", branch: "docs" }), "/bin/claude", noFolder.options);
  expect(r).toEqual({ opened: false, problem: "A folder for the branch docs couldn't be readied on sam-laptop, so nothing was started. Its runner log says why." });
  expect(noFolder.logs.some((l) => l.includes("no Orca folder in this test"))).toBe(true);
  expect(fs.existsSync(startDir(noFolder.claudeDir, SESSION))).toBe(false);
});

test("the Claude app: a machine it can't open sessions on opens nothing, and no folder is made for the branch", async () => {
  const t = setUp("linux");
  const r = await startWhere(t.start({ mode: "desktop", branch: "docs" }), "/bin/claude", t.options);
  expect(r.opened).toBe(false);
  expect(r.problem).toContain("only on a Mac or on Windows x64");
  expect(t.asked).toEqual([]);
});
