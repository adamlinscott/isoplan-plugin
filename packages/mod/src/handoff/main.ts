// The handoff commands' script, which the plugin's /isoplan:handover and /isoplan:take run inside
// the session (commands/):
//
//   node dist/handoff.js prepare --to <name>                                     a new handoff id, where to write the brief and what to write
//   node dist/handoff.js hand-over --id <id> --to <name> --brief <file> [--push-anyway <commit>]   commits, pushes and hands the room over
//   node dist/handoff.js take <code>                                             checks out the handoff here and prints its brief
//
// The session is $CLAUDE_CODE_SESSION_ID and its folder $CLAUDE_PROJECT_DIR (else this process's
// folder, which a cd in the agent's shell may have moved), both of which Claude Code sets for the
// commands it runs. Each talks to the office server over its own short link (connection.ts), as that
// session.
//
// On the command path the live agent writes the brief, in its own turn, then runs hand-over. That
// adds the runner's note (the branch and the untracked files), scans the brief for secrets, asks
// the server whether it would take the hand-over, does the git work (git.ts) and sends it. A brief
// that matches a secret pattern isn't sent: the agent is told which pattern, so it can take it out.
// A commit whose added lines match isn't pushed: the agent is told the file and the commit, and only
// --push-anyway with that commit, on the person's say, pushes it, exactly as it was. The brief's
// folder (isoplan/handoffs/out/<id>) goes once it is sent, and any left by a prepare that wasn't
// followed up goes after a day.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION, type HandedOverMessage, type HandOverReadyMessage, type HandoffMessage, type HandoffRepo, type HelloMessage, type OfficeServerMessage } from "@isoplan/protocol";
import { loadConfig, loadSettings } from "../data-layer/config.js";
import { createGit } from "../data-layer/git.js";
import { accountOf, claudePaths, projectOf } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { fill, loadPrompts } from "../runner/prompts.js";
import { loadPatterns, scan } from "../runner/scan.js";
import { openSideLink } from "./connection.js";
import { createRunGit, GIT_FAILED, handoffBranch, handoffNote, HandoffGitError, newHandoffId, prepare, pushHandoff, untrackedLine } from "./git.js";
import { checkoutHere, handoffDir, setupCommand, type TakeSettings } from "./take.js";

const ANSWER_MS = 20000;
// A prepare's folder not handed over within this long was abandoned.
const ABANDONED_MS = 24 * 60 * 60 * 1000;

const here = path.dirname(fileURLToPath(import.meta.url));
const modDir = path.join(here, "..");
const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
const isoplanDir = path.join(claudeDir, "isoplan");
const io = nodeIo();
const run = createRunGit();

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : null;
};

/** The session's own folder. */
const sessionDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();
/** Where a prepare keeps the brief until it is sent. */
const outDir = (id: string) => path.join(claudeDir, "isoplan", "handoffs", "out", id);

// Removes the folders of prepares that were never handed over.
async function tidyOut(): Promise<void> {
  const root = path.join(claudeDir, "isoplan", "handoffs", "out");
  for (const name of await fs.readdir(root).catch(() => [] as string[])) {
    const dir = path.join(root, name);
    const st = await fs.stat(dir).catch(() => null);
    if (st?.isDirectory() && Date.now() - st.mtimeMs > ABANDONED_MS) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

class Stop extends Error {}
const stop = (text: string): never => {
  throw new Stop(text);
};

async function settings() {
  return loadSettings<TakeSettings>(io, path.join(modDir, "runner.json"), path.join(isoplanDir, "runner.json"));
}

async function hello(cwd: string): Promise<HelloMessage> {
  const id = process.env.CLAUDE_CODE_SESSION_ID;
  if (!id) stop("This runs inside a Claude Code session, which sets CLAUDE_CODE_SESSION_ID; it isn't set here.");
  const machine = os.hostname();
  const where = await createGit(io).resolve(cwd);
  return {
    type: "hello",
    v: PROTOCOL_VERSION,
    source: "claude-code",
    account: await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, cwd),
    machine: { name: machine },
    session: `claude-code:${id}`,
    project: await projectOf(io.run, where, cwd, machine),
  };
}

async function server(): Promise<string> {
  return (await loadConfig(io, path.join(modDir, "config.json"), path.join(isoplanDir, "config.json"))).server;
}

const said = (m: Extract<OfficeServerMessage, { type: "error" }>) => `The office server says: ${m.message}`;

// What the commands accept: a take code is the floor's fixed alphabet; a name is letters, digits,
// spaces and . _ @ -, so nothing typed after a command can reach a shell as more than that.
const CODE = /^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/i;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._@-]{0,79}$/u;
const nameOf = (argv: string[]) => {
  const to = (flag(argv, "--to") ?? "").trim();
  if (!NAME.test(to)) stop(`"${to}" isn't a name to hand over to: use their name or account id, in letters, digits, spaces and . _ @ - only.`);
  return to;
};

