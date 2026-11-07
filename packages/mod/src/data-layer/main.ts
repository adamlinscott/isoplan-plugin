// The data layer: the process the hooks module spawns for one Claude Code session, which reports it
// (report-session.ts) and writes JSON lines to stdout for the hooks module (src/lines.ts).
//
//   node dist/data-layer.js --session <session id> --cwd <the session's folder> [--project <dir>] [--since <ms>] [--messages]
//
// Claude Code ends it with the session; as a backstop it also ends when stdout breaks or its parent
// process has gone. On POSIX an orphan is re-parented, so a changed ppid means gone even if the old
// pid is reused.
//
// The machine's runner reports every session without a hooks module itself (src/runner/reporting.ts,
// ADR 0007). A wake hook from an earlier version may still start this with `--detached`: it ends at
// once: that wake hook starts the runner itself.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportSession } from "./report-session.js";
import { alive } from "../wake/lock.js";

const value = (argv: string[], flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : null;
};

async function main(argv: string[]): Promise<number> {
  const sessionId = value(argv, "--session");
  const cwd = value(argv, "--cwd");
  // dist/data-layer.js sits one folder below the mod's config.json.
  const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (argv.includes("--detached")) return 0;
  if (!sessionId || !cwd) {
    process.stderr.write("usage: node data-layer.js --session <id> --cwd <dir> [--project <dir>] [--since <ms>] [--messages]\n");
    return 2;
  }
  const parent = process.ppid;
  let isOut = true;
  const closed = new Promise<void>((resolve) => process.stdout.on("error", () => resolve()));
  void closed.then(() => (isOut = false));
  await reportSession({
    sessionId,
    cwd,
    project: value(argv, "--project") ?? cwd,
    by: "hooks",
    appDir,
    emit: (line) => {
      if (isOut) process.stdout.write(JSON.stringify(line) + "\n");
    },
    closed,
    goOn: () => process.ppid === parent && alive(parent),
    takesMessages: argv.includes("--messages"),
    since: Number(value(argv, "--since")) || Date.now(),
  });
  return 0;
}

process.on("uncaughtException", crash).on("unhandledRejection", crash);
process.exitCode = await main(process.argv.slice(2)).catch(crash);
// The link's timers would keep the process up; it is done.
process.exit();

function crash(err: unknown): never {
  process.stderr.write(`${String((err as Error)?.stack ?? err)}\n`);
  process.exit(1);
}
