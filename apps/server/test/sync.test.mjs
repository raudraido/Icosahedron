import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createApp } from "../src/server.mjs";
import { memoryStore } from "../src/store.mjs";

const verify = async (_url, a) => a?.t === "good";

async function boot() {
  const app = createApp({ navidromeUrl: "http://nav", store: memoryStore(), verify });
  await new Promise((r) => app.http.listen(0, r));
  return { app, url: `ws://127.0.0.1:${app.http.address().port}/sync` };
}

function client(url, u, deviceId, t = "good") {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else inbox.push(m);
  });
  const next = (pred) => {
    const i = inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve) => waiters.push({ pred, resolve }));
  };
  const closed = new Promise((r) => ws.on("close", (code) => r(code)));
  ws.on("open", () => ws.send(JSON.stringify({ type: "hello", auth: { u, t, s: "x" }, device: { deviceId, name: deviceId, kind: "web" } })));
  return { ws, next, closed, send: (o) => ws.send(JSON.stringify(o)) };
}

test("bad credentials are rejected", async () => {
  const { app, url } = await boot();
  const c = client(url, "bob", "d1", "bad");
  assert.equal(await c.closed, 4003);
  app.close();
});

test("state propagates, remote command and transfer work, users are isolated", async () => {
  const { app, url } = await boot();
  const a = client(url, "bob", "phone");
  await a.next((m) => m.type === "welcome");
  const b = client(url, "bob", "laptop");
  const w = await b.next((m) => m.type === "welcome");
  assert.equal(w.devices.length, 2);
  const other = client(url, "alice", "x");
  await other.next((m) => m.type === "welcome");

  a.send({ type: "state", state: { queue: ["1", "2"], index: 1, positionMs: 5000, playing: true } });
  const s = await b.next((m) => m.type === "state");
  assert.equal(s.from, "phone");
  assert.equal(s.state.index, 1);
  const dv = await b.next((m) => m.type === "devices");
  assert.equal(dv.activeDeviceId, "phone");

  b.send({ type: "command", target: "phone", cmd: "pause" });
  assert.equal((await a.next((m) => m.type === "command")).cmd, "pause");

  b.send({ type: "transfer", target: "laptop" });
  const load = await b.next((m) => m.type === "command" && m.cmd === "load");
  assert.equal(load.args.state.playing, true);
  assert.equal(load.args.state.positionMs, 5000);
  assert.equal((await a.next((m) => m.type === "command" && m.cmd === "pause")).cmd, "pause");

  // alice never saw bob's traffic
  other.send({ type: "command", target: "phone", cmd: "pause" }); // cross-user target ignored
  await new Promise((r) => setTimeout(r, 100));
  app.close();
});

test("jukebox commands are validated and forwarded", async () => {
  const { app, url } = await boot();
  const a = client(url, "bob", "player");
  await a.next((m) => m.type === "welcome");
  const b = client(url, "bob", "remote");
  await b.next((m) => m.type === "welcome");

  const tracks = [{ id: "1", title: "One" }, { id: "2", title: "Two" }];
  b.send({ type: "command", target: "player", cmd: "enqueue", args: { at: "end", tracks: [] } }); // empty: dropped
  b.send({ type: "command", target: "player", cmd: "enqueue", args: { at: "middle", tracks } }); // bad position: dropped
  b.send({ type: "command", target: "player", cmd: "jump", args: { index: "x" } }); // not an integer: dropped
  b.send({ type: "command", target: "player", cmd: "enqueue", args: { at: "next", tracks } });
  const e = await a.next((m) => m.type === "command");
  assert.equal(e.cmd, "enqueue"); // the invalid ones above never arrived
  assert.equal(e.args.tracks.length, 2);
  assert.equal(e.args.at, "next");

  b.send({ type: "command", target: "player", cmd: "enqueue", args: { at: "now", tracks } });
  assert.equal((await a.next((m) => m.type === "command")).args.at, "now");

  b.send({ type: "command", target: "player", cmd: "jump", args: { index: 3 } });
  assert.equal((await a.next((m) => m.type === "command")).args.index, 3);
  b.send({ type: "command", target: "player", cmd: "remove", args: { index: 0 } });
  assert.equal((await a.next((m) => m.type === "command")).cmd, "remove");
  app.close();
});

test("late joiner receives stored state", async () => {
  const { app, url } = await boot();
  const a = client(url, "bob", "phone");
  await a.next((m) => m.type === "welcome");
  a.send({ type: "state", state: { queue: ["9"], index: 0, positionMs: 1, playing: false } });
  await new Promise((r) => setTimeout(r, 50));
  const b = client(url, "bob", "tv");
  const w = await b.next((m) => m.type === "welcome");
  assert.deepEqual(w.state.queue, ["9"]);
  app.close();
});

test("queue is kept when omitted; broadcast omits it; queue items may be objects", async () => {
  const { app, url } = await boot();
  const a = client(url, "bob", "phone");
  await a.next((m) => m.type === "welcome");
  const b = client(url, "bob", "laptop");
  await b.next((m) => m.type === "welcome");
  a.send({ type: "state", state: { queue: [{ id: "1", title: "x" }], index: 0, positionMs: 0, playing: true } });
  assert.equal((await b.next((m) => m.type === "state")).state.queue[0].id, "1");
  a.send({ type: "state", state: { index: 0, positionMs: 4000, playing: true } });
  const s2 = await b.next((m) => m.type === "state");
  assert.equal(s2.state.queue, undefined);
  assert.equal(s2.state.positionMs, 4000);
  const c = client(url, "bob", "tv");
  const w = await c.next((m) => m.type === "welcome");
  assert.equal(w.state.queue[0].title, "x");
  assert.equal(w.state.positionMs, 4000);
  app.close();
});

test("settings: stored, broadcast to other devices only, delivered on join, size-limited", async () => {
  const { app, url } = await boot();
  const a = client(url, "bob", "phone");
  const w0 = await a.next((m) => m.type === "welcome");
  assert.equal(w0.settings, null);
  const b = client(url, "bob", "laptop");
  await b.next((m) => m.type === "welcome");

  a.send({ type: "settings", settings: { values: { icosahedron_theme: "Dark" }, at: 1 } });
  const m = await b.next((x) => x.type === "settings");
  assert.equal(m.settings.values.icosahedron_theme, "Dark");
  assert.equal(m.from, "phone");

  const c = client(url, "bob", "tv");
  const w = await c.next((x) => x.type === "welcome");
  assert.equal(w.settings.values.icosahedron_theme, "Dark");

  // oversized blobs are ignored, previous value stays
  a.send({ type: "settings", settings: { values: { big: "x".repeat(300 * 1024) } } });
  await new Promise((r) => setTimeout(r, 100));
  const d = client(url, "bob", "watch");
  const w2 = await d.next((x) => x.type === "welcome");
  assert.equal(w2.settings.values.icosahedron_theme, "Dark");
  app.close();
});
