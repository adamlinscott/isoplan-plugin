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
   It checks with the office server first, then commits the tracked changes to the handoff's own branch, scans the brief and the commit for secrets, pushes that branch alone and sends the brief.
5. Tell me what it printed.
   - If the brief matched a secret pattern, take that part out of the file and run step 4 again with the same id.
   - If the commit's added lines in a file matched a secret pattern, nothing was pushed: tell me the file and ask me whether to take the secret out or push anyway. Add `--push-anyway` to step 4 only when I say to.
