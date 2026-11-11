# Web app

The desktop UI in a browser, served by the web engine ([deploy-server.md](deploy-server.md)) at its root. Sign in with your Navidrome account; the server address is the site itself, and the login is kept on the device.

## Install as an app (PWA)

Needs HTTPS. In Chrome / Edge use the install icon in the address bar; in Safari use *Share → Add to Home Screen*. The service worker keeps the UI shell available offline; API, streams and sync always use the network.

## What works

Playback, library browsing, playlists, favorites, lyrics, Last.fm (through the engine), the device list and remote control, shared preferences, BPM (from the engine's store), media keys and Media Session (notification / lock-screen controls), and an **equalizer** (WebAudio, same 10 bands as the desktop).

## Playing and selecting songs

In the web app **one click plays** a song in every song list (the queue, a playlist, an album, Tracks, Favorites, the artist's popular songs). A song played from a list is put right after the one that plays now (the queue is not replaced); in the queue a click jumps to that song.

- **Selecting several songs:** a tick box shows in front of the row when you point at it. Once one is ticked, every row shows its box and a bar replaces the column headings: *N selected*, **Play**, **Play Next**, **Add to Queue**, **Add to Playlist**, **Clear selection**; its box ticks or clears all. `Esc` clears the selection. `Shift` + click on a box ticks a range; `Ctrl` / `Cmd` / `Shift` + click on the row selects it without playing. With several rows ticked, the right-click menu acts on all of them.
- **Dragging** a row (the queue, and a playlist in its own order) still reorders it; the click that ends a drag does not play.
- The hearts, artist and album links and the boxes in a row do their own thing and do not start playback.
- The desktop app plays the same way (one click, tick boxes, Shift/Ctrl selection).

## Secure sign-in

When an administrator has switched it on ([secure-sign-in.md](secure-sign-in.md)), signing in shows a number and waits for a device that is already signed in to approve it; the web app asks the same of itself when it is the one that approves. The sign-in is kept on the device like any other.

## Limits

- **No gapless** between tracks: one persistent `<audio>` element.
- **iOS Safari does not show title and cover on the lock screen** for any web page we tried (even a minimal test page); other iPhone browsers do. Use the [iOS app](ios.md) for that.
- The **equalizer is not available on iOS Safari** (WebAudio output stops in the background there).
- No casting, no native BPM detection, no updater (those are desktop features).
- **Share links** (right-click → Share) carry the server's own address and open for anyone: the engine passes `/share/` to Navidrome (server 0.16.9; links made earlier with the engine's address start working then).
- A basic phone layout exists (header, bottom tabs, mini player, full-screen player); the iOS app is the real phone experience.

## URL switches (diagnostics)

| Parameter | Effect |
|---|---|
| `?debug=1` | On-screen Media Session diagnostics box |
| `?layout=mobile` / `desktop` / `auto` | Force a layout (remembered) |
| `?nosw=1` / `?nosw=0` | Turn the service worker off / on on this device |
| `?art=128…512 / url` | How the cover is handed to the OS (Media Session) |
| `?player=1` | Jukebox player: shows only the current track, appears as the device "Jukebox" and is controlled from your other devices (needs one tap to allow audio) |

## Build

```bash
npm run build:web      # → dist-web/
```

The Docker image does this for you; see `apps/server/Dockerfile`.

## Jukebox

Any signed-in device with the sync engine can act as a jukebox:

- **Player:** open `https://<your engine>/?player=1` on a screen that only plays (tablet, kiosk browser, spare PC). It registers as "Jukebox" and shows the current track. Tap once when it opens so the browser lets it play audio.
- **Controller:** on the desktop or web app, right-click a track → **Add to Device Queue** → pick the device and *Play Next* or *Add to Queue*. In the devices popover, **Show queue** lists the playing device's queue with play and remove buttons.

The commands behind this are documented in [sync-protocol.md](sync-protocol.md#commands).
