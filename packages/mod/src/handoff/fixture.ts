// Real git repos for the handoff's tests: a bare remote and clones of it, in a temp root.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();

/** A bare remote with one commit on main, and a clone of it whose identity is set. */
export function remoteAndClone(root: string, name = "clone"): { remote: string; clone: string } {
  const remote = path.join(root, "remote.git");
  if (!fs.existsSync(remote)) {
    git(root, "init", "-q", "--bare", "-b", "main", remote);
    const seed = path.join(root, "seed");
    git(root, "init", "-q", "-b", "main", seed);
    setIdentity(seed);
    fs.writeFileSync(path.join(seed, "app.js"), "console.log(1);\n");
    fs.writeFileSync(path.join(seed, ".gitignore"), ".env\n");
    git(seed, "add", ".");
    git(seed, "commit", "-q", "-m", "first");
    git(seed, "push", "-q", remote, "main");
  }
  const clone = path.join(root, name);
  git(root, "clone", "-q", remote, clone);
  setIdentity(clone);
  return { remote, clone };
}

export function setIdentity(dir: string) {
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.invalid");
  // Checked out as committed, whatever this machine's own setting.
  git(dir, "config", "core.autocrlf", "false");
}

/** A bare remote at <root>/<name>.git with one commit on main holding `files`, made once per root. */
export function bareRemote(root: string, name: string, files: Record<string, string>): string {
  const remote = path.join(root, `${name}.git`);
  if (fs.existsSync(remote)) return remote;
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  const seed = path.join(root, `seed-${name}`);
  git(root, "init", "-q", "-b", "main", seed);
  setIdentity(seed);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(seed, file)), { recursive: true });
    fs.writeFileSync(path.join(seed, file), text);
  }
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "first");
  git(seed, "push", "-q", remote, "main");
  return remote;
}

/**
 * A workspace of several repos (#56) at <root>/<name>: a parent repo (unless `parent` is false,
 * when it is a plain folder) that ignores `api/` and `web/` (unless `ignores` is false), and those
 * two repos cloned inside it, each from its own bare remote.
 */
export function workspace(root: string, name: string, { parent = true, ignores = true }: { parent?: boolean; ignores?: boolean } = {}) {
  const remotes = {
    parent: bareRemote(root, ignores ? "parent" : "parent-plain", { "README.md": "the workspace\n", ".gitignore": ignores ? ".env\n/api/\n/web/\n" : ".env\n" }),
    api: bareRemote(root, "api", { "server.js": "listen(1);\n", ".gitignore": ".env\n" }),
    web: bareRemote(root, "web", { "index.html": "<p>1</p>\n", ".gitignore": "dist/\n" }),
  };
  const dir = path.join(root, name);
  if (parent) {
    git(root, "clone", "-q", remotes.parent, dir);
    setIdentity(dir);
  } else fs.mkdirSync(dir);
  for (const sub of ["api", "web"] as const) {
    git(dir, "clone", "-q", remotes[sub], sub);
    setIdentity(path.join(dir, sub));
  }
  return { dir, remotes };
}

/**
 * A fake Orca CLI at <root>/fake-orca.mjs, run with node: it logs each command's arguments, keeps
 * its projects in a state file, makes a worktree in <root>/orca-workspaces with git as Orca would,
 * and answers as Orca's --json does. `fail` makes a command (such as "terminal create") answer an
 * error. Nothing it does opens a window.
 */
export function fakeOrca(root: string, { repos = [] as string[], fail = {} as Record<string, string> } = {}) {
  const bin = path.join(root, "fake-orca.mjs");
  const state = path.join(root, "fake-orca.json");
  const log = path.join(root, "fake-orca.log");
  const workspaces = path.join(root, "orca-workspaces");
  fs.writeFileSync(state, JSON.stringify({ repos, fail, workspaces, log }));
  fs.writeFileSync(
    bin,
    `import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const file = ${JSON.stringify(state)};
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2).filter((a) => a !== "--json");
fs.appendFileSync(state.log, JSON.stringify(args) + "\\n");
const flag = (name) => args[args.indexOf(name) + 1];
const key = (p) => path.resolve(p).toLowerCase();
const answer = (body, code = 0) => (process.stdout.write(JSON.stringify(body)), process.exit(code));
const command = args.slice(0, 2).join(" ");
if (state.fail[command]) answer({ ok: false, error: { code: "failed", message: state.fail[command] } }, 1);
if (command === "repo show") {
  const at = flag("--repo").slice("path:".length);
  if (!state.repos.some((r) => key(r) === key(at))) answer({ ok: false, error: { code: "repo_not_found", message: "repo_not_found" } }, 1);
  answer({ ok: true, result: { repo: { path: at } } });
}
if (command === "repo add") {
  state.repos.push(flag("--path"));
  fs.writeFileSync(file, JSON.stringify(state));
  answer({ ok: true, result: { repo: { path: flag("--path") } } });
}
if (command === "worktree create") {
  const dir = path.join(state.workspaces, flag("--name"));
  execFileSync("git", ["worktree", "add", "-q", "-b", flag("--branch"), dir, flag("--base-branch")], { cwd: flag("--repo").slice("path:".length), stdio: "ignore", windowsHide: true });
  answer({ ok: true, result: { worktree: { path: dir.replace(/\\\\/g, "/"), branch: "refs/heads/" + flag("--branch") } } });
}
if (command === "worktree show") answer({ ok: true, result: { worktree: { path: flag("--worktree").slice("path:".length) } } });
if (command === "terminal create") answer({ ok: true, result: { terminal: { handle: "term_1" } } });
answer({ ok: false, error: { code: "unknown_command", message: "unknown command " + command } }, 1);
`,
  );
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : []);
  return { bin, workspaces, calls };
}
