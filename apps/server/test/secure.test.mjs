import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { WebSocket } from "ws";
import { createApp, createSecureSwitch } from "../src/server.mjs";
import { memoryStore } from "../src/store.mjs";
import { createDevices } from "../src/devices.mjs";
import { createApprovals } from "../src/approvals.mjs";
import { createInvites } from "../src/invites.mjs";
import { createQuickConnect } from "../src/quickconnect.mjs";

const md5 = (s) => createHash("md5").update(s).digest("hex");
const verify = async (_url, a) => a?.t === "good"; // the Navidrome token of the old way
const isAdmin = async (_url, c) => c.u === "root";
const checkPassword = async (_url, u, p) => p === `pw-${u}`;
const ROOT = { authorization: "Subsonic u=root&t=good&s=abc" };
const asDevice = (cred) => ({ authorization: `Subsonic ${new URLSearchParams(cred)}` });
const credOf = (secret, u) => ({ u, t: md5(secret + "zz"), s: "zz" });

async function boot({ secure = false, trusted = true } = {}) {
  const seen = [];
  const up = createServer((req, res) => { seen.push({ url: req.url, headers: req.headers }); res.writeHead(200, { "content-type": "text/plain" }); res.end("ok"); });
  await new Promise((r) => up.listen(0, r));
  const app = createApp({
    navidromeUrl: `http://127.0.0.1:${up.address().port}`, store: memoryStore(), verify, isAdmin, checkPassword, checkTrusted: async () => trusted,
    secureSwitch: createSecureSwitch({ enabled: secure }), devices: createDevices({}), approvals: createApprovals(), invites: createInvites({}),
    quickConnect: createQuickConnect({ enabled: true }),
  });
  await new Promise((r) => app.http.listen(0, r));
  const base = `http://127.0.0.1:${app.http.address().port}`;
  const call = async (method, path, { body, headers } = {}) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: r.status, json, text };
  };
  const close = () => { app.close(); up.closeAllConnections(); up.close(); };
  return { app, call, seen, base, close };
}

/** Switches it on as root and returns what root's first trusted device gets. */
async function switchOn(call) {
  const r = await call("PUT", "/device/secure", { headers: ROOT, body: { enabled: true, device: { name: "Root PC", kind: "desktop" } } });
  assert.equal(r.status, 200);
  return r.json;
}

test("off: nothing changes, and a client can never send the trusted header", async () => {
  const { call, seen, close } = await boot();
  assert.equal((await call("GET", "/device/info")).json.secure, false);
  assert.equal((await call("POST", "/device/request", { body: { user: "a", password: "b" } })).status, 409);
  await call("GET", "/rest/ping?u=root&t=good&s=abc", { headers: { "remote-user": "someone-else" } });
  assert.equal(seen[0].headers["remote-user"], undefined);
  assert.equal(seen[0].url, "/rest/ping?u=root&t=good&s=abc"); // untouched
  close();
});

test("switching on: administrators only, the switching device is the first trusted one, codes are shown", async () => {
  const { call, close } = await boot();
  assert.equal((await call("PUT", "/device/secure", { headers: { authorization: "Subsonic u=alice&t=good&s=abc" }, body: { enabled: true } })).status, 403);
  assert.equal((await call("PUT", "/device/secure", { body: { enabled: true } })).status, 401);
  const on = await switchOn(call);
  assert.equal(on.recoveryCodes.length, 10);
  assert.equal(on.cred.u, "root");
  assert.equal((await call("GET", "/config.json")).json.secure, true);
  assert.equal((await call("PUT", "/device/secure", { headers: asDevice(on.cred), body: { enabled: true } })).status, 409);
  close();
});

test("it does not switch on while Navidrome does not trust the engine (nobody would get in)", async () => {
  const { call, close } = await boot({ trusted: false });
  const r = await call("PUT", "/device/secure", { headers: ROOT, body: { enabled: true } });
  assert.equal(r.status, 412);
  assert.equal(r.json.error, "navidrome_does_not_trust_engine");
  assert.equal((await call("GET", "/config.json")).json.secure, false);
  assert.equal((await call("GET", "/rest/ping?u=root&t=good&s=abc")).status, 200); // still the old way
  close();
});

test("on: only a trusted device gets through; Navidrome sees the trusted header and no credentials", async () => {
  const { call, seen, close } = await boot();
  const on = await switchOn(call);
  // the old Navidrome token and a plain password are not enough any more
  assert.equal((await call("GET", "/rest/ping?u=root&t=good&s=abc")).status, 401);
  assert.equal((await call("GET", "/rest/ping?u=root&p=whatever")).status, 401);
  assert.equal((await call("GET", "/rest/ping", { headers: { "remote-user": "root" } })).status, 401);
  assert.equal(seen.length, 0);
  // the device: any salt works, the credentials are removed, the account is named in the trusted header
  const q = new URLSearchParams({ ...credOf(on.secret, "root"), v: "1.16.1", id: "5" });
  assert.equal((await call("GET", `/rest/getSong?${q}`, { headers: { "remote-user": "evil" } })).status, 200);
  assert.equal(seen[0].headers["remote-user"], "root");
  assert.equal(seen[0].url, "/rest/getSong?v=1.16.1&id=5");
  // the header form works for native calls and loses its Authorization header
  assert.equal((await call("GET", "/api/user", { headers: asDevice(credOf(on.secret, "root")) })).status, 200);
  assert.equal(seen[1].headers["remote-user"], "root");
  assert.equal(seen[1].headers.authorization, undefined);
  // the password login is closed, share pages stay public (and never carry the header)
  assert.equal((await call("POST", "/auth/login", { body: { username: "root", password: "x" } })).status, 403);
  assert.equal((await call("GET", "/share/abc", { headers: { "remote-user": "evil" } })).status, 200);
  assert.equal(seen[2].headers["remote-user"], undefined);
  close();
});

