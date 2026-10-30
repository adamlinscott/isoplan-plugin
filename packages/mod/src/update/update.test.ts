import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { takeLock } from "../wake/lock.js";
import { checkForUpdate, START_GAP_MS, turnOnAutoUpdate, updateLockPath, updateRecordPath, updatesOffBy, type Ran } from "./update.js";

const OTHER = 4242; // a pid that isn't this process
const SOURCE = { source: "github", repo: "adamlinscott/isoplan-plugin" };

function setup(settings: unknown = { extraKnownMarketplaces: { isoplan: { source: SOURCE } } }) {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const settingsFile = path.join(claudeDir, "settings.json");
  fs.mkdirSync(claudeDir, { recursive: true });
  if (settings !== null) fs.writeFileSync(settingsFile, typeof settings === "string" ? settings : JSON.stringify(settings));
  const ran: { argv: string[]; cwd: string }[] = [];
  let answers: Ran[] = [];
  let clock = 1_000_000;
  const check = (gapMs = START_GAP_MS) =>
    checkForUpdate({
      claudeDir,
      settings: settingsFile,
      id: "isoplan@isoplan",
      cwd: "/work/repo",
      claude: ["/bin/node", "/lib/claude/cli.js"],
      gapMs,
      run: async (argv, cwd) => (ran.push({ argv, cwd }), answers.shift() ?? { code: 0, output: "" }),
      now: () => clock,
      isAlive: (pid) => pid === OTHER || pid === process.pid,
    });
  return {
    claudeDir,
    settingsFile,
    ran,
    check,
    answer: (...list: Ran[]) => void (answers = list),
    tick: (ms: number) => void (clock += ms),
    read: () => JSON.parse(fs.readFileSync(settingsFile, "utf8")),
  };
}

test("updates off: by any of Claude Code's variables, unless FORCE_AUTOUPDATE_PLUGINS turns plugin updates back on", () => {
  expect(updatesOffBy({})).toBeNull();
  expect(updatesOffBy({ DISABLE_AUTOUPDATER: "1" })).toBe("DISABLE_AUTOUPDATER");
  expect(updatesOffBy({ DISABLE_UPDATES: "true" })).toBe("DISABLE_UPDATES");
  expect(updatesOffBy({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" })).toBe("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC");
  expect(updatesOffBy({ DISABLE_AUTOUPDATER: "0", DISABLE_UPDATES: "" })).toBeNull();
  expect(updatesOffBy({ DISABLE_UPDATES: "1", FORCE_AUTOUPDATE_PLUGINS: "1" })).toBeNull();
});

test("auto-update: turned on only on the marketplace's own entry, never over a choice made, and no entry made up", async () => {
  const s = setup({ model: "opus", extraKnownMarketplaces: { isoplan: { source: SOURCE }, other: { source: SOURCE } } });
  expect(await turnOnAutoUpdate(s.settingsFile, "isoplan")).toMatch(/turned on Claude Code's auto-update for the isoplan marketplace/);
  expect(s.read()).toEqual({ model: "opus", extraKnownMarketplaces: { isoplan: { source: SOURCE, autoUpdate: true }, other: { source: SOURCE } } });
  expect(await turnOnAutoUpdate(s.settingsFile, "isoplan")).toBeNull();

  const off = setup({ extraKnownMarketplaces: { isoplan: { source: SOURCE, autoUpdate: false } } });
  expect(await turnOnAutoUpdate(off.settingsFile, "isoplan")).toBeNull();
  expect(off.read().extraKnownMarketplaces.isoplan.autoUpdate).toBe(false);

  const none = setup({ model: "opus" });
  expect(await turnOnAutoUpdate(none.settingsFile, "isoplan")).toBeNull();
  expect(fs.readFileSync(none.settingsFile, "utf8")).toBe(JSON.stringify({ model: "opus" }));
  const missing = setup(null);
  expect(await turnOnAutoUpdate(missing.settingsFile, "isoplan")).toBeNull();
  expect(fs.existsSync(missing.settingsFile)).toBe(false);
  const broken = setup("{ broken");
  await expect(turnOnAutoUpdate(broken.settingsFile, "isoplan")).rejects.toThrow(/isn't valid JSON/);
});

test("check: refreshes the marketplace, then updates the plugin, hidden, in the session's project, and says what each said", async () => {
  const s = setup();
  s.answer({ code: 0, output: "Updating marketplace…\n\u001b[32m✔ Successfully updated marketplace: isoplan\u001b[39m\n" }, { code: 0, output: "✔ Plugin \"isoplan\" updated from 6658f568c1e1 to a1b2c3d4e5f6 for scope user. Restart to apply changes.\n" });
  const checked = await s.check();
  expect(s.ran).toEqual([
    { argv: ["/bin/node", "/lib/claude/cli.js", "plugin", "marketplace", "update", "isoplan"], cwd: "/work/repo" },
    { argv: ["/bin/node", "/lib/claude/cli.js", "plugin", "update", "isoplan@isoplan"], cwd: "/work/repo" },
  ]);
  expect(checked).toEqual({
    ran: true,
    said: [
      `turned on Claude Code's auto-update for the isoplan marketplace in ${s.settingsFile}`,
      "claude plugin marketplace update isoplan: ✔ Successfully updated marketplace: isoplan",
      'claude plugin update isoplan@isoplan: ✔ Plugin "isoplan" updated from 6658f568c1e1 to a1b2c3d4e5f6 for scope user. Restart to apply changes.',
    ],
  });
  expect(JSON.parse(fs.readFileSync(updateRecordPath(s.claudeDir), "utf8"))).toEqual({ checkedAt: 1_000_000 });
  expect(fs.existsSync(updateLockPath(s.claudeDir))).toBe(false);
});

test("check: a marketplace that can't be refreshed stops it there", async () => {
  const s = setup();
  s.answer({ code: 1, output: "✘ Failed to refresh marketplace 'isoplan': network\n" });
  expect((await s.check()).said.at(-1)).toBe("claude plugin marketplace update isoplan: failed with exit code 1: ✘ Failed to refresh marketplace 'isoplan': network");
  expect(s.ran).toHaveLength(1);
  s.ran.length = 0;
  s.tick(START_GAP_MS);
  s.answer({ code: null, output: "" });
  expect((await s.check()).said.at(-1)).toBe("claude plugin marketplace update isoplan: didn't finish");
});

test("check: once per gap on the machine, and never two at once", async () => {
  const s = setup();
  expect((await s.check()).ran).toBe(true);
  s.tick(START_GAP_MS - 1);
  expect(await s.check()).toEqual({ ran: false, said: [] }); // another session checked just now
  s.tick(1);
  expect((await s.check()).ran).toBe(true);
  s.tick(6 * 3600000);
  await takeLock(updateLockPath(s.claudeDir), OTHER);
  expect((await s.check()).ran).toBe(false); // one is running
  expect(s.ran).toHaveLength(4);
});
