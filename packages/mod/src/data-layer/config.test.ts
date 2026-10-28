import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { loadConfig } from "./config.js";
import { nodeIo } from "./io.js";
import { defaults, modDir, tempRoot } from "./fixture.js";

const defaultsPath = path.join(modDir, "config.json");

async function withUser(user: string | object) {
  const p = path.join(tempRoot(), "isoplan", "config.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof user === "string" ? user : JSON.stringify(user));
  return loadConfig(nodeIo(), defaultsPath, p);
}

test("config: the mod's defaults when the person has no file", async () => {
  expect(await loadConfig(nodeIo(), defaultsPath, path.join(tempRoot(), "missing.json"))).toEqual(defaults);
  expect(defaults.server).toBe("ws://127.0.0.1:4747/data-layer");
});

test("config: a missing, null or wrong-typed user value falls back to the default", async () => {
  const config = await withUser('{"activeMinutes": null, "idleMinutes": "30", "quietSeconds": -1, "tailBytes": 1e999, "touchedTools": "Edit", "touchedWindowMinutes": 45}');
  expect(config).toEqual({ ...defaults, touchedWindowMinutes: 45 });
  expect(await withUser("{ broken")).toEqual(defaults);
});

test("config: the server is the person's when it is wss://, or ws:// to this machine only", async () => {
  expect((await withUser({ server: "wss://office.example.com/data-layer" })).server).toBe("wss://office.example.com/data-layer");
  for (const local of ["ws://localhost:4747/data-layer", "ws://[::1]:4747/data-layer", "ws://127.0.0.1:9000/x"]) {
    expect((await withUser({ server: local })).server).toBe(local);
  }
  expect((await withUser({ server: "ws://office.example.com/data-layer" })).server).toBe(defaults.server);
  expect((await withUser({ server: "ws://10.0.0.5:4747/data-layer" })).server).toBe(defaults.server);
  expect((await withUser({ server: "http://office.example.com" })).server).toBe(defaults.server);
  expect((await withUser({ server: "not a url" })).server).toBe(defaults.server);
});

test("config: a byte count must be a whole number; a fractional tailBytes falls back to the default", async () => {
  expect((await withUser({ tailBytes: 1000.5 })).tailBytes).toBe(defaults.tailBytes);
  expect((await withUser({ tailBytes: 2048 })).tailBytes).toBe(2048);
});

test("config: streamSeconds below its floor falls back to the default", async () => {
  expect((await withUser({ streamSeconds: 0.01 })).streamSeconds).toBe(defaults.streamSeconds);
  expect((await withUser({ streamSeconds: 0.25 })).streamSeconds).toBe(0.25);
});

test("config: a person's own lightsOffHours 0 turns lights-off rooms off", async () => {
  expect((await withUser({ lightsOffHours: 0 })).lightsOffHours).toBe(0);
});