test("a new device is approved by a trusted one: number match, once, history", async () => {
  const { call, close } = await boot();
  const on = await switchOn(call);
  const me = asDevice(on.cred);
  // wrong password, rate limited per address
  assert.equal((await call("POST", "/device/request", { body: { user: "root", password: "nope" } })).status, 401);
  const r = (await call("POST", "/device/request", { body: { user: "root", password: "pw-root", device: { name: "Chrome", kind: "web" } } })).json;
  assert.match(String(r.number), /^\d\d$/);
  assert.equal((await call("GET", `/device/poll?id=${r.id}&secret=${r.secret}`)).json.state, "pending");
  assert.equal((await call("GET", `/device/poll?id=${r.id}&secret=wrong`)).status, 404);
  const pending = (await call("GET", "/device/pending", { headers: me })).json;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].choices.length, 3);
  assert.ok(pending[0].choices.includes(r.number));
  assert.equal(pending[0].number, undefined);
  assert.equal((await call("POST", "/device/decide", { headers: me, body: { id: r.id, approve: true, number: r.number } })).status, 200);
  const got = (await call("GET", `/device/poll?id=${r.id}&secret=${r.secret}`)).json;
  assert.equal(got.state, "approved");
  assert.equal((await call("GET", "/rest/ping", { headers: asDevice(got.cred) })).status, 200);
  assert.equal((await call("GET", `/device/poll?id=${r.id}&secret=${r.secret}`)).json.state, "expired"); // the secret is handed over once
  const list = (await call("GET", "/device/list", { headers: me })).json;
  assert.deepEqual(list.devices.map((d) => d.name).sort(), ["Chrome", "Root PC"]);
  assert.equal(list.current, on.deviceId);
  assert.ok((await call("GET", "/device/history", { headers: me })).json.some((h) => h.result === "approved" && h.device === "Chrome"));
  close();
});

test("a wrong number denies the request; a denial too", async () => {
  const { call, close } = await boot();
  const on = await switchOn(call);
  const me = asDevice(on.cred);
  const r1 = (await call("POST", "/device/request", { body: { user: "root", password: "pw-root" } })).json;
  const wrong = (r1.number % 80) + 10 === r1.number ? 11 : (r1.number % 80) + 10;
  assert.equal((await call("POST", "/device/decide", { headers: me, body: { id: r1.id, approve: true, number: wrong } })).json.result, "wrong");
  assert.equal((await call("GET", `/device/poll?id=${r1.id}&secret=${r1.secret}`)).json.state, "denied");
  const r2 = (await call("POST", "/device/request", { body: { user: "root", password: "pw-root" } })).json;
  assert.equal((await call("POST", "/device/decide", { headers: me, body: { id: r2.id, approve: false } })).json.result, "denied");
  assert.equal((await call("GET", "/device/pending", { headers: me })).json.length, 0);
  close();
});

test("no trusted device yet: sign in with an invite or a recovery code", async () => {
  const { call, close } = await boot();
  const on = await switchOn(call);
  // bob has no device: asking cannot work, nobody could approve
  assert.equal((await call("POST", "/device/request", { body: { user: "bob", password: "pw-bob" } })).status, 409);
  // the administrator invites bob; the code works once, with bob's password
  assert.equal((await call("POST", "/device/invite", { headers: asDevice(credOf(on.secret, "root")), body: { user: "bob" } })).status, 200);
  const { code } = (await call("POST", "/device/invite", { headers: asDevice(on.cred), body: { user: "bob" } })).json;
  assert.equal((await call("POST", "/device/redeem", { body: { user: "bob", password: "pw-bob", code: "AAAA-BBBB-CCCC" } })).status, 401);
  assert.equal((await call("POST", "/device/redeem", { body: { user: "alice", password: "pw-alice", code } })).status, 401); // another user's code
  const first = await call("POST", "/device/redeem", { body: { user: "bob", password: "pw-bob", code: code.toLowerCase(), device: { name: "Bob phone" } } });
  assert.equal(first.status, 200);
  assert.equal(first.json.recoveryCodes.length, 10);
  assert.equal((await call("GET", "/rest/ping", { headers: asDevice(first.json.cred) })).status, 200);
  assert.equal((await call("POST", "/device/redeem", { body: { user: "bob", password: "pw-bob", code } })).status, 401); // once
  // a non-administrator cannot invite
  assert.equal((await call("POST", "/device/invite", { headers: asDevice(first.json.cred), body: { user: "x" } })).status, 403);
  // a recovery code makes a device without approval, once
  const rec = on.recoveryCodes[0];
  const viaCode = await call("POST", "/device/recover", { body: { user: "root", password: "pw-root", code: rec, device: { name: "Spare" } } });
  assert.equal(viaCode.status, 200);
  assert.equal((await call("POST", "/device/recover", { body: { user: "root", password: "pw-root", code: rec } })).status, 401);
  close();
});

