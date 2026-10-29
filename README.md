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

## The runner

Each machine runs one runner (`packages/mod/dist/runner.js`, which install copies to `~/.claude/isoplan/runner/app/dist/runner.mjs` with its defaults beside it, so a plugin update doesn't delete the files it runs from), which answers the office server's questions and handoff briefs for the machine's rooms. It answers from a fork of the room's lead session: a one-off `claude -p --resume --fork-session` with no tools, no MCP servers and no settings files, which is never saved. Install, the plugin and the wake hook start it, a newer copy replaces an older one as it starts, and it stops once every room on the machine has gone lights-off. Before an answer or brief leaves the machine, it is checked for secrets, and one that matches is withheld until you release it from the floor.

The runner reads these files. Each file in `~/.claude/isoplan/` is optional:

| File | What |
|---|---|
| `packages/mod/runner.json`, overridden per key by `~/.claude/isoplan/runner.json` | The fork's model (`claudeModel`, Opus by default); the caps on answers per room per hour and per machine per day; the machine's daily token budget, and the weight of each kind of token in it (a cache write costs more than plain input, a cache read far less); and the timeouts. |
| `packages/mod/secret-patterns.json`, plus `~/.claude/isoplan/secret-patterns.json` | The secret scan's patterns, as `{ "patterns": [{ "name", "regex", "flags"? }] }`. Your file adds patterns; it can't remove the plugin's. |
| `packages/mod/prompts/` | What the fork is told: `instructions.md` first, the same every time so the lead's context is reused from cache, then `question.md` or `brief.md`. |
| `~/.claude/isoplan/claude-binary.json` | The `claude` binary the fork runs, `{ "path": "..." }`, which install finds and records. Set it by hand if install can't find it; a path set by hand, without `"auto": true`, is kept by later installs. |

The caps are counted on each machine: someone with two machines has two of each.

The fork reads no settings files, so a login or proxy that comes from `settings.json` (an `apiKeyHelper`, or an `env` block) doesn't reach it, and its rooms say they can't answer. Claude Code's own login and auth from environment variables (an API key, Bedrock, Vertex) work.

Its log is `~/.claude/isoplan/logs/runner.log`, and its count of answers and tokens for the last day is in `~/.claude/isoplan/runner/ledger.json`.

## What leaves your machine

By default only facts: which sessions and agents are running and what kind of work each is doing, in which repository and branch, which files they touched, and when they wait. Session-derived text leaves only in named cases, each kept by the server for a set period and then deleted: an agent's final report, questions an agent asks its owner, and the questions, answers and briefs in a room that was handed over.

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

To release the protocol, bump `packages/protocol/package.json`'s version and run `pnpm publish` in `packages/protocol`.

Earlier history of both packages is in Isoplan's private repository.

## Licence

MIT (see `LICENSE`).
