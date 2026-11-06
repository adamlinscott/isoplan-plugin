import { MAX_FOLDER_LENGTH, MAX_FOLDER_REPOS, MAX_REPO_FOLDERS } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { pathKey } from "../data-layer/git.js";
import { repoFolders } from "./repo-folders.js";

// A fake AWS key id, split so no key-shaped string sits in the source.
const AWS_KEY = "AKIA" + "ABCDEFGHIJKLMNOP";
const APP = "github.com/ada/app";
const API = "github.com/ada/api";

// The repo each folder is in, by its key, as the office's home would say; any other is in none it takes.
const homes = (byFolder: Record<string, string>) => async (folder: string) => byFolder[pathKey(folder)] ?? null;
const options = (byFolder: Record<string, string>, logs: string[] = []) => ({
  home: homes(Object.fromEntries(Object.entries(byFolder).map(([f, p]) => [pathKey(f), p]))),
  scan: async (text: string) => (text.includes(AWS_KEY) ? "aws-access-key" : null),
  log: (t: string) => void logs.push(t),
  leftOut: new Set<string>(),
});

test.each([
  ["Windows", { app: "C:\\Users\\Ada\\code\\app", appTwin: "c:\\users\\ada\\code\\APP", wt: "C:\\Users\\Ada\\code\\app-wt", api: "D:\\work\\api", other: "C:\\Users\\Ada\\notes" }],
  ["macOS", { app: "/Users/ada/code/app", appTwin: "/Users/ada/code/app/", wt: "/Users/ada/code/app-wt", api: "/Volumes/work/api", other: "/Users/ada/notes" }],
])("%s: each repo's folders, the most recently used first, each once, and none outside the repos the office takes", async (_, f) => {
  const seen = [
    { folder: f.wt, at: 10 },
    { folder: f.app, at: 30 },
    { folder: f.api, at: 20 },
    { folder: f.appTwin, at: 5 },
    { folder: f.other, at: 40 },
  ];
  expect(await repoFolders(seen, options({ [f.app]: APP, [f.wt]: APP, [f.api]: API }))).toEqual([
    { project: APP, folders: [f.app, f.wt] },
    { project: API, folders: [f.api] },
  ]);
});

test("a folder the secret scan matches, or one too long to send, is left out, never cut; past the limits the least recently used go", async () => {
  const logs: string[] = [];
  const secret = `/Users/ada/${AWS_KEY}/app`;
  const long = `/Users/ada/${"x".repeat(MAX_FOLDER_LENGTH)}`;
  const many = Array.from({ length: MAX_REPO_FOLDERS + 2 }, (_, i) => `/Users/ada/app-${i}`);
  const repos = Array.from({ length: MAX_FOLDER_REPOS + 1 }, (_, i) => `/Users/ada/repo-${i}`);
  const byFolder: Record<string, string> = { [secret]: APP, [long]: APP };
  for (const m of many) byFolder[m] = APP;
  repos.forEach((r, i) => (byFolder[r] = `github.com/ada/repo-${i}`));
  const seen = [
    { folder: secret, at: 1000 },
    { folder: long, at: 999 },
    ...many.map((folder, i) => ({ folder, at: 900 - i })),
    ...repos.map((folder, i) => ({ folder, at: 800 - i })),
  ];
  const listed = await repoFolders(seen, options(byFolder, logs));
  expect(listed[0]).toEqual({ project: APP, folders: many.slice(0, MAX_REPO_FOLDERS) });
  expect(listed).toHaveLength(MAX_FOLDER_REPOS);
  expect(listed.at(-1)!.project).toBe(`github.com/ada/repo-${MAX_FOLDER_REPOS - 2}`);
  expect(logs).toEqual([`a folder of ${APP} wasn't listed for starting sessions from the floor: its path matches the secret pattern "aws-access-key"`]);
});

test("a folder the secret scan leaves out is logged when it is first left out, not on every check after", async () => {
  const logs: string[] = [];
  const secret = `/Users/ada/${AWS_KEY}/app`;
  const o = options({ [secret]: APP, "/Users/ada/app": APP }, logs);
  const seen = [{ folder: secret, at: 2 }];
  await repoFolders(seen, o);
  await repoFolders(seen, o);
  expect(logs).toHaveLength(1);
  // Gone for a check, then back: logged again.
  await repoFolders([], o);
  await repoFolders(seen, o);
  expect(logs).toHaveLength(2);
});