async function prepareCommand(argv: string[]): Promise<string> {
  const to = nameOf(argv);
  const s = await settings();
  await tidyOut();
  const prepared = await prepare(run, sessionDir(), s.gitTimeoutSeconds * 1000).catch((err: unknown) => stop(err instanceof HandoffGitError ? `Can't hand over from here: ${GIT_FAILED[err.kind]}.` : String(err)));
  const id = newHandoffId();
  const folder = outDir(id);
  await fs.mkdir(folder, { recursive: true });
  const brief = fill((await loadPrompts(path.join(modDir, "prompts"))).brief, { to, untracked: untrackedLine(prepared.files) });
  return [`Handoff id: ${id}`, `Brief file: ${path.join(folder, "brief.md")}`, `Branch: ${handoffBranch(id)}${prepared.from ? `, made from ${prepared.from}` : ""}`, "", brief].join("\n");
}

async function handOverCommand(argv: string[]): Promise<string> {
  const id = flag(argv, "--id") || stop("Missing --id: run prepare first.");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) stop(`"${id}" isn't a handoff id.`);
  const to = nameOf(argv);
  const pushAnyway = flag(argv, "--push-anyway");
  if (pushAnyway !== null && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(pushAnyway)) stop("--push-anyway takes the held commit's full hash, as hand-over printed it.");
  const file = flag(argv, "--brief") || stop("Missing --brief <file>.");
  const written = (await fs.readFile(file, "utf8").catch(() => stop(`There is no brief at ${file}: write it there first.`))).trim();
  if (!written) stop(`The brief at ${file} is empty.`);
  const cwd = sessionDir();
  const s = await settings();
  const timeoutMs = s.gitTimeoutSeconds * 1000;
  const { from, files } = await prepare(run, cwd, timeoutMs).catch((err: unknown) => stop(err instanceof HandoffGitError ? `Can't hand over from here: ${GIT_FAILED[err.kind]}.` : String(err)));
  const brief = `${written}\n\n${handoffNote({ branch: handoffBranch(id), from, files, at: new Date() })}`;
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), () => {});
  const matched = scan(brief, patterns);
  if (matched) stop(`The brief wasn't sent: it matches the secret pattern "${matched}". Take that out of ${file} and run hand-over again.`);

  const link = await openSideLink(await server(), await hello(cwd), ANSWER_MS);
  try {
    // The server says whether it would take this hand-over before anything is pushed.
    link.send({ type: "hand-over-check", v: PROTOCOL_VERSION, to, handoff: id });
    const ready = await link.next((m): m is HandOverReadyMessage => m.type === "hand-over-ready" && m.handoff === id, ANSWER_MS);
    if (ready.type === "error") stop(`Nothing was pushed. ${said(ready)}`);
    const pushed = await pushHandoff(run, cwd, id, timeoutMs, { scan: async (text) => scan(text, patterns), ...(pushAnyway ? { pushAnyway } : {}) }).catch((err: unknown) =>
      stop(err instanceof HandoffGitError ? `The handoff wasn't sent: ${GIT_FAILED[err.kind]}.\n${err.detail}` : String(err)),
    );
    if ("held" in pushed) {
      const unchecked = pushed.unchecked.length ? ` These files couldn't be checked (binary): ${pushed.unchecked.join(", ")}.` : "";
      stop(`Nothing was pushed: the lines the push would send to ${pushed.held} match a secret pattern.${unchecked} Take the secret out, or, if it isn't one, run hand-over again with --push-anyway ${pushed.commit} to push that exact commit.`);
    }
    const { repo } = pushed as { repo: HandoffRepo };
    link.send({ type: "hand-over", v: PROTOCOL_VERSION, to, handoff: { id, brief, repos: [repo] } });
    const answer = await link.next((m): m is HandedOverMessage => m.type === "handed-over" && m.handoff === id, ANSWER_MS);
    if (answer.type === "error") stop(`${said(answer)}\nThe branch ${repo.branch} is pushed; run hand-over again with the same id once that is fixed.`);
    const name = (answer as HandedOverMessage).to.name || (answer as HandedOverMessage).to.id;
    if (path.resolve(path.dirname(file)) === path.resolve(outDir(id))) await fs.rm(outDir(id), { recursive: true, force: true }).catch(() => {});
    return `Handed over to ${name}, on ${repo.branch}. They will see a Take handoff button in the room on the floor.`;
  } finally {
    await link.close();
  }
}

