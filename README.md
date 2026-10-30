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

### Updates

The plugin keeps itself up to date with each release (see Release): Claude Code installs a new copy only when the version in the plugin's `plugin.json` changes. As a session starts (unless a session on the machine checked in the last ten minutes) and every `updateCheckHours` (6) after that, the plugin runs `claude plugin marketplace update isoplan`, then `claude plugin update isoplan@isoplan --scope <scope>` for each scope it is installed at (a project's in that project's folder), in the background, hidden, with the `claude` binary the runner uses, one check at a time on the machine (`~/.claude/isoplan/update.json` and `update.lock`). The commands never prompt: git asks for no password and opens no credential window, ssh runs in batch mode, and a command still running after five minutes is stopped with everything it started. It also turns on Claude Code's own auto-update for the marketplace, by adding `"autoUpdate": true` to the `isoplan` entry under `extraKnownMarketplaces` in your `~/.claude/settings.json`, the entry `/plugin marketplace add` wrote; it leaves an entry that says `"autoUpdate": false`, adds no entry that isn't there, and uninstall takes out only what it added.

A running session keeps the version it loaded, so once a newer one is on disk the status line says **Isoplan updated: type /reload-plugins** beside the link's state; Claude Code doesn't let a plugin reload itself, or run a command from a click on the status line. Newer means the newest version installed at any scope, counted only once Claude Code has written its folder whole. After the reload the new version's data layer reports the session and the old one's stops; the new one copies its runner into place, which replaces the running one, and records itself for the wake hook. A session left on an older version reports as before but leaves those alone, and the wake hook starts the newest version for sessions without the plugin. A new session loads the new version at once. If Claude Code has cleaned up the old version's folder before you reload, the plugin stops reporting that session and the status line just says to reload.

Set `updateCheckHours` to `0` in `~/.claude/isoplan/config.json` to stop the checks. Nothing is checked while the plugin is disabled for the machine, or while `DISABLE_UPDATES`, `DISABLE_AUTOUPDATER` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set, as with Claude Code's own plugin updates, unless `FORCE_AUTOUPDATE_PLUGINS=1` is set too. A plugin loaded from a folder (a checkout, `--plugin-dir`, or a marketplace added from a local path, which Claude Code loads in place) isn't updated: it runs whatever is in the folder.

The plugin needs Node.js on `PATH`. When it first starts it puts a small hook in your `~/.claude/settings.json` (on `UserPromptSubmit` and `Stop`), so sessions that don't load the plugin are seen too, and copies the runner (below) into `~/.claude/isoplan/`.

### Pairing this machine

An office server that signs people in reports a machine only once someone has paired it, and what the machine reports is then that person's. The first time a session starts and reads which repos the office takes, Claude Code's status line shows a **Pair this machine** link, such as `https://your-office.example/#pair=...`, and the transcript shows it once per session start. Click it on this computer: the office asks you to sign in if you aren't, shows the machine, the Claude account it names and when it asked, and you approve it. Your browser is then sent back to this machine, to `http://127.0.0.1:<port>/...`, where the data layer that asked is listening, and it finishes pairing there with a secret it never sent. A link sent to someone else can't pair your machine to them, or theirs to you. The plugin never opens a browser itself, and nothing needs typing in a terminal. A session the plugin doesn't run in, and the runner, write the same link to their logs.

The machine's credentials and access tokens are kept in `~/.claude/isoplan/pairing.json` (in `$CLAUDE_CONFIG_DIR/isoplan/` when that is set), with a random id the machine makes for itself the first time and one entry per Claude account, readable by you only (on Windows it takes the folder's permissions). `pairing.write.lock` beside it is held while the file is changed, and `pairing.lock` names the one process answering a link while one waits to be clicked. Pointing `server` elsewhere pairs that account again. The token lasts about an hour and is renewed on its own, and the link reconnects at once when the office closes it as the token runs out. If the pairing is revoked on the floor, or lapses after 30 days without the machine connecting, the next session shows a new link. Deleting the file unpairs the machine on this side; revoke it on the floor too.

