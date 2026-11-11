import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, extname, normalize, sep } from "node:path";
import { WebSocketServer } from "ws";
import { Hub } from "./hub.mjs";
import { verifySubsonic, isNavidromeAdmin } from "./auth.mjs";
import { isProxied, proxyToNavidrome } from "./proxy.mjs";
import { createBpmStore } from "./bpm.mjs";
import { createLastFm } from "./lastfm.mjs";
import { createTour } from "./tour.mjs";
import { createQuickConnect } from "./quickconnect.mjs";
import { createAvatarStore, imageType, AVATAR_MAX_BYTES } from "./avatar.mjs";

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
export function createApp({ navidromeUrl, webRoot, store, bpmStore = createBpmStore(), lastfm = createLastFm({}), verify = verifySubsonic, isAdmin = isNavidromeAdmin, quickConnect = createQuickConnect(), avatars = createAvatarStore(), tour = createTour() }) {
  const hub = new Hub(store);
  const authCache = new Map(); // "u|t|s" -> expiry; tokens stay valid, so re-verifying each call is wasted

  /** The verified {u,t,s} of the request's Subsonic Authorization header, or null. */
  async function authedCred(req) {
    const m = /^Subsonic\s+(.+)$/.exec(req.headers.authorization ?? "");
    if (!m) return null;
    const p = new URLSearchParams(m[1]);
    const cred = { u: p.get("u"), t: p.get("t"), s: p.get("s") };
    const key = `${cred.u}|${cred.t}|${cred.s}`;
    if ((authCache.get(key) ?? 0) > Date.now()) return cred;
    if (!(await verify(navidromeUrl, cred))) return null;
    authCache.set(key, Date.now() + 10 * 60 * 1000);
    if (authCache.size > 500) authCache.delete(authCache.keys().next().value);
    return cred;
  }
  const authed = async (req) => (await authedCred(req))?.u ?? null;

  const adminCache = new Map(); // "u|t|s" -> {at, admin}: roles rarely change, so ask Navidrome once in a while
  async function isAdminCred(cred) {
    const key = `${cred.u}|${cred.t}|${cred.s}`;
    const hit = adminCache.get(key);
    if (hit && hit.at > Date.now() - 5 * 60 * 1000) return hit.admin;
    const admin = await isAdmin(navidromeUrl, cred);
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
        const auth = quickConnect.claim(String(b.secret ?? ""));
        return auth ? json(200, auth) : json(404, { error: "Not authorized (yet)" });
      }
      res.writeHead(404).end();
    } catch (e) {
      if (e.code === 413 || e.code === 400) { res.writeHead(e.code).end(); return; }
      json(500, { error: "failed" });
    }
  }

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
    if (isProxied(url.pathname)) { proxyToNavidrome(navidromeUrl, req, res); return; }
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
      res.end(JSON.stringify({ navidromeUrl, sync: "/sync", version: VERSION, protocol: PROTOCOL }));
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
  wss.on("connection", (ws) => {
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
        if (!(await verify(navidromeUrl, msg.auth))) return ws.close(4003, "auth failed");
        try { session = hub.join(msg.auth.u, msg.device ?? {}, conn); }
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
