# Web app

The desktop UI in a browser, served by the web engine ([deploy-server.md](deploy-server.md)) at its root. Sign in with your Navidrome account; the server address is the site itself, and the login is kept on the device.

## Install as an app (PWA)

Needs HTTPS. In Chrome / Edge use the install icon in the address bar; in Safari use *Share → Add to Home Screen*. The service worker keeps the UI shell available offline; API, streams and sync always use the network.

## What works

Playback, library browsing, playlists, favorites, lyrics, Last.fm (through the engine), the device list and remote control, shared preferences, BPM (from the engine's store), media keys and Media Session (notification / lock-screen controls), and an **equalizer** (WebAudio, same 10 bands as the desktop).

## Limits

- **No gapless** between tracks: one persistent `<audio>` element.
- **iOS Safari does not show title and cover on the lock screen** for any web page we tried (even a minimal test page); other iPhone browsers do. Use the [iOS app](ios.md) for that.
- The **equalizer is not available on iOS Safari** (WebAudio output stops in the background there).
- No casting, no native BPM detection, no updater (those are desktop features).
- A basic phone layout exists (header, bottom tabs, mini player, full-screen player); the iOS app is the real phone experience.

## URL switches (diagnostics)

| Parameter | Effect |
|---|---|
| `?debug=1` | On-screen Media Session diagnostics box |
| `?layout=mobile` / `desktop` / `auto` | Force a layout (remembered) |
| `?nosw=1` / `?nosw=0` | Turn the service worker off / on on this device |
| `?art=128…512 / url` | How the cover is handed to the OS (Media Session) |

## Build

```bash
npm run build:web      # → dist-web/
```

The Docker image does this for you; see `apps/server/Dockerfile`.
