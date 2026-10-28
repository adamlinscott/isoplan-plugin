import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
//#region src/wake/lock.ts
const lockPath = (claudeDir, sessionId) => path.join(claudeDir, "isoplan", "live", `${sessionId}.json`);
async function readLock(file) {
	try {
		const { pid, until } = JSON.parse(await fs.readFile(file, "utf8"));
		return {
			pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
			until: typeof until === "number" ? until : null
		};
	} catch {
		return null;
	}
}
/** Whether the session is held: by a live pid, or by a hold-off that hasn't ended. */
async function isHeld(file, now = Date.now(), isAlive = alive) {
	const lock = await readLock(file);
	return !!lock && (lock.until !== null && lock.until > now || lock.pid !== null && isAlive(lock.pid));
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
try {
	await wake(await readStdin(), {
		claudeDir: path.dirname(path.dirname(fileURLToPath(import.meta.url))),
		spawn: (args, cwd) => spawn(process.execPath, args, {
			cwd,
			detached: true,
			stdio: "ignore",
			windowsHide: true
		}).on("error", () => {}).unref()
	});
} catch {}
process.exit(0);
//#endregion
export {};
