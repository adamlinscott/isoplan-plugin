// Focus this session: the floor's button for a handoff taken into Orca. The runner of the machine
// that took it brings its session to the front in Orca, and only then: a take into Orca never
// switches Orca's view by itself (take.ts).
//
// 1. The terminal the take opened, by the handle it kept in orca.json in the handoff's folder:
//    `orca terminal switch`.
// 2. That handle gone (Orca restarted, or the tab was closed): a terminal Orca lists in the handoff's
//    worktree, the one titled for the handoff first, switched to.
// 3. None: a new terminal there running the handoff's launcher again, with --focus, since here the
//    receiver asked for it.
// The terminal switched to, or opened, is kept in orca.json for next time.
//
// What the server is told says what kind of problem it was, and Orca's error code, never a path;
// the details go to the runner's log.

import fs from "node:fs/promises";
import path from "node:path";
import type { OrcaAnswer, RunOrca } from "./orca.js";
import { handoffDir, orcaTerminal, recordOrca, terminalHandle } from "./take.js";

export interface FocusOptions {
  claudeDir: string;
  platform: NodeJS.Platform;
  /** Orca's CLI, or null when Orca isn't on this machine. */
  orca: () => Promise<RunOrca | null>;
  log: (text: string) => void;
}

// What a take into Orca kept in the handoff's folder, or null.
async function readOrca(folder: string): Promise<{ terminal: string | null; worktree: string } | null> {
  try {
    const { terminal, worktree } = JSON.parse(await fs.readFile(path.join(folder, "orca.json"), "utf8")) as { terminal?: unknown; worktree?: unknown };
    return typeof worktree === "string" && worktree ? { terminal: typeof terminal === "string" && terminal ? terminal : null, worktree } : null;
  } catch {
    return null;
  }
}

/** Brings handoff `id`'s session to the front in Orca: null when it is, else why not, in a few words. Never throws. */
export async function focusHandoff(id: string, o: FocusOptions): Promise<string | null> {
  const failed = (what: string, answer: Extract<OrcaAnswer, { ok: false }>) => {
    o.log(`handoff ${id}: ${what}: ${answer.error}`);
    return `${what} (${answer.code ?? "it failed"})`;
  };
  try {
    const orca = await o.orca();
    if (!orca) return "Orca wasn't found on this machine";
    const folder = handoffDir(o.claudeDir, id);
    const kept = await readOrca(folder);
    if (!kept) return "this machine has no record of opening this handoff in Orca: take it into Orca again";
    const keep = (terminal: string | null) => recordOrca(folder, terminal, kept.worktree).catch((err: Error) => o.log(`handoff ${id}: couldn't record its Orca terminal: ${err.message}`));
    if (kept.terminal) {
      const switched = await orca(["terminal", "switch", "--terminal", kept.terminal]);
      if (switched.ok) return null;
      o.log(`handoff ${id}: Orca couldn't switch to terminal ${kept.terminal}, so the worktree's terminals are looked for: ${switched.error}`);
    }
    const listed = await orca(["terminal", "list", "--worktree", `path:${kept.worktree}`]);
    if (!listed.ok) return failed("Orca couldn't list the handoff's terminals", listed);
    const title = `Isoplan handoff ${id}`;
    const terminals = (Array.isArray(listed.result.terminals) ? listed.result.terminals : []) as { handle?: unknown; title?: unknown; orphaned?: unknown }[];
    const live = terminals.filter((t) => typeof t?.handle === "string" && t.orphaned !== true);
    const found = live.find((t) => t.title === title) ?? live[0];
    if (found) {
      const handle = found.handle as string;
      const switched = await orca(["terminal", "switch", "--terminal", handle]);
      if (!switched.ok) return failed("Orca couldn't switch to the handoff's terminal", switched);
      await keep(handle);
      return null;
    }
    const launcher = path.join(folder, o.platform === "win32" ? "open.cmd" : "open.command");
    if (!(await fs.stat(launcher).then((s) => s.isFile(), () => false))) return "the handoff's launcher on this machine is gone, so no terminal was opened: take it into Orca again";
    const opened = await orca(orcaTerminal(o.platform, kept.worktree, title, launcher, true));
    if (!opened.ok) return failed("Orca couldn't open a terminal for the handoff", opened);
    await keep(terminalHandle(opened.result));
    o.log(`handoff ${id}: no terminal of it was open in Orca, so its launcher was opened again in ${kept.worktree}`);
    return null;
  } catch (err) {
    o.log(`handoff ${id}: focusing it failed: ${(err as Error)?.stack ?? String(err)}`);
    return "the runner failed";
  }
}
