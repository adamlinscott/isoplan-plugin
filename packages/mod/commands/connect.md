---
description: Connect this computer's Claude Code to an Isoplan office with the link from its floor, or check which offices it is connected to
argument-hint: [isoplan://connect link]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/connect.js" --wait:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/connect.js" --status:*)
---

Connect Claude Code on this computer to Isoplan, with the link given here, if any: $ARGUMENTS

1. With nothing given above, run this, then tell me what it printed, in its own words, and stop:
   `node "${CLAUDE_PLUGIN_ROOT}/dist/connect.js" --status`
2. Otherwise the link starts with `isoplan://connect?` and has only letters, digits and `% . _ ~ : / ? = & + - *` in it, with no spaces or quotes. If what is given above isn't exactly that, say it isn't an Isoplan connect link, tell me to press Connect Claude Code on the Isoplan page for one, and stop without running anything.
3. Tell me in one short sentence that a window is opening on this computer asking me to connect, and to click **Connect** there. Then run this once, with the link in place of `<link>`, setting the command's timeout to 330000 ms, since it waits up to five minutes for my answer:
   `node "${CLAUDE_PLUGIN_ROOT}/dist/connect.js" --wait "<link>"`
   Don't run it again, or in the background.
4. Tell me what it printed, in its own words, and stop. Never show me anything from Isoplan's files on this computer.
