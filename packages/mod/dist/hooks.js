//#region src/hooks/register.ts
const RETRY_CAP_MS = 3e4;
const STABLE_MS = 6e4;
const SWITCH_CHECK_MS = 1e3;
const NOTE_MAX = 1e3;
let running = null;
let lead = null;
let stop = null;
let started = false;
const notes = /* @__PURE__ */ new Map();
let asking = false;
let lastError = null;
function register(on) {
	on("session.start", async ($, e, next) => {
		const result = await next(e);
		if (!started) {
			started = true;
			run($).catch((err) => $.ui.log("isoplan: the data layer loop failed: " + message(err), { to: "debug" }));
		} else checkSession($);
		return result;
	});
	on("session.end", async ($, e, next) => {
		const result = await next(e);
		$.clock.after(SWITCH_CHECK_MS, () => void checkSession($));
		return result;
	});
	on("tool.call", async ($, e, next) => {
		const r = await next(e);
		try {
			checkSession($);
			if (!lead || r.deny || r.isError) return r;
			const agent = e.agentId ? "claude-code:" + e.agentId : lead;
			const waiting = notes.get(agent);
			if (!waiting) return r;
			notes.delete(agent);
			return {
				...r,
				context: [...r.context ?? [], ...waiting]
			};
		} catch {
			return r;
		}
	}).catch(($, e, next) => next(e));
}
async function checkSession($) {
	const id = await $.session.id().catch(() => null);
	if (id && running && id !== running) stop?.();
}
async function run($) {
	const script = $.plugin.root.replace(/\\/g, "/") + "/dist/data-layer.js";
	let failures = 0;
	for (;;) {
		const session = await $.session.id();
		const cwd = await $.session.cwd();
		if (session !== running) notes.clear();
		running = session;
		lead = `claude-code:${session}:lead`;
		let switched = false;
		const switching = new Promise((resolve) => {
			stop = () => {
				switched = true;
				resolve(null);
			};
		});
		let began = false;
		let code = null;
		const startedAt = await $.clock.now();
		try {
			const child = $.process.spawn({
				argv: [
					"node",
					script,
					"--session",
					session,
					"--cwd",
					cwd
				],
				cwd
			});
			let buffer = "";
			for (;;) {
				const piece = await Promise.race([child.next(), switching]);
				if (piece === null) {
					child.return({
						code: null,
						signal: null
					}).catch(() => {});
					break;
				}
				began = true;
				if (piece.done) {
					code = piece.value?.code ?? null;
					break;
				}
				if (piece.value.stream === "stderr") {
					$.ui.log("isoplan: data layer: " + piece.value.text.trim(), { to: "debug" });
					continue;
				}
				buffer += piece.value.text;
				let nl;
				while ((nl = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, nl).trim();
					buffer = buffer.slice(nl + 1);
					if (line) handle($, line);
				}
			}
		} catch (err) {
			$.ui.log("isoplan: the data layer could not run: " + message(err), { to: "debug" });
		}
		stop = null;
		if (switched) {
			failures = 0;
			continue;
		}
		failures = await $.clock.now() - startedAt >= STABLE_MS ? 1 : failures + 1;
		const delay = Math.min(RETRY_CAP_MS, 1e3 * failures);
		$.ui.status(!began ? "Isoplan needs Node.js on PATH (couldn't start `node`)" : `Isoplan: the data layer stopped${code === null ? "" : ` (node exited with code ${code})`}; restarting in ${Math.round(delay / 1e3)}s`);
		await $.clock.sleep(delay);
	}
}
function handle($, text) {
	let line;
	try {
		line = JSON.parse(text);
	} catch {
		$.ui.log("isoplan: data layer: " + text, { to: "debug" });
		return;
	}
	switch (line.type) {
		case "status":
			$.ui.status(statusText(line));
			break;
		case "title-ask":
			writeTitle($, line);
			break;
		case "log":
			$.ui.log("isoplan: " + line.text, { to: "debug" });
			break;
		case "conflict":
			addNote(line);
			break;
		case "error": {
			const said = `Isoplan: the office server says: ${line.message} (${line.code})`;
			if (said !== lastError) $.ui.log(said);
			lastError = said;
			break;
		}
	}
}
function statusText(line) {
	switch (line.state) {
		case "waiting": return `Isoplan: ${line.server}, not connected yet (nothing to report)`;
		case "connecting": return `Isoplan: connecting to ${line.server}…`;
		case "connected":
			lastError = null;
			return `Isoplan: connected to ${line.server}`;
		case "not-wanted": return `Isoplan: this repo isn't in any office on ${line.server}`;
		case "disconnected": return `Isoplan: can't reach ${line.server}; retrying in ${Math.max(1, Math.round((line.retryInMs ?? 0) / 1e3))}s`;
	}
}
function addNote(line) {
	const waiting = notes.get(line.agent) ?? [];
	waiting.push(line.text.length > NOTE_MAX ? line.text.slice(0, 999) + "…" : line.text);
	notes.set(line.agent, waiting);
}
function writeTitle($, ask) {
	if (asking) return;
	asking = true;
	$.model.complete({
		model: ask.model,
		system: ask.system,
		prompt: ask.prompt,
		maxTokens: ask.maxTokens
	}).then((r) => {
		if (r.isAnswered) return $.fs.write(ask.file, JSON.stringify({
			key: ask.key,
			text: r.text
		}));
		$.ui.log("isoplan: no room title: " + r.reason, { to: "debug" });
	}).catch((err) => $.ui.log("isoplan: could not write a room title: " + message(err), { to: "debug" })).finally(() => {
		asking = false;
	});
}
const message = (err) => String(err && err.message || err);
//#endregion
export { register };
