// What the data layer writes to stdout, one JSON object per line, for the hooks module that
// spawned it. The hooks module can't write to the process once it has started (its stdin closes at
// launch), so anything it sends back goes through a file the line names.

import type { ConflictMessage, ErrorMessage } from "@isoplan/protocol";

/**
 * The link to the office server. `waiting`: nothing to report yet, so not connected.
 * `not-wanted`: the server holds this project in no office, so it isn't reported.
 */
export interface StatusLine {
  type: "status";
  server: string;
  state: "waiting" | "connecting" | "connected" | "disconnected" | "not-wanted";
  /** With `disconnected`: when the next try is. */
  retryInMs?: number;
}

/**
 * A room title to write: the hooks module asks `model` and writes `{ key, text }` (the reply's
 * text) as JSON to `file`, which the data layer reads back.
 */
export interface TitleAskLine {
  type: "title-ask";
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  key: string;
  file: string;
}

/** A problem worth a line in the debug log. */
export interface LogLine {
  type: "log";
  text: string;
}

/** The reply a title-ask's file holds. */
export interface TitleReply {
  key: string;
  text: string;
}

/** Office server messages are passed on as the server sent them (repair is the data layer's own). */
export type DataLayerLine = StatusLine | TitleAskLine | LogLine | ConflictMessage | ErrorMessage;
