// The copy of the office's list of approved repos (approved.ts) in <claude dir>/isoplan/approved.json,
// as the wake hook reads it too: kept free of anything but fs so the hook starts fast.

import fs from "node:fs/promises";
import path from "node:path";

/** What approved.json holds: the list, the server it came from, when that version was first had (`fetched`) and when it was last confirmed (`checked`). */
export interface ApprovedFile {
  server: string;
  version: string;
  repos: string[];
  fetched: number;
  checked: number;
}

/** A copy older than this approves nothing, unless config.json's approvedMaxAgeMinutes says otherwise. */
export const DEFAULT_MAX_AGE_MINUTES = 15;

export const approvedPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "approved.json");

const isFile = (v: Partial<ApprovedFile> | null): v is ApprovedFile =>
  !!v && typeof v.server === "string" && typeof v.version === "string" && typeof v.fetched === "number" && typeof v.checked === "number" && Array.isArray(v.repos) && v.repos.every((r) => typeof r === "string");

/** approved.json, for `server` when given; null when there is none, or it is another server's. */
export async function readApproved(file: string, server?: string): Promise<ApprovedFile | null> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as Partial<ApprovedFile>;
    return isFile(value) && (server === undefined || value.server === server) ? value : null;
  } catch {
    return null;
  }
}

/** The approved repos' ids, lower case, while the copy is younger than `maxAgeMs`; null after, or with none. */
export function freshRepos(copy: ApprovedFile | null, maxAgeMs: number, now: number): Set<string> | null {
  return copy && now - copy.checked <= maxAgeMs ? new Set(copy.repos.map((r) => r.toLowerCase())) : null;
}
