// What the fork is told, from the mod's prompts/ folder: instructions.md is turn 1, the same bytes
// on every run; question.md and brief.md are turn 2, with {{from}}, {{question}} and {{to}} filled in.

import fs from "node:fs/promises";
import path from "node:path";

export interface Prompts {
  instructions: string;
  question: string;
  brief: string;
}

export async function loadPrompts(dir: string): Promise<Prompts> {
  const read = async (name: string) => (await fs.readFile(path.join(dir, name), "utf8")).trim();
  return { instructions: await read("instructions.md"), question: await read("question.md"), brief: await read("brief.md") };
}

/** `template` with each {{key}} replaced by its value; an unknown key is left as it is. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? values[key]! : whole));
}
