import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

// Same-origin reverse proxy to Navidrome, so the browser UI needs no CORS and
// no mixed-content exceptions. Streams both ways and forwards Range headers
// (seeking in <audio>). Only the Subsonic/Navidrome API prefixes are exposed, and /share/ (Navidrome's
// public share pages: the page, its assets, the stream and the cover), so a share link made from the
// web app (whose address is the engine's) opens for people who have no account.
export const PROXY_PREFIXES = ["/rest/", "/api/", "/auth/", "/share/"];

const DROP_REQ = new Set(["host", "connection", "origin", "referer", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]);

export function isProxied(pathname) {
  return PROXY_PREFIXES.some((p) => pathname.startsWith(p));
}

// Navidrome takes the account from this header when the request comes from an address it was told to
// trust (ExtAuth.TrustedSources). A client must never be able to send it: it is always removed, and
// set only by the engine after it has checked the device itself (secure sign-in).
const USER_HEADER = "remote-user";
const AUTH_PARAMS = ["u", "t", "s", "p", "apiKey"];

/** @param {{user?: string|null}} [opts]  user: the account the engine has verified; forwarded as the trusted header */
export function proxyToNavidrome(baseUrl, req, res, opts = {}) {
  const target = new URL(req.url, baseUrl);
  if (opts.user) for (const k of AUTH_PARAMS) target.searchParams.delete(k);
  const base = new URL(baseUrl);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQ.has(k)) headers[k] = v;
  delete headers[USER_HEADER];
  if (opts.user) {
    headers[USER_HEADER] = opts.user;
    if (/^Subsonic\s/i.test(String(headers.authorization ?? ""))) delete headers.authorization;
  }
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
