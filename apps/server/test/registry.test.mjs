import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createApp } from "../src/server.mjs";
import { memoryStore } from "../src/store.mjs";

const verify = async (_url, a) => a?.t === "good";
const DAY = 24 * 3600 * 1000;

async function boot(store = memoryStore()) {
  const app = createApp({ navidromeUrl: "http://nav", store, verify });
  await new Promise((r) => app.http.listen(0, r));
  return { app, store, url: `ws://127.0.0.1:${app.http.address().port}/sync` };
}

function client(url, user, deviceId, device = {}) {
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
  const quiet = (pred, ms = 150) => new Promise((resolve) => {
    if (inbox.some(pred)) return resolve(false);
    const w = { pred, resolve: () => resolve(false) };
    waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); resolve(true); }, ms);
  });
  ws.on("open", () => ws.send(JSON.stringify({ type: "hello", auth: { u: user, t: "good", s: "x" }, device: { deviceId, name: deviceId, kind: "web", ...device } })));
  return { ws, next, quiet, send: (o) => ws.send(JSON.stringify(o)), close: () => ws.close() };
}

const isRegistry = (m) => m.type === "registry";

test("registry: players register, show online/offline and keep their name", async () => {
  const { app, url } = await boot();
  const a = client(url, "bob", "phone", { name: "Auto name" });
  const w = await a.next((m) => m.type === "welcome");
  assert.equal(w.name, "Auto name");
  const r1 = await a.next(isRegistry);
  assert.deepEqual(r1.devices.map((d) => [d.deviceId, d.online]), [["phone", true]]);

  const b = client(url, "bob", "laptop");
  await b.next((m) => m.type === "welcome");
  assert.equal((await a.next((m) => isRegistry(m) && m.devices.length === 2)).devices.length, 2);

  // rename: the registry wins over whatever the player calls itself on its next hello
  b.send({ type: "rename", name: "Kitchen" });
  assert.equal((await b.next((m) => m.type === "renamed")).name, "Kitchen");
  b.close();
  const off = await a.next((m) => isRegistry(m) && m.devices.some((d) => d.deviceId === "laptop" && !d.online));
  assert.equal(off.devices.find((d) => d.deviceId === "laptop").name, "Kitchen");
  const b2 = client(url, "bob", "laptop", { name: "Something else" });
  assert.equal((await b2.next((m) => m.type === "welcome")).name, "Kitchen");
  app.close();
});

test("registry: only offline players can be forgotten, other users are isolated", async () => {
  const { app, url } = await boot();
  const a = client(url, "bob", "phone");
  await a.next(isRegistry);
  const b = client(url, "bob", "laptop");
  await b.next((m) => m.type === "welcome");
  await a.next((m) => isRegistry(m) && m.devices.length === 2);

  a.send({ type: "forget", target: "laptop" }); // online: refused
  assert.equal((await a.next((m) => m.type === "error")).message, "device is online");

  b.close();
  await a.next((m) => isRegistry(m) && m.devices.some((d) => d.deviceId === "laptop" && !d.online));
  a.send({ type: "forget", target: "laptop" });
  assert.deepEqual((await a.next((m) => isRegistry(m) && m.devices.length === 1)).devices.map((d) => d.deviceId), ["phone"]);

  const other = client(url, "alice", "x");
  await other.next((m) => m.type === "welcome");
  other.send({ type: "forget", target: "phone" }); // not alice's
  assert.ok(await a.quiet(isRegistry));
  app.close();
});

test("registry: players offline for more than 90 days are dropped", async () => {
  const store = memoryStore();
  store.save("bob", { state: null, activeDeviceId: null, settings: null, devices: {
    old: { name: "Old", kind: "web", lastSeen: Date.now() - 100 * DAY },
    recent: { name: "Recent", kind: "web", lastSeen: Date.now() - 10 * DAY },
  } });
  const { app, url } = await boot(store);
  const a = client(url, "bob", "phone");
  const r = await a.next(isRegistry);
  assert.deepEqual(r.devices.map((d) => d.deviceId).sort(), ["phone", "recent"]);
  app.close();
});

test("playback off: hidden from the device list, not controllable, cannot publish or control", async () => {
  const { app, url } = await boot();
  const a = client(url, "bob", "phone");
  await a.next((m) => m.type === "welcome");
  const quiet = client(url, "bob", "tablet", { playback: false });
  const w = await quiet.next((m) => m.type === "welcome");
  assert.equal(w.state, null);
  assert.deepEqual(w.devices.map((d) => d.deviceId), ["phone"]);
  const reg = await a.next((m) => isRegistry(m) && m.devices.length === 2); // still registered
  assert.equal(reg.devices.length, 2);

  a.send({ type: "state", state: { queue: ["1"], index: 0, positionMs: 0, playing: true } });
  a.send({ type: "command", target: "tablet", cmd: "pause" });
  quiet.send({ type: "state", state: { queue: ["9"], index: 0, positionMs: 0, playing: true } });
  quiet.send({ type: "command", target: "phone", cmd: "pause" });
  assert.ok(await quiet.quiet((m) => m.type === "command" || m.type === "state"));
  assert.ok(await a.quiet((m) => m.type === "command"));
  app.close();
});

