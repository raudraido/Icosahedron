# Server changelog

The server is the **sync engine and the web app it serves** (one Docker image, `ghcr.io/raudraido/icosahedron-server`). Versions before 0.16.0 shared one number with the other apps (0.15.3 to 0.15.9); the full text of those releases is in the [main changelog](../../CHANGELOG.md). What each version needs and gives: [docs/compatibility.md](../../docs/compatibility.md).

## 0.16.9

- **Web sign-in says which server it is.** The page shows "Sign in to music.example.com" and the server version, and no longer offers "or connect to a new server" or a list of saved servers: the web app belongs to the server it is opened from.

## 0.16.8

- **On Tour in the artist info works again, and now in the web app too.** Bandsintown stopped giving concert lists to public apps (every artist came back empty), so the engine now asks Ticketmaster and the web app gets the dates from the engine (`GET /tour?artist=`). Only concerts of the artist itself are listed, not tribute acts, and answers are kept for 6 hours. `TICKETMASTER_API_KEY` is not needed. Artists Ticketmaster has no dates for show nothing, as before.

## 0.16.7

- **Shift + click on a song no longer selects its text** in the browser (it ticks the range and nothing else gets highlighted). Text can still be selected and copied normally.

## 0.16.6

The web app plays with **one click** instead of a double-click. **Update with** `docker compose pull && docker compose up -d`, then reload the page (`Ctrl+Shift+R` if the browser keeps the old one). The desktop app still uses a double-click until this has been tried in the web app.

- **One click plays** in the queue (it jumps to that song), in playlists and albums, in Tracks and Favorites and in the artist's popular songs. A song played from a list goes right after the one that plays now, as the double-click did. A play icon shows on the cover when you point at a row.
- **Selecting several songs:** a tick box shows in front of a row when you point at it; once one is ticked every row shows its box, a box in the heading ticks or clears all, and a bar shows *N selected* with **Play**, **Play Next**, **Add to Queue**, **Add to Playlist** and **Clear selection**. `Esc` clears. `Shift` + click on a box ticks a range; `Ctrl`/`Cmd`/`Shift` + click on the row still selects without playing. The right-click menu acts on all ticked songs.
- **Reordering by dragging** a row in the queue and in a playlist works as before; letting go of a dragged row does not play it.

## 0.16.5

Small fixes to the web app. **Update with** `docker compose pull && docker compose up -d`, then reload the page (`Ctrl+Shift+R` if the browser keeps the old one).

- **Settings → System in the browser:** "Minimize to tray" and "Exit to tray" now say "Not available in the browser" instead of showing switches that do nothing (a browser has no system tray). The desktop app is unchanged.
- **The Cast button in the browser** is dimmed and says "Cast: not available in the browser" when you point at it, instead of opening a picker that can find nothing (a browser cannot find speakers and TVs; the desktop app does).
- **Settings → System → About → Updates in the browser** no longer says "You're up to date" with a Check Again button (the web app is part of the server and changes when the server is updated); it says "Not available in the browser (updates with the server)".

## 0.16.4

The discovery helper also announces the server with **mDNS**, so a TV on another network (a VLAN) can find it when the router forwards mDNS. **Update with** `docker compose pull && docker compose up -d` (both containers). Nothing to configure; `DISCOVERY_MDNS=false` switches it off.

- **mDNS / DNS-SD announcement** of the service `_icosahedron._tcp` (TXT: `address`, `id`, `name`) from the `discovery` container, next to the UDP 7360 answer. Firewalls (`ufw` by default) let mDNS through and routers can forward it between networks; a UDP broadcast can do neither.
- **Docs:** what to do when the apps do not find the server (host firewall, TV on another network, UniFi's Gateway mDNS Proxy). See [docs/quick-connect.md](../../docs/quick-connect.md#when-the-tv-is-on-another-network).

## 0.16.3

The web app gets profile pictures and user management. **Update with** `docker compose pull && docker compose up -d` (the web app is in the image; reload the page, `Ctrl+Shift+R` if the browser keeps the old one).

- **Profile picture in the web app.** A round button at the top right of the queue panel shows who is signed in (your picture, or the first letter of your name); click it to add, change or remove the picture, or open Settings. The picture is also in **Settings → System → Active Connection**.
- **Everyone can see everyone's picture.** `GET /avatar/<user name>` now answers for any signed-in user (changing or removing stays with the owner: `PUT` and `DELETE` on `/avatar`).
- **Settings → Users** (administrators): list the accounts with their pictures, add a user, reset a password, make someone an administrator or a plain user, delete a user. It uses Navidrome's own user API with the sign-in the app already has, so no password is asked.

## 0.16.2

Last.fm connects once for all your devices, and the server keeps your profile picture. **Update with** `docker compose pull && docker compose up -d`. Nothing to configure.

- **Last.fm works without any setup.** The server now uses the Icosahedron app's own Last.fm API account unless you set `LASTFM_API_KEY` / `LASTFM_API_SECRET` (those still win). Before, the phone said "Not set up on the server" until you registered your own key.
- **A device can hand its Last.fm connection to the server.** `PUT /lastfm/connection` takes a session key, checks it with Last.fm and stores it for the signed-in user; the desktop app uses it so that a connection made there appears on every other device. See [docs/deploy-server.md](../../docs/deploy-server.md#lastfm).
- **Profile picture.** `GET`, `PUT` (the raw image) and `DELETE` on `/avatar` keep one picture per user (JPEG, PNG or WebP, up to 512 kB) in the data directory. The iOS app uses it.

## 0.16.1

Quick Connect gets a switch and the compose file sets everything up together. **Update with** `docker compose pull && docker compose up -d` (the web app is in the image). Nothing changes for you until you want to use the new switch; if you set `QUICK_CONNECT` in the environment it keeps deciding.

- **Quick Connect switch.** A server administrator (a Navidrome admin account) switches Quick Connect on and off in **Settings → Sync Server → Quick Connect**; the choice is kept in `settings.json` in the data directory and switching off drops pending codes. `GET /quickconnect/settings` tells any signed-in app the state; `PUT` changes it (administrators only). `QUICK_CONNECT` in the environment still works and, when set, decides and locks the switch. See [docs/quick-connect.md](../../docs/quick-connect.md).
- **One compose file for everything.** [docker-compose.example.yml](docker-compose.example.yml) now sets up the engine (with the web app) and the LAN discovery helper together, both driven by one [.env](.env.example) (`NAVIDROME_URL`, `PUBLIC_URL`, `ENGINE_PORT`, `ENGINE_NAME`, Last.fm). See [docs/deploy-server.md](../../docs/deploy-server.md).

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
