// The shell reader: the files a shell command writes, so a write through Bash, PowerShell or cmd
// counts as an edit just as an Edit does, and the files it reads, so a read through the shell counts
// as checking a file just as a Read does. It is a heuristic: it reads redirects and a handful of
// commands (below), and skips anything it can't read rather than guess — a path with a variable or
// a glob in it, a `cd` to somewhere it can't place, a script the command runs. Files that programs
// a command starts write or read stay invisible.
//
// It reads Bash and zsh, PowerShell (on Windows or not), and cmd, which a command reaches through
// `cmd /c "…"`; `powershell -Command "…"`, `pwsh -c` and `bash -c` / `sh -c` / `zsh -c` are read
// in their own shell too. Absolute paths, paths relative to the folder, and `~` (with `home`) are
// placed; Git Bash's /c/… is C:/… on a Windows cwd.
//
// Within one chained command (&&, ||, ;, |, newlines) it follows the folder: cd (cmd's cd /d too),
// pushd and popd, and PowerShell's Set-Location, sl, chdir, Push-Location and Pop-Location. Across
// commands it doesn't need to: the folder a command starts in is the transcript line's cwd (see
// claude-code.ts). It also names the folders the command's programs run in, after any cd, and the
// ones a program is pointed at — git -C, --git-dir, --work-tree; npm --prefix; pnpm -C, --dir;
// yarn --cwd; make -C, --directory — so a command run in another repo can be placed there (#74).
//
// What counts as a write:
//   >  >>              to a file (not 2>, >&, &>, /dev/null, $null or nul); heredocs are skipped over
//   tee [-a] f…        sed -i / perl -i … f…
//   cp / mv / install  the last path is the target (a folder target takes each source's name)
//   rm f…, touch f…
//   Set-Content, Add-Content, Out-File    -Path / -FilePath / -LiteralPath, or the first positional
//   New-Item -ItemType File               -Path (with -Name), or the first positional
//   Copy-Item, Move-Item (cp, cpi, copy, mv, mi, move)   -Destination, or the last positional
//   Remove-Item (rm, ri, del, erase, rmdir)               -Path / -LiteralPath, or every positional
//   cmd: copy, xcopy, move (the last path), del, erase
//
// What counts as a read: only a command's file arguments (not input redirects):
//   cat, head, tail, less, more   sed without -i (the files after the script)
//   Get-Content (gc, cat, type in PowerShell)   -Path / -LiteralPath, or the first positional
//   cmd: type

import { isAbsolute, isWindowsPath, join, normalize } from "./git.js";

/** A word of the command, quotes stripped; unsafe when a variable, substitution or glob is in it. */
interface Word {
  text: string;
  unsafe: boolean;
}

type Op = { op: ";" | "write" | "skip" };
type Token = Word | Op;

interface Segment {
  words: Word[];
  writes: Word[];
}

type Shell = "bash" | "powershell" | "cmd";

export interface ShellOptions {
  /** Read the command as PowerShell (backtick escapes, backslashes literal). */
  powershell?: boolean;
  /** Read it as cmd (caret escapes, double quotes only, %VAR% variables). */
  cmd?: boolean;
  /** The home folder `~` stands for; without it, a path starting with `~` is skipped. */
  home?: string | null;
}

export interface ShellFiles {
  writes: string[];
  reads: string[];
  dirs: string[];
}

/**
 * { writes, reads, dirs }: the absolute paths `command` writes and reads, and the folders its
 * programs run in, in order, each once. Relative paths resolve against `cwd`, or against where a
 * `cd` in the command moved to; with no cwd they are skipped.
 */
