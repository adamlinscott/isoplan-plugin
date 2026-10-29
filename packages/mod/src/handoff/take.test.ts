import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Handoff } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { nodeIo } from "../data-layer/io.js";
import { createRunGit, pushHandoff } from "./git.js";
import { git, remoteAndClone } from "./fixture.js";
import { checkoutHere, findClone, launch, parseSetup, sessionArgv, takeHandoff, type Headless, type Launch, type TakeOptions } from "./take.js";

const run = createRunGit();
const SETTINGS = { gitTimeoutSeconds: 30, setupTimeoutMinutes: 15, cloneSearchDays: 30 };
// A fake AWS key id, split so no key-shaped string sits in the source.
const FAKE_KEY = "AKIA" + "IOSFODNN7EXAMPLE";
const SESSION = "0b5c4d3e-0000-4000-8000-000000000001";

const pushed = async (cwd: string, id: string) => {
  const r = await pushHandoff(run, cwd, id, 30000);
  if (!("repo" in r)) throw new Error("held");
  return r.repo;
};

/** The sender's clone with a change handed over as `id`, and the receiver's machine: a config folder whose one session ran in their clone. */
async function handedOver(id: string, setup?: unknown) {
  const root = tempRoot();
  const sender = remoteAndClone(root, "sender");
  if (setup !== undefined) {
    fs.writeFileSync(path.join(sender.clone, "isoplan.json"), JSON.stringify({ worktreeSetup: setup }));
    git(sender.clone, "add", "isoplan.json");
    git(sender.clone, "commit", "-q", "-m", "setup");
    git(sender.clone, "push", "-q", "origin", "main");
  }
  const receiver = remoteAndClone(root, "receiver");
  fs.writeFileSync(path.join(sender.clone, "app.js"), "console.log('handed over');\n");
  const repo = await pushed(sender.clone, id);
  const claudeDir = path.join(root, "claude");
  const projects = path.join(claudeDir, "projects", "C--receiver");
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(path.join(projects, "s1.jsonl"), JSON.stringify({ type: "user", cwd: receiver.clone }) + "\n");
  const handoff: Handoff = { id, brief: "Goal: ship the export.", repos: [repo] };
  const opened: Launch[] = [];
  const started: Headless[] = [];
  const options: TakeOptions = {
    run,
    io: nodeIo(),
    claudeDir,
    machine: "sam-laptop",
    platform: "win32",
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
    settings: async () => SETTINGS,
    claude: async () => "C:\\Users\\sam\\.local\\bin\\claude.exe",
    scan: async (text) => (text.includes(FAKE_KEY) ? "AWS access key id" : null),
    log: () => {},
    // Nothing here opens a window or starts a process: both are recorded instead.
    open: async (l) => void opened.push(l),
    start: async (h) => void started.push(h),
  };
  return { root, sender, receiver, handoff, options, opened, started, claudeDir };
}

test("taking from the floor: a worktree beside the clone on the handoff's branch, the setup script, then Claude Code with the brief, under the server's session id", async () => {
  const t = await handedOver("h1", { command: "node -e \"require('fs').writeFileSync('setup-ran.txt', process.env.ISOPLAN_HANDOFF_BRANCH)\"" });
  const taken = await takeHandoff({ handoff: t.handoff, session: SESSION }, t.options);
  expect(taken).toEqual({ type: "taken", v: 1, handoff: "h1", session: `claude-code:${SESSION}`, failures: [] });
  const dir = `${t.receiver.clone}-handoff-h1`;
  expect(git(dir, "branch", "--show-current")).toBe("isoplan/handoff/h1");
  expect(fs.readFileSync(path.join(dir, "app.js"), "utf8")).toBe("console.log('handed over');\n");
  expect(fs.readFileSync(path.join(dir, "setup-ran.txt"), "utf8")).toBe("isoplan/handoff/h1");
  // Orca and its like see it as one of the clone's worktrees.
  expect(git(t.receiver.clone, "worktree", "list")).toContain("handoff-h1");
  const folder = path.join(t.claudeDir, "isoplan", "handoffs", "h1");
  expect(fs.readFileSync(path.join(folder, "brief.md"), "utf8")).toBe("Goal: ship the export.\n");
  const [l] = t.opened;
  expect(l!.command.slice(1)).toEqual(["/d", "/c", "start", '"Isoplan handoff h1"', "cmd.exe", "/k", `""${path.join(folder, "open.cmd")}""`]);
  expect(l!.text).toContain(`cd /d "${dir}"`);
  // The prompt comes before --add-dir, which takes every argument after it.
  expect(l!.text).toMatch(new RegExp(`"C:\\\\Users\\\\sam\\\\.local\\\\bin\\\\claude.exe" "Isoplan handoff h1: [^"]*" "--session-id" "${SESSION}" "--name" "Isoplan handoff h1" "--add-dir" "[^"]*"\\r\\n$`));
  expect(t.started).toEqual([]);
});

