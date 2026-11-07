// A hooks module's end of the runner's pipe (pipe.ts). The hooks module runs inside Claude Code,
// which gives it no sockets, so it spawns this (`dist/pipe.js`, main.ts) and reads its stdout, as it
// read a data layer's: the session's lines from the runner, one JSON object per line (src/lines.ts).
//
// It reads where the pipe is from pipe.json, says hello for its session, and passes on every line
// the runner sends. When the pipe can't be reached, or goes (the runner stopped, or is starting
// again), it says so once with a `runner` line (`down`), starts the runner, and tries again every
// `retryMs`; once it is through again it says `up` and says hello afresh, so the new runner reports
// the session from then on. A `superseded` line (another window, or a newer version, has the
// session) is passed on and ends it, as it ended a data layer.

import net, { type Socket } from "node:net";
import type { DataLayerLine } from "../lines.js";
import { readLines, readPipeInfo, writeLine, type PipeHello, type PipeInfo } from "./pipe.js";

export interface RelayOptions {
  claudeDir: string;
  hello: Omit<PipeHello, "type" | "v" | "token">;
  out(line: DataLayerLine): void;
  /** False ends it: stdout broke, or the hooks module's Claude Code has gone. */
  goOn(): boolean;
  /** Starts the runner unless one is running (start.ts). */
  startRunner(): Promise<unknown>;
  retryMs: () => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
  readInfo?: (claudeDir: string) => Promise<PipeInfo | null>;
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Connects to the pipe at `address`, or null when it can't be reached. */
function connect(address: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = net.connect(address);
    socket.once("connect", () => (socket.off("error", fail), resolve(socket)));
    const fail = () => (socket.destroy(), resolve(null));
    socket.once("error", fail);
  });
}

/** Relays the runner's lines for the session until it is superseded or should stop. */
export async function relay(o: RelayOptions): Promise<"superseded" | "stopped"> {
  const sleep = o.sleep ?? sleepFor;
  const readInfo = o.readInfo ?? readPipeInfo;
  let down = false;
  while (o.goOn()) {
    const info = await readInfo(o.claudeDir);
    const socket = info && (await connect(info.address));
    if (socket && info) {
      if (down) o.out({ type: "runner", state: "up" });
      down = false;
      const ended = await new Promise<"superseded" | "closed">((resolve) => {
        let superseded = false;
        readLines(socket, (value) => {
          const line = value as DataLayerLine;
          if (!line || typeof line !== "object" || typeof line.type !== "string") return;
          o.out(line);
          if (line.type === "superseded") superseded = true;
        });
        socket.on("error", () => {}).on("close", () => resolve(superseded ? "superseded" : "closed"));
        writeLine(socket, { type: "hello", v: 1, token: info.token, ...o.hello } satisfies PipeHello);
      });
      if (ended === "superseded") return "superseded";
      if (!o.goOn()) break;
    }
    if (!down) o.out({ type: "runner", state: "down" });
    down = true;
    await o.startRunner().catch(() => {});
    await sleep(await o.retryMs());
  }
  return "stopped";
}