test("clear: wipes the stored playback state and/or settings", async () => {
  const { app, url, store } = await boot();
  const a = client(url, "bob", "phone");
  await a.next((m) => m.type === "welcome");
  const b = client(url, "bob", "laptop");
  await b.next((m) => m.type === "welcome");
  a.send({ type: "state", state: { queue: ["1"], index: 0, positionMs: 0, playing: true } });
  a.send({ type: "settings", settings: { values: { x: "1" }, at: 1 } });
  await b.next((m) => m.type === "settings");
  b.send({ type: "clear", state: true });
  assert.equal((await a.next((m) => m.type === "cleared")).state, true);
  await new Promise((r) => setTimeout(r, 1200)); // the store debounces writes
  const saved = store.load("bob");
  assert.equal(saved.state, null);
  assert.equal(saved.settings.values.x, "1"); // settings untouched
  app.close();
});

test("independent players: both play, neither is paused, each state reaches the others", async () => {
  const { app, url } = await boot();
  const phone = client(url, "bob", "phone", { proto: 2 });
  await phone.next((m) => m.type === "welcome");
  const desktop = client(url, "bob", "desktop", { proto: 2 });
  await desktop.next((m) => m.type === "welcome");

  desktop.send({ type: "state", state: { queue: ["d1", "d2"], index: 0, positionMs: 1000, playing: true } });
  const s1 = await phone.next((m) => m.type === "state");
  assert.equal(s1.from, "desktop");
  phone.send({ type: "state", state: { queue: ["p1"], index: 0, positionMs: 0, playing: true } });
  const s2 = await desktop.next((m) => m.type === "state");
  assert.equal(s2.from, "phone");
  assert.deepEqual(s2.state.queue, ["p1"]);

  // nobody was told to pause, and a later update of one keeps the other's queue
  assert.ok(await desktop.quiet((m) => m.type === "command"));
  assert.ok(await phone.quiet((m) => m.type === "command"));
  desktop.send({ type: "state", state: { index: 1, positionMs: 5000, playing: true } }); // queue unchanged: omitted
  const s3 = await phone.next((m) => m.type === "state" && m.from === "desktop");
  assert.equal(s3.state.index, 1);
  assert.equal(s3.state.queue, undefined);

  // a player that joins later gets the others' states
  const late = client(url, "bob", "tablet", { proto: 2 });
  const w = await late.next((m) => m.type === "welcome");
  assert.deepEqual(Object.keys(w.states).sort(), ["desktop", "phone"]);
  assert.deepEqual(w.states.desktop.queue, ["d1", "d2"]);
  assert.deepEqual(w.states.phone.queue, ["p1"]);
  app.close();
});

test("players without per-player states only follow the last player that started playing", async () => {
  const { app, url } = await boot();
  const legacy = client(url, "bob", "old"); // no proto: follows one state
  await legacy.next((m) => m.type === "welcome");
  const a = client(url, "bob", "a", { proto: 2 });
  await a.next((m) => m.type === "welcome");
  const b = client(url, "bob", "b", { proto: 2 });
  await b.next((m) => m.type === "welcome");

  a.send({ type: "state", state: { queue: ["a1"], index: 0, positionMs: 0, playing: true } });
  assert.equal((await legacy.next((m) => m.type === "state")).from, "a");
  b.send({ type: "state", state: { queue: ["b1"], index: 0, positionMs: 0, playing: true } }); // b becomes the active one
  assert.equal((await legacy.next((m) => m.type === "state")).from, "b");
  a.send({ type: "state", state: { index: 0, positionMs: 3000, playing: true } }); // a is not the active one any more
  assert.ok(await legacy.quiet((m) => m.type === "state" && m.from === "a"));
  app.close();
});

test("transfer: moves the source player's playback to the target", async () => {
  const { app, url } = await boot();
  const phone = client(url, "bob", "phone", { proto: 2 });
  await phone.next((m) => m.type === "welcome");
  const desktop = client(url, "bob", "desktop", { proto: 2 });
  await desktop.next((m) => m.type === "welcome");
  desktop.send({ type: "state", state: { queue: ["d1", "d2"], index: 1, positionMs: 7000, playing: true } });
  phone.send({ type: "state", state: { queue: ["p1"], index: 0, positionMs: 0, playing: true } });
  await desktop.next((m) => m.type === "state");

  // the phone pulls the desktop's playback here
  phone.send({ type: "transfer", source: "desktop", target: "phone" });
  const load = await phone.next((m) => m.type === "command" && m.cmd === "load");
  assert.deepEqual(load.args.state.queue, ["d1", "d2"]);
  assert.equal(load.args.state.index, 1);
  assert.equal((await desktop.next((m) => m.type === "command")).cmd, "pause");
  app.close();
});
