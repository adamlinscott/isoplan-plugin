import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { addedLines, createRunGit, handoffNote, HandoffGitError, noPromptEnv, prepare, pushHandoff, remotesOf, sameRemote, untrackedLine, withoutCredentials, type Pushed } from "./git.js";
import { git, remoteAndClone } from "./fixture.js";

const run = createRunGit();
const MS = 30000;
// A fake AWS key id, split so no key-shaped string sits in the source.
const FAKE_KEY = "AKIA" + "IOSFODNN7EXAMPLE";
const scan = async (text: string) => (text.includes(FAKE_KEY) ? "AWS access key id" : null);
const repoOf = (p: Pushed) => {
  if (!("repo" in p)) throw new Error(`held: ${p.held}`);
  return p.repo;
};

test("a dirty tree: tracked changes go to the handoff's branch alone; the tree, index and branch stay as they were, and no local branch is made", async () => {
  const { remote, clone } = remoteAndClone(tempRoot());
  git(clone, "switch", "-q", "-c", "feat/export");
  fs.writeFileSync(path.join(clone, "app.js"), "console.log(2);\n");
  fs.writeFileSync(path.join(clone, "staged.js"), "export {};\n");
  git(clone, "add", "staged.js");
  fs.writeFileSync(path.join(clone, ".env.local"), "API_URL=http://localhost\n");
  fs.writeFileSync(path.join(clone, ".env"), "SECRET=1\n");
  const status = git(clone, "status", "--porcelain");
  const mainBefore = git(remote, "rev-parse", "main");

  const prepared = await prepare(run, clone, MS);
  expect(prepared).toMatchObject({ from: "feat/export", files: [".env.local"] });
  const repo = repoOf(await pushHandoff(run, clone, "h1", MS, { scan }));

  expect(repo).toMatchObject({ path: ".", remote, branch: "isoplan/handoff/h1" });
  expect(git(clone, "status", "--porcelain")).toBe(status);
  expect(git(clone, "branch", "--show-current")).toBe("feat/export");
  expect(git(clone, "branch", "--list", "isoplan/*")).toBe("");
  // Only the handoff's branch reached the remote; main is where it was.
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/isoplan/handoff/h1\nrefs/heads/main");
  expect(git(remote, "rev-parse", "main")).toBe(mainBefore);
  expect(git(remote, "rev-parse", "isoplan/handoff/h1")).toBe(repo.commit);
  expect(git(remote, "show", "isoplan/handoff/h1:app.js")).toBe("console.log(2);");
  expect(git(remote, "ls-tree", "--name-only", "isoplan/handoff/h1")).toBe(".gitignore\napp.js\nstaged.js");
  expect(git(remote, "log", "-1", "--format=%s", "isoplan/handoff/h1")).toBe("WIP: Isoplan handoff h1");

  // A second hand-over of the same handoff replaces its branch.
  fs.writeFileSync(path.join(clone, "app.js"), "console.log(3);\n");
  const again = repoOf(await pushHandoff(run, clone, "h1", MS));
  expect(git(remote, "show", `${again.commit}:app.js`)).toBe("console.log(3);");
});

test("a possible secret in the lines the commit adds holds the push, naming the file; pushing anyway pushes it", async () => {
  const { remote, clone } = remoteAndClone(tempRoot());
  fs.mkdirSync(path.join(clone, "config"));
  fs.writeFileSync(path.join(clone, "config", "dev.ts"), `export const key = "${FAKE_KEY}";\n`);
  git(clone, "add", "config/dev.ts");
  expect(await pushHandoff(run, clone, "h1", MS, { scan })).toEqual({ held: "config/dev.ts" });
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
  expect(repoOf(await pushHandoff(run, clone, "h1", MS, { scan, pushAnyway: true })).branch).toBe("isoplan/handoff/h1");
  expect(addedLines("+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n+++ /dev/null\n+gone\n")).toEqual(new Map([["a.ts", "new\n"]]));
});

