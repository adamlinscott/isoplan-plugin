// The connect handler's dialogs on this computer: the one window Isoplan opens without being asked
// from a terminal, and only because the person just pressed Connect Claude Code. A question with
// Yes and No (No first, so Enter refuses), and a notice with OK. On Windows a WinForms message box
// from a hidden PowerShell, on top; on a Mac osascript's `display dialog`; on Linux zenity, or
// kdialog. The text goes in through the environment or argv, never into the script, so nothing in
// an office's name can run as code.

import { spawn } from "node:child_process";

/** Runs a program hidden and says how it ended: its exit code (null when it couldn't start) and what it printed. */
export type Exec = (file: string, args: string[], env?: Record<string, string>) => Promise<{ code: number | null; stdout: string }>;

export const exec: Exec = (file, args, env) =>
  new Promise((resolve) => {
    let stdout = "";
    const child = spawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: env ? { ...process.env, ...env } : process.env });
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.on("error", () => resolve({ code: null, stdout }));
    child.on("close", (code) => resolve({ code, stdout }));
  });

const WIN_BOX = (buttons: string, icon: string, button: string) =>
  `Add-Type -AssemblyName System.Windows.Forms; $r = [System.Windows.Forms.MessageBox]::Show($env:ISOPLAN_DIALOG_TEXT, $env:ISOPLAN_DIALOG_TITLE, '${buttons}', '${icon}', '${button}', 'DefaultDesktopOnly'); if ($r -eq 'Yes' -or $r -eq 'OK') { exit 0 } else { exit 1 }`;
const MAC_ASK = [
  "on run argv",
  'display dialog (item 2 of argv) with title (item 1 of argv) buttons {"No", "Yes"} default button "No" cancel button "No" with icon caution giving up after 300',
  'if button returned of result is "Yes" then return "yes"',
  'return "no"',
  "end run",
];
const MAC_TELL = ["on run argv", 'display dialog (item 2 of argv) with title (item 1 of argv) buttons {"OK"} default button "OK" giving up after 120', "end run"];
const osascript = (lines: string[], title: string, text: string): [string, string[]] => ["osascript", [...lines.flatMap((l) => ["-e", l]), title, text]];

/** Asks Yes or No; true only for Yes. Throws when this computer has no way to ask. */
export async function ask(platform: NodeJS.Platform, title: string, text: string, run: Exec = exec): Promise<boolean> {
  if (platform === "win32") {
    const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_BOX("YesNo", "Question", "Button2")], { ISOPLAN_DIALOG_TITLE: title, ISOPLAN_DIALOG_TEXT: text });
    if (r.code === null) throw new Error("couldn't start PowerShell to ask");
    return r.code === 0;
  }
  if (platform === "darwin") {
    const r = await run(...osascript(MAC_ASK, title, text));
    if (r.code === null) throw new Error("couldn't start osascript to ask");
    return r.stdout.trim() === "yes";
  }
  const zenity = await run("zenity", ["--question", "--no-markup", "--title", title, "--text", text]);
  if (zenity.code !== null) return zenity.code === 0;
  const kdialog = await run("kdialog", ["--title", title, "--yesno", text]);
  if (kdialog.code !== null) return kdialog.code === 0;
  throw new Error("no zenity or kdialog to ask with");
}

/** Shows a notice with OK; a problem with a warning sign. Nothing when there is no way to show it. */
export async function tell(platform: NodeJS.Platform, title: string, text: string, problem = false, run: Exec = exec): Promise<void> {
  if (platform === "win32") {
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_BOX("OK", problem ? "Warning" : "Information", "Button1")], { ISOPLAN_DIALOG_TITLE: title, ISOPLAN_DIALOG_TEXT: text });
    return;
  }
  if (platform === "darwin") {
    await run(...osascript(MAC_TELL, title, text));
    return;
  }
  if ((await run("zenity", [problem ? "--warning" : "--info", "--no-markup", "--title", title, "--text", text])).code !== null) return;
  if ((await run("kdialog", ["--title", title, problem ? "--sorry" : "--msgbox", text])).code !== null) return;
  await run("notify-send", [title, text]);
}
