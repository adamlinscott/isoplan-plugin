// The ask_room tool's script, which the hooks module runs for the session's agent (#49):
//
//   node dist/ask.js --session <id> --cwd <folder> [--key <id>]     the question on stdin; prints what the agent is told
//   node dist/ask.js --session <id> --cwd <folder> --ack <question>  the agent was shown that question's end
//
// `--key` is the tool call's id, so asking again under it is the same question (ask.ts).
// It speaks to the office server as that session, on a short link of its own (handoff/connection.ts),
// and asks the room that session's person was handed (ask.ts). The server decides whether they may.
//
// When the office signs people in, the hello carries this machine's pairing token, as the data
// layer's and the runner's do (data-layer/pairing.ts), so the server admits it as the paired person.
// A token past its time is renewed with the machine's credential, and a hello refused as
// `token-expired` is sent once more with a fresh one. The script never pairs the machine itself:
// with no credential it sends no token, and the session's own data layer shows the link to pair.
// Refused as not paired, ended or forged, the agent is told so plainly (ask.ts).

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_QUESTION_LENGTH, PROTOCOL_VERSION, type HelloMessage } from "@isoplan/protocol";
import { loadConfig, loadSettings } from "../data-layer/config.js";
import { createGit } from "../data-layer/git.js";
import { accountOf, claudePaths, projectOf } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { createPairing, pairingLockPath, pairingPath, pairingWriteLockPath, postJson, readPairing } from "../data-layer/pairing.js";
import { openSideLink } from "../handoff/connection.js";
import { askRoom, TokenExpired, type AskSettings } from "./ask.js";

const CONNECT_MS = 20000;

const here = path.dirname(fileURLToPath(import.meta.url));
const modDir = path.join(here, "..");
const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
const isoplanDir = path.join(claudeDir, "isoplan");
const io = nodeIo();

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : null;
};

const readText = (p: string) => fs.readFile(p, "utf8").catch(() => null);

// The session's hello, as its own data layer says it, with the machine's token when it has one.
async function hello(session: string, cwd: string, token: string | undefined): Promise<HelloMessage> {
  const machine = os.hostname();
  const where = await createGit(io).resolve(cwd);
  return {
    type: "hello",
    v: PROTOCOL_VERSION,
    source: "claude-code",
    account: await accountOf({ readText, run: io.run }, claudeJson, cwd),
    machine: { name: machine },
    session: `claude-code:${session}`,
    project: await projectOf(io.run, where, cwd, machine),
    ...(token ? { token } : {}),
  };
}

// This machine's pairing with `server`, as the data layer keeps it, under the machine's Claude account.
async function machinePairing(server: string, allowPlainWs: boolean) {
  const account = await accountOf({ readText, run: io.run }, claudeJson, os.homedir());
  const file = pairingPath(claudeDir);
  const pairing = createPairing({
    file,
    lock: pairingLockPath(claudeDir),
    writeLock: pairingWriteLockPath(claudeDir),
    server,
    account,
    machine: os.hostname(),
    emit: () => {},
    allowPlainWs,
    // Pairing is the data layer's to start, where the person sees its link; this script never asks for one.
    post: (url, body) => (new URL(url).pathname.endsWith("/pair") ? Promise.reject(new Error("pairing is left to the session's data layer")) : postJson(url, body)),
  });
  return {
    // A token only from a credential this machine already holds; none otherwise.
    async token(): Promise<string | undefined> {
      const entry = (await readPairing(file)).accounts[account.id];
      if (entry?.server !== server || !entry.credential) return undefined;
      return (await pairing.token().catch(() => undefined)) ?? undefined;
    },
    expired: (sent: string | undefined) => pairing.refused("token-expired", sent).catch(() => {}),
    close: () => pairing.close().catch(() => {}),
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv: string[]): Promise<string> {
  const session = flag(argv, "--session");
  const cwd = flag(argv, "--cwd");
  const ack = flag(argv, "--ack");
  const key = flag(argv, "--key") ?? undefined;
  if (!session || !cwd) return "usage: ask.js --session <id> --cwd <folder> [--key <id>], with the question on stdin; or --ack <question>";
  const question = ack ? "" : (await readStdin()).trim();
  if (!ack && !question) return "Give the question to ask the room.";
  if (question.length > MAX_QUESTION_LENGTH) return `That question is too long to ask the room: keep it under ${MAX_QUESTION_LENGTH} characters.`;
  const settings = await loadSettings<AskSettings>(io, path.join(modDir, "runner.json"), path.join(isoplanDir, "runner.json"));
  const config = await loadConfig(io, path.join(modDir, "config.json"), path.join(isoplanDir, "config.json"));
  if (config.plainRefused) return `The room can't be asked: config.json's server, ${config.plainRefused}, is plain ws:// to another machine. Carry on without the answer.`;
  const pairing = await machinePairing(config.server, config.allowPlainWs);
  try {
    for (let tries = 0; ; tries++) {
      const token = await pairing.token();
      const link = await openSideLink(config.server, await hello(session, cwd, token), CONNECT_MS);
      try {
        if (ack) {
          link.send({ type: "asked-ack", v: PROTOCOL_VERSION, question: ack });
          return `acked ${ack}`;
        }
        return await askRoom(link, question, settings, key);
      } catch (err) {
        if (!(err instanceof TokenExpired) || tries > 0) throw err;
        await pairing.expired(token);
      } finally {
        await link.close();
      }
    }
  } finally {
    await pairing.close();
  }
}

try {
  process.stdout.write((await main(process.argv.slice(2))) + "\n");
} catch (err) {
  process.stdout.write(`The room couldn't be asked: ${(err as Error)?.message ?? String(err)}. Carry on without the answer.\n`);
}