A session belongs to the person whose machine first reported it. If the office says it belongs to someone else, the status line says so and the session isn't reported; it asks again an hour later, in case an admin released it.

A credential is never sent over plain `ws://` to another machine: such a `server` isn't used, and the status line says why, unless config.json sets `"allowPlainWs": true`, which sends facts and credentials unencrypted.

One limit can't be designed out: a process already running as you on this machine could start a pairing of its own and show you its link. Approve only a pairing you started on this computer.

A machine with no browser (a headless server) can't be paired yet.

## Disable or uninstall

Claude Code runs nothing of a plugin's when you disable or uninstall it, so the hook in your settings looks for itself, each time a session takes a prompt, at what Claude Code records: `installed_plugins.json`, and `enabledPlugins` in your settings, the project's settings and a `managed-settings.json` file (not managed settings from MDM or the claude.ai console, which it can't read). The project is the session's `CLAUDE_PROJECT_DIR`, or its folder. An install at project or local scope counts only for that project's sessions.

**Disable** it (`/plugin disable isoplan@isoplan`, the plugin manager, or `claude plugin disable`) and reporting stops: the hook stops the runner and starts nothing, and the sessions' data layers stop. Every file stays, the pairing credential too. Disabled in one project only, that project's sessions aren't reported. Enable it again and the next prompt starts them again.

**Uninstall** it (`/plugin uninstall isoplan@isoplan`, the plugin manager, or `claude plugin uninstall isoplan@isoplan`) and, the next time a session takes a prompt, the hook takes everything out in the background. That happens only once Claude Code lists no install of `isoplan` at all, from any marketplace and at any scope, and no folder in `CLAUDE_CODE_PLUGIN_DIRS` holds it, so moving to another marketplace isn't an uninstall, and Claude Code's records must still say so five seconds later, so an update rewriting them isn't one either. A copy you load with `--plugin-dir` leaves nothing it can find, so remove the marketplace install only once you no longer want it. What it takes out:

- the runner, which it stops;
- what the plugin wrote in `~/.claude/isoplan/`: the runner's copy and its records (`runner/`: the app, `environment.json`, the ledger, the lock), the machine's pairing credential (`pairing.json`) and the lock of a pairing under way (`pairing.lock`), the copy of the office's list of repos (`approved.json`), the session locks (`live/`), the logs (`logs/`), the title files (`titles/`), the hashes of reports you released (`released/`), the marks of the questions a session waits on (`waits/`), the update check's record and lock (`update.json`, `update.lock`), and `claude-binary.json` unless you set it by hand;
- the `"autoUpdate": true` the plugin added to its marketplace's entry in `~/.claude/settings.json`, if you haven't changed it since;
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
| `packages/mod/runner.json`, overridden per key by `~/.claude/isoplan/runner.json` | The fork's model (`claudeModel`, Opus by default); the caps on answers per room per hour and per machine per day; the machine's daily token budget, and the weight of each kind of token in it (a cache write costs more than plain input, a cache read far less); the timeouts, including git's for a handoff (`gitTimeoutSeconds`) and a worktree setup script's default (`setupTimeoutMinutes`); how far back the runner looks for your clone of a repo (`cloneSearchDays`); how many folders down from a session's folder a handoff looks for repos (`repoSearchDepth`, 3); and how long an agent waits when it asks a room that was handed to it: `askPolls` checks, `askPollSeconds` apart, before it is told to carry on. |
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

A session can work in a folder that holds several repos, cloned inside a parent repo that usually ignores them, or inside a plain folder that isn't a repo at all. A handoff finds every repo under the session's folder, up to `repoSearchDepth` folders down, whether or not the parent ignores them. Folders whose names start with a dot, `node_modules` and links aren't looked in; any of those that is a repo itself, a repo one level too deep, and a folder that couldn't be read are named in the brief as left out. A session in your home folder or at a drive's root can't hand over: that is too wide a folder to look through. The parent always goes; a repo under it goes only when it has work its remote's default branch hasn't (changes to tracked files, or commits that aren't on that branch; with no default branch known, commits on none of the remote's branches), each by every rule above on its own: its own `.gitignore`, remote and default branch, its own branch, and the same secret scan. Repos that push to one remote get a branch each there, `isoplan/handoff/<id>--<path>` after the first. The brief's note lists every repo handed over and its branch, so the floor shows them in the meeting. Every file in every repo whose added lines match is held, named by its path in the folder, and one release pushes all of those exact commits. A repo under the folder with work but no commit or no remote, or one git can't read, is left out and named in the brief (a clean one with no remote isn't mentioned, and the folder's own repo with no remote refuses the handoff, as above); in a plain folder, the files outside every repo are named as not handed over; git submodules aren't handed over either, and are named. If a push fails after some repos' branches went, the failure says which went, and handing it over again with the same id pushes the rest. Taking it checks out each repo at its path after the setup script, so the script sees only the repos it clones itself: one there already, say one the script cloned on main, is fetched and switched by the shortcut's rules, and one that isn't there is cloned from its remote, only when that is an https, ssh or `host:path` remote (never a local path, `file://` or a `\server` share), with Git LFS's download off. A path into a `.git` folder, in any spelling Windows reads as one, or out through a link, is refused. One that fails is shown in the room by its path, and the session still opens. A handoff from a plain folder has no worktree to make: the floor makes a plain folder beside yours (`<folder>-handoff-<id>`, where your folder is the most recent session folder holding one of its repos) and clones its repos into it, with no setup script, since no repo there holds `isoplan.json`. The shortcut does the same in the session's own folder; run from inside one of the handoff's repos, it works from the folder above it.

With sign-in on, `/isoplan:handover` and `/isoplan:take` send this machine's pairing token like the data layer does, renewing it when it has run out. They never pair the machine themselves: if it isn't paired, or its pairing has ended, they say so and point at the **Pair this machine** link a session shows.

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

## Asking the room

Once you have taken a handoff, your session's agent gets the plugin's `ask_room` tool and can ask the room's lead a question, without you typing anything; sessions that took no handoff don't have the tool. Only a taken handoff gives that right, only for that room, and the person who handed it over can turn it off on the floor, and on again. The question goes through the office server to their runner on the machine with the original session, whose fork of the lead answers from the session's own context, within the caps in their `runner.json`, and the answer is checked for secrets on their machine before it leaves. Your agent is given the answer marked as another person's session, quoted, as information rather than instructions. Every question and answer shows under the room on the floor, and the server keeps them for its retention period; the office's `asks.json` caps how many questions one person may have waiting and ask in a day.

Your agent is never held up for long: when their machine is off, their runner is away, a cap is reached or the answer is held, it checks `askPolls` times, `askPollSeconds` apart, then is told to carry on. The question stays queued and is asked again when their runner is back; an answer that comes later reaches your agent as a note on one of its next tool results. When the office signs people in, the tool asks with this machine's pairing, as the data layer reports; on a machine that isn't paired, or whose pairing has ended, your agent is told so and carries on.

## Answering from the floor

When an agent asks you something (`AskUserQuestion`), the question shows in the terminal and on the floor at once, and the first answer wins: answer it in the agent's details on the floor and the terminal's dialog closes, and the agent gets your answers as if you had picked them in the terminal. Only you can answer your own sessions' questions there, and only you, and an admin with Overview on, can read them; everyone else sees that your agent is waiting on you. The floor offers a question only while the plugin is waiting for it in that session, so one in a session seen only through the wake hook, or asked before the plugin loaded, is read-only there: answer it in its terminal. A question is secret-checked before it leaves, as reports are: one that matches, and every one while the patterns can't be read, goes as a placeholder and is answered in the terminal. A report the secret check held is released from the same place.

This rests on how Claude Code's dialog behaves while a hook waits, which `scripts/probe-ask-dialog.mjs` checks in a hidden terminal with a throwaway config folder (it needs `node-pty`; see its header): the dialog shows while the hook waits, an answer the hook gives closes it and is taken as the question's answer, and a multi-select answer is the picked labels joined with ", ", with any words typed under "Type something" after them. Run it after a Claude Code update.

## What leaves your machine

Nothing at all of a session in a repo the office doesn't take. An admin lists the company's repos on the floor (Repos), and the plugin reads that list from the office server (`/data-layer/repos`, beside the `server` address: every approved repo's id, with this machine's pairing token when the office signs people in) every `approvedRefreshMinutes` (5), whenever its link drops, and before every reconnect, keeping a copy in `~/.claude/isoplan/approved.json`. A copy the server hasn't confirmed for `approvedMaxAgeMinutes` (15) approves nothing. A session in any other repo opens no connection and sends nothing, not even a hello or its repo's id; the status line says "this repo isn't in the office", and the plugin's log says why. A session the plugin doesn't run in, started by the wake hook, then stops, and starts again once this machine's copy of the list takes its repo. Once an admin adds the repo, its sessions connect at the next check; once one is taken out, their links close. With no list (the server can't be reached and there is no fresh copy, or the server is too old to give one), nothing is sent. The handoff and ask-the-room commands go by the same copy; taking a handoff with its code looks up the room's repo by the code and says hello as that, so the folder you take it in is never named. What isn't a session's carries no repo id: pairing sends this machine's name, its random id and the Claude account's label, and the runner's link says hello with the account and the machine's name; the runner answers only for sessions in repos the office takes.

