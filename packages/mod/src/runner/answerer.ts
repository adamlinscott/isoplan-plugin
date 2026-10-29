// The answerer: the one boundary between the runner and the agent that answers from a session's
// context. The runner's queue, caps, secret scan and link know only this; everything about one
// agent (Claude Code's command line, its output, how it meters tokens, where its binary is) sits
// behind it, in claude.ts for Claude Code.

/** A session's lead, as the runner checks it before asking. */
export interface Lead {
  /** The folder the session runs in, which the fork must run in too. */
  cwd: string;
  /** Its turn is open now. */
  working: boolean;
  /** It was compacted, so earlier work survives only as a summary. */
  compacted: boolean;
  /** Its context in tokens, which a fork reads in full; 0 when unknown. */
  context: number;
}

/** Tokens one fork used, with cache reads and writes apart since they are priced apart. */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Ask {
  /** Sent first, the same text every time, so the lead's context is reused from cache. */
  instructions: string;
  /** The question, or the request for a brief. */
  request: string;
  timeoutMs: number;
}

/** The answer's text, or why there is none; usage is what was spent either way, when known. */
export type Answered = { ok: true; text: string; usage: Usage } | { ok: false; error: string; usage: Usage | null };

export interface Answerer {
  /** The session's lead, or null when this answerer has no such session on this machine. */
  lead(session: string): Promise<Lead | null>;
  /** Answers `ask` from a fork of the session's lead, never changing the session itself. */
  ask(session: string, lead: Lead, ask: Ask): Promise<Answered>;
}
