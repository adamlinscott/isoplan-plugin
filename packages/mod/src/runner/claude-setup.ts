// Claude Code for the terminal on this machine (#180): whether it is here and signed in, for the
// runner's hello and `driven` `claude`, and installing it or signing it in on its person's press from
// the floor (`install-claude`, `sign-in-claude`).
//
// - Found the way driven sessions find it (`binary`, claude-binary.ts); `claude auth status --json`
//   saying `loggedIn: false` is `signed-out`, and one that can't say leaves it `ready`, for the
//   session itself to say what is wrong.
// - Signing in is the CLI's own: Claude Code keeps it in the macOS Keychain, or
//   ~/.claude/.credentials.json on Windows, apart from the Claude app's, so a fresh install on a
//   machine whose app is signed in is still signed out until `claude auth login`.
// - The install is Anthropic's native installer (code.claude.com/docs/en/setup): on Windows
//   `irm https://claude.ai/install.ps1 | iex` in PowerShell, elsewhere
//   `curl -fsSL https://claude.ai/install.sh | bash`. It needs no admin rights and puts claude in
//   ~/.local/bin, where findClaude looks. Every process runs hidden, with no window, and is ended after
//   its time; each line the installer writes goes to the floor as `progress`, through the secret scan.
// - The sign-in runs `claude auth login`, which opens the sign-in page in the browser on this machine
//   (the person's press on the floor asked for it), and its link goes to the floor too, for when no
//   browser came up. The runner checks `claude auth status` while it runs and ends it once signed in.
// - One install or sign-in at a time; a second is refused `busy`.

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { MAX_DETAIL_LENGTH, MAX_SIGN_IN_URL_LENGTH, PROTOCOL_VERSION, type ClaudeCli, type DriveMessage, type DrivenMessage } from "@isoplan/protocol";
import { claudeCommand } from "./claude-binary.js";
import { hiddenSpawn, killTree, type Spawn } from "./claude.js";

/** What runs Anthropic's native installer, hidden, on this OS. */
export function installerArgv(platform: NodeJS.Platform): string[] {
  return platform === "win32"
    ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"]
    : ["/bin/bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"];
}

export interface ClaudeSetupOptions {
  /** The `claude` binary, or null when none can be found. */
  binary: () => Promise<string | null>;
  /** Sends a `driven` message to every office. */
  send: (message: DrivenMessage) => void;
  /** The name of the secret pattern `text` matches, or null. */
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** Where the installer and the sign-in run: the home folder. */
  cwd: string;
  env: Record<string, string>;
  platform?: NodeJS.Platform;
  spawn?: Spawn;
  /** What runs the installer; installerArgv by default. */
  installer?: string[];
  installMs?: number;
  signInMs?: number;
  /** How often `claude auth status` is asked while the sign-in runs. */
  signInCheckMs?: number;
}

type Request = Extract<DriveMessage, { kind: "install-claude" | "sign-in-claude" }>;

export interface ClaudeSetup {
  /** As last found; `missing` until the first check. */
  state(): ClaudeCli;
  /** Finds it again, and tells every office when that changed. */
  check(): Promise<ClaudeCli>;
  /** An install or a sign-in from the floor, whose `by` the driver has checked. */
  take(m: Request): void;
  /** Resolves once the install or sign-in running now has ended. */
  settled(): Promise<void>;
}