test("headless: the same worktree and setup, then claude -p with no window, the prompt first", async () => {
  const t = await handedOver("h2", { command: "node -e \"require('fs').writeFileSync('setup-ran.txt', 'yes')\"" });
  const taken = await takeHandoff({ handoff: t.handoff, mode: "headless", session: SESSION }, t.options);
  expect(taken.session).toBe(`claude-code:${SESSION}`);
  expect(t.opened).toEqual([]);
  const dir = `${t.receiver.clone}-handoff-h2`;
  expect(fs.readFileSync(path.join(dir, "setup-ran.txt"), "utf8")).toBe("yes");
  const [h] = t.started;
  expect(h!.cwd).toBe(dir);
  expect(h!.argv.slice(0, 2)).toEqual(["C:\\Users\\sam\\.local\\bin\\claude.exe", "-p"]);
  expect(h!.argv[2]).toMatch(/^Isoplan handoff h2: you are taking this work over\. Read its brief in /);
  expect(h!.argv.slice(3, 7)).toEqual(["--session-id", SESSION, "--name", "Isoplan handoff h2"]);
  expect(h!.argv.at(-2)).toBe("--add-dir");
});

test("the session's command line parses: the prompt is the prompt, and --add-dir takes only the folder", () => {
  expect(sessionArgv("claude", { prompt: "Read it", session: SESSION, name: "n", folder: "/f", headless: false })).toEqual(["claude", "Read it", "--session-id", SESSION, "--name", "n", "--add-dir", "/f"]);
});

test("a failing setup script still opens the session, and its output is scanned before it leaves", async () => {
  const t = await handedOver("h3", { command: { windows: `echo key ${FAKE_KEY} && exit 3`, mac: `echo key ${FAKE_KEY}; exit 3` } });
  const taken = await takeHandoff({ handoff: t.handoff }, t.options);
  expect(taken.session).toMatch(/^claude-code:/);
  expect(taken.failures).toEqual([{ step: "setup", output: "The end of its output is withheld here: it matches a secret pattern. It is on sam-laptop." }]);
  expect(t.opened[0]!.text).toContain("The worktree's setup script failed; the end of its output is in");
});

test("setup is read from the remote's default branch only: never the handoff's branch, never the clone's own", async () => {
  const t = await handedOver("h4");
  const pwned = (name: string) => JSON.stringify({ worktreeSetup: { command: `node -e "require('fs').writeFileSync('${name}','')"` } });
  // On the handoff's branch.
  fs.writeFileSync(path.join(t.sender.clone, "isoplan.json"), pwned("from-handoff.txt"));
  git(t.sender.clone, "add", "isoplan.json");
  const repo = await pushed(t.sender.clone, "h4");
  // On the branch the receiver's clone has checked out.
  git(t.receiver.clone, "switch", "-q", "-c", "theirs");
  fs.writeFileSync(path.join(t.receiver.clone, "isoplan.json"), pwned("from-clone-head.txt"));
  git(t.receiver.clone, "add", "isoplan.json");
  git(t.receiver.clone, "commit", "-q", "-m", "x");
  await takeHandoff({ handoff: { ...t.handoff, repos: [repo] } }, t.options);
  const dir = `${t.receiver.clone}-handoff-h4`;
  expect(fs.existsSync(path.join(dir, "from-handoff.txt"))).toBe(false);
  expect(fs.existsSync(path.join(dir, "from-clone-head.txt"))).toBe(false);
});

test("with no <remote>/HEAD, the remote says which branch is the default; setup runs from it", async () => {
  const t = await handedOver("h5", { command: "node -e \"require('fs').writeFileSync('setup-ran.txt', 'yes')\"" });
  git(t.receiver.clone, "remote", "set-head", "origin", "-d");
  const taken = await takeHandoff({ handoff: t.handoff }, t.options);
  expect(taken.failures).toEqual([]);
  expect(fs.existsSync(path.join(`${t.receiver.clone}-handoff-h5`, "setup-ran.txt"))).toBe(true);
});

