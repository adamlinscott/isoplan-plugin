# Isoplan plugin

Isoplan is a live view of every agent working across a team, drawn as an office floor. This repo holds the open part of it: the Claude Code plugin that streams each session's facts to a team's office server, and the wire protocol between them. Both are MIT, so anyone can check exactly what runs on their machine and what it sends.

The office server and the floor are a separate, proprietary product.

## Install the plugin

This repo is a Claude Code plugin marketplace. In Claude Code:

```
/plugin marketplace add adamlinscott/isoplan-plugin
/plugin install isoplan@isoplan
```

Then point it at your office server: set `server` in `~/.claude/isoplan/config.json`, for example `{ "server": "wss://your-office.example/data-layer" }`. Any key in that file overrides the plugin's defaults in `packages/mod/config.json`.

The plugin needs Node.js on `PATH`. When it first starts it puts a small hook in your `~/.claude/settings.json` (on `UserPromptSubmit` and `Stop`), so sessions that don't load the plugin are seen too, and copies the runner (below) into `~/.claude/isoplan/`.

### Pairing this machine

An office server that signs people in reports a machine only once someone has paired it. The first time a session reports, Claude Code's status line and transcript show a code and a link, such as `https://your-office.example/#pair=ABCD-2345`. Open the link while signed in to the office (or choose **Pair a machine** on the floor and type the code), check the Claude account and machine it names, and approve it. Within a few seconds the session reports as you; nothing needs typing in a terminal. A session the plugin doesn't run in, and the runner, write the same code to their logs.

The machine's credential, and its access token, are kept in `~/.claude/isoplan/pairing.json` (in `$CLAUDE_CONFIG_DIR/isoplan/` when that is set), readable by you only (on Windows it takes the folder's permissions). It is for one office server and one Claude account: pointing `server` elsewhere, or signing in to Claude as someone else, pairs again. The token lasts about an hour and is renewed on its own. If the pairing is revoked on the floor, or lapses after 30 days without the machine connecting, the next session shows a new code. Deleting the file unpairs the machine on this side; revoke it on the floor too.

## Disable or uninstall

