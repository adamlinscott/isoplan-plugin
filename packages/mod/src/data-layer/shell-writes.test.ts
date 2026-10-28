import { expect, test } from "vitest";
import { shellFiles, type ShellOptions } from "./shell-writes.js";

const shellWrites = (command: string, cwd: string | null, opts?: ShellOptions) => shellFiles(command, cwd, opts).writes;

const VERSION = "C:\\Users\\adamr\\Projects\\claude-skills\\.claude\\worktrees\\version-4a64c9";
const TESTING = "C:\\Users\\adamr\\Projects\\claude-skills\\.claude\\worktrees\\session-detection-testing-f96742";
const readme = (cwd: string) => [cwd.replace(/\\/g, "/") + "/README.md"];

test("Adam's 13 Oct test: every Bash write to README.md is read, and every read-only command is not", () => {
  // The Bash commands of both conversations and the subagent, verbatim, each with the folder it ran in.
  const calls: [string, string, string[]][] = [
    [VERSION, "wc -l README.md; tail -n 15 README.md", []],
    [
      VERSION,
      "cat >> README.md <<'EOF'\n\n## 😄 Jokes\n\nWhy do programmers prefer dark mode? Because light attracts bugs.\n\nA SQL query walks into a bar, walks up to two tables and asks, \"Can I join you?\"\nEOF\ntail -n 6 README.md",
      readme(VERSION),
    ],
    [VERSION, "tail -n 8 README.md", []],
    [TESTING, "tail -c 200 README.md; printf '\\n\\n---\\n\\nWhy do programmers prefer dark mode? Because light attracts bugs.\\n' >> README.md; tail -n 4 README.md", readme(TESTING)],
    [TESTING, "printf '\\nA SQL query walks into a bar, goes up to two tables and asks: \"Can I join you?\"\\n' >> README.md; tail -n 3 README.md", readme(TESTING)],
    [TESTING, "tail -n 6 README.md", []],
    [TESTING, 'cd "C:/Users/adamr/Projects/claude-skills/.claude/worktrees/session-detection-testing-f96742" && tail -c 200 README.md | od -c | tail -5; git status --short', []],
    [
      TESTING,
      "cd \"C:/Users/adamr/Projects/claude-skills/.claude/worktrees/session-detection-testing-f96742\" && printf '\\nWhy do programmers prefer dark mode? Because light attracts bugs.\\n' >> README.md && tail -n 3 README.md",
      readme(TESTING),
    ],
    [
      TESTING,
      "cd \"C:/Users/adamr/Projects/claude-skills/.claude/worktrees/session-detection-testing-f96742\" && sed -i '$ d' README.md && printf 'My code has no bugs, only features that the test suite hasn'\"'\"'t been introduced to yet.\\n' >> README.md && tail -n 3 README.md && git diff --stat",
      readme(TESTING),
    ],
  ];
  for (const [cwd, command, writes] of calls) expect(shellWrites(command, cwd), command).toEqual(writes);
});

test("redirects: > and >> write; stderr, descriptors, /dev/null and input don't; a heredoc's body is not commands", () => {
  const cwd = "/home/adam/repo";
  expect(shellWrites("ls 2>/dev/null > out.txt 2>&1; echo y >&2; echo z &> both.log; echo q > /dev/null; sort < in.txt 2> err.log", cwd)).toEqual(["/home/adam/repo/out.txt"]);
  expect(shellWrites("cat <<-EOF > a.md\n\techo body > not-a-write.md\n\tEOF\necho done >> b.md", cwd)).toEqual(["/home/adam/repo/a.md", "/home/adam/repo/b.md"]);
});

test("commands that write: tee, sed -i, perl -i, cp, mv, install, touch", () => {
  const cases: [string, string[]][] = [
    ["echo x | tee -a log.txt other.txt", ["/r/log.txt", "/r/other.txt"]],
    ["sed -i.bak -e 's/a/b/' -e 's/c/d/' a.txt b.txt", ["/r/a.txt", "/r/b.txt"]],
    ["sed 's/a/b/' a.txt", []],
    ["perl -pi -e 's/a/b/' p.txt", ["/r/p.txt"]],
    ["cp -r src/a.md docs/b.md", ["/r/docs/b.md"]],
    ["mv a.md b.md lib/", ["/r/lib/a.md", "/r/lib/b.md"]],
    ["install -m 644 build/x /r/bin/", ["/r/bin/x"]],
    ["install -d /r/bin", []],
    ["touch -d yesterday t1 t2", ["/r/t1", "/r/t2"]],
  ];
  for (const [command, writes] of cases) expect(shellWrites(command, "/r"), command).toEqual(writes);
});

