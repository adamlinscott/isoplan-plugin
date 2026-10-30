// The handoff commands' script, which the plugin's /isoplan:handover and /isoplan:take run inside
// the session (commands/):
//
//   node dist/handoff.js prepare --to <name>                                     a new handoff id, where to write the brief and what to write
//   node dist/handoff.js hand-over --id <id> --to <name> --brief <file> [--push-anyway [<repo>=]<commit>]...   commits, pushes and hands the room over
//   node dist/handoff.js take <code>                                             checks out the handoff here and prints its brief
//
// The session is $CLAUDE_CODE_SESSION_ID and its folder $CLAUDE_PROJECT_DIR (else this process's
// folder, which a cd in the agent's shell may have moved), both of which Claude Code sets for the
// commands it runs. Each talks to the office server over its own short link (connection.ts), as that
// session. With sign-in on, its hello carries this machine's pairing token (#23), renewed once when
// the server says it has run out; the commands never pair the machine, and say what to do when the
// server refuses them for it.
//
// On the command path the live agent writes the brief, in its own turn, then runs hand-over. That
// adds the runner's note (the branch and the untracked files), scans the brief for secrets, asks
// the server whether it would take the hand-over, does the git work (git.ts) and sends it. A brief
// that matches a secret pattern isn't sent: the agent is told which pattern, so it can take it out.
// A commit whose added lines match isn't pushed: the agent is told the file and the commit, and only
// --push-anyway with that commit, on the person's say, pushes it, exactly as it was. With several
// repos in the session's folder (#56) the file is named by its path there, and the flag is
// `--push-anyway <repo>=<commit>` for a repo under the folder, one per held repo. The brief's
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
import { httpUrl, isPlainRemote, pairingPath, postJson, readPairing } from "../data-layer/pairing.js";
import { NEEDS_PAIRING, openPairedLink, PairingRefused, type CommandPairing } from "./connection.js";
import { createRunGit, gitFailed, handoffBranch, handoffNote, HandoffGitError, newHandoffId, prepare, pushHandoff, repoBranch, untrackedLine } from "./git.js";
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
  return loadSettings<TakeSettings & { repoSearchDepth: number }>(io, path.join(modDir, "runner.json"), path.join(isoplanDir, "runner.json"));
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

// A kept token is used while it has longer than this left, as the data layer's renewal would.
const TOKEN_LEFT_MS = 5 * 60 * 1000;

/**
 * The office server and this machine's pairing with it (#23), as a command uses it: only read. The
 * kept token goes in the hello while it is current; otherwise the credential is swapped for one for
 * this command alone (POST <server>/token), which isn't written back. Nothing here takes the
 * pairing's locks, writes pairing.json or starts a pairing: the session's data layer does those,
 * with its link in the status line. When a token can't be had, the command says the machine needs
 * pairing.
 */
async function office(): Promise<{ server: string; pairing: CommandPairing }> {
  const config = await loadConfig(io, path.join(modDir, "config.json"), path.join(isoplanDir, "config.json"));
  const file = pairingPath(claudeDir);
  // The pairing is the machine's, whichever folder the session is in.
  const account = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, os.homedir());
  return {
    server: config.server,
    pairing: {
      async token(renew) {
        const entry = (await readPairing(file)).accounts[account.id];
        if (!entry?.credential || entry.server !== config.server) return undefined;
        if (!config.allowPlainWs && isPlainRemote(config.server)) throw new PairingRefused(`${config.server} is plain ws:// to another machine, so this machine's pairing isn't sent over it: use wss://, or set "allowPlainWs": true in config.json.`);
        if (!renew && entry.token && (entry.tokenExpires ?? 0) - TOKEN_LEFT_MS > Date.now()) return entry.token;
        const answer = await postJson(httpUrl(config.server, "/token"), { credential: entry.credential }).catch(() => null);
        if (answer?.status === 200 && typeof answer.body.token === "string") return answer.body.token;
        throw new PairingRefused(NEEDS_PAIRING);
      },
    },
  };
}

