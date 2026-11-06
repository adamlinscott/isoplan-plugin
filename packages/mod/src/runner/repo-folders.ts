// Where on this machine a new session can start from the floor (#67, isoplan-app#182): the folders
// Claude Code sessions here ran in, grouped by the repo each is in, for the repos an office takes.
// The runner's driver sends the list as a `folders` message (session.ts), and a start naming a
// folder is opened only in one it listed.
//
// A folder counts for the repo a session there reports as (data-layer/home.ts approvedHome): its
// checkout's repo, or, for a folder above several repos, the first the office takes. One that is
// gone, or in no repo the office takes, isn't listed. Each passes the secret scan before it may
// leave the machine; one it matches, or one longer than the protocol takes, is left out, never cut.

import { MAX_FOLDER_LENGTH, MAX_FOLDER_REPOS, MAX_REPO_FOLDERS } from "@isoplan/protocol";
import { pathKey } from "../data-layer/git.js";

/** A folder a session ran in, and when it was last used, in ms since the epoch. */
export interface FolderSeen {
  folder: string;
  at: number;
}

/** One repo's folders, as a `folders` message lists them. */
export interface RepoFolders {
  /** The repo's project id, lower-cased. */
  project: string;
  folders: string[];
}

export interface RepoFoldersOptions {
  /** The project id of the repo the office takes that `folder` is in, lower-cased; null when it is gone or the office takes none. */
  home: (folder: string) => Promise<string | null>;
  /** The name of the secret pattern `text` matches, or null. */
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** The pathKeys of the folders the scan left out last time, kept by the caller across checks: only a folder newly left out is logged. Updated in place. */
  leftOut: Set<string>;
}

/** The folders `seen` holds, by repo, the most recently used first: each folder once, at most MAX_REPO_FOLDERS a repo and MAX_FOLDER_REPOS repos. */
export async function repoFolders(seen: FolderSeen[], o: RepoFoldersOptions): Promise<RepoFolders[]> {
  const byRepo = new Map<string, string[]>();
  const tried = new Set<string>();
  const leftOut = new Set<string>();
  for (const { folder } of [...seen].sort((a, b) => b.at - a.at)) {
    const key = pathKey(folder);
    if (tried.has(key)) continue;
    tried.add(key);
    if (folder.length > MAX_FOLDER_LENGTH) continue;
    const project = await o.home(folder).catch(() => null);
    if (!project) continue;
    const folders = byRepo.get(project) ?? [];
    if (folders.length >= MAX_REPO_FOLDERS || (!byRepo.has(project) && byRepo.size >= MAX_FOLDER_REPOS)) continue;
    const matched = await o.scan(folder);
    if (matched) {
      leftOut.add(key);
      if (!o.leftOut.has(key)) o.log(`a folder of ${project} wasn't listed for starting sessions from the floor: its path matches the secret pattern "${matched}"`);
      continue;
    }
    folders.push(folder);
    byRepo.set(project, folders);
  }
  o.leftOut.clear();
  for (const key of leftOut) o.leftOut.add(key);
  return [...byRepo].map(([project, folders]) => ({ project, folders }));
}
