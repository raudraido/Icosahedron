# Architecture

## Components

```
┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│ Desktop (Electron)│ │ Web app (browser)│ │ iOS (SwiftUI)  │
│  React UI        │ │  same React UI   │ │  own UI + code │
│  Rust audio      │ │  <audio> element │ │  AVPlayer      │
└───────┬──────────┘ └────────┬─────────┘ └───────┬────────┘
        │  Subsonic API       │  via proxy        │ Subsonic API (direct or via the engine)
        │  + sync (WebSocket) │  + sync           │ + sync
        ▼                     ▼                   ▼
   ┌──────────────────────────────────────────────────────┐
   │ Web engine (apps/server, Node 22, Docker)            │
   │  /sync    WebSocket hub                              │
   │  /rest /api /auth   same-origin Navidrome proxy      │
   │  /bpm     BPM store            /lastfm/*  Last.fm    │
   │  /        web app (static)     /healthz /config.json │
   └───────────────────────────┬──────────────────────────┘
                               ▼
                       Navidrome / Subsonic
```

The engine is optional. Without it, each client talks to Navidrome directly and nothing is shared between devices.

## Accounts and authentication

There is no account system of its own: **your Navidrome account is your account.**

- A client computes a Subsonic token (`t = md5(password + salt)`) and sends `u`, `t`, `s`.
- The engine verifies them by replaying `ping` against Navidrome and caches a positive answer for 10 minutes.
- The engine never sees or stores your password. Per-user state (queue, settings, Last.fm session) is keyed by the Navidrome username.

## What lives where

| Data | Where |
|---|---|
| Music, library, playlists, favorites, ratings, play counts | Navidrome |
| Play queue and position, shared settings | Engine `DATA_DIR` (one JSON file per user) |
| BPM values | Engine `bpm.json` (shared by all users: BPM belongs to the track) |
| Last.fm API secret | Engine environment (never on a device) |
| Last.fm session key | Engine `lastfm.json` (mode 600) |
| Saved logins | Desktop: OS secret store; web: browser storage; iOS: Keychain |
| Cached audio | Desktop: none; iOS: on the phone (cache and "kept offline") |

## The shared UI (desktop and web)

The React UI in `src/` runs in Electron and in a browser. It never talks to Electron directly: everything goes through the **platform layer** in `src/platform/`.

- `index.ts` — the `Platform` interface (commands, events, cover URLs) and the choice of adapter.
- Electron adapter — forwards commands to the main process (`electron/main/`), which has the native audio engine, casting, credentials and updater.
- `web.ts` — the browser adapter: the Subsonic client runs in the page (through the engine's proxy, so no CORS), audio is an `<audio>` element, profiles live in local storage. Features that need a native host (cast, Last.fm session in the OS, updates) answer with inert defaults, Last.fm goes through the engine.
- `bpmSync.ts`, `engineApi.ts`, `syncUrl.ts` — talk to the engine (BPM store, authenticated HTTP).

The **Subsonic client** (`src/lib/subsonic/`) is shared by the Electron main process and the browser.

Sync itself is `src/lib/sync.ts` (WebSocket client, publishes the playing device's state, handles commands), `src/lib/settingsSync.ts` (shared preferences) and the devices popover `src/components/DevicePicker.tsx`.

## The iOS app

Independent code (`apps/ios`), not a port of the React UI. It shares only the **protocols**: the Subsonic API, the sync WebSocket and the engine's HTTP endpoints. See [ios.md](ios.md).

## Shared settings

Preferences that make sense on every device travel as one JSON blob (`{values: {key: string}, at}`) through the hub. The set of keys is a whitelist in `src/lib/settingsSync.ts` (theme, EQ, toggles, orderings, sort choices, …); layout that depends on the screen, hotkeys and logins stay per device. Each client changes only the keys it owns and sends the rest back untouched, so a client that does not know a key never deletes it. Details: [sync-protocol.md](sync-protocol.md#settings).
