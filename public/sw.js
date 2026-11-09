// Service worker: makes the app installable and keeps the UI shell available
// offline. It never touches API/stream traffic — music, Subsonic calls, sync
// and the engine's own endpoints always go straight to the network.
const SHELL = "ico-shell-v1";
const NETWORK_ONLY = ["/rest/", "/api/", "/auth/", "/bpm", "/lastfm/", "/sync", "/config.json", "/healthz"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (NETWORK_ONLY.some((p) => url.pathname.startsWith(p))) return;

  if (req.mode === "navigate") {
    // Fresh page when online (so updates land), cached shell when offline.
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put("/", copy)); return res; })
        .catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }
  // Static assets (hashed bundles, fonts, icons): cache first, fill on miss.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
