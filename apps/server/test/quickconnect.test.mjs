import test from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { createApp } from "../src/server.mjs";
import { memoryStore } from "../src/store.mjs";
import { createQuickConnect, QC_TIMEOUT_MS } from "../src/quickconnect.mjs";
import { startDiscovery, addressFor, DISCOVERY_QUERY } from "../src/discovery.mjs";

const verify = async (_url, a) => a?.t === "good";
const AUTH = { authorization: "Subsonic u=alice&t=good&s=abc" };

async function boot(quickConnect) {
  const app = createApp({ navidromeUrl: "http://nav", store: memoryStore(), verify, quickConnect });
  await new Promise((r) => app.http.listen(0, r));
  const base = `http://127.0.0.1:${app.http.address().port}`;
  const call = async (method, path, { body, headers } = {}) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null };
  };
  return { app, call };
}

test("quick connect is off by default", async () => {
  const { app, call } = await boot(createQuickConnect());
  assert.deepEqual(await call("GET", "/quickconnect/enabled"), { status: 200, json: false });
  assert.equal((await call("POST", "/quickconnect/initiate", { body: {} })).status, 403);
  app.close();
});

test("quick connect: initiate, authorize in a signed-in app, claim once", async () => {
  const { app, call } = await boot(createQuickConnect({ enabled: true }));
  assert.equal((await call("GET", "/quickconnect/enabled")).json, true);

  const init = (await call("POST", "/quickconnect/initiate", { body: { deviceId: "tv1", name: "Living room TV", app: "Icosahedron TV", version: "1", kind: "tv" } })).json;
  assert.match(init.code, /^\d{6}$/);
  assert.equal(init.secret.length, 64);
  assert.equal(init.device.name, "Living room TV");

  assert.equal((await call("GET", `/quickconnect/connect?secret=${init.secret}`)).json.authenticated, false);
  assert.equal((await call("POST", "/quickconnect/claim", { body: { secret: init.secret } })).status, 404); // not authorized yet

  // nobody signed in cannot authorize; a wrong code is unknown
  assert.equal((await call("POST", "/quickconnect/authorize", { body: { code: init.code } })).status, 401);
  assert.equal((await call("POST", "/quickconnect/authorize", { body: { code: "000000" }, headers: AUTH })).status, 404);

  assert.equal((await call("POST", "/quickconnect/authorize", { body: { code: init.code }, headers: AUTH })).status, 200);
  assert.equal((await call("POST", "/quickconnect/authorize", { body: { code: init.code }, headers: AUTH })).status, 409);
  assert.equal((await call("GET", `/quickconnect/connect?secret=${init.secret}`)).json.authenticated, true);

  const claimed = await call("POST", "/quickconnect/claim", { body: { secret: init.secret } });
  assert.deepEqual(claimed.json, { u: "alice", t: "good", s: "abc" });
  assert.equal((await call("POST", "/quickconnect/claim", { body: { secret: init.secret } })).status, 404); // single use
  assert.equal((await call("GET", `/quickconnect/connect?secret=${init.secret}`)).status, 404);
  app.close();
});

test("quick connect: requests expire after ten minutes", () => {
  let t = 1_000_000;
  const qc = createQuickConnect({ enabled: true, now: () => t });
  const r = qc.initiate({ name: "TV" }, "1.2.3.4");
  assert.ok(qc.status(r.secret));
  t += QC_TIMEOUT_MS + 1;
  assert.equal(qc.status(r.secret), null);
  assert.equal(qc.authorize(r.code, { u: "a", t: "t", s: "s" }), "unknown");
});

test("quick connect: initiating and guessing are rate limited", () => {
  const qc = createQuickConnect({ enabled: true });
  for (let i = 0; i < 10; i++) assert.ok(qc.initiate({}, "9.9.9.9").code);
  assert.equal(qc.initiate({}, "9.9.9.9").error, "rate");
  assert.ok(qc.initiate({}, "8.8.8.8").code); // another address is fine
  for (let i = 0; i < 10; i++) assert.equal(qc.authorize("000000", { u: "mallory" }), "unknown");
  assert.equal(qc.authorize("000000", { u: "mallory" }), "rate");
});

test("discovery: answers the broadcast with the address that suits the asker", async () => {
  const d = await startDiscovery({ port: 0, publicUrl: "https://music.example.com/", name: "Home", id: "abc" });
  const sock = dgram.createSocket("udp4");
  const reply = new Promise((resolve) => sock.once("message", (m) => resolve(JSON.parse(m.toString()))));
  sock.send(DISCOVERY_QUERY, d.port, "127.0.0.1");
  assert.deepEqual(await reply, { address: "https://music.example.com", id: "abc", name: "Home" });
  sock.close();
  d.close();
});

test("discovery: without a public URL it uses this host's address on the asker's subnet", () => {
  const interfaces = {
    lo: [{ family: "IPv4", internal: true, address: "127.0.0.1", netmask: "255.0.0.0" }],
    eth0: [{ family: "IPv4", internal: false, address: "10.0.0.18", netmask: "255.255.255.0" }],
    docker0: [{ family: "IPv4", internal: false, address: "172.17.0.1", netmask: "255.255.0.0" }],
  };
  assert.equal(addressFor("10.0.0.50", { enginePort: 8484 }, interfaces), "http://10.0.0.18:8484");
  assert.equal(addressFor("192.168.9.9", { enginePort: 8484 }, interfaces), null);
});
