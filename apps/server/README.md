# Web engine

The optional server that keeps your devices in sync, proxies Navidrome, stores BPM and handles Last.fm, and serves the web app.

- Run it: [docs/deploy-server.md](../../docs/deploy-server.md)
- Protocol and HTTP API: [docs/sync-protocol.md](../../docs/sync-protocol.md)
- How it fits in: [docs/architecture.md](../../docs/architecture.md)

```bash
npm install
npm test
NAVIDROME_URL=http://localhost:4533 DATA_DIR=./data node src/index.mjs   # http://localhost:8080
```

| File | What |
|---|---|
| `src/index.mjs` | Entry, configuration from the environment |
| `src/server.mjs` | HTTP routes, static files, WebSocket upgrade |
| `src/hub.mjs` | Per-user sync hub (pure logic) |
| `src/proxy.mjs` | Same-origin Navidrome proxy |
| `src/auth.mjs` | Verifies Subsonic tokens against Navidrome |
| `src/bpm.mjs`, `src/lastfm.mjs`, `src/store.mjs` | BPM store, Last.fm, file persistence |
| `Dockerfile` | Multi-stage image: builds the web app from the repo root, bundles it with the engine (context = repo root) |

`docker-compose.example.yml` is a starting point.
