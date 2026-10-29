// How long a runner lives (E1). The supervisor (main.ts) holds the runner's lock, so one runs per
// machine, and runs the worker, starting it again after a crash with a backoff. The worker stays
// up while any session on the machine is inside its lights-off window, so a room can be asked until
// its lights go off, and exits cleanly once none is; then the supervisor ends too. The wake hook and
// install start it again (start.ts).

import type { NodeIo } from "../data-layer/io.js";

const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 60000;
// A worker that stayed up this long was healthy: the next crash starts the backoff over.
const STABLE_MS = 60000;

export interface SuperviseOptions {
  /** Runs the worker until it exits; its exit code, or null for a signal. */
  run: () => Promise<number | null>;
  log: (text: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Runs the worker until it exits cleanly, starting it again after each crash. */
export async function supervise({ run, log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }: SuperviseOptions): Promise<void> {
  let failures = 0;
  for (;;) {
    const startedAt = now();
    const code = await run();
    if (code === 0) return;
    failures = now() - startedAt >= STABLE_MS ? 1 : failures + 1;
    const delay = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (failures - 1));
    log(`the runner's worker ${code === null ? "was killed" : `exited with code ${code}`}; starting it again in ${Math.round(delay / 1000)} s`);
    await sleep(delay);
  }
}

/** Whether any session transcript under `projectsDir` was written since `since`, so its room is still lit. */
export async function anyRoomSince(io: Pick<NodeIo, "listDir" | "stat">, projectsDir: string, since: number): Promise<boolean> {
  for (const dir of await io.listDir(projectsDir)) {
    if (!dir.isDir) continue;
    for (const entry of await io.listDir(`${projectsDir}/${dir.name}`)) {
      if (entry.isDir || !entry.name.endsWith(".jsonl")) continue;
      const st = await io.stat(`${projectsDir}/${dir.name}/${entry.name}`);
      if (st && st.mtimeMs >= since) return true;
    }
  }
  return false;
}

/** The window a room stays askable after its session's last write: its lights-off window, or the idle one when that is off. */
export const askableMs = ({ lightsOffHours, idleMinutes }: { lightsOffHours: number; idleMinutes: number }) => Math.max(lightsOffHours * 3600000, idleMinutes * 60000);
