// A hooks module's end of the runner's pipe (pipe.ts). The hooks module runs inside Claude Code,
// which gives it no sockets, so it spawns this (`dist/pipe.js`, main.ts) and reads its stdout, as it
// read a data layer's: the session's lines from the runner, one JSON object per line (src/lines.ts).
//
// It reads where the pipe is from pipe.json, has the runner prove it is the runner (openPipe), says
// hello for its session, and passes on every line the runner sends. When the pipe can't be reached,
// or goes (the runner stopped, or is starting again), it says so once with a `runner` line
// (`down`), starts the runner, and tries again every `retryMs`; once it is through again it says
// `up` and says hello afresh, so the new runner reports the session from then on. A runner that won't
// start (held off, or not installed) is said with a `runner` line of its own, and in the session's
// log, each time that changes. A `superseded` line (another window, or a newer version, has the
// session) is passed on and ends it, as it ended a data layer.

import type { DataLayerLine, RunnerLine } from "../lines.js";
import { openPipe, readPipeInfo, writeLine, type PipeHello, type PipeInfo } from "./pipe.js";

export interface RelayOptions {
  claudeDir: string;
  hello: Omit<PipeHello, "type" | "v" | "token">;
  out(line: DataLayerLine): void;
  /** False ends it: stdout broke, or the hooks module's Claude Code has gone. */
  goOn(): boolean;
  /** Starts the runner unless one is running (start.ts): what it did. */
  startRunner(): Promise<string | null>;
  /** Writes to the session's log. */
  say?(text: string): void;
  retryMs: () => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
  readInfo?: (claudeDir: string) => Promise<PipeInfo | null>;
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Why the runner won't start, as the session's log says it.
const HELD: Record<NonNullable<RunnerLine["held"]>, string> = {
  "held-off": "Isoplan's runner is holding off for now (runner.log says why), so this session isn't reported until it starts again",
  "not-installed": "Isoplan's runner isn't installed here, so this session isn't reported; run the plugin's install script",
};

/** Relays the runner's lines for the session until it is superseded or should stop. */
export async function relay(o: RelayOptions): Promise<"superseded" | "stopped"> {
  const sleep = o.sleep ?? sleepFor;
  const readInfo = o.readInfo ?? readPipeInfo;
  let down = false;
  let held: RunnerLine["held"] | null = null; // why the runner won't start, as last said
  while (o.goOn()) {
    const info = await readInfo(o.claudeDir);
    let superseded = false;
    const socket =
      info &&
      (await openPipe(info, (value) => {
        const line = value as DataLayerLine;
        if (!line || typeof line !== "object" || typeof line.type !== "string") return;
        o.out(line);
        if (line.type === "superseded") superseded = true;
      }));
    if (socket && info) {
      if (down) o.out({ type: "runner", state: "up" });
      down = false;
      held = null;
      await new Promise<void>((resolve) => {
        socket.on("close", () => resolve());
        writeLine(socket, { type: "hello", v: 1, token: info.token, ...o.hello } satisfies PipeHello);
      });
      if (superseded) return "superseded";
      if (!o.goOn()) break;
    }
    if (!down) o.out({ type: "runner", state: "down" });
    down = true;
    const started = await o.startRunner().catch(() => null);
    const now = started === "held-off" || started === "not-installed" ? started : null;
    if (now !== held) {
      // Said again whenever it changes, so the status line says what holds the session up.
      o.out(now ? { type: "runner", state: "down", held: now } : { type: "runner", state: "down" });
      if (now) o.say?.(HELD[now]);
      held = now;
    }
    await sleep(await o.retryMs());
  }
  return "stopped";
}
