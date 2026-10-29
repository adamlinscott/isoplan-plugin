import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { wakeRecordPath } from "../wake/wake.js";
import { captureEnv, recordedEnv, recordEnv, runnerEnvPath } from "./environment.js";
import { startRunner } from "./start.js";

const shell = {
  Path: "C:\\Windows;C:\\Users\\ada\\.local\\bin",
  USERPROFILE: "C:\\Users\\ada",
  HOME: "/home/ada",
  SystemRoot: "C:\\Windows",
  HTTPS_PROXY: "http://proxy:3128",
  NODE_EXTRA_CA_CERTS: "/etc/corp.pem",
  ANTHROPIC_API_KEY: "sk-ant-x",
  ANTHROPIC_BASE_URL: "https://gateway",
  CLAUDE_CODE_USE_BEDROCK: "1",
  CLAUDE_CODE_OAUTH_TOKEN: "o",
  AWS_REGION: "us-east-1",
  AWS_PROFILE: "dev",
  GOOGLE_APPLICATION_CREDENTIALS: "/k.json",
  CLAUDE_CONFIG_DIR: "/c",
};
// What a session's process carries besides: Claude Code's own, and a project settings `env` block.
const session = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_PLUGIN_DIRS: "/p", DATABASE_URL: "postgres://prod", NODE_OPTIONS: "--require evil.js", MY_FEATURE_FLAG: "on" };

test("environment: the OS basics, proxies and auth and provider variables are kept; a session's own and its settings' are not", () => {
  expect(captureEnv({ ...shell, ...session, GONE: undefined })).toEqual(shell);
});

test("environment: install records it with a note saying what it is, readable back as it was", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  expect(await recordedEnv(claudeDir)).toBe(null);
  expect(await recordEnv(claudeDir, { ...shell, ...session })).toBe(true);
  expect(await recordEnv(claudeDir, { ...shell, ...session })).toBe(false);
  const file = JSON.parse(fs.readFileSync(runnerEnvPath(claudeDir), "utf8"));
  expect(file.about).toMatch(/^Isoplan's runner starts with exactly this environment.*Edit it/);
  expect(file.env).toEqual(shell);
  expect(await recordedEnv(claudeDir)).toEqual(shell);
  // Edited by hand to something that doesn't parse: the starter's environment is used.
  fs.writeFileSync(runnerEnvPath(claudeDir), "{ nope");
  expect(await recordedEnv(claudeDir)).toBe(null);
});

test("environment: the runner starts with exactly the recorded environment, or with its starter's and a flag saying so", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const runner = path.join(claudeDir, "isoplan", "runner", "app", "dist", "runner.mjs");
  fs.mkdirSync(path.dirname(runner), { recursive: true });
  fs.writeFileSync(runner, "");
  fs.writeFileSync(wakeRecordPath(claudeDir), JSON.stringify({ dataLayer: "x", runner }));
  const spawned: { args: string[]; env?: Record<string, string> }[] = [];
  const start = () => startRunner({ claudeDir, spawn: (args, _cwd, env) => spawned.push({ args, env }), isAlive: () => false });

  expect(await start()).toBe("started");
  expect(spawned[0]).toEqual({ args: [runner, "--claude-dir", claudeDir, "--inherited-env"], env: undefined });
  await recordEnv(claudeDir, { ...shell, ...session });
  expect(await start()).toBe("started");
  expect(spawned[1]).toEqual({ args: [runner, "--claude-dir", claudeDir], env: shell });
});
