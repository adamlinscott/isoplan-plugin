// The runner's caps (E6), set in runner.json: answers per room in the last hour, answers by this
// machine's owner in the last day, and a token budget for the owner's last day. The windows roll
// rather than reset at midnight.
//
// Tokens are counted as input-token equivalents: each kind is weighted by runner.json, since a
// cache write costs more than plain input and a cache read far less. A request is checked against
// the budget with an estimate made from the lead's context before it runs (#44: turn 1 may write
// the whole context to cache, then each turn reads it), and what the fork actually used is what is
// recorded. The ledger is kept in a file, so a restarted runner doesn't start the day over.

import fs from "node:fs/promises";
import path from "node:path";
import type { Usage } from "./answerer.js";

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/** What runner.json says about caps and how tokens are weighed. */
export interface CapSettings {
  answersPerRoomPerHour: number;
  answersPerOwnerPerDay: number;
  tokenBudgetPerOwnerPerDay: number;
  inputTokenWeight: number;
  cacheWriteTokenWeight: number;
  cacheReadTokenWeight: number;
  outputTokenWeight: number;
  estimatedOutputTokens: number;
}

/** One answer or brief the fork ran for. */
export interface Entry {
  at: number;
  room: string;
  usage: Usage;
}

export type Cap = "room-hour" | "owner-day" | "owner-tokens";

/** The tokens `usage` counts for against the budget. */
export function weighted(usage: Usage, s: CapSettings): number {
  return usage.input * s.inputTokenWeight + usage.cacheWrite * s.cacheWriteTokenWeight + usage.cacheRead * s.cacheReadTokenWeight + usage.output * s.outputTokenWeight;
}

/** The most a fork of a lead with this context is expected to use: a cold cache, read by both turns. */
export function estimate(context: number, s: CapSettings): Usage {
  return { input: 0, output: s.estimatedOutputTokens, cacheWrite: context, cacheRead: 2 * context };
}

/** The answer-count cap one more answer in `room` would go over, or null. */
export function countCap(entries: Entry[], room: string, now: number, s: CapSettings): Cap | null {
  if (entries.filter((e) => e.room === room && now - e.at < HOUR_MS).length >= s.answersPerRoomPerHour) return "room-hour";
  if (entries.filter((e) => now - e.at < DAY_MS).length >= s.answersPerOwnerPerDay) return "owner-day";
  return null;
}

/** Whether `expected` on top of the last day's tokens goes over the budget. */
export function overBudget(entries: Entry[], expected: Usage, now: number, s: CapSettings): boolean {
  const spent = entries.filter((e) => now - e.at < DAY_MS).reduce((sum, e) => sum + weighted(e.usage, s), 0);
  return spent + weighted(expected, s) > s.tokenBudgetPerOwnerPerDay;
}

export interface Ledger {
  /** The entries of the last day. */
  entries(now: number): Entry[];
  add(entry: Entry): Promise<void>;
}

/** The ledger in `file`; one that is missing or doesn't parse starts empty. */
export async function openLedger(file: string): Promise<Ledger> {
  let entries: Entry[] = [];
  try {
    const value: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (Array.isArray(value)) entries = value.filter(isEntry);
  } catch {
    // Nothing recorded yet.
  }
  const recent = (now: number) => entries.filter((e) => now - e.at < DAY_MS);
  return {
    entries: recent,
    async add(entry) {
      entries = [...recent(entry.at), entry];
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}`;
      await fs.writeFile(temp, JSON.stringify(entries) + "\n");
      await fs.rename(temp, file);
    },
  };
}

const isEntry = (e: unknown): e is Entry => {
  const o = e as Entry | null;
  return !!o && typeof o.at === "number" && typeof o.room === "string" && !!o.usage && ["input", "output", "cacheRead", "cacheWrite"].every((k) => Number.isFinite(o.usage[k as keyof Usage]));
};
