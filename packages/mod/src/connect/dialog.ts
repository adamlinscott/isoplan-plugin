// The connect handler's dialogs on this computer: the one window Isoplan opens without being asked
// from a terminal, and only because the person just pressed Connect Claude Code. A question with
// Connect and Cancel, where Cancel is the default and no key but a click on Connect, or Tab to it
// and Enter, connects; it cancels itself after five minutes. And a notice with OK. On Windows a
// small WinForms form from a hidden PowerShell, on top (a message box's Yes takes the Y key); on a
// Mac osascript's `display dialog`; on Linux zenity, with markup off. kdialog would read the text as
// rich text, so without zenity Linux has no confirmation, and nothing connects. The text goes in
// through the environment or argv, never into the script, so nothing an office says can run.

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

/** How long the question waits before it cancels itself. */
export const ASK_SECONDS = 300;

// PowerShell runs hidden (no console window), and Windows applies a hidden start to the first window
// the process shows: the question itself would be invisible, and cancel itself unseen. A throwaway
// window hidden first takes that, so the question shows.
const WIN_FIRST_SHOW = [
  `Add-Type -Namespace IsoplanWin -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'`,
  "$first = New-Object System.Windows.Forms.Form; [void][IsoplanWin.User32]::ShowWindow($first.Handle, 0); $first.Dispose()",
];

/** The Windows form: exits 0 for Connect, 2 for Cancel, Esc, closing it or the time running out, 1 when it couldn't be shown. */
export const WIN_FORM = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
  ...WIN_FIRST_SHOW,
  "[System.Windows.Forms.Application]::EnableVisualStyles()",
  "$f = New-Object System.Windows.Forms.Form",
  "$f.Text = $env:ISOPLAN_DIALOG_TITLE",
  "$f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true",
  "$f.AutoSize = $true; $f.AutoSizeMode = 'GrowAndShrink'; $f.Padding = New-Object System.Windows.Forms.Padding 16",
  "$layout = New-Object System.Windows.Forms.FlowLayoutPanel; $layout.FlowDirection = 'TopDown'; $layout.AutoSize = $true; $layout.AutoSizeMode = 'GrowAndShrink'",
  "$label = New-Object System.Windows.Forms.Label; $label.Text = $env:ISOPLAN_DIALOG_TEXT; $label.UseMnemonic = $false; $label.AutoSize = $true; $label.MaximumSize = New-Object System.Drawing.Size 480, 0",
  "$row = New-Object System.Windows.Forms.FlowLayoutPanel; $row.FlowDirection = 'RightToLeft'; $row.AutoSize = $true; $row.Anchor = 'Right'",
  "$cancel = New-Object System.Windows.Forms.Button; $cancel.Text = 'Cancel'; $cancel.UseMnemonic = $false; $cancel.AutoSize = $true; $cancel.DialogResult = 'Cancel'",
  "$connect = New-Object System.Windows.Forms.Button; $connect.Text = 'Connect'; $connect.UseMnemonic = $false; $connect.AutoSize = $true; $connect.DialogResult = 'OK'",
  "$row.Controls.AddRange(@($cancel, $connect)); $layout.Controls.AddRange(@($label, $row)); $f.Controls.Add($layout)",
  "$f.AcceptButton = $cancel; $f.CancelButton = $cancel",
  `$timer = New-Object System.Windows.Forms.Timer; $timer.Interval = ${ASK_SECONDS * 1000}; $timer.Add_Tick({ $f.DialogResult = 'Cancel'; $f.Close() })`,
  "$f.Add_Shown({ $f.Activate(); $cancel.Focus(); $timer.Start() })",
  "$r = $f.ShowDialog(); $timer.Stop()",
  "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { exit 0 } else { exit 2 }",
].join("\n");
const WIN_TELL = (icon: string) =>
  `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; ${WIN_FIRST_SHOW.join("; ")}; [void][System.Windows.Forms.MessageBox]::Show($env:ISOPLAN_DIALOG_TEXT, $env:ISOPLAN_DIALOG_TITLE, 'OK', '${icon}', 'Button1', 'DefaultDesktopOnly')`;
const MAC_ASK = [
  "on run argv",
  "try",
  `set answer to display dialog (item 2 of argv) with title (item 1 of argv) buttons {"Cancel", "Connect"} default button "Cancel" with icon caution giving up after ${ASK_SECONDS}`,
  "on error number -128",
  'return "cancel"',
  "end try",
  'if gave up of answer then return "cancel"',
  'if button returned of answer is "Connect" then return "connect"',
  'return "cancel"',
  "end run",
];
const MAC_TELL = ["on run argv", 'display dialog (item 2 of argv) with title (item 1 of argv) buttons {"OK"} default button "OK" giving up after 120', "end run"];
const osascript = (lines: string[], title: string, text: string): [string, string[]] => ["osascript", [...lines.flatMap((l) => ["-e", l]), title, text]];
const powershell = (script: string, title: string, text: string): Parameters<Exec> => ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { ISOPLAN_DIALOG_TITLE: title, ISOPLAN_DIALOG_TEXT: text }];

/** Asks Connect or Cancel; true only for Connect. Throws when the question couldn't be shown, which is not a Cancel. */
export async function ask(platform: NodeJS.Platform, title: string, text: string, run: Exec = exec): Promise<boolean> {
  if (platform === "win32") {
    const r = await run(...powershell(WIN_FORM, title, text));
    if (r.code === 0 || r.code === 2) return r.code === 0;
    throw new Error(r.code === null ? "PowerShell couldn't be started" : `PowerShell couldn't show it (exit ${r.code})`);
  }
  if (platform === "darwin") {
    const r = await run(...osascript(MAC_ASK, title, text));
    const said = r.stdout.trim();
    if (r.code === 0 && (said === "connect" || said === "cancel")) return said === "connect";
    throw new Error(r.code === null ? "osascript couldn't be started" : `osascript couldn't show it (exit ${r.code})`);
  }
  const r = await run("zenity", ["--question", "--no-markup", "--title", title, "--text", text, "--ok-label", "Connect", "--cancel-label", "Cancel", "--default-cancel", "--timeout", String(ASK_SECONDS)]);
  // 1 is Cancel or closing it, 5 the time running out.
  if (r.code === 0 || r.code === 1 || r.code === 5) return r.code === 0;
  throw new Error(r.code === null ? "zenity isn't installed, and it is the only way Isoplan asks on Linux" : `zenity couldn't show it (exit ${r.code})`);
}

/** Shows a notice with OK; a problem with a warning sign. Nothing when there is no way to show it. */
export async function tell(platform: NodeJS.Platform, title: string, text: string, problem = false, run: Exec = exec): Promise<void> {
  if (platform === "win32") await run(...powershell(WIN_TELL(problem ? "Warning" : "Information"), title, text));
  else if (platform === "darwin") await run(...osascript(MAC_TELL, title, text));
  else await run("zenity", [problem ? "--warning" : "--info", "--no-markup", "--title", title, "--text", text, "--timeout", "120"]);
}
