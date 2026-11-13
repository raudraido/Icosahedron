# iOS app changelog

A native SwiftUI app for iPhone and iPad (iOS 26.1 or later), built as an unsigned `.ipa` (sign it with SideStore, AltStore, Sideloadly or iloader: [docs/ios.md](../../docs/ios.md)). It has been part of the shared releases 0.15.3 to 0.15.9 (see the [main changelog](../../CHANGELOG.md)); from here it has its **own version, release and changelog**. What works with which server: [docs/compatibility.md](../../docs/compatibility.md).

## Unreleased

- **The right cover, always:** when the song changed, a cover that was already loaded could stay on screen (the mini player, Now Playing) instead of the new song's cover, or the old one stayed until the new one had loaded. Fixed.

## 0.2.9
- **Now Playing closes with a pull down every time:** a pull of about 90 pt (or a quick flick) that is mostly downward on the top bar, the cover or the title always closes it, however slow or slanted. Before, only the system's own gesture closed it, and that one needed a quick, straight pull and gave way to anything under the finger. The seek bar, the buttons and the queue / lyrics lists are left alone, so scrolling them does not close it.

## 0.2.8
- **Home:** no title, so the quick buttons and the profile picture start right at the top; the profile picture is bigger.
- **Covers stay:** a cover that was loaded is kept in memory, so the mini player's cover (and every other cover) no longer goes blank when you switch tabs or move around while music plays.

## 0.2.7
- **Profile picture:** it is now a plain round picture at the right end of the Home quick-button row, like on Android (it used to be a small picture inside a system button at the top left). Library no longer has it; tap the picture on Home for settings.
- **The mini player is our own bar,** the same on Android and iOS: cover, title and artist, play / pause and next, with a thin progress line, always above the tab bar and always the same shape. The system's player bar changed its look while scrolling and flickered; the tab bar no longer shrinks when you scroll either.

## 0.2.6

- **Home:** the big title is gone (the small one stays in the bar) and **Random mix** is a small button in a row of quick buttons, like on Android; more can be added next to it.

## 0.2.5

- **The "…" button next to Play and Shuffle is now three dots one above the other** (like on Android) and as tall as the Shuffle button.

## 0.2.4

**One menu for albums and playlists, the same as in the Android app.**

- On an album or playlist page there is a **…** button next to Play and Shuffle (it replaces the one in the top corner). The same menu opens on a long press on a card or row: **Play Next, Add to Queue, Add to Device Queue, Download, Favorite, Add to Playlist, Share**, and Show Artist or Rename / Delete where they fit.
- **Favorite** now works on albums (the same as Albums → Filter → Favorites). **Add to Playlist** adds a whole album or playlist; **Share** makes a share link for an album or playlist.
- "Keep Offline" is now **Download** everywhere, and Cached Songs is now **Downloads**.

## 0.2.3

- **Albums and playlists can be kept offline from the lists:** a long press on an album or a playlist (Home, Albums, Playlists) offers Play, Add to Queue and Keep Offline / Remove Offline. A kept album has a small download mark.
- **Kept albums and playlists show under Library → Cached Songs** (Albums and Playlists) and open without a connection, with Play, Shuffle and a remove button.

## 0.2.2

- **Fixed: the sign-in approval prompt did not show while the player (Now Playing) or a sheet was open;** it appeared only after you left it. It now comes up on top of everything.

## 0.2.1

- **The app remembers what was playing.** The queue, the track and the position are kept (a moment after every change, and every 15 seconds while playing) and put back when the app starts, paused where it was. A **"play" from the car, a headset or the lock screen** when iOS has closed the app now starts the app, signs in, puts the last queue back and plays it; before, there was nothing to play and the car turned to another music app. Clearing the queue or signing out forgets it.
- To be the app the car picks, Icosahedron has to be the last one that played: play something in it before the drive, and do not play another music app in between.

## 0.2.0

Needs [server](../server/CHANGELOG.md) 0.17.0 for secure sign-in; without it the app works as before.

- **Secure sign-in.** For a server that asks for approval of new devices (an administrator switches it on in Settings → Sync Server → Secure sign-in): signing in shows a number and waits while one of your signed-in devices approves it; no device at hand, a recovery code or an administrator's invite code works. When another device asks, this phone shows a prompt with three numbers (pick the one on the other screen) or "It was not me", and a notification if the app is still running behind another.
- **Settings → Sync Server → Secure sign-in:** turn it on or off, trusted devices (swipe to remove), app passwords, new recovery codes, invites, sign-in history.
- The app does not run in the background, so a request is seen when you open it (or at once if it is already open); a push notification when it is closed is not possible with a free Apple ID.

## 0.1.4

- **Fixed:** in Home, Playlists, See All, a tap on a playlist only flickered and did not open it.

## 0.1.3

- **Home.** Discover is now the first shelf, and Discover, Recently added and Most played each have a **See All** button that opens the whole list; a **Playlists** shelf (with See All) closes the list. **Random mix** starts playing at once instead of opening a list you had to press Play on.
- **Albums and Artists** in the Library got what a list of thousands needs: **sort** (Albums: name, album artist, date added, most played, recently played, random, release year; Artists: name, most albums, random), **filter** (Albums: favourites, genre, decade; Artists: favourites), a **grid / list** switch that is remembered, and an **A–Z strip** on the edge to jump to a letter. The shelves' See All buttons open the same screen. Sorting by rating or tags is left out: Navidrome's standard API does not give them.

## 0.1.2

Needs the [server](../server/CHANGELOG.md) 0.16.2 for the profile picture and the shared Last.fm connection.

- **Profile picture.** Choose a photo in Settings (Account); the sync server keeps it, so it is the same on every device. The round button on top of the lists shows it. Without a picture it shows the first letter of your name.
- **Last.fm: connected once for all.** If the desktop app is connected to Last.fm it shares that with the server, and the phone shows "Connected as …" without approving again. When the server has no Last.fm yet, the message now says what to do.
- **Settings in a better order.** About first, Account next, and **Sync Server** is a section of its own and shows whether it is connected.

## 0.1.1

Needs the [server](../server/CHANGELOG.md) 0.16.1 for the switch.

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
