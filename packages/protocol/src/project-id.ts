import type { Project } from "./messages.js";

/**
 * A project's id and name. With a git remote the id is `host/owner/repo` (any deeper path kept, as
 * for GitLab subgroups), the same whichever form or letter case the remote is written in, so a
 * repository cloned on several machines is one project. A repo with no remote, a remote that is a
 * local path, or one that can't be read is `local:<machine>/<root>`, its working tree's root path.
 * Never throws, so a remote's credentials never reach an error message.
 */
export function projectId(remoteUrl: string | null, local: { machine: string; root: string }): Project {
  const remote = remoteUrl === null || isLocalPath(remoteUrl.trim()) ? null : splitRemote(remoteUrl.trim());
  const segments = remote?.path
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  if (!remote || !segments || segments.length === 0) {
    const root = local.root.replace(/\\/g, "/").replace(/\/+$/, "");
    return { id: `local:${local.machine}/${root}`, name: root.split("/").pop() || root };
  }
  // Hosts and the big forges treat owner and repo names case-insensitively.
  return { id: [remote.host, ...segments].join("/").toLowerCase(), name: segments[segments.length - 1]! };
}

// An empty remote, a path (`/srv/x.git`, `./x`, `~/x`, `C:\x`, `\\server\x`) or a `file:` URL.
function isLocalPath(remote: string): boolean {
  return remote === "" || /^(?:[/.~\\]|[A-Za-z]:[\\/]|file:)/.test(remote);
}

// `scheme://[user[:password]@]host[:port]/path`, or scp-like `[user@]host:path`; null when neither.
function splitRemote(remote: string): { host: string; path: string } | null {
  if (remote.includes("://")) {
    if (!URL.canParse(remote)) return null;
    const url = new URL(remote);
    return url.hostname ? { host: url.hostname, path: url.pathname } : null;
  }
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(remote);
  return scp ? { host: scp[1]!, path: scp[2]! } : null;
}
