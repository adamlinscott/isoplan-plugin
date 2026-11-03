// /isoplan:repos's script (commands/repos.md):
//
//   node dist/repos.js
//
// Asks every office in config.json now which repos it takes (repos.ts), and prints one sentence per
// office on whether it takes the repo of the session's folder: $CLAUDE_PROJECT_DIR, else this
// process's. The folder's projects are worked out as the data layer's are (data-layer/home.ts).

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approvedPath } from "../data-layer/approved.js";
import { loadConfig, officesOf } from "../data-layer/config.js";
import { candidatesOf, machineHomeIo } from "../data-layer/home.js";
import { accountOf, claudePaths } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { pairingPath } from "../data-layer/pairing.js";
import { checkOffice, readOnlyPairing, sentence } from "./repos.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
const io = nodeIo();
const config = await loadConfig(io, path.join(here, "..", "config.json"), path.join(claudeDir, "isoplan", "config.json"));
// The pairing is the machine's, whichever folder the session is in.
const account = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, os.homedir());
const { projects, workspace } = await candidatesOf(process.env.CLAUDE_PROJECT_DIR || process.cwd(), machineHomeIo(config.workspaceRepos));
const lines = await Promise.all(
  officesOf(config).map(async (office) => {
    const answer = office.plainRefused
      ? ({ kind: "plain" } as const)
      : await checkOffice({
          server: office.server,
          file: approvedPath(claudeDir, office.server),
          pairing: readOnlyPairing(pairingPath(claudeDir), office.server, account.id),
          refreshMs: config.approvedRefreshMinutes * 60000,
          maxAgeMs: config.approvedMaxAgeMinutes * 60000,
        });
    return sentence(office.label, answer, projects, workspace);
  }),
);
process.stdout.write(lines.join("\n") + "\n");
