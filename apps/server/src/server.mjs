import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, sep } from "node:path";
import { WebSocketServer } from "ws";
import { Hub } from "./hub.mjs";
import { verifySubsonic } from "./auth.mjs";
import { isProxied, proxyToNavidrome } from "./proxy.mjs";
import { createBpmStore } from "./bpm.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};

/**
 * @param {{navidromeUrl:string, webRoot?:string, store:any, verify?:Function}} opts
 */
export function createApp({ navidromeUrl, webRoot, store, bpmStore = createBpmStore(), verify = verifySubsonic }) {
  const hub = new Hub(store);
  const authCache = new Map(); // "u|t|s" -> expiry; tokens stay valid, so re-verifying each call is wasted

  async function authed(req) {
    const m = /^Subsonic\s+(.+)$/.exec(req.headers.authorization ?? "");
    if (!m) return false;
    const p = new URLSearchParams(m[1]);
    const cred = { u: p.get("u"), t: p.get("t"), s: p.get("s") };
    const key = `${cred.u}|${cred.t}|${cred.s}`;
    if ((authCache.get(key) ?? 0) > Date.now()) return true;
    if (!(await verify(navidromeUrl, cred))) return false;
    authCache.set(key, Date.now() + 10 * 60 * 1000);
    if (authCache.size > 500) authCache.delete(authCache.keys().next().value);
    return true;
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

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (isProxied(url.pathname)) { proxyToNavidrome(navidromeUrl, req, res); return; }
    if (url.pathname === "/bpm" || url.pathname.startsWith("/bpm/")) { handleBpm(req, res, url).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); return; }
    if (url.pathname === "/healthz") { res.writeHead(200).end("ok"); return; }
    if (url.pathname === "/config.json") {
      // The web UI reads this to learn which Subsonic server to talk to.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ navidromeUrl, sync: "/sync" }));
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
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
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
