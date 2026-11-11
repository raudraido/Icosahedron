# Deploying the web engine

The engine is a single small container (Node 22). It serves the web app, keeps your devices in sync, proxies Navidrome, and stores BPM and Last.fm sessions. It is optional: see [architecture.md](architecture.md).

## Quick start

The engine, the web app it serves and the LAN discovery helper are set up **together** by one compose file and one `.env`. Take [docker-compose.example.yml](../apps/server/docker-compose.example.yml) as `docker-compose.yml` and [.env.example](../apps/server/.env.example) as `.env`, set `NAVIDROME_URL` (and `PUBLIC_URL` if you have an address outside your LAN), then:

```bash
docker compose up -d
```

- **`icosahedron`**: the engine and the web app (one container, one image).
- **`discovery`**: answers the broadcast of apps looking for the server on the LAN; see [below](#lan-discovery). Delete it if you do not want it.

If Navidrome runs in another compose project, put both on the same Docker network (declare it `external: true` and use Navidrome's service name in `NAVIDROME_URL`). Open `http://<host>:8080` and sign in with your Navidrome account.

Images are published for `linux/amd64` and `linux/arm64`. `latest` is the newest release, `X.Y.Z` pins a version, `edge` follows the `master` branch.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `NAVIDROME_URL` | — (required) | Base URL of Navidrome, reachable **from the container** |
| `PORT` | `8080` | Listening port inside the container |
| `DATA_DIR` | `/data` | Where state is kept (mount a volume!) |
| `WEB_ROOT` | `/app/web` (image) | The web app's static files |
| `LASTFM_API_KEY`, `LASTFM_API_SECRET` | the Icosahedron app's own Last.fm account | Your own Last.fm API account instead (see below). Normally leave unset |
| `QUICK_CONNECT` | unset | Normally unset: a server administrator switches Quick Connect on and off in **Settings → Sync Server** (kept in `settings.json`). Setting `true` / `false` here decides instead and locks that switch. See [quick-connect.md](quick-connect.md) |

## Data

Everything is in `DATA_DIR`:

| File | Content |
|---|---|
| `<hash>.json` | One per user: play queue, position, active device, shared settings |
| `bpm.json` | BPM values (shared by all users) |
| `lastfm.json` | Last.fm session keys, mode `600` — **protect this volume** |
| `avatar-<hash>.bin` | A user's profile picture (set in the apps, up to 512 kB). Every signed-in user can look at anyone's (`GET /avatar/<user name>`), only the owner changes it |
| `settings.json` | Server-wide settings an administrator changes in the apps (Quick Connect on or off) |

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

So a TV app can find the server by itself (Quick Connect then needs nothing typed), the compose file runs the same image a second time, **on the host network**, as the `discovery` service: a Docker bridge network does not deliver the UDP broadcast the apps send. It listens on UDP 7360 (Jellyfin uses 7359, so both can run) and answers with `PUBLIC_URL` when that is set, else with the server's own address on the asker's subnet and `ENGINE_PORT`.

It also answers **mDNS / DNS-SD** (`_icosahedron._tcp`, switch it off with `DISCOVERY_MDNS=false`), which firewalls let through by default and routers can forward between networks. If the apps do not find the server:

- **Host firewall** blocks UDP 7360 (`ufw` has no rule for it): `sudo ufw allow 7360/udp`, optionally `from <your subnet>`. The broadcast of a device on another subnet than the rule's is dropped silently.
- **The TV is on another network** (VLAN, guest or IoT Wi-Fi): broadcasts do not cross; forward mDNS in the router (UniFi: Gateway mDNS Proxy, *Custom*, both networks, all services) or type the address once. See [quick-connect.md](quick-connect.md#when-the-tv-is-on-another-network).

Host networking works on Linux; on Docker Desktop (Mac, Windows) the service starts but cannot see your network, so type the address in the app. The service is optional.

## Last.fm

The engine holds the Last.fm API secret and each user's session key, so one connection covers all devices and the secret never leaves the server.

Nothing to set up: the engine uses the Icosahedron app's own Last.fm API account (the one the desktop app carries). Set `LASTFM_API_KEY` and `LASTFM_API_SECRET` (an API account from last.fm/api) only if you want your own; a session made with one key does not work with the other.

- **Connect once, anywhere:** in a client (web app settings, iOS settings) choose *Connect to Last.fm*, approve in the browser, finish.
- **Or from the desktop app:** a desktop that is already connected to Last.fm hands its session to the engine by itself once it has the engine's address (Devices button). Phone, web and TV then show "Connected as …" with nothing to approve. The engine checks the session with Last.fm first (`PUT /lastfm/connection`); with your own API key set, a desktop session is refused and stays local.
- Once the engine holds the connection it does all the scrobbling and the desktop stops; only one side scrobbles a play. Disconnecting in the desktop app disconnects the engine too. Without an engine (or if it is unreachable) the desktop scrobbles on its own as before.

If Navidrome is also linked to Last.fm, a play can be counted twice.

## Security

- Sign-in is your Navidrome password; nothing else protects the engine. If it is reachable from the internet, use a strong password and consider rate-limiting `/auth/` and `/rest/ping` in the proxy.
- The engine never stores passwords. It does store play queues, settings and (if enabled) Last.fm session keys.
- `GET /config.json` and `/healthz` are public; they reveal only the Navidrome URL configured for the container.

## Secure sign-in (optional)

Keeps a stolen or guessed password from being enough: with it on, a new device must be approved by a device that is already trusted ([secure-sign-in.md](secure-sign-in.md)). It is **off** until an administrator switches it on in the app, and nothing changes while it is off.

It needs Navidrome to take the account from a header the engine sends, which Navidrome does only for the addresses you list. Give Navidrome **only the engine's address** (never `0.0.0.0/0`) and keep Navidrome off the internet:

```yaml
  navidrome:
    environment:
      ND_REVERSEPROXYWHITELIST: 172.18.0.0/16   # the Docker network the engine is on; docker network inspect <name> shows it
    # no "ports:" for the internet: only the engine talks to Navidrome
```

The engine tries this before it switches on and refuses (`navidrome_does_not_trust_engine`) when Navidrome does not accept it, so you cannot lock yourself out by a missing setting. If you ever are locked out anyway, run on the server `docker compose exec icosahedron node src/devices-cli.mjs secure off`, then `docker compose restart icosahedron`. `node src/devices-cli.mjs invite <user>` prints a one-use code for a user's first device.

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
- Last.fm answers `503`: an old server (before 0.16.2) without `LASTFM_API_KEY`/`LASTFM_API_SECRET`; update it.
- Sign-in fails: `NAVIDROME_URL` must be reachable from inside the container (`docker exec … wget -qO- $NAVIDROME_URL/rest/ping?...`).