export function shellFiles(command: string, cwd: string | null, { powershell = false, cmd = false, home = null }: ShellOptions = {}): ShellFiles {
  const shell: Shell = cmd ? "cmd" : powershell ? "powershell" : "bash";
  const win = Boolean(cwd) && isWindowsPath(cwd!);
  let dir = cwd ? normalize(cwd) : null;
  const pushed: (string | null)[] = []; // the folders pushd left, for popd
  const out: ShellFiles = { writes: [], reads: [], dirs: [] };
  const at = (w: Word | undefined) => place(w, dir, win, home);
  const keep = (list: string[], p: string | null) => {
    if (p && !list.includes(p)) list.push(p);
  };
  for (const s of segments(tokens(command, shell))) {
    for (const w of s.writes) keep(out.writes, at(w));
    let words = s.words;
    if (shell === "bash") while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!.text)) words = words.slice(1);
    if (!words.length || words[0]!.unsafe) continue;
    const name = base(words[0]!.text).toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
    // cmd's switches (/q, /d, /y…) are not paths.
    const args = shell === "cmd" ? words.slice(1).filter((w) => !/^\/[a-z?](:\S*)?$/i.test(w.text)) : words.slice(1);
    const inner = nested(name, words.slice(1));
    if (inner) {
      const got = shellFiles(inner.text, dir, { ...inner.as, home });
      for (const k of ["writes", "reads", "dirs"] as const) for (const p of got[k]) keep(out[k], p);
      continue;
    }
    if (CD.has(name)) {
      const { named, positional } = shell === "powershell" ? psArgs(args) : { named: {} as PsArgs["named"], positional: shell === "bash" ? posix(args).positional : args };
      const to = named.path || named.literalpath || (shell === "cmd" && positional.length > 1 ? { text: positional.map((w) => w.text).join(" "), unsafe: positional.some((w) => w.unsafe) } : positional[0]);
      if (name === "pushd" || name === "push-location") pushed.push(dir);
      dir = to && to !== true && to.text !== "-" ? at(to) : null;
      continue;
    }
    if (name === "popd" || name === "pop-location") {
      dir = pushed.length ? pushed.pop()! : null;
      continue;
    }
    keep(out.dirs, runsIn(name, args, dir, (w, from) => place(w, from, win, home)));
    const writer = pick(shell, name, CMD_WRITERS, PS_WRITERS, WRITERS);
    if (writer) for (const w of writer(args)) keep(out.writes, at(w));
    const reader = pick(shell, name, CMD_READERS, PS_READERS, READERS);
    if (reader) for (const r of reader(args)) if (r.text !== "-") keep(out.reads, at(r));
  }
  return out;
}

// A shell's own table first (cmd's, or PowerShell's), then the common one.
function pick(shell: Shell, name: string, cmd: Record<string, Files>, ps: Record<string, Files>, common: Record<string, Files>): Files | undefined {
  const own = shell === "cmd" ? cmd : shell === "powershell" ? ps : null;
  if (own && Object.hasOwn(own, name)) return own[name];
  if (shell === "cmd") return undefined;
  return Object.hasOwn(common, name) ? common[name] : undefined;
}

// A command that runs another shell on a command line of its own: that line, and how to read it.
function nested(name: string, args: Word[]): { text: string; as: ShellOptions } | null {
  const rest = (from: number) => (from >= 0 && from < args.length && !args.slice(from).some((w) => w.unsafe) ? args.slice(from).map((w) => w.text).join(" ") : null);
  let text: string | null = null;
  let as: ShellOptions = {};
  if (name === "cmd") {
    text = rest(args.findIndex((w) => /^\/[ck]$/i.test(w.text)) + 1 || -1);
    as = { cmd: true };
  } else if (name === "powershell" || name === "pwsh") {
    text = rest(args.findIndex((w) => /^-(c|command|com|comm|comma|comman)$/i.test(w.text)) + 1 || -1);
    as = { powershell: true };
  } else if (name === "bash" || name === "sh" || name === "zsh") {
    const i = args.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w.text));
    const w = i >= 0 ? args[i + 1] : undefined;
    text = w && !w.unsafe ? w.text : null;
  }
  return text ? { text, as } : null;
}