test("PowerShell: Set-Content, Add-Content, Out-File and New-Item -ItemType File, by name or position", () => {
  const cases: [string, string[]][] = [
    ["Set-Content -Path a.txt -Value 'x'", ["C:/r/a.txt"]],
    ["'x' | Out-File -Encoding utf8 -FilePath C:\\r\\b.txt -Append", ["C:/r/b.txt"]],
    ["Add-Content c.txt 'more'", ["C:/r/c.txt"]],
    ["(Get-Content d.txt) | Set-Content -LiteralPath:'d.txt'", ["C:/r/d.txt"]],
    ["New-Item -ItemType File -Path docs -Name e.md -Force", ["C:/r/docs/e.md"]],
    ["New-Item -ItemType Directory f", []],
    ["Get-ChildItem > list.txt; Remove-Item x 2> $null; Write-Output y > $null", ["C:/r/list.txt"]],
  ];
  for (const [command, writes] of cases) expect(shellWrites(command, "C:\\r", { powershell: true }), command).toEqual(writes);
});

test("skipped, never guessed: variables, globs, ~, a cd it can't place, and relative paths with no cwd", () => {
  expect(shellWrites('echo x > "$OUT"; echo x > *.md; cp a.md ~/b.md; echo x > "plain $x.md"', "/r")).toEqual([]);
  expect(shellWrites("cd $DIR && echo x > a.md", "/r")).toEqual([]);
  expect(shellWrites("echo x > a.md; echo x > /abs/b.md", null)).toEqual(["/abs/b.md"]);
  // Literal quotes keep a dollar sign: '$x' is a file name, not a variable.
  expect(shellWrites("echo x > '$x.md'", "/r")).toEqual(["/r/$x.md"]);
});

test("Git Bash: /c/… paths become C:/… under a Windows cwd; cd follows relative and absolute folders", () => {
  expect(shellWrites("echo x > /c/Users/adam/a.md", "C:\\Users\\adam")).toEqual(["C:/Users/adam/a.md"]);
  expect(shellWrites("cd /c/Users/adam/repo && cd lib && echo x >> b.md", "C:\\elsewhere")).toEqual(["C:/Users/adam/repo/lib/b.md"]);
  expect(shellWrites("echo x > /c/a.md", "/home/adam")).toEqual(["/c/a.md"]);
});

test("cd within a command: touch after cd, pushd and popd, and PowerShell's sl, Push-Location and Pop-Location", () => {
  expect(shellWrites("cd docs && touch y", "/r")).toEqual(["/r/docs/y"]);
  expect(shellWrites("pushd lib && touch a; popd; touch b; popd; touch c", "/r")).toEqual(["/r/lib/a", "/r/b"]);
  const ps = (command: string) => shellWrites(command, "C:\\r", { powershell: true });
  expect(ps("sl docs; Set-Content a.md 'x'")).toEqual(["C:/r/docs/a.md"]);
  expect(ps("Push-Location -Path lib; New-Item -ItemType File b.md; Pop-Location; Add-Content c.md 'x'")).toEqual(["C:/r/lib/b.md", "C:/r/c.md"]);
});

test("reads: cat, head, tail, less, more, sed without -i and Get-Content, file arguments only, skipped as writes are", () => {
  const reads = (command: string, opts?: ShellOptions) => shellFiles(command, "/r", opts).reads;
  expect(reads("wc -l README.md; tail -n 15 README.md; head -c 200 a.md | od -c; cat -n b.md -; less c.md; more d.md")).toEqual(["/r/README.md", "/r/a.md", "/r/b.md", "/r/c.md", "/r/d.md"]);
  expect(reads("sed -n '1,20p' lib/x.mjs; sed -e 's/a/b/' y.txt; sed -i 's/a/b/' z.txt; sort < in.txt")).toEqual(["/r/lib/x.mjs", "/r/y.txt"]);
  expect(reads('cat "$F" *.md ~/x.md; cd lib && tail -n 3 e.md')).toEqual(["/r/lib/e.md"]);
  expect(reads("type f.md")).toEqual([]);
  expect(reads("Get-Content -Raw g.md; gc -Path h.md -TotalCount 5; type i.md; cat j.md", { powershell: true })).toEqual(["/r/g.md", "/r/h.md", "/r/i.md", "/r/j.md"]);
  expect(shellFiles("cat a.md > b.md", "/r")).toEqual({ writes: ["/r/b.md"], reads: ["/r/a.md"] });
});
