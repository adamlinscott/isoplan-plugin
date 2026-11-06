// What the wake hook does for the machine, without a session: what the login item runs as this person
// logs in (`wake.mjs --login`, src/install/login-item.ts), and what an isoplan://start-runner link
// does (src/connect/main.ts), for the web app's "Restart Isoplan on this machine". As on every
// prompt (main.ts): nothing while the plugin is disabled for the machine; once Claude Code lists it
// as uninstalled, the uninstall in the background, which takes the login item out too, so a machine
// where no session runs again is still cleared; otherwise startRunner, whose lock decides whether a
// runner already runs, so starting one that runs does nothing. At login the off switch,
// `startAtLogin` in runner.json, is read first: off, the login item takes itself out and starts
// nothing.

import path from "node:path";
import { isUninstalling, recordedState, runnerAppDir, wakeScriptPath, type Paths } from "../install/install.js";
import { startsAtLogin, unregisterLoginItem, type LoginItemPlace } from "../install/login-item.js";
import { startRunner, type Started, type StartOptions } from "../runner/start.js";

export interface Outside {
  paths: Paths;
  /** Starts `node <args>` in `cwd`, detached and hidden, and doesn't wait for it. */
  spawn: StartOptions["spawn"];
  /** At login: where the login item is, to take it out while startAtLogin is off. */
  login?: Omit<LoginItemPlace, "node">;
  isAlive?: StartOptions["isAlive"];
}

/** What it did: startRunner's answer; or nothing, as the plugin is `disabled`; or it started the background uninstall (`uninstalling`); or the item took itself out (`off`). */
export type FromOutside = Started | "disabled" | "uninstalling" | "off";

export async function startFromOutside({ paths, spawn, login, isAlive }: Outside): Promise<FromOutside> {
  const { claudeDir } = paths;
  const state = await recordedState(paths).catch(() => "enabled" as const);
  if (state === "uninstalled") {
    // Started in the config folder, never inside the isoplan folder it removes.
    if (!(await isUninstalling(claudeDir))) spawn([wakeScriptPath(claudeDir), "--uninstall"], claudeDir);
    return "uninstalling";
  }
  if (state === "disabled") return "disabled";
  if (login && !(await startsAtLogin(path.join(runnerAppDir(claudeDir), "runner.json"), path.join(claudeDir, "isoplan", "runner.json")))) {
    await unregisterLoginItem({ ...login, claudeDir, script: wakeScriptPath(claudeDir) }).catch(() => []);
    return "off";
  }
  return startRunner({ claudeDir, spawn, ...(isAlive && { isAlive }) });
}