test("a re-take never drops the receiver's work: a worktree with commits or changes not in the new tip is left, and the take refused", async () => {
  const t = await handedOver("h6");
  await takeHandoff({ handoff: t.handoff }, t.options);
  const dir = `${t.receiver.clone}-handoff-h6`;
  fs.writeFileSync(path.join(dir, "mine.txt"), "the receiver's own\n");
  git(dir, "add", "mine.txt");
  git(dir, "commit", "-q", "-m", "mine");
  const mine = git(dir, "rev-parse", "HEAD");
  // Handed over again: the branch is replaced.
  fs.writeFileSync(path.join(t.sender.clone, "app.js"), "console.log('again');\n");
  const repo = await pushed(t.sender.clone, "h6");
  const again = await takeHandoff({ handoff: { ...t.handoff, repos: [repo] } }, t.options);
  expect(again.session).toBe(undefined);
  expect(again.failures).toEqual([{ step: "worktree", output: expect.stringContaining("has work that isn't in the handoff as handed over now (1 commit(s))") }]);
  expect(git(dir, "rev-parse", "HEAD")).toBe(mine);

  // Uncommitted changes are kept the same way; with neither, it moves to the new tip.
  git(dir, "reset", "-q", "--hard", "origin/isoplan/handoff/h6");
  fs.writeFileSync(path.join(dir, "app.js"), "dirty\n");
  expect((await takeHandoff({ handoff: { ...t.handoff, repos: [repo] } }, t.options)).failures[0]!.output).toContain("uncommitted changes");
  git(dir, "checkout", "--", "app.js");
  // An untracked file, a setup script's say, doesn't hold it back, and stays.
  fs.writeFileSync(path.join(dir, "setup-ran.txt"), "yes\n");
  expect((await takeHandoff({ handoff: { ...t.handoff, repos: [repo] } }, t.options)).failures).toEqual([]);
  expect(fs.readFileSync(path.join(dir, "app.js"), "utf8")).toBe("console.log('again');\n");
  expect(fs.existsSync(path.join(dir, "setup-ran.txt"))).toBe(true);
});

test("with no clone of the repo on the machine, no session opens and the failure says what to do", async () => {
  const t = await handedOver("h7");
  fs.rmSync(path.join(t.claudeDir, "projects"), { recursive: true });
  const taken = await takeHandoff({ handoff: t.handoff }, t.options);
  expect(taken.session).toBe(undefined);
  expect(taken.failures).toEqual([{ step: "worktree", output: expect.stringMatching(/^No clone of .* was found on sam-laptop.*copy its prompt/s) }]);
  expect(t.opened).toEqual([]);
});

test("findClone: the most recently used clone, with a remote whose path has spaces", async () => {
  const root = tempRoot();
  const spaced = path.join(root, "with spaces");
  fs.mkdirSync(spaced);
  const { remote, clone: older } = remoteAndClone(spaced, "older");
  const newer = path.join(spaced, "newer");
  git(spaced, "clone", "-q", remote, newer);
  const projects = path.join(root, "projects");
  for (const [name, cwd, age] of [["a", older, 60], ["b", newer, 10]] as const) {
    fs.mkdirSync(path.join(projects, name), { recursive: true });
    const file = path.join(projects, name, "s.jsonl");
    fs.writeFileSync(file, JSON.stringify({ cwd }) + "\n");
    const at = new Date(Date.now() - age * 1000);
    fs.utimesSync(file, at, at);
  }
  expect(await findClone(nodeIo(), run, projects, remote, Date.now() - 86400000, 30000)).toEqual({ dir: path.resolve(newer), remote: "origin" });
});

