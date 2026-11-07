// What the fork is told, from the mod's prompts/ folder: instructions.md is turn 1, the same bytes
// on every run; question.md, brief.md or spin-off.md (a brief for a handoff with a task of its own)
// is turn 2, with {{from}}, {{question}}, {{to}} and {{task}} filled in.

import fs from "node:fs/promises";
import path from "node:path";

export interface Prompts {
  instructions: string;
  question: string;
  brief: string;
  spinOff: string;
}

export async function loadPrompts(dir: string): Promise<Prompts> {
  const read = async (name: string) => (await fs.readFile(path.join(dir, name), "utf8")).trim();
  return { instructions: await read("instructions.md"), question: await read("question.md"), brief: await read("brief.md"), spinOff: await read("spin-off.md") };
}

/** `template` with each {{key}} replaced by its value; an unknown key is left as it is. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? values[key]! : whole));
}