async function takeCommand(argv: string[]): Promise<string> {
  const code = (argv[0] ?? "").trim();
  if (!CODE.test(code)) stop("That isn't a take code: it is the eight letters and digits the floor shows, like ABCD-EFGH.");
  const cwd = sessionDir();
  const s = await settings();
  const timeoutMs = s.gitTimeoutSeconds * 1000;
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), () => {});
  const link = await openSideLink(await server(), await hello(cwd), ANSWER_MS);
  try {
    link.send({ type: "take", v: PROTOCOL_VERSION, code });
    const answer = await link.next((m): m is HandoffMessage => m.type === "handoff", ANSWER_MS);
    if (answer.type === "error") stop(said(answer));
    const { handoff } = answer as HandoffMessage;
    const { failures, remote } = await checkoutHere(run, cwd, handoff, handoffDir(claudeDir, handoff.id), timeoutMs);
    // Git's output leaves this machine only after the scan.
    const sent = failures.map((f) => (scan(f.output, patterns) ? { ...f, output: "The end of its output is withheld here: it matches a secret pattern." } : f));
    link.send({ type: "taken", v: PROTOCOL_VERSION, handoff: handoff.id, failures: sent });
    const checkout = failures.length
      ? `The checkout of ${handoffBranch(handoff.id)} failed, so this folder is as it was:\n${failures[0]!.output}`
      : `This folder is now on ${handoffBranch(handoff.id)}.`;
    // No setup runs on this path; the agent is told when the repo has one, in case it matters here.
    const setup = remote ? await setupCommand(run, { dir: cwd, remote }, process.platform, timeoutMs) : null;
    const setupNote = setup ? [`The repo's worktree setup script has NOT been run here: \`${setup}\` (from isoplan.json). Run it only if this folder isn't set up yet.`] : [];
    return [`You have taken Isoplan handoff ${handoff.id}, and this session is in its room now.`, checkout, ...setupNote, "", "The brief:", "", handoff.brief].join("\n");
  } finally {
    await link.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    const out =
      command === "prepare" ? await prepareCommand(rest) : command === "hand-over" ? await handOverCommand(rest) : command === "take" ? await takeCommand(rest) : stop("usage: handoff.js prepare | hand-over | take");
    process.stdout.write(out + "\n");
    return 0;
  } catch (err) {
    process.stdout.write(`${err instanceof Stop ? err.message : `The handoff failed: ${(err as Error)?.message ?? String(err)}`}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
