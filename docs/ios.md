# iOS app

A native SwiftUI app for iPhone and iPad, designed for the phone rather than ported from the web UI. Requires **iOS 26.1 or later**.

It talks to Navidrome directly, or through the [web engine](deploy-server.md). Enter the address of either on the sign-in screen. Through the engine you additionally get sync between devices, Last.fm, BPM and shared settings; with plain Navidrome those parts quietly stay off.

## Install

The app is not on the App Store. Releases contain an **unsigned `.ipa`** that you sign for your own device.

1. Download `Icosahedron-<version>-unsigned.ipa` from the [Releases](https://github.com/raudraido/Icosahedron/releases) page (or from the *iOS build* workflow run's artifacts).
2. Sign and install it with one of: **AltStore**, **SideStore**, **Sideloadly** or **iloader** (all work with a free Apple ID; from Linux use iloader, Sideloader or AltServer-Linux).
3. On the phone: *Settings → General → VPN & Device Management* → trust your developer profile. Turn on *Developer Mode* if iOS asks.
4. Open the app and sign in.

A free Apple ID signs apps for **7 days**; re-sign (repeat step 2) before it lapses. Your data stays. A paid Apple Developer account lasts a year and is needed for TestFlight, CarPlay and widgets (below).

### iloader on newer Linux desktops

If the iloader AppImage opens an empty window with `EGL_BAD_PARAMETER` in the terminal, extract it (`./iloader.AppImage --appimage-extract`), delete the bundled `libwayland-*` libraries in `squashfs-root/usr/lib/`, and run `squashfs-root/AppRun`.

## Features

- **Playback:** gapless, instant start, background audio, lock screen and Dynamic Island, speed 0.5×–2× with *Keep Pitch*, 10-band equalizer, AirPlay, queue with drag-to-reorder.
- **Now Playing:** blurred cover background, "1 of N" with remaining time, favorite, "…" menu, track info and synced lyrics under a cover that shrinks to the corner, landscape / iPad two-column layout.
- **Home:** a row of quick buttons (Random mix) with the profile picture at its right end, then Discover, Newest, Recently Played, Most Played and Playlists, each with *See All*.
- **Library:** Albums and Artists with sort, filters (favorites, decade, genre), grid or list and a letter index; Newest, Recently Played, Songs, Favorite Songs, Downloads, Directories, Playlists, Radios; search.
- **One menu for songs, albums and playlists** (the "…" button on a page, a long press elsewhere): play next, add to queue, add to a device's queue, **Download**, favorite (albums too), add to playlist, share, show album / artist, and for a song Instant Mix, rating (1–5) and info.
- **Offline:** an audio cache (the next track is downloaded in full ahead of time; size set in Settings) and **Download** for songs, albums and playlists you want for good. *Library → Downloads* (cache, kept songs, kept albums and playlists) works without a connection.
- **Secure sign-in:** a sign-in request from another device appears in its own window above everything (also above Now Playing); the app signs in with a number to be approved on another device ([secure-sign-in.md](secure-sign-in.md)).
- **Remembers what played:** the queue, the song and the position come back at the next launch, and a "play" from a car or a headset with the app closed starts the last queue.
- **Quality per connection:** separate Wi-Fi and Cellular profiles — direct play, or MP3/AAC 96–320 kbps transcoded by Navidrome. iOS Low Data Mode counts as cellular. Nothing is downloaded in the background on cellular unless allowed.
- **Plays:** counted after half the track or 4 minutes, stored on disk first and sent when online with their real time (Navidrome, and Last.fm through the engine).
- **Playlists:** create, rename, delete, reorder, remove tracks, save the queue as a playlist.
- **Siri and Shortcuts** (no extension needed): play/pause, next, previous, shuffle my music, play my favorites, favorite the current song, play a search result.
- **Sync:** see your other devices, control the playing one, *Play here*. Shared settings: lyrics lookup and equalizer.
- Estonian translation, accessibility labels.

## Limits

- **CarPlay (own icon and browsing)** needs Apple's CarPlay Audio entitlement, which needs a paid developer account and Apple's approval. Without it the car's built-in *Now Playing* screen should still show the playing track and the controls (not verified).
- **Home-screen widgets** need an app extension and an App Group, which free Apple ID signing does not reliably allow. Not included.
- Opus is not offered for transcoding (iOS does not play Ogg).
- Seeking in a transcoded stream is approximate until the track is in the cache.
- The app was developed without access to a Mac: it is built and checked by CI and run on a device, but some features have had little time on real hardware (equalizer, offline scrobbles, Last.fm, share, Instant Mix).

## Building

CI builds it on a macOS runner (workflow `.github/workflows/ios.yml`, Xcode 26): push a branch that changes `apps/ios/**`, open a PR, or start the workflow by hand; the unsigned `.ipa` is the run's artifact. Tagged releases attach it to the release.

On a Mac:

```bash
brew install xcodegen
cd apps/ios
xcodegen generate          # creates Icosahedron.xcodeproj from project.yml
open Icosahedron.xcodeproj # build and run from Xcode (iOS 26 SDK)
```

The version is in `apps/ios/VERSION` (the iOS app has its own version and releases under the tag `ios-vX.Y.Z`); see [releasing.md](releasing.md).

## Code map

| File | What |
|---|---|
| `project.yml` | XcodeGen project (iOS 26.1, device families, background audio) |
| `Sources/IcosahedronApp.swift`, `AppModel.swift` | App entry, the shared state (sign-in, playlists, favorites, Last.fm, scrobbles) |
| `SubsonicClient.swift`, `Models.swift` | Subsonic API and models |
| `PlayerModel.swift`, `AudioCache.swift`, `Quality.swift` | Playback (AVQueuePlayer, gapless), the cache, quality profiles and connection monitor |
| `EQ.swift` | Equalizer (audio processing tap, biquad filters) |
| `SyncModel.swift` | Sync WebSocket client and shared settings |
| `LastFm.swift` | Last.fm through the engine and the offline scrobble queue |
| `Lyrics.swift`, `Intents.swift`, `Router.swift`, `Presenter.swift` | Lyrics lookup, Siri/Shortcuts, navigation, UIKit alerts |
| `Views/` | SwiftUI screens |
| `Localizable.xcstrings` | Estonian (and English source) strings |
