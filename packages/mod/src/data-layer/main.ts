// dist/data-layer.js: kept only so older code finds what it expects (ADR 0007 step 2). The machine's
// runner reports every session now (src/runner/reporting.ts), and a hooks module reaches it through
// the runner's pipe (src/pipe); no data layer process runs any more.
//
//   node dist/data-layer.js --session <id> --cwd <dir> [--since <ms>] [--messages]   the pipe's end (src/pipe/main.ts)
//   node dist/data-layer.js --detached --session <id> [--project <dir>]              the machine's part of a start, then done
//
// - A hooks module of an earlier version still loaded in a session (a checkout rebuilt under it)
//   spawns this for its session: it gets the pipe's end, which sends it the same lines.
// - A wake hook or runner of an earlier version may start it `--detached`: it puts this version's
//   wake hook and runner in place, starts that runner, says so in the session's log, and ends
//   (startDetached).
// - An earlier version's data layer counts a copy of the plugin as whole only once it holds this
//   file (state.ts), so without it an old data layer would take itself for the newest copy and put
//   its older runner back.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnHidden, startDetached, systemPlaces } from "./report-session.js";
import { runPipe } from "../pipe/main.js";

const argv = process.argv.slice(2);
const value = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : null;
};

if (argv.includes("--detached")) {
  // dist/data-layer.js sits one folder below the mod's config.json.
  const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  await startDetached({ sessionId: value("--session"), project: value("--project") ?? value("--cwd"), appDir, spawn: spawnHidden, ...systemPlaces() }).catch(() => {});
  process.exit(0);
}
await runPipe(import.meta.url);
