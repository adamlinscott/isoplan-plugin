import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function joinValues(array, separator = "|") {
	return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
var Cached = class {
	constructor(getter) {
		this._getter = getter;
		this._value = void 0;
	}
	get value() {
		const getter = this._getter;
		if (getter !== void 0) {
			this._value = getter();
			this._getter = void 0;
		}
		return this._value;
	}
};
function cached(getter) {
	return new Cached(getter);
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
	const ratio = val / step;
	const roundedRatio = Math.round(ratio);
	const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
	if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
	return ratio - roundedRatio;
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
/**
* Whichever object a def's `shape` currently answers from: the one the caller passed until the first read, the frozen copy after it.
*
* Its keys and descriptors read without invoking anything, which is what lets a discriminated union check its discriminator, and the cycle walk read a shape, without resolving a getter that references the schema being constructed. A def that answers `shape` from an accessor of its own has none.
*/
function rawShape(def) {
	const desc = Object.getOwnPropertyDescriptor(def, "shape");
	return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
	return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
	Object.defineProperty(target, key, {
		get() {
			const value = getter();
			assignProp(this, key, value);
			return value;
		},
		enumerable: true,
		configurable: true
	});
}
function putProp(target, key, value) {
	if (key in target) assignProp(target, key, value);
	else target[key] = value;
}
/**
* Copies `keys` of `source`'s shape onto `target`, each value passed through `wrap`.
*
* A key the source has resolved is copied through now, so the derived shape states it outright and nothing has to resolve it to learn what it holds. A key the source still defers stays deferred, and reads back through the source's own `shape`, so it resolves once and both shapes get that one schema.
*/
function mirrorShape(target, source, keys, wrap) {
	const raw = sourceShape(source);
	for (const key of keys) {
		const desc = Object.getOwnPropertyDescriptor(raw, key);
		if (!desc.enumerable) continue;
		if (desc.get) deferProp(target, key, () => {
			const value = source._zod.def.shape[key];
			return wrap ? wrap(value, key) : value;
		});
		else putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
	}
}
function mirrorProps(target, source) {
	for (const key of Reflect.ownKeys(source)) {
		const desc = Object.getOwnPropertyDescriptor(source, key);
		if (!desc.enumerable) continue;
		if (desc.get) deferProp(target, key, () => source[key]);
		else putProp(target, key, desc.value);
	}
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) {
		const descriptors = Object.getOwnPropertyDescriptors(def);
		Object.assign(mergedDescriptors, descriptors);
	}
	return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
const allowsEval = /* @__PURE__*/ cached(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject(o) {
	if (isObject(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
const propertyKeyTypes = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function stringifyPrimitive(value) {
	if (typeof value === "bigint") return value.toString() + "n";
	if (typeof value === "string") return `"${value}"`;
	return `${value}`;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
	});
}
const NUMBER_FORMAT_RANGES = /*@__PURE__*/ (() => ({
	safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
const BIGINT_FORMAT_RANGES = {
	int64: [/* @__PURE__*/ BigInt("-9223372036854775808"), /* @__PURE__*/ BigInt("9223372036854775807")],
	uint64: [/* @__PURE__*/ BigInt(0), /* @__PURE__*/ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	const newShape = {};
	mirrorShape(newShape, schema, maskedKeys(schema, mask));
	return clone(schema, mergeDefs(currDef, {
		shape: newShape,
		checks: []
	}));
}
function maskedKeys(schema, mask) {
	const raw = sourceShape(schema);
	const keys = [];
	for (const key of Reflect.ownKeys(mask)) {
		if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) throw new Error(`Unrecognized key: "${String(key)}"`);
		if (mask[key]) keys.push(key);
	}
	return keys;
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	const omitted = new Set(maskedKeys(schema, mask));
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
	return clone(schema, mergeDefs(currDef, {
		shape: newShape,
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = sourceShape(schema);
		for (const key of Reflect.ownKeys(shape)) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
	mirrorProps(newShape, shape);
	return newShape;
}
function safeExtend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
	if (!b?._zod?.def) throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	const newShape = {};
	mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
	mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
	return clone(a, mergeDefs(a._zod.def, {
		shape: newShape,
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask, name = "partial") {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
	const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({
		type: "optional",
		innerType: value
	})));
	return clone(schema, mergeDefs(schema._zod.def, {
		shape: newShape,
		checks: []
	}));
}
function required(Class, schema, mask) {
	const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => selected && !selected.has(key) ? value : new Class({
		type: "nonoptional",
		innerType: value
	}));
	return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage(message) {
	return typeof message === "string" ? message : message?.message;
}
/** The leading size checks of `defChecks` that set an upper bound, each paired with it. */
function sizeCaps(defChecks) {
	const caps = [];
	for (const ch of defChecks ?? []) {
		const d = ch._zod.def;
		if (!/_(length|size)$|_equals$/.test(d.check)) break;
		const max = d.maximum ?? d.length ?? d.size;
		if (max >= 0) caps.push([max, ch]);
	}
	return caps;
}
function attachSchema(issues, start, inst) {
	var _a;
	for (let i = start; i < issues.length; i++) (_a = issues[i]).schema ?? (_a.schema = inst);
}
function finalizeIssue(iss, ctx, config) {
	var _a;
	const traits = iss.inst?._zod?.traits;
	if (traits?.has("$ZodType")) {
		if (traits.has("$ZodCheck")) (_a = iss).schema ?? (_a.schema = iss.inst);
		else iss.schema = iss.inst;
	}
	const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
	const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
	const full = {};
	for (const k of Object.keys(iss)) {
		if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__") continue;
		full[k] = iss[k];
	}
	full.path ?? (full.path = []);
	full.message = message;
	if (ctx?.reportInput) full.input = iss.input;
	return full;
}
const highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
	const units = str.length;
	if (!highSurrogate.test(str)) return units;
	let count = units;
	for (let i = 0; i < units - 1; i++) if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
		count--;
		i++;
	}
	return count;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function parsedType(data) {
	const t = typeof data;
	switch (t) {
		case "number": return Number.isNaN(data) ? "nan" : "number";
		case "object": {
			if (data === null) return "null";
			if (Array.isArray(data)) return "array";
			const obj = data;
			if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) return obj.constructor.name;
		}
	}
	return t;
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}
/**
* Installs a trait's members on its prototype. Each value builds that member for the instance on first read; the built value shadows the accessor as an own property, so a detached `const { parse } = schema` keeps working.
*
* Call this from a `proto` initializer, which runs once per prototype — never per instance.
*/
function members(proto, table) {
	for (const key in table) {
		const desc = Object.getOwnPropertyDescriptor(table, key);
		if (desc.get) Object.defineProperty(proto, key, {
			...desc,
			enumerable: false
		});
		else defineBound(proto, key, desc.value);
	}
}
/** Shadows a prototype member with an own value, so a getter that builds from the instance runs once. */
function own(inst, key, value, enumerable = true) {
	Object.defineProperty(inst, key, {
		configurable: true,
		writable: true,
		enumerable,
		value
	});
	return value;
}
/** Like {@link own}, for a member that was never an own data property and has to stay out of `Object.keys`. */
function hide(inst, key, value) {
	return own(inst, key, value, false);
}
/** Adds members a table derives from the instance: each builds on first read and shadows as own data, and assignment shadows the same way, as when these were own properties. */
/* @__NO_SIDE_EFFECTS__ */
function derived(computes, table) {
	for (const key in computes) {
		const compute = computes[key];
		Object.defineProperty(table, key, {
			configurable: true,
			enumerable: true,
			get() {
				return own(this, key, compute(this));
			},
			set(value) {
				own(this, key, value);
			}
		});
	}
	return table;
}
function defineBound(proto, key, fn) {
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			return this == null ? fn : own(this, key, fn.bind(this));
		},
		set(value) {
			own(this, key, value);
		}
	});
}
/** Returns the prototype to install on, or `undefined` if this group is already installed on it. */
function claim(inst, sentinel) {
	const proto = Object.getPrototypeOf(inst);
	return sentinel in proto ? void 0 : proto;
}
let installing;
let broke = false;
const breaker = {
	configurable: true,
	get() {
		broke = true;
	}
};
/**
* Installs a lazily-derived internal on the `_zod` prototype of `inst`'s
* constructor, computed from the internals object itself and cached there on
* first read. One accessor per constructor rather than one per instance.
*/
function defineLazyInternal(inst, key, compute) {
	const proto = Object.getPrototypeOf(inst._zod);
	if (key in proto && installing !== inst._zod) {
		installing = void 0;
		return;
	}
	installing = inst._zod;
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			Object.defineProperty(this, key, breaker);
			const outer = broke;
			broke = false;
			try {
				const value = compute(this);
				if (broke) delete this[key];
				else Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					value
				});
				broke = broke || outer;
				return value;
			} catch (err) {
				delete this[key];
				broke = broke || outer;
				throw err;
			}
		},
		set(value) {
			Object.defineProperty(this, key, {
				configurable: true,
				writable: true,
				value
			});
		}
	});
}
/**
* Installs `key` on `inst`'s prototype, computed by `make` on first read and cached there as an own
* data property. One accessor per constructor rather than one per instance, because an own accessor
* puts every instance after the first into v8 dictionary mode. The key doubles as the sentinel.
*/
function installLazyProp(inst, key, make, enumerable) {
	const proto = claim(inst, key);
	if (!proto) return;
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			const desc = {
				configurable: true,
				writable: true,
				enumerable,
				value: void 0
			};
			Object.defineProperty(this, key, desc);
			desc.value = make(this);
			Object.defineProperty(this, key, desc);
			return desc.value;
		},
		set(value) {
			Object.defineProperty(this, key, {
				configurable: true,
				writable: true,
				enumerable,
				value
			});
		}
	});
}
/** Marks the thunk `_catch` synthesises for a constant catch value. `Function.length` cannot tell that thunk from a user callback — rest and defaulted parameters both report arity 0 — and a user callback reads `ctx.error`, whose issues only finalize correctly against the caller's per-parse error map. Provenance can say what arity cannot. A plain string key rather than `Symbol.for`, whose call at module scope no bundler can prove pure — the same shape that anchored `urlCanParse` into every build. */
const CONSTANT_CATCH = "~constantCatch";
/** Wraps a constant catch value in a thunk tagged with {@link CONSTANT_CATCH}. */
function constantCatch(value) {
	const fn = () => value;
	fn[CONSTANT_CATCH] = true;
	return fn;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/core.js
var _a$1;
const _zodDesc = {
	value: void 0,
	enumerable: false
};
let _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
	const E = _E;
	if (E) {
		const saved = E.stackTraceLimit;
		if (typeof saved === "number") {
			try {
				E.stackTraceLimit = 0;
			} catch {
				_E = null;
				return new Definition();
			}
			try {
				return new Definition();
			} finally {
				E.stackTraceLimit = saved;
			}
		}
	}
	return new Definition();
}
/* @__NO_SIDE_EFFECTS__ */
function $constructor(name, initializer, proto, params) {
	const zodProto = {};
	function Internals(def) {
		this.def = def;
		this.constr = _;
		this.traits = /* @__PURE__ */ new Set();
	}
	Internals.prototype = zodProto;
	const protoMembers = proto;
	const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
	function init(inst, def) {
		if (!inst._zod) {
			_zodDesc.value = new Internals(def);
			try {
				Object.defineProperty(inst, "_zod", _zodDesc);
			} finally {
				_zodDesc.value = void 0;
			}
		} else if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		if (initialized) {
			const own = Object.getPrototypeOf(inst);
			const ctorProto = inst._zod.constr.prototype;
			let up = own;
			while (up && up !== ctorProto) up = Object.getPrototypeOf(up);
			const target = up ?? own;
			if (!initialized.has(target)) {
				initialized.add(target);
				members(target, protoMembers);
			}
		}
		const proto = _.prototype;
		for (const k in proto) {
			if (!Object.prototype.hasOwnProperty.call(proto, k)) continue;
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		const inst = params?.Parent ? newError(Definition) : this;
		init(inst, def);
		const deferred = inst._zod.deferred;
		if (deferred) {
			for (const fn of deferred) fn();
			inst._zod.deferred = void 0;
		}
		const pp = globalThis.__zod_globalConfig?.postProcessor;
		if (pp) pp(inst);
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
const globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/errors.js
function _getMessage() {
	const internals = this._zod;
	internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
	return internals.message;
}
function _setMessage(value) {
	this._zod.message = value;
}
const _messageDesc = {
	get: _getMessage,
	set: _setMessage,
	enumerable: true,
	configurable: true
};
const _issuesDesc = {
	value: void 0,
	enumerable: false
};
const _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
const initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	_issuesDesc.value = def;
	Object.defineProperty(inst, "issues", _issuesDesc);
	_issuesDesc.value = void 0;
	Object.defineProperty(inst, "message", _messageDesc);
	const proto = Object.getPrototypeOf(inst);
	if (!_installedToString.has(proto)) {
		_installedToString.add(proto);
		Object.defineProperty(proto, "toString", {
			configurable: true,
			enumerable: false,
			get() {
				const value = () => this.message;
				Object.defineProperty(this, "toString", {
					value,
					configurable: true,
					writable: true
				});
				return value;
			},
			set(value) {
				Object.defineProperty(this, "toString", {
					value,
					configurable: true,
					writable: true
				});
			}
		});
	}
};
const $ZodError = /* @__PURE__ */ $constructor("$ZodError", initializer$1);
/** Get-or-create `obj[key]` as an own data property. A path segment naming an inherited member
* ("toString", "constructor") would otherwise read through to the prototype, and assigning
* "__proto__" would hit the setter instead of creating a key. */
function node(obj, key, make) {
	if (!Object.prototype.hasOwnProperty.call(obj, key)) {
		if (key === "__proto__") Object.defineProperty(obj, key, {
			value: make(),
			writable: true,
			enumerable: true,
			configurable: true
		});
		else obj[key] = make();
	}
	return obj[key];
}
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
	else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					const terminal = i === fullpath.length - 1;
					if (el === "_errors") {
						if (terminal) curr._errors.push(mapper(issue));
						i++;
						continue;
					}
					if (!Object.prototype.hasOwnProperty.call(curr, el)) Object.defineProperty(curr, el, {
						value: { _errors: [] },
						enumerable: true,
						writable: true,
						configurable: true
					});
					const node = curr[el];
					if (terminal) node._errors.push(mapper(issue));
					curr = node;
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
/** Format a ZodError as a human-readable string in the following form.
*
* From
*
* ```ts
* ZodError {
*   issues: [
*     {
*       expected: 'string',
*       code: 'invalid_type',
*       path: [ 'username' ],
*       message: 'Invalid input: expected string'
*     },
*     {
*       expected: 'number',
*       code: 'invalid_type',
*       path: [ 'favoriteNumbers', 1 ],
*       message: 'Invalid input: expected number'
*     }
*   ];
* }
* ```
*
* to
*
* ```
* username
*   ✖ Expected number, received string at "username
* favoriteNumbers[0]
*   ✖ Invalid input: expected number
* ```
*/
function toDotPath(_path) {
	const segs = [];
	const path = _path.map((seg) => typeof seg === "object" ? seg.key : seg);
	for (const seg of path) if (typeof seg === "number") segs.push(`[${seg}]`);
	else if (typeof seg === "symbol") segs.push(`[${JSON.stringify(String(seg))}]`);
	else if (/[^\w$]/.test(seg)) segs.push(`[${JSON.stringify(seg)}]`);
	else {
		if (segs.length) segs.push(".");
		segs.push(seg);
	}
	return segs.join("");
}
function prettifyError(error) {
	const lines = [];
	const issues = [...error.issues].sort((a, b) => (a.path ?? []).length - (b.path ?? []).length);
	for (const issue of issues) {
		lines.push(`✖ ${issue.message}`);
		if (issue.path?.length) lines.push(`  → at ${toDotPath(issue.path)}`);
	}
	return lines.join("\n");
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
	return {
		callee: params?.callee ?? callee,
		Err: params?.Err
	};
}
const _parse = (_Err) => {
	const fn = (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			async: false
		} : { async: false };
		const result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) throw new $ZodAsyncError();
		if (result.issues.length) {
			const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
			captureStackTrace(e, _params?.callee ?? fn);
			throw e;
		}
		return result.value;
	};
	return fn;
};
const _parseAsync = (_Err) => {
	const fn = async (schema, value, _ctx, params) => {
		const ctx = _ctx ? {
			..._ctx,
			async: true
		} : { async: true };
		let result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) result = await result;
		if (result.issues.length) {
			const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
			captureStackTrace(e, params?.callee ?? fn);
			throw e;
		}
		return result.value;
	};
	return fn;
};
const _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? failure(_Err, result.issues, ctx) : {
		success: true,
		data: result.value
	};
};
function failure(Err, issues, ctx) {
	let error;
	return {
		success: false,
		get error() {
			if (!error) {
				error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
				issues = void 0;
				ctx = void 0;
			}
			return error;
		},
		set error(e) {
			error = e;
			issues = void 0;
			ctx = void 0;
		}
	};
}
const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? failure(_Err, result.issues, ctx) : {
		success: true,
		data: result.value
	};
};
const COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
const COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
const validate = ((schema, value, _ctx) => {
	const validator = schema._zod.bag.validator;
	if (validator !== void 0) {
		if (validator(value) !== COMPILE_INVALID) return true;
		if (validator.definite === true && _ctx === void 0) return false;
	}
	return validateFallback(schema, value, _ctx);
});
function validateFallback(schema, value, _ctx) {
	const ctx = _ctx ? {
		..._ctx,
		async: false,
		abortEarly: true
	} : {
		async: false,
		abortEarly: true
	};
	const fallbackRun = schema._zod.bag.fallbackRun;
	let result;
	if (fallbackRun) {
		ctx[COMPILE_FALLBACK] = true;
		result = fallbackRun({
			value,
			issues: []
		}, ctx);
	} else result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length === 0;
}
const validateAsync$1 = async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true,
		abortEarly: true
	} : {
		async: true,
		abortEarly: true
	};
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length === 0;
};
const _encode = (_Err) => {
	const parse = _parse(_Err);
	const fn = (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			direction: "backward"
		} : { direction: "backward" };
		return parse(schema, value, ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _decode = (_Err) => {
	const parse = _parse(_Err);
	const fn = (schema, value, _ctx, _params) => {
		return parse(schema, value, _ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _encodeAsync = (_Err) => {
	const parseAsync = _parseAsync(_Err);
	const fn = async (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			direction: "backward"
		} : { direction: "backward" };
		return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _decodeAsync = (_Err) => {
	const parseAsync = _parseAsync(_Err);
	const fn = async (schema, value, _ctx, _params) => {
		return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
const _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const cuid = /^[cC][0-9a-z]{6,}$/;
const cuid2 = /^[0-9a-z]+$/;
const ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
const xid = /^[0-9a-vA-V]{20}$/;
const ksuid = /^[A-Za-z0-9]{27}$/;
const nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
	return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
const duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
const uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
const email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const _emoji$1 = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
const base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
const httpProtocol = /^https?$/;
const e164 = /^\+[1-9]\d{6,14}$/;
const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
/** Anchors a pattern source. The interpolation lives here rather than at the call site because
* esbuild will not drop a `@__PURE__` call whose own argument interpolates a variable, but it
* will drop `anchor(dateSource)`. Keeping it inline pinned `date` into every bundle. */
function anchor(source) {
	return new RegExp(`^${source}$`);
}
const date = /*@__PURE__*/ anchor(dateSource);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
	const opts = ["Z"];
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const qualified = `${timeSource({
		precision: args.precision,
		seconds: true
	})}(?:${opts.join("|")})`;
	const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
const anyString = /^[\s\S]{0,}$/;
const integer = /^-?\d+$/;
const number$1 = /^-?\d+(?:\.\d+)?$/;
const boolean$1 = /^(?:true|false)$/i;
const lowercase = /^[^A-Z]*$/;
const uppercase = /^[^a-z]*$/;
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/checks.js
const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
/** Default `when` for length-based checks: run only on non-nullish values with a `length`. */
const _whenHasLength = (payload) => {
	const val = payload.value;
	return !nullish(val) && val.length !== void 0;
};
const numericOriginMap = {
	number: "number",
	bigint: "bigint",
	object: "date"
};
const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
		payload.issues.push({
			origin: numericOriginMap[typeof payload.value] ?? origin,
			code: "too_big",
			maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
		payload.issues.push({
			origin: numericOriginMap[typeof payload.value] ?? origin,
			code: "too_small",
			minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
		if (typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
		payload.issues.push({
			origin: typeof payload.value,
			code: "not_multiple_of",
			divisor: def.value,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
	$ZodCheck.init(inst, def);
	def.format = def.format || "float64";
	const isInt = def.format?.includes("int");
	const origin = isInt ? "int" : "number";
	const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (isInt) {
			if (!Number.isInteger(input)) {
				payload.issues.push({
					expected: origin,
					format: def.format,
					code: "invalid_type",
					continue: false,
					input,
					inst
				});
				return;
			}
			if (!Number.isSafeInteger(input)) {
				if (input > 0) payload.issues.push({
					input,
					code: "too_big",
					maximum: Number.MAX_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				else payload.issues.push({
					input,
					code: "too_small",
					minimum: Number.MIN_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				return;
			}
		}
		if (input < minimum) payload.issues.push({
			origin: "number",
			input,
			code: "too_small",
			minimum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
		if (input > maximum) payload.issues.push({
			origin: "number",
			input,
			code: "too_big",
			maximum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		if ((typeof input === "string" && units > def.maximum ? codePointLength(input) : units) <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		if ((typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units) >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	def.pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = [], closed = {}) {
		this.content = [];
		this.indent = 0;
		this.args = args;
		this.closed = closed;
	}
	indented(fn) {
		this.indent += 1;
		try {
			fn(this);
		} finally {
			this.indent -= 1;
		}
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const content = this?.content ?? [``];
		return new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {\n${content.join("\n")}\n};`)(...Object.values(this.closed));
	}
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/versions.js
const version = {
	major: 4,
	minor: 6,
	patch: 7
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/schemas.js
const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version;
	const defChecks = inst._zod.def.checks;
	const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			if (payload.memo) return payload;
			let isAborted = aborted(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					attachSchema(payload.issues, currLen, inst);
					if (!isAborted) isAborted = aborted(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					attachSchema(payload.issues, currLen, inst);
					if (!isAborted) isAborted = aborted(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
}, {
	get "~standard"() {
		return hide(this, "~standard", standardProps(this));
	},
	set "~standard"(value) {
		own(this, "~standard", value);
	}
});
/** The Standard Schema surface for `inst`. Shared so wrappers can extend it without forcing it. */
const toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync(inst, value) {
	const ctx = { async: true };
	return toStandardResult(await inst._zod.run({
		value,
		issues: []
	}, ctx), ctx);
}
function standardProps(inst) {
	return {
		validate: (value) => {
			const ctx = { async: false };
			try {
				const r = inst._zod.run({
					value,
					issues: []
				}, ctx);
				if (!(r instanceof Promise)) return toStandardResult(r, ctx);
			} catch (_) {}
			return validateAsync(inst, value);
		},
		vendor: "zod",
		version: 1
	};
}
const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = def.pattern ?? anyString;
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email);
	$ZodStringFormat.init(inst, def);
});
function canParseURL(input) {
	try {
		if (typeof URL !== "undefined" && typeof URL.canParse === "function") return URL.canParse(input);
		new URL(input);
		return true;
	} catch {
		return false;
	}
}
function validateURL(trimmed, def) {
	if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) return canParseURL(trimmed) || 2;
	return parseURLObject(trimmed, def);
}
/** Parses a URL while preserving the non-normalizing HTTP guard. */
function parseURLObject(trimmed, def) {
	if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) return 1;
	try {
		if (typeof URL !== "undefined") {
			const URLStatic = URL;
			if (typeof URLStatic.parse === "function") return URLStatic.parse(trimmed) ?? 2;
		}
		return new URL(trimmed);
	} catch {
		return 2;
	}
}
const asciiTabOrNewline = /[\t\n\r]/g;
/** The URL parser deletes every ASCII tab, LF and CR from its input before it parses, so `new URL("https://exa\nmple.com")` reports on `example.com`. Applying the same deletion to the returned value closes the half of that divergence which can move the host; the parser's other rewrite, stripping C0 controls at the edges, cannot. */
function stripTabAndNewline(value) {
	return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
	hostname.lastIndex = 0;
	return hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
	protocol.lastIndex = 0;
	return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			const url = validateURL(trimmed, def);
			if (url === 1) {
				payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid URL format",
					input: payload.value,
					inst,
					continue: !def.abort
				});
				return;
			}
			if (url === 2) {
				payload.issues.push({
					code: "invalid_format",
					format: "url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
				return;
			}
			if (url === true) {
				payload.value = stripTabAndNewline(trimmed);
				return;
			}
			if (def.hostname && !urlHostnameOk(url, def.hostname)) payload.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: def.hostname.source,
				input: payload.value,
				inst,
				continue: !def.abort
			});
			if (def.protocol && !urlProtocolOk(url, def.protocol)) payload.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: def.protocol.source,
				input: payload.value,
				inst,
				continue: !def.abort
			});
			payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
	if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1)) throw new Error(`Invalid nanoid length: ${def.length}`);
	def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date);
	$ZodStringFormat.init(inst, def);
});
const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration);
	$ZodStringFormat.init(inst, def);
});
const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
});
/** An IPv6 address is written with hex digits, colons and dots, and nothing else. The guard is what makes the check below an IPv6 check: `new URL("http://[...]")` parses an authority, not an address, so `@` and `\` re-delimit it and `"::@1\\"` validates against the host `0.0.0.1`. The URL parser also deletes ASCII tab, LF and CR rather than failing, which is how `"::1\n"` validated as `::1`. */
const ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
	if (!ipv6Alphabet.test(value)) return false;
	return canParseURL(`http://[${value}]`);
}
const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (!isValidIPv6(payload.value)) payload.issues.push({
			code: "invalid_format",
			format: "ipv6",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
	const parts = value.split("/");
	if (parts.length !== 2) return false;
	const [address, prefix] = parts;
	if (!prefix) return false;
	const prefixNum = Number(prefix);
	if (`${prefixNum}` !== prefix) return false;
	if (prefixNum < 0 || prefixNum > 128) return false;
	return isValidIPv6(address);
}
const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (!isValidCIDRv6(payload.value)) payload.issues.push({
			code: "invalid_format",
			format: "cidrv6",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
const base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64Charset);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
	if (!base64urlCharset.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64urlCharset);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = number$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Number(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
		const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
		payload.issues.push({
			expected: "number",
			code: "invalid_type",
			input,
			inst,
			...received ? { received } : {}
		});
		return payload;
	};
});
const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
	$ZodCheckNumberFormat.init(inst, def);
	$ZodNumber.init(inst, def);
});
const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = boolean$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Boolean(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "boolean") return payload;
		payload.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function capSize(inst, size) {
	const caps = sizeCaps(inst._zod.def.checks);
	if (!caps.length) return;
	const cap = Math.min(...caps.map((c) => c[0]));
	const parse = inst._zod.parse;
	inst._zod.parse = (payload, ctx) => {
		const n = size(payload.value);
		if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
			for (const [max, ch] of sizeCaps(inst._zod.def.checks)) if (n > max && ch._zod.def.when(payload)) {
				const start = payload.issues.length;
				ch._zod.check(payload);
				payload.issues[start].continue = false;
				attachSchema(payload.issues, start, inst);
				return payload;
			}
		}
		return parse(payload, ctx);
	};
}
const arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
		const proms = [];
		const abortEarly = ctx?.abortEarly;
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else {
				handleArrayResult(result, payload, i);
				if (abortEarly && result.issues.length !== 0 && aborted(result)) break;
			}
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
	capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
	const isPresent = key in input;
	const isOptionalOut = optout === "optional";
	if (!isPresent && isOptionalOut && optin === "optional") return;
	if (result.issues.length) {
		if (optin !== void 0 && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && optin === void 0) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent || optin === "defaulted" && !isOptionalOut) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
const NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	const ownSymbols = Object.getOwnPropertySymbols(def.shape);
	const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
	const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
	for (const k of allKeys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		allKeys,
		symbolKeys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const optin = _catchall.optin;
	const optout = _catchall.optout;
	let seen = 0;
	for (const key in input) {
		if (abortEarly && payload.issues.length !== seen) {
			if (aborted(payload, seen)) break;
			seen = payload.issues.length;
		}
		if (keySet.has(key)) continue;
		if (key === "__proto__") {
			if (t === "never") unrecognized.push(key);
			continue;
		}
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
		else handlePropertyResult(r, payload, key, input, optin, optout);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst,
		continue: true
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	const desc = Object.getOwnPropertyDescriptor(def, "shape");
	const sh = desc?.get ? desc.get.raw : def.shape ?? {};
	if (sh) {
		const get = () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			get.raw = newSh;
			return newSh;
		};
		get.raw = sh;
		Object.defineProperty(def, "shape", { get });
	}
	const _normalized = cached(() => normalizeDef(def));
	defineLazyInternal(inst, "propValues", (zod) => {
		const shape = zod.def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				if (!Object.prototype.hasOwnProperty.call(propValues, key)) assignProp(propValues, key, /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
				if (field.optin !== void 0) propValues[key].add(void 0);
			}
		}
		return propValues;
	});
	const isObject$1 = isObject;
	const catchall = def.catchall;
	let value;
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$1(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
		const proms = [];
		const shape = value.shape;
		const abortEarly = ctx?.abortEarly;
		let seen = payload.issues.length;
		for (const key of value.allKeys) {
			if (abortEarly && payload.issues.length !== seen) {
				if (aborted(payload, seen)) break;
				seen = payload.issues.length;
			}
			if (key === "__proto__") continue;
			const el = shape[key];
			const optin = el._zod.optin;
			const optout = el._zod.optout;
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
			else handlePropertyResult(r, payload, key, input, optin, optout);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
	};
});
const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached(() => normalizeDef(def));
	const memo = globalConfig.memoizer;
	const generateFastpass = (shape) => {
		const normalized = _normalized.value;
		const syms = normalized.symbolKeys;
		const doc = new Doc(["payload", "ctx"], {
			shape,
			inst,
			memo,
			syms
		});
		const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.allKeys) ids[key] = `key_${counter++}`;
		doc.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
		for (const key of normalized.allKeys) {
			if (key === "__proto__") continue;
			const id = ids[key];
			const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
			const isPresent = `${k} in input`;
			const schema = shape[key];
			const optin = schema?._zod?.optin;
			const isOptionalIn = optin !== void 0;
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(k)};`);
			if (isOptionalIn && isOptionalOut) {
				const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
				doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			} else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
			else {
				doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
				if (optin === "defaulted") doc.write(`newResult[${k}] = ${id}.value;`);
				else doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
			}
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		return doc.compile();
	};
	let fastpass;
	const isObject$2 = isObject;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$2(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
	defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazyInternal(inst, "values", (zod) => {
		if (zod.def.options.every((o) => o._zod.values)) return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazyInternal(inst, "pattern", (zod) => {
		if (zod.def.options.every((o) => o._zod.pattern)) {
			const patterns = zod.def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
function discriminatorMap(def) {
	const map = /* @__PURE__ */ new Map();
	for (const option of def.options) {
		const values = option._zod.propValues?.[def.discriminator];
		if (!values || values.size === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
		for (const value of values) if (map.has(value)) {
			if (value !== void 0) throw new Error(`Duplicate discriminator value "${String(value)}"`);
			map.set(value, null);
		} else map.set(value, option);
	}
	return map;
}
const $ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
	def.inclusive = false;
	$ZodUnion.init(inst, def);
	const _super = inst._zod.parse;
	defineLazyInternal(inst, "propValues", (zod) => {
		const propValues = {};
		let undefinedCount = 0;
		for (const option of zod.def.options) {
			const pv = option._zod.propValues;
			if (!pv || Object.keys(pv).length === 0) throw new Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
			if (pv[zod.def.discriminator]?.has(void 0)) undefinedCount++;
			for (const [k, v] of Object.entries(pv)) {
				if (!Object.prototype.hasOwnProperty.call(propValues, k)) assignProp(propValues, k, /* @__PURE__ */ new Set());
				for (const val of v) propValues[k].add(val);
			}
		}
		if (!zod.def.unionFallback && undefinedCount > 1) propValues[zod.def.discriminator]?.delete(void 0);
		return propValues;
	});
	def.options.forEach((option, i) => {
		const propShape = rawShape(option._zod.def);
		if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) throw new Error(`Invalid discriminated union option at index "${i}"`);
	});
	const disc = cached(() => discriminatorMap(def));
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isObject(input)) {
			payload.issues.push({
				code: "invalid_type",
				expected: "object",
				input,
				inst
			});
			return payload;
		}
		const value = input?.[def.discriminator];
		const opt = disc.value.get(value);
		if (opt && (value !== void 0 || ctx.direction !== "backward")) return opt._zod.run(payload, ctx);
		if (def.unionFallback || ctx.direction === "backward") return _super(payload, ctx);
		payload.issues.push({
			code: "invalid_union",
			errors: [],
			note: "No matching discriminator",
			discriminator: def.discriminator,
			options: Array.from(disc.value.keys()).filter((value) => disc.value.get(value) !== null),
			input,
			path: [def.discriminator],
			inst
		});
		return payload;
	};
});
const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject(a) && isPlainObject(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		if (Object.prototype.hasOwnProperty.call(newObj, "__proto__")) delete newObj.__proto__;
		for (const key of sharedKeys) {
			if (key === "__proto__") continue;
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	const keyIssues = /* @__PURE__ */ new Map();
	const collect = (iss, side) => {
		let keys;
		if (iss.code === "unrecognized_keys" && !iss.path?.length) {
			unrecIssue ?? (unrecIssue = iss);
			keys = iss.keys;
		} else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
			const k = String(iss.path[0]);
			if (!keyIssues.has(k)) keyIssues.set(k, iss);
			keys = [k];
		} else return false;
		for (const k of keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k)[side] = true;
		}
		return true;
	};
	for (const iss of left.issues) if (!collect(iss, "l")) result.issues.push(iss);
	for (const iss of right.issues) if (!collect(iss, "r")) result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length) {
		const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
		if (aggregated.length) result.issues.push({
			...unrecIssue,
			keys: aggregated
		});
		for (const k of bothKeys) if (!aggregated.includes(k) && keyIssues.has(k)) result.issues.push(keyIssues.get(k));
	}
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) {
		if (aborted(result)) return result;
		throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	}
	result.value = merged.data;
	return result;
}
const $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
	$ZodType.init(inst, def);
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isPlainObject(input)) {
			payload.issues.push({
				expected: "record",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		const proms = [];
		const values = def.keyType._zod.values;
		if (values && !def.partial) {
			payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
			const recordKeys = /* @__PURE__ */ new Set();
			for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
				recordKeys.add(typeof key === "number" ? key.toString() : key);
				if (key === "__proto__") continue;
				const keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (keyResult.issues.length) {
					payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const outKey = keyResult.value;
				if (outKey === "__proto__") continue;
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}
			}
			let unrecognized;
			for (const key in input) if (!recordKeys.has(key)) {
				if (def.mode === "loose") {
					if (key === "__proto__") continue;
					payload.value[key] = input[key];
				} else {
					unrecognized = unrecognized ?? [];
					unrecognized.push(key);
				}
			}
			if (unrecognized && unrecognized.length > 0) payload.issues.push({
				code: "unrecognized_keys",
				input,
				inst,
				keys: unrecognized,
				continue: true
			});
		} else {
			payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
			let unrecognized;
			for (const key of Reflect.ownKeys(input)) {
				if (key === "__proto__") continue;
				if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
				let keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
					const retryResult = def.keyType._zod.run({
						value: Number(key),
						issues: []
					}, ctx);
					if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
					if (retryResult.issues.length === 0) keyResult = retryResult;
				}
				if (keyResult.issues.length) {
					if (def.mode === "loose") payload.value[key] = input[key];
					else if (values) {
						unrecognized = unrecognized ?? [];
						unrecognized.push(key);
					} else payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const outKey = keyResult.value;
				if (outKey === "__proto__") continue;
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}
			}
			if (unrecognized && unrecognized.length > 0) payload.issues.push({
				code: "unrecognized_keys",
				input,
				inst,
				keys: unrecognized,
				continue: true
			});
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	defineLazyInternal(inst, "pattern", (zod) => {
		const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
		return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
	});
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
	$ZodType.init(inst, def);
	const values = new Set(def.values);
	inst._zod.values = values;
	defineLazyInternal(inst, "pattern", (zod) => {
		const vals = zod.def.values;
		return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
	});
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (values.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values: def.values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	globalConfig.memoizer?.guard(inst);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		return payload;
	};
});
function handleOptionalResult(payload, result) {
	payload.value = result.issues.length ? void 0 : result.value;
	return payload;
}
const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
	inst._zod.optout = "optional";
	defineLazyInternal(inst, "values", (zod) => {
		const values = zod.def.innerType._zod.values;
		return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
	});
	defineLazyInternal(inst, "pattern", (zod) => {
		const pattern = zod.def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === void 0) {
			if (def.innerType._zod.optin !== "defaulted") return payload;
			const result = def.innerType._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) return result.then((result) => handleOptionalResult(payload, result));
			return handleOptionalResult(payload, result);
		}
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
	defineLazyInternal(inst, "pattern", (zod) => {
		const pattern = zod.def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazyInternal(inst, "values", (zod) => {
		return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "defaulted";
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "defaulted";
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => {
		const v = zod.def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
function handleCatchResult(payload, result, def, ctx) {
	if (!result.issues.length) {
		payload.value = result.value;
		if (result.memo) payload.memo = true;
		return payload;
	}
	payload.value = def.catchValue({
		...result,
		value: payload.value,
		error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
		input: payload.value
	});
	return payload;
}
const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run({
			value: payload.value,
			issues: []
		}, ctx);
		if (result instanceof Promise) return result.then((result) => handleCatchResult(payload, result, def, ctx));
		return handleCatchResult(payload, result, def, ctx);
	};
});
const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
	defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
	defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues
	}, ctx);
}
const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	if (!payload.memo) payload.value = Object.freeze(payload.value);
	return payload;
}
const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/memoizer.js
var $ZodCyclicError = class extends Error {
	constructor() {
		super(`Cannot parse a reference cycle that closes through a transform`);
		this.name = "ZodCyclicError";
	}
};
/** Keyed off the context object every schema in one parse call already shares. */
const STATE = "~memo";
const NO_ISSUES = [];
function isRef(value) {
	return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
	return issues.map((iss) => iss.path ? {
		...iss,
		path: iss.path.slice()
	} : { ...iss });
}
const recursive = /*@__PURE__*/ new WeakMap();
/** What the walk established, in order of certainty: ordered so the strongest answer among children wins. */
const NONE = 0;
const ASSUMED = 1;
const PROVEN = 2;
/** Whether this schema's subtree contains a cycle, so one parse can re-enter it. */
function isRecursive(inst, stack, resolve) {
	const cached = recursive.get(inst);
	if (cached !== void 0) return cached ? PROVEN : NONE;
	if (stack.has(inst)) return PROVEN;
	stack.add(inst);
	let result = NONE;
	const check = (child) => {
		if (result !== PROVEN && child?._zod) {
			const answer = isRecursive(child, stack, resolve);
			if (answer > result) result = answer;
		}
	};
	const shape = (sh, spread) => {
		let answer = NONE;
		for (const key of Reflect.ownKeys(sh)) {
			const desc = Object.getOwnPropertyDescriptor(sh, key);
			if (spread && !desc.enumerable) continue;
			const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
			if (child > answer) answer = child;
		}
		return answer;
	};
	const merge = (answer) => {
		if (answer > result) result = answer;
	};
	const def = inst._zod.def;
	switch (def.type) {
		case "object": {
			const raw = rawShape(def);
			merge(raw ? shape(raw, true) : ASSUMED);
			check(def.catchall);
			break;
		}
		case "array":
			check(def.element);
			break;
		case "tuple":
			for (const el of def.items) check(el);
			check(def.rest);
			break;
		case "record":
		case "map":
			check(def.keyType);
			check(def.valueType);
			break;
		case "set":
			check(def.valueType);
			break;
		case "union":
			for (const el of def.options) check(el);
			break;
		case "intersection":
			check(def.left);
			check(def.right);
			break;
		case "optional":
		case "nullable":
		case "default":
		case "prefault":
		case "catch":
		case "readonly":
		case "nonoptional":
		case "promise":
		case "success":
			check(def.innerType);
			break;
		case "pipe":
			check(def.in);
			check(def.out);
			break;
		case "function":
			check(def.input);
			check(def.output);
			break;
		case "lazy": {
			const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
			merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
			break;
		}
		case "template_literal":
		case "string":
		case "number":
		case "int":
		case "boolean":
		case "bigint":
		case "symbol":
		case "undefined":
		case "null":
		case "void":
		case "never":
		case "any":
		case "unknown":
		case "date":
		case "nan":
		case "enum":
		case "literal":
		case "file":
		case "transform":
		case "custom": break;
		default: for (const key in def) {
			const desc = Object.getOwnPropertyDescriptor(def, key);
			if (!desc || desc.get) continue;
			const value = desc.value;
			if (!value || typeof value !== "object") continue;
			if (value._zod) check(value);
			else if (Array.isArray(value)) for (const el of value) check(el);
		}
	}
	stack.delete(inst);
	return settle(inst, result);
}
/** An assumed answer must not outlive the resolution that settles it, so only a certain one is cached. */
function settle(inst, answer) {
	if (answer !== ASSUMED) recursive.set(inst, answer === PROVEN);
	return answer;
}
function bucketFor(state, inst) {
	let bucket = state.buckets.get(inst);
	if (!bucket) {
		bucket = /* @__PURE__ */ new WeakMap();
		state.buckets.set(inst, bucket);
	}
	return bucket;
}
let handoff;
const open = [];
const memo = {
	alloc(_inst, payload, empty) {
		const bucket = handoff;
		if (!bucket) return empty;
		handoff = void 0;
		const entry = {
			value: empty,
			issues: null
		};
		bucket.set(payload.value, entry);
		open.push(entry);
		return empty;
	},
	guard(inst) {
		var _a;
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred.push(() => {
			const base = inst._zod.parse;
			const wrapped = (payload, ctx) => {
				if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value)) throw new $ZodCyclicError();
				return base(payload, ctx);
			};
			inst._zod.parse = wrapped;
			if (inst._zod.run === base) inst._zod.run = wrapped;
		});
	},
	attach(inst) {
		var _a;
		let isRecursiveInst;
		let rechecked = false;
		let lastCtx;
		let lastBucket;
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred.push(() => {
			const base = inst._zod.parse;
			const wrapped = (payload, ctx) => {
				if (isRecursiveInst === void 0) {
					const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
					if (walked === NONE) {
						inst._zod.parse = base;
						if (inst._zod.run === wrapped) inst._zod.run = base;
						return base(payload, ctx);
					}
					if (walked === PROVEN || rechecked) isRecursiveInst = true;
					else rechecked = true;
				}
				const input = payload.value;
				if (!isRef(input)) return base(payload, ctx);
				let state = ctx[STATE];
				if (!state) {
					state = {
						buckets: /* @__PURE__ */ new WeakMap(),
						backEdges: void 0
					};
					ctx[STATE] = state;
				}
				let bucket;
				if (lastCtx === ctx) bucket = lastBucket;
				else {
					bucket = bucketFor(state, inst);
					lastCtx = ctx;
					lastBucket = bucket;
				}
				const hit = bucket.get(input);
				if (hit) {
					payload.value = hit.value;
					if (hit.issues) {
						if (hit.issues.length) payload.issues.push(...cloneIssues(hit.issues));
					} else {
						payload.memo = true;
						state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
						state.backEdges.add(hit.value);
					}
					return payload;
				}
				handoff = bucket;
				const depth = open.length;
				const result = base(payload, ctx);
				handoff = void 0;
				const entry = open.length > depth ? open.pop() : void 0;
				if (result instanceof Promise) return result.then((r) => {
					if (entry) entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
					return r;
				});
				if (entry) entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
				return result;
			};
			inst._zod.parse = wrapped;
			if (inst._zod.run === base) inst._zod.run = wrapped;
		});
	}
};
/** The memoizer that gives containers cycle support. `zod` installs it by default; `zod/mini` opts in with `config({ memoizer: memoizer() })`. */
function memoizer() {
	return memo;
}
/** Whether this value is a node a back-edge resolved to before it finished. */
function isBackEdge(ctx, value) {
	const backEdges = ctx[STATE]?.backEdges;
	return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/locales/en.js
const error = () => {
	const Sizable = {
		string: {
			unit: "characters",
			verb: "to have"
		},
		file: {
			unit: "bytes",
			verb: "to have"
		},
		array: {
			unit: "items",
			verb: "to have"
		},
		set: {
			unit: "items",
			verb: "to have"
		},
		map: {
			unit: "entries",
			verb: "to have"
		}
	};
	function getSizing(origin) {
		return Sizable[origin] ?? null;
	}
	const FormatDictionary = {
		regex: "input",
		email: "email address",
		url: "URL",
		emoji: "emoji",
		uuid: "UUID",
		uuidv4: "UUIDv4",
		uuidv6: "UUIDv6",
		nanoid: "nanoid",
		guid: "GUID",
		cuid: "cuid",
		cuid2: "cuid2",
		ulid: "ULID",
		xid: "XID",
		ksuid: "KSUID",
		datetime: "ISO datetime",
		date: "ISO date",
		time: "ISO time",
		duration: "ISO duration",
		ipv4: "IPv4 address",
		ipv6: "IPv6 address",
		mac: "MAC address",
		cidrv4: "IPv4 range",
		cidrv6: "IPv6 range",
		base64: "base64-encoded string",
		base64url: "base64url-encoded string",
		json_string: "JSON string",
		e164: "E.164 number",
		currency_code: "currency code",
		credit_card: "credit card number",
		iban: "IBAN",
		jwt: "JWT",
		template_literal: "input"
	};
	const TypeDictionary = { nan: "NaN" };
	function getTypeName(type, input) {
		if (type === "number" && typeof input === "number" && !Number.isFinite(input)) return String(input);
		return TypeDictionary[type] ?? type;
	}
	return (issue) => {
		switch (issue.code) {
			case "invalid_type": return `Invalid input: expected ${getTypeName(issue.expected)}, received ${getTypeName(parsedType(issue.input), issue.input)}`;
			case "invalid_value":
				if (issue.values.length === 1) return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
				return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
			case "too_big": {
				const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
				const sizing = getSizing(issue.origin);
				if (sizing) return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
				return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
			}
			case "too_small": {
				const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
				const sizing = getSizing(issue.origin);
				if (sizing) return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
				return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
			}
			case "invalid_format": {
				const _issue = issue;
				if (_issue.format === "starts_with") return `Invalid string: must start with "${_issue.prefix}"`;
				if (_issue.format === "ends_with") return `Invalid string: must end with "${_issue.suffix}"`;
				if (_issue.format === "includes") return `Invalid string: must include "${_issue.includes}"`;
				if (_issue.format === "regex") return `Invalid string: must match pattern ${_issue.pattern}`;
				return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
			}
			case "not_multiple_of": return `Invalid number: must be a multiple of ${issue.divisor}`;
			case "unrecognized_keys": return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
			case "invalid_key": return `Invalid key in ${issue.origin}`;
			case "invalid_union":
				if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) return `Invalid discriminator value. Expected ${issue.options.map((o) => `'${o}'`).join(" | ")}`;
				if (issue.inclusive === false) return "Invalid input: more than one option matched";
				return "Invalid input";
			case "invalid_element": return `Invalid value in ${issue.origin}`;
			default: return `Invalid input`;
		}
	};
};
function en_default() {
	return { localeError: error() };
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
const globalRegistry = globalThis.__zod_globalRegistry;
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
	if (def.checks) def.checks = [...def.checks];
	return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
	return new Class(snapshotChecks({
		type: "string",
		...normalizeParams(params)
	}));
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
	return new Class(snapshotChecks({
		type: "number",
		checks: [],
		...normalizeParams(params)
	}));
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
	return new Class({
		type: "number",
		check: "number_format",
		abort: false,
		format: "safeint",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
	return new Class({
		type: "boolean",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
	return new $ZodCheckMultipleOf({
		check: "multiple_of",
		...normalizeParams(params),
		value
	});
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				if (!("input" in _issue)) _issue.input = payload.value;
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
	for (const source of sources) for (const key of Reflect.ownKeys(source)) if (Object.prototype.propertyIsEnumerable.call(source, key)) assignProp(target, key, source[key]);
	return target;
}
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		sharedDefsExtractedFor: void 0,
		sharedEmitDoneFor: void 0,
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		intersections: [],
		deferred: [],
		external: params?.external ?? void 0
	};
}
/**
* Applies the `unrepresentable` setting at a site that has no JSON Schema equivalent. Throws
* `message` unless the setting (or the handler's return value) says otherwise. Returns `true` if a
* custom JSON Schema was written into `json`, in which case the caller must not write its own.
*/
function handleUnrepresentable(schema, ctx, json, params, message) {
	const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({
		zodSchema: schema,
		path: params.path,
		message
	}) : ctx.unrepresentable;
	if (result === "any") return false;
	if (result === void 0 || result === "throw") throw new Error(message);
	Object.assign(json, result);
	return true;
}
function processSchema(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	ctx.sharedDefsExtractedFor = void 0;
	ctx.sharedEmitDoneFor = void 0;
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			processSchema(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) assignProps(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function encodeJSONPointerSegment(segment) {
	return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external) return;
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}`
			};
		}
		const uriPrefix = `#`;
		const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
		if (entry[1] === root && !entry[1].schema.id) return { ref: uriPrefix };
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + encodeJSONPointerSegment(defId)
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") extractToDef(entry);
		}
	}
	if (ctx.external) ctx.sharedDefsExtractedFor = ctx.external;
}
/** Rewrites `anyOf: [{type: "a"}, {type: "b"}]` to `type: ["a", "b"]`, which every JSON Schema draft treats as equivalent and most consumers render far better for the nullable case. Only branches that are a bare type assertion qualify — anything carrying a constraint, `$ref`, `const` or metadata is left alone. Runs after `flattenRef`, so a branch an override decorated or `$defs` extraction turned into a `$ref` is no longer bare and correctly stays in `anyOf`. `oneOf` is excluded: `integer` and `number` overlap, so "exactly one" and "at least one" are not the same there. OpenAPI 3.0 is excluded: its `type` must be a single string. */
function compactTypeUnion(schema) {
	const options = schema.anyOf;
	if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0) return;
	const types = [];
	for (const option of options) {
		if (!option || typeof option !== "object") return;
		compactTypeUnion(option);
		const keys = Object.keys(option);
		if (keys.length !== 1 || keys[0] !== "type") return;
		const type = option.type;
		for (const member of Array.isArray(type) ? type : [type]) {
			if (typeof member !== "string") return;
			if (!types.includes(member)) types.push(member);
		}
	}
	delete schema.anyOf;
	schema.type = types.length === 1 ? types[0] : types;
}
/** Keywords `foldIntersection` knows how to combine. Anything else — `$ref`, `patternProperties`,
* an annotation like `description` — makes a member unfoldable, so a constraint this does not
* understand leaves the `allOf` alone instead of being silently dropped or misattributed. */
const FOLDABLE_KEYS = /* @__PURE__ */ new Set([
	"type",
	"properties",
	"required",
	"additionalProperties"
]);
const UNION_KEYS = ["oneOf", "anyOf"];
/** A member's constraint on a key it does not declare itself. A `catchall` states one; `false`, an absent `additionalProperties`, and the empty schema a loose object emits state nothing. */
function undeclaredConstraint(member) {
	const extra = member.additionalProperties;
	if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null) return null;
	return Object.keys(extra).length ? extra : null;
}
/** Combines object members into the single object they describe together, or returns `null` if any of them carries a keyword outside {@link FOLDABLE_KEYS}. */
function foldObjects(members) {
	const objects = [];
	for (const member of members) {
		if (typeof member !== "object" || member.type !== "object") return null;
		for (const key in member) if (!FOLDABLE_KEYS.has(key)) return null;
		objects.push(member);
	}
	const properties = {};
	const required = /* @__PURE__ */ new Set();
	for (const object of objects) {
		for (const key in object.properties) {
			if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
			const parts = [];
			for (const other of objects) {
				const part = other.properties?.[key] ?? undeclaredConstraint(other);
				if (part === null || part === void 0) continue;
				if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part))) parts.push(part);
			}
			assignProp(properties, key, parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts });
		}
		for (const key of object.required ?? []) required.add(key);
	}
	const folded = {
		type: "object",
		properties
	};
	if (required.size) folded.required = [...required];
	if (objects.every((object) => object.additionalProperties === false)) folded.additionalProperties = false;
	else {
		const constraints = [];
		for (const object of objects) {
			const constraint = undeclaredConstraint(object);
			if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint))) constraints.push(constraint);
		}
		if (constraints.length === 1) folded.additionalProperties = constraints[0];
		else if (constraints.length > 1) folded.additionalProperties = { allOf: constraints };
	}
	return folded;
}
/** `additionalProperties` in an `allOf` member sees only that member's own `properties`, so two
* closed object members reject each other's keys and the schema validates nothing. Zod's parser
* pools the key sets instead — `handleIntersectionResults` reports a key as unrecognized only when
* *every* side rejects it — so the emitted schema has to pool them too, and folding the members
* into one object is the encoding that says so on every target.
*
* This runs from `finalize`, after `extractDefs`, which is what keeps it clear of the `$ref`
* machinery: a member extracted into `$defs` is already a `$ref` by now and declines to fold, so it
* keeps its reference and its own closedness rather than being inlined as a stale copy. */
function foldIntersection(json) {
	const allOf = json.allOf;
	if (!Array.isArray(allOf) || allOf.length < 2) return;
	for (const key of FOLDABLE_KEYS) if (key in json) return;
	const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
	let folded = null;
	if (!unions.length) folded = foldObjects(allOf);
	else {
		const union = unions[0];
		const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
		if (Object.keys(union).length !== 1) return;
		const rest = allOf.filter((m) => m !== union);
		const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
		if (branches.some((b) => !b)) return;
		folded = { [keyword]: branches };
	}
	if (!folded) return;
	delete json.allOf;
	assignProps(json, folded);
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else assignProps(schema, refSchema);
			assignProps(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
		for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
		if (ctx.target !== "openapi-3.0") for (const entry of ctx.seen.entries()) compactTypeUnion(entry[1].def ?? entry[1].schema);
		for (const rewrite of ctx.deferred) rewrite();
		if (ctx.intersections.length) {
			const carriers = /* @__PURE__ */ new Map();
			for (const seen of ctx.seen.values()) for (const json of [seen.schema, seen.def]) {
				const allOf = json?.allOf;
				if (!Array.isArray(allOf)) continue;
				const existing = carriers.get(allOf);
				if (existing) existing.push(json);
				else carriers.set(allOf, [json]);
			}
			for (const allOf of ctx.intersections) for (const json of carriers.get(allOf) ?? []) foldIntersection(json);
		}
	}
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			assignProp(defs, seen.defId, seen.def);
		}
	}
	if (ctx.external) ctx.sharedEmitDoneFor = ctx.external;
	if (ctx.external) {} else if (Object.keys(defs).length > 0) {
		if (ctx.target === "draft-2020-12") result.$defs = defs;
		else result.definitions = defs;
	}
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	processSchema(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	processSchema(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/json-schema-processors.js
const narrowMin = (agg, key, value) => {
	if (agg[key] === void 0 || value > agg[key]) agg[key] = value;
};
const narrowMax = (agg, key, value) => {
	if (agg[key] === void 0 || value < agg[key]) agg[key] = value;
};
const narrowBoth = (agg, value) => {
	narrowMin(agg, "minimum", value);
	narrowMax(agg, "maximum", value);
};
const addDivisor = (agg, value) => {
	agg.multipleOf ?? (agg.multipleOf = []);
	if (!agg.multipleOf.includes(value)) agg.multipleOf.push(value);
};
const addPattern = (agg, pattern) => {
	agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
	agg.patterns.add(pattern);
};
const intersectMime = (agg, mime) => {
	agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
const setFormat = (agg, format) => {
	agg.format = format;
	if (format.includes("int")) agg.isInt = true;
};
const minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
const maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
const formatContributor = (ranges) => (agg, def) => {
	setFormat(agg, def.format);
	const [minimum, maximum] = ranges[def.format];
	narrowMin(agg, "minimum", minimum);
	narrowMax(agg, "maximum", maximum);
};
const contributors = {
	greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
	less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
	multiple_of: (agg, def) => addDivisor(agg, def.value),
	number_format: formatContributor(NUMBER_FORMAT_RANGES),
	bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
	min_length: minContributor,
	max_length: maxContributor,
	length_equals: (agg, def) => narrowBoth(agg, def.length),
	min_size: minContributor,
	max_size: maxContributor,
	size_equals: (agg, def) => narrowBoth(agg, def.size),
	string_format: (agg, def) => {
		setFormat(agg, def.format);
		if (def.pattern) addPattern(agg, def.pattern);
		if (def.format === "base64" || def.format === "base64url") agg.contentEncoding = def.format;
		if (def.local || def.precision === -1) agg.laxFormat = true;
	},
	mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
	const agg = {};
	const def = schema._zod.def;
	const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
	for (const ch of list) contributors[ch._zod.def.check]?.(agg, ch._zod.def);
	const bag = schema._zod.bag;
	if (bag.minimum !== void 0) narrowMin(agg, "minimum", bag.minimum);
	if (bag.exclusiveMinimum !== void 0) narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
	if (bag.maximum !== void 0) narrowMax(agg, "maximum", bag.maximum);
	if (bag.exclusiveMaximum !== void 0) narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
	if (bag.multipleOf !== void 0) addDivisor(agg, bag.multipleOf);
	if (bag.format !== void 0) {
		agg.format ?? (agg.format = bag.format);
		if (bag.format.includes("int")) agg.isInt = true;
	}
	if (bag.mime) intersectMime(agg, bag.mime);
	for (const pattern of bag.patterns ?? []) addPattern(agg, pattern);
	return agg;
}
const formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
const exactPatterns = /* @__PURE__ */ new Map([[base64Charset, base64], [base64urlCharset, base64url]]);
const exactPattern = (p) => exactPatterns.get(p) ?? p;
const stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time" || laxFormat) delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const patternList = [...patterns].map(exactPattern);
		if (patternList.length === 1) json.pattern = patternList[0].source;
		else if (patternList.length > 1) json.allOf = [...patternList.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
const numberProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
	json.type = isInt ? "integer" : "number";
	const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
	const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
	const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
	if (exMin) {
		if (legacy) {
			json.minimum = exclusiveMinimum;
			json.exclusiveMinimum = true;
		} else json.exclusiveMinimum = exclusiveMinimum;
	} else if (typeof minimum === "number") json.minimum = minimum;
	if (exMax) {
		if (legacy) {
			json.maximum = exclusiveMaximum;
			json.exclusiveMaximum = true;
		} else json.exclusiveMaximum = exclusiveMaximum;
	} else if (typeof maximum === "number") json.maximum = maximum;
	if (multipleOf) {
		const divisors = /* @__PURE__ */ new Set();
		for (const divisor of multipleOf) if (Number.isFinite(divisor) && divisor !== 0) divisors.add(Math.abs(divisor));
		else handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
		const [first, ...rest] = divisors;
		if (first !== void 0) json.multipleOf = first;
		if (rest.length) json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
	}
};
const booleanProcessor = (_schema, _ctx, json, _params) => {
	json.type = "boolean";
};
const neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
const enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.length === 0) {
		json.not = {};
		return;
	}
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
const literalProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	if (def.values.length === 0) {
		json.not = {};
		return;
	}
	const vals = [];
	for (const val of def.values) if (val === void 0) {
		if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema")) return;
	} else if (typeof val === "bigint") {
		if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema")) return;
		vals.push(Number(val));
	} else vals.push(val);
	if (vals.length === 0) {} else if (vals.length === 1) {
		const val = vals[0];
		json.type = val === null ? "null" : typeof val;
		if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
		else json.const = val;
	} else {
		if (vals.every((v) => typeof v === "number")) json.type = "number";
		if (vals.every((v) => typeof v === "string")) json.type = "string";
		if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
		if (vals.every((v) => v === null)) json.type = "null";
		json.enum = vals;
	}
};
const customProcessor = (schema, ctx, json, params) => {
	handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
const transformProcessor = (schema, ctx, json, params) => {
	handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
const arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = aggregateChecks(schema);
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = processSchema(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
function inputOptin(schema) {
	const def = schema._zod.def;
	if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) return inputOptin(def.out);
	if (def.type === "catch") return inputOptin(def.innerType);
	return schema._zod.optin;
}
const objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const shape = def.shape;
	if (Object.getOwnPropertySymbols(shape).length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) return;
	json.type = "object";
	json.properties = {};
	for (const key in shape) assignProp(json.properties, key, processSchema(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	}));
	const requiredKeys = [];
	for (const key of Object.keys(shape)) {
		const field = def.shape[key];
		if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) requiredKeys.push(key);
	}
	if (requiredKeys.length > 0) json.required = requiredKeys;
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = processSchema(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
const unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => processSchema(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
const intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = processSchema(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = processSchema(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	const allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
	json.allOf = allOf;
	ctx.intersections.push(allOf);
};
/** JSON object keys are always strings, so a numeric record key schema is re-expressed over the
* numeric-string form the record parser matches. Deferred to `finalize`, after the flatten: a key
* behind a wrapper only carries its own `type` before then, and a union key only has its branches.
*
* A numeric bound cannot apply to a property name, so `minimum` and its siblings are dropped rather
* than carried over: keeping them beside `type: "string"` reproduces the match-nothing schema this
* exists to fix. A key that carries one therefore emits wider than the record parses — `z.record(z.number().min(5), V)`
* accepts `"3"` — which is the deliberate trade, since throwing on it would reject an ordinary schema
* outright. */
function stringifyKeyNames(bySchema, json, visited) {
	if (json.$ref) {
		if (visited.has(json)) return json;
		visited.add(json);
		const def = bySchema.get(json)?.def;
		if (!def) return json;
		const inlined = stringifyKeyNames(bySchema, def, visited);
		return inlined === def ? json : inlined;
	}
	for (const keyword of ["anyOf", "oneOf"]) {
		const branches = json[keyword];
		if (!Array.isArray(branches)) continue;
		const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
		if (mapped.some((branch, i) => branch !== branches[i])) json = {
			...json,
			[keyword]: mapped
		};
	}
	const types = Array.isArray(json.type) ? json.type : [json.type];
	const numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer");
	const values = json.enum ?? (json.const !== void 0 ? [json.const] : void 0);
	if (!numericType && !values?.some((v) => typeof v === "number")) return json;
	const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id, ...rest } = json;
	if (rest.enum) rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
	else if (typeof rest.const === "number") rest.const = String(rest.const);
	if (!numericType) return rest;
	rest.type = "string";
	if (!values) rest.pattern = (types.includes("number") ? number$1 : integer).source;
	return rest;
}
/** Every record of one conversion, so the carriers are found in a single pass rather than once per record. */
const pendingRecords = /* @__PURE__ */ new WeakMap();
function rewriteKeyNames(ctx) {
	const bySchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.values()) if (entry.def && !bySchema.has(entry.schema)) bySchema.set(entry.schema, entry);
	const rewrites = /* @__PURE__ */ new Map();
	for (const record of pendingRecords.get(ctx) ?? []) {
		const seen = ctx.seen.get(record);
		const names = (seen?.def ?? seen?.schema)?.propertyNames;
		if (!names || names === true || rewrites.has(names)) continue;
		const rewritten = stringifyKeyNames(bySchema, names, /* @__PURE__ */ new Set());
		if (rewritten !== names) rewrites.set(names, rewritten);
	}
	if (!rewrites.size) return;
	for (const entry of ctx.seen.values()) for (const carrier of [entry.schema, entry.def]) {
		const rewritten = carrier && rewrites.get(carrier.propertyNames);
		if (rewritten) carrier.propertyNames = rewritten;
	}
}
const recordProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	const keyType = def.keyType;
	const patterns = aggregateChecks(keyType).patterns;
	if (def.mode === "loose" && patterns && patterns.size > 0) {
		const valueSchema = processSchema(def.valueType, ctx, {
			...params,
			path: [
				...params.path,
				"patternProperties",
				"*"
			]
		});
		json.patternProperties = {};
		for (const pattern of patterns) assignProp(json.patternProperties, exactPattern(pattern).source, valueSchema);
	} else {
		if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
			json.propertyNames = processSchema(def.keyType, ctx, {
				...params,
				path: [...params.path, "propertyNames"]
			});
			let pending = pendingRecords.get(ctx);
			if (!pending) {
				pending = [];
				pendingRecords.set(ctx, pending);
				ctx.deferred.push(() => rewriteKeyNames(ctx));
			}
			pending.push(schema);
		}
		json.additionalProperties = processSchema(def.valueType, ctx, {
			...params,
			path: [...params.path, "additionalProperties"]
		});
	}
	const keyValues = keyType._zod.values;
	const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== void 0;
	if (keyValues && !def.partial && !omittableOnInput) {
		const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
		if (validKeyValues.length > 0) json.required = validKeyValues.map(String);
	}
};
const nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
const nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
/** Round-trips a default value through JSON so the emitted schema is guaranteed to be valid JSON.
* A BigInt has no reliable encoding, so it goes through `unrepresentable` like any other
* unrepresentable value. Returns a sentinel when the caller must not write a default of its own. */
const UNREPRESENTABLE_DEFAULT = Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
	let unrepresentable = false;
	const serialized = JSON.stringify(value, (_, val) => {
		if (typeof val !== "bigint") return val;
		unrepresentable = true;
		return null;
	});
	if (!unrepresentable) return JSON.parse(serialized);
	handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
	return UNREPRESENTABLE_DEFAULT;
}
const defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
	if (value !== UNREPRESENTABLE_DEFAULT) json.default = value;
};
const prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io !== "input") return;
	const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
	if (value !== UNREPRESENTABLE_DEFAULT) json._prefault = value;
};
const catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
		return;
	}
	json.default = catchValue;
};
const pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	processSchema(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
const readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
const optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/classic/errors.js
const _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
	Object.defineProperty(proto, key, {
		configurable: true,
		enumerable: false,
		get() {
			const value = make(this);
			Object.defineProperty(this, key, {
				value,
				configurable: true,
				writable: true
			});
			return value;
		},
		set(value) {
			Object.defineProperty(this, key, {
				value,
				configurable: true,
				writable: true
			});
		}
	});
}
const initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	const proto = Object.getPrototypeOf(inst);
	if (_installedErrorProtos.has(proto)) return;
	_installedErrorProtos.add(proto);
	_lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
	_lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
	_lazyMethod(proto, "addIssue", (self) => (issue) => {
		self.issues.push(issue);
		self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
	});
	_lazyMethod(proto, "addIssues", (self) => (issues) => {
		self.issues.push(...issues);
		self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
	});
	Object.defineProperty(proto, "isEmpty", {
		configurable: true,
		enumerable: false,
		get() {
			return this.issues.length === 0;
		}
	});
};
const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, void 0, { Parent: Error });
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/classic/parse.js
const parse$1 = /* @__PURE__ */ _parse(ZodRealError);
const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
const encode = /* @__PURE__ */ _encode(ZodRealError);
const decode = /* @__PURE__ */ _decode(ZodRealError);
const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
	if (!globalConfig.localeError) config(en_default());
}
function _ensureDefaultMemoizer() {
	if (!globalConfig.memoizer) config({ memoizer: memoizer() });
}
const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
	_ensureDefaultLocale();
	$ZodType.init(inst, def);
	inst.def = def;
	inst.type = def.type;
	return inst;
}, {
	check(...chks) {
		const def = this.def;
		return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
			check: ch,
			def: { check: "custom" },
			onattach: []
		} } : ch)] }), { parent: true });
	},
	with(...chks) {
		return this.check(...chks);
	},
	clone(def, params) {
		return clone(this, def, params);
	},
	brand() {
		return this;
	},
	register(reg, meta) {
		reg.add(this, meta);
		return this;
	},
	refine(check, params) {
		return this.check(refine(check, params));
	},
	superRefine(refinement, params) {
		return this.check(superRefine(refinement, params));
	},
	overwrite(fn) {
		return this.check(/* @__PURE__ */ _overwrite(fn));
	},
	optional() {
		return optional(this);
	},
	exactOptional() {
		return exactOptional(this);
	},
	nullable() {
		return nullable(this);
	},
	nullish() {
		return optional(nullable(this));
	},
	nonoptional(params) {
		return nonoptional(this, params);
	},
	array() {
		return array(this);
	},
	or(arg) {
		return union([this, arg]);
	},
	and(arg) {
		return intersection(this, arg);
	},
	transform(tx) {
		return pipe(this, transform(tx));
	},
	default(d) {
		return _default(this, d);
	},
	prefault(d) {
		return prefault(this, d);
	},
	catch(params) {
		return _catch(this, params);
	},
	pipe(target) {
		return pipe(this, target);
	},
	readonly() {
		return readonly(this);
	},
	describe(description) {
		const cl = this.clone();
		globalRegistry.add(cl, { description });
		return cl;
	},
	meta(...args) {
		if (args.length === 0) return globalRegistry.get(this);
		const cl = this.clone();
		globalRegistry.add(cl, args[0]);
		return cl;
	},
	isOptional() {
		return this.safeParse(void 0).success;
	},
	isNullable() {
		return this.safeParse(null).success;
	},
	apply(fn, ...args) {
		return args.length === 0 ? fn(this) : fn(this, ...args);
	},
	get "~standard"() {
		return hide(this, "~standard", {
			...standardProps(this),
			jsonSchema: {
				input: createStandardJSONSchemaMethod(this, "input"),
				output: createStandardJSONSchemaMethod(this, "output")
			}
		});
	},
	set "~standard"(value) {
		own(this, "~standard", value);
	},
	parse: function _parse(data, params) {
		return parse$1(this, data, params, { callee: _parse });
	},
	parseAsync: async function _parseAsync(data, params) {
		return await parseAsync(this, data, params, { callee: _parseAsync });
	},
	safeParse(data, params) {
		return safeParse(this, data, params);
	},
	async safeParseAsync(data, params) {
		return safeParseAsync(this, data, params);
	},
	get spa() {
		return this?.safeParseAsync;
	},
	set spa(value) {
		own(this, "spa", value);
	},
	validate(data, params) {
		return validate(this, data, params);
	},
	validateAsync(data, params) {
		return validateAsync$1(this, data, params);
	},
	encode: function _encode(data, params) {
		return encode(this, data, params, { callee: _encode });
	},
	decode: function _decode(data, params) {
		return decode(this, data, params, { callee: _decode });
	},
	encodeAsync: async function _encodeAsync(data, params) {
		return await encodeAsync(this, data, params, { callee: _encodeAsync });
	},
	decodeAsync: async function _decodeAsync(data, params) {
		return await decodeAsync(this, data, params, { callee: _decodeAsync });
	},
	safeEncode(data, params) {
		return safeEncode(this, data, params);
	},
	safeDecode(data, params) {
		return safeDecode(this, data, params);
	},
	async safeEncodeAsync(data, params) {
		return safeEncodeAsync(this, data, params);
	},
	async safeDecodeAsync(data, params) {
		return safeDecodeAsync(this, data, params);
	},
	toJSONSchema(params) {
		return createToJSONSchemaMethod(this, {})(params);
	},
	get description() {
		return globalRegistry.get(this)?.description;
	},
	get _def() {
		return this._zod.def;
	}
});
/** @internal */
const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
}, /*@__PURE__*/ derived({
	format: (inst) => aggregateChecks(inst).format ?? null,
	minLength: (inst) => aggregateChecks(inst).minimum ?? null,
	maxLength: (inst) => aggregateChecks(inst).maximum ?? null
}, {
	regex(...args) {
		return this.check(/* @__PURE__ */ _regex(...args));
	},
	includes(...args) {
		return this.check(/* @__PURE__ */ _includes(...args));
	},
	startsWith(...args) {
		return this.check(/* @__PURE__ */ _startsWith(...args));
	},
	endsWith(...args) {
		return this.check(/* @__PURE__ */ _endsWith(...args));
	},
	min(...args) {
		return this.check(/* @__PURE__ */ _minLength(...args));
	},
	max(...args) {
		return this.check(/* @__PURE__ */ _maxLength(...args));
	},
	length(...args) {
		return this.check(/* @__PURE__ */ _length(...args));
	},
	nonempty(...args) {
		return this.check(/* @__PURE__ */ _minLength(1, ...args));
	},
	lowercase(params) {
		return this.check(/* @__PURE__ */ _lowercase(params));
	},
	uppercase(params) {
		return this.check(/* @__PURE__ */ _uppercase(params));
	},
	trim() {
		return this.check(/* @__PURE__ */ _trim());
	},
	normalize(...args) {
		return this.check(/* @__PURE__ */ _normalize(...args));
	},
	toLowerCase() {
		return this.check(/* @__PURE__ */ _toLowerCase());
	},
	toUpperCase() {
		return this.check(/* @__PURE__ */ _toUpperCase());
	},
	slugify() {
		return this.check(/* @__PURE__ */ _slugify());
	}
}));
const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
}, {
	email(params) {
		return this.check(/* @__PURE__ */ _email(ZodEmail, params));
	},
	url(params) {
		return this.check(/* @__PURE__ */ _url(ZodURL, params));
	},
	jwt(params) {
		return this.check(/* @__PURE__ */ _jwt(ZodJWT, params));
	},
	emoji(params) {
		return this.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
	},
	guid(params) {
		return this.check(/* @__PURE__ */ _guid(ZodGUID, params));
	},
	uuid(params) {
		return this.check(/* @__PURE__ */ _uuid(ZodUUID, params));
	},
	uuidv4(params) {
		return this.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
	},
	uuidv6(params) {
		return this.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
	},
	uuidv7(params) {
		return this.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
	},
	nanoid(params) {
		return this.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
	},
	cuid(params) {
		return this.check(/* @__PURE__ */ _cuid(ZodCUID, params));
	},
	cuid2(params) {
		return this.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
	},
	ulid(params) {
		return this.check(/* @__PURE__ */ _ulid(ZodULID, params));
	},
	base64(params) {
		return this.check(/* @__PURE__ */ _base64(ZodBase64, params));
	},
	base64url(params) {
		return this.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
	},
	xid(params) {
		return this.check(/* @__PURE__ */ _xid(ZodXID, params));
	},
	ksuid(params) {
		return this.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
	},
	ipv4(params) {
		return this.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
	},
	ipv6(params) {
		return this.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
	},
	cidrv4(params) {
		return this.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
	},
	cidrv6(params) {
		return this.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
	},
	e164(params) {
		return this.check(/* @__PURE__ */ _e164(ZodE164, params));
	},
	datetime(params) {
		return this.check(/* @__PURE__ */ _isoDateTime(ZodISODateTime, params));
	},
	date(params) {
		return this.check(/* @__PURE__ */ _isoDate(ZodISODate, params));
	},
	time(params) {
		return this.check(/* @__PURE__ */ _isoTime(ZodISOTime, params));
	},
	duration(params) {
		return this.check(/* @__PURE__ */ _isoDuration(ZodISODuration, params));
	}
});
function string(params) {
	return /* @__PURE__ */ _string(ZodString, params);
}
const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
	$ZodNumber.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
	inst.isFinite = true;
}, /*@__PURE__*/ derived({
	minValue: (inst) => {
		const { minimum, exclusiveMinimum } = aggregateChecks(inst);
		return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
	},
	maxValue: (inst) => {
		const { maximum, exclusiveMaximum } = aggregateChecks(inst);
		return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
	},
	isInt: (inst) => {
		const { isInt, multipleOf } = aggregateChecks(inst);
		return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
	},
	format: (inst) => aggregateChecks(inst).format ?? null
}, {
	gt(value, params) {
		return this.check(/* @__PURE__ */ _gt(value, params));
	},
	gte(value, params) {
		return this.check(/* @__PURE__ */ _gte(value, params));
	},
	min(value, params) {
		return this.check(/* @__PURE__ */ _gte(value, params));
	},
	lt(value, params) {
		return this.check(/* @__PURE__ */ _lt(value, params));
	},
	lte(value, params) {
		return this.check(/* @__PURE__ */ _lte(value, params));
	},
	max(value, params) {
		return this.check(/* @__PURE__ */ _lte(value, params));
	},
	int(params) {
		return this.check(int(params));
	},
	safe(params) {
		return this.check(int(params));
	},
	positive(params) {
		return this.check(/* @__PURE__ */ _gt(0, params));
	},
	nonnegative(params) {
		return this.check(/* @__PURE__ */ _gte(0, params));
	},
	negative(params) {
		return this.check(/* @__PURE__ */ _lt(0, params));
	},
	nonpositive(params) {
		return this.check(/* @__PURE__ */ _lte(0, params));
	},
	multipleOf(value, params) {
		return this.check(/* @__PURE__ */ _multipleOf(value, params));
	},
	step(value, params) {
		return this.check(/* @__PURE__ */ _multipleOf(value, params));
	},
	finite() {
		return this;
	}
}));
function number(params) {
	return /* @__PURE__ */ _number(ZodNumber, params);
}
const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
	$ZodNumberFormat.init(inst, def);
	ZodNumber.init(inst, def);
});
function int(params) {
	return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
	$ZodBoolean.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean(params) {
	return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
	return /* @__PURE__ */ _unknown(ZodUnknown);
}
const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return /* @__PURE__ */ _never(ZodNever, params);
}
const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
}, {
	min(n, params) {
		return this.check(/* @__PURE__ */ _minLength(n, params));
	},
	nonempty(params) {
		return this.check(/* @__PURE__ */ _minLength(1, params));
	},
	max(n, params) {
		return this.check(/* @__PURE__ */ _maxLength(n, params));
	},
	length(n, params) {
		return this.check(/* @__PURE__ */ _length(n, params));
	},
	unwrap() {
		return this.element;
	}
});
function array(element, params) {
	return /* @__PURE__ */ _array(ZodArray, element, params);
}
const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
	keyof() {
		return _enum(Object.keys(this._zod.def.shape));
	},
	catchall(catchall) {
		return this.clone(mergeDefs(this._zod.def, { catchall }));
	},
	passthrough() {
		return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
	},
	loose() {
		return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
	},
	strict() {
		return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
	},
	strip() {
		return this.clone(mergeDefs(this._zod.def, { catchall: void 0 }));
	},
	extend(incoming) {
		return extend(this, incoming);
	},
	safeExtend(incoming) {
		return safeExtend(this, incoming);
	},
	merge(other) {
		return merge(this, other);
	},
	pick(mask) {
		return pick(this, mask);
	},
	omit(mask) {
		return omit(this, mask);
	},
	partial(...args) {
		return partial(ZodOptional, this, args[0]);
	},
	exactPartial(...args) {
		return partial(ZodExactOptional, this, args[0], "exactPartial");
	},
	required(...args) {
		return required(ZodNonOptional, this, args[0]);
	}
});
function object(shape, params) {
	const def = {
		type: "object",
		shape: shape ?? {},
		...normalizeParams(params)
	};
	return new ZodObject(def);
}
const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
const ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("ZodDiscriminatedUnion", (inst, def) => {
	ZodUnion.init(inst, def);
	$ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
	return new ZodDiscriminatedUnion({
		type: "union",
		options,
		discriminator,
		...normalizeParams(params)
	});
}
const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
const ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodRecord.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
	inst.keyType = def.keyType;
	inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
	if (!valueType || !valueType._zod) return new ZodRecord({
		type: "record",
		keyType: string(),
		valueType: keyType,
		...normalizeParams(valueType)
	});
	return new ZodRecord({
		type: "record",
		keyType,
		valueType,
		...normalizeParams(params)
	});
}
const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = [...inst._zod.values];
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
	return new ZodEnum({
		type: "enum",
		entries,
		...normalizeParams(params)
	});
}
const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
	$ZodLiteral.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
	inst.values = new Set(def.values);
	Object.defineProperty(inst, "value", { get() {
		if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return def.values[0];
	} });
});
function literal(value, params) {
	return new ZodLiteral({
		type: "literal",
		values: Array.isArray(value) ? value : [value],
		...normalizeParams(params)
	});
}
const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				if (!("input" in _issue)) _issue.input = payload.value;
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			return payload;
		});
		payload.value = output;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
	});
}
const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return /* @__PURE__ */ _superRefine(fn, params);
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/classic/iso.js
function datetime(params) {
	return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
}
//#endregion
//#region ../protocol/dist/facts.js
/** ISO time, with Z or an offset. */
const Time = datetime({ offset: true });
/** Tool-specific detail that views never rely on. */
const Extra = record(string(), unknown()).optional();
const SourceSchema = _enum(["claude-code"]);
const SessionFactSchema = object({
	id: string().min(1),
	source: SourceSchema,
	lead: string().min(1),
	title: string().nullable(),
	titleFrom: _enum(["source", "branch"]),
	branch: string().nullable(),
	checkout: string().optional(),
	lastActive: Time,
	status: _enum(["active", "idle"]),
	lights: _enum(["on", "off"]),
	extra: Extra
});
const TokenCount = number().int().nonnegative();
const TokenCounts = object({
	input: TokenCount,
	cacheWrite: TokenCount,
	cacheWrite1h: TokenCount,
	cacheRead: TokenCount,
	output: TokenCount
});
const AgentFactSchema = object({
	id: string().min(1),
	source: SourceSchema,
	session: string().min(1),
	startedBy: string().min(1).nullable(),
	agentType: string().nullable(),
	task: string().nullable(),
	status: _enum([
		"working",
		"idle",
		"done",
		"stalled",
		"stopped",
		"failed"
	]),
	statusSince: Time,
	lastActive: Time,
	doing: object({
		kind: _enum([
			"write",
			"read",
			"run",
			"search",
			"talk"
		]),
		file: string().optional(),
		since: Time
	}).nullable(),
	usage: TokenCounts.extend({
		model: string().min(1),
		context: TokenCount,
		over100k: TokenCounts,
		at: Time
	}).nullable(),
	checkout: string().optional(),
	branch: string().nullable().optional(),
	extra: Extra
});
/** An edit or a read: `file` is relative to the repo root, with forward slashes. */
const FileFactSchema = object({
	agent: string().min(1),
	file: string().min(1),
	at: Time,
	extra: Extra
});
const WaitFactSchema = object({
	waiter: string().min(1),
	on: string().min(1),
	since: Time,
	extra: Extra
});
/**
* An agent's final report. One the secret scan matched, and its owner hasn't released, is
* `withheld`: its `text` then only says so, and the report follows once the owner releases it by
* `withheld.id`, a random id for this one text. A newer report of the same agent gets a new id.
*/
const ReportFactSchema = object({
	agent: string().min(1),
	at: Time,
	text: string(),
	withheld: object({ id: string().min(1) }).optional(),
	extra: Extra
});
/**
* A question an agent asked its owner, open until it is answered, so the floor can show it and the
* owner can answer it there. One of the named cases of session-derived text leaving a machine: the
* server keeps it only for the retention period. `id` is the tool call's own id.
*/
const QuestionFactSchema = object({
	id: string().min(1),
	agent: string().min(1),
	at: Time,
	questions: array(object({
		question: string().min(1),
		header: string(),
		options: array(object({
			label: string().min(1),
			description: string()
		})),
		multiSelect: boolean()
	})).min(1),
	extra: Extra
});
const FactsSchema = object({
	session: SessionFactSchema,
	agents: array(AgentFactSchema),
	edits: array(FileFactSchema),
	reads: array(FileFactSchema),
	waits: array(WaitFactSchema),
	reports: array(ReportFactSchema),
	/** Absent from a data layer that doesn't report questions, which is the same as none. */
	questions: array(QuestionFactSchema).optional()
});
/** The records that changed, each replacing the one with the same key. */
const FactUpsertSchema = object({
	session: SessionFactSchema.optional(),
	agents: array(AgentFactSchema).optional(),
	edits: array(FileFactSchema).optional(),
	reads: array(FileFactSchema).optional(),
	waits: array(WaitFactSchema).optional(),
	reports: array(ReportFactSchema).optional(),
	questions: array(QuestionFactSchema).optional()
});
const FileKey = FileFactSchema.pick({
	agent: true,
	file: true
});
/**
* The keys of records that went away: an agent by its id, an edit or read by agent and file, a
* wait by waiter and on, a report by its agent, a question by its id. The session itself goes with
* the connection.
*/
const FactRemoveSchema = object({
	agents: array(string().min(1)).optional(),
	edits: array(FileKey).optional(),
	reads: array(FileKey).optional(),
	waits: array(WaitFactSchema.pick({
		waiter: true,
		on: true
	})).optional(),
	reports: array(string().min(1)).optional(),
	questions: array(string().min(1)).optional()
});
const Version = literal(1);
const Seq = number().int().nonnegative();
const ProjectSchema = object({
	id: string().min(1),
	name: string().min(1)
});
const Account = object({
	id: string().min(1),
	name: string()
});
const Machine = object({ name: string().min(1) });
/** Matches a request with its reply or refusal. */
const RequestId = string().min(1);
/** A handoff's id. It names the handoff's branch, `isoplan/handoff/<id>`, so it keeps to safe characters. */
const HandoffId = string().max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes");
/**
* One repo a handoff pushed: its path in the session's folder (`.` for the folder itself), remote,
* branch and commit. A handoff drives git on the receiver's machine, so the path stays inside the
* folder and the remote can't name a transport helper such as `ext::`, which runs a command.
*/
const HandoffRepoSchema = object({
	path: string().min(1).refine((path) => !/^([\\/]|[A-Za-z]:)/.test(path), "a path relative to the session's folder").refine((path) => !path.split(/[\\/]/).includes(".."), "a path inside the session's folder, with no `..`").refine((path) => !path.startsWith("-"), "a path that doesn't start with `-`, which git would read as an option"),
	remote: string().min(1).refine((remote) => !/^[A-Za-z0-9+.-]+::/.test(remote), "a remote with no transport helper (`<transport>::`)").refine((remote) => !remote.startsWith("-"), "a remote that doesn't start with `-`, which git would read as an option"),
	branch: string().min(1),
	commit: string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/, "a full commit hash")
});
/** What the receiver gets: the brief, and every repo pushed for it, each on the handoff's own branch. */
const HandoffSchema = object({
	id: HandoffId,
	brief: string().min(1),
	repos: array(HandoffRepoSchema).min(1)
}).superRefine((handoff, context) => {
	handoff.repos.forEach((repo, i) => {
		if (repo.branch !== `isoplan/handoff/${handoff.id}`) context.addIssue({
			code: "custom",
			path: [
				"repos",
				i,
				"branch"
			],
			message: `the handoff's branch, isoplan/handoff/${handoff.id}`
		});
	});
});
discriminatedUnion("type", [
	object({
		type: literal("hello"),
		v: Version,
		source: SourceSchema,
		account: Account,
		machine: Machine,
		session: string().min(1),
		project: ProjectSchema
	}),
	object({
		type: literal("runner"),
		v: Version,
		account: Account,
		machine: Machine
	}),
	object({
		type: literal("full"),
		v: Version,
		seq: Seq,
		facts: FactsSchema
	}),
	object({
		type: literal("changes"),
		v: Version,
		seq: Seq,
		upsert: FactUpsertSchema,
		remove: FactRemoveSchema
	}),
	discriminatedUnion("kind", [
		object({
			type: literal("reply"),
			v: Version,
			id: RequestId,
			kind: literal("answer-question"),
			answer: string().min(1)
		}),
		object({
			type: literal("reply"),
			v: Version,
			id: RequestId,
			kind: literal("write-brief"),
			handoff: HandoffSchema,
			fallback: literal(true).optional()
		}),
		object({
			type: literal("reply"),
			v: Version,
			id: RequestId,
			kind: literal("owner-answer")
		})
	]),
	discriminatedUnion("reason", [
		object({
			type: literal("refusal"),
			v: Version,
			id: RequestId,
			reason: literal("over-cap"),
			cap: _enum([
				"room-hour",
				"owner-day",
				"owner-tokens"
			])
		}),
		object({
			type: literal("refusal"),
			v: Version,
			id: RequestId,
			reason: literal("withheld"),
			file: string().min(1).optional()
		}),
		object({
			type: literal("refusal"),
			v: Version,
			id: RequestId,
			reason: literal("unavailable"),
			detail: string().min(1)
		})
	]),
	object({
		type: literal("hand-over"),
		v: Version,
		to: string().min(1),
		handoff: HandoffSchema
	}),
	object({
		type: literal("hand-over-check"),
		v: Version,
		to: string().min(1),
		handoff: HandoffId
	}),
	object({
		type: literal("take"),
		v: Version,
		code: string().min(1)
	}),
	object({
		type: literal("taken"),
		v: Version,
		handoff: HandoffId,
		session: string().min(1).optional(),
		failures: array(object({
			step: _enum([
				"worktree",
				"setup",
				"checkout",
				"open"
			]),
			repo: string().min(1).optional(),
			output: string()
		}))
	})
]);
/** Asks the data layer to send its facts in full. */
const RepairMessageSchema = object({
	type: literal("repair"),
	v: Version,
	reason: string().optional()
});
/** A note for the later editor of `file`, which the data layer adds to `agent`'s next tool result. */
const ConflictMessageSchema = object({
	type: literal("conflict"),
	v: Version,
	agent: string().min(1),
	file: string().min(1),
	text: string().min(1)
});
/** Something the data layer should show. */
const ErrorMessageSchema = object({
	type: literal("error"),
	v: Version,
	code: string().min(1),
	message: string()
});
/**
* Something for the machine to answer, with a reply or a refusal carrying the same id. `session` is
* the session it concerns: the lead whose fork answers or writes the brief, or the session whose
* agent asked its owner. `room` is the room the caps count against.
*/
const RequestMessageSchema = discriminatedUnion("kind", [
	object({
		type: literal("request"),
		v: Version,
		id: RequestId,
		kind: literal("answer-question"),
		session: string().min(1),
		room: string().min(1),
		from: Account,
		question: string().min(1)
	}),
	object({
		type: literal("request"),
		v: Version,
		id: RequestId,
		kind: literal("write-brief"),
		session: string().min(1),
		room: string().min(1),
		handoff: HandoffId,
		to: Account
	}),
	object({
		type: literal("request"),
		v: Version,
		id: RequestId,
		kind: literal("owner-answer"),
		session: string().min(1),
		question: string().min(1),
		answers: record(string(), string())
	})
]);
/**
* The owner released what the secret scan withheld, so the machine sends it now. On the runner's
* link `id` is the request whose reply was withheld; on a session's link it is the withheld
* report's `withheld.id`, and only that exact report is released.
*/
const ReleaseMessageSchema = object({
	type: literal("release"),
	v: Version,
	id: RequestId
});
/**
* A handoff for the receiver to take: sent to their runner when they take it from the floor, or to
* their session in answer to a take code.
*/
const HandoffMessageSchema = object({
	type: literal("handoff"),
	v: Version,
	handoff: HandoffSchema,
	mode: _enum(["terminal", "headless"]).optional(),
	session: string().uuid().optional()
});
/** A hand-over-check passed: `to` is the receiver the server found for the name given. */
const HandOverReadyMessageSchema = object({
	type: literal("hand-over-ready"),
	v: Version,
	handoff: HandoffId,
	to: Account
});
const OfficeServerMessageSchema = discriminatedUnion("type", [
	RepairMessageSchema,
	ConflictMessageSchema,
	ErrorMessageSchema,
	RequestMessageSchema,
	ReleaseMessageSchema,
	HandoffMessageSchema,
	object({
		type: literal("handed-over"),
		v: Version,
		handoff: HandoffId,
		to: Account
	}),
	HandOverReadyMessageSchema
]);
/** Validates a message a data layer received from an office server. */
function parseOfficeServerMessage(value) {
	return parse(OfficeServerMessageSchema, value);
}
function parse(schema, value) {
	if (typeof value === "object" && value !== null && "v" in value && typeof value.v === "number" && value.v !== 1) return {
		ok: false,
		kind: "unsupported-version",
		error: `protocol version ${JSON.stringify(value.v)} is not supported; this side speaks version 1`
	};
	const result = schema.safeParse(value);
	if (result.success) return {
		ok: true,
		message: result.data
	};
	return {
		ok: false,
		kind: "invalid",
		error: prettifyError(result.error)
	};
}
//#endregion
//#region ../protocol/dist/project-id.js
/**
* A project's id and name. With a git remote the id is `host/owner/repo` (any deeper path kept, as
* for GitLab subgroups), the same whichever form or letter case the remote is written in, so a
* repository cloned on several machines is one project. A repo with no remote, a remote that is a
* local path, or one that can't be read is `local:<machine>/<root>`, its working tree's root path.
* Never throws, so a remote's credentials never reach an error message.
*/
function projectId(remoteUrl, local) {
	const remote = remoteUrl === null || isLocalPath(remoteUrl.trim()) ? null : splitRemote(remoteUrl.trim());
	const segments = remote?.path.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter(Boolean);
	if (!remote || !segments || segments.length === 0) {
		const root = local.root.replace(/\\/g, "/").replace(/\/+$/, "");
		return {
			id: `local:${local.machine}/${root}`,
			name: root.split("/").pop() || root
		};
	}
	return {
		id: [remote.host, ...segments].join("/").toLowerCase(),
		name: segments[segments.length - 1]
	};
}
function isLocalPath(remote) {
	return remote === "" || /^(?:[/.~\\]|[A-Za-z]:[\\/]|file:)/.test(remote);
}
function splitRemote(remote) {
	if (remote.includes("://")) {
		if (!URL.canParse(remote)) return null;
		const url = new URL(remote);
		return url.hostname ? {
			host: url.hostname,
			path: url.pathname
		} : null;
	}
	const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(remote);
	return scp ? {
		host: scp[1],
		path: scp[2]
	} : null;
}
//#endregion
//#region src/data-layer/config.ts
async function loadConfig(io, defaultsPath, userPath) {
	return loadSettings(io, defaultsPath, userPath);
}
/** The same per-key override for any settings file of the mod's, such as the runner's runner.json. */
async function loadSettings(io, defaultsPath, userPath) {
	const defaults = await readJson(io, defaultsPath);
	const user = await readJson(io, userPath, true);
	const config = {};
	for (const [key, fallback] of Object.entries(defaults)) config[key] = fits(key, user[key], fallback) ? user[key] : fallback;
	return config;
}
const BYTE_KEYS = /* @__PURE__ */ new Set(["tailBytes"]);
const FLOORS = /* @__PURE__ */ new Map([["streamSeconds", .25]]);
const ZERO_OFF = /* @__PURE__ */ new Set(["lightsOffHours"]);
function fits(key, value, fallback) {
	if (key === "server") return typeof value === "string" && isWebSocketUrl(value);
	if (typeof fallback === "number") {
		if (BYTE_KEYS.has(key)) return Number.isSafeInteger(value) && value > 0;
		if (ZERO_OFF.has(key) && value === 0) return true;
		return typeof value === "number" && Number.isFinite(value) && value > 0 && value >= (FLOORS.get(key) ?? 0);
	}
	if (Array.isArray(fallback)) return Array.isArray(value);
	return value != null && typeof value === typeof fallback;
}
const LOOPBACK = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"[::1]",
	"localhost"
]);
function isWebSocketUrl(value) {
	if (!URL.canParse(value)) return false;
	const url = new URL(value);
	return url.protocol === "wss:" || url.protocol === "ws:" && LOOPBACK.has(url.hostname);
}
async function readJson(io, p, optional = false) {
	if (optional && !await io.stat(p)) return {};
	try {
		const value = JSON.parse(await io.read(p));
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	} catch (err) {
		if (optional) return {};
		throw err;
	}
}
//#endregion
//#region src/data-layer/git.ts
/** True for a Windows-shaped path: a drive letter, a UNC prefix, or any backslash. */
function isWindowsPath(p) {
	return /^[A-Za-z]:([\\/]|$)/.test(p) || p.startsWith("\\\\") || p.includes("\\");
}
function isAbsolute(p) {
	return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\");
}
/**
* Forward slashes, "." and ".." folded away, no trailing slash, drive letter upper-cased.
* The root keeps its slash ("C:/", "/").
*/
function normalize(p) {
	let s = p.replace(/\\/g, "/");
	let prefix = "";
	const drive = /^([A-Za-z]):(\/|$)/.exec(s);
	if (drive) {
		prefix = drive[1].toUpperCase() + ":/";
		s = s.slice(drive[0].length);
	} else if (s.startsWith("//")) {
		prefix = "//";
		s = s.slice(2);
	} else if (s.startsWith("/")) {
		prefix = "/";
		s = s.slice(1);
	}
	const out = [];
	for (const part of s.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === ".." && out.length && out[out.length - 1] !== "..") out.pop();
		else if (part !== ".." || !prefix) out.push(part);
	}
	return prefix + out.join("/") || ".";
}
/** A comparison key: normalised, and case-folded for Windows paths (case-insensitive there). */
function pathKey(p) {
	const n = normalize(p);
	return isWindowsPath(p) || /^[A-Z]:\//.test(n) ? n.toLowerCase() : n;
}
function join(base, rel) {
	return isAbsolute(rel) ? normalize(rel) : normalize(base + "/" + rel);
}
/**
* `p` relative to `root` with forward slashes, or null when `p` is not inside `root`. Windows
* paths compare case-insensitively; the relative part keeps `p`'s own spelling, so whoever
* matches files by name compares them case-insensitively too.
*/
function relativeTo(root, p) {
	const win = isWindowsPath(root) || isWindowsPath(p);
	const r = normalize(root);
	const n = normalize(p);
	const rk = win ? r.toLowerCase() : r;
	const nk = win ? n.toLowerCase() : n;
	const base = rk.endsWith("/") ? rk : rk + "/";
	if (!nk.startsWith(base)) return null;
	return n.slice(base.length);
}
//#endregion
//#region src/data-layer/claude-paths.ts
/**
* Claude Code's config folder and its .claude.json: both in $CLAUDE_CONFIG_DIR when it is set,
* else ~/.claude and ~/.claude.json, where Claude Code itself looks.
*/
function claudePaths(env, home) {
	const custom = env.CLAUDE_CONFIG_DIR;
	return custom ? {
		dir: normalize(custom),
		json: join(custom, ".claude.json")
	} : {
		dir: join(home, ".claude"),
		json: join(home, ".claude.json")
	};
}
//#endregion
//#region src/data-layer/identity.ts
/** `claudeJson` is the path of .claude.json (`claudePaths`); git runs in `cwd`. */
async function accountOf(io, claudeJson, cwd) {
	const config = asObject(parseJson(await io.readText(claudeJson)));
	const oauth = asObject(config.oauthAccount);
	const gitName = async () => {
		const r = io.run ? await Promise.resolve(io.run([
			"git",
			"config",
			"user.name"
		], { cwd })).catch(() => null) : null;
		return r && r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
	};
	if (nonEmpty(oauth.accountUuid)) return {
		id: `claude:${oauth.accountUuid}`,
		name: nonEmpty(oauth.displayName) ? oauth.displayName : await gitName() ?? ""
	};
	const name = await gitName();
	if (nonEmpty(config.userID)) return {
		id: `claude-install:${config.userID}`,
		name: name ?? ""
	};
	return {
		id: `git:${name ?? "unknown"}`,
		name: name ?? ""
	};
}
function parseJson(text) {
	try {
		return text === null ? null : JSON.parse(text);
	} catch {
		return null;
	}
}
function asObject(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
//#endregion
//#region src/data-layer/io.ts
function nodeIo({ run = runCommand } = {}) {
	return {
		run,
		async listDir(dir) {
			try {
				return (await fs.readdir(dir, { withFileTypes: true })).map((e) => ({
					name: e.name,
					isDir: e.isDirectory()
				}));
			} catch {
				return [];
			}
		},
		async stat(p) {
			try {
				const s = await fs.stat(p);
				return {
					isDir: s.isDirectory(),
					mtimeMs: s.mtimeMs,
					size: s.size
				};
			} catch {
				return null;
			}
		},
		async read(p, start, end) {
			if (start === void 0 || end === void 0) return fs.readFile(p, "utf8");
			const fh = await fs.open(p, "r");
			try {
				const buf = Buffer.alloc(Math.max(0, end - start));
				const { bytesRead } = await fh.read(buf, 0, buf.length, start);
				return buf.subarray(0, bytesRead).toString("utf8");
			} finally {
				await fh.close();
			}
		}
	};
}
function runCommand([cmd, ...args], { cwd }) {
	return new Promise((resolve) => {
		execFile(cmd, args, {
			cwd,
			encoding: "utf8",
			timeout: 1e4,
			windowsHide: true
		}, (err, stdout) => {
			resolve({
				code: err ? typeof err.code === "number" ? err.code : 1 : 0,
				stdout: stdout || ""
			});
		});
	});
}
//#endregion
//#region src/data-layer/changes.ts
/** null when nothing changed. */
function diffFacts(before, after) {
	const upsert = {};
	const remove = {};
	if (!same(before.session, after.session)) upsert.session = after.session;
	const agents = diff(before.agents, after.agents, (a) => a.id);
	if (agents.upsert.length) upsert.agents = agents.upsert;
	if (agents.remove.length) remove.agents = agents.remove.map((a) => a.id);
	for (const list of ["edits", "reads"]) {
		const d = diff(before[list], after[list], (f) => key(f.agent, f.file));
		if (d.upsert.length) upsert[list] = d.upsert;
		if (d.remove.length) remove[list] = d.remove.map(({ agent, file }) => ({
			agent,
			file
		}));
	}
	const waits = diff(before.waits, after.waits, (w) => key(w.waiter, w.on));
	if (waits.upsert.length) upsert.waits = waits.upsert;
	if (waits.remove.length) remove.waits = waits.remove.map(({ waiter, on }) => ({
		waiter,
		on
	}));
	const reports = diff(before.reports, after.reports, (r) => r.agent);
	if (reports.upsert.length) upsert.reports = reports.upsert;
	if (reports.remove.length) remove.reports = reports.remove.map((r) => r.agent);
	return Object.keys(upsert).length || Object.keys(remove).length ? {
		upsert,
		remove
	} : null;
}
function diff(before, after, keyOf) {
	const old = new Map(before.map((r) => [keyOf(r), r]));
	const now = new Set(after.map(keyOf));
	return {
		upsert: after.filter((r) => !same(old.get(keyOf(r)), r)),
		remove: before.filter((r) => !now.has(keyOf(r)))
	};
}
const key = (...parts) => JSON.stringify(parts);
const same = (a, b) => a !== void 0 && JSON.stringify(a) === JSON.stringify(b);
//#endregion
//#region src/data-layer/link.ts
const OUTBOX_MAX = 100;
const OUTBOX_MAX_AGE_MS = 36e5;
function createLink({ url, hello, emit, minIntervalMs = 1e3, retryBaseMs = 1e3, retryCapMs = 3e4, notWantedRetryMs = 36e5, onNotWanted, onMessage, random = Math.random }) {
	const outbox = [];
	let latest = null;
	let socket = null;
	let isOpen = false;
	let sent = null;
	let seq = 0;
	let sentAt = -Infinity;
	let failures = 0;
	let pacing = null;
	let retry = null;
	let isClosed = false;
	let isUnwanted = false;
	function connect() {
		retry = null;
		emit({
			type: "status",
			server: url,
			state: "connecting"
		});
		const ws = new WebSocket(url);
		socket = ws;
		ws.onopen = () => {
			if (socket !== ws) return;
			failures = 0;
			isOpen = true;
			seq = 0;
			send(hello);
			for (const { message, at } of outbox.splice(0)) if (Date.now() - at < OUTBOX_MAX_AGE_MS) send(message);
			sendFull();
			emit({
				type: "status",
				server: url,
				state: "connected"
			});
		};
		ws.onmessage = (event) => {
			if (socket === ws) receive(event.data);
		};
		ws.onerror = () => {
			if (socket !== ws) return;
			dropped();
			try {
				ws.close();
			} catch {}
		};
		ws.onclose = () => {
			if (socket === ws) dropped();
		};
	}
	function dropped() {
		socket = null;
		isOpen = false;
		sent = null;
		if (pacing) clearTimeout(pacing);
		pacing = null;
		if (isClosed) return;
		if (isUnwanted) {
			isUnwanted = false;
			failures = 0;
			emit({
				type: "status",
				server: url,
				state: "not-wanted"
			});
			retry = setTimeout(connect, notWantedRetryMs);
			return;
		}
		const delay = Math.min(retryCapMs, retryBaseMs * 2 ** failures++);
		const retryInMs = Math.round(delay / 2 + random() * delay / 2);
		emit({
			type: "status",
			server: url,
			state: "disconnected",
			retryInMs
		});
		retry = setTimeout(connect, retryInMs);
	}
	function send(message) {
		socket.send(JSON.stringify(message));
	}
	function sendFull() {
		if (!latest) return;
		send({
			type: "full",
			v: 1,
			seq: seq++,
			facts: latest
		});
		sent = latest;
		sentAt = Date.now();
	}
	function flush() {
		pacing = null;
		if (!isOpen || !latest || !sent) return;
		const changed = diffFacts(sent, latest);
		if (!changed) return;
		const wait = sentAt + minIntervalMs - Date.now();
		if (wait > 0) {
			pacing = setTimeout(flush, wait);
			return;
		}
		send({
			type: "changes",
			v: 1,
			seq: seq++,
			...changed
		});
		sent = latest;
		sentAt = Date.now();
	}
	function receive(data) {
		let value;
		try {
			value = JSON.parse(String(data));
		} catch {
			emit({
				type: "log",
				text: "the office server sent a message that isn't JSON"
			});
			return;
		}
		const parsed = parseOfficeServerMessage(value);
		if (!parsed.ok) {
			emit({
				type: "log",
				text: `the office server sent a message this data layer can't read (${parsed.kind}): ${parsed.error}`
			});
			return;
		}
		const message = parsed.message;
		if (message.type === "repair") {
			if (pacing) clearTimeout(pacing);
			pacing = null;
			sendFull();
		} else if (message.type === "conflict" && !latest?.agents.some((a) => a.id === message.agent)) emit({
			type: "log",
			text: `the office server sent a note for ${message.agent}, not an agent of this session`
		});
		else if (message.type === "conflict" || message.type === "error") {
			emit(message);
			if (message.type === "error" && message.code === "not-wanted") {
				isUnwanted = true;
				onNotWanted?.();
			}
		} else if (onMessage && (message.type === "request" || message.type === "release" || message.type === "handoff")) onMessage(message);
		else emit({
			type: "log",
			text: `the office server sent a ${message.type} message, which this data layer doesn't handle yet`
		});
	}
	connect();
	return {
		update(facts) {
			latest = facts;
			if (isOpen && !sent) sendFull();
			else if (!pacing) flush();
		},
		send(message) {
			if (isOpen && socket.readyState === WebSocket.OPEN) send(message);
			else {
				outbox.push({
					message,
					at: Date.now()
				});
				if (outbox.length > OUTBOX_MAX) outbox.shift();
			}
		},
		close() {
			isClosed = true;
			if (pacing) clearTimeout(pacing);
			if (retry) clearTimeout(retry);
			socket?.close();
		}
	};
}
//#endregion
//#region src/wake/lock.ts
const lockPath = (claudeDir, sessionId) => path.join(claudeDir, "isoplan", "live", `${sessionId}.json`);
const HOLD_OFF_MS = 36e5;
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
/**
* Takes the lock for `pid`; false when it is held (`isHeld`). With `force` (the plugin's data
* layer) it is taken regardless: a detached one holding it sees that and steps aside. `extra` is
* written into the lock beside the pid.
*
* A new lock is created exclusively, so of two takers at once only one gets it. A stale one is
* moved aside by rename, which only one taker can do to the same file, and the taker checks that
* what it moved is the lock it judged stale, by its text and its write time, so a lock its holder
* refreshed meanwhile isn't taken: one that moved another's lock instead puts it back and loses.
* With `force` a lock that can't be moved (on Windows a scanner may have it open) is tried again
* after a short wait, then overwritten, so the plugin's data layer always gets it.
*/
async function takeLock(file, pid, isAlive = alive, force = false, now = Date.now(), { freshMs, extra = {} } = {}) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const body = JSON.stringify({
		pid,
		...extra
	});
	for (let tries = 0; tries < 5; tries++) {
		if (tries && force) await new Promise((r) => setTimeout(r, 20 * tries));
		try {
			await fs.writeFile(file, body, { flag: "wx" });
			return true;
		} catch (err) {
			if (err.code !== "EEXIST") throw err;
		}
		const seen = await readText(file);
		if (!seen) continue;
		const lock = parseLock(seen.text, seen.mtimeMs);
		if (!force && lock?.pid !== pid && held(lock, now, {
			isAlive,
			freshMs
		})) return false;
		const aside = `${file}.${pid}-${Math.random().toString(36).slice(2)}`;
		try {
			await fs.rename(file, aside);
		} catch (err) {
			if ([
				"ENOENT",
				"EPERM",
				"EBUSY",
				"EACCES"
			].includes(err.code ?? "")) continue;
			throw err;
		}
		const moved = await fs.readFile(aside, "utf8").catch(() => null);
		const movedAt = (await fs.stat(aside).catch(() => null))?.mtimeMs;
		if (moved !== seen.text || movedAt !== seen.mtimeMs) {
			await fs.link(aside, file).catch(() => {});
			await fs.rm(aside, { force: true });
			if (!force) return false;
			continue;
		}
		await fs.rm(aside, { force: true });
	}
	if (!force) return false;
	await fs.writeFile(file, body);
	return true;
}
/**
* Marks the lock `pid` holds as fresh; false when another has taken it. A lock briefly missing (a
* taker moved it aside to look, and is putting it back) is looked at again once, after `retryMs`.
*/
async function refreshLock(file, pid, now = Date.now(), retryMs = 250) {
	let holder = await lockHolder(file);
	if (holder === null) {
		await new Promise((r) => setTimeout(r, retryMs));
		holder = await lockHolder(file);
	}
	if (holder !== pid) return false;
	const t = new Date(now);
	await fs.utimes(file, t, t);
	return true;
}
/** Removes the lock if it still names `pid`. */
async function releaseLock(file, pid) {
	if (await lockHolder(file) === pid) await fs.rm(file, { force: true });
}
/** Turns the lock `pid` holds into a hold-off until `until`, with `extra` beside it; one another has taken is left. */
async function holdOff(file, pid, until, extra = {}) {
	if (await lockHolder(file) === pid) await fs.writeFile(file, JSON.stringify({
		pid: 0,
		until,
		...extra
	}));
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
//#region src/runner/caps.ts
const HOUR_MS = 36e5;
const DAY_MS = 24 * HOUR_MS;
/** The tokens `usage` counts for against the budget. */
function weighted(usage, s) {
	return usage.input * s.inputTokenWeight + usage.cacheWrite * s.cacheWriteTokenWeight + usage.cacheRead * s.cacheReadTokenWeight + usage.output * s.outputTokenWeight;
}
/** The most a fork of a lead with this context is expected to use: a cold cache, read by both turns. */
function estimate(context, s) {
	return {
		input: 0,
		output: s.estimatedOutputTokens,
		cacheWrite: context,
		cacheRead: 2 * context
	};
}
/** The cap one more answer in `room`, expected to use `expected`, would go over, or null. */
function overCap(entries, room, expected, now, s) {
	const day = entries.filter((e) => now - e.at < DAY_MS);
	if (day.filter((e) => e.room === room && now - e.at < HOUR_MS).length >= s.answersPerRoomPerHour) return "room-hour";
	if (day.length >= s.answersPerMachinePerDay) return "owner-day";
	if (day.reduce((sum, e) => sum + weighted(e.usage, s), 0) + weighted(expected, s) > s.tokenBudgetPerMachinePerDay) return "owner-tokens";
	return null;
}
/** The ledger in `file`; one that is missing or doesn't parse starts empty. */
async function openLedger(file) {
	let entries = [];
	try {
		const value = JSON.parse(await fs.readFile(file, "utf8"));
		if (Array.isArray(value)) entries = value.filter(isEntry);
	} catch {}
	const recent = (now) => entries.filter((e) => now - e.at < DAY_MS);
	let writing = Promise.resolve();
	const save = () => {
		const text = JSON.stringify(entries) + "\n";
		writing = writing.then(async () => {
			await fs.mkdir(path.dirname(file), { recursive: true });
			const temp = `${file}.${process.pid}`;
			await fs.writeFile(temp, text);
			await fs.rename(temp, file);
		});
		return writing;
	};
	return {
		entries: recent,
		reserve(entry) {
			const held = { ...entry };
			entries = [...recent(entry.at), held];
			save().catch(() => {});
			return {
				settle(usage) {
					held.usage = usage;
					return save();
				},
				cancel() {
					entries = entries.filter((e) => e !== held);
					return save();
				}
			};
		}
	};
}
const isEntry = (e) => {
	const o = e;
	return !!o && typeof o.at === "number" && typeof o.room === "string" && !!o.usage && [
		"input",
		"output",
		"cacheRead",
		"cacheWrite"
	].every((k) => Number.isFinite(o.usage[k]));
};
//#endregion
//#region src/data-layer/shell-writes.ts
/**
* { writes, reads }: the absolute paths `command` writes and reads, in order, each once. Relative
* paths resolve against `cwd`, or against where a `cd` in the command moved to; with no cwd they
* are skipped. Git Bash's /c/… paths become C:/… when the cwd is a Windows path.
*/
function shellFiles(command, cwd, { powershell = false } = {}) {
	const win = Boolean(cwd) && isWindowsPath(cwd);
	let dir = cwd ? normalize(cwd) : null;
	const pushed = [];
	const writes = [];
	const reads = [];
	const keep = (out, w) => {
		const p = place(w, dir, win);
		if (p && !out.includes(p)) out.push(p);
	};
	for (const s of segments(tokens(command, powershell))) {
		for (const w of s.writes) keep(writes, w);
		let words = s.words;
		if (!powershell) while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].text)) words = words.slice(1);
		if (!words.length || words[0].unsafe) continue;
		const name = base(words[0].text).toLowerCase().replace(/\.exe$/, "");
		const args = words.slice(1);
		if (CD.has(name)) {
			const { named, positional } = psArgs(args);
			const to = named.path || named.literalpath || positional[0];
			if (name === "pushd" || name === "push-location") pushed.push(dir);
			dir = to && to !== true && to.text !== "-" ? place(to, dir, win) : null;
			continue;
		}
		if (name === "popd" || name === "pop-location") {
			dir = pushed.length ? pushed.pop() : null;
			continue;
		}
		const writer = Object.hasOwn(WRITERS, name) ? WRITERS[name] : void 0;
		if (writer) for (const w of writer(args)) keep(writes, w);
		const reader = powershell && Object.hasOwn(PS_READERS, name) && PS_READERS[name] || (Object.hasOwn(READERS, name) ? READERS[name] : void 0);
		if (reader) {
			for (const r of reader(args)) if (r.text !== "-") keep(reads, r);
		}
	}
	return {
		writes,
		reads
	};
}
const CD = /* @__PURE__ */ new Set([
	"cd",
	"pushd",
	"chdir",
	"set-location",
	"sl",
	"push-location"
]);
const WRITERS = {
	tee: (args) => posix(args).positional,
	touch: (args) => posix(args, [
		"-d",
		"-t",
		"-r"
	]).positional,
	sed: (args) => sedFiles(args).written,
	perl: (args) => sedFiles(args).written,
	cp: (args) => copyTarget(args, ["-S"]),
	mv: (args) => copyTarget(args, ["-S"]),
	install: (args) => copyTarget(args, [
		"-m",
		"-o",
		"-g",
		"-S"
	]),
	"set-content": (args) => one(psArgs(args), ["path", "literalpath"]),
	"add-content": (args) => one(psArgs(args), ["path", "literalpath"]),
	"out-file": (args) => one(psArgs(args), [
		"filepath",
		"literalpath",
		"path"
	]),
	"new-item": newItem
};
const READERS = {
	cat: (args) => posix(args).positional,
	head: (args) => posix(args, ["-n", "-c"]).positional,
	tail: (args) => posix(args, [
		"-n",
		"-c",
		"-s"
	]).positional,
	less: (args) => posix(args).positional,
	more: (args) => posix(args).positional,
	sed: (args) => sedFiles(args).read
};
const getContent = (args) => one(psArgs(args), ["path", "literalpath"]);
const PS_READERS = {
	"get-content": getContent,
	gc: getContent,
	cat: getContent,
	type: getContent
};
function posix(args, valued = []) {
	const flags = [];
	const positional = [];
	for (let i = 0; i < args.length; i++) {
		const t = args[i].text;
		if (t === "--") {
			positional.push(...args.slice(i + 1));
			break;
		}
		if (t.startsWith("-") && t.length > 1) {
			flags.push(t);
			if (valued.includes(t)) i++;
		} else positional.push(args[i]);
	}
	return {
		flags,
		positional
	};
}
function sedFiles(args) {
	let inplace = false;
	let script = false;
	const positional = [];
	for (let i = 0; i < args.length; i++) {
		const t = args[i].text;
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
		} else positional.push(args[i]);
	}
	const files = positional.slice(script ? 0 : 1);
	return inplace ? {
		written: files,
		read: []
	} : {
		written: [],
		read: files
	};
}
function copyTarget(args, valued) {
	const { flags, positional } = posix(args, valued);
	if (flags.some((f) => f === "-d" || f === "-t" || f.startsWith("--target-directory") || f === "--directory")) return [];
	if (positional.length < 2) return [];
	const target = positional[positional.length - 1];
	const sources = positional.slice(0, -1);
	if (sources.length === 1 && !/[\\/]$/.test(target.text) && target.text !== "." && target.text !== "..") return [target];
	return sources.map((s) => ({
		text: target.text + "/" + base(s.text),
		unsafe: target.unsafe || s.unsafe
	}));
}
const PS_SWITCHES = /* @__PURE__ */ new Set([
	"force",
	"nonewline",
	"passthru",
	"append",
	"noclobber",
	"whatif",
	"confirm",
	"asbytestream",
	"verbose",
	"debug",
	"raw",
	"wait"
]);
function psArgs(args) {
	const named = Object.create(null);
	const positional = [];
	for (let i = 0; i < args.length; i++) {
		const m = /^-([A-Za-z]+)(?::([\s\S]*))?$/.exec(args[i].text);
		if (!m) positional.push(args[i]);
		else if (m[2] !== void 0) named[m[1].toLowerCase()] = {
			text: m[2],
			unsafe: args[i].unsafe
		};
		else if (PS_SWITCHES.has(m[1].toLowerCase())) named[m[1].toLowerCase()] = true;
		else named[m[1].toLowerCase()] = args[++i] || true;
	}
	return {
		named,
		positional
	};
}
function one({ named, positional }, keys) {
	const hit = keys.map((k) => named[k]).find((v) => !!v && v !== true) || positional[0];
	return hit ? [hit] : [];
}
function newItem(args) {
	const parsed = psArgs(args);
	const type = parsed.named.itemtype || parsed.named.type;
	if (!type || type === true || type.text.toLowerCase() !== "file") return [];
	const [path] = one(parsed, ["path"]);
	const name = parsed.named.name;
	if (!name || name === true) return path ? [path] : [];
	return [path ? {
		text: path.text + "/" + name.text,
		unsafe: path.unsafe || name.unsafe
	} : name];
}
function place(w, dir, win) {
	if (!w || w.unsafe || !w.text || w.text.startsWith("~") || w.text.startsWith("/dev/") || /^nul$/i.test(w.text)) return null;
	const p = win ? w.text.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d) => d.toUpperCase() + ":") : w.text;
	if (isAbsolute(p)) return normalize(p);
	return dir ? join(dir, p) : null;
}
const base = (p) => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
function segments(toks) {
	const out = [];
	let cur = {
		words: [],
		writes: []
	};
	let after = null;
	for (const t of toks) if ("op" in t && t.op === ";") {
		out.push(cur);
		cur = {
			words: [],
			writes: []
		};
		after = null;
	} else if ("op" in t) after = t.op;
	else {
		if (after === "write") cur.writes.push(t);
		else if (after !== "skip") cur.words.push(t);
		after = null;
	}
	out.push(cur);
	return out.filter((s) => s.words.length || s.writes.length);
}
function tokens(src, ps) {
	const out = [];
	const heredocs = [];
	let word = null;
	let i = 0;
	const add = (s, unsafe = false) => {
		word = word || {
			text: "",
			unsafe: false
		};
		word.text += s;
		if (unsafe) word.unsafe = true;
	};
	const flush = () => {
		if (word) out.push(word);
		word = null;
	};
	const op = (o) => {
		flush();
		out.push({ op: o });
	};
	const escape = ps ? "`" : "\\";
	while (i < src.length) {
		const ch = src[i];
		if (ch === "\n") {
			op(";");
			i = skipHeredocs(src, i + 1, heredocs);
			heredocs.length = 0;
		} else if (ch === " " || ch === "	" || ch === "\r") {
			flush();
			i++;
		} else if (ch === "#" && !word) while (i < src.length && src[i] !== "\n") i++;
		else if (ch === escape) {
			if (src[i + 1] !== "\n") add(src[i + 1] || "");
			i += 2;
		} else if (ps && ch === "@" && !word && (src[i + 1] === "'" || src[i + 1] === "\"") && /^\r?\n/.test(src.slice(i + 2))) {
			const q = src[i + 1];
			const end = src.indexOf("\n" + q + "@", i + 2);
			const stop = end < 0 ? src.length : end;
			add(src.slice(i + 2, stop), q === "\"" && src.slice(i + 2, stop).includes("$"));
			i = end < 0 ? src.length : end + 3;
		} else if (ch === "'") {
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
				text += "'";
				j++;
			}
			add(text);
			i = j;
		} else if (ch === "\"") {
			let j = i + 1;
			while (j < src.length && src[j] !== "\"") {
				if (src[j] === escape && j + 1 < src.length) {
					const n = src[j + 1];
					if (ps || "$`\"\\\n".includes(n)) {
						if (n !== "\n") add(n);
						j += 2;
						continue;
					}
				}
				if (src[j] === "$" || !ps && src[j] === "`") add(src[j], true);
				else add(src[j]);
				j++;
			}
			add("");
			i = j + 1;
		} else if (ch === "$" || ch === "*" || ch === "?" || !ps && ch === "`") {
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
				op("skip");
				i += src[i + 2] === ">" ? 3 : 2;
			} else {
				op(";");
				i += src[i + 1] === "&" ? 2 : 1;
			}
		} else if (ch === ">") {
			const w = word;
			const fd = w && (/^\d+$/.test(w.text) || ps && w.text === "*") ? w.text : "1";
			if (fd !== "1" || w && w.text === "1") word = null;
			flush();
			i++;
			if (src[i] === ">") i++;
			if (src[i] === "&") {
				op("skip");
				i++;
			} else {
				if (src[i] === "|") i++;
				op(fd === "1" ? "write" : "skip");
			}
		} else if (ch === "<") {
			flush();
			if (!ps && src[i + 1] === "<" && src[i + 2] !== "<") {
				i += 2;
				const strip = src[i] === "-";
				if (strip) i++;
				const d = readDelimiter(src, i);
				heredocs.push({
					delim: d.text,
					strip
				});
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
function readDelimiter(src, i) {
	while (src[i] === " " || src[i] === "	") i++;
	let text = "";
	while (i < src.length && !/[\s;|&<>()]/.test(src[i])) if (src[i] === "'" || src[i] === "\"") {
		const k = src.indexOf(src[i], i + 1);
		const end = k < 0 ? src.length : k;
		text += src.slice(i + 1, end);
		i = end + 1;
	} else {
		if (src[i] !== "\\") text += src[i];
		i++;
	}
	return {
		text,
		end: i
	};
}
function skipHeredocs(src, i, heredocs) {
	for (const h of heredocs) while (i < src.length) {
		const nl = src.indexOf("\n", i);
		const lineEnd = nl < 0 ? src.length : nl;
		let line = src.slice(i, lineEnd).replace(/\r$/, "");
		if (h.strip) line = line.replace(/^\t+/, "");
		i = nl < 0 ? src.length : nl + 1;
		if (line === h.delim) break;
	}
	return i;
}
//#endregion
//#region src/data-layer/claude-code.ts
const SOURCE = "claude-code";
const SUBAGENT_LOOKBACK_MS = 864e5;
const SEARCH_MS = 1e4;
const DOING = {
	Edit: "write",
	Write: "write",
	NotebookEdit: "write",
	Read: "read",
	Bash: "run",
	PowerShell: "run",
	Grep: "search",
	Glob: "search",
	WebSearch: "search",
	WebFetch: "search",
	Agent: "talk",
	SendMessage: "talk"
};
const READ_TOOLS = ["Read"];
const STOPPED = /* @__PURE__ */ new Set(["killed", "stopped"]);
const encoder = new TextEncoder();
/**
* Keep the object for the life of the data layer: it caches each transcript's parsed state by
* size, so a pass reads only the bytes written since the last one. A cache entry the latest pass
* didn't use is dropped, so a long session holds only what is in view.
*/
function createClaudeCode(io) {
	const transcripts = /* @__PURE__ */ new Map();
	const metas = /* @__PURE__ */ new Map();
	const found = /* @__PURE__ */ new Map();
	const searched = /* @__PURE__ */ new Map();
	let used = /* @__PURE__ */ new Set();
	async function read({ sessionId, cwd, now, config, resolve }) {
		used = /* @__PURE__ */ new Set();
		const errors = {
			count: 0,
			first: null
		};
		const fail = (err) => {
			errors.count++;
			if (errors.first === null) errors.first = message(err);
		};
		const none = (status = null) => ({
			facts: null,
			status,
			errors
		});
		const c = await candidate(sessionId, cwd, now, config);
		if (!c) return none();
		let main;
		try {
			main = await readTranscript(c.path, c.size, config.tailBytes);
		} catch (err) {
			fail(err);
			return none(`could not read the session transcript: ${errors.first}`);
		}
		try {
			if (leftOut(main, c, config)) return none();
			if (!main.cwd) return none(main.seen && (!main.parsed || main.messages) ? "transcript format not recognised" : null);
			const where = await resolve(main.cwd);
			if (!where) return none(`git could not place ${normalize(main.cwd)}`);
			return {
				facts: await sessionFacts(c, main, where, now, config, resolve, fail),
				status: null,
				errors
			};
		} finally {
			for (const cache of [transcripts, metas]) for (const key of cache.keys()) if (!used.has(key)) cache.delete(key);
		}
	}
	async function lead(sessionId, now, config) {
		const path = await locate(sessionId, "", now);
		const st = path && await io.stat(path);
		if (!path || !st) return null;
		const t = await readTranscript(path, st.size, config.tailBytes);
		if (!t.cwd) return null;
		return {
			cwd: t.cwd,
			working: t.turnOpen && now - st.mtimeMs <= config.stalledMinutes * 6e4,
			compacted: t.compacted,
			context: t.usage?.context ?? 0,
			lastActive: st.mtimeMs
		};
	}
	async function locate(sessionId, cwd, now) {
		const known = found.get(sessionId);
		if (known && await io.stat(known)) return known;
		const remember = (p) => (found.set(sessionId, p), p);
		const projects = join(io.claudeDir, "projects");
		const name = `${sessionId}.jsonl`;
		const guess = join(projects, `${cwd.replace(/[^a-zA-Z0-9]/g, "-")}/${name}`);
		if (await io.stat(guess)) return remember(guess);
		if (now - (searched.get(sessionId) ?? -Infinity) < SEARCH_MS) return null;
		searched.set(sessionId, now);
		for (const dir of await io.listDir(projects)) {
			if (!dir.isDir) continue;
			const p = join(projects, `${dir.name}/${name}`);
			if (await io.stat(p)) return remember(p);
		}
		return null;
	}
	async function candidate(sessionId, cwd, now, config) {
		const path = await locate(sessionId, cwd, now);
		const st = path && await io.stat(path);
		if (!path || !st) return null;
		const idleMs = config.idleMinutes * 6e4;
		const keepMs = Math.max(idleMs, config.lightsOffHours * 36e5);
		const agentWindowMs = Math.max(idleMs, config.touchedWindowMinutes * 6e4);
		const all = [];
		if (now - st.mtimeMs <= Math.max(SUBAGENT_LOOKBACK_MS, keepMs)) {
			const subDir = join(path.slice(0, -6), "subagents");
			for (const f of await io.listDir(subDir)) {
				const m = /^agent-(.+)\.jsonl$/.exec(f.name);
				if (f.isDir || !m) continue;
				const ast = await io.stat(join(subDir, f.name));
				if (ast) all.push({
					id: m[1],
					path: join(subDir, f.name),
					metaPath: join(subDir, `agent-${m[1]}.meta.json`),
					...ast
				});
			}
		}
		const lastActive = Math.max(st.mtimeMs, ...all.map((a) => a.mtimeMs));
		if (now - lastActive > keepMs) return null;
		const lit = now - lastActive <= idleMs;
		const from = lit ? now : lastActive;
		const agents = all.filter((a) => from - a.mtimeMs <= agentWindowMs);
		return {
			id: sessionId,
			path,
			size: st.size,
			ownMtime: st.mtimeMs,
			lastActive,
			lights: lit ? "on" : "off",
			agents,
			subagents: all.length
		};
	}
	async function sessionFacts(c, main, where, now, config, resolve, fail) {
		const session = `${SOURCE}:${c.id}`;
		const lead = `${session}:lead`;
		const agentFiles = [];
		for (const a of c.agents) try {
			agentFiles.push({
				...a,
				t: await readTranscript(a.path, a.size, config.tailBytes),
				meta: await readMeta(a.metaPath)
			});
		} catch (err) {
			fail(err);
		}
		const results = new Map(main.results);
		const notes = new Map(main.notes);
		const spawns = /* @__PURE__ */ new Map();
		for (const [toolUseId, at] of main.spawns) spawns.set(toolUseId, {
			at,
			by: lead
		});
		for (const a of agentFiles) {
			for (const [k, v] of a.t.results) results.set(k, v);
			for (const [k, v] of a.t.notes) notes.set(k, v);
			for (const [toolUseId, at] of a.t.spawns) spawns.set(toolUseId, {
				at,
				by: agentId(a.id)
			});
		}
		const mtimes = new Map([[lead, c.ownMtime], ...agentFiles.map((a) => [agentId(a.id), a.mtimeMs])]);
		const branch = main.branch || where.branch;
		const facts = {
			session: {
				id: session,
				source: SOURCE,
				lead,
				title: main.title || branch,
				titleFrom: main.title ? "source" : "branch",
				branch,
				checkout: where.toplevel,
				lastActive: iso(c.lastActive),
				status: now - c.lastActive <= config.activeMinutes * 6e4 ? "active" : "idle",
				lights: c.lights
			},
			agents: [],
			edits: [],
			reads: [],
			waits: [],
			reports: []
		};
		const leadWorking = main.turnOpen && now - c.ownMtime <= config.stalledMinutes * 6e4;
		facts.agents.push({
			id: lead,
			source: SOURCE,
			session,
			startedBy: null,
			agentType: null,
			task: null,
			status: leadWorking ? "working" : "idle",
			statusSince: iso(leadWorking ? main.turnAt : main.lastMessageAt, c.ownMtime),
			lastActive: iso(c.ownMtime),
			doing: leadWorking ? await doingOf(main, resolve, c.ownMtime, config) : null,
			usage: usageOf(main, c.ownMtime)
		});
		main.touches = await addFiles(facts.edits, lead, main.touches, [...config.touchedTools, ...config.shellTools], now, config, resolve);
		main.reads = await addFiles(facts.reads, lead, main.reads, [...READ_TOOLS, ...config.shellTools], now, config, resolve);
		for (const a of agentFiles) {
			const id = agentId(a.id);
			const type = typeof a.meta.agentType === "string" && a.meta.agentType ? a.meta.agentType : null;
			const at = a.t.cwd ? await resolve(a.t.cwd) : null;
			let worktree = typeof a.meta.worktreePath === "string" ? normalize(a.meta.worktreePath) : null;
			if (!worktree && at && pathKey(at.toplevel) !== pathKey(where.toplevel)) worktree = at.toplevel;
			const agentBranch = worktree ? typeof a.meta.worktreeBranch === "string" && a.meta.worktreeBranch || (at && pathKey(at.toplevel) === pathKey(worktree) ? at.branch : null) : null;
			const spawn = typeof a.meta.toolUseId === "string" ? spawns.get(a.meta.toolUseId) : void 0;
			let startedBy = spawn ? spawn.by : typeof a.meta.parentAgentId === "string" ? agentId(a.meta.parentAgentId) : lead;
			if (!mtimes.has(startedBy)) startedBy = lead;
			const s = agentStatus(a, results, notes, spawn, now, mtimes.get(startedBy), config);
			const live = s.status === "working" || s.status === "stalled";
			facts.agents.push({
				id,
				source: SOURCE,
				session,
				startedBy,
				agentType: type,
				task: typeof a.meta.description === "string" && a.meta.description ? a.meta.description : null,
				status: s.status,
				statusSince: iso(s.since, a.mtimeMs),
				lastActive: iso(a.mtimeMs),
				doing: live ? await doingOf(a.t, resolve, a.mtimeMs, config) : null,
				usage: usageOf(a.t, a.mtimeMs),
				...worktree ? {
					checkout: worktree,
					branch: agentBranch
				} : {},
				extra: {
					description: a.meta.description ?? null,
					...s.endState ? { endState: s.endState } : {}
				}
			});
			if (live) facts.waits.push({
				waiter: startedBy,
				on: id,
				since: iso(spawn ? spawn.at : a.t.firstAt, a.mtimeMs)
			});
			if ((s.status === "done" || s.status === "failed") && a.t.lastText !== null) facts.reports.push({
				agent: id,
				at: iso(a.t.lastTextAt, a.mtimeMs),
				text: a.t.lastText
			});
			a.t.touches = await addFiles(facts.edits, id, a.t.touches, [...config.touchedTools, ...config.shellTools], now, config, resolve);
			a.t.reads = await addFiles(facts.reads, id, a.t.reads, [...READ_TOOLS, ...config.shellTools], now, config, resolve);
		}
		return facts;
	}
	async function readMeta(p) {
		used.add(p);
		const st = await io.stat(p);
		if (!st) return {};
		const cached = metas.get(p);
		if (cached && cached.mtimeMs === st.mtimeMs) return cached.meta;
		let meta = {};
		try {
			const value = JSON.parse(await io.read(p));
			if (value && typeof value === "object") meta = value;
		} catch {}
		metas.set(p, {
			mtimeMs: st.mtimeMs,
			meta
		});
		return meta;
	}
	async function readTranscript(path, size, tailBytes) {
		used.add(path);
		let st = transcripts.get(path);
		if (!st || size < st.offset) {
			st = newTranscriptState();
			st.offset = Math.max(0, size - tailBytes);
			st.fromStart = st.offset === 0;
			if (st.offset > 0) st.head = await sumUsage(path, st, tailBytes);
			transcripts.set(path, st);
		}
		if (size <= st.offset) return st;
		const text = await io.read(path, st.offset, size);
		const lastNl = text.lastIndexOf("\n");
		if (lastNl < 0) return st;
		st.offset = size - encoder.encode(text.slice(lastNl + 1)).length;
		const lines = text.slice(0, lastNl).split("\n");
		if (st.head !== null) {
			lines[0] = st.head + lines[0];
			st.head = null;
		}
		for (const line of lines) if (line.trim()) foldLine(st, line);
		return st;
	}
	async function sumUsage(path, st, chunk) {
		let rest = "";
		for (let pos = 0; pos < st.offset; pos += chunk) {
			const text = rest + await io.read(path, pos, Math.min(st.offset, pos + chunk));
			const lastNl = text.lastIndexOf("\n");
			if (lastNl < 0) {
				rest = text;
				continue;
			}
			for (const line of text.slice(0, lastNl).split("\n")) foldUsage(st, line);
			rest = text.slice(lastNl + 1);
		}
		return rest;
	}
	return {
		id: SOURCE,
		read,
		lead
	};
}
const agentId = (id) => `${SOURCE}:${id}`;
const message = (err) => String(err && err.message || err);
function iso(ms, fallback) {
	return new Date(Number.isFinite(ms) ? ms : fallback).toISOString();
}
async function addFiles(list, agent, touches, tools, now, config, resolve) {
	const since = now - config.touchedWindowMinutes * 6e4;
	const kept = touches.filter((t) => t.at >= since);
	const newest = /* @__PURE__ */ new Map();
	for (const t of kept) {
		if (!tools.includes(t.name) || !t.cwd) continue;
		const where = await resolve(t.cwd);
		const file = where && relativeTo(where.toplevel, t.path);
		if (file && !(newest.get(file) >= t.at)) newest.set(file, t.at);
	}
	for (const [file, at] of newest) list.push({
		agent,
		file,
		at: iso(at)
	});
	return kept;
}
const tally = () => ({
	input: 0,
	cacheWrite: 0,
	cacheWrite1h: 0,
	cacheRead: 0,
	output: 0
});
function newTranscriptState() {
	return {
		offset: 0,
		head: null,
		seen: 0,
		parsed: 0,
		messages: 0,
		cwd: null,
		branch: null,
		title: null,
		firstAt: NaN,
		lastAt: NaN,
		lastMessageAt: NaN,
		lastTool: null,
		lastText: null,
		lastTextAt: NaN,
		lastRole: null,
		waiting: false,
		turnOpen: false,
		turnAt: NaN,
		results: /* @__PURE__ */ new Map(),
		spawns: /* @__PURE__ */ new Map(),
		notes: /* @__PURE__ */ new Map(),
		touches: [],
		reads: [],
		usage: null,
		totals: tally(),
		over100k: tally(),
		reply: null,
		fromStart: true,
		prompts: 0,
		tools: 0,
		firstPrompt: null,
		compacted: false
	};
}
const MESSAGE_TYPES = /* @__PURE__ */ new Set([
	"user",
	"assistant",
	"attachment",
	"system"
]);
function foldLine(st, line) {
	st.seen++;
	let ev;
	try {
		ev = JSON.parse(line);
	} catch {
		return;
	}
	if (!ev || typeof ev !== "object" || typeof ev.type !== "string") return;
	st.parsed++;
	if (MESSAGE_TYPES.has(ev.type)) st.messages++;
	const at = Date.parse(ev.timestamp);
	if (Number.isFinite(at)) {
		st.lastAt = at;
		if (!Number.isFinite(st.firstAt)) st.firstAt = at;
		if (MESSAGE_TYPES.has(ev.type)) st.lastMessageAt = at;
	}
	if (typeof ev.cwd === "string" && ev.cwd) st.cwd = ev.cwd;
	if (typeof ev.gitBranch === "string" && ev.gitBranch) st.branch = ev.gitBranch;
	if (ev.type === "ai-title" && typeof ev.aiTitle === "string" && ev.aiTitle) st.title = ev.aiTitle;
	if (ev.type === "queue-operation" && typeof ev.content === "string") readNotifications(st, ev.content, at);
	if (isCompaction(ev)) st.compacted = true;
	const content = ev.message && ev.message.content;
	if (ev.type === "assistant" && Array.isArray(content)) {
		st.lastRole = "assistant";
		st.waiting = false;
		readUsage(st, ev.message, at);
		for (const c of content) {
			if (!c || typeof c !== "object") continue;
			if (c.type === "text" && typeof c.text === "string" && c.text.trim()) {
				st.lastText = c.text;
				st.lastTextAt = at;
			}
			if (c.type !== "tool_use") continue;
			st.tools++;
			st.waiting = true;
			if (c.name === "Agent" && typeof c.id === "string") st.spawns.set(c.id, at);
			const input = c.input || {};
			const cwd = ev.cwd || st.cwd;
			const shell = typeof input.command === "string" ? shellFiles(input.command, cwd, { powershell: c.name === "PowerShell" }) : {
				writes: [],
				reads: []
			};
			const writes = shell.writes;
			const file = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : typeof input.path === "string" ? input.path : null;
			st.lastTool = writes.length ? {
				name: c.name,
				file: writes[writes.length - 1],
				cwd,
				at,
				wrote: true
			} : {
				name: c.name,
				file,
				cwd,
				at
			};
			const target = input.file_path || input.notebook_path;
			const targets = typeof target === "string" ? [target] : writes;
			const reads = typeof target === "string" ? [target] : shell.reads;
			if (Number.isFinite(at)) {
				for (const path of targets) st.touches.push({
					at,
					cwd,
					name: c.name,
					path
				});
				for (const path of reads) st.reads.push({
					at,
					cwd,
					name: c.name,
					path
				});
			}
		}
		setTurn(st, st.waiting || ev.message.stop_reason === "tool_use", at);
	} else if (ev.type === "user" && content != null) {
		st.lastRole = "user";
		let toolResults = false;
		if (typeof content === "string") readNotifications(st, content, at);
		else if (Array.isArray(content)) for (const c of content) {
			if (!c || typeof c !== "object") continue;
			if (c.type === "text" && typeof c.text === "string") readNotifications(st, c.text, at);
			if (c.type === "tool_result" && typeof c.tool_use_id === "string") {
				toolResults = true;
				st.results.set(c.tool_use_id, {
					...toolResult(ev.toolUseResult, c.is_error),
					at
				});
			}
		}
		const turn = userTurn$1(ev, content);
		if (turn !== null) setTurn(st, turn, at);
		if (turn === true && !toolResults) {
			st.lastTool = null;
			st.prompts++;
			if (st.firstPrompt === null) st.firstPrompt = promptText(content).slice(0, PROMPT_CHARS);
		}
	}
}
const OVER = 1e5;
function readUsage(st, message, at) {
	const u = message.usage;
	if (!u || typeof u !== "object" || typeof message.model !== "string" || !message.model || message.model.startsWith("<")) return;
	const n = (o, key) => o && typeof o === "object" && Number.isFinite(o[key]) ? o[key] : 0;
	const counts = {
		input: n(u, "input_tokens"),
		cacheWrite: n(u, "cache_creation_input_tokens"),
		cacheWrite1h: n(u.cache_creation, "ephemeral_1h_input_tokens"),
		cacheRead: n(u, "cache_read_input_tokens"),
		output: n(u, "output_tokens")
	};
	const id = typeof message.id === "string" ? message.id : null;
	const prompt = counts.input + counts.cacheRead + counts.cacheWrite;
	const before = st.reply && id && st.reply.id === id ? st.reply : null;
	for (const key of Object.keys(counts)) {
		st.totals[key] += counts[key] - (before ? before.counts[key] : 0);
		if (before && before.over100k) st.over100k[key] -= before.counts[key];
		if (prompt > OVER) st.over100k[key] += counts[key];
	}
	st.reply = {
		id,
		over100k: prompt > OVER,
		counts
	};
	st.usage = {
		model: message.model,
		context: prompt,
		at
	};
}
function foldUsage(st, line) {
	if (!line.includes("\"usage\"") && !line.includes("compact")) return;
	let ev;
	try {
		ev = JSON.parse(line);
	} catch {
		return;
	}
	if (isCompaction(ev)) st.compacted = true;
	if (ev && ev.type === "assistant" && ev.message && typeof ev.message === "object") readUsage(st, ev.message, Date.parse(ev.timestamp));
}
const isCompaction = (ev) => !!ev && typeof ev === "object" && (ev.type === "system" && ev.subtype === "compact_boundary" || ev.isCompactSummary === true);
function usageOf(st, fallbackMs) {
	return st.usage && {
		model: st.usage.model,
		context: st.usage.context,
		...st.totals,
		over100k: { ...st.over100k },
		at: iso(st.usage.at, fallbackMs)
	};
}
function setTurn(st, open, at) {
	if (open && !st.turnOpen) st.turnAt = at;
	st.turnOpen = open;
}
function userTurn$1(ev, content) {
	if (ev.isMeta || ev.isCompactSummary) return null;
	const texts = typeof content === "string" ? [content] : Array.isArray(content) ? content.filter((c) => c && c.type === "text" && typeof c.text === "string").map((c) => c.text) : [];
	if (texts.some((t) => t.startsWith("[Request interrupted by user"))) return false;
	if (texts.length && texts.every((t) => /^\s*<(command-|local-command-)/.test(t))) return null;
	return true;
}
const PROMPT_CHARS = 200;
function promptText(content) {
	if (typeof content === "string") return content;
	const text = Array.isArray(content) && content.find((c) => c && c.type === "text" && typeof c.text === "string");
	return text ? text.text : "";
}
function leftOut(st, c, config) {
	if (c.lights === "off" && !st.usage) return true;
	if (!st.fromStart || st.prompts !== 1 || st.tools || c.subagents) return false;
	const opening = st.firstPrompt.trimStart().toLowerCase();
	return config.helperPrompts.some((p) => typeof p === "string" && p && opening.startsWith(p.toLowerCase()));
}
function toolResult(r, isError) {
	if (r && typeof r === "object") {
		const o = r;
		if (o.isAsync || o.status === "async_launched") return { launched: true };
		if (typeof o.status === "string") return { status: o.status };
	}
	return { status: isError ? "failed" : "completed" };
}
function readNotifications(st, text, at) {
	if (!text.includes("<task-notification>")) return;
	for (const m of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
		const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(m[1]);
		const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(m[1]);
		if (id && status && status[1] !== "running") st.notes.set(id[1], {
			status: status[1],
			at
		});
	}
}
/**
* A subagent's { status, since, endState? }, with the raw end state Claude Code gave (completed,
* killed, stopped, failed…) when it has ended.
*/
function agentStatus(a, results, notes, spawn, now, starterMtimeMs, config) {
	const r = typeof a.meta.toolUseId === "string" ? results.get(a.meta.toolUseId) : void 0;
	if (r && !r.launched) return ended(r.status, r.at);
	const n = notes.get(a.id);
	if (n && !(a.t.lastAt > n.at)) return ended(n.status, n.at);
	if (spawn) {
		const stalledMs = config.stalledMinutes * 6e4;
		const quietSince = Math.max(a.mtimeMs, starterMtimeMs);
		if (now - quietSince > stalledMs) return {
			status: "stalled",
			since: quietSince + stalledMs
		};
		return {
			status: "working",
			since: spawn.at
		};
	}
	if (now - a.mtimeMs >= config.quietSeconds * 1e3 && a.t.lastRole === "assistant" && !a.t.waiting) return ended("completed", a.t.lastAt);
	return {
		status: "working",
		since: a.t.firstAt
	};
}
function ended(state, at) {
	return {
		status: state === "completed" ? "done" : STOPPED.has(state) ? "stopped" : "failed",
		since: at,
		endState: state
	};
}
async function doingOf(st, resolve, fallbackMs, config) {
	const t = st.lastTool;
	const kind = t && (t.wrote && config.shellTools.includes(t.name) ? "write" : Object.hasOwn(DOING, t.name) ? DOING[t.name] : void 0);
	if (!t || !kind) return null;
	const doing = { kind };
	if (t.file && t.cwd) {
		const where = await resolve(t.cwd);
		const file = where && relativeTo(where.toplevel, t.file);
		if (file) doing.file = file;
	}
	return {
		...doing,
		since: iso(t.at, fallbackMs)
	};
}
//#endregion
//#region src/runner/claude-binary.ts
const claudeBinaryPath = (claudeDir) => path.join(claudeDir, "isoplan", "claude-binary.json");
const isFile = (p) => fs.stat(p).then((s) => s.isFile(), () => false);
/**
* The `claude` binary's path: PATH first, then where Claude Code's installers put it. On Windows
* an npm install leaves only a claude.cmd shim, which can't be run without a shell, so its cli.js
* is used instead (run with node). Null when none is found.
*/
async function findClaude(env, platform, home, exists = isFile) {
	const windows = platform === "win32";
	const join = windows ? path.win32.join : path.posix.join;
	const dirs = (Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "").split(windows ? ";" : ":").filter(Boolean);
	const candidates = windows ? [...dirs.map((d) => join(d, "claude.exe")), join(home, ".local", "bin", "claude.exe")] : [
		...dirs.map((d) => join(d, "claude")),
		join(home, ".local", "bin", "claude"),
		join(home, ".claude", "local", "claude"),
		"/opt/homebrew/bin/claude",
		"/usr/local/bin/claude"
	];
	for (const candidate of candidates) if (await exists(candidate)) return candidate;
	if (windows) for (const d of dirs) {
		const cli = join(d, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
		if (await exists(join(d, "claude.cmd")) && await exists(cli)) return cli;
	}
	return null;
}
/** What runs it: the binary itself, or node and the cli.js. */
const claudeCommand = (binary, node = process.execPath) => binary.endsWith(".js") ? [node, binary] : [binary];
/** The recorded binary when it is still there, else a fresh lookup. */
async function claudeBinary(claudeDir, env, platform, home) {
	try {
		const recorded = JSON.parse(await fs.readFile(claudeBinaryPath(claudeDir), "utf8")).path;
		if (typeof recorded === "string" && await isFile(recorded)) return recorded;
	} catch {}
	return findClaude(env, platform, home);
}
//#endregion
//#region src/runner/claude.ts
const PREFIX = "claude-code:";
const EXIT_GRACE_MS = 5e3;
/** Every flag of the fork's command line, after the binary. */
function forkArgs(sessionId, model) {
	return [
		"-p",
		"--resume",
		sessionId,
		"--fork-session",
		"--no-session-persistence",
		"--tools",
		"",
		"--setting-sources",
		"",
		"--strict-mcp-config",
		"--model",
		model,
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose"
	];
}
/**
* The variables Claude Code sets for the processes it starts, which tie them to that session: its
* marker and entrypoint, the session's ids, its messaging socket and token, its own path and pid,
* the session's plugin folders and effort, and its IDE port.
*/
const FORK_ENV_DROPPED = [
	"CLAUDECODE",
	"CLAUDE_CODE_ENTRYPOINT",
	"CLAUDE_CODE_SESSION_ID",
	"CLAUDE_CODE_CHILD_SESSION",
	"CLAUDE_CODE_SESSION_ATTENDED",
	"CLAUDE_CODE_MESSAGING_SOCKET",
	"CLAUDE_CODE_MESSAGING_TOKEN",
	"CLAUDE_CODE_EXECPATH",
	"CLAUDE_CODE_PLUGIN_DIRS",
	"CLAUDE_CODE_SSE_PORT",
	"CLAUDE_PID",
	"CLAUDE_EFFORT"
];
/** The fork's environment: this one's, less FORK_ENV_DROPPED. */
function forkEnv(env) {
	const out = {};
	for (const [key, value] of Object.entries(env)) if (value !== void 0 && !FORK_ENV_DROPPED.includes(key)) out[key] = value;
	return out;
}
/** One user turn as a stream-json input line. */
const userTurn = (text) => JSON.stringify({
	type: "user",
	message: {
		role: "user",
		content: [{
			type: "text",
			text
		}]
	}
}) + "\n";
/** A session id names a transcript file and goes on the command line: a plain name, not an option. */
const forkableId = (session) => {
	const id = session.startsWith(PREFIX) ? session.slice(12) : null;
	return id && /^\w[\w-]*$/.test(id) ? id : null;
};
/** Ends a process and everything it started: on Windows `kill` reaches only the process itself. */
function killTree(child, platform = process.platform) {
	if (child.exitCode !== null || child.signalCode !== null || child.pid === void 0) return;
	if (platform === "win32") spawnSync("taskkill", [
		"/pid",
		String(child.pid),
		"/T",
		"/F"
	], {
		windowsHide: true,
		stdio: "ignore"
	});
	else try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}
const defaultSpawn = ([cmd, ...args], { cwd, env }) => spawn(cmd, args, {
	cwd,
	env,
	stdio: [
		"pipe",
		"pipe",
		"pipe"
	],
	windowsHide: true,
	detached: process.platform !== "win32"
});
function createClaudeAnswerer({ claudeDir, binary, model, config, spawn = defaultSpawn, env = process.env, now = Date.now }) {
	const forks = /* @__PURE__ */ new Set();
	return {
		async lead(session) {
			const id = forkableId(session);
			return id ? createClaudeCode({
				...nodeIo(),
				claudeDir
			}).lead(id, now(), await config()) : null;
		},
		async ask(session, lead, ask) {
			const id = forkableId(session);
			if (!id) return {
				ok: false,
				kind: "not-set-up",
				detail: `${session} isn't a Claude Code session this runner can fork`,
				usage: null
			};
			const bin = await binary();
			if (!bin) return {
				ok: false,
				kind: "not-set-up",
				detail: "the claude binary wasn't found; run the plugin's install script, or set its path in ~/.claude/isoplan/claude-binary.json",
				usage: null
			};
			let child;
			try {
				child = spawn([...claudeCommand(bin), ...forkArgs(id, await model())], {
					cwd: lead.cwd,
					env: forkEnv(env)
				});
			} catch (err) {
				return {
					ok: false,
					kind: "not-set-up",
					detail: `couldn't start claude: ${err.message}`,
					usage: null
				};
			}
			forks.add(child);
			child.on("close", () => forks.delete(child));
			return drive(child, ask);
		},
		close() {
			for (const child of forks) killTree(child);
			forks.clear();
		}
	};
}
/** Runs the two turns over a started fork and settles with turn 2's result, a failure or the timeout. */
function drive(child, { instructions, request, timeoutMs }) {
	return new Promise((resolve) => {
		const usage = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0
		};
		let metered = false;
		let turn = 1;
		let buffer = "";
		let stderr = "";
		let isDone = false;
		const finish = (answered) => {
			if (isDone) return;
			isDone = true;
			clearTimeout(timer);
			resolve(answered);
			setTimeout(() => killTree(child), EXIT_GRACE_MS).unref();
		};
		const fail = (kind, detail) => finish({
			ok: false,
			kind,
			detail,
			usage: metered ? usage : null
		});
		const timer = setTimeout(() => {
			fail("timed-out", `no answer within ${Math.round(timeoutMs / 1e3)} s`);
			killTree(child);
		}, timeoutMs);
		const onResult = (e) => {
			if (!(typeof e.num_turns === "number" && e.num_turns >= 1)) return;
			const u = e.usage && typeof e.usage === "object" ? e.usage : {};
			const n = (key) => Number.isFinite(u[key]) ? u[key] : 0;
			usage.input += n("input_tokens");
			usage.output += n("output_tokens");
			usage.cacheRead += n("cache_read_input_tokens");
			usage.cacheWrite += n("cache_creation_input_tokens");
			metered = true;
			if (e.is_error || e.subtype !== "success") {
				fail("failed", `turn ${turn} stopped with ${String(e.subtype ?? "an error")}${typeof e.result === "string" && e.result ? `: ${e.result}` : ""}`);
				killTree(child);
				return;
			}
			if (turn === 1) {
				turn = 2;
				child.stdin.write(userTurn(request));
				child.stdin.end();
				return;
			}
			const text = typeof e.result === "string" ? e.result.trim() : "";
			if (text) finish({
				ok: true,
				text,
				usage
			});
			else fail("failed", "the fork answered with nothing");
		};
		child.stdout.setEncoding("utf8").on("data", (piece) => {
			buffer += piece;
			let nl;
			while ((nl = buffer.indexOf("\n")) >= 0) {
				const text = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				if (!text) continue;
				try {
					const e = JSON.parse(text);
					if (e && e.type === "result") onResult(e);
				} catch {}
			}
		});
		child.stderr.setEncoding("utf8").on("data", (piece) => stderr = (stderr + piece).slice(-2e3));
		child.stdin.on("error", () => {});
		child.on("error", (err) => fail("not-set-up", `couldn't run claude: ${err.message}`));
		child.on("close", (code) => fail("failed", `claude exited${code === null ? "" : ` with code ${code}`} before answering${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`));
		child.stdin.write(userTurn(instructions));
	});
}
//#endregion
//#region src/runner/lifecycle.ts
const RETRY_BASE_MS = 1e3;
const RETRY_CAP_MS = 6e4;
const STABLE_MS = 6e4;
/** Runs the worker until it exits cleanly, starting it again after each crash, up to MAX_FAST_FAILURES in a row. */
async function supervise({ run, log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }) {
	let failures = 0;
	for (;;) {
		const startedAt = now();
		const code = await run();
		if (code === 0) return "done";
		if (code === 3) return "not-wanted";
		failures = now() - startedAt >= STABLE_MS ? 1 : failures + 1;
		const how = code === null ? "was killed" : `exited with code ${code}`;
		if (failures >= 5) {
			log(`the runner's worker ${how}, the ${failures}th time in a row within a minute of starting; giving up until the runner is started again`);
			return "gave-up";
		}
		const delay = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (failures - 1));
		log(`the runner's worker ${how}; starting it again in ${Math.round(delay / 1e3)} s`);
		await sleep(delay);
	}
}
/** Whether any session transcript under `projectsDir` was written since `since`, so its room is still lit. */
async function anyRoomSince(io, projectsDir, since) {
	for (const dir of await io.listDir(projectsDir)) {
		if (!dir.isDir) continue;
		for (const entry of await io.listDir(`${projectsDir}/${dir.name}`)) {
			if (entry.isDir || !entry.name.endsWith(".jsonl")) continue;
			const st = await io.stat(`${projectsDir}/${dir.name}/${entry.name}`);
			if (st && st.mtimeMs >= since) return true;
		}
	}
	return false;
}
/** The window a room stays askable after its session's last write: its lights-off window, or the idle one when that is off. */
const askableMs = ({ lightsOffHours, idleMinutes }) => Math.max(lightsOffHours * 36e5, idleMinutes * 6e4);
//#endregion
//#region src/runner/prompts.ts
async function loadPrompts(dir) {
	const read = async (name) => (await fs.readFile(path.join(dir, name), "utf8")).trim();
	return {
		instructions: await read("instructions.md"),
		question: await read("question.md"),
		brief: await read("brief.md")
	};
}
/** `template` with each {{key}} replaced by its value; an unknown key is left as it is. */
function fill(template, values) {
	return template.replace(/\{\{(\w+)\}\}/g, (whole, key) => Object.hasOwn(values, key) ? values[key] : whole);
}
//#endregion
//#region src/handoff/git.ts
/** The handoff's branch. */
const handoffBranch = (id) => `isoplan/handoff/${id}`;
var HandoffGitError = class extends Error {
	kind;
	detail;
	constructor(kind, detail) {
		super(detail);
		this.kind = kind;
		this.detail = detail;
	}
};
/** What the server is told for each kind of git failure. */
const GIT_FAILED = {
	"not-a-repo": "the session's folder isn't in a git repo",
	"no-commit": "the session's repo has no commit to hand over from",
	"no-remote": "the session's repo has no remote to push the handoff's branch to",
	"timed-out": "git took too long to push the handoff's branch",
	rejected: "the remote rejected the handoff's branch",
	failed: "git couldn't push the handoff's branch"
};
const REPO_VARIABLES = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_NAMESPACE"
];
/**
* The environment git runs with: no terminal prompt and no credential manager window; ssh in batch
* mode, unless the person chose their own ssh (GIT_SSH_COMMAND, GIT_SSH, or core.sshCommand in the
* repo's config, `sshCommandSet`); and none of the inherited variables that would point it at
* another repo.
*/
function noPromptEnv(env, sshCommandSet = false) {
	const out = {};
	for (const [key, value] of Object.entries(env)) if (value !== void 0 && !REPO_VARIABLES.includes(key.toUpperCase())) out[key] = value;
	out.GIT_TERMINAL_PROMPT = "0";
	out.GCM_INTERACTIVE = "never";
	if (!out.GIT_SSH_COMMAND && !out.GIT_SSH && !sshCommandSet) out.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
	return out;
}
function spawnGit(args, cwd, env, timeoutMs) {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const child = spawn("git", args, {
			cwd,
			env,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			windowsHide: true,
			detached: process.platform !== "win32"
		});
		child.stdin.end();
		child.stdout.setEncoding("utf8").on("data", (piece) => stdout += piece);
		child.stderr.setEncoding("utf8").on("data", (piece) => stderr = (stderr + piece).slice(-2e3));
		const timer = setTimeout(() => {
			timedOut = true;
			killTree(child);
		}, timeoutMs);
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({
				code: null,
				stdout,
				stderr: err.message,
				timedOut
			});
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({
				code,
				stdout,
				stderr,
				timedOut
			});
		});
	});
}
function createRunGit(baseEnv = process.env) {
	const sshCommand = /* @__PURE__ */ new Map();
	return async (args, { cwd, env, timeoutMs }) => {
		const key = pathKey(cwd);
		if (!sshCommand.has(key)) sshCommand.set(key, spawnGit([
			"config",
			"--get",
			"core.sshCommand"
		], cwd, noPromptEnv(baseEnv, true), timeoutMs).then((r) => r.code === 0 && r.stdout.trim() !== ""));
		return spawnGit(args, cwd, {
			...noPromptEnv(baseEnv, await sshCommand.get(key)),
			...env
		}, timeoutMs);
	};
}
/** A remote URL with any user name and password taken out, so a token in it never leaves. */
function withoutCredentials(remote) {
	return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}
