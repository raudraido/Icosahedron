import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "../src/server.mjs";
import { createLastFm } from "../src/lastfm.mjs";
import { memoryStore } from "../src/store.mjs";

const AUTH = { authorization: "Subsonic u=bob&t=good&s=x", "content-type": "application/json" };

function fakeLastFm() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const q = init?.body ? Object.fromEntries(init.body) : Object.fromEntries(new URL(url).searchParams);
    calls.push(q);
    const reply = (o) => ({ json: async () => o });
    if (q.method === "auth.getToken") return reply({ token: "TOK" });
    if (q.method === "auth.getSession") return q.token === "approved" ? reply({ session: { key: "SK", name: "bobfm" } }) : reply({ error: 14, message: "unauthorized token" });
    return reply({});
  };
  return { calls, lastfm: createLastFm({ apiKey: "KEY", apiSecret: "SECRET", fetchImpl }) };
}

async function boot(lastfm) {
  const app = createApp({ navidromeUrl: "http://nav", store: memoryStore(), lastfm, verify: async (_u, a) => a.t === "good" });
  await new Promise((r) => app.http.listen(0, r));
  return { app, base: `http://127.0.0.1:${app.http.address().port}` };
}
const call = (base, method, path, body) => fetch(base + path, { method, headers: AUTH, body: body ? JSON.stringify(body) : undefined });

test("full flow: connect, toggles, now playing, scrobble (signed), disconnect", async () => {
  const { calls, lastfm } = fakeLastFm();
  const { app, base } = await boot(lastfm);

  assert.equal((await fetch(`${base}/lastfm/config`)).status, 401);
  assert.deepEqual(await (await call(base, "GET", "/lastfm/config")).json(), { configured: true, apiKey: "KEY" });
  assert.equal(await (await call(base, "GET", "/lastfm/connection")).json(), null);

  const t = await (await call(base, "POST", "/lastfm/token")).json();
  assert.equal(t.token, "TOK");
  assert.match(t.authUrl, /api_key=KEY&token=TOK/);
  assert.deepEqual(await (await call(base, "POST", "/lastfm/session", { token: "pending" })).json(), { connected: false });
  assert.deepEqual(await (await call(base, "POST", "/lastfm/session", { token: "approved" })).json(), { connected: true, username: "bobfm" });

  await call(base, "PUT", "/lastfm/toggles", { scrobbleEnabled: true });
  assert.deepEqual(await (await call(base, "GET", "/lastfm/connection")).json(), { username: "bobfm", historyEnabled: false, scrobbleEnabled: true });

  const track = { title: "Song", artist: "Art", album: "Alb", duration: 200.4 };
  assert.equal((await call(base, "POST", "/lastfm/nowplaying", { track })).status, 204);
  assert.equal((await call(base, "POST", "/lastfm/scrobble", { track, timestamp: 1700000000 })).status, 204);
  const sc = calls.at(-1);
  assert.equal(sc.method, "track.scrobble");
  assert.equal(sc.sk, "SK");
  assert.equal(sc.duration, "200");
  // signature: md5 of sorted key+value pairs (without api_sig/format) + secret
  const { api_sig, format, ...rest } = sc;
  const expected = createHash("md5").update(Object.keys(rest).sort().map((k) => k + rest[k]).join("") + "SECRET").digest("hex");
  assert.equal(api_sig, expected);

  assert.equal((await call(base, "DELETE", "/lastfm/connection")).status, 204);
  assert.equal(await (await call(base, "GET", "/lastfm/connection")).json(), null);
  app.close();
});

test("unconfigured engine answers 503 and reports it", async () => {
  const { app, base } = await boot(createLastFm({}));
  assert.deepEqual(await (await call(base, "GET", "/lastfm/config")).json(), { configured: false, apiKey: "" });
  assert.equal((await call(base, "POST", "/lastfm/token")).status, 503);
  app.close();
});