test("removing a device ends its access at once; app passwords work like devices", async () => {
  const { call, close } = await boot();
  const on = await switchOn(call);
  const me = asDevice(on.cred);
  const app = (await call("POST", "/device/app-password", { headers: me, body: { name: "Symfonium" } })).json;
  const appCred = credOf(app.secret, "root");
  assert.equal((await call("GET", "/rest/ping", { headers: asDevice(appCred) })).status, 200);
  assert.equal((await call("DELETE", `/device/${app.id}`, { headers: me })).status, 204);
  assert.equal((await call("GET", "/rest/ping", { headers: asDevice(appCred) })).status, 401);
  assert.equal((await call("DELETE", "/device/nope", { headers: me })).status, 404);
  close();
});

test("asking for a sign-in is rate limited and never more than three at once", async () => {
  const { call, close } = await boot();
  await switchOn(call);
  for (let i = 0; i < 3; i++) assert.equal((await call("POST", "/device/request", { body: { user: "root", password: "pw-root" } })).status, 200);
  assert.equal((await call("POST", "/device/request", { body: { user: "root", password: "pw-root" } })).status, 429);
  close();
});

test("password guessing is cut off", async () => {
  const { call, close } = await boot();
  await switchOn(call);
  let last = 0;
  for (let i = 0; i < 20; i++) last = (await call("POST", "/device/request", { body: { user: "root", password: "guess" + i } })).status;
  assert.equal(last, 429);
  close();
});

test("quick connect gives the TV a sign-in of its own, not the approver's", async () => {
  const { call, close } = await boot();
  const on = await switchOn(call);
  const init = (await call("POST", "/quickconnect/initiate", { body: { name: "Living room TV", kind: "tv" } })).json;
  assert.equal((await call("POST", "/quickconnect/authorize", { headers: asDevice(on.cred), body: { code: init.code } })).status, 200);
  const tv = (await call("POST", "/quickconnect/claim", { body: { secret: init.secret } })).json;
  assert.equal(tv.u, "root");
  assert.notEqual(tv.t, on.cred.t);
  assert.equal((await call("GET", "/rest/ping", { headers: asDevice(tv) })).status, 200);
  const list = (await call("GET", "/device/list", { headers: asDevice(on.cred) })).json.devices;
  assert.ok(list.some((d) => d.name === "Living room TV" && d.kind === "tv"));
  close();
});

test("sync: a device connects, the old token does not; the approver hears about a request", async () => {
  const { call, base, close } = await boot();
  const on = await switchOn(call);
  const url = base.replace("http", "ws") + "/sync";
  const open = (auth) => new Promise((resolve) => {
    const ws = new WebSocket(url);
    const inbox = [];
    ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", auth, device: { deviceId: "d1", name: "pc", kind: "desktop" } })));
    ws.on("close", (code) => resolve({ closed: code }));
    setTimeout(() => resolve({ ws, inbox }), 400);
  });
  assert.equal((await open({ u: "root", t: "good", s: "abc" })).closed, 4003);
  const ok = await open(on.cred);
  assert.ok(ok.ws && ok.inbox.some((m) => m.type === "welcome"));
  const r = (await call("POST", "/device/request", { body: { user: "root", password: "pw-root", device: { name: "Chrome" } } })).json;
  await new Promise((res) => setTimeout(res, 200));
  const prompt = ok.inbox.find((m) => m.type === "approval");
  assert.equal(prompt.request.id, r.id);
  assert.equal(prompt.request.choices.length, 3);
  ok.ws.close();
  close();
});

test("devices are kept on disk and a device can be told from another by its secret", async () => {
  const { mkdtempSync, rmSync, statSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "dev-"));
  const a = createDevices({ dir });
  const made = a.create("Alice", { name: "Phone", kind: "ios" });
  assert.equal(statSync(join(dir, "devices.json")).mode & 0o777, 0o600);
  const b = createDevices({ dir }); // a restart
  assert.equal(b.resolve(made.cred)?.user, "Alice");
  assert.equal(b.resolve({ ...made.cred, u: "alice" })?.user, "Alice"); // Navidrome ignores the case of a name
  assert.equal(b.resolve({ ...made.cred, t: "0".repeat(32) }), null);
  assert.equal(b.resolve({ u: "alice", t: md5("nope" + "zz"), s: "zz" }), null);
  rmSync(dir, { recursive: true });
});
