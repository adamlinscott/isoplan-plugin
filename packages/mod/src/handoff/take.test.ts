import fs from "node:fs";
import path from "node:path";
import type { Handoff } from "@isoplan/protocol";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { nodeIo } from "../data-layer/io.js";
import { createRunGit, pushHandoff, type RunGit } from "./git.js";
import { git, remoteAndClone, workspace } from "./fixture.js";
import { checkoutHere, findClone, findWorkspace, launch, onTheWire, parseSetup, sessionArgv, takeHandoff, trustFolder, trustKey, type Background, type Launch, type TakeOptions } from "./take.js";

// Every test here drives real git, a few dozen spawns each, which is slow on Windows under load.
vi.setConfig({ testTimeout: 30000 });

const run = createRunGit();
const SETTINGS = { gitTimeoutSeconds: 30, setupTimeoutMinutes: 15, cloneSearchDays: 30, repoSearchDepth: 3 };
// A fake AWS key id, split so no key-shaped string sits in the source.
const FAKE_KEY = "AKIA" + "IOSFODNN7EXAMPLE";
const SESSION = "0b5c4d3e-0000-4000-8000-000000000001";

const pushed = async (cwd: string, id: string) => {
  const r = await pushHandoff(run, cwd, id, 30000);
  if ("held" in r) throw new Error("held");
  return r.repos[0]!;
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
  const started: Background[] = [];
  const claudeJson = path.join(root, ".claude.json");
  fs.writeFileSync(claudeJson, JSON.stringify({ userID: "u", projects: { "/elsewhere": { hasTrustDialogAccepted: false, allowedTools: ["Read"] } } }, null, 2));
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
    claudeJson,
    // Nothing here opens a window or starts a process: both are recorded instead.
    open: async (l) => void opened.push(l),
    start: async (h) => void started.push(h),
    agents: async () => started.map((h) => h.argv[h.argv.indexOf("--session-id") + 1]!),
    confirmMs: 200,
    // The tests' remotes are local bare repos, which a real take never clones from.
    cloneFrom: () => true,
  };
  return { root, sender, receiver, handoff, options, opened, started, claudeDir, claudeJson };
}

test("taking from the floor: a worktree beside the clone on the handoff's branch, the setup script, then Claude Code with the brief, under the server's session id", async () => {
  const t = await handedOver("h1", { command: "node -e \"require('fs').writeFileSync('setup-ran.txt', process.env.ISOPLAN_HANDOFF_BRANCH)\"" });
  const taken = await takeHandoff({ handoff: t.handoff, mode: "terminal", session: SESSION }, t.options);
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

test("headless: the same worktree and setup, the worktree alone trusted, then claude --bg with no window, confirmed by claude agents", async () => {
  const t = await handedOver("h2", { command: "node -e \"require('fs').writeFileSync('setup-ran.txt', 'yes')\"" });
  const taken = await takeHandoff({ handoff: t.handoff, mode: "headless", session: SESSION }, t.options);
  expect(taken).toMatchObject({ session: `claude-code:${SESSION}`, failures: [] });
  expect(t.opened).toEqual([]);
  const dir = `${t.receiver.clone}-handoff-h2`;
  expect(fs.readFileSync(path.join(dir, "setup-ran.txt"), "utf8")).toBe("yes");
  const [h] = t.started;
  expect(h!.cwd).toBe(dir);
  expect(h!.argv[1]).toMatch(/^Isoplan handoff h2: you are taking this work over\. Read its brief in /);
  expect(h!.argv.slice(2, 7)).toEqual(["--bg", "--session-id", SESSION, "--name", "Isoplan handoff h2"]);
  expect(h!.argv.at(-2)).toBe("--add-dir");
  const config = JSON.parse(fs.readFileSync(t.claudeJson, "utf8"));
  expect(config).toEqual({ userID: "u", projects: { "/elsewhere": { hasTrustDialogAccepted: false, allowedTools: ["Read"] }, [trustKey(dir, "win32")]: { hasTrustDialogAccepted: true } } });
});

test("headless: a session claude agents doesn't list is reported, not taken", async () => {
  const t = await handedOver("h2b");
  const taken = await takeHandoff({ handoff: t.handoff, mode: "headless", session: SESSION }, { ...t.options, agents: async () => [] });
  expect(taken.session).toBe(undefined);
  expect(taken.failures).toEqual([{ step: "open", output: expect.stringContaining("doesn't list session") }]);
});

test("a handoff that doesn't say how to open its session is refused, and opens nothing", async () => {
  const t = await handedOver("h2c");
  const taken = await takeHandoff({ handoff: t.handoff }, t.options);
  expect(taken).toEqual({ type: "taken", v: 1, handoff: "h2c", failures: [{ step: "open", output: expect.stringContaining("didn't say how to open the session") }] });
  expect(t.opened).toEqual([]);
  expect(t.started).toEqual([]);
});

test("the session's command line parses: the prompt is the prompt, and --add-dir takes only the folder", () => {
  expect(sessionArgv("claude", { prompt: "Read it", session: SESSION, name: "n", folder: "/f", headless: false })).toEqual(["claude", "Read it", "--session-id", SESSION, "--name", "n", "--add-dir", "/f"]);
});

test("trust: only that folder's entry changes, and one already trusted isn't rewritten", async () => {
  const file = path.join(tempRoot(), ".claude.json");
  const before = JSON.stringify({ a: 1, projects: { "C:/x": { hasTrustDialogAccepted: true } } }, null, 2);
  fs.writeFileSync(file, before);
  await trustFolder(file, "C:\\x", "win32");
  expect(fs.readFileSync(file, "utf8")).toBe(before);
  await trustFolder(file, "C:\\work\\app-handoff-h1", "win32");
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ a: 1, projects: { "C:/x": { hasTrustDialogAccepted: true }, "C:/work/app-handoff-h1": { hasTrustDialogAccepted: true } } });
});

