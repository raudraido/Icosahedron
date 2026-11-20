import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.mjs";
import { createListenBrainz } from "../src/listenbrainz.mjs";
import { memoryStore } from "../src/store.mjs";

const AUTH = { authorization: "Subsonic u=bob&t=good&s=x", "content-type": "application/json" };
const TOKEN = "11111111-2222-3333-4444-555555555555";

function fakeLb() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), auth: init.headers?.authorization, body });
    const reply = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
    if (u.pathname === "/1/validate-token") return init.headers?.authorization === `Token ${TOKEN}` ? reply({ valid: true, user_name: "bobbrainz" }) : reply({ valid: false });
    if (u.pathname === "/1/submit-listens") return reply({ status: "ok" });
    if (u.pathname === "/1/user/bobbrainz/listens") {
      const n = Number(u.searchParams.get("count"));
      const all = [300, 200, 100].map((t) => ({ listened_at: t, track_metadata: { track_name: `T${t}`, artist_name: "A", release_name: "R" } }));
      return reply({ payload: { listens: all.filter((l) => !u.searchParams.get("max_ts") || l.listened_at < Number(u.searchParams.get("max_ts"))).slice(0, n) } });
    }
    return reply({ error: "nope" }, 404);
  };
  return { calls, listenbrainz: createListenBrainz({ fetchImpl }) };
}

async function boot(listenbrainz) {
  const app = createApp({ navidromeUrl: "http://nav", store: memoryStore(), listenbrainz, verify: async (_u, a) => a.t === "good" });
  await new Promise((r) => app.http.listen(0, r));
  return { app, base: `http://127.0.0.1:${app.http.address().port}` };
}
const call = (base, method, path, body) => fetch(base + path, { method, headers: AUTH, body: body ? JSON.stringify(body) : undefined });

test("connect with a token, toggles, now playing, scrobble, history, disconnect", async () => {
  const { calls, listenbrainz } = fakeLb();
  const { app, base } = await boot(listenbrainz);

  assert.equal((await fetch(`${base}/listenbrainz/config`)).status, 401);
  assert.deepEqual(await (await call(base, "GET", "/listenbrainz/config")).json(), { configured: true });
  assert.equal(await (await call(base, "GET", "/listenbrainz/connection")).json(), null);

  assert.equal((await call(base, "PUT", "/listenbrainz/connection", { token: "short" })).status, 400);
  assert.equal((await call(base, "PUT", "/listenbrainz/connection", { token: "99999999-2222-3333-4444-555555555555" })).status, 401);
  assert.equal(await (await call(base, "GET", "/listenbrainz/connection")).json(), null);
  assert.deepEqual(await (await call(base, "PUT", "/listenbrainz/connection", { token: TOKEN })).json(), { username: "bobbrainz" });

  await call(base, "PUT", "/listenbrainz/toggles", { scrobbleEnabled: true, historyEnabled: true });
  assert.deepEqual(await (await call(base, "GET", "/listenbrainz/connection")).json(), { username: "bobbrainz", historyEnabled: true, scrobbleEnabled: true });

  const track = { title: "Song", artist: "Art", album: "Alb", duration: 200.4 };
  assert.equal((await call(base, "POST", "/listenbrainz/nowplaying", { track })).status, 204);
  let c = calls.at(-1);
  assert.equal(c.auth, `Token ${TOKEN}`);
  assert.equal(c.body.listen_type, "playing_now");
  assert.equal(c.body.payload[0].listened_at, undefined);

  assert.equal((await call(base, "POST", "/listenbrainz/scrobble", { track, timestamp: 1700000000.9 })).status, 204);
  c = calls.at(-1);
  assert.equal(c.body.listen_type, "single");
  assert.equal(c.body.payload[0].listened_at, 1700000000);
  assert.equal(c.body.payload[0].track_metadata.track_name, "Song");
  assert.equal(c.body.payload[0].track_metadata.release_name, "Alb");
  assert.equal(c.body.payload[0].track_metadata.additional_info.duration_ms, 200400);

  const page1 = await (await call(base, "GET", "/listenbrainz/history?count=2")).json();
  assert.deepEqual(page1.tracks.map((t) => t.name), ["T300", "T200"]);
  assert.equal(page1.nextBefore, 200);
  const page2 = await (await call(base, "GET", `/listenbrainz/history?count=2&before=${page1.nextBefore}`)).json();
  assert.deepEqual(page2.tracks.map((t) => t.name), ["T100"]);
  assert.equal(page2.nextBefore, null);

  assert.equal((await call(base, "DELETE", "/listenbrainz/connection")).status, 204);
  assert.equal(await (await call(base, "GET", "/listenbrainz/connection")).json(), null);
  assert.equal((await call(base, "GET", "/listenbrainz/history")).status, 404);
  app.close();
});
