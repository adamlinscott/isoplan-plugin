import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { git, remoteAndClone } from "./fixture.js";
import { createRunGit, handoffNote, HandoffGitError, prepare, pushHandoff, sameRemote, untrackedLine, withoutCredentials } from "./git.js";

const run = createRunGit();
const MS = 30000;

test("a dirty tree: tracked changes go to the handoff's branch alone; the tree, index and branch stay as they were", async () => {
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
  const repo = await pushHandoff(run, clone, "h1", MS);

  expect(repo).toMatchObject({ path: ".", remote, branch: "isoplan/handoff/h1" });
  expect(git(clone, "status", "--porcelain")).toBe(status);
  expect(git(clone, "branch", "--show-current")).toBe("feat/export");
  // Only the handoff's branch reached the remote; main is where it was.
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/isoplan/handoff/h1\nrefs/heads/main");
  expect(git(remote, "rev-parse", "main")).toBe(mainBefore);
  expect(git(remote, "rev-parse", "isoplan/handoff/h1")).toBe(repo.commit);
  expect(git(remote, "show", "isoplan/handoff/h1:app.js")).toBe("console.log(2);");
  expect(git(remote, "ls-tree", "--name-only", "isoplan/handoff/h1")).toBe(".gitignore\napp.js\nstaged.js");
  expect(git(remote, "log", "-1", "--format=%s", "isoplan/handoff/h1")).toBe("WIP: Isoplan handoff h1");

  // A second hand-over of the same handoff replaces its branch.
  fs.writeFileSync(path.join(clone, "app.js"), "console.log(3);\n");
  const again = await pushHandoff(run, clone, "h1", MS);
  expect(git(remote, "show", `${again.commit}:app.js`)).toBe("console.log(3);");
});

test("a clean tree hands over HEAD itself; a folder outside git, or a repo with no remote, is refused with the kind", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root);
  const repo = await pushHandoff(run, clone, "h2", MS);
  expect(repo.commit).toBe(git(clone, "rev-parse", "HEAD"));

  const outside = path.join(root, "plain");
  fs.mkdirSync(outside);
  await expect(pushHandoff(run, outside, "h3", MS)).rejects.toMatchObject({ kind: "not-a-repo" });
  git(clone, "remote", "remove", "origin");
  const failed = await pushHandoff(run, clone, "h4", MS).catch((err: unknown) => err);
  expect(failed).toBeInstanceOf(HandoffGitError);
  expect(failed).toMatchObject({ kind: "no-remote" });
});

test("the note and the request name untracked files; remotes compare without credentials", () => {
  expect(handoffNote({ branch: "isoplan/handoff/h1", from: "feat/x", files: [".env.local"] })).toBe(
    "Handed over by Isoplan on the branch isoplan/handoff/h1, made from feat/x, with the tracked changes in a work-in-progress commit.\nUntracked files, not handed over: `.env.local`.",
  );
  expect(untrackedLine([])).toBe("There are no untracked files.");
  expect(untrackedLine([".env.local"])).toBe("The untracked files are: `.env.local`. Say what each is for.");
  expect(withoutCredentials("https://adam:ghp_secret@github.com/team/app.git")).toBe("https://github.com/team/app.git");
  expect(sameRemote("git@github.com:Team/App.git", "https://token@github.com/team/app")).toBe(true);
  expect(sameRemote("https://github.com/team/app", "https://github.com/team/api")).toBe(false);
  const local = path.join(tempRoot(), "remote.git");
  expect(sameRemote(local, `${local}${path.sep}`)).toBe(true);
  expect(sameRemote(local, path.join(tempRoot(), "remote.git"))).toBe(false);
  if (process.platform === "win32") expect(sameRemote("C:\\work\\remote.git", "c:/work/remote.git")).toBe(true);
});
