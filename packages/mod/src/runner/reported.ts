// A session the runner drives from the floor (session.ts) is reported the way the wake hook reports
// any session without the plugin's hooks module (src/wake): by a detached data layer. The wake hook
// alone isn't enough (#92): it runs as a prompt goes in, so the data layer it starts may find the
// transcript still empty and stop, and one that ends between turns isn't started again until the
// next. So as the session's process opens, and again every `drivenReportSeconds` while it runs, the
// runner does what the wake hook does (wake.ts): it starts one unless one holds the session's lock,
// or a hold-off does, using the data layer wake.json records (or a newer copy Claude Code installed
// since), unless Claude Code lists the plugin as uninstalled or disabled for the session's folder,
// or the session has had no activity for longer than config.json's `idleMinutes`: a data layer
// started then would stop again at once as quiet.

import { spawn as spawnProcess } from "node:child_process";
import { recordedState, type Paths } from "../install/install.js";
import { wake, type WakeOptions } from "../wake/wake.js";

/** What runner.json says of it. */
export interface ReportedSettings {
  /** How often the runner looks again whether a driven session's data layer is running, and starts one if not. */
  drivenReportSeconds: number;
}

export interface ReportedOptions {
  paths: Paths;
  /** How often to look again, in seconds, from runner.json. */
  everySeconds: () => Promise<number>;
  /** How long a session may be quiet before its data layer stops, in minutes, from config.json. */
  idleMinutes: () => Promise<number>;
  log: (text: string) => void;
  /** Starts `node <args>` in `cwd`, detached and hidden, and doesn't wait for it. */
  spawn?: WakeOptions["spawn"];
  isAlive?: WakeOptions["isAlive"];
}

const hiddenStart: WakeOptions["spawn"] = (args, cwd) =>
  spawnProcess(process.execPath, args, { cwd, detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();

/**
 * For a driven session's process as it opens: keeps the session reported until the returned stop
 * is called, as the process ends. `lastActive` is when the process last did anything, in ms.
 */
export function keepReported(o: ReportedOptions): (session: string, folder: string, lastActive: () => number) => () => void {
  const spawn = o.spawn ?? hiddenStart;
  return (session, folder, lastActive) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let seconds = 0; // the last interval runner.json gave
    const look = async () => {
      if (Date.now() - lastActive() > (await o.idleMinutes()) * 60000) return;
      if ((await recordedState(o.paths, folder).catch(() => "enabled" as const)) !== "enabled") return;
      const input = JSON.stringify({ session_id: session, cwd: folder });
      // A look under way as the process ends starts nothing.
      const start: WakeOptions["spawn"] = (args, cwd) => {
        if (stopped) return;
        spawn(args, cwd);
        o.log(`started a data layer to report driven session ${session}`);
      };
      await wake(input, { claudeDir: o.paths.claudeDir, spawn: start, project: folder, plugins: o.paths.plugins, ...(o.isAlive ? { isAlive: o.isAlive } : {}) });
    };
    let said = ""; // a lasting problem is logged once
    const next = async () => {
      try {
        await look();
        said = "";
      } catch (err) {
        const text = `couldn't start a data layer for driven session ${session}: ${(err as Error)?.message ?? String(err)}`;
        if (text !== said) o.log(text);
        said = text;
      }
      if (stopped) return;
      // runner.json unreadable for a moment (a plugin update): the last interval it gave.
      seconds = await o.everySeconds().catch((err: Error) => {
        if (!seconds) o.log(`stopped looking after driven session ${session}'s data layer: ${err.message}`);
        return seconds;
      });
      if (!seconds || stopped) return;
      timer = setTimeout(() => void next(), seconds * 1000);
      timer.unref?.();
    };
    void next();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  };
}
