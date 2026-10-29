import fs from "node:fs";
import path from "node:path";
import type { Handoff } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { nodeIo } from "../data-layer/io.js";
import { createRunGit, pushHandoff } from "./git.js";
import { git, remoteAndClone } from "./fixture.js";
import { checkoutHere, launch, parseSetup, takeHandoff, type Launch, type TakeOptions } from "./take.js";

const run = createRunGit();
const SETTINGS = { gitTimeoutSeconds: 30, setupTimeoutMinutes: 15, cloneSearchDays: 30 };

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
  const repo = await pushHandoff(run, sender.clone, id, 30000);
  const claudeDir = path.join(root, "claude");
  const projects = path.join(claudeDir, "projects", "C--receiver");
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(path.join(projects, "s1.jsonl"), JSON.stringify({ type: "user", cwd: receiver.clone }) + "\n");
  const handoff: Handoff = { id, brief: "Goal: ship the export.", repos: [repo] };
  const opened: Launch[] = [];
  const options: TakeOptions = {
    run,
    io: nodeIo(),
    claudeDir,
    machine: "sam-laptop",
    platform: "win32",
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
    settings: async () => SETTINGS,
    claude: async () => "C:\\Users\\sam\\.local\\bin\\claude.exe",
    scan: async (text) => (text.includes("AKIA" + "ABCDEFGHIJKLMNOP") ? "AWS access key id" : null),
    log: () => {},
    open: async (l) => void opened.push(l),
    newSession: () => "0b5c4d3e-0000-4000-8000-000000000001",
  };
  return { root, sender, receiver, handoff, options, opened, claudeDir };
}

test("taking from the floor: a worktree beside the clone on the handoff's branch, the setup script, then Claude Code with the brief", async () => {
  const t = await handedOver("h1", { command: "node -e \"require('fs').writeFileSync('setup-ran.txt', process.env.ISOPLAN_HANDOFF_BRANCH)\"" });
  const taken = await takeHandoff(t.handoff, t.options);
  expect(taken).toEqual({ type: "taken", v: 1, handoff: "h1", session: "claude-code:0b5c4d3e-0000-4000-8000-000000000001", failures: [] });
  const dir = `${t.receiver.clone}-handoff-h1`;
  expect(git(dir, "branch", "--show-current")).toBe("isoplan/handoff/h1");
  expect(fs.readFileSync(path.join(dir, "app.js"), "utf8")).toBe("console.log('handed over');\n");
  expect(fs.readFileSync(path.join(dir, "setup-ran.txt"), "utf8")).toBe("isoplan/handoff/h1");
  // Orca and its like see it as one of the clone's worktrees.
  expect(git(t.receiver.clone, "worktree", "list")).toContain("handoff-h1");
  const folder = path.join(t.claudeDir, "isoplan", "handoffs", "h1");
  expect(fs.readFileSync(path.join(folder, "brief.md"), "utf8")).toBe("Goal: ship the export.\n");
  const [l] = t.opened;
  expect(l!.command.slice(1)).toEqual(["/d", "/c", "start", '"Isoplan handoff h1"', "cmd.exe", "/k", `"${path.join(folder, "open.cmd")}"`]);
  expect(l!.text).toContain(`cd /d "${dir}"`);
  expect(l!.text).toContain('"C:\\Users\\sam\\.local\\bin\\claude.exe" "--session-id" "0b5c4d3e-0000-4000-8000-000000000001" "--name" "Isoplan handoff h1" "--add-dir"');
  expect(l!.text).toContain(`Read its brief in ${path.join(folder, "brief.md")} first.`);

  // Taken again, the same worktree is used.
  expect((await takeHandoff(t.handoff, t.options)).failures).toEqual([]);
  expect(fs.existsSync(`${dir}-2`)).toBe(false);
});

test("a failing setup script still opens the session, and the failure carries the end of its output, scanned", async () => {
  const t = await handedOver("h2", { command: { windows: "echo key " + "AKIA" + "ABCDEFGHIJKLMNOP" + " && exit 3", mac: "echo nope; exit 3" } });
  const taken = await takeHandoff(t.handoff, t.options);
  expect(taken.session).toBe("claude-code:0b5c4d3e-0000-4000-8000-000000000001");
  expect(taken.failures).toEqual([{ step: "setup", output: expect.stringContaining('withheld here: it matches the secret pattern "AWS access key id"') }]);
  expect(t.opened[0]!.text).toContain("The worktree's setup script failed; the end of its output is in");
});

