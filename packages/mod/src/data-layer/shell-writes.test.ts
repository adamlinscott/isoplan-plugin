import { describe, expect, test } from "vitest";
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
    ["Get-ChildItem > list.txt; Remove-Item x 2> $null; Write-Output y > $null", ["C:/r/list.txt", "C:/r/x"]],
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
  expect(shellFiles("cat a.md > b.md", "/r")).toEqual({ writes: ["/r/b.md"], reads: ["/r/a.md"], dirs: ["/r"] });
});

test("dirs: the folders a command's programs run in, after a cd, and git -C's, so a command in another repo can be placed", () => {
  const dirs = (command: string, opts?: ShellOptions) => shellFiles(command, "/w/backend", opts).dirs;
  expect(dirs("npm test")).toEqual(["/w/backend"]);
  expect(dirs("cd ../frontend && npm test")).toEqual(["/w/frontend"]);
  expect(dirs("git -C ../frontend status && git -C /w/infra -C sub log --oneline")).toEqual(["/w/frontend", "/w/infra/sub"]);
  expect(dirs('git -c core.pager=cat -C "../front end" diff')).toEqual(["/w/front end"]);
  // A cd alone runs nothing there; a folder it can't place drops what follows.
  expect(dirs("cd ../frontend")).toEqual([]);
  expect(dirs('cd "$X" && npm test')).toEqual([]);
  expect(dirs("Set-Location ../frontend; npm test", { powershell: true })).toEqual(["/w/frontend"]);
});