For a repo the office takes, by default only facts: which sessions and agents are running and what kind of work each is doing, in which repository and branch, which files they touched, and when they wait. Session-derived text leaves only in named cases, each kept by the server for a set period and then deleted: an agent's final report, questions an agent asks its owner, and the questions, answers and briefs in a room that was handed over. A report, and a question an agent asks you, is checked for secrets on your machine before it is sent, as answers and briefs are. A report that matches stays a placeholder, a note saying it is held, until you release it from the floor; a question that matches is answered in the terminal. A pattern you add after a report went out can't recall it.

An agent often works in more than one repo: editing files with Edit or Write, or with shell commands (Bash, zsh, PowerShell or cmd) that cd somewhere else or point a tool at another folder (`git -C`, `npm --prefix`, `pnpm -C`, `make -C`). The plugin works out which repo each file and command is in, but a file, command or subagent's worktree in a repo other than the session's own leaves your machine only when the office it reports to holds that repo, and only to an office server that says it reads them: when it lets a session in, the server names the office's repos (and, of repos with no remote, only this machine's). Everything else stays on the machine, as before. A session in a plain folder above several repos (a workspace, holding between one and `workspaceRepos` repos, never your home folder or one above it) is reported like a repo with no remote: its project is the folder's path on this machine, lower-cased on Windows and macOS. It reports once the office takes any repo inside it, as the first of those by name (its room stands in that repo's district), and sends only its work inside repos the office takes, each named by its repo; its own files, outside every repo, stay on the machine, and the folder's own path is never sent. A hand-over from it takes only the repos the office takes, and names the others to you alone.

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

The plugin's version in `packages/mod/.claude-plugin/plugin.json` is the release gate: commits on main reach nobody until it changes. Once a change has run on the dogfooding machine, release it: bump that `version` (and `packages/mod/package.json`'s to match, which Claude Code doesn't read), rebuild `dist/`, and merge to main. Every install picks it up within `updateCheckHours`, through the plugin's own check or Claude Code's auto-update (see Updates). Set the version only in `plugin.json`, never in the plugin's entry in `.claude-plugin/marketplace.json` too: Claude Code takes `plugin.json`'s without a warning, so a second copy only goes stale. Rebuild `dist/` with every change to `src/`, since the plugin runs it as committed.

To release the protocol, set its version in `packages/protocol/package.json`, and publish a GitHub release for the tag `protocol-v<version>`, such as `protocol-v0.3.0`. That runs `.github/workflows/publish-protocol.yml`, which fails unless the tag matches the package's version, waits for approval if the `npm-publish` environment asks for it, and publishes `@isoplan/protocol` to npm unless that version is there already. It uses npm trusted publishing, so no npm token is stored in the repository, and each version carries a provenance statement. Releases for other tags publish nothing.

Earlier history of both packages is in Isoplan's private repository.

## Licence

MIT (see `LICENSE`).
