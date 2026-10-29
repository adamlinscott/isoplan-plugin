// The secret scan for reports (#59): an agent's final report is checked on the owner's machine,
// with the runner's scan (src/runner/scan.ts), before the session's facts go to the office server.
// A report that matches goes out as a placeholder, `withheld`, until its owner releases it from the
// floor: the server sends `release` on the session's link with the placeholder's hold id, a random
// id for that one text, so a release lets out only the report it names and a newer report of the
// same agent stays held. A hold id lasts while its report is held and the data layer runs; after a
// restart the placeholder carries a new one. Patterns that can't be read withhold every report.
//
// A release is kept as the sha256 of the released text in <claude dir>/isoplan/released/
// <session>.json, so the report stays released when the data layer starts again, and a later,
// different report of the same agent is scanned afresh. The hashes never leave the machine.

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Facts } from "@isoplan/protocol";
import { scan, type Pattern } from "../runner/scan.js";

/** What a withheld report says in place of its text. */
export const WITHHELD_TEXT = "Held for its owner to check: the secret check found what may be a secret in this report.";

export interface ReportHold {
  /** `facts` with each report the owner has yet to release, and that the scan matches, held. `patterns` is null when they couldn't be read. */
  apply(facts: Facts, patterns: Pattern[] | null): Facts;
  /** Releases the report held under hold id `id` at the last `apply`; false when none was. */
  release(id: string): Promise<boolean>;
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export async function openReportHold(file: string, log: (text: string) => void): Promise<ReportHold> {
  const released = new Set(await readReleased(file));
  let held = new Map<string, { agent: string; hash: string }>(); // hold id → the report held under it
  let ids = new Map<string, string>(); // the hash of a held text → its hold id, kept while it is held
  const told = new Set<string>(); // the hashes of held reports already logged

  return {
    apply(facts, patterns) {
      held = new Map();
      const kept = new Map<string, string>();
      const reports = facts.reports.map((report) => {
        const h = hash(report.text);
        if (released.has(h)) return report;
        const matched = patterns ? scan(report.text, patterns) : null;
        if (patterns && !matched) return report;
        const id = ids.get(h) ?? kept.get(h) ?? randomUUID();
        kept.set(h, id);
        held.set(id, { agent: report.agent, hash: h });
        if (!told.has(h)) {
          told.add(h);
          log(`withheld the report of ${report.agent}: ${matched ? `it matches the secret pattern "${matched}"` : "the secret patterns couldn't be read"}; its owner can release it from the floor`);
        }
        return { agent: report.agent, at: report.at, text: WITHHELD_TEXT, withheld: { id } };
      });
      ids = kept;
      return held.size ? { ...facts, reports } : facts;
    },
    async release(id) {
      const report = held.get(id);
      if (!report) {
        log(`the office server released the report held as ${id}, but none is held under that id here; it may have been replaced by a newer report, or the data layer restarted`);
        return false;
      }
      const { agent } = report;
      held.delete(id);
      released.add(report.hash);
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