// #74: long chained commands that edit files outside the session's folder, in each shell, with
// Windows and POSIX paths.
describe("raw terminal commands across repos", () => {
  const files = (command: string, cwd: string, opts: ShellOptions = {}) => {
    const { writes, dirs } = shellFiles(command, cwd, opts);
    return { writes, dirs };
  };

  test("bash and zsh, POSIX paths: cd, ~, redirects, tee, sed -i, cp, mv, rm in one chain", () => {
    const cmd = "cd ../frontend && echo x >> notes.md; sed -i 's/a/b/' src/a.ts | tee -a ~/log/run.txt && cp src/a.ts /srv/web/b.ts && mv old.ts new.ts; rm -rf dist/x.js";
    expect(files(cmd, "/Users/a/backend", { home: "/Users/a" })).toEqual({
      writes: ["/Users/a/frontend/notes.md", "/Users/a/frontend/src/a.ts", "/Users/a/log/run.txt", "/srv/web/b.ts", "/Users/a/frontend/new.ts", "/Users/a/frontend/dist/x.js"],
      dirs: ["/Users/a/frontend"],
    });
    // zsh -c and bash -lc are read as Bash; pushd and popd come back.
    expect(files(`zsh -c "pushd ~/web && echo x > a.md; popd; touch b.md"`, "/Users/a/backend", { home: "/Users/a" }).writes).toEqual(["/Users/a/web/a.md", "/Users/a/backend/b.md"]);
    expect(files(`bash -lc 'cd /srv/api && rm a.ts'`, "/home/b/x").writes).toEqual(["/srv/api/a.ts"]);
  });

  test("bash on Windows (Git Bash): /c/ paths, backslash-free Windows paths and ~", () => {
    const cmd = "cd /c/w/frontend && printf 'x' > src/a.ts && cp src/a.ts C:/w/web/b.ts; rm ~/tmp/c.txt";
    expect(files(cmd, "C:\\w\\backend", { home: "C:\\Users\\a" }).writes).toEqual(["C:/w/frontend/src/a.ts", "C:/w/web/b.ts", "C:/Users/a/tmp/c.txt"]);
  });

  test("PowerShell on Windows: Set-Location, Out-File, Set-Content, Add-Content, Copy-Item, Move-Item, Remove-Item, New-Item", () => {
    const cmd =
      "Set-Location ..\\frontend; 'x' | Out-File -FilePath notes.md; Set-Content src\\a.ts 'y'; Add-Content -Path ~\\log.txt 'z'; Copy-Item a.ts -Destination ..\\web\\b.ts; Move-Item c.ts d.ts; Remove-Item -Recurse -Force dist\\e.js; New-Item -ItemType File f.md";
    expect(files(cmd, "C:\\w\\backend", { powershell: true, home: "C:\\Users\\a" })).toEqual({
      writes: ["C:/w/frontend/notes.md", "C:/w/frontend/src/a.ts", "C:/Users/a/log.txt", "C:/w/web/b.ts", "C:/w/frontend/d.ts", "C:/w/frontend/dist/e.js", "C:/w/frontend/f.md"],
      dirs: ["C:/w/frontend"],
    });
    expect(files('powershell -Command "Push-Location C:\\w\\api; del old.ts; Pop-Location; ri x.ts"', "C:\\w\\backend").writes).toEqual(["C:/w/api/old.ts", "C:/w/backend/x.ts"]);
  });

  test("PowerShell on a Mac (pwsh): POSIX paths, ~, Push-Location and aliases", () => {
    const cmd = "Push-Location ~/frontend; cp a.ts ../web/b.ts; rm -Force c.ts; Pop-Location; 'x' > notes.md";
    expect(files(`pwsh -c "${cmd}"`, "/Users/a/backend", { home: "/Users/a" }).writes).toEqual(["/Users/a/web/b.ts", "/Users/a/frontend/c.ts", "/Users/a/backend/notes.md"]);
  });

  test("cmd: cd /d, pushd, redirects, copy, xcopy, move, del, and %VAR% skipped", () => {
    const cmd = 'cmd /c "cd /d C:\\w\\frontend && echo hi > notes.txt && copy /y a.txt ..\\web\\b.txt & move c.txt d.txt & del /q old.txt & echo %X% > %OUT%"';
    expect(files(cmd, "C:\\w\\backend")).toEqual({
      writes: ["C:/w/frontend/notes.txt", "C:/w/web/b.txt", "C:/w/frontend/d.txt", "C:/w/frontend/old.txt"],
      dirs: ["C:/w/frontend"],
    });
    expect(files("pushd D:\\repos\\api && xcopy src dist\\ /s && popd && type x.txt", "C:\\w\\backend", { cmd: true })).toEqual({ writes: ["D:/repos/api/dist"], dirs: ["D:/repos/api", "C:/w/backend"] });
    // cmd through PowerShell, and cd with a spaced path left unquoted.
    expect(files('cmd.exe /c "cd /d C:\\My Repos\\web && echo x > a.md"', "C:\\w\\backend", { powershell: true }).writes).toEqual(["C:/My Repos/web/a.md"]);
  });

  test("the folders programs are pointed at: git -C, --git-dir, --work-tree, npm --prefix, pnpm -C and --dir, yarn --cwd, make -C", () => {
    const dirs = (command: string, cwd = "/w/backend") => shellFiles(command, cwd).dirs;
    expect(dirs("git -C ../frontend commit -m x")).toEqual(["/w/frontend"]);
    expect(dirs("git --git-dir=/w/web/.git log; git --git-dir /w/api/.git --work-tree /w/api-wt status")).toEqual(["/w/web", "/w/api-wt"]);
    expect(dirs("npm --prefix ../frontend test && pnpm -C /w/web build && pnpm --dir=../api lint")).toEqual(["/w/frontend", "/w/web", "/w/api"]);
    expect(dirs("yarn --cwd ../site build; make -C ../native all; make --directory=/w/c")).toEqual(["/w/site", "/w/native", "/w/c"]);
    expect(dirs("git -C 'C:\\w\\frontend' diff && npm --prefix '..\\web' test", "C:\\w\\backend")).toEqual(["C:/w/frontend", "C:/w/web"]);
    expect(dirs("npm test")).toEqual(["/w/backend"]);
  });
});