// The folder a program runs in: where the shell is, or where its own flag points it.
function runsIn(name: string, args: Word[], dir: string | null, at: (w: Word, from: string | null) => string | null): string | null {
  const flag = (names: string[]): Word | null => {
    let hit: Word | null = null;
    for (let i = 0; i < args.length; i++) {
      const t = args[i]!.text;
      const eq = /^(--?[A-Za-z-]+)=(.*)$/.exec(t);
      if (eq && names.includes(eq[1]!)) hit = { text: eq[2]!, unsafe: args[i]!.unsafe };
      else if (names.includes(t) && args[i + 1]) hit = args[++i]!;
    }
    return hit;
  };
  if (name === "git") return gitDir(args, dir, at);
  const to =
    name === "npm" ? flag(["--prefix", "-C"]) : name === "pnpm" ? flag(["-C", "--dir"]) : name === "yarn" ? flag(["--cwd"]) : name === "make" || name === "gmake" ? flag(["-C", "--directory"]) : null;
  return to ? at(to, dir) : dir;
}

// The folder git works in: each `-C <dir>` before the subcommand moves it, relative to the last;
// --work-tree names it, and --git-dir's repo is the folder its .git is in.
function gitDir(args: Word[], dir: string | null, at: (w: Word, from: string | null) => string | null): string | null {
  let here = dir;
  let tree: string | null = null;
  let gitDirAt: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!.text;
    const eq = /^(--git-dir|--work-tree)=(.*)$/.exec(t);
    const value = (w: Word | undefined) => (w ? at(w, here) : null);
    if (t === "-C" && args[i + 1]) here = at(args[++i]!, here);
    else if (eq) (eq[1] === "--git-dir" ? (gitDirAt = value({ text: eq[2]!, unsafe: args[i]!.unsafe })) : (tree = value({ text: eq[2]!, unsafe: args[i]!.unsafe })));
    else if (t === "--git-dir") gitDirAt = value(args[++i]);
    else if (t === "--work-tree") tree = value(args[++i]);
    else if (t === "-c" || t === "--namespace") i++;
    else if (!t.startsWith("-")) break;
  }
  if (tree) return tree;
  if (gitDirAt) return /\/\.git$/i.test(gitDirAt) ? gitDirAt.slice(0, -5) || "/" : gitDirAt;
  return here;
}

// The commands that move the folder relative paths resolve against: Bash's, PowerShell's and cmd's names.
const CD = new Set(["cd", "pushd", "chdir", "set-location", "sl", "push-location"]);

type Files = (args: Word[]) => Word[];

const WRITERS: Record<string, Files> = {
  tee: (args) => posix(args).positional,
  touch: (args) => posix(args, ["-d", "-t", "-r"]).positional,
  sed: (args) => sedFiles(args).written,
  perl: (args) => sedFiles(args).written,
  cp: (args) => copyTarget(args, ["-S"]),
  mv: (args) => copyTarget(args, ["-S"]),
  install: (args) => copyTarget(args, ["-m", "-o", "-g", "-S"]),
  "set-content": (args) => one(psArgs(args), ["path", "literalpath"]),
  "add-content": (args) => one(psArgs(args), ["path", "literalpath"]),
  "out-file": (args) => one(psArgs(args), ["filepath", "literalpath", "path"]),
  "new-item": newItem,
  rm: (args) => posix(args).positional,
};

// PowerShell's own: its aliases of Copy-Item, Move-Item and Remove-Item shadow Bash's commands.
const copyItem: Files = (args) => {
  const { named, positional } = psArgs(args);
  const to = named.destination;
  if (to && to !== true) return [to];
  return positional.length >= 2 ? [positional[positional.length - 1]!] : [];
};
const removeItem: Files = (args) => {
  const { named, positional } = psArgs(args);
  const hit = [named.path, named.literalpath].find((v): v is Word => !!v && v !== true);
  return hit ? [hit] : positional;
};
const PS_WRITERS: Record<string, Files> = {
  "copy-item": copyItem,
  cpi: copyItem,
  copy: copyItem,
  cp: copyItem,
  "move-item": copyItem,
  mi: copyItem,
  move: copyItem,
  mv: copyItem,
  "remove-item": removeItem,
  ri: removeItem,
  rm: removeItem,
  del: removeItem,
  erase: removeItem,
  rmdir: removeItem,
};

