// dist/pipe.js: the hooks module's end of the runner's pipe (main.ts).

import { runPipe } from "./main.js";

await runPipe(import.meta.url);