// The link and its first answer, as this machine's pairing; a refusal for the pairing stops the command.
async function exchange<T extends OfficeServerMessage>(cwd: string, first: Parameters<typeof openPairedLink>[3], wanted: (m: OfficeServerMessage) => m is T, before = "") {
  const { server, pairing } = await office();
  try {
    return await openPairedLink(server, await hello(cwd), pairing, first, wanted, ANSWER_MS);
  } catch (err) {
    if (err instanceof PairingRefused) stop(`${before}${err.message}`);
    throw err;
  }
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
  const prepared = await prepare(run, sessionDir(), s.gitTimeoutSeconds * 1000, s.repoSearchDepth).catch((err: unknown) => stop(err instanceof HandoffGitError ? `Can't hand over from here: ${gitFailed(err)}.` : String(err)));
  const id = newHandoffId();
  const folder = outDir(id);
  await fs.mkdir(folder, { recursive: true });
  const brief = fill((await loadPrompts(path.join(modDir, "prompts"))).brief, { to, untracked: untrackedLine(prepared.files) });
  const subs = prepared.repos.filter((r) => r.path !== ".");
  const repos = subs.length ? [`Repos, by path in this folder: ${prepared.repos.map((r) => `${r.path} (${repoBranch(id, r)}${r.from ? `, from ${r.from}` : ""})`).join(", ")}`] : [];
  const left = prepared.left.length ? [`Left out: ${prepared.left.map((l) => `${l.path} (${l.why})`).join("; ")}`] : [];
  return [`Handoff id: ${id}`, `Brief file: ${path.join(folder, "brief.md")}`, `Branch: ${handoffBranch(id)}${prepared.from ? `, made from ${prepared.from}` : ""}`, ...repos, ...left, "", brief].join("\n");
}

// --push-anyway <commit> for the session folder's own repo, or <repo>=<commit> for one under it, once per held repo.
function pushAnywayOf(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  argv.forEach((arg, i) => {
    if (arg !== "--push-anyway") return;
    const value = argv[i + 1] ?? "";
    const at = value.lastIndexOf("=");
    const [repo, commit] = at >= 0 ? [value.slice(0, at), value.slice(at + 1)] : [".", value];
    if (!repo || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit)) stop("--push-anyway takes the held commit's full hash, with its repo's path and = before it for a repo under the folder, as hand-over printed it.");
    out[repo] = commit;
  });
  return out;
}

