// The secret scan (E8): every answer and brief is checked on the owner's machine, before it leaves,
// against the patterns in the mod's secret-patterns.json and any the owner adds in
// ~/.claude/isoplan/secret-patterns.json. The owner's file only adds: a pattern of the mod's can't be
// taken out there. Each pattern is `{ "name", "regex", "flags"? }`, the regex in JavaScript's syntax
// and the flags any of i, m, s and u. One that doesn't compile is skipped with a log line in the
// owner's file, and is an error in the mod's.

import fs from "node:fs/promises";

export interface Pattern {
  name: string;
  regex: RegExp;
}

/** The patterns in `file`; [] when an optional file is missing. */
async function readPatterns(file: string, optional: boolean, log: (text: string) => void): Promise<Pattern[]> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (!optional) throw err;
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") log(`${file} isn't valid JSON, so its secret patterns aren't used`);
    return [];
  }
  const list = (value as { patterns?: unknown } | null)?.patterns;
  if (!Array.isArray(list)) {
    if (!optional) throw new Error(`${file} has no "patterns" list`);
    log(`${file} has no "patterns" list, so it adds none`);
    return [];
  }
  const out: Pattern[] = [];
  for (const p of list as { name?: unknown; regex?: unknown; flags?: unknown }[]) {
    const name = typeof p?.name === "string" && p.name ? p.name : String(p?.regex);
    try {
      if (typeof p?.regex !== "string" || !p.regex) throw new Error("no regex");
      const flags = typeof p.flags === "string" ? p.flags : "";
      if (!/^[imsu]*$/.test(flags)) throw new Error(`flags "${flags}" aren't any of i, m, s and u`);
      out.push({ name, regex: new RegExp(p.regex, flags) });
    } catch (err) {
      if (!optional) throw new Error(`${file}: the secret pattern "${name}" doesn't compile: ${(err as Error).message}`);
      log(`${file}: the secret pattern "${name}" is skipped: ${(err as Error).message}`);
    }
  }
  return out;
}

/** The mod's patterns and the owner's. */
export async function loadPatterns(modFile: string, ownerFile: string, log: (text: string) => void): Promise<Pattern[]> {
  return [...(await readPatterns(modFile, false, log)), ...(await readPatterns(ownerFile, true, log))];
}

/** The name of the first pattern `text` matches, or null when it matches none. */
export function scan(text: string, patterns: Pattern[]): string | null {
  return patterns.find((p) => p.regex.test(text))?.name ?? null;
}
