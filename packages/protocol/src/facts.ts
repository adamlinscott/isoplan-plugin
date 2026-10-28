import { z } from "zod";

// One session's facts, as its data layer reports them: v1's office model minus everything derived
// (rooms, roles, meaning) and minus what the hello already says (the owner, the project).

/** ISO time, with Z or an offset. */
const Time = z.iso.datetime({ offset: true });

/** Tool-specific detail that views never rely on. */
const Extra = z.record(z.string(), z.unknown()).optional();

export const SourceSchema = z.enum(["claude-code"]);

export const SessionFactSchema = z.object({
  id: z.string().min(1),
  source: SourceSchema,
  lead: z.string().min(1),
  title: z.string().nullable(),
  titleFrom: z.enum(["source", "branch"]),
  branch: z.string().nullable(),
  checkout: z.string().optional(),
  lastActive: Time,
  status: z.enum(["active", "idle"]),
  lights: z.enum(["on", "off"]),
  extra: Extra,
});

const TokenCount = z.number().int().nonnegative();

const TokenCounts = z.object({
  input: TokenCount,
  cacheWrite: TokenCount,
  cacheWrite1h: TokenCount,
  cacheRead: TokenCount,
  output: TokenCount,
});

export const AgentFactSchema = z.object({
  id: z.string().min(1),
  source: SourceSchema,
  session: z.string().min(1),
  startedBy: z.string().min(1).nullable(),
  agentType: z.string().nullable(),
  task: z.string().nullable(),
  status: z.enum(["working", "idle", "done", "stalled", "stopped", "failed"]),
  statusSince: Time,
  lastActive: Time,
  doing: z
    .object({
      kind: z.enum(["write", "read", "run", "search", "talk"]),
      file: z.string().optional(),
      since: Time,
    })
    .nullable(),
  usage: TokenCounts.extend({
    model: z.string().min(1),
    context: TokenCount,
    over100k: TokenCounts,
    at: Time,
  }).nullable(),
  checkout: z.string().optional(),
  branch: z.string().nullable().optional(),
  extra: Extra,
});

/** An edit or a read: `file` is relative to the repo root, with forward slashes. */
export const FileFactSchema = z.object({
  agent: z.string().min(1),
  file: z.string().min(1),
  at: Time,
  extra: Extra,
});

export const WaitFactSchema = z.object({
  waiter: z.string().min(1),
  on: z.string().min(1),
  since: Time,
  extra: Extra,
});

export const ReportFactSchema = z.object({
  agent: z.string().min(1),
  at: Time,
  text: z.string(),
  extra: Extra,
});

export const FactsSchema = z.object({
  session: SessionFactSchema,
  agents: z.array(AgentFactSchema),
  edits: z.array(FileFactSchema),
  reads: z.array(FileFactSchema),
  waits: z.array(WaitFactSchema),
  reports: z.array(ReportFactSchema),
});

/** The records that changed, each replacing the one with the same key. */
export const FactUpsertSchema = z.object({
  session: SessionFactSchema.optional(),
  agents: z.array(AgentFactSchema).optional(),
  edits: z.array(FileFactSchema).optional(),
  reads: z.array(FileFactSchema).optional(),
  waits: z.array(WaitFactSchema).optional(),
  reports: z.array(ReportFactSchema).optional(),
});

const FileKey = FileFactSchema.pick({ agent: true, file: true });

/**
 * The keys of records that went away: an agent by its id, an edit or read by agent and file, a
 * wait by waiter and on, a report by its agent. The session itself goes with the connection.
 */
export const FactRemoveSchema = z.object({
  agents: z.array(z.string().min(1)).optional(),
  edits: z.array(FileKey).optional(),
  reads: z.array(FileKey).optional(),
  waits: z.array(WaitFactSchema.pick({ waiter: true, on: true })).optional(),
  reports: z.array(z.string().min(1)).optional(),
});

export type Source = z.infer<typeof SourceSchema>;
export type SessionFact = z.infer<typeof SessionFactSchema>;
export type AgentFact = z.infer<typeof AgentFactSchema>;
export type FileFact = z.infer<typeof FileFactSchema>;
export type WaitFact = z.infer<typeof WaitFactSchema>;
export type ReportFact = z.infer<typeof ReportFactSchema>;
export type Facts = z.infer<typeof FactsSchema>;
export type FactUpsert = z.infer<typeof FactUpsertSchema>;
export type FactRemove = z.infer<typeof FactRemoveSchema>;
