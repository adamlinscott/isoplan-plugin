// Which repo an edit, a read or a command lands in (#74), so the floor can show an agent working in
// another repo there. Home is the session's folder: anything inside it is home, whichever repo it is
// in (a workspace folder holding several repos stays one room). A file in a repo outside it is
// away. The session's own repo, reached through another worktree or a second clone, is home too:
// it is the same project, not another repo.
//
// A file's repo is the one its nearest existing folder sits in, so a file not written yet is placed
// too. The line's own folder answers first, which is the common case and costs no lookup.

import type { Project } from "@isoplan/protocol";
import { dirname, normalize, pathKey, relativeTo, type MaybePromise, type Where } from "./git.js";

/** Where something landed: `file` relative to its repo's root, and the repo when it isn't the session's. */
export interface Placed {
  file: string;
  project?: Project;
  away?: true;
}

export interface AttributionInput {
  /** The session's folder. */
  folder: string;
  /** Where that folder sits in git; null for a workspace folder above its repos. */
  where: Where | null;
  resolve: (dir: string) => Promise<Where | null>;
  projectOf: (where: Where) => MaybePromise<Project>;
}

export interface Attribution {
  /** The file at absolute `path`, touched from `cwd`; null when it is in no repo and not in a workspace. */
  file(path: string, cwd: string | null): Promise<Placed | null>;
  /** The repo a command run in `dir` works in: {} for the session's own, null when it is in none. */
  dir(dir: string): Promise<Omit<Placed, "file"> | null>;
}

export function createAttribution({ folder, where: home, resolve, projectOf }: AttributionInput): Attribution {
  const homeProject = home ? Promise.resolve(projectOf(home)) : null;

  // The repo's project, or nothing for the session's own.
  async function elsewhere(where: Where, path: string): Promise<Omit<Placed, "file">> {
    if (home && pathKey(where.commonDir) === pathKey(home.commonDir)) return {};
    const project = await projectOf(where);
    if (homeProject && (await homeProject).id === project.id) return {};
    return relativeTo(folder, path) === null && pathKey(folder) !== pathKey(path) ? { project, away: true } : { project };
  }

  // The nearest folder from `dir` up that git places.
  async function repoOf(dir: string): Promise<Where | null> {
    for (let at = normalize(dir); ; ) {
      const where = await resolve(at);
      if (where) return where;
      const up = dirname(at);
      if (up === at) return null;
      at = up;
    }
  }

  return {
    async file(path, cwd) {
      const p = normalize(path);
      const own = cwd ? await resolve(cwd) : null;
      const where = own && relativeTo(own.toplevel, p) ? own : await repoOf(dirname(p));
      const file = where && relativeTo(where.toplevel, p);
      if (where && file) return { file, ...(await elsewhere(where, p)) };
      // A workspace's own files, outside any of its repos.
      const inFolder = !home && relativeTo(folder, p);
      return inFolder ? { file: inFolder } : null;
    },
    async dir(dir) {
      const where = await repoOf(dir);
      if (where) return elsewhere(where, normalize(dir));
      return !home && (relativeTo(folder, dir) !== null || pathKey(folder) === pathKey(dir)) ? {} : null;
    },
  };
}
