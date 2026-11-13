# Architecture

## Components

```
┌──────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────────┐ ┌─────────────┐
│ Desktop       │ │ Web app      │ │ iOS         │ │ Android phone │ │ Android TV  │
│ Electron+React│ │ same React UI│ │ SwiftUI     │ │ Kotlin,       │ │ Kotlin,     │
│ Rust audio    │ │ <audio>      │ │ AVPlayer    │ │ Compose,      │ │ Compose TV, │
│               │ │              │ │             │ │ Media3        │ │ Media3      │
└──────┬────────┘ └──────┬───────┘ └──────┬──────┘ └──────┬────────┘ └──────┬──────┘
       │ Subsonic API    │ via proxy      │ Subsonic API   │ Subsonic API    │ Subsonic API
       │ + sync (WebSocket) + sync        │ + sync         │ + sync          │ + sync
       ▼                 ▼                ▼                ▼                 ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ Web engine (apps/server, Node 22, Docker)                               │
   │  /sync    WebSocket hub                  /device/*  secure sign-in      │
   │  /rest /api /auth   Navidrome proxy      /share/*   public share pages  │
   │  /bpm  BPM store    /lastfm/*  Last.fm   /avatar /tour /quickconnect/*  │
   │  /     web app (static)   /healthz /config.json                         │
   └──────────────────────────────────┬──────────────────────────────────────┘
                                      ▼
                              Navidrome / Subsonic
```

The engine is optional. Without it, each client talks to Navidrome directly and nothing is shared between devices.

**Naming:** *Icosahedron HUB* is the project; the players (and the Docker image `icosahedron-server`) keep the name *Icosahedron*.

## Accounts and authentication

There is no account system of its own: **your Navidrome account is your account.**

- By default a client computes a Subsonic token (`t = md5(password + salt)`) and sends `u`, `t`, `s`. The engine verifies them by replaying `ping` against Navidrome and caches a positive answer for 10 minutes. The engine never stores your password.
- **With secure sign-in on** ([secure-sign-in.md](secure-sign-in.md)) the password is only used to ask to be let in. A new device is **approved by a device that is already trusted** and then gets a **device secret** that takes the password's place (same `u`, `t`, `s` shape, so every place that builds URLs keeps working). The engine finds the device by its secret and forwards to Navidrome with the `Remote-User` header (Navidrome `ExtAuth.TrustedSources` lists only the engine), strips any such header a client sends, and closes `/auth/*`. Navidrome is then reachable only from the engine.
- Per-user state (queue, settings, Last.fm session, trusted devices) is keyed by the Navidrome username.

## What lives where

| Data | Where |
|---|---|
| Music, library, playlists, favorites, ratings, play counts | Navidrome |
| Play queue and position, shared settings | Engine `DATA_DIR` (one JSON file per user) |
| BPM values | Engine `bpm.json` (shared by all users: BPM belongs to the track) |
| Last.fm API secret | Engine environment (never on a device) |
| Last.fm session key | Engine `lastfm.json` (mode 600) |
| Trusted devices and their secrets, one-use invites, the sign-in history | Engine `devices.json` (mode 600), `invites.json`, `signins.json` |
| Saved logins | Desktop: OS secret store; web: browser storage; iOS: Keychain; Android: app storage |
| Cached and downloaded audio | Desktop: none; iOS and Android: on the phone (the cache, and downloaded songs, albums and playlists) |

## The shared UI (desktop and web)

The React UI in `src/` runs in Electron and in a browser. It never talks to Electron directly: everything goes through the **platform layer** in `src/platform/`.

- `index.ts` — the `Platform` interface (commands, events, cover URLs) and the choice of adapter.
- Electron adapter — forwards commands to the main process (`electron/main/`), which has the native audio engine, casting, credentials and updater.
- `web.ts` — the browser adapter: the Subsonic client runs in the page (through the engine's proxy, so no CORS), audio is an `<audio>` element, profiles live in local storage. Features that need a native host (cast, Last.fm session in the OS, updates) answer with inert defaults, Last.fm goes through the engine.
- `bpmSync.ts`, `engineApi.ts`, `syncUrl.ts` — talk to the engine (BPM store, authenticated HTTP).

The **Subsonic client** (`src/lib/subsonic/`) is shared by the Electron main process and the browser.

Sync itself is `src/lib/sync.ts` (WebSocket client, publishes the playing device's state, handles commands), `src/lib/settingsSync.ts` (shared preferences) and the devices popover `src/components/DevicePicker.tsx`.

## The native apps

The Android phone app (`apps/android`) and the Android TV app (`apps/android-tv`) share their data, player and sync layers in spirit (the code is copied, not a library); see [android.md](android.md) and [android-tv.md](android-tv.md). The phone app is also a media app for Android Auto.

## The iOS app

Independent code (`apps/ios`), not a port of the React UI. It shares only the **protocols**: the Subsonic API, the sync WebSocket and the engine's HTTP endpoints. See [ios.md](ios.md).

## Shared settings

Preferences that make sense on every device travel as one JSON blob (`{values: {key: string}, at}`) through the hub. The set of keys is a whitelist in `src/lib/settingsSync.ts` (theme, EQ, toggles, orderings, sort choices, …); layout that depends on the screen, hotkeys and logins stay per device. Each client changes only the keys it owns and sends the rest back untouched, so a client that does not know a key never deletes it. Details: [sync-protocol.md](sync-protocol.md#settings).
