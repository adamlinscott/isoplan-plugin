import { expect, test } from "vitest";
import { projectId } from "./index.js";

const local = { machine: "sevengill", root: "C:\\work\\isoplan" };

test.each([
  ["git@github.com:isoplan-app/isoplan.git"],
  ["ssh://git@github.com/isoplan-app/isoplan.git"],
  ["ssh://git@github.com:22/isoplan-app/isoplan"],
  ["https://github.com/isoplan-app/isoplan.git"],
  ["https://adam:token@github.com:443/isoplan-app/isoplan/"],
  ["https://GitHub.COM/isoplan-app/isoplan.git/"],
  ["git@github.com:Isoplan-App/Isoplan.git"],
])("%s is github.com/isoplan-app/isoplan", (remote) => {
  expect(projectId(remote, local).id).toBe("github.com/isoplan-app/isoplan");
});

test("keeps deeper path segments, as for GitLab subgroups", () => {
  expect(projectId("git@gitlab.com:group/sub/repo.git", local)).toEqual({ id: "gitlab.com/group/sub/repo", name: "repo" });
});

test("the name keeps the remote's own spelling", () => {
  expect(projectId("git@github.com:Isoplan-App/Isoplan.git", local).name).toBe("Isoplan");
});

test.each([
  [null],
  [""],
  ["C:\\repos\\isoplan"],
  ["C:/repos/isoplan"],
  ["/srv/isoplan.git"],
  ["../isoplan"],
  ["file:///srv/isoplan.git"],
  ["https://github.com/"],
  ["https://u:SECRET@[bad"],
])("%j falls back to the machine and the repo's root", (remote) => {
  expect(projectId(remote, local)).toEqual({ id: "local:sevengill/C:/work/isoplan", name: "isoplan" });
});
