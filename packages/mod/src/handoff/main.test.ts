// The handoff commands' script, run as it ships (dist/handoff.js), with a throwaway Claude config
// folder: what hand-over makes of a spin-off's task before it reaches any office.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MAX_TASK_LENGTH } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";

function handOver(claudeDir: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [path.join(modDir, "dist", "handoff.js"), "hand-over", ...args], { cwd: tempRoot(), env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: "" }, encoding: "utf8", windowsHide: true });
  return { code: r.status, out: r.stdout.trim() };
}

/** A prepare's folder for `id`, with its brief written. */
function prepared(id: string) {
  const claudeDir = path.join(tempRoot(), "claude");
  const folder = path.join(claudeDir, "isoplan", "handoffs", "out", id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "brief.md"), "Goal: the docs.\n");
  return { claudeDir, folder, brief: path.join(folder, "brief.md") };
}

test("hand-over --task with nothing after it stops, rather than handing over without the task", () => {
  const p = prepared("h-trailing");
  expect(handOver(p.claudeDir, "--id", "h-trailing", "--to", "me", "--brief", p.brief, "--task")).toEqual({ code: 1, out: "hand-over --task needs the task file." });
});

test("a task written at prepare --spin-off goes with the hand-over even when --task is left out", () => {
  const p = prepared("h-left-out");
  const task = path.join(p.folder, "task.md");
  // Too long, so hand-over stops on it before reaching any office: it read the task.
  fs.writeFileSync(task, "x".repeat(MAX_TASK_LENGTH + 1));
  const r = handOver(p.claudeDir, "--id", "h-left-out", "--to", "me", "--brief", p.brief);
  expect(r.code).toBe(1);
  expect(r.out).toContain(`The task at ${task} is ${MAX_TASK_LENGTH + 1} characters long`);
});
