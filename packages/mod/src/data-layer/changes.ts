// What changed between two sets of one session's facts, as a `changes` message carries it: the
// records that are new or differ, and the keys of those that went away. Records are keyed as the
// protocol keys them: an agent by its id, an edit or read by agent and file, a wait by waiter and
// on, a report by its agent. The session is one record, sent whole when it changed.

import type { FactRemove, Facts, FactUpsert } from "@isoplan/protocol";

/** null when nothing changed. */
export function diffFacts(before: Facts, after: Facts): { upsert: FactUpsert; remove: FactRemove } | null {
  const upsert: FactUpsert = {};
  const remove: FactRemove = {};
  if (!same(before.session, after.session)) upsert.session = after.session;

  const agents = diff(before.agents, after.agents, (a) => a.id);
  if (agents.upsert.length) upsert.agents = agents.upsert;
  if (agents.remove.length) remove.agents = agents.remove.map((a) => a.id);

  for (const list of ["edits", "reads"] as const) {
    const d = diff(before[list], after[list], (f) => key(f.agent, f.file));
    if (d.upsert.length) upsert[list] = d.upsert;
    if (d.remove.length) remove[list] = d.remove.map(({ agent, file }) => ({ agent, file }));
  }

  const waits = diff(before.waits, after.waits, (w) => key(w.waiter, w.on));
  if (waits.upsert.length) upsert.waits = waits.upsert;
  if (waits.remove.length) remove.waits = waits.remove.map(({ waiter, on }) => ({ waiter, on }));

  const reports = diff(before.reports, after.reports, (r) => r.agent);
  if (reports.upsert.length) upsert.reports = reports.upsert;
  if (reports.remove.length) remove.reports = reports.remove.map((r) => r.agent);

  return Object.keys(upsert).length || Object.keys(remove).length ? { upsert, remove } : null;
}

function diff<T>(before: T[], after: T[], keyOf: (record: T) => string): { upsert: T[]; remove: T[] } {
  const old = new Map(before.map((r) => [keyOf(r), r]));
  const now = new Set(after.map(keyOf));
  return {
    upsert: after.filter((r) => !same(old.get(keyOf(r)), r)),
    remove: before.filter((r) => !now.has(keyOf(r))),
  };
}

const key = (...parts: string[]) => JSON.stringify(parts);

// The records are built the same way each pass, so their JSON compares them.
const same = (a: unknown, b: unknown) => a !== undefined && JSON.stringify(a) === JSON.stringify(b);
