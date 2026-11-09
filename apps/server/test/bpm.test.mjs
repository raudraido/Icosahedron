import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.mjs";
import { createBpmStore } from "../src/bpm.mjs";
import { memoryStore } from "../src/store.mjs";

const AUTH = { authorization: "Subsonic u=bob&t=good&s=x" };
async function boot(bpmStore) {
  const app = createApp({ navidromeUrl: "http://nav", store: memoryStore(), bpmStore, verify: async (_u, a) => a.t === "good" });
  await new Promise((r) => app.http.listen(0, r));
  return { app, base: `http://127.0.0.1:${app.http.address().port}` };
}
const put = (base, id, body, headers = AUTH) => fetch(`${base}/bpm/${id}`, { method: "PUT", headers, body: JSON.stringify(body) });

test("requires auth", async () => {
  const { app, base } = await boot(createBpmStore());
  assert.equal((await fetch(`${base}/bpm`)).status, 401);
  assert.equal((await fetch(`${base}/bpm`, { headers: { authorization: "Subsonic u=bob&t=bad&s=x" } })).status, 401);
  assert.equal((await put(base, "1", { bpm: 120 }, {})).status, 401);
  app.close();
});

test("stores, reads, lists; rejects nonsense; manual beats detected", async () => {
  const { app, base } = await boot(createBpmStore());
  assert.equal((await fetch(`${base}/bpm/t1`, { headers: AUTH })).status, 404);
  assert.equal((await put(base, "t1", { bpm: 128.4 })).status, 204);
  assert.equal((await put(base, "t2", { bpm: 9999 })).status, 422);
  assert.equal((await put(base, "t2", { bpm: "fast" })).status, 422);
  assert.deepEqual(await (await fetch(`${base}/bpm/t1`, { headers: AUTH })).json(), { bpm: 128.4 });
  assert.equal((await put(base, "t1", { bpm: 90, manual: true })).status, 204);
  assert.equal((await put(base, "t1", { bpm: 128 })).status, 422); // detection can't overwrite correction
  assert.deepEqual(await (await fetch(`${base}/bpm`, { headers: AUTH })).json(), { t1: 90 });
  app.close();
});

test("persists to disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "bpm-"));
  const s = createBpmStore(dir);
  s.set("a", 100, false);
  s.flush();
  assert.equal(JSON.parse(readFileSync(join(dir, "bpm.json"), "utf8")).a.bpm, 100);
  assert.equal(createBpmStore(dir).get("a"), 100);
});

test("bulk upload stores valid entries, keeps corrections", async () => {
  const { app, base } = await boot(createBpmStore());
  await put(base, "m", { bpm: 70, manual: true });
  const r = await fetch(`${base}/bpm`, { method: "POST", headers: AUTH, body: JSON.stringify({ a: 100, b: 5, m: 140, c: 128 }) });
  assert.deepEqual(await r.json(), { stored: 2 });
  assert.deepEqual(await (await fetch(`${base}/bpm`, { headers: AUTH })).json(), { m: 70, a: 100, c: 128 });
  app.close();
});