// cmd's: copy, xcopy and move write the last path; del and erase each path. Switches are gone already.
const lastOf: Files = (args) => (args.length >= 2 ? [args[args.length - 1]!] : []);
const CMD_WRITERS: Record<string, Files> = { copy: lastOf, xcopy: lastOf, move: lastOf, del: (args) => args, erase: (args) => args };
const CMD_READERS: Record<string, Files> = { type: (args) => args };

const READERS: Record<string, Files> = {
  cat: (args) => posix(args).positional,
  head: (args) => posix(args, ["-n", "-c"]).positional,
  tail: (args) => posix(args, ["-n", "-c", "-s"]).positional,
  less: (args) => posix(args).positional,
  more: (args) => posix(args).positional,
  sed: (args) => sedFiles(args).read,
};

// In PowerShell, cat and type are Get-Content (Bash's `type` names a command, not a file).
const getContent: Files = (args) => one(psArgs(args), ["path", "literalpath"]);
const PS_READERS: Record<string, Files> = { "get-content": getContent, gc: getContent, cat: getContent, type: getContent };

// ── Commands ─────────────────────────────────────────────────────────────────────────────────

// POSIX arguments: flags dropped (with the value of each flag in `valued`), the rest positional.
function posix(args: Word[], valued: string[] = []): { flags: string[]; positional: Word[] } {
  const flags: string[] = [];
  const positional: Word[] = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!.text;
    if (t === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (t.startsWith("-") && t.length > 1) {
      flags.push(t);
      if (valued.includes(t)) i++;
    } else positional.push(args[i]!);
  }
  return { flags, positional };
}

// sed / perl: the files after the script, which is the first positional unless -e or -f gave it.
// With -i they are written; sed without it reads them.
function sedFiles(args: Word[]): { written: Word[]; read: Word[] } {
  let inplace = false;
  let script = false;
  const positional: Word[] = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!.text;
    if (t === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (t.startsWith("--")) {
      if (t.startsWith("--in-place")) inplace = true;
      if (/^--(expression|file)(=|$)/.test(t)) {
        script = true;
        if (!t.includes("=")) i++;
      }
    } else if (t.startsWith("-") && t.length > 1) {
      if (/^-[a-zA-Z]*i/.test(t)) inplace = true;
      if (/^-[a-zA-Z]*[ef]$/.test(t)) {
        script = true;
        i++;
      }
    } else positional.push(args[i]!);
  }
  const files = positional.slice(script ? 0 : 1);
  return inplace ? { written: files, read: [] } : { written: [], read: files };
}

// cp / mv / install: the last path. Two or more sources, or a target ending in a slash, is a
// folder: each source lands in it under its own name. -t (target first) and install -d are skipped.
function copyTarget(args: Word[], valued: string[]): Word[] {
  const { flags, positional } = posix(args, valued);
  if (flags.some((f) => f === "-d" || f === "-t" || f.startsWith("--target-directory") || f === "--directory")) return [];
  if (positional.length < 2) return [];
  const target = positional[positional.length - 1]!;
  const sources = positional.slice(0, -1);
  if (sources.length === 1 && !/[\\/]$/.test(target.text) && target.text !== "." && target.text !== "..") return [target];
  return sources.map((s) => ({ text: target.text + "/" + base(s.text), unsafe: target.unsafe || s.unsafe }));
}

// PowerShell's switches that take no value; any other -Name takes the next word.
const PS_SWITCHES = new Set(["force", "nonewline", "passthru", "append", "noclobber", "whatif", "confirm", "asbytestream", "verbose", "debug", "raw", "wait", "recurse", "container"]);

type PsValue = Word | true;
interface PsArgs {
  named: Record<string, PsValue | undefined>;
  positional: Word[];
}

function psArgs(args: Word[]): PsArgs {
  const named: Record<string, PsValue | undefined> = Object.create(null);
  const positional: Word[] = [];
  for (let i = 0; i < args.length; i++) {
    const m = /^-([A-Za-z]+)(?::([\s\S]*))?$/.exec(args[i]!.text);
    if (!m) positional.push(args[i]!);
    else if (m[2] !== undefined) named[m[1]!.toLowerCase()] = { text: m[2], unsafe: args[i]!.unsafe };
    else if (PS_SWITCHES.has(m[1]!.toLowerCase())) named[m[1]!.toLowerCase()] = true;
    else named[m[1]!.toLowerCase()] = args[++i] || true;
  }
  return { named, positional };
}

