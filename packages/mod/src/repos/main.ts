// /isoplan:repos's script (commands/repos.md):
//
//   node dist/repos.js
//
// Asks every office the session reports to now which repos it takes (repos.ts), and prints one
// sentence per office on whether it takes the session's repo. The folder is the one the session's
// data layer reports as, from its lock (<claude dir>/isoplan/live/<$CLAUDE_CODE_SESSION_ID>.json),
// else $CLAUDE_PROJECT_DIR, else this process's; its projects are worked out with the data layer's
// own candidatesOf (data-layer/home.ts). What goes wrong is written to <claude dir>/isoplan/logs/repos.log.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approvedPath } from "../data-layer/approved.js";
import { loadConfig, officesOf } from "../data-layer/config.js";
import { candidatesOf, machineHomeIo } from "../data-layer/home.js";
import { accountOf, claudePaths } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { pairingPath, pairingWriteLockPath } from "../data-layer/pairing.js";
import { lockPath, readLock } from "../wake/lock.js";
import { checkOffice, commandPairing, NO_OFFICE, sentence } from "./repos.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
const userConfigPath = path.join(claudeDir, "isoplan", "config.json");
const logFile = path.join(claudeDir, "isoplan", "logs", "repos.log");
const log = (text: string) => {
  void fs
    .mkdir(path.dirname(logFile), { recursive: true })
    .then(() => fs.appendFile(logFile, `${new Date().toISOString()} ${text}\n`))
    .catch(() => {});
};
const io = nodeIo();

// An office comes only from the person's own config.json (Connect Claude Code adds it to `servers`); the plugin's default names none of theirs.
const mine = (await fs.readFile(userConfigPath, "utf8").then((t) => JSON.parse(t) as Record<string, unknown>, () => null)) ?? {};
if (!(Array.isArray(mine.servers) && mine.servers.length) && typeof mine.server !== "string") {
  process.stdout.write(NO_OFFICE + "\n");
} else {
  const config = await loadConfig(io, path.join(here, "..", "config.json"), userConfigPath);
  // The pairing is the machine's, whichever folder the session is in.
  const account = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, os.homedir());
  const session = process.env.CLAUDE_CODE_SESSION_ID;
  const locked = session && /^[\w-]+$/.test(session) ? (await readLock(lockPath(claudeDir, session)))?.extra.cwd : undefined;
  const folder = typeof locked === "string" && locked ? locked : process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const { projects, workspace } = await candidatesOf(folder, machineHomeIo(config.workspaceRepos));
  const lines = await Promise.all(
    officesOf(config).map(async (office) => {
      const answer = office.plainRefused
        ? ({ kind: "plain" } as const)
        : await checkOffice({
            server: office.server,
            file: approvedPath(claudeDir, office.server),
            pairing: commandPairing({ file: pairingPath(claudeDir), writeLock: pairingWriteLockPath(claudeDir), server: office.server, account: account.id, legacy: !!office.legacy }, log),
            refreshMs: config.approvedRefreshMinutes * 60000,
            maxAgeMs: config.approvedMaxAgeMinutes * 60000,
            log,
          });
      return sentence(office.label, answer, projects, workspace);
    }),
  );
  process.stdout.write(lines.join("\n") + "\n");
}
