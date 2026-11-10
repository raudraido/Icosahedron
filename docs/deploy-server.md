# Deploying the web engine

The engine is a single small container (Node 22). It serves the web app, keeps your devices in sync, proxies Navidrome, and stores BPM and Last.fm sessions. It is optional: see [architecture.md](architecture.md).

## Quick start

```yaml
# docker-compose.yml
services:
  icosahedron:
    image: ghcr.io/raudraido/icosahedron-server:latest
    restart: unless-stopped
    environment:
      NAVIDROME_URL: http://navidrome:4533
    volumes:
      - ./data:/data
    ports:
      - "8080:8080"
```

```bash
docker compose up -d
```

If Navidrome runs in another compose project, put both on the same Docker network (for example declare the network `external: true` here and use Navidrome's service name in `NAVIDROME_URL`). Open `http://<host>:8080` and sign in with your Navidrome account.

Images are published for `linux/amd64` and `linux/arm64`. `latest` is the newest release, `X.Y.Z` pins a version, `edge` follows the `master` branch.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `NAVIDROME_URL` | — (required) | Base URL of Navidrome, reachable **from the container** |
| `PORT` | `8080` | Listening port inside the container |
| `DATA_DIR` | `/data` | Where state is kept (mount a volume!) |
| `WEB_ROOT` | `/app/web` (image) | The web app's static files |
| `LASTFM_API_KEY`, `LASTFM_API_SECRET` | unset | Enable Last.fm (see below) |
| `QUICK_CONNECT` | off | `true` lets devices without a keyboard (a TV) sign in with a six-digit code, see [quick-connect.md](quick-connect.md) |

## Data

Everything is in `DATA_DIR`:

| File | Content |
|---|---|
| `<hash>.json` | One per user: play queue, position, active device, shared settings |
| `bpm.json` | BPM values (shared by all users) |
| `lastfm.json` | Last.fm session keys, mode `600` — **protect this volume** |

Back up the directory to keep these; losing it only resets sync state and BPM.

## Reverse proxy and TLS

Put a TLS reverse proxy in front for anything beyond your own network (phones, remote use, installing the web app as a PWA needs HTTPS). The proxy **must pass WebSocket upgrades** for `/sync`, otherwise the page loads but sync stays offline.

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

If the proxy puts a login page in front (SSO), exclude `/manifest.webmanifest`, `/sw.js` and `/icons/` or the web app cannot be installed; mobile apps and `/sync` also need to reach the engine without that login.

## LAN discovery

So a TV app can find the server by itself (and Quick Connect needs nothing typed), run the same image a second time **on the host network**; a Docker bridge network does not deliver the UDP broadcast the apps send. Add to the compose file:

```yaml
  discovery:
    image: ghcr.io/raudraido/icosahedron-server:latest
    command: ["node", "src/discovery.mjs"]
    network_mode: host
    restart: unless-stopped
    environment:
      PUBLIC_URL: https://music.example.com   # what the apps should use; without it the LAN address is answered
      ENGINE_PORT: "8080"                      # the published port of the engine (used without PUBLIC_URL)
      ENGINE_NAME: Home
```

It listens on UDP 7360 (Jellyfin uses 7359, so both can run). It is optional.

## Last.fm

The engine holds the Last.fm API secret and each user's session key, so one connection covers all devices and the secret never leaves the server.

1. Register an API account at last.fm/api and set `LASTFM_API_KEY` and `LASTFM_API_SECRET`.
2. In a client (web app settings, iOS settings) choose *Connect to Last.fm*, approve in the browser, finish.

The desktop app uses the engine's connection too once it has the engine's address (Devices button) and the engine holds a connection: connect once on any device. A desktop that already has its own local Last.fm session keeps using it until the engine has one; only one side scrobbles a play. Without an engine (or if it is unreachable) the desktop scrobbles on its own as before.

If Navidrome is also linked to Last.fm, a play can be counted twice.

## Security

- Sign-in is your Navidrome password; nothing else protects the engine. If it is reachable from the internet, use a strong password and consider rate-limiting `/auth/` and `/rest/ping` in the proxy.
- The engine never stores passwords. It does store play queues, settings and (if enabled) Last.fm session keys.
- `GET /config.json` and `/healthz` are public; they reveal only the Navidrome URL configured for the container.

## Updating

```bash
docker compose pull && docker compose up -d
```

## Building from source

```bash
git clone https://github.com/raudraido/Icosahedron
cd Icosahedron
docker build -f apps/server/Dockerfile -t icosahedron-server .   # context is the repo root
```

The image builds the web app (`vite.web.config.ts`) and bundles it with the engine.

## Health and troubleshooting

- `GET /healthz` → `ok`.
- Page loads but the devices button says offline: the proxy does not pass WebSocket upgrades.
- Last.fm answers `503`: the key/secret are not set.
- Sign-in fails: `NAVIDROME_URL` must be reachable from inside the container (`docker exec … wget -qO- $NAVIDROME_URL/rest/ping?...`).