test("the push goes to the push URL, which the handoff records; the sender's pre-push hook doesn't run, and nothing is signed", async () => {
  const root = tempRoot();
  const { remote, clone } = remoteAndClone(root);
  const mirror = path.join(root, "mirror.git");
  git(root, "init", "-q", "--bare", mirror);
  git(clone, "config", "remote.origin.pushurl", mirror);
  fs.writeFileSync(path.join(clone, ".git", "hooks", "pre-push"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  git(clone, "config", "commit.gpgSign", "true");
  git(clone, "config", "gpg.program", "no-such-gpg");
  fs.writeFileSync(path.join(clone, "app.js"), "console.log(2);\n");
  const repo = repoOf(await pushHandoff(run, clone, "h1", MS));
  expect(repo.remote).toBe(mirror);
  expect(git(mirror, "rev-parse", "isoplan/handoff/h1")).toBe(repo.commit);
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
});

test("a clean tree hands over HEAD itself; a folder outside git, or a repo with no remote, is refused with the kind", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root);
  const repo = repoOf(await pushHandoff(run, clone, "h2", MS));
  expect(repo.commit).toBe(git(clone, "rev-parse", "HEAD"));

  const outside = path.join(root, "plain");
  fs.mkdirSync(outside);
  await expect(pushHandoff(run, outside, "h3", MS)).rejects.toMatchObject({ kind: "not-a-repo" });
  git(clone, "remote", "remove", "origin");
  const failed = await pushHandoff(run, clone, "h4", MS).catch((err: unknown) => err);
  expect(failed).toBeInstanceOf(HandoffGitError);
  expect(failed).toMatchObject({ kind: "no-remote" });
});

test("git's environment: no prompts, the person's own ssh kept, and nothing pointing at another repo", async () => {
  const env = noPromptEnv({ PATH: "p", GIT_DIR: "/elsewhere/.git", GIT_WORK_TREE: "/elsewhere", GIT_INDEX_FILE: "/i", Git_Dir: "/x" });
  expect(env).toEqual({ PATH: "p", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" });
  expect(noPromptEnv({ GIT_SSH_COMMAND: "my-ssh" }).GIT_SSH_COMMAND).toBe("my-ssh");
  expect(noPromptEnv({}, true).GIT_SSH_COMMAND).toBe(undefined);
  // A repo whose config sets core.sshCommand keeps it.
  const { clone } = remoteAndClone(tempRoot());
  git(clone, "config", "core.sshCommand", "my-ssh -i key");
  const shown = (cwd: string) => run(["-c", "alias.ssh-env=!echo \"[$GIT_SSH_COMMAND]\"", "ssh-env"], { cwd, timeoutMs: MS }).then((r) => r.stdout.trim());
  expect(await shown(clone)).toBe("[]");
  expect(await shown(path.dirname(clone))).toBe("[ssh -o BatchMode=yes]");
});

test("the note and the request name untracked files, capped, and say when they are unknown; remotes compare without credentials", async () => {
  const at = new Date("2026-10-29T16:05:00Z");
  expect(handoffNote({ branch: "isoplan/handoff/h1", from: "feat/x", files: [".env.local"], at })).toBe(
    "Handed over by Isoplan on the branch isoplan/handoff/h1, made from feat/x, with the tracked changes in a work-in-progress commit. This describes the work tree as of 2026-10-29 16:05 UTC.\nUntracked files, not handed over: `.env.local`.",
  );
  expect(handoffNote({ branch: "b", from: null, files: null, at })).toContain("Untracked files: unknown, since git couldn't list them.");
  expect(untrackedLine([])).toBe("There are no untracked files.");
  expect(untrackedLine(null)).toBe("The untracked files couldn't be listed, so don't name any.");
  expect(untrackedLine([".env.local"])).toBe("The untracked files are: `.env.local`. Say what each is for.");
  expect(untrackedLine(Array.from({ length: 60 }, (_, i) => `f${i}`))).toMatch(/`f49`, and 10 more\. Say what each is for\.$/);
  expect(withoutCredentials("https://adam:token@github.com/team/app.git")).toBe("https://github.com/team/app.git");
  expect(sameRemote("git@github.com:Team/App.git", "https://token@github.com/team/app")).toBe(true);
  expect(sameRemote("https://github.com/team/app", "https://github.com/team/api")).toBe(false);
  const local = path.join(tempRoot(), "remote.git");
  expect(sameRemote(local, `${local}${path.sep}`)).toBe(true);
  expect(sameRemote(local, path.join(tempRoot(), "remote.git"))).toBe(false);
  if (process.platform === "win32") expect(sameRemote("C:\\work\\remote.git", "c:/work/remote.git")).toBe(true);
  // A remote whose path has spaces is read whole.
  const spaced = path.join(tempRoot(), "with spaces");
  fs.mkdirSync(spaced);
  const { remote, clone } = remoteAndClone(spaced);
  expect(await remotesOf(run, clone, MS)).toEqual([{ name: "origin", url: remote }]);
});
