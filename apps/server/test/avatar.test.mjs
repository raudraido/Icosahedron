import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.mjs";
import { memoryStore } from "../src/store.mjs";
import { AVATAR_MAX_BYTES } from "../src/avatar.mjs";

const AUTH = { authorization: "Subsonic u=bob&t=good&s=x" };
const OTHER = { authorization: "Subsonic u=amy&t=good&s=x" };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);

async function boot() {
  const app = createApp({ navidromeUrl: "http://nav", store: memoryStore(), verify: async (_u, a) => a.t === "good" });
  await new Promise((r) => app.http.listen(0, r));
  return { app, base: `http://127.0.0.1:${app.http.address().port}` };
}

test("profile picture: put, get with ETag, replace, delete, per user", async () => {
  const { app, base } = await boot();
  assert.equal((await fetch(`${base}/avatar`)).status, 401);
  assert.equal((await fetch(`${base}/avatar`, { headers: AUTH })).status, 404);

  assert.equal((await fetch(`${base}/avatar`, { method: "PUT", headers: AUTH, body: JPEG })).status, 204);
  const r = await fetch(`${base}/avatar`, { headers: AUTH });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), JPEG);
  const again = await fetch(`${base}/avatar`, { headers: { ...AUTH, "if-none-match": r.headers.get("etag") } });
  assert.equal(again.status, 304);

  assert.equal((await fetch(`${base}/avatar`, { headers: OTHER })).status, 404); // each user has their own

  assert.equal((await fetch(`${base}/avatar`, { method: "DELETE", headers: AUTH })).status, 204);
  assert.equal((await fetch(`${base}/avatar`, { headers: AUTH })).status, 404);
  app.close();
});

test("profile picture: only small images", async () => {
  const { app, base } = await boot();
  const put = (body) => fetch(`${base}/avatar`, { method: "PUT", headers: AUTH, body });
  assert.equal((await put(Buffer.from("not an image at all"))).status, 415);
  assert.equal((await put(Buffer.concat([JPEG, Buffer.alloc(AVATAR_MAX_BYTES)]))).status, 413);
  assert.equal((await fetch(`${base}/avatar`, { headers: AUTH })).status, 404);
  app.close();
});
