import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
//#region src/wake/lock.ts
const lockPath = (claudeDir, sessionId) => path.join(claudeDir, "isoplan", "live", `${sessionId}.json`);
async function readText(file) {
	try {
		const [text, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
		return {
			text,
			mtimeMs: st.mtimeMs
		};
	} catch {
		return null;
	}
}
function parseLock(text, mtimeMs) {
	try {
		const { pid, until, ...extra } = JSON.parse(text);
		return {
			pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
			until: typeof until === "number" ? until : null,
			mtimeMs,
			extra
		};
	} catch {
		return null;
	}
}
async function readLock(file) {
	const r = await readText(file);
	return r && parseLock(r.text, r.mtimeMs);
}
const held = (lock, now, { isAlive = alive, freshMs }) => !!lock && (lock.until !== null && lock.until > now || lock.pid !== null && isAlive(lock.pid) && (freshMs === void 0 || now - lock.mtimeMs < freshMs));
/** Whether the lock is held: by a live pid (kept fresh, under `freshMs`), or by a hold-off that hasn't ended. */
async function isHeld(file, now = Date.now(), isAlive = alive, rule = {}) {
	return held(await readLock(file), now, {
		...rule,
		isAlive
	});
}
function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err.code === "EPERM";
	}
}
//#endregion
//#region src/wake/wake.ts
const wakeRecordPath = (claudeDir) => path.join(claudeDir, "isoplan", "wake.json");
/**
* `input` is the hook's stdin JSON (`session_id`, `cwd`, ...). True when a data layer was started.
* Anything missing or unreadable means nothing to do.
*/
async function wake(input, { claudeDir, spawn, isAlive = alive }) {
	const { session_id: sessionId, cwd } = JSON.parse(input);
	if (typeof sessionId !== "string" || !/^[\w-]+$/.test(sessionId) || typeof cwd !== "string" || !cwd) return false;
	if (await isHeld(lockPath(claudeDir, sessionId), Date.now(), isAlive)) return false;
	const { dataLayer } = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8"));
	if (typeof dataLayer !== "string" || !await fs.stat(dataLayer).then((s) => s.isFile(), () => false)) return false;
	spawn([
		dataLayer,
		"--session",
		sessionId,
		"--cwd",
		cwd,
		"--detached"
	], cwd);
	return true;
}
//#endregion
//#region src/runner/start.ts
/** The runner's lock: `{ pid, code }` of the supervisor that holds it. */
const runnerLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "lock.json");
/** What names a runner.js's code: its size and write time. Null when it is gone. */
async function runnerCode(file) {
	const st = await fs.stat(file).catch(() => null);
	return st && st.isFile() ? `${st.size}-${Math.round(st.mtimeMs)}` : null;
}
/** The live runner's lock: a hold-off that hasn't ended, or a live pid that keeps it fresh. */
async function liveRunner(claudeDir, now, isAlive) {
	const lock = await readLock(runnerLockPath(claudeDir));
	if (!lock) return null;
	if (lock.until !== null && lock.until > now) return {
		...lock,
		isHoldOff: true
	};
	if (lock.pid !== null && isAlive(lock.pid) && now - lock.mtimeMs < 9e4) return {
		...lock,
		isHoldOff: false
	};
	return null;
}
/**
* True when a runner was started. Nothing recorded, or a recorded runner that is gone, starts none;
* a live one running the recorded code is left alone, and one running older code is replaced.
*/
async function startRunner({ claudeDir, spawn, isAlive = alive, kill = (pid) => process.kill(pid), now = Date.now }) {
	let runner;
	try {
		runner = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")).runner;
	} catch {
		return false;
	}
	if (typeof runner !== "string") return false;
	const code = await runnerCode(runner);
	if (!code) return false;
	const live = await liveRunner(claudeDir, now(), isAlive);
	if (live && (live.isHoldOff || live.extra.code === code)) return false;
	if (live) await stopRunner(claudeDir, {
		isAlive,
		kill,
		now
	});
	spawn([
		runner,
		"--claude-dir",
		claudeDir
	], claudeDir);
	return true;
}
/**
* Ends the running runner, for uninstall and updates: its worker and forks follow once its
* supervisor has gone. True when one was running. A stale lock's pid is never killed.
*/
async function stopRunner(claudeDir, { isAlive = alive, kill = (pid) => process.kill(pid), now = Date.now } = {}) {
	const live = await liveRunner(claudeDir, now(), isAlive);
	if (!live || live.isHoldOff || live.pid === null) return false;
	try {
		kill(live.pid);
	} catch {}
	await fs.rm(runnerLockPath(claudeDir), { force: true });
	return true;
}
//#endregion
//#region src/wake/main.ts
const STDIN_MS = 500;
process.on("uncaughtException", () => process.exit(0));
function readStdin() {
	return new Promise((resolve) => {
		let text = "";
		const timer = setTimeout(() => resolve(text), STDIN_MS);
		const done = () => {
			clearTimeout(timer);
			resolve(text);
		};
		process.stdin.setEncoding("utf8").on("data", (piece) => text += piece).on("end", done).on("error", done);
	});
}
const claudeDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const start = (args, cwd) => spawn(process.execPath, args, {
	cwd,
	detached: true,
	stdio: "ignore",
	windowsHide: true
}).on("error", () => {}).unref();
try {
	await wake(await readStdin(), {
		claudeDir,
		spawn: start
	});
} catch {}
await startRunner({
	claudeDir,
	spawn: start
}).catch(() => {});
process.exit(0);
//#endregion
export {};
