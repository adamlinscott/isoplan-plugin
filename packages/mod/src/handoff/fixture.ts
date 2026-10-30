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