test("the setup script comes from the receiver's default branch, never from the handoff's", async () => {
  const t = await handedOver("h3");
  fs.writeFileSync(path.join(t.sender.clone, "isoplan.json"), JSON.stringify({ worktreeSetup: { command: "node -e \"require('fs').writeFileSync('pwned.txt','')\"" } }));
  git(t.sender.clone, "add", "isoplan.json");
  const repo = await pushHandoff(run, t.sender.clone, "h3", 30000);
  await takeHandoff({ ...t.handoff, repos: [repo] }, t.options);
  const dir = `${t.receiver.clone}-handoff-h3`;
  expect(fs.existsSync(path.join(dir, "isoplan.json"))).toBe(true);
  expect(fs.existsSync(path.join(dir, "pwned.txt"))).toBe(false);
});

test("with no clone of the repo on the machine, no session opens and the failure says what to do", async () => {
  const t = await handedOver("h4");
  fs.rmSync(path.join(t.claudeDir, "projects"), { recursive: true });
  const taken = await takeHandoff(t.handoff, t.options);
  expect(taken.session).toBe(undefined);
  expect(taken.failures).toEqual([{ step: "worktree", output: expect.stringMatching(/^No clone of .* was found on sam-laptop.*run \/isoplan:take/s) }]);
  expect(t.opened).toEqual([]);
});

test("the shortcut checks the handoff's branch out in the session's own folder", async () => {
  const t = await handedOver("h5");
  expect(await checkoutHere(run, t.receiver.clone, t.handoff, 30000)).toEqual([]);
  expect(git(t.receiver.clone, "branch", "--show-current")).toBe("isoplan/handoff/h5");
  const elsewhere = path.join(t.root, "plain");
  fs.mkdirSync(elsewhere);
  expect(await checkoutHere(run, elsewhere, t.handoff, 30000)).toEqual([{ step: "checkout", output: expect.stringContaining("isn't in a git repo") }]);
});

test("isoplan.json: a command, or one per platform, with an optional timeout; anything else is an error", () => {
  expect(parseSetup('{"worktreeSetup":{"command":"pnpm install"}}', "darwin", 900000)).toEqual({ command: "pnpm install", timeoutMs: 900000 });
  expect(parseSetup('{"worktreeSetup":{"command":{"windows":"setup.cmd","mac":"./setup.sh"},"timeoutMinutes":2}}', "win32", 900000)).toEqual({ command: "setup.cmd", timeoutMs: 120000 });
  expect(parseSetup('{"worktreeSetup":{"command":{"windows":"setup.cmd"}}}', "darwin", 900000)).toBe(null);
  expect(parseSetup("{}", "darwin", 900000)).toBe(null);
  expect(() => parseSetup('{"worktreeSetup":{"command":3}}', "darwin", 900000)).toThrow("must be a command");
  expect(() => parseSetup('{"worktreeSetup":{"command":"x","timeoutMinutes":0}}', "darwin", 900000)).toThrow("timeoutMinutes");
});

test("on a Mac the launcher is a .command file Terminal opens, with the config folder in it", () => {
  const l = launch("darwin", { folder: "/Users/sam/.claude/isoplan/handoffs/h1", dir: "/Users/sam/app-handoff-h1", argv: ["/Users/sam/.local/bin/claude", "--session-id", "u", "Sam's brief"], title: "Isoplan handoff h1", configDir: "/Users/sam/.claude" });
  expect(l).toEqual({
    file: "/Users/sam/.claude/isoplan/handoffs/h1/open.command",
    text: "#!/bin/sh\nexport CLAUDE_CONFIG_DIR='/Users/sam/.claude'\ncd '/Users/sam/app-handoff-h1' || exit 1\nexec '/Users/sam/.local/bin/claude' '--session-id' 'u' 'Sam'\\''s brief'\n",
    command: ["open", "-a", "Terminal", "/Users/sam/.claude/isoplan/handoffs/h1/open.command"],
  });
  expect(launch("linux", { folder: "/f", dir: "/d", argv: ["claude"], title: "t", configDir: null })).toBe(null);
});
