import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

// Same-origin reverse proxy to Navidrome, so the browser UI needs no CORS and
// no mixed-content exceptions. Streams both ways and forwards Range headers
// (seeking in <audio>). Only the Subsonic/Navidrome API prefixes are exposed.
export const PROXY_PREFIXES = ["/rest/", "/api/", "/auth/"];

const DROP_REQ = new Set(["host", "connection", "origin", "referer", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]);

export function isProxied(pathname) {
  return PROXY_PREFIXES.some((p) => pathname.startsWith(p));
}

export function proxyToNavidrome(baseUrl, req, res) {
  const target = new URL(req.url, baseUrl);
  const base = new URL(baseUrl);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQ.has(k)) headers[k] = v;
  headers.host = base.host;
  const doRequest = base.protocol === "https:" ? httpsRequest : httpRequest;
  const up = doRequest(
    { protocol: base.protocol, hostname: base.hostname, port: base.port, method: req.method,
      path: target.pathname + target.search, headers },
    (ures) => {
      res.writeHead(ures.statusCode ?? 502, ures.headers);
      ures.pipe(res);
    },
  );
  up.setTimeout(30000, () => up.destroy(new Error("upstream timeout")));
  up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  res.on("close", () => up.destroy());
  req.pipe(up);
}