const INSTALL_MS = 10 * 60000;
const SIGN_IN_MS = 10 * 60000;
const STATUS_MS = 30000;
const driven = { type: "driven", v: PROTOCOL_VERSION } as const;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const cut = (text: string) => (text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH - 1)}…` : text);

export function createClaudeSetup(o: ClaudeSetupOptions): ClaudeSetup {
  const spawn = o.spawn ?? hiddenSpawn;
  const platform = o.platform ?? process.platform;
  let state: ClaudeCli = "missing";
  let running: Promise<void> | null = null;

  // Runs `argv` hidden to its end or `ms`, handing each line it writes to `line`; `stop` ends it early.
  function run(argv: string[], ms: number, line: (text: string) => void = () => {}): { done: Promise<{ code: number | null; timedOut: boolean; error?: string }>; stop: () => void } {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(argv, { cwd: o.cwd, env: o.env });
    } catch (err) {
      return { done: Promise.resolve({ code: null, timedOut: false, error: (err as Error).message }), stop: () => {} };
    }
    let timedOut = false;
    const timer = setTimeout(() => ((timedOut = true), killTree(child, platform)), ms);
    for (const stream of [child.stdout, child.stderr]) {
      let buf = "";
      stream.setEncoding("utf8").on("data", (d: string) => {
        buf += d;
        const lines = buf.split(/\r?\n|\r/);
        buf = lines.pop()!;
        for (const l of lines) line(l);
      });
      stream.on("end", () => buf && line(buf));
    }
    const done = new Promise<{ code: number | null; timedOut: boolean; error?: string }>((resolve) => {
      child.on("error", (err) => (clearTimeout(timer), resolve({ code: null, timedOut, error: err.message })));
      child.on("close", (code) => (clearTimeout(timer), resolve({ code, timedOut })));
    });
    return { done, stop: () => killTree(child, platform) };
  }

  async function signedIn(bin: string): Promise<boolean | null> {
    let out = "";
    const { done } = run([...claudeCommand(bin), "auth", "status", "--json"], STATUS_MS, (l) => (out += l));
    const r = await done;
    try {
      const loggedIn = (JSON.parse(out) as { loggedIn?: unknown }).loggedIn;
      return r.code === 0 && typeof loggedIn === "boolean" ? loggedIn : null;
    } catch {
      return null;
    }
  }

  async function find(): Promise<ClaudeCli> {
    const bin = await o.binary();
    if (!bin) return "missing";
    return (await signedIn(bin)) === false ? "signed-out" : "ready";
  }

  function say(fields: Omit<Extract<DrivenMessage, { kind: "claude" }>, "type" | "v" | "kind" | "claude">): void {
    o.send({ ...driven, kind: "claude", claude: state, ...fields });
  }

  async function install(id: string): Promise<void> {
    say({ doing: "installing", id });
    let last = "";
    let lines = Promise.resolve();
    const { done } = run(o.installer ?? installerArgv(platform), o.installMs ?? INSTALL_MS, (raw) => {
      const text = raw.replace(ANSI, "").trim();
      if (!text) return;
      lines = lines.then(async () => {
        if (await o.scan(text)) return;
        last = cut(text);
        say({ doing: "installing", progress: last, id });
      });
    });
    const r = await done;
    await lines;
    state = await find();
    if (state !== "missing") return say({ id });
    const why = r.error
      ? `The installer couldn't start: ${r.error}`
      : r.timedOut
        ? `The installer didn't finish within ${Math.round((o.installMs ?? INSTALL_MS) / 60000)} minutes, so it was stopped.`
        : r.code !== 0
          ? `The installer stopped with code ${r.code}${last ? `: ${last}` : "."}`
          : "The installer finished, but Claude Code isn't where it puts it.";
    o.log(`installing Claude Code failed: ${why}`);
    say({ failed: cut(why), id });
  }

  async function signIn(id: string, bin: string): Promise<void> {
    say({ doing: "signing-in", id });
    let url: string | undefined;
    const login = run([...claudeCommand(bin), "auth", "login"], o.signInMs ?? SIGN_IN_MS, (raw) => {
      const found = /https:\/\/\S+/.exec(raw.replace(ANSI, ""))?.[0];
      if (url || !found || found.length > MAX_SIGN_IN_URL_LENGTH) return;
      url = found;
      void o.scan(found).then((match) => !match && say({ doing: "signing-in", url: found, id }));
    });
    let ended = false;
    void login.done.then(() => (ended = true));
    // `claude auth login` may wait on its terminal after it has signed in: the status says when it has.
    while (!ended) {
      await Promise.race([login.done, new Promise((resolve) => setTimeout(resolve, o.signInCheckMs ?? 3000))]);
      if (!ended && (await signedIn(bin)) === true) login.stop();
    }
    const r = await login.done;
    state = await find();
    if (state === "ready") return say({ id });
    const why = r.error ? `The sign-in couldn't start: ${r.error}` : r.timedOut ? "The sign-in wasn't finished in time, so it was stopped: sign in again." : "Claude Code isn't signed in: sign in again.";
    say({ failed: why, id });
  }

  return {
    state: () => state,
    async check() {
      const was = state;
      state = await find();
      if (state !== was && !running) say({});
      return state;
    },
    take(m) {
      const refuse = (reason: "busy" | "no-claude") => o.send({ ...driven, kind: "refused", id: m.id, reason });
      if (running) return refuse("busy");
      const work = (async () => {
        if (m.kind === "install-claude") return install(m.id);
        const bin = await o.binary();
        if (!bin) {
          state = "missing";
          return refuse("no-claude");
        }
        return signIn(m.id, bin);
      })();
      running = work.catch((err: Error) => o.log(`${m.kind} ${m.id} failed: ${err?.stack ?? String(err)}`)).finally(() => (running = null));
    },
    settled: () => running ?? Promise.resolve(),
  };
}