Claude Code runs nothing of a plugin's when you disable or uninstall it, so the hook in your settings looks for itself, each time a session takes a prompt, at what Claude Code records: `installed_plugins.json`, and `enabledPlugins` in your settings, the project's settings and a `managed-settings.json` file (not managed settings from MDM or the claude.ai console, which it can't read). The project is the session's `CLAUDE_PROJECT_DIR`, or its folder. An install at project or local scope counts only for that project's sessions.

**Disable** it (`/plugin disable isoplan@isoplan`, the plugin manager, or `claude plugin disable`) and reporting stops: the hook stops the runner and starts nothing, and the sessions' data layers stop. Every file stays, the pairing credential too. Disabled in one project only, that project's sessions aren't reported. Enable it again and the next prompt starts them again.

**Uninstall** it (`/plugin uninstall isoplan@isoplan`, the plugin manager, or `claude plugin uninstall isoplan@isoplan`) and, the next time a session takes a prompt, the hook takes everything out in the background. That happens only once Claude Code lists no install of `isoplan` at all, from any marketplace and at any scope, and no folder in `CLAUDE_CODE_PLUGIN_DIRS` holds it, so moving to another marketplace isn't an uninstall. A copy you load with `--plugin-dir` leaves nothing it can find, so remove the marketplace install only once you no longer want it. What it takes out:

- the runner, which it stops;
- what the plugin wrote in `~/.claude/isoplan/`: the runner's copy and its records (`runner/`: the app, `environment.json`, the ledger, the lock), the machine's pairing credential (`pairing.json`), the session locks (`live/`), the logs (`logs/`), the title files (`titles/`), the hashes of reports you released (`released/`), and `claude-binary.json` unless you set it by hand;
- last, the hook in `~/.claude/settings.json` (every other hook and setting is kept), the hook script and its record (`wake.mjs`, `wake.json`), and the uninstall's own lock and log (`uninstall.json`, `uninstall.log`).

The files you write are kept: `config.json`, `runner.json`, `secret-patterns.json`, and a `claude-binary.json` you set by hand, so a reinstall picks them up again. Delete `~/.claude/isoplan/` yourself to take those too; once nothing is left in it, uninstall removes the folder.

It asks Claude Code before each step whether the plugin is still uninstalled, and stops if you installed it again. A session that already had the plugin loaded stops reporting, but Claude Code keeps the plugin loaded there until the session ends or you run `/reload-plugins`; if it wrote its files again meanwhile, the hook stays and the next prompt finishes the job. If it can't finish while the hook is still in place, for example because `settings.json` doesn't parse, it says why in `~/.claude/isoplan/uninstall.log` and the hook tries again a day later; delete `~/.claude/isoplan/uninstall.json` to have the next prompt try at once. If a step fails after the hook has gone, nothing is left to try again: what remains of `~/.claude/isoplan/` stays until you delete it, or until you install the plugin again, which clears it.

Two things it can't help:

- It writes `settings.json` whole, as Claude Code does, and there is no lock to share with Claude Code, so a change Claude Code writes to that file at the same moment can be lost. Check the file if you changed a setting right then.
- A session that was open when the hook went may still run it until that session restarts, and shows Claude Code's non-blocking hook error each turn, since `wake.mjs` has gone.

From a checkout, `pnpm isoplan-uninstall` takes out the same things at once, and leaves `~/.claude/isoplan/wake.json` as `{ "disabled": true }` (written before the hook comes out), so the plugin, if it is still installed, doesn't put the hook back when it next starts, and finishes anything the uninstall left; `pnpm isoplan-install` takes that away. An install waits for an uninstall that is still running.

## The runner

Each machine runs one runner (`packages/mod/dist/runner.js`, which install copies to `~/.claude/isoplan/runner/app/dist/runner.mjs` with its defaults beside it, so a plugin update doesn't delete the files it runs from), which answers the office server's questions and handoff briefs for the machine's rooms. It answers from a fork of the room's lead session: a one-off `claude -p --resume --fork-session` with no tools, no MCP servers and no settings files, which is never saved. Install, the plugin and the wake hook start it, a newer copy replaces an older one as it starts, and it stops once every room on the machine has gone lights-off. Before an answer or brief leaves the machine, it is checked for secrets, and one that matches is withheld until you release it from the floor.

The runner reads these files. Each file in `~/.claude/isoplan/` is optional:

| File | What |
|---|---|
| `packages/mod/runner.json`, overridden per key by `~/.claude/isoplan/runner.json` | The fork's model (`claudeModel`, Opus by default); the caps on answers per room per hour and per machine per day; the machine's daily token budget, and the weight of each kind of token in it (a cache write costs more than plain input, a cache read far less); the timeouts, including git's for a handoff (`gitTimeoutSeconds`) and a worktree setup script's default (`setupTimeoutMinutes`); and how far back the runner looks for your clone of a repo (`cloneSearchDays`). |
| `packages/mod/secret-patterns.json`, plus `~/.claude/isoplan/secret-patterns.json` | The secret scan's patterns, as `{ "patterns": [{ "name", "regex", "flags"? }] }`. Your file adds patterns; it can't remove the plugin's. While your file can't be read, or has a pattern that doesn't compile, every answer, brief and report is held. |
| `packages/mod/prompts/` | What the fork is told: `instructions.md` first, the same every time so the lead's context is reused from cache, then `question.md` or `brief.md`. |
| `~/.claude/isoplan/claude-binary.json` | The `claude` binary the fork runs, `{ "path": "..." }`, which install finds and records. Set it by hand if install can't find it; a path set by hand, without `"auto": true`, is kept by later installs. |

The caps are counted on each machine: someone with two machines has two of each.

The runner starts with an environment recorded from the shell that ran the install script, in `~/.claude/isoplan/runner/environment.json`, never with the environment of the session that happened to start it, so a project's settings `env` block can't reach it or its forks. Only the operating system's basics, proxy and certificate settings, and the login and provider variables (`ANTHROPIC_*`, Bedrock, Vertex, `AWS_*`, Google Cloud's, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`) are recorded. You can edit the file; the install script writes it again each time it runs, and uninstall removes it. Without it (installed only through the plugin, or before it existed) the runner uses its starter's environment and says so in its log.

The fork reads no settings files, so a login or proxy that comes from `settings.json` (an `apiKeyHelper`, or an `env` block) doesn't reach it, and its rooms say they can't answer. Claude Code's own login and auth from environment variables (an API key, Bedrock, Vertex) work.

Its log is `~/.claude/isoplan/logs/runner.log`, and its count of answers and tokens for the last day is in `~/.claude/isoplan/runner/ledger.json`.

## Handoffs

A room is handed over from the floor (the room panel's Hand over) or, in the session, with `/isoplan:handover <their name>`. Either way the tracked changes go in a work-in-progress commit made from your current branch without touching your work tree or index, and only that commit is pushed, to `isoplan/handoff/<id>` on the remote your branch pushes to (`branch.<name>.pushRemote`, `remote.pushDefault`, then its upstream): never your current branch, never the default one, and no local branch is made. That keeps a handoff from deploying anything as long as your CI doesn't build `isoplan/handoff/*` branches, so leave them out of it. Tracked files go over, whatever `.gitignore` says; untracked files stay behind and the brief names them, except those `.gitignore` matches, which are never mentioned. From the floor your runner's fork writes the brief and git runs in the background, with no prompts, none of your git hooks, no commit signing, and under `gitTimeoutSeconds`; with the command, your session's own agent writes it. The brief is scanned for secrets before it leaves, and so is everything the push would send: the lines added by each commit the remote doesn't have yet, local commits included. On a match nothing is pushed; the floor says which file holds a possible secret (never the pattern) and names any binary files the scan couldn't read, and you can fix it, or push anyway, which pushes the exact commit that was held. A repo that uses Git LFS is refused, since its files wouldn't go with their pointers.

The receiver takes it with the room panel's Take handoff, which asks how: open it in a terminal, open it as a headless session, or copy a prompt. The first two have their runner find their clone (the folder, most recently used first, of one of their Claude Code sessions whose fetch or push URL is the handoff's remote), add a worktree beside it, `<clone>-handoff-<id>`, on the handoff's branch, with the repo's git hooks off, run the repo's setup script, then start Claude Code there, told to read the brief, which is kept in `~/.claude/isoplan/handoffs/<id>/`. In a terminal is the only path that opens a window (on Windows through `start`, a Windows Terminal tab where that is the default; on a Mac, Terminal), and only when that is what was asked. Headless starts a background session, `claude --bg`, with no window, which you open with `claude attach` and which `claude agents` lists; Claude Code runs one only in a folder it trusts, so this records trust for that worktree alone in `.claude.json`, and the floor says so before you choose it: the worktree's Claude settings, hooks and setup scripts will run. A worktree from an earlier take moves to the branch as handed over now, unless it holds work of yours that isn't in it (changes to tracked files, or a commit that is neither in the new tip nor one this machine took of the handoff before): then it is left alone and the take says why. A failed setup script doesn't stop the session opening; any step that fails is shown in the room with the end of its output, scanned for secrets. The copied prompt is `/isoplan:take <code>` for a session you already have: it checks the branch out in that session's folder, refusing a folder with uncommitted changes, and moving a local branch of that name to the new tip, never over commits of yours, and loads the brief. No setup script runs there, since you or your harness set that folder up; when the repo has one, the agent is told it hasn't run.

The setup script is set once per repo, in `isoplan.json` at its top, committed:

```json
{
  "worktreeSetup": {
    "about": "Runs in each new worktree Isoplan makes when someone takes a handoff from the floor.",
    "command": "pnpm install",
    "timeoutMinutes": 15
  }
}
```

`command` is one command, or `{ "windows": "...", "mac": "..." }`. It runs with the system shell (cmd.exe on Windows, /bin/sh on a Mac), hidden, in the new worktree, with `ISOPLAN_HANDOFF_ID` and `ISOPLAN_HANDOFF_BRANCH` set. It is read only from the remote's default branch, as your clone fetches it, never from the handoff's branch or whatever your clone has checked out; when the default branch can't be told, setup is skipped and the room says why.

## What leaves your machine

By default only facts: which sessions and agents are running and what kind of work each is doing, in which repository and branch, which files they touched, and when they wait. Session-derived text leaves only in named cases, each kept by the server for a set period and then deleted: an agent's final report, questions an agent asks its owner, and the questions, answers and briefs in a room that was handed over. A report is checked for secrets on your machine before it is sent, as answers and briefs are. One that matches stays a placeholder, a note saying it is held, until you release it; releasing it from the floor arrives with adamlinscott/isoplan#50. A pattern you add after a report went out can't recall it.

## What is here

| Path | What |
|---|---|
| `packages/mod/commands/` | The plugin's commands, `/isoplan:handover` and `/isoplan:take`, which run `dist/handoff.js`. |
| `packages/mod/` | The Claude Code plugin. Its bundle in `dist/` is committed, so the plugin runs from a checkout with no install step; rebuild it with every change to `src/`. |
| `packages/protocol/` | The wire protocol, published to npm as [`@isoplan/protocol`](https://www.npmjs.com/package/@isoplan/protocol). |
| `.claude-plugin/marketplace.json` | The marketplace listing. |

## Develop

Needs Node 22.13+ and pnpm.

```
pnpm install
pnpm build        # protocol to dist/, plugin bundle to packages/mod/dist/
pnpm test
pnpm sweep        # run the repo sweep from the built plugin
pnpm isoplan-install / pnpm isoplan-uninstall
```

## Release

The plugin's version is in three places, kept the same: `packages/mod/.claude-plugin/plugin.json`, its entry in `.claude-plugin/marketplace.json`, and `packages/mod/package.json`. Claude Code installs and updates by that version, so users get new commits only once it changes: bump all three, rebuild `dist/`, and commit.

To release the protocol, set its version in `packages/protocol/package.json`, and publish a GitHub release for the tag `protocol-v<version>`, such as `protocol-v0.3.0`. That runs `.github/workflows/publish-protocol.yml`, which fails unless the tag matches the package's version, waits for approval if the `npm-publish` environment asks for it, and publishes `@isoplan/protocol` to npm unless that version is there already. It uses npm trusted publishing, so no npm token is stored in the repository, and each version carries a provenance statement. Releases for other tags publish nothing.

Earlier history of both packages is in Isoplan's private repository.

## Licence

MIT (see `LICENSE`).