function one({ named, positional }: PsArgs, keys: string[]): Word[] {
  const hit = keys.map((k) => named[k]).find((v): v is Word => !!v && v !== true) || positional[0];
  return hit ? [hit] : [];
}

function newItem(args: Word[]): Word[] {
  const parsed = psArgs(args);
  const type = parsed.named.itemtype || parsed.named.type;
  if (!type || type === true || type.text.toLowerCase() !== "file") return [];
  const [path] = one(parsed, ["path"]);
  const name = parsed.named.name;
  if (!name || name === true) return path ? [path] : [];
  return [path ? { text: path.text + "/" + name.text, unsafe: path.unsafe || name.unsafe } : name];
}

// ── Paths ────────────────────────────────────────────────────────────────────────────────────

function place(w: Word | undefined, dir: string | null, win: boolean, home: string | null = null): string | null {
  if (!w || w.unsafe || !w.text || w.text.startsWith("/dev/") || /^(nul|\$null)$/i.test(w.text)) return null;
  const tilde = /^~(?=[\\/]|$)/.test(w.text);
  if (w.text.startsWith("~") && !(tilde && home)) return null;
  const text = tilde ? normalize(home!) + w.text.slice(1) : w.text;
  const p = win ? text.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d: string) => d.toUpperCase() + ":") : text;
  if (isAbsolute(p)) return normalize(p);
  return dir ? join(dir, p) : null;
}

const base = (p: string) => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);

// ── Reading the command ──────────────────────────────────────────────────────────────────────

// Simple commands as { words, writes }, split on ; && || | & ( ) and newlines. A word after a
// write redirect is a write; after any other redirect (input, stderr, a descriptor) it is dropped.
function segments(toks: Token[]): Segment[] {
  const out: Segment[] = [];
  let cur: Segment = { words: [], writes: [] };
  let after: Op["op"] | null = null;
  for (const t of toks) {
    if ("op" in t && t.op === ";") {
      out.push(cur);
      cur = { words: [], writes: [] };
      after = null;
    } else if ("op" in t) after = t.op;
    else {
      if (after === "write") cur.writes.push(t);
      else if (after !== "skip") cur.words.push(t);
      after = null;
    }
  }
  out.push(cur);
  return out.filter((s) => s.words.length || s.writes.length);
}

