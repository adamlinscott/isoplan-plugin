// Finds this machine's Claude Code sessions: every top-level transcript under ~/.claude/projects
// written inside the window (the backfill takes them all), or only those whose folder is in a
// checkout or worktree of one project (the sweep).

import type { Git } from "../data-layer/git.js";
import { projectOf } from "../data-layer/identity.js";
import type { NodeIo } from "../data-layer/io.js";

export interface Found {
  id: string;
  cwd: string;
}

const HEAD_BYTES = 65536;

/** The first folder a transcript's lines name, from its first and last 64 KB. */
export async function cwdOf(io: NodeIo, path: string, size: number): Promise<string | null> {
  for (const [start, end] of [[0, HEAD_BYTES], [Math.max(0, size - HEAD_BYTES), size]] as const) {
    for (const text of (await io.read(path, start, end).catch(() => "")).split("\n")) {
      if (!text.includes('"cwd"')) continue;
      try {
        const cwd = (JSON.parse(text) as { cwd?: unknown }).cwd;
        if (typeof cwd === "string" && cwd) return cwd;
      } catch {
        // A line cut by the window's edge.
      }
    }
  }
  return null;
}

/** Every session on this machine, in any project, whose transcript was written since `since`. */
export async function recentSessions(io: NodeIo, projectsDir: string, since: number): Promise<Found[]> {
  const out: Found[] = [];
  for (const dir of await io.listDir(projectsDir)) {
    if (!dir.isDir) continue;
    for (const entry of await io.listDir(`${projectsDir}/${dir.name}`)) {
      if (entry.isDir || !entry.name.endsWith(".jsonl")) continue;
      const path = `${projectsDir}/${dir.name}/${entry.name}`;
      const st = await io.stat(path);
      if (!st || st.mtimeMs < since) continue;
      const cwd = await cwdOf(io, path, st.size);
      if (cwd) out.push({ id: entry.name.slice(0, -".jsonl".length), cwd });
    }
  }
  return out;
}

/** `seen` keeps each folder's project id across calls, so git runs once per folder. */
export async function findSessions(io: NodeIo, git: Git, projectsDir: string, project: string, machine: string, since: number, now: number, seen = new Map<string, string | null>()): Promise<Found[]> {
  const out: Found[] = [];
  for (const found of await recentSessions(io, projectsDir, since)) {
    const { cwd } = found;
    if (!seen.has(cwd)) {
      const where = await git.resolve(cwd, { now, maxAgeMs: 60000 });
      seen.set(cwd, where ? (await projectOf(io.run, where, cwd, machine)).id : null);
    }
    if (seen.get(cwd) === project) out.push(found);
  }
  return out;
}
