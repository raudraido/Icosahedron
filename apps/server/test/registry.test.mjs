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

test("one active player: starting playback elsewhere pauses the previous one and ignores its stale updates", async () => {
  const { app, url, store } = await boot();
  const a = client(url, "bob", "phone");
  await a.next((m) => m.type === "welcome");
  const b = client(url, "bob", "desktop");
  await b.next((m) => m.type === "welcome");

  a.send({ type: "state", state: { queue: ["a1", "a2"], index: 0, positionMs: 1000, playing: true } });
  await b.next((m) => m.type === "state");

  // the desktop starts playing: the phone is told to pause
  b.send({ type: "state", state: { queue: ["b1"], index: 0, positionMs: 0, playing: true } });
  assert.equal((await a.next((m) => m.type === "command")).cmd, "pause");
  assert.equal((await a.next((m) => m.type === "devices" && m.activeDeviceId === "desktop")).activeDeviceId, "desktop");

  // updates the phone sent before it got the pause must not take the active role back
  a.send({ type: "state", state: { index: 0, positionMs: 2000, playing: true } });
  assert.ok(await b.quiet((m) => m.type === "command")); // the desktop is not paused again
  // and its pause (from the command) must not overwrite the stored state with the phone's queue
  a.send({ type: "state", state: { index: 0, positionMs: 2500, playing: false } });
  await new Promise((r) => setTimeout(r, 1200)); // the store debounces writes
  const saved = store.load("bob");
  assert.equal(saved.activeDeviceId, "desktop");
  assert.deepEqual(saved.state.queue, ["b1"]);
  app.close();
});
