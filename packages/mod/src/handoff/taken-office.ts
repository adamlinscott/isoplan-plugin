// Which office server a session took its handoff through (#105), so its agent asks the room in that
// office when more than one lets it ask: <claude dir>/isoplan/handoffs/sessions/<session>.json,
// written by /isoplan:take and by the runner's take.

import fs from "node:fs/promises";
import path from "node:path";

const SAFE = /^[\w-]{1,200}$/;
const recordPath = (claudeDir: string, session: string) => path.join(claudeDir, "isoplan", "handoffs", "sessions", `${session}.json`);

export async function recordTakenOffice(claudeDir: string, session: string, server: string): Promise<void> {
  if (!SAFE.test(session)) return;
  const file = recordPath(claudeDir, session);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ server }) + "\n");
}

/** The office server the session took its handoff through, or null when none is recorded. */
export async function takenOffice(claudeDir: string, session: string): Promise<string | null> {
  if (!SAFE.test(session)) return null;
  try {
    const { server } = JSON.parse(await fs.readFile(recordPath(claudeDir, session), "utf8")) as { server?: unknown };
    return typeof server === "string" ? server : null;
  } catch {
    return null;
  }
}