test("a failing setup script still opens the session, and its output is scanned before it leaves", async () => {
  const t = await handedOver("h3", { command: { windows: `echo key ${FAKE_KEY} && exit 3`, mac: `echo key ${FAKE_KEY}; exit 3` } });
  const taken = await takeHandoff({ handoff: t.handoff, mode: "terminal" }, t.options);
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
  await takeHandoff({ handoff: { ...t.handoff, repos: [repo] }, mode: "terminal" }, t.options);
  const dir = `${t.receiver.clone}-handoff-h4`;
  expect(fs.existsSync(path.join(dir, "from-handoff.txt"))).toBe(false);
  expect(fs.existsSync(path.join(dir, "from-clone-head.txt"))).toBe(false);
});

test("with no <remote>/HEAD, the remote says which branch is the default; setup runs from it", async () => {
  const t = await handedOver("h5", { command: "node -e \"require('fs').writeFileSync('setup-ran.txt', 'yes')\"" });
  git(t.receiver.clone, "remote", "set-head", "origin", "-d");
  const taken = await takeHandoff({ handoff: t.handoff, mode: "terminal" }, t.options);
  expect(taken.failures).toEqual([]);
  expect(fs.existsSync(path.join(`${t.receiver.clone}-handoff-h5`, "setup-ran.txt"))).toBe(true);
});

test("a re-take never drops the receiver's work: a worktree with commits or changes not in the new tip is left, and the take refused", async () => {
  const t = await handedOver("h6");
  const opts = { mode: "terminal" as const };
  await takeHandoff({ handoff: t.handoff, ...opts }, t.options);
  const dir = `${t.receiver.clone}-handoff-h6`;
  fs.writeFileSync(path.join(dir, "mine.txt"), "the receiver's own\n");
  git(dir, "add", "mine.txt");
  git(dir, "commit", "-q", "-m", "mine");
  const mine = git(dir, "rev-parse", "HEAD");
  // Handed over again: the branch is replaced.
  fs.writeFileSync(path.join(t.sender.clone, "app.js"), "console.log('again');\n");
  const repo = await pushed(t.sender.clone, "h6");
  const again = await takeHandoff({ handoff: { ...t.handoff, repos: [repo] }, ...opts }, t.options);
  expect(again.session).toBe(undefined);
  expect(again.failures).toEqual([{ step: "worktree", output: expect.stringContaining("has work that isn't in the handoff as handed over now (1 commit(s))") }]);
  expect(git(dir, "rev-parse", "HEAD")).toBe(mine);

  // Uncommitted changes are kept the same way; with neither, it moves to the new tip.
  git(dir, "reset", "-q", "--hard", "origin/isoplan/handoff/h6");
  fs.writeFileSync(path.join(dir, "app.js"), "dirty\n");
  expect((await takeHandoff({ handoff: { ...t.handoff, repos: [repo] }, ...opts }, t.options)).failures[0]!.output).toContain("uncommitted changes");
  git(dir, "checkout", "--", "app.js");
  // An untracked file, a setup script's say, doesn't hold it back, and stays.
  fs.writeFileSync(path.join(dir, "setup-ran.txt"), "yes\n");
  expect((await takeHandoff({ handoff: { ...t.handoff, repos: [repo] }, ...opts }, t.options)).failures).toEqual([]);
  expect(fs.readFileSync(path.join(dir, "app.js"), "utf8")).toBe("console.log('again');\n");
  expect(fs.existsSync(path.join(dir, "setup-ran.txt"))).toBe(true);
  // Four takes of real git: past vitest's 5 s default on a loaded Windows machine.
}, 30000);

