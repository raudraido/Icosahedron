import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, extname, normalize, sep } from "node:path";
import { WebSocketServer } from "ws";
import { Hub } from "./hub.mjs";
import { verifySubsonic, isNavidromeAdmin, verifyPassword, navidromeTrustsEngine } from "./auth.mjs";
import { isProxied, proxyToNavidrome } from "./proxy.mjs";
import { createBpmStore } from "./bpm.mjs";
import { createLastFm } from "./lastfm.mjs";
import { createTour } from "./tour.mjs";
import { createQuickConnect } from "./quickconnect.mjs";
import { createAvatarStore, imageType, AVATAR_MAX_BYTES } from "./avatar.mjs";
import { createDevices } from "./devices.mjs";
import { createApprovals, createLimiter } from "./approvals.mjs";
import { createInvites } from "./invites.mjs";

// The engine's own version (apps/server/package.json; the web app it serves is the same product) and
// the sync protocol it speaks: the apps check compatibility by protocol, not by version number.
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export const PROTOCOL = 2;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};

/**
 * @param {{navidromeUrl:string, webRoot?:string, store:any, verify?:Function}} opts
 */
/** The secure sign-in switch (docs/secure-sign-in.md): off means the apps sign in with the Navidrome password as always. */
export function createSecureSwitch({ enabled = false, onChange } = {}) {
  let on = !!enabled;
  return { get on() { return on; }, set(v) { on = !!v; onChange?.(on); } };
}

