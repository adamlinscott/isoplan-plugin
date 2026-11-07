// The local pipe between the machine's runner and the sessions' hooks modules (ADR 0007 step 2):
// one per user per machine, served by the runner's worker (server.ts). On Windows it is a named
// pipe whose name is random for each worker; on macOS and Linux a Unix socket in a folder only this
// user can open, <claude dir>/isoplan/pipe/. Either way the worker writes where it is, with a token
// it makes as it starts, to <claude dir>/isoplan/runner/pipe.json, which only this user can read
// (the user's own profile on Windows, mode 0600 elsewhere), and every message to the runner carries
// that token. A process of another user can't learn the name or the token, so can't connect, nor
// put a pipe of its own under the name before the runner does.
//
// Each side writes one JSON object per line. A hooks module's end (client.ts, `dist/pipe.js`) says
// hello for its session and is sent that session's lines (src/lines.ts); the ask_room script
// (src/ask/main.ts) asks once and is sent the answer.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import type { Socket } from "node:net";
import path from "node:path";

/** What a hooks module's end says as it connects: the session it is for, and how its hooks module runs. */
export interface PipeHello {
  type: "hello";
  v: 1;
  token: string;
  session: string;
  /** The session's folder. */
  cwd: string;
  /** When the hooks module started, in ms: of one version, the later window's keeps the session. */
  since: number;
  /** The hooks module can submit a prompt, so the session takes messages from the floor. */
  messages: boolean;
  /** The plugin's folder the hooks module runs from, and its version. */
  root: string;
  version: string;
}

/** What the ask_room script sends: a question for the room, or that the agent was shown one's end (`ack`). */
export interface PipeAsk {
  type: "ask";
  v: 1;
  token: string;
  session: string;
  cwd: string;
  /** The office servers that gave the session its rights. */
  servers: string[];
  key?: string;
  question?: string;
  ack?: string;
}

/** The runner's one answer to an ask: what the agent is told. */
export interface PipeAnswer {
  type: "answer";
  text: string;
}

/** Where the worker's pipe is, as pipe.json holds it. */
export interface PipeInfo {
  address: string;
  token: string;
}

export const pipeInfoPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "pipe.json");

/** A new address for the worker's pipe: a named pipe with a random name on Windows, else the socket in this user's own folder. */
export function pipeAddress(claudeDir: string, platform: NodeJS.Platform = process.platform, random = () => randomBytes(16).toString("hex")): string {
  if (platform === "win32") return `\\\\.\\pipe\\isoplan-runner-${random()}`;
  return path.posix.join(claudeDir.replace(/\\/g, "/"), "isoplan", "pipe", "runner.sock");
}

export const newToken = () => randomBytes(32).toString("hex");

/** Makes the socket's folder, this user's alone (none on Windows), and clears a socket a crashed worker left. */
export async function preparePipe(address: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === "win32") return;
  const dir = path.dirname(address);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  await fs.rm(address, { force: true });
}

/** Writes pipe.json whole (a reader never sees half of it), readable by this user alone. */
export async function writePipeInfo(claudeDir: string, info: PipeInfo): Promise<void> {
  const file = pipeInfoPath(claudeDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(info) + "\n", { mode: 0o600 });
  await fs.rename(temp, file);
}

export async function readPipeInfo(claudeDir: string): Promise<PipeInfo | null> {
  try {
    const { address, token } = JSON.parse(await fs.readFile(pipeInfoPath(claudeDir), "utf8")) as Partial<PipeInfo>;
    return typeof address === "string" && typeof token === "string" ? { address, token } : null;
  } catch {
    return null;
  }
}

/** Calls `onLine` with each whole line that comes in on `socket`, parsed; a line that isn't JSON is passed over. */
export function readLines(socket: Socket, onLine: (value: unknown) => void, maxBytes = 1 << 20): void {
  let buffer = "";
  socket.setEncoding("utf8").on("data", (piece: string) => {
    buffer += piece;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const text = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!text) continue;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        continue;
      }
      onLine(value);
    }
    // A line this long is no line of ours.
    if (buffer.length > maxBytes) socket.destroy();
  });
}

export const writeLine = (socket: Socket, value: unknown) => {
  if (!socket.destroyed && socket.writable) socket.write(JSON.stringify(value) + "\n");
};
