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

// A worker that dies this many times in a row soon after starting won't get better by itself (a
// broken runner.json, a server address that can't be used): the supervisor gives up.
export const MAX_FAST_FAILURES = 5;

/** The worker's exit code when the office server doesn't want this machine's runner. */
export const NOT_WANTED_CODE = 3;

/** The worker's exit code when the office server says this machine's pairing has ended. */
export const UNPAIRED_CODE = 4;

export interface SuperviseOptions {
  /** Runs the worker until it exits; its exit code, or null for a signal. */
  run: () => Promise<number | null>;
  log: (text: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Why the supervisor stopped. */
export type Stopped = "done" | "not-wanted" | "unpaired" | "gave-up";

/** Runs the worker until it exits cleanly, starting it again after each crash, up to MAX_FAST_FAILURES in a row. */
export async function supervise({ run, log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }: SuperviseOptions): Promise<Stopped> {
  let failures = 0;
  for (;;) {
    const startedAt = now();
    const code = await run();
    if (code === 0) return "done";
    if (code === NOT_WANTED_CODE) return "not-wanted";
    if (code === UNPAIRED_CODE) return "unpaired";
    failures = now() - startedAt >= STABLE_MS ? 1 : failures + 1;
    const how = code === null ? "was killed" : `exited with code ${code}`;
    if (failures >= MAX_FAST_FAILURES) {
      log(`the runner's worker ${how}, the ${failures}th time in a row within a minute of starting; giving up until the runner is started again`);
      return "gave-up";
    }
    const delay = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (failures - 1));
    log(`the runner's worker ${how}; starting it again in ${Math.round(delay / 1000)} s`);
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
