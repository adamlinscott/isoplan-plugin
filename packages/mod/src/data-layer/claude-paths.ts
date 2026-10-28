// Where Claude Code keeps its config, apart from identity.ts so the install script can find it
// without bundling the protocol and zod.

import { join, normalize } from "./git.js";

/**
 * Claude Code's config folder and its .claude.json: both in $CLAUDE_CONFIG_DIR when it is set,
 * else ~/.claude and ~/.claude.json, where Claude Code itself looks.
 */
export function claudePaths(env: Record<string, string | undefined>, home: string): { dir: string; json: string } {
  const custom = env.CLAUDE_CONFIG_DIR;
  return custom ? { dir: normalize(custom), json: join(custom, ".claude.json") } : { dir: join(home, ".claude"), json: join(home, ".claude.json") };
}
