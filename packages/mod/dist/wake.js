import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
//#region src/runner/claude-binary.ts
const claudeBinaryPath = (claudeDir) => path.join(claudeDir, "isoplan", "claude-binary.json");
//#endregion
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
/** The pid the lock names, or null when there is none or it can't be read. */
async function lockHolder(file) {
	return (await readLock(file))?.pid ?? null;
}
const held = (lock, now, { isAlive = alive, freshMs }) => !!lock && (lock.until !== null && lock.until > now || lock.pid !== null && isAlive(lock.pid) && (freshMs === void 0 || now - lock.mtimeMs < freshMs));
/** Whether the lock is held: by a live pid (kept fresh, under `freshMs`), or by a hold-off that hasn't ended. */
async function isHeld(file, now = Date.now(), isAlive = alive, rule = {}) {
	return held(await readLock(file), now, {
		...rule,
		isAlive
	});
}
/** Removes the lock if it still names `pid`. */
async function releaseLock(file, pid) {
	if (await lockHolder(file) === pid) await fs.rm(file, { force: true });
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
//#region src/runner/environment.ts
const runnerEnvPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "environment.json");
/** The recorded environment, or null when there is none, or it doesn't parse, so the starter's is used. */
async function recordedEnv(claudeDir) {
	try {
		const { env } = JSON.parse(await fs.readFile(runnerEnvPath(claudeDir), "utf8"));
		if (!env || typeof env !== "object" || Array.isArray(env)) return null;
		return Object.fromEntries(Object.entries(env).filter((e) => typeof e[1] === "string"));
	} catch {
		return null;
	}
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
* Starts the recorded runner unless a live one runs the recorded code. One on older code is
* replaced. A hold-off keeps it from starting, except a crash loop's hold-off on older code: a new
* version may have fixed what crashed.
*/
async function startRunner({ claudeDir, spawn, isAlive = alive, kill = (pid) => process.kill(pid), now = Date.now }) {
	let runner;
	try {
		runner = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")).runner;
	} catch {
		return "not-installed";
	}
	if (typeof runner !== "string") return "not-installed";
	const code = await runnerCode(runner);
	if (!code) return "not-installed";
	const lockFile = runnerLockPath(claudeDir);
	const live = await liveRunner(claudeDir, now(), isAlive);
	if (live?.isHoldOff) {
		if (live.extra.reason !== "gave-up" || live.extra.code === code) return "held-off";
		if ((await readLock(lockFile))?.until === live.until) await fs.rm(lockFile, { force: true });
	} else if (live) {
		if (live.extra.code === code) return "running";
		await stopRunner(claudeDir, {
			isAlive,
			kill,
			now,
			expect: {
				pid: live.pid,
				code: live.extra.code
			}
		});
	}
	const env = await recordedEnv(claudeDir);
	spawn([
		runner,
		"--claude-dir",
		claudeDir,
		...env ? [] : ["--inherited-env"]
	], claudeDir, env ?? void 0);
	return "started";
}
/**
* Ends the running runner, for uninstall and updates: its worker and forks follow once its
* supervisor has gone. True when one was running. A stale lock's pid is never killed. With
* `expect`, only the runner judged outdated is: if the lock names another pid or code by now
* (another starter replaced it already), it is left.
*/
async function stopRunner(claudeDir, { isAlive = alive, kill = (pid) => process.kill(pid), now = Date.now, expect } = {}) {
	const live = await liveRunner(claudeDir, now(), isAlive);
	if (!live || live.isHoldOff || live.pid === null) return false;
	if (expect && (live.pid !== expect.pid || live.extra.code !== expect.code)) return false;
	try {
		kill(live.pid);
	} catch {}
	await releaseLock(runnerLockPath(claudeDir), live.pid);
	return true;
}
//#endregion
//#region src/install/install.ts
/** Claude Code's plugins folder: $CLAUDE_CODE_PLUGIN_CACHE_DIR when it is set, else <claude dir>/plugins. */
const pluginsDir = (claudeDir, env) => env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(claudeDir, "plugins");
/**
* The id, `<plugin>@<marketplace>`, of the marketplace install `file` is part of, from its place in
* the plugins folder's cache/<marketplace>/<plugin>/<version>/. Null for a file outside it, such as
* a checkout's.
*/
function pluginIdOf(plugins, file) {
	const relative = path.relative(path.join(plugins, "cache"), path.resolve(file));
	if (path.isAbsolute(relative)) return null;
	const parts = relative.split(path.sep);
	return parts.length >= 4 && parts[0] !== ".." ? `${parts[1]}@${parts[0]}` : null;
}
/**
* The plugin ids Claude Code's installed_plugins.json lists, [] when there is no such file. Null
* when it can't be read or isn't the shape known (`{ plugins: { "<id>": [install, ...] } }`), so
* no one acts on it.
*/
async function installedPlugins(plugins) {
	let text;
	try {
		text = await fs.readFile(path.join(plugins, "installed_plugins.json"), "utf8");
	} catch (err) {
		return err.code === "ENOENT" ? [] : null;
	}
	try {
		const list = JSON.parse(text).plugins;
		if (!list || typeof list !== "object" || Array.isArray(list)) return null;
		return Object.entries(list).filter(([, installs]) => Array.isArray(installs) && installs.length > 0).map(([id]) => id);
	} catch {
		return null;
	}
}
/** Whether `dataLayer` is a marketplace install's that Claude Code no longer lists as installed. */
async function isUninstalled(plugins, dataLayer) {
	const id = pluginIdOf(plugins, dataLayer);
	if (!id) return false;
	const installed = await installedPlugins(plugins);
	return installed !== null && !installed.includes(id);
}
/** Whether the data layer wake.json records belongs to a plugin Claude Code has uninstalled. */
async function isRecordedUninstalled({ claudeDir, plugins }) {
	try {
		const { dataLayer } = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8"));
		return typeof dataLayer === "string" && await isUninstalled(plugins, dataLayer);
	} catch {
		return false;
	}
}
const wakeScriptPath = (claudeDir) => path.join(claudeDir, "isoplan", "wake.mjs");
const isWake = (hook) => typeof hook?.command === "string" && /isoplan[\\/]+wake\.mjs/.test(hook.command);
/** What uninstall removes under <claude dir>/isoplan, besides an install's own claude-binary.json. */
const INSTALLED_FILES = [
	"wake.mjs",
	"wake.json",
	"runner",
	"live",
	"logs",
	"titles"
];
/**
* Takes out everything install and the plugin put in place: the wake hooks in settings.json, the
* running runner, and under <claude dir>/isoplan the wake hook, its record, the runner's copy and
* its records (environment, ledger, lock), the session locks, the logs and the title files, and
* claude-binary.json unless it was set by hand. The session locks go before the wait, since a
* detached data layer stops once its lock isn't its own; the runner's worker stops with its
* supervisor. What else is in the folder, the files a person writes, is kept, and the folder goes
* once it is empty. Returns what it changed.
*/
async function uninstall(paths, { optOut = false, settleMs = 0, runner = {} } = {}) {
	const changes = await uninstallHooks(paths);
	const dir = path.dirname(wakeScriptPath(paths.claudeDir));
	const remove = async (file) => {
		if (!await fs.stat(file).then(() => true, () => false)) return;
		await fs.rm(file, {
			recursive: true,
			force: true,
			maxRetries: 5
		});
		if (!changes.includes(`removed ${file}`)) changes.push(`removed ${file}`);
	};
	if (await stopRunner(paths.claudeDir, runner)) changes.push("stopped the runner, which answered for this machine's rooms");
	await remove(path.join(dir, "live"));
	if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
	const record = wakeRecordPath(paths.claudeDir);
	for (const file of INSTALLED_FILES.map((name) => path.join(dir, name))) if (!(optOut && file === record)) await remove(file);
	const binary = claudeBinaryPath(paths.claudeDir);
	if (!await isHandSet(binary) && await fs.rm(binary).then(() => true, () => false)) changes.push(`removed ${binary}`);
	if (optOut) {
		if (await writeIfChanged(record, JSON.stringify({ disabled: true }, null, 2) + "\n")) changes.push(`marked the wake hook as uninstalled in ${record}, so the plugin won't put it back`);
	} else if (await fs.rmdir(dir).then(() => true, () => false)) changes.push(`removed ${dir}`);
	return changes;
}
async function uninstallHooks({ settings }) {
	const current = await readSettings(settings);
	const changes = [];
	const hooks = current.hooks;
	if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
		for (const [event, groups] of Object.entries(hooks)) {
			if (!Array.isArray(groups)) continue;
			let removed = false;
			const kept = groups.filter((group) => {
				const list = group?.hooks;
				if (!Array.isArray(list) || !list.some(isWake)) return true;
				removed = true;
				group.hooks = list.filter((hook) => !isWake(hook));
				return group.hooks.length > 0;
			});
			if (!removed) continue;
			changes.push(`removed the wake hook from ${settings} on ${event}`);
			if (kept.length) hooks[event] = kept;
			else delete hooks[event];
		}
		if (changes.length && !Object.keys(hooks).length) delete current.hooks;
	}
	if (changes.length) await writeSettings(settings, current);
	return changes;
}
async function isHandSet(file) {
	try {
		const record = JSON.parse(await fs.readFile(file, "utf8"));
		return typeof record.path === "string" && record.path !== "" && record.auto !== true;
	} catch {
		return false;
	}
}
async function readSettings(file) {
	let text;
	try {
		text = await fs.readFile(file, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return {};
		throw err;
	}
	let value;
	try {
		value = JSON.parse(text.replace(/^﻿/, ""));
	} catch {
		throw new Error(`${file} isn't valid JSON; left it alone`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} isn't a JSON object; left it alone`);
	return value;
}
const writeSettings = (file, settings) => writeWhole(file, JSON.stringify(settings, null, 2) + "\n");
async function writeIfChanged(file, text) {
	if (await fs.readFile(file, "utf8").catch(() => null) === text) return false;
	await writeWhole(file, text);
	return true;
}
async function writeWhole(file, text) {
	const target = await fs.realpath(file).catch(() => file);
	const mode = (await fs.stat(target).catch(() => null))?.mode;
	await fs.mkdir(path.dirname(target), { recursive: true });
	const temp = `${target}.isoplan-${process.pid}`;
	try {
		await fs.writeFile(temp, text);
		if (mode !== void 0) await fs.chmod(temp, mode & 4095);
		await fs.rename(temp, target);
	} catch (err) {
		await fs.rm(temp, { force: true }).catch(() => {});
		throw err;
	}
}
//#endregion
//#region src/wake/main.ts
const STDIN_MS = 500;
const SETTLE_MS = 3e3;
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
const self = fileURLToPath(import.meta.url);
const claudeDir = path.dirname(path.dirname(self));
const paths = {
	claudeDir,
	settings: path.join(claudeDir, "settings.json"),
	plugins: pluginsDir(claudeDir, process.env)
};
const start = (args, cwd, env) => spawn(process.execPath, args, {
	cwd,
	env,
	detached: true,
	stdio: "ignore",
	windowsHide: true
}).on("error", () => {}).unref();
if (process.argv.includes("--uninstall")) {
	await uninstall(paths, { settleMs: SETTLE_MS }).catch(() => {});
	process.exit(0);
}
const input = await readStdin();
if (await isRecordedUninstalled(paths)) {
	start([self, "--uninstall"], claudeDir);
	process.exit(0);
}
try {
	await wake(input, {
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
