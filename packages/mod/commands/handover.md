---
description: Hand this session's work over to someone in the Isoplan office, with a brief you write
argument-hint: <their name>
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" prepare:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" hand-over:*), Write
---

Hand this session's work over, through Isoplan, to the person named here: $ARGUMENTS

1. A name is at most 80 characters of letters, digits, spaces and `. _ @ -`, starting with a letter or digit. If what is given above isn't, say so and stop without running anything.
2. Run this, with the name in place of `<name>`:
   `node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" prepare --to "<name>"`
   If it says it can't hand over from here, tell me why and stop.
3. Write the brief it asks for, as Markdown, to the brief file it names. Never put a secret in it, and never paste the contents of an untracked or ignored file.
4. Run this, with the handoff id and brief file from step 2:
   `node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" hand-over --id <handoff id> --to "<name>" --brief "<brief file>"`
   It checks with the office server first, then commits the tracked changes to the handoff's own branch, in this folder's repo and in each repo under it with work of its own, scans the brief and the commits for secrets, pushes that branch alone and sends the brief.
5. Tell me what it printed.
   - If the brief matched a secret pattern, take that part out of the file and run step 4 again with the same id.
   - If what the push would send matched a secret pattern, nothing was pushed: tell me every file it names (by its path in this folder, so its repo too), and any it couldn't check, and ask me whether to take the secrets out or push anyway. Only when I say to push anyway, run step 4 again with every `--push-anyway` it printed (`<commit>`, or `<repo>=<commit>` for a repo under this folder), which pushes those exact commits, keeping any `--push-anyway` I agreed to before.
   - If it says some repos were pushed already before one failed, tell me which, and once that is fixed run step 4 again with the same id: it pushes the rest.
   - If it says this machine isn't paired, or its pairing has ended, tell me that and what it says to do, and stop.
