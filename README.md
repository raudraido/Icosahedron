# Icosahedron HUB

**Icosahedron HUB** is a family of players for your own [Navidrome](https://www.navidrome.org/) / Subsonic server, with a small sync server that ties them together: a **desktop app**, a **web app**, an **iPhone app**, an **Android phone app** (with Android Auto) and an **Android TV app**. Everything is kept in step: start a song on one device and continue on another, or control one device from another.

*HUB* is the name of the project as a whole. The players themselves are called **Icosahedron**.

```
  Desktop        Web app       iOS app      Android phone     Android TV
 (Electron      (same UI,    (SwiftUI)    (Kotlin, with      (Kotlin,
  + Rust)       in a browser)               Android Auto)     for the TV)
     │              │             │              │                │
     └──────────────┴───────┬─────┴──────────────┴────────────────┘
                            ▼
                 ┌─────────────────────┐      optional: adds sync and remote control,
                 │   Web engine        │      secure sign-in, the web app, shared BPM,
                 │   (Docker, Node)    │      Last.fm and the plugin page
                 └──────────┬──────────┘
                            ▼
                    Navidrome / Subsonic
```

**You do not need the web engine to use the apps.** They talk to Navidrome directly. The engine is what adds sync between devices, the web app, secure sign-in, a shared BPM store and Last.fm scrobbling across all your devices.

## What it can do

- **Play everywhere, keep it in step:** one queue and position follow you; the *Devices* list shows every device of your account with what it plays; *Send* and *Play here* move playback, and any device can control another.
- **Secure sign-in for a server on the internet:** a new device has to be approved by a device that is already signed in, so a password alone gets nobody in ([docs/secure-sign-in.md](docs/secure-sign-in.md)).
- **Gapless playback** (desktop, iOS, Android), 10-band equalizer, **playback speed** 0.5×–2× with the pitch kept, lyrics (timed, from the server or LRCLIB), **BPM**, favorites, ratings, playlists, share links.
- **Offline:** an audio cache and *Download* for songs, albums and playlists (iOS, Android); *Download* on the desktop too, and the desktop app opens without the server when it has downloads. The web app has no offline music.
- **In the car:** Android Auto from the Android phone app; CarPlay is a skeleton that has not been run yet ([docs/carplay.md](docs/carplay.md)). The car's own Now Playing screen works from the iOS app.
- **On the TV:** Android TV / Google TV, signed in with Quick Connect.
- **Also:** casting to Chromecast / AirPlay 2 / DLNA (desktop), Last.fm scrobbling, upcoming concerts for the artist (Ticketmaster), a settings page for Navidrome's plugins.

## The parts

| Part | What it is | Where | Read |
|---|---|---|---|
| **Desktop app** | Electron + React with a native Rust audio engine: gapless, equalizer, Chromecast / AirPlay / DLNA | repo root (`src/`, `electron/`, `native/`) | [docs/desktop.md](docs/desktop.md) |
| **Web engine** | Small Docker service: sync hub, secure sign-in, Navidrome proxy, BPM store, Last.fm, serves the web app | [`apps/server`](apps/server) | [docs/deploy-server.md](docs/deploy-server.md) |
| **Web app** | The desktop UI in a browser, installable as a PWA; served by the engine | built from `src/` | [docs/web.md](docs/web.md) |
| **iOS app** | Native SwiftUI app for iPhone and iPad (gapless, downloads, lyrics, Siri/Shortcuts, …) | [`apps/ios`](apps/ios) | [docs/ios.md](docs/ios.md) |
| **Android phone app** | Native Kotlin app for Android phones, tablets and cars, like the iOS app: browse, play, lyrics, downloads, remote control, Android Auto | [`apps/android`](apps/android) | [docs/android.md](docs/android.md) |
| **Android TV app** | Native Kotlin app for Google TV / Android TV: plays through the TV, browses with the remote, appears as a device in the other apps | [`apps/android-tv`](apps/android-tv) | [docs/android-tv.md](docs/android-tv.md) |

How they fit together: [docs/architecture.md](docs/architecture.md). The sync wire protocol: [docs/sync-protocol.md](docs/sync-protocol.md).

## Quick start

**Run the web engine** (Docker):

```yaml
# docker-compose.yml
services:
  icosahedron:
    image: ghcr.io/raudraido/icosahedron-server:latest
    restart: unless-stopped
    environment:
      NAVIDROME_URL: http://navidrome:4533     # your Navidrome, reachable from the container
    volumes:
      - ./data:/data
    ports:
      - "8080:8080"                            # put a TLS reverse proxy in front (see docs)
```

Open `http://<host>:8080`, sign in with your Navidrome account. Details, environment variables and reverse-proxy notes: [docs/deploy-server.md](docs/deploy-server.md).

**Desktop app:** download a build from the [Releases](https://github.com/raudraido/Icosahedron/releases) page (AppImage / `.deb` for Linux, `.exe` for Windows), or build it yourself — see below. To sync, press the *devices* button next to the cast button and enter your engine's address.

**Android phone app:** open `Icosahedron-Android-<version>.apk` from a release on the phone, see [docs/android.md](docs/android.md). **Android TV app:** sideload the APK from a release, see [docs/android-tv.md](docs/android-tv.md).

**iOS app:** download the unsigned `.ipa` from a release and sign it for your device with AltStore, SideStore, Sideloadly or iloader — see [docs/ios.md](docs/ios.md).

## Development

```bash
npm install     # also builds native/audio-engine (needs a Rust toolchain)
npm run dev     # desktop app, electron-vite dev server
npm run build:web   # the web app, output in dist-web/
```

```bash
cd apps/server && npm install && npm test    # web engine tests
```

The iOS app is built by CI on a macOS runner (no Mac needed): [docs/ios.md](docs/ios.md#building). The Android apps build with Android Studio or Gradle (JDK 17, Android SDK 35): [docs/android.md](docs/android.md). More: [docs/contributing.md](docs/contributing.md).

## Building the desktop app

```bash
npm run build   # typecheck + electron-vite build
npm run dist    # + electron-builder (AppImage / deb on Linux, NSIS on Windows)
```

The native audio engine can be rebuilt on its own with `npm run build:native` — requires a Rust toolchain (`cargo`/`rustc`).

## Releases

Every app has its own version and its own release: a `vX.Y.Z` tag publishes the desktop app, `server-vX.Y.Z` the Docker image (engine and web app), `ios-vX.Y.Z` the iOS `.ipa`, `android-vX.Y.Z` the Android TV APK, `android-phone-vX.Y.Z` the Android phone APK (the Android phone app counts its last number up, 0.1.0, 0.1.1, …). See [docs/releasing.md](docs/releasing.md), [docs/compatibility.md](docs/compatibility.md) and the changelogs ([desktop](CHANGELOG.md), [server](apps/server/CHANGELOG.md), [iOS](apps/ios/CHANGELOG.md), [Android TV](apps/android-tv/CHANGELOG.md), [Android phone](apps/android/CHANGELOG.md)).

## License

GPLv3 — see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
