// Bundles the hooks module and the data layer into dist/, each one ESM file with protocol and zod
// inlined, so the plugin runs from a git checkout with no install step, plus the repo sweep, the
// wake hook (which install copies into the config folder), the install script, the runner and the
// handoff commands' script.
// dist/ is committed: rebuild it with every change to src/.

import { build } from "rolldown";

const common = { platform: "node", cwd: import.meta.dirname, logLevel: "warn" };
const output = { format: "esm", codeSplitting: false, sourcemap: false };

await build([
  { ...common, input: "src/hooks/register.ts", output: { ...output, file: "dist/hooks.js" } },
  { ...common, input: "src/data-layer/main.ts", output: { ...output, file: "dist/data-layer.js" } },
  { ...common, input: "src/sweep/main.ts", output: { ...output, file: "dist/sweep.js" } },
  { ...common, input: "src/wake/main.ts", output: { ...output, file: "dist/wake.js" } },
  { ...common, input: "src/install/main.ts", output: { ...output, file: "dist/install.js" } },
  { ...common, input: "src/runner/main.ts", output: { ...output, file: "dist/runner.js" } },
  { ...common, input: "src/handoff/main.ts", output: { ...output, file: "dist/handoff.js" } },
]);
