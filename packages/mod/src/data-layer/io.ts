// The Node versions of what the source, git and config read through: file access and a command
// runner.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import type { RunResult, Stat } from "./git.js";

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface NodeIo {
  run: ((argv: string[], opts: { cwd: string }) => Promise<RunResult>) | null;
  /** [] when the folder is missing. */
  listDir(dir: string): Promise<DirEntry[]>;
  stat(path: string): Promise<Stat | null>;
  /** The text of bytes [start, end), or the whole file when both are omitted. */
  read(path: string, start?: number, end?: number): Promise<string>;
  /** The path with symlinks resolved; it rejects when the path doesn't exist. */
  realpath(path: string): Promise<string>;
}

export function nodeIo({ run = runCommand }: { run?: NodeIo["run"] } = {}): NodeIo {
  return {
    run,
    async listDir(dir) {
      try {
        return (await fs.readdir(dir, { withFileTypes: true })).map((e) => ({ name: e.name, isDir: e.isDirectory() }));
      } catch {
        return [];
      }
    },
    async stat(p) {
      try {
        const s = await fs.stat(p);
        return { isDir: s.isDirectory(), mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        return null;
      }
    },
    realpath: (p) => fs.realpath(p),
    async read(p, start, end) {
      if (start === undefined || end === undefined) return fs.readFile(p, "utf8");
      const fh = await fs.open(p, "r");
      try {
        const buf = Buffer.alloc(Math.max(0, end - start));
        const { bytesRead } = await fh.read(buf, 0, buf.length, start);
        return buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        await fh.close();
      }
    },
  };
}

export function runCommand([cmd, ...args]: string[], { cwd }: { cwd: string }): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd!, args, { cwd, encoding: "utf8", timeout: 10000, windowsHide: true }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: stdout || "" });
    });
  });
}
