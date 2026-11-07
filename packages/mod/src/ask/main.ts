// The ask_room tool's script, which the hooks module runs for the session's agent (#49):
//
//   node dist/ask.js --session <id> --cwd <folder> [--server <address>]... [--key <id>]   the question on stdin; prints what the agent is told
//   node dist/ask.js --session <id> --cwd <folder> [--server <address>] --ack <question>  the agent was shown that question's end
//
// `--key` is the tool call's id, so asking again under it is the same question (ask.ts). `--server`
// names an office server that gave the session its rights (#105), once per office that did. It asks
// through the machine's runner, over the runner's pipe (src/pipe), which asks the office as this
// session (machine.ts) only while this session's hooks module is connected to it, after its secret
// scan of the question. With the runner out of reach, the agent is told to carry on.

import net from "node:net";
import os from "node:os";
import { claudePaths } from "../data-layer/identity.js";
import { readLines, readPipeInfo, writeLine, type PipeAnswer, type PipeAsk } from "../pipe/pipe.js";

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : null;
};
const flags = (argv: string[], name: string) => argv.flatMap((arg, i) => (arg === name && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));

const UNREACHABLE = "The room can't be asked right now: Isoplan's runner isn't running on this machine (it is being started). Carry on without the answer.";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv: string[]): Promise<string> {
  const session = flag(argv, "--session");
  const cwd = flag(argv, "--cwd");
  const ack = flag(argv, "--ack") ?? undefined;
  if (!session || !cwd) return "usage: ask.js --session <id> --cwd <folder> [--key <id>], with the question on stdin; or --ack <question>";
  const question = ack ? undefined : await readStdin();
  const { dir: claudeDir } = claudePaths(process.env, os.homedir());
  const info = await readPipeInfo(claudeDir);
  if (!info) return UNREACHABLE;
  const request: PipeAsk = { type: "ask", v: 1, token: info.token, session, cwd, servers: flags(argv, "--server"), ...(flag(argv, "--key") ? { key: flag(argv, "--key")! } : {}), ...(ack ? { ack } : { question }) };
  return new Promise((resolve) => {
    let said: string | null = null;
    const socket = net.connect(info.address);
    socket.on("connect", () => writeLine(socket, request));
    readLines(socket, (value) => {
      const answer = value as Partial<PipeAnswer>;
      if (answer?.type === "answer" && typeof answer.text === "string") said = answer.text;
    });
    socket.on("error", () => {}).on("close", () => resolve(said ?? UNREACHABLE));
  });
}

try {
  process.stdout.write((await main(process.argv.slice(2))) + "\n");
} catch (err) {
  process.stdout.write(`The room couldn't be asked: ${(err as Error)?.message ?? String(err)}. Carry on without the answer.\n`);
}
process.exit();
