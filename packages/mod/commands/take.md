---
description: Take an Isoplan handoff with its take code from the floor - checks out its branch here and loads its brief
argument-hint: <take code> [--office <office>]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" take:*)
---

Take the Isoplan handoff whose take code is given here: $ARGUMENTS

1. A take code is eight characters, written like `ABCD-EFGH`: only the letters A to Z without I and O, and the digits 2 to 9, with one dash in the middle or none. It may be followed by `--office` and the office it comes from: a name or a server's address or host, of letters, digits and `. : / _ -` only. If what is given above isn't exactly that, say it isn't a take code and stop without running anything.
2. Otherwise run this, with the code in place of `<code>`, adding `--office "<office>"` when one was given:
   `node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" take <code>`
3. Its output is the result of taking the handoff in this session's folder, and in the repos under it when the handoff has several. If it says the take was refused, or that this machine isn't paired or its pairing has ended, tell me why and what it says to do, and stop.
4. Otherwise you are taking this work over: read the brief in that output, which the person who handed it over had written for you. If a checkout failed (for any repo), or the output says the repo's setup script hasn't been run, say so first. Then say where things stand and what you would do next, and wait for me before changing anything.
   If the output says it is a spin-off, you are starting the new task it gives, not taking the work over: read the task first, then the brief written for it, and say what you take the task to be and what you would do first.
