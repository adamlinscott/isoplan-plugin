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

## Disable or uninstall

Claude Code runs nothing of a plugin's when you disable or uninstall it, so the hook in your settings looks for itself, each time a session takes a prompt, at what Claude Code records: `installed_plugins.json`, and `enabledPlugins` in your settings, the project's settings and a `managed-settings.json` file (not managed settings from MDM or the claude.ai console, which it can't read).

**Disable** it (`/plugin disable isoplan@isoplan`, the plugin manager, or `claude plugin disable`) and reporting stops: the hook stops the runner and starts nothing, and the sessions' data layers stop. Every file stays. Disabled in one project only, that project's sessions aren't reported. Enable it again and the next prompt starts them again.

**Uninstall** it (`/plugin uninstall isoplan@isoplan`, the plugin manager, or `claude plugin uninstall isoplan@isoplan`) and, the next time a session takes a prompt, the hook takes everything out in the background:

- the runner, which it stops;
- what the plugin wrote in `~/.claude/isoplan/`: the runner's copy and its records (`runner/`: the app, `environment.json`, the ledger, the lock), the session locks (`live/`), the logs (`logs/`), the title files (`titles/`), and `claude-binary.json` unless you set it by hand;
- last, the hook in `~/.claude/settings.json` (every other hook and setting is kept), and the hook script and its record (`wake.mjs`, `wake.json`).

The files you write are kept: `config.json`, `runner.json`, `secret-patterns.json`, and a `claude-binary.json` you set by hand, so a reinstall picks them up again. Delete `~/.claude/isoplan/` yourself to take those too; once nothing is left in it, uninstall removes the folder.

It asks Claude Code before each step whether the plugin is still uninstalled, and stops if you installed it again. A session that already had the plugin loaded stops reporting, but Claude Code keeps the plugin loaded there until the session ends or you run `/reload-plugins`; if it wrote its files again meanwhile, the hook stays and the next prompt finishes the job. If it can't finish, for example because `settings.json` doesn't parse, it says why in `~/.claude/isoplan/uninstall.log` and tries again a day later; delete `~/.claude/isoplan/uninstall.json` to have the next prompt try at once.

From a checkout, `pnpm isoplan-uninstall` takes out the same things at once, and leaves `~/.claude/isoplan/wake.json` as `{ "disabled": true }`, so the plugin, if it is still installed, doesn't put the hook back when it next starts; `pnpm isoplan-install` takes that away.

## The runner

Each machine runs one runner (`packages/mod/dist/runner.js`, which install copies to `~/.claude/isoplan/runner/app/dist/runner.mjs` with its defaults beside it, so a plugin update doesn't delete the files it runs from), which answers the office server's questions and handoff briefs for the machine's rooms. It answers from a fork of the room's lead session: a one-off `claude -p --resume --fork-session` with no tools, no MCP servers and no settings files, which is never saved. Install, the plugin and the wake hook start it, a newer copy replaces an older one as it starts, and it stops once every room on the machine has gone lights-off. Before an answer or brief leaves the machine, it is checked for secrets, and one that matches is withheld until you release it from the floor.

The runner reads these files. Each file in `~/.claude/isoplan/` is optional:

| File | What |
|---|---|
| `packages/mod/runner.json`, overridden per key by `~/.claude/isoplan/runner.json` | The fork's model (`claudeModel`, Opus by default); the caps on answers per room per hour and per machine per day; the machine's daily token budget, and the weight of each kind of token in it (a cache write costs more than plain input, a cache read far less); and the timeouts. |
| `packages/mod/secret-patterns.json`, plus `~/.claude/isoplan/secret-patterns.json` | The secret scan's patterns, as `{ "patterns": [{ "name", "regex", "flags"? }] }`. Your file adds patterns; it can't remove the plugin's. While your file can't be read, or has a pattern that doesn't compile, every answer, brief and report is held. |
| `packages/mod/prompts/` | What the fork is told: `instructions.md` first, the same every time so the lead's context is reused from cache, then `question.md` or `brief.md`. |
| `~/.claude/isoplan/claude-binary.json` | The `claude` binary the fork runs, `{ "path": "..." }`, which install finds and records. Set it by hand if install can't find it; a path set by hand, without `"auto": true`, is kept by later installs. |

The caps are counted on each machine: someone with two machines has two of each.

The runner starts with an environment recorded from the shell that ran the install script, in `~/.claude/isoplan/runner/environment.json`, never with the environment of the session that happened to start it, so a project's settings `env` block can't reach it or its forks. Only the operating system's basics, proxy and certificate settings, and the login and provider variables (`ANTHROPIC_*`, Bedrock, Vertex, `AWS_*`, Google Cloud's, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`) are recorded. You can edit the file; the install script writes it again each time it runs, and uninstall removes it. Without it (installed only through the plugin, or before it existed) the runner uses its starter's environment and says so in its log.

The fork reads no settings files, so a login or proxy that comes from `settings.json` (an `apiKeyHelper`, or an `env` block) doesn't reach it, and its rooms say they can't answer. Claude Code's own login and auth from environment variables (an API key, Bedrock, Vertex) work.

Its log is `~/.claude/isoplan/logs/runner.log`, and its count of answers and tokens for the last day is in `~/.claude/isoplan/runner/ledger.json`.

## What leaves your machine

By default only facts: which sessions and agents are running and what kind of work each is doing, in which repository and branch, which files they touched, and when they wait. Session-derived text leaves only in named cases, each kept by the server for a set period and then deleted: an agent's final report, questions an agent asks its owner, and the questions, answers and briefs in a room that was handed over. A report is checked for secrets on your machine before it is sent, as answers and briefs are. One that matches stays a placeholder, a note saying it is held, until you release it; releasing it from the floor arrives with adamlinscott/isoplan#50. A pattern you add after a report went out can't recall it.

## What is here

| Path | What |
|---|---|
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
