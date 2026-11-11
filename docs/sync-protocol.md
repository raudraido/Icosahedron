# Sync protocol and engine HTTP API

Everything below is implemented in `apps/server/src/` (`hub.mjs`, `server.mjs`, `bpm.mjs`, `lastfm.mjs`) and covered by `apps/server/test/`.

## Authentication

HTTP requests carry the Subsonic credentials in a header; WebSocket clients send them in the first message.

```
Authorization: Subsonic u=<user>&t=<md5(password+salt)>&s=<salt>
```

The values are URL-encoded. The engine verifies them against Navidrome (`ping`).

## WebSocket `/sync`

JSON text frames, one object each. Max frame 4 MB.

### Connecting

The first message must be `hello` within 10 seconds:

```json
{ "type": "hello",
  "auth":   { "u": "alice", "t": "…", "s": "…" },
  "device": { "deviceId": "uuid", "name": "Alice's iPhone", "kind": "mobile" } }
```

`kind` is `electron`, `web`, `mobile` or `tv`. A second connection with the same `deviceId` replaces the first.

`device.name` only names the player the **first** time it connects; afterwards the engine's [registry](#registered-players) decides. `device.playback: false` connects the player for preference sync only: it is not listed for remote control, receives no `state` or `devices` messages and its `state`, `command` and `transfer` messages are ignored.

Close codes: `4001` no hello in time, `4002` first message was not `hello`, `4003` authentication failed, `4004` bad device.

### Server → client

