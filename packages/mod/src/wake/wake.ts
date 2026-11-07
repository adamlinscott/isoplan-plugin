// The wake hook's record (src/install): where the current data layer and runner are, or that it
// was uninstalled. Kept free of zod and the protocol so the hook starts fast.

import path from "node:path";

/** The record install writes beside wake.mjs: where the current data layer and runner are, or that it was uninstalled. */
export type WakeRecord = { dataLayer: string; runner?: string } | { disabled: true };

export const wakeRecordPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "wake.json");