test("the shortcut checks the branch out here, moves a local branch to the new tip, and never over commits of its own", async () => {
  const t = await handedOver("h8");
  expect((await checkoutHere(run, t.receiver.clone, t.handoff, 30000)).failures).toEqual([]);
  expect(git(t.receiver.clone, "branch", "--show-current")).toBe("isoplan/handoff/h8");
  // Handed over again: the local branch moves to the replaced tip.
  git(t.receiver.clone, "switch", "-q", "main");
  fs.writeFileSync(path.join(t.sender.clone, "app.js"), "console.log('again');\n");
  const repo = await pushed(t.sender.clone, "h8");
  expect((await checkoutHere(run, t.receiver.clone, { ...t.handoff, repos: [repo] }, 30000)).failures).toEqual([]);
  expect(git(t.receiver.clone, "rev-parse", "HEAD")).toBe(repo.commit);
  // A commit of the receiver's on it is never lost.
  fs.writeFileSync(path.join(t.receiver.clone, "mine.txt"), "mine\n");
  git(t.receiver.clone, "add", "mine.txt");
  git(t.receiver.clone, "commit", "-q", "-m", "mine");
  const mine = git(t.receiver.clone, "rev-parse", "HEAD");
  expect((await checkoutHere(run, t.receiver.clone, { ...t.handoff, repos: [repo] }, 30000)).failures).toEqual([{ step: "checkout", output: expect.stringContaining("has 1 commit(s) that aren't in the handoff") }]);
  expect(git(t.receiver.clone, "rev-parse", "HEAD")).toBe(mine);
  const elsewhere = path.join(t.root, "plain");
  fs.mkdirSync(elsewhere);
  expect((await checkoutHere(run, elsewhere, t.handoff, 30000)).failures).toEqual([{ step: "checkout", output: expect.stringContaining("isn't in a git repo") }]);
});

test("isoplan.json: a command, or one per platform, with an optional timeout; anything else is an error", () => {
  expect(parseSetup('{"worktreeSetup":{"command":"pnpm install"}}', "darwin", 900000)).toEqual({ command: "pnpm install", timeoutMs: 900000 });
  expect(parseSetup('{"worktreeSetup":{"command":{"windows":"setup.cmd","mac":"./setup.sh"},"timeoutMinutes":2}}', "win32", 900000)).toEqual({ command: "setup.cmd", timeoutMs: 120000 });
  expect(parseSetup('{"worktreeSetup":{"command":{"windows":"setup.cmd"}}}', "darwin", 900000)).toBe(null);
  expect(parseSetup("{}", "darwin", 900000)).toBe(null);
  expect(() => parseSetup('{"worktreeSetup":{"command":3}}', "darwin", 900000)).toThrow("must be a command");
  expect(() => parseSetup('{"worktreeSetup":{"command":"x","timeoutMinutes":0}}', "darwin", 900000)).toThrow("timeoutMinutes");
});

test.runIf(process.platform === "win32")("the Windows launcher runs from a folder whose path has & ( ) @ ^ in it, run hidden as cmd /k would", () => {
  const folder = path.join(tempRoot(), "a&b (c) @d ^e");
  const dir = path.join(folder, "work & play");
  fs.mkdirSync(dir, { recursive: true });
  // The launcher drops quotes, which no Windows path holds, so the script names its file in single ones.
  const l = launch("win32", { folder, dir, argv: [process.execPath, "-e", "require('fs').writeFileSync('ran.txt', process.cwd())"], title: "Isoplan handoff h1 (test) & co", configDir: null })!;
  fs.writeFileSync(l.file, l.text);
  // The same quoting as the launch's cmd /k, through /c, in this hidden console: no window opens.
  const r = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", l.command.at(-1)!], { windowsHide: true, windowsVerbatimArguments: true, stdio: "pipe", encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(fs.readFileSync(path.join(dir, "ran.txt"), "utf8")).toBe(dir);
});

test("on a Mac the launcher is a .command file Terminal opens, with the config folder in it", () => {
  const l = launch("darwin", { folder: "/Users/sam/.claude/isoplan/handoffs/h1", dir: "/Users/sam/app-handoff-h1", argv: ["/Users/sam/.local/bin/claude", "Sam's brief", "--session-id", "u"], title: "Isoplan handoff h1", configDir: "/Users/sam/.claude" });
  expect(l).toEqual({
    file: "/Users/sam/.claude/isoplan/handoffs/h1/open.command",
    text: "#!/bin/sh\nexport CLAUDE_CONFIG_DIR='/Users/sam/.claude'\ncd '/Users/sam/app-handoff-h1' || exit 1\nexec '/Users/sam/.local/bin/claude' 'Sam'\\''s brief' '--session-id' 'u'\n",
    command: ["open", "-a", "Terminal", "/Users/sam/.claude/isoplan/handoffs/h1/open.command"],
  });
  expect(launch("linux", { folder: "/f", dir: "/d", argv: ["claude"], title: "t", configDir: null })).toBe(null);
});
