//#region src/hooks/register.ts
const RETRY_CAP_MS = 3e4;
const STABLE_MS = 6e4;
const SWITCH_CHECK_MS = 1e3;
const NOTE_MAX = 1e3;
const ANSWER_MAX = 8e3;
/** The ask_room tool, as the model calls it. */
const ASK_TOOL = "mcp__isoplan__ask_room";
const ASK_TIMEOUT_MS = 6e5;
let running = null;
let lead = null;
let stop = null;
let started = false;
const notes = /* @__PURE__ */ new Map();
let asking = false;
let lastError = null;
let pairing = null;
let pairSaid = false;
function register(on) {
	on("session.start", async ($, e, next) => {
		await $.tool.register({
			name: "ask_room",
			description: "Ask the lead of the room that was handed to you through Isoplan a question about its work, such as why something was done or what was left unfinished. It answers from the original session's own context, on its owner's machine. Use it only in a session that took an Isoplan handoff; anywhere else it is refused. If no answer comes soon, carry on: a later answer arrives as a note.",
			inputSchema: {
				type: "object",
				properties: { question: {
					type: "string",
					description: "The question, on its own: the lead hasn't seen this conversation."
				} },
				required: ["question"]
			}
		}).catch((err) => $.ui.log("isoplan: the ask_room tool couldn't be added: " + message(err), { to: "debug" }));
		const result = await next(e);
		pairSaid = false;
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
		if (e.tool === "mcp__isoplan__ask_room") return askRoom($, e);
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
		case "pair":
			if (!pairSaid) $.ui.log(`Isoplan: to report to ${line.server}, pair this machine: click ${line.url} on this computer and approve it in the office.`);
			pairSaid = true;
			pairing = line;
			$.ui.status(pairText(line));
			break;
		case "conflict":
			addNote(line);
			break;
		case "asked":
			addAnswer(line);
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
		case "taken": return "Isoplan: this session belongs to someone else on the office, so it isn't reported";
		case "insecure": return `Isoplan: not reporting: ${line.server} is plain ws:// to another machine; use wss://, or set "allowPlainWs": true in config.json`;
		case "pairing": return pairing ? pairText(pairing) : `Isoplan: waiting for this machine to be paired with ${line.server}`;
		case "disconnected": return `Isoplan: can't reach ${line.server}; retrying in ${Math.max(1, Math.round((line.retryInMs ?? 0) / 1e3))}s`;
	}
}
const pairText = (line) => `Isoplan: Pair this machine: ${line.url}`;
function addNote(line) {
	const waiting = notes.get(line.agent) ?? [];
	waiting.push(line.text.length > NOTE_MAX ? line.text.slice(0, 999) + "…" : line.text);
	notes.set(line.agent, waiting);
}
function addAnswer(line) {
	if (line.state !== "answered" || !line.answer || !lead) return;
	const answer = line.answer.length > ANSWER_MAX ? line.answer.slice(0, 7999) + "…" : line.answer;
	const waiting = notes.get(lead) ?? [];
	waiting.push(`Isoplan: the room you asked has answered your question (${line.question}), "${line.text}", from its lead's own session:\n\n${answer}`);
	notes.set(lead, waiting);
}
async function askRoom($, e) {
	const question = typeof e.question === "string" ? e.question.trim() : "";
	if (!question) return { result: "Give the question to ask the room as `question`." };
	try {
		const script = $.plugin.root.replace(/\\/g, "/") + "/dist/ask.js";
		const session = await $.session.id();
		const cwd = await $.session.cwd();
		const r = await $.process.run([
			"node",
			script,
			"--session",
			session,
			"--cwd",
			cwd
		], {
			cwd,
			stdin: question,
			timeoutMs: ASK_TIMEOUT_MS
		});
		if (r.stdout.trim()) return { result: r.stdout.trim() };
		$.ui.log("isoplan: ask_room: " + (r.stderr.trim() || `node exited with code ${r.exitCode}`), { to: "debug" });
		return { result: "The room couldn't be asked here. Carry on without the answer." };
	} catch (err) {
		$.ui.log("isoplan: ask_room couldn't run: " + message(err), { to: "debug" });
		return { result: "The room couldn't be asked here (Node.js is needed on PATH). Carry on without the answer." };
	}
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
export { ASK_TOOL, register };
