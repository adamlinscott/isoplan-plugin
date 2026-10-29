---
description: Take an Isoplan handoff with its take code from the floor - checks out its branch here and loads its brief
argument-hint: <take code>
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/dist/handoff.js" take "$ARGUMENTS"`

The output above is the result of taking an Isoplan handoff in this session's folder. If it says the take was refused, tell me why and stop.

Otherwise you are taking this work over: read the brief above, which the person who handed it over had written for you. If the checkout failed, say so first. Then say where things stand and what you would do next, and wait for me before changing anything.
