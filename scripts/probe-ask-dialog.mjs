// A manual check of what the hooks module relies on to answer an agent's question from the floor
// (adamlinscott/isoplan#50): Claude Code's AskUserQuestion dialog shows while a tool.call hook that
// has called `next` waits, and a hook that then answers `{ result: { questions, answers } }` closes
// the dialog and is taken as the question's answer. It also records the shape the dialog itself
// gives a multi-select answer, which the floor copies.
//
//   node scripts/probe-ask-dialog.mjs --node-pty <folder holding node_modules/node-pty> [--claude <claude binary>]
//
// Nothing here opens a window: Claude Code runs in a hidden pseudo-terminal (ConPTY on Windows),
// with a throwaway CLAUDE_CONFIG_DIR, so your own config is never read or written, and a throwaway
// mod that raises the question itself ($.ui.ask), so no model is called and no sign-in is needed.
// Get node-pty with `npm install node-pty` in any empty folder. The model's own reading of the
// answer isn't checked here (no model runs): the engine gives a hook's `{ result }` to the model
// through the tool's own mapper, as the mod API's types say of ToolCallResult.
//
// Last run (Claude Code 2.1.312, Windows 11):
//   floor answer: the dialog was on screen while the hook waited, closed once it answered, and the
//     question resolved to "Alpha".
//   multi-select, Alpha and Beta picked in the dialog: answers {"Which ones?":"Alpha, Beta"}, the
//     labels in option order joined with ", ". The floor sends the same.

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ptyDir = arg("--node-pty");
if (!ptyDir) {
  console.error("usage: node scripts/probe-ask-dialog.mjs --node-pty <folder holding node_modules/node-pty> [--claude <claude binary>]");
  process.exit(2);
}
const pty = createRequire(path.join(path.resolve(ptyDir), "x.js"))("node-pty");
const claude = arg("--claude") ?? (process.platform === "win32" ? path.join(os.homedir(), ".local", "bin", "claude.exe") : "claude");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "isoplan-probe-"));
const config = path.join(root, "config");
const project = path.join(root, "project");
const mod = path.join(root, "mod");
const log = path.join(root, "log.json").replace(/\\/g, "/");
for (const dir of [config, project, path.join(mod, ".claude-plugin"), path.join(mod, "hooks")]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(config, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, theme: "dark", projects: { [project.replace(/\\/g, "/")]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }));
fs.writeFileSync(path.join(mod, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "isoplan-probe", version: "0.0.0", description: "Asks a question through Claude Code's own dialog" }));
fs.writeFileSync(path.join(mod, "hooks", "hooks.json"), JSON.stringify({ modules: ["./register.ts"] }));
// /probe-floor: the hook answers after 3 s, as the floor would. /probe-multi: the dialog answers.
fs.writeFileSync(
  path.join(mod, "hooks", "register.ts"),
  `const LOG = ${JSON.stringify(log)};
const said: Record<string, unknown> = {};
let mode = "";
const note = ($: any, key: string, value: unknown) => { said[key] = value; void $.fs.write(LOG, JSON.stringify(said)).catch(() => {}); };
export const register = (on: any) => {
  on("session.start", async ($: any, e: any, next: any) => {
    for (const name of ["probe-floor", "probe-multi"]) await $.command.register({ name, description: name });
    return next(e);
  });
  on("command.run", async ($: any, e: any, next: any) => {
    if (e.command !== "probe-floor" && e.command !== "probe-multi") return next(e);
    mode = e.command;
    const options = mode === "probe-multi" ? { options: ["Alpha", "Beta", "Gamma"], multiSelect: true } : ["Alpha", "Beta"];
    try {
      note($, mode + ":asked", await $.ui.ask(mode === "probe-multi" ? "Which ones?" : "Which one?", options));
    } catch (err: any) {
      note($, mode + ":asked", "rejected: " + String((err && err.message) || err));
    }
    return { text: "probe done" };
  });
  on("tool.call", { tool: "AskUserQuestion" }, async ($: any, e: any, next: any) => {
    const ran = next(e);
    ran.catch(() => {});
    if (mode === "probe-multi") {
      const r = await ran;
      note($, "probe-multi:result", r.result);
      return r;
    }
    const first = await Promise.race([ran.then(() => "dialog"), $.clock.sleep(3000).then(() => "floor")]);
    note($, "probe-floor:first", first);
    if (first === "dialog") return ran;
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: "Alpha" } } };
  });
};
`,
);

const env = {};
for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDE|ORCA|ANTHROPIC)/i.test(k)) env[k] = v;
env.CLAUDE_CONFIG_DIR = config;
const term = pty.spawn(claude, ["--plugin-dir", mod], { name: "xterm-256color", cols: 140, rows: 45, cwd: project, env, useConpty: true });
let screen = "";
term.onData((d) => (screen += d));
const plain = (s) => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\s+/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const said = () => {
  try {
    return JSON.parse(fs.readFileSync(log, "utf8"));
  } catch {
    return {};
  }
};
const type = async (keys) => {
  for (const k of keys) {
    term.write(k);
    await sleep(400);
  }
};

let failed = false;
const check = (what, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
  failed ||= !ok;
};
try {
  await sleep(12000);
  await type(["/probe-floor", "\r"]);
  await sleep(1500);
  check("the dialog shows while the hook waits", plain(screen).includes("Whichone?"));
  const mark = screen.length;
  await sleep(4000);
  check("the hook's { result } came first", said()["probe-floor:first"] === "floor");
  check("the question resolved to the hook's answer", said()["probe-floor:asked"] === "Alpha", JSON.stringify(said()["probe-floor:asked"]));
  check("the dialog closed", !plain(screen.slice(mark)).includes("Entertoselect"));

  // Multi-select in the dialog: space picks Alpha and Beta, Enter on Submit, then Enter on the
  // review's "Submit answers".
  await type(["/probe-multi", "\r"]);
  await sleep(1500);
  await type([" ", "\x1b[B", " ", "\x1b[B", "\x1b[B", "\x1b[B", "\r", "\r"]);
  await sleep(1500);
  const result = said()["probe-multi:result"];
  check("a multi-select answer is the picked labels joined with \", \"", result?.answers?.["Which ones?"] === "Alpha, Beta", JSON.stringify(result?.answers ?? null));
  if (!result) console.log(plain(screen.slice(-3000)));
} finally {
  term.kill();
  await sleep(500);
  fs.rmSync(root, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
