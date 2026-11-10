# Server changelog

The server is the **sync engine and the web app it serves** (one Docker image, `ghcr.io/raudraido/icosahedron-server`). Versions before 0.16.0 shared one number with the other apps (0.15.3 to 0.15.9); the full text of those releases is in the [main changelog](../../CHANGELOG.md). What each version needs and gives: [docs/compatibility.md](../../docs/compatibility.md).

## 0.16.0

**What's new since the first engine (0.15.3).** The engine keeps your players in step, lets any of them control another, signs a TV in with a code and finds itself on your network. Update with `docker compose pull && docker compose up -d`; the web app is part of the image, so it updates too (reload the page, hard reload `Ctrl+Shift+R` if the browser keeps the old one).

### Sync hub (`/sync`)
- **Independent players.** Every player keeps its own playback state; the engine stores them per player and forwards each to the others, so music at home and in the car can play at once. A player that predates this (no `proto: 2` in its hello) follows one state only, the player that last started playing.
- **Remote control:** `play`, `pause`, `toggle`, `seek`, `next`, `prev`, `volume`, `load`, `enqueue` (`now`, `next` or `end`, up to 1000 tracks), `jump`, `remove`, `move` (reorder), `shuffle`, `repeat`; `transfer` moves a player's playback to another (`source`, `target`). Every player publishes its shuffle and repeat. Arguments are validated by the engine.
- **Registry of your players:** each player has a name the engine remembers (renamable), offline players stay in the list and are dropped after 90 days, a player can be forgotten (offline ones) and the stored playback state or shared preferences can be cleared. A player can connect for preference sync only (`playback:false`).
- **Shared preferences** (one blob per account, replaced whole; clients send back the keys they do not know) and the device kinds `electron`, `web`, `mobile` and **`tv`**.
- The devices list is the online players that take part in playback sync; the registry is a separate message, so older apps keep working.
- `GET /config.json` now tells the engine's `version` and the sync `protocol` (2).

### Quick Connect (new, opt-in)
Sign a TV or another device in with a six-digit code: `POST /quickconnect/initiate`, `GET /quickconnect/connect`, `POST /quickconnect/authorize` (a signed-in app), `POST /quickconnect/claim`. Off until `QUICK_CONNECT=true`; codes last 10 minutes and work once, requests are rate limited and held in memory. See [docs/quick-connect.md](../../docs/quick-connect.md).

### LAN discovery (new, optional)
`node src/discovery.mjs` answers the UDP broadcast `who is Icosahedron?` on port 7360 with `{address, id, name}` so apps (the Android TV app) can find the server without typing. Run it as a second container on the **host network**: [docs/deploy-server.md](../../docs/deploy-server.md#lan-discovery).

### Navidrome proxy, BPM, Last.fm
- Same-origin proxy for Navidrome (`/rest`, `/api`, `/auth`, Range requests supported), so the web app needs no CORS and no server address.
- BPM store (`/bpm`, bulk upload; the engine stores, players detect; a manual value always wins).
- Last.fm (`/lastfm/*`): the API secret and each account's session key stay on the engine (session file mode 600), so one connection covers every device (the desktop uses it too).

### Web app (served by the engine)
The same UI as the desktop app, installable as a PWA.
- Sign in with your Navidrome account; stays signed in; no server address to type.
- Playback with one audio element, Media Session (lock screen, notification, cover art), browser equalizer (not on iOS Safari), Last.fm, BPM, shared preferences.
- **Choose a device and control it** with the normal bar and queue panel (see the [desktop changelog](../../CHANGELOG.md) for the details), **Add to Device Queue**, the **Jukebox page** `/?player=1`, **Settings → Sync Server** (including Quick Connect).
- **A browser that blocks sound no longer pretends to play:** a tab that is told to play before anyone clicked in it shows "Your browser blocked playback on this device. Click to play".
- The version is shown in Settings → System → About (it is the server's version).
- Limits: no gapless between tracks; iOS Safari does not show title and cover on the lock screen for any web page (use the iOS app); the Now Playing tab and the phone layout show this device only.

### Configuration
`NAVIDROME_URL` (required), `PORT`, `DATA_DIR`, `LASTFM_API_KEY` and `LASTFM_API_SECRET`, `QUICK_CONNECT`, and for the discovery container `PUBLIC_URL`, `ENGINE_PORT`, `ENGINE_NAME`. Example: [docker-compose.example.yml](docker-compose.example.yml). 29 automated tests (`npm test`).

### Notes
- If the engine is exposed to the internet without a login proxy in front, the Navidrome password is the only protection; consider rate-limiting `/auth/` and `/rest/ping`.
- Quick Connect hands the device the approving account's salted token (valid on every device of that account; changing the password signs them all out). Use an `https` address.

### Earlier versions (shared number)
0.15.3 first engine (sync, web app, BPM, Last.fm); 0.15.4 jukebox commands; 0.15.5 player registry and Sync Server settings; 0.15.6 independent players and `shuffle` / `repeat` / `move`; 0.15.7 nothing new in the engine; 0.15.8 web: the normal bar for another device, version shown; 0.15.9 web: blocked-sound prompt.