| Message | Meaning |
|---|---|
| `{type:"welcome", deviceId, name, devices, state, activeDeviceId, settings, states?}` | Sent after a successful hello: this player's name, the user's online players, the stored playback state, the active player and the settings blob (`null` if none yet). `state` and `activeDeviceId` are `null` for a player with `playback:false` |
| `{type:"devices", devices, activeDeviceId}` | The set of devices or the active one changed |
| `{type:"state", from, state}` | A player published its state (an older player only gets the active player's) |
| `{type:"command", from, cmd, args}` | Another device asks this one to do something |
| `{type:"settings", from, settings}` | Another device changed the shared settings |
| `{type:"registry", devices}` | The registered players, see below. Sent after `welcome` and whenever a player joins, leaves, is renamed or forgotten |
| `{type:"renamed", name}` | This player was renamed |
| `{type:"approval", request}` | Secure sign-in on: a new device asks to be let in. `request` = `{id, device:{name,kind,app,version}, address, at, expiresAt, choices:[3 numbers]}`; answer with `POST /device/decide` (see [secure-sign-in.md](secure-sign-in.md)) |
| `{type:"approval_done", id}` | That request was answered (approved, denied or wrong number); remove the prompt |
| `{type:"cleared", state, settings}` | Someone wiped the stored playback state and/or settings |
| `{type:"error", message}` | A request was refused |

### Client → server

| Message | Meaning |
|---|---|
| `{type:"state", state}` | Publish this device's playback state |
| `{type:"command", target, cmd, args?}` | Remote-control the device `target` |
| `{type:"transfer", source?, target}` | Move `source`'s playback to `target` ("Play here" / "Send"); `source` defaults to the player that last started playing |
| `{type:"settings", settings}` | Replace the shared settings blob |
| `{type:"rename", target?, name}` | Rename a registered player (`target` defaults to the sender), 1 to 64 characters |
| `{type:"forget", target}` | Remove an **offline** player from the registry (an online one is refused with `error`) |
| `{type:"clear", state?, settings?}` | Wipe the stored playback state (queue, position, active player) and/or the shared settings |

### Playback state

```json
{ "queue": [ /* track objects */ ], "index": 3, "positionMs": 83000,
  "playing": true, "volume": 80, "shuffle": false, "repeat": false, "updatedAt": 1731150000000 }
```

- `queue` is sent **only when it changed**; otherwise it is omitted and the engine keeps the stored one (a broadcast `state` also omits it when unchanged).
- Queue items are opaque track objects (the desktop/web `Track` shape without `stream_url`: `id`, `title`, `artist`, `artist_id`, `album`, `album_id`, `track_number`, `disc_number`, `duration_secs`, `cover_id`, `starred`, …). The receiving device rebuilds stream URLs itself.
- Limits: 20 000 tracks and 3 MB per queue.

The **active device** (older players' single state) is the one that last *started* playing or was transferred to. `welcome.states` (`proto: 2`) maps each other online player's id to its state.

Players are **independent**: each keeps its own state and any number can play at once. A hello with `device.proto: 2` gets the per-player model (`welcome.states`, and every player's `state` messages); an older player follows one state only, the `activeDeviceId` one (the player that last *started* playing). See [connect.md](connect.md).

**Only the playing device should publish.** An idle device that just restored its saved queue must not publish, or it would overwrite the state of the device in use. A pause or stop is still published once.

### Commands

`cmd` is one of `play`, `pause`, `toggle`, `seek` (`args.positionMs`), `next`, `prev`, `volume` (`args.volume`), `load` (`args.state` — a playback state to start playing).

Jukebox commands edit the target's queue (a remote acting as a controller for a device that just plays):

| `cmd` | `args` |
|---|---|
| `enqueue` | `{ at: "now" \| "next" \| "end", tracks: [track, …] }` — `next` inserts right after the current track in the given order; `now` does the same and starts playing the first inserted track; `end` appends. With an empty queue the tracks just start playing. 1 to 1000 tracks. |
| `jump` | `{ index }` — play item `index` of the target's queue |
| `remove` | `{ index }` — remove item `index` from the target's queue |
| `move` | `{ from, to }` — move queue item `from` so that it ends up at index `to` (array-move semantics) |
| `shuffle` | `{ on: boolean }` |
| `repeat` | `{ on: boolean }` — each player applies its own meaning: the desktop repeats the track, the iOS app loops the queue |

Invalid arguments are dropped by the engine. `index` refers to the queue the controller last saw (from `state`), so a stale view can hit the wrong item; the target ignores out-of-range indexes.

`transfer`: the engine tells the previous active device to `pause`, sets the target active and sends it `load` with the stored state and `playing: true`. Commands and transfers only reach devices of the same user.

### Registered players

The engine keeps a registry of each user's players in the user's file: `deviceId`, name, kind and when it was last seen. A player registers itself the first time it connects.

```json
{ "type": "registry", "devices": [
  { "deviceId": "uuid", "name": "Kitchen tablet", "kind": "web", "online": true,  "lastSeen": 1731150000000 },
  { "deviceId": "uuid", "name": "Old laptop",     "kind": "electron", "online": false, "lastSeen": 1728000000000 } ] }
```

- The registry is for the settings screen. `welcome.devices` and `devices` stay the **online players that take part in playback sync**, as before, so older clients keep working.
- **Forgetting is housekeeping, not revocation:** a forgotten player that is still signed in registers again the next time it connects. Access is controlled by the Navidrome account.
- Players that have been offline for **90 days** are dropped from the registry automatically.

### Settings

`settings` is an object `{ "values": { "<key>": "<string>" }, "at": <ms> }`, max 256 KB, stored per user and replaced as a whole. Because it is replaced whole, a client must **send back the keys it does not know**. A client without the previous blob (`welcome.settings === null` or not yet received) must not publish.

Keys currently shared: see the whitelist in `src/lib/settingsSync.ts`; the iOS app shares `icosahedron_lyrics_lrclib_enabled` and `eq_settings`. The equalizer is a JSON string: `{"enabled":true,"preampDb":0,"bandsDb":[…10 numbers…]}`.

## HTTP endpoints

All need the `Authorization` header unless noted.

| Method and path | Purpose |
|---|---|
| `GET /healthz` | Liveness, `ok` (no auth) |
| `GET /config.json` | Tells the web app where Navidrome is, and `secure` (secure sign-in on) (no auth) |
| `/device/*` | Secure sign-in: asking to be let in, approving, trusted devices, recovery. See [secure-sign-in.md](secure-sign-in.md#api) |
| `/rest/*`, `/api/*`, `/auth/*` | Same-origin proxy to Navidrome (Range requests supported). Navidrome does its own authentication; with secure sign-in on the engine checks the device instead and `/auth/*` is closed |
| `/share/*` | Same-origin proxy to Navidrome's public share pages (no auth) |
| `GET /bpm` | `{ "<trackId>": bpm, … }` — all known BPM values |
| `GET /bpm/<id>` | `{ "bpm": n }` or 404 |
| `PUT /bpm/<id>` | Body `{bpm, manual?}`; 20 ≤ bpm ≤ 400. A `manual` value is not overwritten by a detected one (422) |
| `POST /bpm` | Bulk upload `{ "<id>": bpm, … }` of detected values → `{stored: n}` |
| `GET /lastfm/config` | `{configured, apiKey}` |
| `GET/DELETE /lastfm/connection` | The user's Last.fm connection (`{username, historyEnabled, scrobbleEnabled}` or `null`) / disconnect |
| `POST /lastfm/token` | Start connecting: `{token, authUrl}` — open `authUrl` in a browser |
| `POST /lastfm/session` | Body `{token}` after the user approved → `{connected, username?}` |
| `PUT /lastfm/toggles` | Body `{scrobbleEnabled?, historyEnabled?}` |
| `POST /lastfm/nowplaying` | Body `{track: {title, artist, album, duration}}` |
| `POST /lastfm/scrobble` | Body `{track, timestamp}` (Unix seconds) |

Last.fm endpoints answer `503` when the engine has no API key/secret configured.

Anything else is served from the web app (single-page-app fallback).
