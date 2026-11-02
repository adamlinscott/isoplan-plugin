// The link the floor's Connect Claude Code opens, isoplan://connect?office=<office>&code=<code>&name=<name>,
// read strictly, since any web page can open one: the office must be https, or http only to this
// machine, with nothing but its origin; the code is the server's own shape; the name is plain text
// short enough for a dialog, with invisible formatting characters (bidi overrides among them) taken
// out rather than shown. And what Connect writes to config.json for it (withOffice).

import { officesOf, type Config } from "../data-layer/config.js";

export interface ConnectLink {
  /** The office's origin, such as https://office.team.com. */
  office: string;
  /** Its data-layer address, as config.json names it. */
  server: string;
  /** Its host, to show beside its name. */
  host: string;
  code: string;
  name: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_NAME = 80;

/**
 * Text from a link or an office, fit for a dialog: format characters (zero-width joiners, bidi
 * overrides and isolates) taken out, trimmed and cut to `max`; null when it holds a control
 * character or nothing is left.
 */
export function shown(text: string, max = MAX_NAME): string | null {
  if (/\p{Cc}/u.test(text)) return null;
  const plain = text.replace(/\p{Cf}/gu, "").trim();
  return plain ? plain.slice(0, max) : null;
}

/** The link's parts, or why it isn't one Connect takes. */
export function parseLink(text: string): ConnectLink | string {
  if (!URL.canParse(text)) return "this isn't a link Isoplan can read";
  const url = new URL(text);
  if (url.protocol !== "isoplan:" || url.host !== "connect" || !["", "/"].includes(url.pathname) || url.username || url.password || url.hash) return "this isn't an Isoplan connect link";
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 3 || !["office", "code", "name"].every((k) => keys.includes(k))) return "the link should name an office, a code and a name, once each";
  const office = url.searchParams.get("office")!;
  const code = url.searchParams.get("code")!;
  const name = shown(url.searchParams.get("name")!, Infinity);
  if (!URL.canParse(office)) return "the link's office isn't an address";
  const at = new URL(office);
  if (at.username || at.password || at.pathname !== "/" || at.search || at.hash || ![at.origin, `${at.origin}/`].includes(office)) return "the link's office should be an address with no path";
  if (at.protocol !== "https:" && !(at.protocol === "http:" && LOOPBACK.has(at.hostname))) return `the office ${at.host} isn't https, so nothing is sent to it (plain http only to this computer)`;
  if (!/^[\w-]{43}$/.test(code)) return "the link's code isn't one an office makes";
  if (!name || name.length > MAX_NAME) return `the office's name should be 1 to ${MAX_NAME} characters of plain text`;
  // One office on this machine, however the browser named it: the plugin's own default says 127.0.0.1.
  if (at.hostname === "localhost") at.hostname = "127.0.0.1";
  return { office: at.origin, server: `${at.origin.replace(/^http/, "ws")}/data-layer`, host: at.host, code, name };
}

/** The office's label in config.json: its name, lower case, letters, digits and dashes. */
export const labelOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");

/**
 * The person's config.json (`user`, as read) with `server` added to `servers`, or null when the
 * plugin already reports to it (`config`, the settings it makes). Every entry already there stays as
 * it is. With no usable `servers` but a `server` of the person's own, the plugin reported to that
 * alone, so it goes into the list first, under the label it showed with: adding another never stops
 * it. The plugin's default office, on this machine, isn't kept that way: someone who never set
 * one connects to the office they asked for alone. The new entry's
 * label is the office's name (labelOf), or its host, with -2, -3 and so on when that is taken.
 */
export function withOffice(user: Record<string, unknown>, config: Config, link: Pick<ConnectLink, "server" | "name" | "host">): Record<string, unknown> | null {
  const offices = officesOf(config);
  if (offices.some((o) => o.server === link.server)) return null;
  const servers = Array.isArray(user.servers) ? [...(user.servers as unknown[])] : [];
  const listed = offices.filter((o) => config.servers.some((e) => (e as { server?: unknown } | null)?.server === o.server));
  if (!listed.length && offices[0]!.server === user.server) servers.push({ label: offices[0]!.label, server: offices[0]!.server });
  const base = labelOf(link.name) || link.host;
  let label = base;
  for (let n = 2; offices.some((o) => o.label.toLowerCase() === label); n++) label = `${base}-${n}`;
  servers.push({ label, server: link.server });
  return { ...user, servers };
}
