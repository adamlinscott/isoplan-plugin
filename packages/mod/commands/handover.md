---
description: Hand this session's work over to someone in the Isoplan office, or to a new session of yours, with a brief you write; give it a new task of its own to make it a spin-off
argument-hint: <their name, or me for a new session of yours>[: a new task for it]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" prepare:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" hand-over:*), Write
---

Hand this session's work over, through Isoplan, to the person named here, with any new task for it after a colon: $ARGUMENTS

1. The name is everything before the first `:`, if there is one, and the new task is everything after it. A name is at most 80 characters of letters, digits, spaces and `. _ @ -`, starting with a letter or digit. If what is given above isn't, say so and stop without running anything. `me` hands it to a new session of my own, which opens with the brief and can ask this session questions: use `me` as the name in the steps below.
   If no task was given, ask me once whether the new session should carry on this work, or start a new task of its own, and if so what the task is. With a task this is a spin-off: the new session starts on that task, with a brief written for it, and can ask this session questions. Either way, this session carries on with what it was doing afterwards.
2. Run this, with the name in place of `<name>`:
   `node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" prepare --to "<name>"`
   With a task, add `--spin-off`: then it also names a task file.
   If it says it can't hand over from here, tell me why and stop. If it says more than one office takes this repo, ask me which of the offices it names to hand over in, then run it again with `--office "<label>"` added, using the label I picked.
3. With a task, first write the task to the task file it names, exactly as I gave it. Then write the brief it asks for, as Markdown, to the brief file it names. Never put a secret in it, and never paste the contents of an untracked or ignored file.
4. Run this, with the handoff id and brief file from step 2:
   `node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" hand-over --id <handoff id> --to "<name>" --brief "<brief file>"`
   With a task, add `--task "<task file>"`. If step 2 printed an `Office:` line, add the `--office "<label>"` it names.
   It checks with the office server first, then commits the tracked changes to the handoff's own branch, in this folder's repo and in each repo under it with work of its own, scans the brief and the commits for secrets, pushes that branch alone and sends the brief.
5. Tell me what it printed.
   - If the brief or the task matched a secret pattern, take that part out of the file it names and run step 4 again with the same id.
   - If what the push would send matched a secret pattern, nothing was pushed: tell me every file it names (by its path in this folder, so its repo too), and any it couldn't check, and ask me whether to take the secrets out or push anyway. Only when I say to push anyway, run step 4 again with every `--push-anyway` it printed (`<commit>`, or `<repo>=<commit>` for a repo under this folder), which pushes those exact commits, keeping any `--push-anyway` I agreed to before.
   - If it says some repos were pushed already before one failed, tell me which, and once that is fixed run step 4 again with the same id: it pushes the rest.
   - If it says this machine isn't paired, or its pairing has ended, tell me that and what it says to do, and stop.
