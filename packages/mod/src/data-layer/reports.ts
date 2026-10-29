// The secret scan for reports (#59): an agent's final report is checked on the owner's machine,
// with the runner's scan (src/runner/scan.ts), before the session's facts go to the office server.
// A report that matches goes out as a placeholder, `withheld`, until its owner releases it from the
// floor: the server sends `release` on the session's link, with the agent's id. Patterns that
// can't be read withhold every report.
//
// A release is kept as the sha256 of the released text in <claude dir>/isoplan/released/
// <session>.json, so the report stays released when the data layer starts again, and a later,
// different report of the same agent is scanned afresh. The hashes never leave the machine.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Facts } from "@isoplan/protocol";
import { scan, type Pattern } from "../runner/scan.js";

/** What a withheld report says in place of its text. */
export const WITHHELD_TEXT = "Held for its owner to check: the secret check found what may be a secret in this report.";

export interface ReportHold {
  /** `facts` with each report the owner has yet to release, and that the scan matches, held. `patterns` is null when they couldn't be read. */
  apply(facts: Facts, patterns: Pattern[] | null): Facts;
  /** Releases the report of `agent` held at the last `apply`; false when none was. */
  release(agent: string): Promise<boolean>;
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export async function openReportHold(file: string, log: (text: string) => void): Promise<ReportHold> {
  const released = new Set(await readReleased(file));
  let held = new Map<string, string>(); // agent → the text of its held report
  const told = new Set<string>(); // the hashes of held reports already logged

  return {
    apply(facts, patterns) {
      held = new Map();
      const reports = facts.reports.map((report) => {
        const h = hash(report.text);
        if (released.has(h)) return report;
        const matched = patterns ? scan(report.text, patterns) : null;
        if (patterns && !matched) return report;
        held.set(report.agent, report.text);
        if (!told.has(h)) {
          told.add(h);
          log(`withheld the report of ${report.agent}: ${matched ? `it matches the secret pattern "${matched}"` : "the secret patterns couldn't be read"}; its owner can release it from the floor`);
        }
        return { agent: report.agent, at: report.at, text: WITHHELD_TEXT, withheld: true as const };
      });
      return held.size ? { ...facts, reports } : facts;
    },
    async release(agent) {
      const text = held.get(agent);
      if (text === undefined) {
        log(`the office server released the report of ${agent}, but no report of it is withheld here`);
        return false;
      }
      held.delete(agent);
      released.add(hash(text));
      log(`the report of ${agent} was released, so it is sent`);
      await fs
        .mkdir(path.dirname(file), { recursive: true })
        .then(() => fs.writeFile(file, JSON.stringify({ released: [...released] }) + "\n"))
        .catch((err: unknown) => log(`couldn't save the release of ${agent}'s report, so it is withheld again after a restart: ${(err as Error).message}`));
      return true;
    },
  };
}

async function readReleased(file: string): Promise<string[]> {
  try {
    const list = (JSON.parse(await fs.readFile(file, "utf8")) as { released?: unknown }).released;
    return Array.isArray(list) ? list.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}
