// The runner's caps (E6), set in runner.json: answers per room in the last hour, answers on this
// machine in the last day, and a token budget for this machine's last day. They are counted per
// machine: someone with two machines has two of each. The windows roll rather than reset at
// midnight.
//
// Tokens are counted as input-token equivalents: each kind is weighted by runner.json, since a
// cache write costs more than plain input and a cache read far less. A request is checked against
// the budget with an estimate made from the lead's context before it runs (#44: turn 1 may write
// the whole context to cache, then each turn reads it). The estimate is reserved in the ledger as
// the request passes, so requests in other rooms running at the same time count it, and is settled
// to what the fork actually used once it is done, or taken back when no fork ran at all. The ledger is kept in a file, so a restarted
// runner doesn't start the day over.

import fs from "node:fs/promises";
import path from "node:path";
import type { Usage } from "./answerer.js";

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/** What runner.json says about caps and how tokens are weighed. */
export interface CapSettings {
  answersPerRoomPerHour: number;
  answersPerMachinePerDay: number;
  tokenBudgetPerMachinePerDay: number;
  inputTokenWeight: number;
  cacheWriteTokenWeight: number;
  cacheReadTokenWeight: number;
  outputTokenWeight: number;
  estimatedOutputTokens: number;
}

/** One answer or brief the fork ran for, or is running for. */
export interface Entry {
  at: number;
  room: string;
  usage: Usage;
}

/** The caps by the names the protocol gives them. */
export type Cap = "room-hour" | "owner-day" | "owner-tokens";

/** The tokens `usage` counts for against the budget. */
export function weighted(usage: Usage, s: CapSettings): number {
  return usage.input * s.inputTokenWeight + usage.cacheWrite * s.cacheWriteTokenWeight + usage.cacheRead * s.cacheReadTokenWeight + usage.output * s.outputTokenWeight;
}

/** The most a fork of a lead with this context is expected to use: a cold cache, read by both turns. */
export function estimate(context: number, s: CapSettings): Usage {
  return { input: 0, output: s.estimatedOutputTokens, cacheWrite: context, cacheRead: 2 * context };
}

/** The cap one more answer in `room`, expected to use `expected`, would go over, or null. */
export function overCap(entries: Entry[], room: string, expected: Usage, now: number, s: CapSettings): Cap | null {
  const day = entries.filter((e) => now - e.at < DAY_MS);
  if (day.filter((e) => e.room === room && now - e.at < HOUR_MS).length >= s.answersPerRoomPerHour) return "room-hour";
  if (day.length >= s.answersPerMachinePerDay) return "owner-day";
  const spent = day.reduce((sum, e) => sum + weighted(e.usage, s), 0);
  if (spent + weighted(expected, s) > s.tokenBudgetPerMachinePerDay) return "owner-tokens";
  return null;
}

export interface Reservation {
  settle(usage: Usage): Promise<void>;
  cancel(): Promise<void>;
}

export interface Ledger {
  /** The entries of the last day, reserved ones among them. */
  entries(now: number): Entry[];
  /**
   * Counts `entry` at once. `settle` sets it to the usage it turned out to have; `cancel` takes it
   * out again, answer and tokens both. Call it straight after checking `overCap`, with no await
   * between, so no other request slips in.
   */
  reserve(entry: Entry): Reservation;
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
  let writing = Promise.resolve();
  const save = () => {
    const text = JSON.stringify(entries) + "\n";
    writing = writing.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}`;
      await fs.writeFile(temp, text);
      await fs.rename(temp, file);
    });
    return writing;
  };
  return {
    entries: recent,
    reserve(entry) {
      const held = { ...entry };
      entries = [...recent(entry.at), held];
      void save().catch(() => {});
      return {
        settle(usage) {
          held.usage = usage;
          return save();
        },
        cancel() {
          entries = entries.filter((e) => e !== held);
          return save();
        },
      };
    },
  };
}

const isEntry = (e: unknown): e is Entry => {
  const o = e as Entry | null;
  return !!o && typeof o.at === "number" && typeof o.room === "string" && !!o.usage && ["input", "output", "cacheRead", "cacheWrite"].every((k) => Number.isFinite(o.usage[k as keyof Usage]));
};
