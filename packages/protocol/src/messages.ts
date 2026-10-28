import { z } from "zod";
import { FactRemoveSchema, FactsSchema, FactUpsertSchema, SourceSchema } from "./facts.js";

/**
 * The protocol version every message carries as `v`. Adding optional fields doesn't change it;
 * changing what a field means, or removing one, does.
 */
export const PROTOCOL_VERSION = 1;

const Version = z.literal(PROTOCOL_VERSION);
const Seq = z.number().int().nonnegative();

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

// Data layer → office server.

/** The first message on a connection: who is reporting, from where, about which session. */
export const HelloMessageSchema = z.object({
  type: z.literal("hello"),
  v: Version,
  source: SourceSchema,
  account: z.object({ id: z.string().min(1), name: z.string() }),
  machine: z.object({ name: z.string().min(1) }),
  session: z.string().min(1),
  project: ProjectSchema,
});

/** All of the session's facts. Sent on connect and on repair. */
export const FullMessageSchema = z.object({
  type: z.literal("full"),
  v: Version,
  seq: Seq,
  facts: FactsSchema,
});

/** What changed since the last message. `seq` goes up by one per message, so a gap shows. */
export const ChangesMessageSchema = z.object({
  type: z.literal("changes"),
  v: Version,
  seq: Seq,
  upsert: FactUpsertSchema,
  remove: FactRemoveSchema,
});

export const DataLayerMessageSchema = z.discriminatedUnion("type", [
  HelloMessageSchema,
  FullMessageSchema,
  ChangesMessageSchema,
]);

// Office server → data layer.

/** Asks the data layer to send its facts in full. */
export const RepairMessageSchema = z.object({
  type: z.literal("repair"),
  v: Version,
  reason: z.string().optional(),
});

/** A note for the later editor of `file`, which the data layer adds to `agent`'s next tool result. */
export const ConflictMessageSchema = z.object({
  type: z.literal("conflict"),
  v: Version,
  agent: z.string().min(1),
  file: z.string().min(1),
  text: z.string().min(1),
});

/** Something the data layer should show. */
export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  v: Version,
  code: z.string().min(1),
  message: z.string(),
});

export const OfficeServerMessageSchema = z.discriminatedUnion("type", [
  RepairMessageSchema,
  ConflictMessageSchema,
  ErrorMessageSchema,
]);

export type Project = z.infer<typeof ProjectSchema>;
export type HelloMessage = z.infer<typeof HelloMessageSchema>;
export type FullMessage = z.infer<typeof FullMessageSchema>;
export type ChangesMessage = z.infer<typeof ChangesMessageSchema>;
export type DataLayerMessage = z.infer<typeof DataLayerMessageSchema>;
export type RepairMessage = z.infer<typeof RepairMessageSchema>;
export type ConflictMessage = z.infer<typeof ConflictMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type OfficeServerMessage = z.infer<typeof OfficeServerMessageSchema>;

/**
 * A parsed message, or why it was refused: `unsupported-version` when it carries a protocol
 * version this side doesn't speak, `invalid` for anything else wrong with it.
 */
export type ParseResult<T> =
  | { ok: true; message: T }
  | { ok: false; kind: "invalid" | "unsupported-version"; error: string };

/** Validates a message an office server received from a data layer. */
export function parseDataLayerMessage(value: unknown): ParseResult<DataLayerMessage> {
  return parse(DataLayerMessageSchema, value);
}

/** Validates a message a data layer received from an office server. */
export function parseOfficeServerMessage(value: unknown): ParseResult<OfficeServerMessage> {
  return parse(OfficeServerMessageSchema, value);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  // The version is checked first, so a newer peer is told so rather than given a field-by-field
  // list of what changed.
  if (typeof value === "object" && value !== null && "v" in value && typeof value.v === "number" && value.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      kind: "unsupported-version",
      error: `protocol version ${JSON.stringify(value.v)} is not supported; this side speaks version ${PROTOCOL_VERSION}`,
    };
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, message: result.data };
  return { ok: false, kind: "invalid", error: z.prettifyError(result.error) };
}