test("with no clone of the repo on the machine, no session opens and the failure says what to do", async () => {
  const t = await handedOver("h7");
  fs.rmSync(path.join(t.claudeDir, "projects"), { recursive: true });
  const taken = await takeHandoff({ handoff: t.handoff, mode: "terminal" }, t.options);
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

test("the shortcut checks the branch out here, moves a local branch to the new tip, and never over commits of its own or a dirty tree", async () => {
  const t = await handedOver("h8");
  const folder = path.join(t.claudeDir, "isoplan", "handoffs", "h8");
  // Uncommitted changes to tracked files aren't carried over.
  fs.writeFileSync(path.join(t.receiver.clone, "app.js"), "mine, uncommitted\n");
  expect((await checkoutHere(run, t.receiver.clone, t.handoff, folder, 30000)).failures).toEqual([{ step: "checkout", output: expect.stringContaining("uncommitted changes") }]);
  git(t.receiver.clone, "checkout", "--", "app.js");
  expect((await checkoutHere(run, t.receiver.clone, t.handoff, folder, 30000)).failures).toEqual([]);
  expect(git(t.receiver.clone, "branch", "--show-current")).toBe("isoplan/handoff/h8");
  // Handed over again: the local branch moves to the replaced tip.
  git(t.receiver.clone, "switch", "-q", "main");
  fs.writeFileSync(path.join(t.sender.clone, "app.js"), "console.log('again');\n");
  const repo = await pushed(t.sender.clone, "h8");
  expect((await checkoutHere(run, t.receiver.clone, { ...t.handoff, repos: [repo] }, folder, 30000)).failures).toEqual([]);
  expect(git(t.receiver.clone, "rev-parse", "HEAD")).toBe(repo.commit);
  // A commit of the receiver's on it is never lost.
  fs.writeFileSync(path.join(t.receiver.clone, "mine.txt"), "mine\n");
  git(t.receiver.clone, "add", "mine.txt");
  git(t.receiver.clone, "commit", "-q", "-m", "mine");
  const mine = git(t.receiver.clone, "rev-parse", "HEAD");
  expect((await checkoutHere(run, t.receiver.clone, { ...t.handoff, repos: [repo] }, folder, 30000)).failures).toEqual([{ step: "checkout", output: expect.stringContaining("has 1 commit(s) that aren't in the handoff") }]);
  expect(git(t.receiver.clone, "rev-parse", "HEAD")).toBe(mine);
  const elsewhere = path.join(t.root, "plain");
  fs.mkdirSync(elsewhere);
  expect((await checkoutHere(run, elsewhere, t.handoff, folder, 30000)).failures).toEqual([{ step: "checkout", output: expect.stringContaining("isn't in a git repo") }]);
});

test("isoplan.json: a command, or one per platform, with an optional timeout; anything else is an error", () => {
  expect(parseSetup('{"worktreeSetup":{"command":"pnpm install"}}', "darwin", 900000)).toEqual({ command: "pnpm install", timeoutMs: 900000 });
  expect(parseSetup('{"worktreeSetup":{"command":{"windows":"setup.cmd","mac":"./setup.sh"},"timeoutMinutes":2}}', "win32", 900000)).toEqual({ command: "setup.cmd", timeoutMs: 120000 });
  expect(parseSetup('{"worktreeSetup":{"command":{"windows":"setup.cmd"}}}', "darwin", 900000)).toBe(null);
  expect(parseSetup("{}", "darwin", 900000)).toBe(null);
  expect(() => parseSetup('{"worktreeSetup":{"command":3}}', "darwin", 900000)).toThrow("must be a command");
  expect(() => parseSetup('{"worktreeSetup":{"command":"x","timeoutMinutes":0}}', "darwin", 900000)).toThrow("timeoutMinutes");
});

test("the Windows launcher: UTF-8 first, every argument quoted whole, so & ( ) @ ^ and letters outside ASCII in a path come through (written and read, never run)", () => {
  const folder = "C:\\Users\\Zoë\\.claude\\isoplan\\handoffs\\h1";
  const dir = "C:\\Work\\R&D (été) @x ^y\\app-handoff-h1";
  const l = launch("win32", { folder, dir, argv: ["C:\\Users\\Zoë\\.local\\bin\\claude.exe", "Read 100% of it", "--add-dir", folder], title: "Isoplan handoff h1 (test) & co", configDir: null })!;
  const lines = l.text.split("\r\n");
  expect(lines.slice(0, 4)).toEqual(["@echo off", "chcp 65001>nul", "title Isoplan handoff h1 test  co", `cd /d "${dir}"`]);
  expect(lines[4]).toBe(`"C:\\Users\\Zoë\\.local\\bin\\claude.exe" "Read 100%% of it" "--add-dir" "${folder}"`);
  // cmd /k takes the outer quotes off a path with & or ( in it, so it gets two pairs.
  expect(l.command.at(-1)).toBe(`""${folder}\\open.cmd""`);
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

// Several repos (#56): a sender's workspace with its changes handed over as `id`, and a receiver
// whose one session ran in their own copy of the workspace.
const SLOW = 120000;
const LOCAL = { cloneFrom: () => true };
async function severalHandedOver(id: string, { parent = true, setup }: { parent?: boolean; setup?: (remotes: Record<string, string>) => string } = {}) {
  const t = await handedOver(id);
  const sender = workspace(t.root, "ws-sender", { parent });
  if (setup) {
    fs.writeFileSync(path.join(sender.dir, "isoplan.json"), JSON.stringify({ worktreeSetup: { command: setup(sender.remotes) } }));
    git(sender.dir, "add", "isoplan.json");
    git(sender.dir, "commit", "-q", "-m", "setup");
    git(sender.dir, "push", "-q", "origin", "main");
  }
  fs.writeFileSync(path.join(sender.dir, "api", "server.js"), "listen('handed over');\n");
  fs.writeFileSync(path.join(sender.dir, "web", "index.html"), "<p>handed over</p>\n");
  const r = await pushHandoff(run, sender.dir, id, 30000);
  if ("held" in r) throw new Error("held");
  const receiver = workspace(t.root, "ws-receiver", { parent });
  fs.writeFileSync(path.join(t.claudeDir, "projects", "C--receiver", "s1.jsonl"), JSON.stringify({ type: "user", cwd: receiver.dir }) + "\n");
  const handoff: Handoff = { id, brief: "Goal: ship the workspace.", repos: r.repos };
  return { ...t, sender, receiver, handoff };
}
const onBranch = (dir: string, id: string) => git(dir, "branch", "--show-current") === `isoplan/handoff/${id}`;
// The setup command that clones `remote` into `folder` in the new worktree, on main.
const cloneInSetup = (remote: string, folder: string) => `git clone -q ${JSON.stringify(remote)} ${folder}`;

test("several repos from the floor: after setup (which cloned api on main), each repo is on the handoff's branch, the one setup didn't clone cloned; the parent ignores them", async () => {
  const t = await severalHandedOver("m1", { setup: (r) => cloneInSetup(r.api!, "api") });
  expect(t.handoff.repos.map((r) => r.path)).toEqual([".", "api", "web"]);
  const taken = await takeHandoff({ handoff: t.handoff, mode: "terminal", session: SESSION }, t.options);
  expect(taken).toEqual({ type: "taken", v: 1, handoff: "m1", session: `claude-code:${SESSION}`, failures: [] });
  const dir = `${t.receiver.dir}-handoff-m1`;
  for (const repo of [dir, path.join(dir, "api"), path.join(dir, "web")]) expect(onBranch(repo, "m1")).toBe(true);
  // As committed: the receiver's clones check out with this machine's own line endings.
  expect(git(path.join(dir, "api"), "show", "HEAD:server.js")).toBe("listen('handed over');");
  expect(git(path.join(dir, "web"), "show", "HEAD:index.html")).toBe("<p>handed over</p>");
  expect(git(dir, "status", "--porcelain")).toBe("");
  // No repo's default branch was pushed to.
  for (const remote of Object.values(t.sender.remotes)) expect(git(remote, "log", "-1", "--format=%s", "main")).not.toContain("WIP");
}, SLOW);

test("several repos from the floor: a repo that can't be checked out still opens the session, and the meeting and the session are told which", async () => {
  // Setup puts the wrong repo at api.
  const t = await severalHandedOver("m2", { setup: (r) => cloneInSetup(r.web!, "api") });
  const taken = await takeHandoff({ handoff: t.handoff, mode: "terminal", session: SESSION }, t.options);
  const dir = `${t.receiver.dir}-handoff-m2`;
  expect(taken.session).toBe(`claude-code:${SESSION}`);
  expect(taken.failures).toEqual([{ step: "checkout", repo: "api", output: expect.stringContaining(`No remote of the repo in ${path.join(dir, "api")} is`) }]);
  expect(onBranch(path.join(dir, "web"), "m2")).toBe(true);
  expect(t.opened[0]!.text).toContain("These repos in this folder couldn't be put on the handoff's branch, so check them first: api.");
}, SLOW);

test("several repos: a re-take never drops the receiver's commits in a repo under the folder", async () => {
  const t = await severalHandedOver("m3");
  await takeHandoff({ handoff: t.handoff, mode: "terminal" }, t.options);
  const api = path.join(`${t.receiver.dir}-handoff-m3`, "api");
  fs.writeFileSync(path.join(api, "mine.txt"), "mine\n");
  git(api, "add", "mine.txt");
  git(api, "commit", "-q", "-m", "mine");
  const mine = git(api, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(t.sender.dir, "api", "server.js"), "listen('again');\n");
  const again = await pushHandoff(run, t.sender.dir, "m3", 30000);
  if ("held" in again) throw new Error("held");
  const taken = await takeHandoff({ handoff: { ...t.handoff, repos: again.repos }, mode: "terminal" }, t.options);
  expect(taken.session).toMatch(/^claude-code:/);
  expect(taken.failures).toEqual([{ step: "checkout", repo: "api", output: expect.stringContaining("has 1 commit(s) that aren't in the handoff") }]);
  expect(git(api, "rev-parse", "HEAD")).toBe(mine);
}, SLOW);

test("a plain folder's handoff from the floor: a plain folder beside the receiver's own, with each repo cloned on the handoff's branch, and no setup", async () => {
  const t = await severalHandedOver("m4", { parent: false });
  expect(t.handoff.repos.map((r) => r.path)).toEqual(["api", "web"]);
  const taken = await takeHandoff({ handoff: t.handoff, mode: "headless", session: SESSION }, t.options);
  expect(taken).toMatchObject({ session: `claude-code:${SESSION}`, failures: [] });
  const dir = `${t.receiver.dir}-handoff-m4`;
  expect(fs.existsSync(path.join(dir, ".git"))).toBe(false);
  for (const repo of [path.join(dir, "api"), path.join(dir, "web")]) expect(onBranch(repo, "m4")).toBe(true);
  expect(t.started[0]!.cwd).toBe(dir);
  // A session the receiver ran in one of the repos finds the folder too.
  fs.writeFileSync(path.join(t.claudeDir, "projects", "C--receiver", "s1.jsonl"), JSON.stringify({ cwd: path.join(t.receiver.dir, "web") }) + "\n");
  expect(await findWorkspace(nodeIo(), run, path.join(t.claudeDir, "projects"), t.handoff.repos, 0, 30000)).toBe(path.resolve(t.receiver.dir));
}, SLOW);

test("the shortcut with several repos: the folder's repo, then each under it, switched where it is and cloned where it isn't; a path out through a link, or into .git, is refused", async () => {
  const t = await severalHandedOver("m5");
  const folder = path.join(t.claudeDir, "isoplan", "handoffs", "m5");
  fs.rmSync(path.join(t.receiver.dir, "web"), { recursive: true, force: true });
  expect((await checkoutHere(run, t.receiver.dir, t.handoff, folder, 30000, LOCAL)).failures).toEqual([]);
  for (const dir of [t.receiver.dir, path.join(t.receiver.dir, "api"), path.join(t.receiver.dir, "web")]) expect(onBranch(dir, "m5")).toBe(true);

  // A dirty folder repo leaves every repo as it was.
  git(t.receiver.dir, "switch", "-q", "main");
  git(path.join(t.receiver.dir, "api"), "switch", "-q", "main");
  fs.writeFileSync(path.join(t.receiver.dir, "README.md"), "mine\n");
  expect((await checkoutHere(run, t.receiver.dir, t.handoff, folder, 30000, LOCAL)).failures).toEqual([{ step: "checkout", output: expect.stringContaining("uncommitted changes") }]);
  expect(git(path.join(t.receiver.dir, "api"), "branch", "--show-current")).toBe("main");

  const elsewhere = path.join(t.root, "elsewhere");
  const plain = path.join(t.root, "plain");
  fs.mkdirSync(elsewhere);
  fs.mkdirSync(plain);
  fs.symlinkSync(elsewhere, path.join(plain, "api"), "junction");
  const commit = t.handoff.repos[1]!.commit;
  const odd: Handoff = {
    id: "m5",
    brief: "b",
    repos: [
      { path: "api", remote: t.sender.remotes.api!, branch: "isoplan/handoff/m5", commit },
      { path: ".git/hooks", remote: t.sender.remotes.web!, branch: "isoplan/handoff/m5", commit },
    ],
  };
  expect((await checkoutHere(run, plain, odd, folder, 30000, LOCAL)).failures).toEqual([
    { step: "checkout", repo: "api", output: expect.stringContaining("leads outside") },
    { step: "checkout", repo: ".git/hooks", output: expect.stringContaining("inside a .git folder") },
  ]);
  expect(fs.readdirSync(elsewhere)).toEqual([]);
}, SLOW);

test("a missing repo is cloned only from https, ssh or host:path, with Git LFS's download off", async () => {
  for (const remote of ["https://github.com/team/api.git", "ssh://git@github.com/team/api.git", "git@github.com:team/api.git", "github.com:team/api.git"]) expect(onTheWire(remote), remote).toBe(true);
  for (const remote of ["C:\remotes\api.git", "C:/remotes/api.git", "/srv/git/api.git", "\\server\share\api.git", "//server/share/api.git", "file:///C:/remotes/api.git", "http://github.com/team/api.git", "api.git"]) expect(onTheWire(remote), remote).toBe(false);
  const t = await severalHandedOver("w1", { parent: false });
  const plain = path.join(t.root, "plain");
  fs.mkdirSync(plain);
  const folder = path.join(t.claudeDir, "isoplan", "handoffs", "w1");
  expect((await checkoutHere(run, plain, t.handoff, folder, 30000)).failures).toEqual([
    { step: "checkout", repo: "api", output: expect.stringContaining("isn't an https, ssh or host:path remote, so it wasn't cloned") },
    { step: "checkout", repo: "web", output: expect.stringContaining("never clones from a local path") },
  ]);
  expect(fs.readdirSync(plain)).toEqual([]);
  const envs: (Record<string, string> | undefined)[] = [];
  const watched: RunGit = (args, opts) => (args.includes("clone") && envs.push(opts.env), run(args, opts));
  expect((await checkoutHere(watched, plain, t.handoff, folder, 30000, LOCAL)).failures).toEqual([]);
  expect(envs).toEqual([{ GIT_LFS_SKIP_SMUDGE: "1" }, { GIT_LFS_SKIP_SMUDGE: "1" }]);
  // Taken again, the repos there are switched and reset with LFS's download off too.
  const moves: [string, Record<string, string> | undefined][] = [];
  const again: RunGit = (args, opts) => ((args.includes("switch") || args.includes("reset")) && moves.push([args.find((a) => a === "switch" || a === "reset")!, opts.env]), run(args, opts));
  for (const repo of ["api", "web"]) git(path.join(plain, repo), "switch", "-q", "-c", "elsewhere");
  expect((await checkoutHere(again, plain, t.handoff, folder, 30000, LOCAL)).failures).toEqual([]);
  expect(moves.length).toBeGreaterThan(0);
  for (const [, env] of moves) expect(env).toEqual({ GIT_LFS_SKIP_SMUDGE: "1" });
}, SLOW);

test("a path Windows reads as .git, in any spelling, one with a colon (an NTFS stream), and one with an empty, . or .. part, are refused", async () => {
  const t = await severalHandedOver("w2", { parent: false });
  const plain = path.join(t.root, "plain");
  fs.mkdirSync(plain);
  const [api] = t.handoff.repos;
  const at = (paths: string[]): Handoff => ({ ...t.handoff, repos: paths.map((p) => ({ ...api!, path: p })) });
  const folder = path.join(t.claudeDir, "isoplan", "handoffs", "w2");
  const outputs = async (paths: string[]) => (await checkoutHere(run, plain, at(paths), folder, 30000, LOCAL)).failures.map((f) => f.output);
  expect(await outputs([".GIT./hooks", ".git /hooks", "GIT~1/hooks", "a/.Git. ./b"])).toEqual(Array(4).fill(expect.stringContaining("is inside a .git folder")));
  expect(await outputs(["api:stream", ".git::$INDEX_ALLOCATION/hooks"])).toEqual([
    expect.stringContaining("has a colon in it"),
    expect.stringContaining("is inside a .git folder"),
  ]);
  expect(await outputs(["./api", "api/.", "a//b", "a/../b"])).toEqual(Array(4).fill(expect.stringContaining("isn't a path of named folders")));
  expect(fs.readdirSync(plain)).toEqual([]);
}, SLOW);

test("repos that pushed to one remote are each taken from their own branch", async () => {
  const t = await handedOver("w3");
  const sender = workspace(t.root, "ws-sender", { parent: false });
  git(path.join(sender.dir, "web"), "remote", "set-url", "origin", sender.remotes.api!);
  git(path.join(sender.dir, "web"), "fetch", "-q", "origin");
  fs.writeFileSync(path.join(sender.dir, "api", "server.js"), "listen('api');\n");
  fs.writeFileSync(path.join(sender.dir, "web", "index.html"), "<p>web</p>\n");
  const r = await pushHandoff(run, sender.dir, "w3", 30000);
  if ("held" in r) throw new Error("held");
  const plain = path.join(t.root, "plain");
  fs.mkdirSync(plain);
  expect((await checkoutHere(run, plain, { id: "w3", brief: "b", repos: r.repos }, path.join(t.claudeDir, "isoplan", "handoffs", "w3"), 30000, LOCAL)).failures).toEqual([]);
  expect(git(path.join(plain, "api"), "branch", "--show-current")).toBe("isoplan/handoff/w3");
  expect(git(path.join(plain, "web"), "branch", "--show-current")).toBe("isoplan/handoff/w3--web");
  expect(git(path.join(plain, "web"), "show", "HEAD:index.html")).toBe("<p>web</p>");
}, SLOW);

test("the shortcut from inside one of the receiver's repos works from the folder above it; a plain folder's handoff isn't taken inside another repo", async () => {
  const t = await severalHandedOver("w4");
  const folder = path.join(t.claudeDir, "isoplan", "handoffs", "w4");
  const taken = await checkoutHere(run, path.join(t.receiver.dir, "api"), t.handoff, folder, 30000, LOCAL);
  expect(taken).toMatchObject({ failures: [], dir: path.resolve(t.receiver.dir) });
  for (const dir of [t.receiver.dir, path.join(t.receiver.dir, "api"), path.join(t.receiver.dir, "web")]) expect(onBranch(dir, "w4")).toBe(true);
  expect(fs.existsSync(path.join(t.receiver.dir, "api", "web"))).toBe(false);

  const plain = await severalHandedOver("w5", { parent: false });
  // The first fixture's receiver clone is a repo that isn't one of the handoff's.
  const refused = await checkoutHere(run, path.join(plain.root, "receiver"), plain.handoff, folder, 30000, LOCAL);
  expect(refused.failures).toEqual([{ step: "checkout", output: expect.stringContaining("which isn't one of this handoff's repos (api, web)") }]);
  expect(fs.existsSync(path.join(plain.root, "receiver", "api"))).toBe(false);
}, SLOW);