// Words and operators. A word is unsafe when a variable, a command substitution or a glob outside
// quotes is in it.
function tokens(src: string, shell: Shell): Token[] {
  const ps = shell === "powershell";
  const cmd = shell === "cmd";
  const out: Token[] = [];
  const heredocs: Heredoc[] = [];
  let word: Word | null = null;
  let i = 0;
  const add = (s: string, unsafe = false) => {
    word = word || { text: "", unsafe: false };
    word.text += s;
    if (unsafe) word.unsafe = true;
  };
  const flush = () => {
    if (word) out.push(word);
    word = null;
  };
  const op = (o: Op["op"]) => {
    flush();
    out.push({ op: o });
  };
  const escape = ps ? "`" : cmd ? "^" : "\\";

  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\n") {
      op(";");
      i = skipHeredocs(src, i + 1, heredocs);
      heredocs.length = 0;
    } else if (ch === " " || ch === "\t" || ch === "\r") {
      flush();
      i++;
    } else if (ch === "#" && !word && !cmd) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (ch === escape) {
      if (src[i + 1] !== "\n") add(src[i + 1] || "");
      i += 2;
    } else if (ps && ch === "@" && !word && (src[i + 1] === "'" || src[i + 1] === '"') && /^\r?\n/.test(src.slice(i + 2))) {
      // A PowerShell here-string: its body is one word, up to a line starting with '@ or "@.
      const q = src[i + 1]!;
      const end = src.indexOf("\n" + q + "@", i + 2);
      const stop = end < 0 ? src.length : end;
      add(src.slice(i + 2, stop), q === '"' && src.slice(i + 2, stop).includes("$"));
      i = end < 0 ? src.length : end + 3;
    } else if (ch === "'" && !cmd) {
      let j = i + 1;
      let text = "";
      for (;;) {
        const k = src.indexOf("'", j);
        if (k < 0) {
          text += src.slice(j);
          j = src.length;
          break;
        }
        text += src.slice(j, k);
        j = k + 1;
        if (!(ps && src[j] === "'")) break;
        text += "'"; // PowerShell doubles a quote inside single quotes
        j++;
      }
      add(text);
      i = j;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === escape && !cmd && j + 1 < src.length) {
          const n = src[j + 1]!;
          // Bash's backslash escapes only these inside double quotes; PowerShell's backtick any.
          if (ps || "$`\"\\\n".includes(n)) {
            if (n !== "\n") add(n);
            j += 2;
            continue;
          }
        }
        if (cmd ? src[j] === "%" : src[j] === "$" || (!ps && src[j] === "`")) add(src[j]!, true);
        else add(src[j]!);
        j++;
      }
      add("");
      i = j + 1;
    } else if ((cmd ? ch === "%" : ch === "$" || (!ps && ch === "`")) || ch === "*" || ch === "?") {
      add(ch, true);
      i++;
    } else if (ch === ";" || ch === "(" || ch === ")") {
      op(";");
      i++;
    } else if (ch === "|") {
      op(";");
      i += src[i + 1] === "|" ? 2 : 1;
    } else if (ch === "&") {
      if (src[i + 1] === ">") {
        op("skip"); // &> and &>>: stdout and stderr together
        i += src[i + 2] === ">" ? 3 : 2;
      } else {
        op(";");
        i += src[i + 1] === "&" ? 2 : 1;
      }
    } else if (ch === ">") {
      // A descriptor written straight before it (2>, PowerShell's *>) is not stdout.
      const w = word as Word | null;
      const fd = w && (/^\d+$/.test(w.text) || (ps && w.text === "*")) ? w.text : "1";
      if (fd !== "1" || (w && w.text === "1")) word = null;
      flush();
      i++;
      if (src[i] === ">") i++;
      if (src[i] === "&") {
        op("skip"); // >&2, 2>&1: a descriptor, not a file
        i++;
      } else {
        if (src[i] === "|") i++;
        op(fd === "1" ? "write" : "skip");
      }
    } else if (ch === "<") {
      flush();
      if (shell === "bash" && src[i + 1] === "<" && src[i + 2] !== "<") {
        i += 2;
        const strip = src[i] === "-";
        if (strip) i++;
        const d = readDelimiter(src, i);
        heredocs.push({ delim: d.text, strip });
        i = d.end;
      } else {
        op("skip");
        i += src[i + 1] === "<" ? 3 : 1;
      }
    } else {
      add(ch);
      i++;
    }
  }
  flush();
  return out;
}

interface Heredoc {
  delim: string;
  strip: boolean;
}

// A heredoc's delimiter word, quotes stripped.
function readDelimiter(src: string, i: number): { text: string; end: number } {
  while (src[i] === " " || src[i] === "\t") i++;
  let text = "";
  while (i < src.length && !/[\s;|&<>()]/.test(src[i]!)) {
    if (src[i] === "'" || src[i] === '"') {
      const k = src.indexOf(src[i]!, i + 1);
      const end = k < 0 ? src.length : k;
      text += src.slice(i + 1, end);
      i = end + 1;
    } else {
      if (src[i] !== "\\") text += src[i];
      i++;
    }
  }
  return { text, end: i };
}

// Past the bodies of the heredocs opened on the line that just ended, from `i`.
function skipHeredocs(src: string, i: number, heredocs: Heredoc[]): number {
  for (const h of heredocs) {
    while (i < src.length) {
      const nl = src.indexOf("\n", i);
      const lineEnd = nl < 0 ? src.length : nl;
      let line = src.slice(i, lineEnd).replace(/\r$/, "");
      if (h.strip) line = line.replace(/^\t+/, "");
      i = nl < 0 ? src.length : nl + 1;
      if (line === h.delim) break;
    }
  }
  return i;
}