/** Whether two remote URLs name the same repository: the same project id, or the same local path. */
function sameRemote(a, b) {
	const local = {
		machine: "",
		root: ""
	};
	const pa = projectId(withoutCredentials(a), local).id;
	const pb = projectId(withoutCredentials(b), local).id;
	if (!pa.startsWith("local:") || !pb.startsWith("local:")) return pa === pb;
	const asPath = (r) => pathKey(path.resolve(r.replace(/^file:\/\//, ""))).replace(/(\/\.git|\.git)$/, "");
	return asPath(a) === asPath(b);
}
/** The repo's remotes and their fetch URLs, which may hold spaces (a local path). */
async function remotesOf(run, cwd, timeoutMs) {
	const r = await run([
		"config",
		"--local",
		"--get-regexp",
		"^remote\\..*\\.url$"
	], {
		cwd,
		timeoutMs
	});
	if (r.code !== 0) return r.code === 1 ? [] : null;
	return r.stdout.split(/\r?\n/).map((line) => /^remote\.(.+)\.url (.*)$/.exec(line)).filter((m) => !!m).map((m) => ({
		name: m[1],
		url: m[2]
	}));
}
const UNTRACKED_MAX = 50;
/**
* The untracked files in the repo at `cwd` that .gitignore doesn't match, by path from the repo's
* top; null when git couldn't list them. Files git ignores are never listed.
*/
async function untracked(run, cwd, timeoutMs) {
	const r = await run([
		"ls-files",
		"--others",
		"--exclude-standard",
		"--full-name",
		"-z",
		":/"
	], {
		cwd,
		timeoutMs
	});
	if (r.code !== 0) return null;
	return r.stdout.split("\0").filter(Boolean).sort();
}
const listed = (files) => files.slice(0, UNTRACKED_MAX).map((f) => `\`${f}\``).join(", ") + (files.length > UNTRACKED_MAX ? `, and ${files.length - UNTRACKED_MAX} more` : "");
/** The brief request's last line: the untracked files the brief should say the purpose of. */
const untrackedLine = (files) => files === null ? "The untracked files couldn't be listed, so don't name any." : files.length ? `The untracked files are: ${listed(files)}. Say what each is for.` : "There are no untracked files.";
/**
* The runner's note at the end of every brief: what is pushed, from where, and what isn't, as of
* `at` (a brief withheld and released later still describes the tree as it was then).
*/
function handoffNote({ branch, from, files, at }) {
	const when = at.toISOString().slice(0, 16).replace("T", " ") + " UTC";
	const lines = [`Handed over by Isoplan on the branch ${branch}${from ? `, made from ${from}` : ""}, with the tracked changes in a work-in-progress commit. This describes the work tree as of ${when}.`];
	if (files === null) lines.push("Untracked files: unknown, since git couldn't list them.");
	else if (files.length) lines.push(`Untracked files, not handed over: ${listed(files)}.`);
	return lines.join("\n");
}
/** What a handoff from `cwd` would start from: the repo, its current branch and its untracked files. */
async function prepare(run, cwd, timeoutMs) {
	const top = await run(["rev-parse", "--show-toplevel"], {
		cwd,
		timeoutMs
	});
	if (top.code !== 0) throw new HandoffGitError(top.timedOut ? "timed-out" : "not-a-repo", `git rev-parse in ${cwd}: ${top.stderr.trim()}`);
	const toplevel = top.stdout.trim();
	const head = await run([
		"symbolic-ref",
		"--short",
		"-q",
		"HEAD"
	], {
		cwd: toplevel,
		timeoutMs
	});
	return {
		toplevel,
		from: head.code === 0 && head.stdout.trim() ? head.stdout.trim() : null,
		files: await untracked(run, toplevel, timeoutMs)
	};
}
/** The files `diff` (a `git diff -U0` of the commit) adds lines to, with those lines. */
function addedLines(diff) {
	const out = /* @__PURE__ */ new Map();
	let file = null;
	for (const line of diff.split("\n")) if (line.startsWith("+++ ")) file = line === "+++ /dev/null" ? null : line.slice(4).replace(/^b\//, "");
	else if (file && line.startsWith("+")) out.set(file, (out.get(file) ?? "") + line.slice(1) + "\n");
	return out;
}
const IDENTITY = {
	GIT_AUTHOR_NAME: "Isoplan handoff",
	GIT_AUTHOR_EMAIL: "handoff@isoplan.invalid",
	GIT_COMMITTER_NAME: "Isoplan handoff",
	GIT_COMMITTER_EMAIL: "handoff@isoplan.invalid"
};
/**
* Commits the tracked changes at `cwd` and pushes that commit alone to isoplan/handoff/<id>, with
* force, since the branch is the handoff's own and a second hand-over of the same room replaces it.
* The repo it records names the push URL, where the branch is. Throws a HandoffGitError.
*/
async function pushHandoff(run, cwd, id, timeoutMs, { scan, pushAnyway = false } = {}) {
	const branch = handoffBranch(id);
	const { toplevel, from } = await prepare(run, cwd, timeoutMs);
	const at = {
		cwd: toplevel,
		timeoutMs
	};
	const git = async (args, env) => {
		const r = await run(args, {
			...at,
			env
		});
		if (r.timedOut) throw new HandoffGitError("timed-out", `git ${args[0]} took longer than ${Math.round(timeoutMs / 1e3)} s`);
		return r;
	};
	const must = async (args, kind = "failed", env) => {
		const r = await git(args, env);
		if (r.code !== 0) throw new HandoffGitError(kind, `git ${args.join(" ")}: ${r.stderr.trim()}`);
		return r.stdout.trim();
	};
	const head = await git([
		"rev-parse",
		"--verify",
		"-q",
		"HEAD"
	]);
	if (head.code !== 0) throw new HandoffGitError("no-commit", `${toplevel} has no commit yet`);
	const parent = head.stdout.trim();
	const remotes = (await must(["remote"])).split(/\r?\n/).filter(Boolean);
	const upstream = from ? (await git([
		"config",
		"--get",
		`branch.${from}.remote`
	])).stdout.trim() : "";
	const remote = remotes.includes(upstream) ? upstream : remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : null;
	if (!remote) throw new HandoffGitError("no-remote", `${toplevel} has ${remotes.length ? `several remotes and none is origin: ${remotes.join(", ")}` : "no remote"}`);
	const url = await must([
		"remote",
		"get-url",
		"--push",
		remote
	], "no-remote");
	const fallback = (await git([
		"symbolic-ref",
		"--short",
		"-q",
		`refs/remotes/${remote}/HEAD`
	])).stdout.trim().replace(`${remote}/`, "");
	if (branch === from || branch === fallback) throw new HandoffGitError("failed", `${branch} is the current or the default branch, which a handoff never pushes`);
	const index = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "isoplan-handoff-")), "index");
	try {
		const real = path.resolve(toplevel, await must([
			"rev-parse",
			"--git-path",
			"index"
		]));
		const copied = await fs.copyFile(real, index).then(() => true, () => false);
		const withIndex = { GIT_INDEX_FILE: index };
		if (!copied) await must(["read-tree", "HEAD"], "failed", withIndex);
		await must([
			"add",
			"-u",
			"--",
			":/"
		], "failed", withIndex);
		const tree = await must(["write-tree"], "failed", withIndex);
		let commit = parent;
		if (tree !== await must(["rev-parse", `${parent}^{tree}`])) {
			const named = (await git(["config", "user.email"])).code === 0;
			commit = await must([
				"-c",
				"commit.gpgSign=false",
				"commit-tree",
				"--no-gpg-sign",
				tree,
				"-p",
				parent,
				"-m",
				`WIP: Isoplan handoff ${id}\n\nThe tracked changes${from ? ` on ${from}` : ""}, handed over as they were.`
			], "failed", named ? void 0 : IDENTITY);
			if (scan && !pushAnyway) {
				const diff = await must([
					"diff",
					"--no-color",
					"--no-ext-diff",
					"--no-renames",
					"-U0",
					parent,
					commit
				]);
				for (const [file, text] of addedLines(diff)) if (await scan(text)) return { held: file };
			}
		}
		const pushed = await git([
			"push",
			"--no-verify",
			"--porcelain",
			remote,
			`+${commit}:refs/heads/${branch}`
		]);
		if (pushed.code !== 0) throw new HandoffGitError(/rejected|denied|declined/i.test(pushed.stderr + pushed.stdout) ? "rejected" : "failed", `git push ${remote} ${branch}: ${(pushed.stderr || pushed.stdout).trim()}`);
		return { repo: {
			path: ".",
			remote: withoutCredentials(url),
			branch,
			commit
		} };
	} finally {
		await fs.rm(path.dirname(index), {
			recursive: true,
			force: true
		}).catch(() => {});
	}
}
//#endregion
//#region src/handoff/take.ts
/** The repo's own labelled settings file, at its top. */
const REPO_CONFIG = "isoplan.json";
/** The handoff's folder on this machine: its brief, launcher and setup log. */
const handoffDir = (claudeDir, id) => path.join(claudeDir, "isoplan", "handoffs", id);
const tail = (text) => (text.length > 2e3 ? "…" + text.slice(-2e3) : text).trim();
/** The main checkout of a clone of `remote` on this machine, the most recently used first, and that remote's name there; null with none. */
async function findClone(io, run, projectsDir, remote, since, timeoutMs) {
	const transcripts = [];
	for (const dir of await io.listDir(projectsDir)) {
		if (!dir.isDir) continue;
		for (const entry of await io.listDir(path.join(projectsDir, dir.name))) {
			if (entry.isDir || !entry.name.endsWith(".jsonl")) continue;
			const file = path.join(projectsDir, dir.name, entry.name);
			const st = await io.stat(file);
			if (!st || st.mtimeMs < since) continue;
			const cwd = await cwdOf(io, file, st.size);
			if (cwd) transcripts.push({
				cwd,
				at: st.mtimeMs
			});
		}
	}
	transcripts.sort((a, b) => b.at - a.at);
	const tried = /* @__PURE__ */ new Set();
	for (const { cwd } of transcripts) {
		if (tried.has(pathKey(cwd))) continue;
		tried.add(pathKey(cwd));
		if (!(await io.stat(cwd))?.isDir) continue;
		const where = await run([
			"rev-parse",
			"--path-format=absolute",
			"--show-toplevel",
			"--git-common-dir"
		], {
			cwd,
			timeoutMs
		});
		if (where.code !== 0) continue;
		const [toplevel, commonDir] = where.stdout.split(/\r?\n/).map((s) => s.trim());
		if (!toplevel || !commonDir) continue;
		const main = normalize(commonDir).endsWith("/.git") ? path.dirname(commonDir) : toplevel;
		if (tried.has(`main:${pathKey(main)}`)) continue;
		tried.add(`main:${pathKey(main)}`);
		const match = (await remotesOf(run, main, timeoutMs))?.find((r) => sameRemote(r.url, remote));
		if (match) return {
			dir: path.resolve(main),
			remote: match.name
		};
	}
	return null;
}
async function cwdOf(io, file, size) {
	for (const text of (await io.read(file, 0, Math.min(size, 65536)).catch(() => "")).split("\n")) {
		if (!text.includes("\"cwd\"")) continue;
		try {
			const cwd = JSON.parse(text).cwd;
			if (typeof cwd === "string" && cwd) return cwd;
		} catch {}
	}
	return null;
}
/** `worktreeSetup` from isoplan.json's text, for this platform: null when it names no command here. Throws when malformed. */
function parseSetup(text, platform, defaultTimeoutMs) {
	const setup = JSON.parse(text)?.worktreeSetup;
	if (setup === void 0) return null;
	if (!setup || typeof setup !== "object") throw new Error(`"worktreeSetup" in ${REPO_CONFIG} must be an object`);
	const key = platform === "win32" ? "windows" : platform === "darwin" ? "mac" : "linux";
	const c = setup.command;
	const command = c && typeof c === "object" ? c[key] : c;
	if (command !== void 0 && (typeof command !== "string" || !command.trim())) throw new Error(`"worktreeSetup.command" in ${REPO_CONFIG} must be a command, or { "windows", "mac" } commands`);
	const t = setup.timeoutMinutes;
	if (t !== void 0 && !(typeof t === "number" && Number.isFinite(t) && t > 0)) throw new Error(`"worktreeSetup.timeoutMinutes" in ${REPO_CONFIG} must be a number of minutes above 0`);
	return command ? {
		command,
		timeoutMs: typeof t === "number" ? t * 6e4 : defaultTimeoutMs
	} : null;
}
/**
* isoplan.json from the remote's default branch, as this clone knows it, and never from any other
* branch. The default branch is `<remote>/HEAD`, else what the remote says its HEAD is; the branch
* is fetched so the file is current. `problem` says why it couldn't be read; `text` is null when
* the default branch has no isoplan.json.
*/
async function readSetupFile(run, clone, timeoutMs) {
	const git = (args) => run(args, {
		cwd: clone.dir,
		timeoutMs
	});
	let branch = (await git([
		"symbolic-ref",
		"-q",
		"--short",
		`refs/remotes/${clone.remote}/HEAD`
	])).stdout.trim().replace(`${clone.remote}/`, "");
	if (!branch) {
		const said = await git([
			"ls-remote",
			"--symref",
			clone.remote,
			"HEAD"
		]);
		branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(said.stdout)?.[1] ?? "";
	}
	if (!branch) return {
		text: null,
		problem: `Setup was skipped: ${clone.remote}'s default branch couldn't be told, so ${REPO_CONFIG} couldn't be read from it.`
	};
	const fetched = await git([
		"fetch",
		"-q",
		clone.remote,
		`+refs/heads/${branch}:refs/remotes/${clone.remote}/${branch}`
	]);
	if (fetched.code !== 0) return {
		text: null,
		problem: `Setup was skipped: ${clone.remote}/${branch} couldn't be fetched to read ${REPO_CONFIG}:\n${fetched.stderr}`
	};
	const shown = await git(["show", `refs/remotes/${clone.remote}/${branch}:${REPO_CONFIG}`]);
	return {
		text: shown.code === 0 ? shown.stdout : null,
		problem: null
	};
}
/** Runs `command` with the system shell, hidden; resolves with whether it exited 0, its output's end and whether it timed out. */
function runShell(command, { cwd, env, timeoutMs }) {
	return new Promise((resolve) => {
		let output = "";
		let timedOut = false;
		const child = spawn(command, {
			cwd,
			env,
			shell: true,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			windowsHide: true,
			detached: process.platform !== "win32"
		});
		child.stdin.end();
		const keep = (piece) => output = (output + piece).slice(-65536);
		child.stdout.setEncoding("utf8").on("data", keep);
		child.stderr.setEncoding("utf8").on("data", keep);
		const timer = setTimeout(() => {
			timedOut = true;
			killTree(child);
		}, timeoutMs);
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({
				ok: false,
				output: output + err.message,
				timedOut
			});
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({
				ok: code === 0 && !timedOut,
				output: timedOut ? `${output}\nIt was stopped after ${Math.round(timeoutMs / 6e4)} minutes.` : output,
				timedOut
			});
		});
	});
}
const cmdQuote = (s) => `"${s.replace(/"/g, "").replace(/%/g, "%%")}"`;
const shQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
/**
* The launcher that runs Claude Code in `dir`, and the command that opens it in a terminal: on
* Windows a .cmd file that `start` opens in a new console (a Windows Terminal tab where that is the
* default), on a Mac a .command file that Terminal opens. Null on any other platform.
* CLAUDE_CONFIG_DIR, when set, is written into the launcher, since Terminal.app starts it with its
* own environment, not the runner's.
*/
function launch(platform, { folder, dir, argv, title, configDir }) {
	const name = title.replace(/["%^&|<>!()@]/g, "");
	if (platform === "win32") {
		const file = path.win32.join(folder, "open.cmd");
		return {
			file,
			text: [
				"@echo off",
				`title ${name}`,
				...configDir ? [`set "CLAUDE_CONFIG_DIR=${configDir.replace(/"/g, "").replace(/%/g, "%%")}"`] : [],
				`cd /d ${cmdQuote(dir)}`,
				argv.map(cmdQuote).join(" "),
				""
			].join("\r\n"),
			command: [
				process.env.ComSpec || "cmd.exe",
				"/d",
				"/c",
				"start",
				`"${name}"`,
				"cmd.exe",
				"/k",
				`""${file}""`
			]
		};
	}
	if (platform === "darwin") {
		const file = path.posix.join(folder, "open.command");
		return {
			file,
			text: [
				"#!/bin/sh",
				...configDir ? [`export CLAUDE_CONFIG_DIR=${shQuote(configDir)}`] : [],
				`cd ${shQuote(dir)} || exit 1`,
				`exec ${argv.map(shQuote).join(" ")}`,
				""
			].join("\n"),
			command: [
				"open",
				"-a",
				"Terminal",
				file
			]
		};
	}
	return null;
}
/** Writes the launcher and runs the command that opens it; rejects when it couldn't. */
async function openLaunch(l, env) {
	await fs.writeFile(l.file, l.text, { mode: 493 });
	const [cmd, ...args] = l.command;
	await new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			env,
			stdio: "ignore",
			detached: true,
			windowsHide: true,
			windowsVerbatimArguments: process.platform === "win32"
		});
		const timer = setTimeout(() => (child.unref(), resolve()), 15e3);
		child.on("error", (err) => (clearTimeout(timer), reject(err)));
		child.on("exit", (code) => (clearTimeout(timer), code === 0 ? resolve() : reject(/* @__PURE__ */ new Error(`${path.basename(cmd)} exited with code ${code}`))));
	});
}
/** Starts a headless session: hidden, detached, with nothing to read its output; resolves once it has started. */
function startHeadless({ argv: [cmd, ...args], cwd }, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			cwd,
			env,
			stdio: "ignore",
			detached: true,
			windowsHide: true
		});
		child.on("error", reject);
		child.on("spawn", () => (child.unref(), resolve()));
	});
}
/** The first thing the new session is told. */
function takePrompt(id, brief, setupLog) {
	return [
		`Isoplan handoff ${id}: you are taking this work over.`,
		`Read its brief in ${brief} first.`,
		...setupLog ? [`The worktree's setup script failed; the end of its output is in ${setupLog}.`] : [],
		"Then say where things stand and what you would do next, and wait for me before changing anything."
	].join(" ");
}
/**
* Claude Code's command line for the new session. The prompt comes first: `--add-dir` takes every
* argument after it, and would take the prompt too.
*/
function sessionArgv(bin, { prompt, session, name, folder, headless }) {
	return [
		...claudeCommand(bin),
		...headless ? ["-p"] : [],
		prompt,
		"--session-id",
		session,
		"--name",
		name,
		"--add-dir",
		folder
	];
}
/** Takes the handoff on this machine; never throws. */
async function takeHandoff(message, o) {
	const { handoff } = message;
	const headless = message.mode === "headless";
	const failures = [];
	const done = (session) => ({
		type: "taken",
		v: 1,
		handoff: handoff.id,
		...session ? { session } : {},
		failures
	});
	const fail = async (step, output) => {
		const matched = await o.scan(output);
		failures.push({
			step,
			output: matched ? `The end of its output is withheld here: it matches a secret pattern. It is on ${o.machine}.` : tail(output)
		});
	};
	try {
		const s = await o.settings();
		const timeoutMs = s.gitTimeoutSeconds * 1e3;
		const branch = handoffBranch(handoff.id);
		const repo = handoff.repos.find((r) => r.path === ".") ?? handoff.repos[0];
		const now = (o.now ?? Date.now)();
		const clone = await findClone(o.io, o.run, path.join(o.claudeDir, "projects"), repo.remote, now - s.cloneSearchDays * 864e5, timeoutMs);
		if (!clone) {
			await fail("worktree", `No clone of ${repo.remote} was found on ${o.machine}: none of its Claude Code sessions from the last ${s.cloneSearchDays} days ran in one. Open Claude Code once in your clone of the repo, then take the handoff again, or copy its prompt into a session there.`);
			return done();
		}
		const git = (args, cwd) => o.run(args, {
			cwd,
			timeoutMs
		});
		const before = await resolved(o.run, clone.dir, `refs/remotes/${clone.remote}/${branch}`, timeoutMs);
		const fetched = await git([
			"fetch",
			clone.remote,
			`+refs/heads/${branch}:refs/remotes/${clone.remote}/${branch}`
		], clone.dir);
		if (fetched.code !== 0) {
			await fail("worktree", `git fetch ${clone.remote} ${branch} in ${clone.dir} failed${fetched.timedOut ? " (it took too long)" : ""}:\n${fetched.stderr}`);
			return done();
		}
		const dir = await worktreeFor(o.run, clone.dir, clone.remote, branch, handoff.id, before, timeoutMs);
		if (typeof dir !== "string") {
			await fail("worktree", dir.error);
			return done();
		}
		const folder = handoffDir(o.claudeDir, handoff.id);
		await fs.mkdir(folder, { recursive: true });
		const briefFile = path.join(folder, "brief.md");
		await fs.writeFile(briefFile, handoff.brief + "\n");
		const env = forkEnv(o.env);
		let setupLog = null;
		const config = await readSetupFile(o.run, clone, timeoutMs);
		if (config.problem) await fail("setup", config.problem);
		let setup = null;
		try {
			setup = config.text === null ? null : parseSetup(config.text, o.platform, s.setupTimeoutMinutes * 6e4);
		} catch (err) {
			await fail("setup", `${REPO_CONFIG} couldn't be read: ${err.message}`);
		}
		if (setup) {
			o.log(`handoff ${handoff.id}: running the worktree setup script in ${dir}`);
			const r = await runShell(setup.command, {
				cwd: dir,
				env: {
					...env,
					ISOPLAN_HANDOFF_ID: handoff.id,
					ISOPLAN_HANDOFF_BRANCH: branch
				},
				timeoutMs: setup.timeoutMs
			});
			if (!r.ok) {
				setupLog = path.join(folder, "setup.log");
				await fs.writeFile(setupLog, r.output);
				await fail("setup", r.output || "The setup script failed with no output.");
			}
		}
		const bin = await o.claude();
		if (!bin) {
			await fail("open", "The claude binary wasn't found on this machine: run the plugin's install script, or set its path in ~/.claude/isoplan/claude-binary.json.");
			return done();
		}
		const id = message.session ?? (o.newSession ?? randomUUID)();
		const name = `Isoplan handoff ${handoff.id}`;
		const argv = sessionArgv(bin, {
			prompt: takePrompt(handoff.id, briefFile, setupLog),
			session: id,
			name,
			folder,
			headless
		});
		if (headless) {
			try {
				await (o.start ?? startHeadless)({
					argv,
					cwd: dir
				}, env);
			} catch (err) {
				await fail("open", `The headless session couldn't be started: ${err.message}. The worktree is ${dir}.`);
				return done();
			}
			o.log(`handoff ${handoff.id}: started headless Claude Code session ${id} in ${dir}`);
			return done(`claude-code:${id}`);
		}
		const l = launch(o.platform, {
			folder,
			dir,
			argv,
			title: name,
			configDir: o.env.CLAUDE_CONFIG_DIR ?? null
		});
		if (!l) {
			await fail("open", `Opening a terminal isn't supported on ${o.platform} yet. The worktree is ${dir} and the brief is ${briefFile}: open Claude Code there yourself.`);
			return done();
		}
		try {
			await (o.open ?? openLaunch)(l, env);
		} catch (err) {
			await fail("open", `The terminal couldn't be opened: ${err.message}. The worktree is ${dir}.`);
			return done();
		}
		o.log(`handoff ${handoff.id}: opened Claude Code session ${id} in ${dir}`);
		return done(`claude-code:${id}`);
	} catch (err) {
		o.log(`handoff ${handoff.id}: taking it failed: ${err?.stack ?? String(err)}`);
		if (!failures.length) failures.push({
			step: "worktree",
			output: "The runner failed while taking the handoff; its log on this machine says why."
		});
		return done();
	}
}
/**
* How many commits `ref` has that neither the new tip nor the one fetched before it (`before`, the
* handoff as it was last handed over, which a new hand-over replaces) has: the receiver's own work.
* Null when git can't say.
*/
async function ahead(run, cwd, tip, before, ref, timeoutMs) {
	const r = await run([
		"rev-list",
		"--count",
		ref,
		"--not",
		tip,
		...before ? [before] : []
	], {
		cwd,
		timeoutMs
	});
	return r.code === 0 ? Number(r.stdout.trim()) : null;
}
/** What a ref points at now, or null. */
async function resolved(run, cwd, ref, timeoutMs) {
	const r = await run([
		"rev-parse",
		"--verify",
		"-q",
		ref
	], {
		cwd,
		timeoutMs
	});
	return r.code === 0 ? r.stdout.trim() : null;
}
async function worktreeFor(run, clone, remote, branch, id, before, timeoutMs) {
	const tip = `refs/remotes/${remote}/${branch}`;
	const base = path.join(path.dirname(clone), `${path.basename(clone)}-handoff-${id}`);
	for (let n = 1; n < 10; n++) {
		const dir = n === 1 ? base : `${base}-${n}`;
		if (await fs.stat(dir).then(() => true, () => false)) {
			const head = await run([
				"rev-parse",
				"--abbrev-ref",
				"HEAD"
			], {
				cwd: dir,
				timeoutMs
			});
			if (head.code !== 0 || head.stdout.trim() !== branch) continue;
			const dirty = (await run([
				"status",
				"--porcelain",
				"--untracked-files=no"
			], {
				cwd: dir,
				timeoutMs
			})).stdout.trim() !== "";
			const extra = await ahead(run, dir, tip, before, "HEAD", timeoutMs);
			if (dirty || extra !== 0) return { error: `${dir}, this handoff's worktree from before, has work that isn't in the handoff as handed over now (${dirty ? "uncommitted changes" : `${extra ?? "some"} commit(s)`}), so it was left as it is. Commit and push it, or move it aside, then take the handoff again.` };
			const moved = await run([
				"reset",
				"-q",
				"--keep",
				tip
			], {
				cwd: dir,
				timeoutMs
			});
			return moved.code === 0 ? dir : { error: `${dir} couldn't be moved to the handoff as handed over now:\n${moved.stderr}` };
		}
		if ((await run([
			"rev-parse",
			"--verify",
			"-q",
			`refs/heads/${branch}`
		], {
			cwd: clone,
			timeoutMs
		})).code === 0) {
			const extra = await ahead(run, clone, tip, before, `refs/heads/${branch}`, timeoutMs);
			if (extra !== 0) return { error: `The local branch ${branch} in ${clone} has ${extra ?? "some"} commit(s) that aren't in the handoff as handed over now, so no worktree was made over it. Push or move them, then take the handoff again.` };
		}
		const r = await run([
			"worktree",
			"add",
			"--track",
			"-B",
			branch,
			dir,
			`${remote}/${branch}`
		], {
			cwd: clone,
			timeoutMs
		});
		return r.code === 0 ? dir : { error: `git worktree add ${dir} failed${r.timedOut ? " (it took too long)" : ""}:\n${r.stderr}` };
	}
	return { error: `${base} and the next eight names beside it are taken by other folders` };
}
//#endregion
//#region src/runner/runner.ts
/** A push that failed, with what the server is told; anything else thrown is told only that it failed. */
var PushFailed = class extends Error {};
const REMEMBER = 200;
const COMPACTED_NOTE = "Note from Isoplan: this session was compacted, so its earlier work survives only as a summary and the details may be thin.";
/** What the server is told for each kind of fork failure. */
const FAILED = {
	"timed-out": "the fork took too long to answer",
	failed: "the fork couldn't answer",
	"not-set-up": "this machine can't run the fork; its owner can see why in the runner's log"
};
const REMEMBER_DROPPED = 200;
function createRunner({ answerer, ledger, settings, prompts, scan, send, log, isDir, isReported, push, prepareBrief, take, now = Date.now }) {
	const rooms = /* @__PURE__ */ new Map();
	const running = /* @__PURE__ */ new Set();
	const finished = /* @__PURE__ */ new Map();
	const held = /* @__PURE__ */ new Map();
	const released = /* @__PURE__ */ new Set();
	const dropped = /* @__PURE__ */ new Set();
	const taking = /* @__PURE__ */ new Set();
	let forking = 0;
	const waiting = [];
	async function forkSlot(max) {
		while (forking >= max) await new Promise((resolve) => waiting.push(resolve));
		forking++;
		return () => {
			forking--;
			waiting.shift()?.();
		};
	}
	const unavailable = (id, detail) => ({
		type: "refusal",
		v: 1,
		id,
		reason: "unavailable",
		detail
	});
	const overCapRefusal = (id, cap) => ({
		type: "refusal",
		v: 1,
		id,
		reason: "over-cap",
		cap
	});
	function deliver(id, message) {
		finished.delete(id);
		finished.set(id, message);
		if (finished.size > REMEMBER) finished.delete(finished.keys().next().value);
		send(message);
	}
	async function answer(request) {
		const { id, room, session } = request;
		const lead = await answerer.lead(session);
		if (!lead) return unavailable(id, "this machine has no such session");
		if (!await isReported(session, lead)) {
			log(`${id}: ${session} isn't a session this machine reports, so it isn't answered for`);
			return unavailable(id, "this machine doesn't report that session");
		}
		if (!await isDir(lead.cwd)) {
			log(`${id}: the folder of ${session}, ${lead.cwd}, is gone`);
			return unavailable(id, "the session's folder is gone, so its lead can't be asked");
		}
		if (lead.working) return unavailable(id, "the session's lead is mid-turn; ask again once its turn ends");
		if (request.kind === "write-brief" && !push) return unavailable(id, "this plugin version can't hand a room over from the floor yet");
		const s = await settings();
		const p = await prompts();
		const isBrief = request.kind === "write-brief";
		let brief = {
			files: [],
			note: ""
		};
		if (isBrief && prepareBrief) try {
			brief = await prepareBrief(lead, request.handoff);
		} catch (err) {
			log(`${id}: ${err.message}`);
			return unavailable(id, err instanceof PushFailed ? err.message : "the handoff's branch couldn't be pushed");
		}
		const fallback = (why) => {
			log(`${id}: the fork didn't write the brief (${why}), so the server writes it from the room's feed`);
			return `No brief was written by the session: ${why}.${brief.note ? `\n\n${brief.note}` : ""}`;
		};
		const expected = estimate(lead.context, s);
		const cap = overCap(ledger.entries(now()), room, expected, now(), s);
		let body;
		let isFallback = false;
		if (cap) {
			if (!isBrief) return overCapRefusal(id, cap);
			body = fallback(`the ${cap} cap is reached`);
			isFallback = true;
		} else {
			const reservation = ledger.reserve({
				at: now(),
				room,
				usage: expected
			});
			const text = isBrief ? fill(p.brief, {
				to: request.to.name || request.to.id,
				untracked: untrackedLine(brief.files)
			}) : fill(p.question, {
				from: request.from.name || request.from.id,
				question: request.question
			});
			const free = await forkSlot(s.maxForks);
			const answered = await answerer.ask(session, lead, {
				instructions: p.instructions,
				request: text,
				timeoutMs: (isBrief ? s.briefTimeoutSeconds : s.answerTimeoutSeconds) * 1e3
			}).finally(free);
			await (!answered.ok && answered.kind === "not-set-up" ? reservation.cancel() : reservation.settle(answered.usage ?? expected)).catch((err) => log(`couldn't record ${id} in the ledger: ${err.message}`));
			if (!answered.ok) {
				log(`${id}: ${answered.detail}`);
				if (!isBrief) return unavailable(id, FAILED[answered.kind]);
				body = fallback(FAILED[answered.kind]);
				isFallback = true;
			} else {
				body = lead.compacted ? `${COMPACTED_NOTE}\n\n${answered.text}` : answered.text;
				if (brief.note) body = `${body}\n\n${brief.note}`;
			}
		}
		const pushAndReply = async (pushAnyway) => {
			let pushed;
			try {
				pushed = await push(session, lead, request.handoff, pushAnyway);
			} catch (err) {
				log(`${id}: the push failed: ${err.message}`);
				return unavailable(id, err instanceof PushFailed ? err.message : "the handoff's branch couldn't be pushed");
			}
			if (!Array.isArray(pushed)) {
				log(`withheld the handoff's commit for ${id} in ${room}: the lines it adds to ${pushed.held} match a secret pattern`);
				hold(id, () => pushAndReply(true));
				return {
					type: "refusal",
					v: 1,
					id,
					reason: "withheld",
					file: pushed.held
				};
			}
			return {
				type: "reply",
				v: 1,
				id,
				kind: "write-brief",
				handoff: {
					id: request.handoff,
					brief: body,
					repos: pushed
				},
				...isFallback ? { fallback: true } : {}
			};
		};
		const reply = isBrief ? () => pushAndReply(false) : async () => ({
			type: "reply",
			v: 1,
			id,
			kind: "answer-question",
			answer: body
		});
		const matched = await scan(body);
		if (!matched) return reply();
		log(`withheld the ${isBrief ? "brief" : "answer"} for ${id} in ${room}: it matches the secret pattern "${matched}"`);
		if (released.delete(id)) {
			log(`${id} was released while it was being written, so it is sent`);
			return reply();
		}
		hold(id, reply);
		return {
			type: "refusal",
			v: 1,
			id,
			reason: "withheld"
		};
	}
	function hold(id, reply) {
		held.set(id, reply);
		if (held.size > 50) {
			const oldest = held.keys().next().value;
			held.delete(oldest);
			dropped.add(oldest);
			if (dropped.size > REMEMBER_DROPPED) dropped.delete(dropped.values().next().value);
			log(`dropped the withheld reply for ${oldest}: more than 50 are held`);
		}
	}
	async function release(id) {
		const reply = held.get(id);
		if (!reply) {
			if (running.has(id)) {
				released.add(id);
				return;
			}
			const sent = finished.get(id);
			if (sent?.type === "reply") send(sent);
			else if (dropped.has(id)) send(unavailable(id, `its withheld reply was dropped to make room: more than 50 were held at once, so ask again`));
			else send(unavailable(id, "nothing is withheld under this id here; the runner may have restarted since, so ask again"));
			return;
		}
		held.delete(id);
		try {
			deliver(id, await reply());
		} catch (err) {
			log(`${id}: couldn't send the released reply: ${err.message}`);
			deliver(id, unavailable(id, "the released reply couldn't be sent"));
		}
	}
	return {
		take(message) {
			if (message.type === "release") {
				release(message.id);
				return;
			}
			if (message.type === "handoff") {
				const handoff = message.handoff;
				if (!take) log(`the office server sent handoff ${handoff.id} to take, which this runner doesn't handle yet`);
				else if (taking.has(handoff.id)) log(`handoff ${handoff.id} is being taken already`);
				else {
					taking.add(handoff.id);
					take(message).then(send, (err) => log(`handoff ${handoff.id}: taking it failed: ${err?.stack ?? String(err)}`)).finally(() => taking.delete(handoff.id));
				}
				return;
			}
			if (message.kind === "owner-answer") {
				send(unavailable(message.id, "an owner's answer goes to the live session, not the runner"));
				return;
			}
			const request = message;
			const { id, room } = request;
			if (running.has(id)) return;
			const sent = finished.get(id);
			if (sent) {
				send(sent);
				return;
			}
			running.add(id);
			const turn = (rooms.get(room) ?? Promise.resolve()).then(() => answer(request)).catch((err) => {
				log(`${id}: the runner failed: ${err?.stack ?? String(err)}`);
				return unavailable(id, "the runner failed");
			}).then((message) => deliver(id, message)).finally(() => {
				running.delete(id);
				released.delete(id);
				if (rooms.get(room) === turn) rooms.delete(room);
			});
			rooms.set(room, turn);
		},
		idle: () => running.size === 0 && taking.size === 0,
		async settled() {
			while (rooms.size) await Promise.all(rooms.values());
		}
	};
}
//#endregion
//#region src/runner/scan.ts
/** What `scan` names as the match when the patterns couldn't be read. */
const UNREADABLE = "unreadable patterns: everything is held";
/** The patterns in `file`: [] when the owner's is missing, and null, logged, when it can't be used. */
async function readPatterns(file, optional, log) {
	const unusable = (why) => {
		if (!optional) throw new Error(`${file}: ${why}`);
		log(`${file} can't be used, so every answer, brief and report is held: ${why}`);
		return null;
	};
	let value;
	try {
		value = JSON.parse(await fs.readFile(file, "utf8"));
	} catch (err) {
		if (optional && err.code === "ENOENT") return [];
		if (!optional) throw err;
		return unusable(err.message);
	}
	const list = value?.patterns;
	if (!Array.isArray(list)) return unusable("it has no \"patterns\" list");
	const out = [];
	for (const p of list) {
		const name = typeof p?.name === "string" && p.name ? p.name : String(p?.regex);
		try {
			if (typeof p?.regex !== "string" || !p.regex) throw new Error("no regex");
			const flags = typeof p.flags === "string" ? p.flags : "";
			if (!/^[imsu]*$/.test(flags)) throw new Error(`flags "${flags}" aren't any of i, m, s and u`);
			out.push({
				name,
				regex: new RegExp(p.regex, flags)
			});
		} catch (err) {
			return unusable(`the secret pattern "${name}" doesn't compile: ${err.message}`);
		}
	}
	return out;
}
/** The mod's patterns and the owner's, or null when the owner's can't be used. */
async function loadPatterns(modFile, ownerFile, log) {
	const mod = await readPatterns(modFile, false, log);
	const owner = await readPatterns(ownerFile, true, log);
	return owner && [...mod, ...owner];
}
/** The name of the first pattern `text` matches, or null when it matches none; UNREADABLE when `patterns` is null. */
function scan(text, patterns) {
	if (!patterns) return UNREADABLE;
	return patterns.find((p) => p.regex.test(text))?.name ?? null;
}
//#endregion
//#region src/runner/environment.ts
const runnerEnvPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "environment.json");
//#endregion
//#region src/runner/start.ts
/** The runner's lock: `{ pid, code }` of the supervisor that holds it. */
const runnerLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "lock.json");
const LOCK_REFRESH_MS = 3e4;
/** What names a runner.js's code: its size and write time. Null when it is gone. */
async function runnerCode(file) {
	const st = await fs.stat(file).catch(() => null);
	return st && st.isFile() ? `${st.size}-${Math.round(st.mtimeMs)}` : null;
}
/**
* Makes the runner use the config folder `--claude-dir` names, whatever it inherited: the default
* ~/.claude takes CLAUDE_CONFIG_DIR away (Claude Code then looks there, and for ~/.claude.json);
* any other folder is set as CLAUDE_CONFIG_DIR, for the runner and its forks.
*/
function applyClaudeDir(argv, env, home) {
	const i = argv.indexOf("--claude-dir");
	const dir = i >= 0 ? argv[i + 1] : void 0;
	if (!dir || dir.startsWith("--")) return;
	if (path.resolve(dir) === path.resolve(home, ".claude")) delete env.CLAUDE_CONFIG_DIR;
	else env.CLAUDE_CONFIG_DIR = dir;
}
//#endregion
//#region src/runner/main.ts
const LOG_CAP_BYTES = 262144;
const CHECK_MS = 6e4;
const self = fileURLToPath(import.meta.url);
const here = path.dirname(self);
const appDir = path.join(here, "..");
applyClaudeDir(process.argv, process.env, os.homedir());
const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
const isoplanDir = path.join(claudeDir, "isoplan");
const logFile = path.join(isoplanDir, "logs", "runner.log");
let logging = Promise.resolve();
function log(text) {
	const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${text}\n`;
	logging = logging.then(() => writeLog(line)).catch(() => {});
}
async function writeLog(text) {
	const size = (await fs.stat(logFile).catch(() => null))?.size ?? 0;
	await fs.mkdir(path.dirname(logFile), { recursive: true });
	if (size > LOG_CAP_BYTES) await fs.writeFile(logFile, text);
	else await fs.appendFile(logFile, text);
}
async function supervisor() {
	const lock = runnerLockPath(claudeDir);
	const code = await runnerCode(self);
	if (!await takeLock(lock, process.pid, alive, false, Date.now(), {
		freshMs: 9e4,
		extra: { code }
	}).catch(() => false)) return 0;
	log(`runner ${process.pid} started`);
	if (process.argv.includes("--inherited-env")) log(`no environment is recorded in ${runnerEnvPath(claudeDir)}, so the runner runs with its starter's; run the plugin's install script to record one`);
	const refresh = setInterval(() => {
		refreshLock(lock, process.pid).then((isHolder) => {
			if (isHolder) return;
			log(`runner ${process.pid} stopped: another runner took its lock`);
			process.exit(0);
		}, () => {});
	}, LOCK_REFRESH_MS);
	const stopped = await supervise({
		log,
		run: () => new Promise((resolve) => {
			const child = spawn(process.execPath, [
				self,
				"--claude-dir",
				claudeDir,
				"--worker"
			], {
				cwd: claudeDir,
				stdio: [
					"pipe",
					"ignore",
					"pipe"
				],
				windowsHide: true
			});
			let stderr = "";
			child.stderr.setEncoding("utf8").on("data", (piece) => stderr = (stderr + piece).slice(-4e3));
			child.on("error", (err) => (log(`couldn't start the runner's worker: ${err.message}`), resolve(1)));
			child.on("close", (exit) => {
				if (stderr.trim()) log(`the runner's worker wrote: ${stderr.trim()}`);
				resolve(exit);
			});
		})
	});
	clearInterval(refresh);
	if (stopped === "done") {
		log(`runner ${process.pid} stopped: no room on this machine is lit`);
		await releaseLock(lock, process.pid).catch(() => {});
	} else {
		const why = stopped === "not-wanted" ? "the office server doesn't want this machine's runner" : "its worker kept crashing as it started";
		log(`runner ${process.pid} stopped: ${why}; it won't start again for ${HOLD_OFF_MS / 6e4} minutes`);
		await holdOff(lock, process.pid, Date.now() + HOLD_OFF_MS, {
			reason: stopped,
			code
		}).catch(() => {});
	}
	return 0;
}
async function worker() {
	const io = nodeIo();
	const config = () => loadConfig(io, path.join(appDir, "config.json"), path.join(isoplanDir, "config.json"));
	const settings = () => loadSettings(io, path.join(appDir, "runner.json"), path.join(isoplanDir, "runner.json"));
	const first = await config();
	await settings();
	const answerer = createClaudeAnswerer({
		claudeDir,
		binary: () => claudeBinary(claudeDir, process.env, process.platform, os.homedir()),
		model: async () => (await settings()).claudeModel,
		config
	});
	process.on("exit", () => answerer.close());
	const git = createRunGit();
	const gitMs = async () => (await settings()).gitTimeoutSeconds * 1e3;
	const told = (err) => {
		if (!(err instanceof HandoffGitError)) throw err;
		log(`handoff git: ${err.detail}`);
		return new PushFailed(GIT_FAILED[err.kind]);
	};
	const scanText = async (text) => scan(text, await loadPatterns(path.join(appDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), log));
	let send = () => {};
	const runner = createRunner({
		answerer,
		ledger: await openLedger(path.join(isoplanDir, "runner", "ledger.json")),
		settings,
		prompts: () => loadPrompts(path.join(appDir, "prompts")),
		scan: scanText,
		send: (message) => send(message),
		log,
		isDir: (p) => fs.stat(p).then((s) => s.isDirectory(), () => false),
		isReported: async (session, lead) => {
			const id = forkableId(session);
			const lock = id ? await readLock(lockPath(claudeDir, id)) : null;
			if (!id || lock && lock.pid === null && lock.until !== null && lock.until > Date.now()) return false;
			return Date.now() - lead.lastActive <= askableMs(await config().catch(() => first));
		},
		prepareBrief: async (lead, handoff) => {
			const { from, files } = await prepare(git, lead.cwd, await gitMs()).catch((err) => Promise.reject(told(err)));
			return {
				files,
				note: handoffNote({
					branch: handoffBranch(handoff),
					from,
					files,
					at: /* @__PURE__ */ new Date()
				})
			};
		},
		push: async (_session, lead, handoff, pushAnyway) => {
			const pushed = await pushHandoff(git, lead.cwd, handoff, await gitMs(), {
				scan: scanText,
				pushAnyway
			}).catch((err) => Promise.reject(told(err)));
			return "held" in pushed ? pushed : [pushed.repo];
		},
		take: (message) => takeHandoff(message, {
			run: git,
			io,
			claudeDir,
			machine: os.hostname(),
			platform: process.platform,
			env: process.env,
			settings,
			claude: () => claudeBinary(claudeDir, process.env, process.platform, os.homedir()),
			scan: scanText,
			log
		})
	});
	let notWanted = false;
	let wake = () => {};
	const link = createLink({
		url: first.server,
		emit: (line) => {
			if (line.type === "log") log(line.text);
			else if (line.type === "error") log(`the office server says: ${line.message} (${line.code})`);
		},
		onMessage: (message) => runner.take(message),
		onNotWanted: () => {
			notWanted = true;
			wake();
		},
		hello: {
			type: "runner",
			v: 1,
			account: await accountOf({
				readText: (p) => fs.readFile(p, "utf8").catch(() => null),
				run: io.run
			}, claudeJson, os.homedir()),
			machine: { name: os.hostname() }
		}
	});
	send = (message) => link.send(message);
	log(`the runner's worker ${process.pid} is answering for this machine through ${first.server}`);
	let orphaned = false;
	const gone = new Promise((resolve) => process.stdin.on("end", resolve).on("error", resolve).resume()).then(() => orphaned = true);
	for (;;) {
		await Promise.race([new Promise((r) => (wake = r, setTimeout(r, CHECK_MS))), gone]);
		if (orphaned || notWanted) break;
		if (!runner.idle()) continue;
		const window = askableMs(await config().catch(() => first));
		if (!await anyRoomSince(io, path.join(claudeDir, "projects"), Date.now() - window)) break;
	}
	link.close();
	return notWanted ? 3 : 0;
}
process.exitCode = await (process.argv.includes("--worker") ? worker() : supervisor());
await logging;
process.exit();
//#endregion
export {};
