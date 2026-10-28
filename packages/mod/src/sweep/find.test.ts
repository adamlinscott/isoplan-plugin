import path from "node:path";
import { expect, test } from "vitest";
import { createGit } from "../data-layer/git.js";
import { nodeIo } from "../data-layer/io.js";
import { projectOf } from "../data-layer/identity.js";
import { gitRepo, gitWorktree, line, NOW, session, tempRoot } from "../data-layer/fixture.js";
import { findSessions } from "./find.js";

test("sweep: sessions in the repo or its worktrees, written inside the window; others are left", async () => {
  const home = tempRoot();
  const repo = gitRepo(path.join(home, "repo"));
  const tree = gitWorktree(repo, path.join(home, "wt"), "wt", "feature");
  const other = gitRepo(path.join(home, "other"));
  session(home, "in-repo", [line.user(repo, "hi")], { slug: "a" });
  session(home, "in-worktree", [line.user(tree, "hi")], { slug: "b" });
  session(home, "elsewhere", [line.user(other, "hi")], { slug: "c" });
  session(home, "too-old", [line.user(repo, "hi")], { slug: "a", age: 7200 });

  const io = nodeIo({ run: null });
  const git = createGit(io);
  const project = await projectOf(null, await git.resolve(repo), repo, "m");
  const found = await findSessions(io, git, path.join(home, ".claude", "projects"), project.id, "m", NOW - 3600000, NOW);
  expect(found.map((f) => f.id).sort()).toEqual(["in-repo", "in-worktree"]);
});
