---
description: Hand this session's work over to someone in the Isoplan office, with a brief you write
argument-hint: <their name>
allowed-tools: Bash(node:*), Write
---

!`node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" prepare --to "$ARGUMENTS"`

You are handing this session's work over to $ARGUMENTS through Isoplan. If the output above says it can't hand over from here, tell me why and stop.

Otherwise:

1. Write the brief the output above asks for, as Markdown, to the brief file it names. Never put a secret in it, and never paste the contents of an untracked or ignored file.
2. Run this, with the handoff id and brief file from the output above:
   `node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" hand-over --id <handoff id> --to "$ARGUMENTS" --brief "<brief file>"`
   It commits the tracked changes to the handoff's own branch, pushes that branch alone, checks the brief for secrets and sends it.
3. Tell me what it printed. If the brief matched a secret pattern, take that part out of the file and run step 2 again with the same id.
