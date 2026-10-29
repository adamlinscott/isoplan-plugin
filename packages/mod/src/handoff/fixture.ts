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