async function handOverCommand(argv: string[]): Promise<string> {
  const id = flag(argv, "--id") || stop("Missing --id: run prepare first.");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) stop(`"${id}" isn't a handoff id.`);
  const to = nameOf(argv);
  const pushAnyway = pushAnywayOf(argv);
  const file = flag(argv, "--brief") || stop("Missing --brief <file>.");
  const written = (await fs.readFile(file, "utf8").catch(() => stop(`There is no brief at ${file}: write it there first.`))).trim();
  if (!written) stop(`The brief at ${file} is empty.`);
  const cwd = sessionDir();
  const s = await settings();
  const timeoutMs = s.gitTimeoutSeconds * 1000;
  // Prepared once: the note names the repos the push then hands over.
  const prepared = await prepare(run, cwd, timeoutMs, s.repoSearchDepth).catch((err: unknown) => stop(err instanceof HandoffGitError ? `Can't hand over from here: ${gitFailed(err)}.` : String(err)));
  const { from, files, repos, left } = prepared;
  const unknown = Object.keys(pushAnyway).filter((repo) => !repos.some((r) => r.path === repo));
  if (unknown.length) stop(`--push-anyway names ${unknown.map((r) => (r === "." ? "this folder's own repo" : r)).join(", ")}, which this doesn't hand over (it hands over ${repos.map((r) => r.path).join(", ")}). Nothing was pushed.`);
  const brief = `${written}\n\n${handoffNote({ branch: handoffBranch(id), from, files, at: new Date(), repos, left })}`;
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), () => {});
  const matched = scan(brief, patterns);
  if (matched) stop(`The brief wasn't sent: it matches the secret pattern "${matched}". Take that out of ${file} and run hand-over again.`);

  // The server says whether it would take this hand-over before anything is pushed.
  const { link, answer: ready } = await exchange(cwd, { type: "hand-over-check", v: PROTOCOL_VERSION, to, handoff: id }, (m): m is HandOverReadyMessage => m.type === "hand-over-ready" && m.handoff === id, "Nothing was pushed. ");
  try {
    if (ready.type === "error") stop(`Nothing was pushed. ${said(ready)}`);
    const pushed = await pushHandoff(run, cwd, id, timeoutMs, { scan: async (text) => scan(text, patterns), pushAnyway, prepared }).catch((err: unknown) =>
      stop(
        err instanceof HandoffGitError
          ? `The handoff wasn't sent: ${gitFailed(err)}.${err.pushed.length ? ` Run hand-over again with --id ${id} once that is fixed: it pushes the rest.` : ""}\n${err.detail}`
          : String(err),
      ),
    );
    if ("held" in pushed) {
      const unchecked = pushed.unchecked.length ? ` These files couldn't be checked (binary): ${pushed.unchecked.join(", ")}.` : "";
      const again = Object.entries(pushed.commits).map(([repo, commit]) => `--push-anyway ${repo === "." ? commit : `${repo}=${commit}`}`);
      const kept = Object.keys(pushAnyway).length ? ", keeping the --push-anyway you gave already" : "";
      stop(`Nothing was pushed: the lines the push would send to ${pushed.held.join(", ")} match a secret pattern.${unchecked} Take the secrets out, or, if they aren't any, run hand-over again with ${again.join(" ")}${kept}, to push those exact commits.`);
    }
    const { repos: sent } = pushed as { repos: HandoffRepo[] };
    const branch = handoffBranch(id);
    link.send({ type: "hand-over", v: PROTOCOL_VERSION, to, handoff: { id, brief, repos: sent } });
    const answer = await link.next((m): m is HandedOverMessage => m.type === "handed-over" && m.handoff === id, ANSWER_MS);
    const pushedBranches = sent.map((r) => (r.path === "." ? r.branch : `${r.branch} in ${r.path}`)).join(", ");
    if (answer.type === "error") stop(`${said(answer)}\nPushed: ${pushedBranches}. Run hand-over again with the same id once that is fixed.`);
    const name = (answer as HandedOverMessage).to.name || (answer as HandedOverMessage).to.id;
    if (path.resolve(path.dirname(file)) === path.resolve(outDir(id))) await fs.rm(outDir(id), { recursive: true, force: true }).catch(() => {});
    const inRepos = sent.some((r) => r.path !== ".") ? ` in ${sent.map((r) => (r.branch === branch ? r.path : `${r.path} (as ${r.branch})`)).join(", ")}` : "";
    return `Handed over to ${name}, on ${branch}${inRepos}. They will see a Take handoff button in the room on the floor.`;
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
  const { link, answer } = await exchange(cwd, { type: "take", v: PROTOCOL_VERSION, code }, (m): m is HandoffMessage => m.type === "handoff");
  try {
    if (answer.type === "error") stop(said(answer));
    const { handoff } = answer as HandoffMessage;
    const { failures, remote, dir } = await checkoutHere(run, cwd, handoff, handoffDir(claudeDir, handoff.id), timeoutMs);
    // Git's output leaves this machine only after the scan.
    const sent = failures.map((f) => (scan(f.output, patterns) ? { ...f, output: "The end of its output is withheld here: it matches a secret pattern." } : f));
    link.send({ type: "taken", v: PROTOCOL_VERSION, handoff: handoff.id, failures: sent });
    const branch = handoffBranch(handoff.id);
    const own = failures.find((f) => !f.repo);
    const done = handoff.repos.filter((r) => r.path !== "." && !failures.some((f) => f.repo === r.path));
    const checkout = own
      ? `The checkout of ${branch} failed, so this folder and the repos in it are as they were:\n${own.output}`
      : [
          handoff.repos.some((r) => r.path === ".") ? `The repo at ${dir} is now on ${branch}.` : "",
          done.length ? `These repos in ${dir} are now on their handoff branches: ${done.map((r) => `${r.path} (${r.branch})`).join(", ")}.` : "",
          ...failures.map((f) => `The checkout of ${f.repo} failed, so that repo is as it was:\n${f.output}`),
        ]
          .filter(Boolean)
          .join("\n");
    // No setup runs on this path; the agent is told when the repo has one, in case it matters here.
    const setup = remote ? await setupCommand(run, { dir, remote }, process.platform, timeoutMs) : null;
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
