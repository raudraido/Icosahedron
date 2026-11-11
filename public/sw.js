// Service worker: makes the app installable and keeps the UI shell available
// offline. It never touches API/stream traffic — music, Subsonic calls, sync
// and the engine's own endpoints always go straight to the network.
//
// Only the app's own static files are cached (the allow-list below). It used to cache every other GET
// "like an asset" unless it was on a block-list; /device/poll was not on it, so the first answer
// ("pending") was kept and a sign-in waiting for approval never saw the approval.
// v2: the name changes so that anything wrongly kept by v1 is dropped.
const SHELL = "ico-shell-v2";
const STATIC = ["/assets/", "/fonts/", "/icons/", "/img/", "/manifest.webmanifest"];

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
  if (req.mode === "navigate") {
    // Only the app itself: a share page (/share/…) is Navidrome's, and must not become the cached shell.
    if (url.pathname !== "/") return;
    // Fresh page when online (so updates land), cached shell when offline.
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put("/", copy)); return res; })
        .catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }
  // Everything that is not a static file of the app goes straight to the network.
  if (!STATIC.some((p) => url.pathname.startsWith(p))) return;
  // Static assets (hashed bundles, fonts, icons): cache first, fill on miss.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
