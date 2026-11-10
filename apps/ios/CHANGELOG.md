# iOS app changelog

A native SwiftUI app for iPhone and iPad (iOS 26.1 or later), built as an unsigned `.ipa` (sign it with SideStore, AltStore, Sideloadly or iloader: [docs/ios.md](../../docs/ios.md)). It has been part of the shared releases 0.15.3 to 0.15.9 (see the [main changelog](../../CHANGELOG.md)); from here it has its **own version, release and changelog**. What works with which server: [docs/compatibility.md](../../docs/compatibility.md).

## Unreleased

- **Quick Connect switch** in Settings → Sync Server for a server administrator (the code entry stays for everyone while it is on).

## 0.1.0

**The first release with the app's own version number.** It includes everything the app has done since 0.15.3. The sync features need the [server](../server/CHANGELOG.md) (update it first); without it the app plays straight from Navidrome.

### Playback
- Gapless, instant start, background audio, lock screen and Dynamic Island, 10-band equalizer, AirPlay, playback speed 0.5× to 2× with "Keep Pitch", queue with drag-to-reorder.
- **Now Playing:** blurred cover background, "1 of N" and remaining time, favorite, "…" menu, track info and synced lyrics under a cover that shrinks to the corner, quality line, landscape and iPad two-column layout.

### Library
Artists, Albums, Newest, Recently Played, Songs, Favorites, Cached Songs, Directories, Playlists, Radios, and Search. The track menu has play next, add to queue, Instant Mix, show album or artist, keep offline, favorite, rating, share, add to playlist and info. Playlists: create, rename, delete, reorder, remove tracks, save the queue as a playlist.

### Offline and data
- Background cache (the next track is fetched in full ahead of time, size set in Settings), "Keep Offline" for songs you want to keep, "Cached Songs" works without a connection.
- Separate quality for Wi-Fi and cellular (direct play, or MP3/AAC 96 to 320 kbps transcoded by Navidrome); Low Data Mode counts as cellular.
- Plays are counted after half the track (or 4 minutes), stored on disk first and sent when online; Last.fm through the server.

### Your devices
- **Devices tab:** every device of your account and what it plays; tap one to control it. **One player screen for every device:** the normal Now Playing shows and controls that device (cover, progress you can drag, queue, lyrics, shuffle, repeat); speed, AirPlay and the equalizer stay in place but inactive. A device with nothing playing says so.
- Choosing a device only controls it. **Send** moves this phone's music to that device, **Play here** brings its music here. Players are independent: music at home and in the car can play at once.
- **Add to Device Queue** in every track menu (*Play Now*, *Play Next*, *Add to Queue*).
- **Settings → Sync Server:** the name of this phone, every registered player (swipe to rename, forget the offline ones), what the phone keeps in sync (playback and remote control, equalizer, lyrics source), clear the queue or preferences the server stores, and **Quick Connect** (enter the six-digit code a TV shows to sign it in; only when the server has it on).
- The progress of another device moves on by itself and no longer jumps back at each report.

### Smaller things
- **Siri and Shortcuts** (no extension needed): play/pause, next, previous, shuffle my music, play my favorites, favorite the current song, play a search result.
- Estonian translation, accessibility labels, shared preferences with the other apps (lyrics lookup and equalizer).
- The version is shown in Settings → About.

### Notes
- Not yet: CarPlay and widgets (they need a paid developer account), crossfade.
- Install: [docs/ios.md](../../docs/ios.md). With a free Apple ID the app has to be re-signed every 7 days (SideStore does it by itself).
