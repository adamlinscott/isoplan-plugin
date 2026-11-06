import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, type DrivenMessage } from "@isoplan/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { createClaudeSetup, installerArgv, type ClaudeSetupOptions } from "./claude-setup.js";

vi.setConfig({ testTimeout: 30000 });

const v = PROTOCOL_VERSION;
const ADA = { id: "claude:ada", name: "Ada" };
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// A fake claude, run with node as a cli.js is: `auth status --json` says signed in once <root>/signed-in
// is there; `auth login` writes its sign-in link, signs in after a moment, then waits on its terminal,
// as `claude auth login` may.
function setup({ script, ...extra }: Partial<Omit<ClaudeSetupOptions, "installer">> & { script?: string } = {}) {
  const root = tempRoot();
  roots.push(root);
  const bin = path.join(root, "claude.js");
  const signedIn = path.join(root, "signed-in");
  const fake = `const fs = require("node:fs");
const args = process.argv.slice(2).join(" ");
if (args === "auth status --json") (process.stdout.write(JSON.stringify({ loggedIn: fs.existsSync(${JSON.stringify(signedIn)}) })), process.exit(0));
if (args === "auth login") {
  process.stdout.write("Opening browser to sign in...\\nhttps://claude.ai/oauth/authorize?code=true&state=s1\\n");
  setTimeout(() => fs.writeFileSync(${JSON.stringify(signedIn)}, ""), 300);
  setInterval(() => {}, 1000);
} else process.exit(2);
`;
  // The installer writes the fake claude where `binary` looks, saying each step, the way the native installer does.
  const installer = path.join(root, "install.js");
  fs.writeFileSync(
    installer,
    script ??
      `const fs = require("node:fs");
console.log("\\x1b[1mSetting up Claude Code...\\x1b[0m");
console.log("token AKIA" + "ABCDEFGHIJKLMNOP");
fs.writeFileSync(${JSON.stringify(bin)}, ${JSON.stringify(fake)});
console.log("Claude Code successfully installed!");
`,
  );
  const sent: DrivenMessage[] = [];
  const s = createClaudeSetup({
    binary: async () => (fs.existsSync(bin) ? bin : null),
    send: (m) => sent.push(m),
    scan: async (text) => (/AKIA[A-Z0-9]{16}/.test(text) ? "aws-key" : null),
    log: () => {},
    cwd: root,
    env: process.env as Record<string, string>,
    installer: [process.execPath, installer],
    signInCheckMs: 100,
    ...extra,
  });
  return { s, sent, bin, fake, signedIn };
}

test("the installer is Anthropic's native one, for Windows in PowerShell and for a Mac in bash", () => {
  expect(installerArgv("win32")).toEqual(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"]);
  expect(installerArgv("darwin")).toEqual(["/bin/bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
});

test("a check finds Claude Code missing, signed out, or ready, and says so only when it changed", async () => {
  const { s, sent, bin, fake, signedIn } = setup();
  expect(await s.check()).toBe("missing");
  expect(sent).toEqual([]);
  fs.writeFileSync(bin, fake);
  expect(await s.check()).toBe("signed-out");
  fs.writeFileSync(signedIn, "");
  expect(await s.check()).toBe("ready");
  expect(sent).toEqual([
    { type: "driven", v, kind: "claude", claude: "signed-out" },
    { type: "driven", v, kind: "claude", claude: "ready" },
  ]);
});

test("an install says each line the installer writes, but one the secret scan matched, then where Claude Code stands", async () => {
  const { s, sent } = setup();
  s.take({ type: "drive", v, kind: "install-claude", id: "c1", by: ADA });
  await s.settled();
  expect(sent).toEqual([
    { type: "driven", v, kind: "claude", claude: "missing", doing: "installing", id: "c1" },
    { type: "driven", v, kind: "claude", claude: "missing", doing: "installing", progress: "Setting up Claude Code...", id: "c1" },
    { type: "driven", v, kind: "claude", claude: "missing", doing: "installing", progress: "Claude Code successfully installed!", id: "c1" },
    // Fresh, it has its own sign-in to do: the Claude app's isn't its.
    { type: "driven", v, kind: "claude", claude: "signed-out", id: "c1" },
  ]);
  expect(s.state()).toBe("signed-out");
});

test("an install that fails says why, with the installer's last line", async () => {
  const { s, sent } = setup({ script: `console.log("Could not download the installer"); process.exit(1);` });
  s.take({ type: "drive", v, kind: "install-claude", id: "c1", by: ADA });
  await s.settled();
  expect(sent.at(-1)).toEqual({ type: "driven", v, kind: "claude", claude: "missing", failed: "The installer stopped with code 1: Could not download the installer", id: "c1" });
});

test("an install that runs past its time is stopped, and says so", async () => {
  const { s, sent } = setup({ script: `setInterval(() => {}, 1000);`, installMs: 300 });
  s.take({ type: "drive", v, kind: "install-claude", id: "c1", by: ADA });
  await s.settled();
  expect(sent.at(-1)).toMatchObject({ kind: "claude", claude: "missing", failed: expect.stringMatching(/didn't finish within/), id: "c1" });
});

test("a sign-in sends its link, ends the login once Claude Code is signed in, and says it is ready", async () => {
  const { s, sent, bin, fake } = setup();
  fs.writeFileSync(bin, fake);
  await s.check();
  s.take({ type: "drive", v, kind: "sign-in-claude", id: "c2", by: ADA });
  await s.settled();
  expect(sent.slice(1)).toEqual([
    { type: "driven", v, kind: "claude", claude: "signed-out", doing: "signing-in", id: "c2" },
    { type: "driven", v, kind: "claude", claude: "signed-out", doing: "signing-in", url: "https://claude.ai/oauth/authorize?code=true&state=s1", id: "c2" },
    { type: "driven", v, kind: "claude", claude: "ready", id: "c2" },
  ]);
});

test("a second request while one runs is refused busy, and a sign-in with no Claude Code no-claude", async () => {
  const { s, sent } = setup();
  s.take({ type: "drive", v, kind: "sign-in-claude", id: "c2", by: ADA });
  await s.settled();
  expect(sent).toEqual([{ type: "driven", v, kind: "refused", id: "c2", reason: "no-claude" }]);
  s.take({ type: "drive", v, kind: "install-claude", id: "c1", by: ADA });
  s.take({ type: "drive", v, kind: "install-claude", id: "c3", by: ADA });
  await s.settled();
  expect(sent).toContainEqual({ type: "driven", v, kind: "refused", id: "c3", reason: "busy" });
});