export function createApp({ navidromeUrl, webRoot, store, bpmStore = createBpmStore(), lastfm = createLastFm({}), verify = verifySubsonic, isAdmin = isNavidromeAdmin, quickConnect = createQuickConnect(), avatars = createAvatarStore(), tour = createTour(), secureSwitch = createSecureSwitch(), devices = createDevices({}), approvals = createApprovals(), invites = createInvites({}), checkPassword = verifyPassword, checkTrusted = navidromeTrustsEngine }) {
  const hub = new Hub(store);
  const authCache = new Map(); // "u|t|s" -> expiry; tokens stay valid, so re-verifying each call is wasted

  /** The verified {u,t,s} of the request's Subsonic Authorization header, or null. */
  async function authedCred(req) {
    const m = /^Subsonic\s+(.+)$/.exec(req.headers.authorization ?? "");
    if (!m) return null;
    const p = new URLSearchParams(m[1]);
    const cred = { u: p.get("u"), t: p.get("t"), s: p.get("s") };
    if (secureSwitch.on) return resolveCred(cred, clientAddress(req)); // never cached: a removed device is out at once
    const key = `${cred.u}|${cred.t}|${cred.s}`;
    if ((authCache.get(key) ?? 0) > Date.now()) return cred;
    if (!(await verify(navidromeUrl, cred))) return null;
    authCache.set(key, Date.now() + 10 * 60 * 1000);
    if (authCache.size > 500) authCache.delete(authCache.keys().next().value);
    return cred;
  }

  /** A client's address. Behind the reverse proxy the first X-Forwarded-For entry is the visitor. */
  const clientAddress = (req) => String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "";

  /**
   * The checked credential: with secure sign-in on, a trusted device's secret (the account name then
   * is the one the device was made for); off, the Navidrome token as before. null when not valid.
   */
  async function resolveCred(cred, address = "") {
    if (!cred?.u || !cred.t || !cred.s) return null;
    if (secureSwitch.on) {
      const r = devices.resolve(cred);
      if (!r) return null;
      devices.touch(r.device, address);
      return { ...cred, u: r.user, device: r.device };
    }
    return (await verify(navidromeUrl, cred)) ? cred : null;
  }

  /** Subsonic credentials of a proxied call: the Authorization header, or the u, t and s parameters. */
  function credFromRequest(req, url) {
    const m = /^Subsonic\s+(.+)$/.exec(req.headers.authorization ?? "");
    const p = m ? new URLSearchParams(m[1]) : url.searchParams;
    const u = p.get("u"), t = p.get("t"), s = p.get("s");
    return u && t && s ? { u, t, s } : null;
  }
  const authed = async (req) => (await authedCred(req))?.u ?? null;

  const adminCache = new Map(); // "u|t|s" -> {at, admin}: roles rarely change, so ask Navidrome once in a while
  async function isAdminCred(cred) {
    const key = `${cred.u}|${cred.t}|${cred.s}`;
    const hit = adminCache.get(key);
    if (hit && hit.at > Date.now() - 5 * 60 * 1000) return hit.admin;
    const admin = await isAdmin(navidromeUrl, secureSwitch.on ? { u: cred.u, remoteUser: true } : cred);
    adminCache.set(key, { at: Date.now(), admin });
    if (adminCache.size > 200) adminCache.delete(adminCache.keys().next().value);
    return admin;
  }

  async function readJson(req, limit = 16 * 1024) {
    let body = "";
    for await (const c of req) { body += c; if (body.length > limit) throw Object.assign(new Error("too large"), { code: 413 }); }
    try { return body ? JSON.parse(body) : {}; } catch { throw Object.assign(new Error("bad json"), { code: 400 }); }
  }

  async function handleLastfm(req, res, url) {
    const user = await authed(req);
    if (!user) { res.writeHead(401).end(); return; }
    const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const route = url.pathname.slice("/lastfm".length);
    const m = req.method;
    if (route === "/config" && m === "GET") return json(200, { configured: lastfm.configured, apiKey: lastfm.configured ? lastfm.apiKey : "" });
    if (!lastfm.configured) { res.writeHead(503).end(); return; }
    try {
      if (route === "/connection" && m === "GET") return json(200, lastfm.connection(user));
      if (route === "/connection" && m === "PUT") {
        const b = await readJson(req);
        if (typeof b.sessionKey !== "string" || !/^[\w-]{8,64}$/.test(b.sessionKey)) { res.writeHead(400).end(); return; }
        return json(200, await lastfm.importSession(user, b));
      }
      if (route === "/connection" && m === "DELETE") { lastfm.disconnect(user); res.writeHead(204).end(); return; }
      if (route === "/token" && m === "POST") return json(200, await lastfm.startAuth());
      if (route === "/session" && m === "POST") {
        const b = await readJson(req);
        if (typeof b.token !== "string" || !b.token) { res.writeHead(400).end(); return; }
        return json(200, await lastfm.finishAuth(user, b.token));
      }
      if (route === "/toggles" && m === "PUT") { lastfm.setToggles(user, await readJson(req)); res.writeHead(204).end(); return; }
      if (route === "/nowplaying" && m === "POST") { await lastfm.nowPlaying(user, (await readJson(req)).track ?? {}); res.writeHead(204).end(); return; }
      if (route === "/scrobble" && m === "POST") {
        const b = await readJson(req);
        await lastfm.scrobble(user, b.track ?? {}, b.timestamp);
        res.writeHead(204).end(); return;
      }
      res.writeHead(404).end();
    } catch (e) {
      if (e.code === 413 || e.code === 400) { res.writeHead(e.code).end(); return; }
      json(502, { error: String(e.message ?? e) });
    }
  }

  // Quick Connect (docs/quick-connect.md): a device without a sign-in shows a six-digit code, a
  // signed-in app authorizes it, the device claims the sign-in.
  async function handleQuickConnect(req, res, url) {
    const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const route = url.pathname.slice("/quickconnect".length);
    const m = req.method;
    if (route === "/enabled" && m === "GET") return json(200, quickConnect.enabled);
    // The switch: anyone signed in sees the state, only an administrator changes it (and not when the environment decides).
    if (route === "/settings") {
      const cred = await authedCred(req);
      if (!cred) return json(401, { error: "Sign in first" });
      const admin = await isAdminCred(cred);
      if (m === "GET") return json(200, { enabled: quickConnect.enabled, canChange: admin && !quickConnect.locked, source: quickConnect.locked ? "env" : "setting" });
      if (m === "PUT") {
        if (!admin) return json(403, { error: "Only an administrator can change this" });
        if (quickConnect.locked) return json(409, { error: "Set by the server's environment (QUICK_CONNECT)" });
        const b = await readJson(req);
        quickConnect.setEnabled(b.enabled === true);
        return json(200, { enabled: quickConnect.enabled });
      }
      res.writeHead(405).end();
      return;
    }
    if (!quickConnect.enabled) return json(403, { error: "Quick Connect is disabled on this server" });
    try {
      if (route === "/initiate" && m === "POST") {
        const address = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "";
        const r = quickConnect.initiate(await readJson(req), address);
        if (r.error === "rate") return json(429, { error: "Too many requests" });
        if (r.error) return json(503, { error: "Busy" });
        return json(200, r);
      }
      if (route === "/connect" && m === "GET") {
        const st = quickConnect.status(url.searchParams.get("secret") ?? "");
        return st ? json(200, st) : json(404, { error: "Unknown secret" });
      }
      if (route === "/authorize" && m === "POST") {
        const cred = await authedCred(req);
        if (!cred) return json(401, { error: "Sign in first" });
        const b = await readJson(req);
        const r = quickConnect.authorize(String(b.code ?? ""), cred);
        if (r === "ok") return json(200, { authorized: true });
        if (r === "rate") return json(429, { error: "Too many wrong codes" });
        if (r === "already") return json(409, { error: "Already authorized" });
        return json(404, { error: "Unknown code" });
      }
      if (route === "/claim" && m === "POST") {
        const b = await readJson(req);
        const full = quickConnect.claimFull(String(b.secret ?? ""));
        if (!full) return json(404, { error: "Not authorized (yet)" });
        if (secureSwitch.on) {
          // The device gets a sign-in of its own, not the one of the app that approved it.
          const made = devices.create(full.auth.u, full.device, { address: clientAddress(req) });
          devices.log({ user: full.auth.u, device: full.device?.name, kind: full.device?.kind, address: clientAddress(req), result: "quick-connect" });
          return json(200, made.cred);
        }
        return json(200, full.auth);
      }
      res.writeHead(404).end();
    } catch (e) {
      if (e.code === 413 || e.code === 400) { res.writeHead(e.code).end(); return; }
      json(500, { error: "failed" });
    }
  }

  // Secure sign-in (docs/secure-sign-in.md): trusted devices, sign-in approval, recovery.
  const FIFTEEN_MIN = 15 * 60 * 1000;
  async function handleDevice(req, res, url) {
    const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const route = url.pathname.slice("/device".length);
    const m = req.method;
    const addr = clientAddress(req);
    const deviceInfo = (b) => ({ name: b?.device?.name, kind: b?.device?.kind, app: b?.device?.app, version: b?.device?.version });
    const note = (user, d, result) => devices.log({ user, device: d?.name, kind: d?.kind, address: addr, result });
    try {
      if (route === "/info" && m === "GET") return json(200, { secure: secureSwitch.on });

      // --- without a trusted device: asking to be let in, and the two ways around a missing device
      if ((route === "/request" || route === "/recover" || route === "/redeem") && m === "POST") {
        if (!secureSwitch.on) return json(409, { error: "not_required" });
        const b = await readJson(req);
        const user = String(b.user ?? "").trim();
        const password = String(b.password ?? "");
        if (!user || !password) return json(400, { error: "User name and password needed" });
        if (!limiter.hit("a:" + addr, 15, FIFTEEN_MIN) || !limiter.hit("u:" + user.toLowerCase(), 30, FIFTEEN_MIN)) return json(429, { error: "Too many attempts, wait a while" });
        const info = deviceInfo(b);
        if (!(await checkPassword(navidromeUrl, user, password))) { note(user, info, "wrong-password"); return json(401, { error: "Wrong user name or password" }); }
        const name = devices.canonical(user);
        if (route === "/request") {
          if (!devices.has(name)) return json(409, { error: "no_trusted_device" });
          const r = approvals.request(name, info, addr);
          if (r.error) return json(429, { error: "Too many sign-in requests are open" });
          note(name, info, "requested");
          hub.notify(name, { type: "approval", request: approvals.pending(name).find((x) => x.id === r.id) });
          return json(200, { id: r.id, secret: r.pollSecret, number: r.number, expiresIn: r.expiresIn });
        }
        const ok = route === "/recover" ? devices.useRecovery(name, b.code) : invites.consume(name, b.code);
        if (!ok) { note(name, info, route === "/recover" ? "wrong-recovery-code" : "wrong-invite-code"); return json(401, { error: "That code is not valid" }); }
        const made = devices.create(name, info, { address: addr });
        note(name, info, route === "/recover" ? "recovery-code" : "invite");
        const out = { deviceId: made.device.id, secret: made.secret, cred: made.cred };
        if (!devices.hasRecoveryCodes(name)) out.recoveryCodes = devices.newRecoveryCodes(name);
        return json(200, out);
      }
      if (route === "/poll" && m === "GET") {
        const r = approvals.poll(url.searchParams.get("id") ?? "", url.searchParams.get("secret") ?? "");
        return r ? json(200, r) : json(404, { error: "Unknown request" });
      }

      // --- everything else needs a signed-in device (or, to switch it on, the Navidrome sign-in)
      const cred = await authedCred(req);
      if (!cred) return json(401, { error: "Sign in first" });
      if (route === "/secure" && m === "PUT") {
        const b = await readJson(req);
        if (!(await isAdminCred(cred))) return json(403, { error: "Only an administrator can change this" });
        if (b.enabled === true) {
          if (secureSwitch.on) return json(409, { error: "Already on" });
          // Without this Navidrome would not know who the engine speaks for, and every app would be locked out.
          if (!(await checkTrusted(navidromeUrl, cred.u))) return json(412, { error: "navidrome_does_not_trust_engine" });
          const info = deviceInfo(b);
          const made = devices.create(cred.u, info, { address: addr }); // the device that switches it on is the first trusted one
          const recoveryCodes = devices.newRecoveryCodes(cred.u);
          secureSwitch.set(true); authCache.clear(); adminCache.clear();
          note(cred.u, info, "secure-on");
          return json(200, { enabled: true, deviceId: made.device.id, secret: made.secret, cred: made.cred, recoveryCodes });
        }
        if (b.enabled === false) {
          if (!secureSwitch.on) return json(409, { error: "Already off" });
          secureSwitch.set(false); authCache.clear(); adminCache.clear();
          note(cred.u, cred.device, "secure-off");
          return json(200, { enabled: false });
        }
        return json(400, { error: "enabled: true or false" });
      }
      if (!secureSwitch.on) return json(409, { error: "Secure sign-in is off" });
      if (route === "/pending" && m === "GET") return json(200, approvals.pending(cred.u));
      if (route === "/decide" && m === "POST") {
        const b = await readJson(req);
        const id = String(b.id ?? "");
        const asked = approvals.get(id);
        const result = approvals.decide(cred.u, id, b.approve === true, b.number);
        if (result === "approved" && asked) {
          const made = devices.create(cred.u, asked.device, { address: asked.address });
          approvals.complete(id, { deviceId: made.device.id, secret: made.secret, cred: made.cred });
          devices.log({ user: cred.u, device: asked.device.name, kind: asked.device.kind, address: asked.address, result: "approved" });
        } else if (asked && (result === "denied" || result === "wrong")) {
          devices.log({ user: cred.u, device: asked.device.name, kind: asked.device.kind, address: asked.address, result: result === "wrong" ? "wrong-number" : "denied" });
        }
        if (result !== "unknown") hub.notify(cred.u, { type: "approval_done", id });
        return json(result === "unknown" ? 404 : 200, { result });
      }
      if (route === "/list" && m === "GET") return json(200, { devices: devices.list(cred.u), current: cred.device?.id ?? null });
      if (route === "/history" && m === "GET") return json(200, devices.history(cred.u));
      if (route === "/app-password" && m === "POST") {
        const b = await readJson(req);
        const made = devices.create(cred.u, { name: b.name || "App password", kind: "app" }, { appPassword: true, address: addr });
        note(cred.u, made.device, "app-password");
        return json(200, { id: made.device.id, user: cred.u, secret: made.secret });
      }
      if (route === "/recovery-codes" && m === "POST") {
        note(cred.u, cred.device, "new-recovery-codes");
        return json(200, { recoveryCodes: devices.newRecoveryCodes(cred.u) });
      }
      if (route === "/invite" && m === "POST") {
        if (!(await isAdminCred(cred))) return json(403, { error: "Only an administrator can invite" });
        const b = await readJson(req);
        if (!String(b.user ?? "").trim()) return json(400, { error: "user needed" });
        return json(200, { code: invites.create(String(b.user).trim()) });
      }
      if (m === "DELETE" && route.startsWith("/") && route.length > 1) {
        const ok = devices.remove(cred.u, route.slice(1));
        if (ok) note(cred.u, cred.device, "removed-device");
        res.writeHead(ok ? 204 : 404).end();
        return;
      }
      res.writeHead(404).end();
    } catch (e) {
      if (e.code === 413 || e.code === 400) { res.writeHead(e.code).end(); return; }
      json(500, { error: "failed" });
    }
  }

  const limiter = createLimiter();

  async function handleBpm(req, res, url) {
    if (!(await authed(req))) { res.writeHead(401).end(); return; }
    const id = decodeURIComponent(url.pathname.slice("/bpm".length).replace(/^\//, ""));
    const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && !id) return json(200, bpmStore.all());
    if (req.method === "GET") { const b = bpmStore.get(id); return b === undefined ? json(404, {}) : json(200, { bpm: b }); }
    if (req.method === "PUT" && id) {
      let body = "";
      for await (const c of req) { body += c; if (body.length > 1024) { res.writeHead(413).end(); return; } }
      let j; try { j = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      if (!bpmStore.set(id, j?.bpm, j?.manual)) { res.writeHead(422).end(); return; }
      res.writeHead(204).end(); return;
    }
    if (req.method === "POST" && !id) { // bulk upload of detected values, e.g. a desktop's existing local cache
      let body = "";
      for await (const c of req) { body += c; if (body.length > 4 * 1024 * 1024) { res.writeHead(413).end(); return; } }
      let j; try { j = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      let stored = 0;
      if (j && typeof j === "object") for (const [k, v] of Object.entries(j)) if (bpmStore.set(k, v, false)) stored++;
      return json(200, { stored });
    }
    res.writeHead(405).end();
  }

  // The profile picture of the signed-in user (GET it, PUT a new one as the raw image, DELETE it).
  // Any signed-in user may also GET another user's picture: /avatar/<user name>.
  async function handleAvatar(req, res, url) {
    const me = await authed(req);
    if (!me) { res.writeHead(401).end(); return; }
    let user = me;
    const other = url.pathname.slice("/avatar".length).replace(/^\//, "");
    if (other) {
      if (req.method !== "GET") { res.writeHead(405).end(); return; }
      try { user = decodeURIComponent(other); } catch { res.writeHead(400).end(); return; }
    }
    if (req.method === "GET") {
      const a = avatars.get(user);
      if (!a) { res.writeHead(404).end(); return; }
      if (req.headers["if-none-match"] === a.etag) { res.writeHead(304).end(); return; }
      res.writeHead(200, { "content-type": a.type, etag: a.etag, "cache-control": "private, no-cache" });
      res.end(a.buf);
      return;
    }
    if (req.method === "PUT") {
      const chunks = [];
      let n = 0;
      for await (const c of req) { n += c.length; if (n > AVATAR_MAX_BYTES) { res.writeHead(413).end(); return; } chunks.push(c); }
      const buf = Buffer.concat(chunks);
      if (!imageType(buf)) { res.writeHead(415).end(); return; }
      avatars.set(user, buf);
      res.writeHead(204).end();
      return;
    }
    if (req.method === "DELETE") { avatars.delete(user); res.writeHead(204).end(); return; }
    res.writeHead(405).end();
  }

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (isProxied(url.pathname)) {
      // /share/ is public by nature. With secure sign-in on, everything else needs a trusted device, and
      // Navidrome is asked as that account through its trusted header, never with a password.
      if (url.pathname.startsWith("/share/") || !secureSwitch.on) { proxyToNavidrome(navidromeUrl, req, res); return; }
      if (url.pathname.startsWith("/auth/")) { res.writeHead(403).end(); return; } // the password login is not for the internet
      const cred = credFromRequest(req, url);
      resolveCred(cred, clientAddress(req)).then((r) => {
        if (!r) { res.writeHead(401).end(); return; }
        proxyToNavidrome(navidromeUrl, req, res, { user: r.u });
      }).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
      return;
    }
    if (url.pathname.startsWith("/device/")) { handleDevice(req, res, url).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); return; }
    if (url.pathname === "/bpm" || url.pathname.startsWith("/bpm/")) { handleBpm(req, res, url).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); return; }
    if (url.pathname.startsWith("/quickconnect/")) { handleQuickConnect(req, res, url).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); return; }
    if (url.pathname.startsWith("/lastfm/")) { handleLastfm(req, res, url).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); return; }
    if (url.pathname === "/avatar" || url.pathname.startsWith("/avatar/")) { handleAvatar(req, res, url).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); return; }
    if (url.pathname === "/tour") {
      (async () => {
        if (!(await authed(req))) { res.writeHead(401).end(); return; }
        const events = await tour.events(url.searchParams.get("artist") ?? "").catch(() => []);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(events));
      })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
      return;
    }
    if (url.pathname === "/healthz") { res.writeHead(200).end("ok"); return; }
    if (url.pathname === "/config.json") {
      // The web UI reads this to learn which Subsonic server to talk to.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ navidromeUrl, sync: "/sync", version: VERSION, protocol: PROTOCOL, secure: secureSwitch.on }));
      return;
    }
    if (!webRoot) { res.writeHead(404).end("web UI not bundled"); return; }
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    let file = join(webRoot, rel);
    if (!file.startsWith(webRoot + sep) && file !== webRoot) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(webRoot, "index.html"); // SPA fallback
    }
    try {
      const body = await readFile(file);
      // Hashed bundles never change; the shell and the service worker must always be revalidated.
      const cache = rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": cache });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });

  const wss = new WebSocketServer({ server: http, path: "/sync", maxPayload: 4 * 1024 * 1024 });
  wss.on("connection", (ws, wsReq) => {
    let session = null;
    const conn = { send: (o) => ws.readyState === 1 && ws.send(JSON.stringify(o)), close: () => ws.close() };
    // Must authenticate within 10 s.
    const timer = setTimeout(() => ws.close(4001, "hello timeout"), 10000);
    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!session) {
        if (msg?.type !== "hello") return ws.close(4002, "hello expected");
        clearTimeout(timer);
        session = "pending";
        const checked = await resolveCred(msg.auth, clientAddress(wsReq));
        if (!checked) return ws.close(4003, "auth failed");
        try { session = hub.join(checked.u, msg.device ?? {}, conn); }
        catch { return ws.close(4004, "bad device"); }
        return;
      }
      if (session !== "pending") session.message(msg);
    });
    ws.on("close", () => { clearTimeout(timer); if (session && session !== "pending") session.leave(); });
    ws.on("error", () => ws.close());
  });

  return {
    http, hub,
    close: () => { bpmStore.flush(); for (const c of wss.clients) c.terminate(); wss.close(); http.close(); http.closeAllConnections?.(); },
  };
}
