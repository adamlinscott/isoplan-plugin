// The repo sweep: reports sessions that run without the mod. It finds every Claude Code session on
// this machine in the repository's project and runs a data layer for each, as the hooks module
// would. Those sessions get no conflict notes, titles or status line; they are only seen.
//
//   node dist/sweep.js [repository folder]
//
// It looks again every minute for sessions started since, and restarts a data layer that ended.
// Ctrl+C stops it and its data layers.

import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DataLayerLine } from "../lines.js";
import { loadConfig } from "../data-layer/config.js";
import { createGit } from "../data-layer/git.js";
import { claudePaths, projectOf } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { findSessions } from "./find.js";

const SCAN_MS = 60000;

const here = path.dirname(fileURLToPath(import.meta.url));
const dataLayer = path.join(here, "data-layer.js");
const repo = path.resolve(process.argv[2] ?? ".");
const claudeDir = claudePaths(process.env, os.homedir()).dir;
const machine = os.hostname();
const io = nodeIo();
const git = createGit(io);

const where = await git.resolve(repo);
if (!where) {
  process.stderr.write(`isoplan sweep: ${repo} is not in a git repository\n`);
  process.exit(2);
}
const project = await projectOf(io.run, where, repo, machine);
const config = await loadConfig(io, path.join(here, "..", "config.json"), path.join(claudeDir, "isoplan", "config.json"));
console.log(`Sweeping ${project.name} (${project.id}) into ${config.server}`);

const running = new Map<string, ChildProcess>();
const seen = new Map<string, string | null>();

function start(id: string, cwd: string): void {
  const child = spawn(process.execPath, [dataLayer, "--session", id, "--cwd", cwd], { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  running.set(id, child);
  const tag = id.slice(0, 8);
  let state = "";
  let buffer = "";
  child.stdout!.setEncoding("utf8").on("data", (text: string) => {
    buffer += text;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = JSON.parse(buffer.slice(0, nl)) as DataLayerLine;
      buffer = buffer.slice(nl + 1);
      if (line.type === "status" && line.state !== state) console.log(`${tag} ${(state = line.state)}`);
      else if (line.type === "log") console.log(`${tag} ${line.text}`);
      else if (line.type === "error") console.log(`${tag} server error: ${line.message}`);
    }
  });
  child.stderr!.setEncoding("utf8").on("data", (text: string) => process.stderr.write(`${tag} ${text}`));
  child.on("exit", () => running.delete(id));
}

async function scan(): Promise<void> {
  const now = Date.now();
  const found = await findSessions(io, git, path.join(claudeDir, "projects"), project.id, machine, now - config.lightsOffHours * 3600000, now, seen);
  for (const { id, cwd } of found) {
    if (running.has(id)) continue;
    console.log(`${id.slice(0, 8)} found in ${cwd}`);
    start(id, cwd);
  }
}

process.on("SIGINT", () => {
  for (const child of running.values()) child.kill();
  process.exit(0);
});

await scan();
if (!running.size) console.log("No sessions found yet; looking again every minute.");
setInterval(() => void scan(), SCAN_MS);
