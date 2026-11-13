# Android phone app changelog

A native app (Kotlin, Jetpack Compose, Media3) for Android phones and tablets, built to match the iOS app: [docs/android.md](../../docs/android.md).

## 0.1.27
- **The launcher icon is the bare logo:** a transparent background, no white circle or plate behind it, and the logo as big as the visible area allows (it used to be a plain picture that the launcher put on a small white circle).

## 0.1.26
- The app now targets **Android 16 (API 36)**, which Google Play requires for new apps. Nothing is changed for you; it plays, browses and works with Android Auto as before.

## 0.1.25
- The bundle for **Google Play** is accepted now: the manifest no longer declares the "automotive" device feature next to the Android Auto metadata (Play refuses both together). Android Auto works as before.

## 0.1.24
- Preparing for **Google Play**: the build now also makes the signed bundle (`.aab`) that Google Play takes. Nothing changes in the app itself.

## 0.1.23
- **Library looks like the iOS app's:** a plain list of the ways to browse, with the same names and order: Artists, Albums, Newest Albums, Recently Played Albums, Songs, Favorite Songs, Downloads, Directories, Playlists, Radios. Each opens its own page with a back button; Albums and Artists keep their sort and filters as before.
- **New pages:** **Songs** (every song in the library, loaded as you scroll, with Shuffle all), **Directories** (the server's folders) and **Radios** (the server's internet radio stations; a radio plays live and is never cached).
- On a wide screen (a car, a tablet, the phone on its side) Library stays as it was, with the tabs.

## 0.1.22

- **The Library remembers how you left it:** the tab you were on, how Albums are sorted and filtered (and grid or list), and how Artists are sorted (favorites only, grid or list). It used to start from the default every time you came back to Library. The "See all" pages from Home still open with the order they were asked for.
- **Library → Favorite Songs:** a new section with every song you marked with the heart (the same list as Favorite Songs in the iOS app), with Play, Shuffle and the ⋮ menu (for example Download all or Add to Playlist). It follows the heart: a song you favorite or unfavorite anywhere appears or goes away at once. The Library tabs scroll sideways now, as there are five of them.

## 0.1.21

- **Now Playing text is bigger:** the title, the artist and the album are about 15% bigger.
- **Lyrics are bigger with more space between the lines;** the line that is sung is bold, white and bigger than the others (the rest are dimmer), and it sits a third of the way down the screen with the next lines under it, so you can read ahead.

## 0.1.20

- **Now Playing:** the time already played is at the **left end of the seek bar** and the time left (with a minus, like "-0:06") at the **right end**, on the same row as the bar. The **album name** is under the artist. The **cover is 20% smaller**.

## 0.1.19

- **The corners of the playback icons are a little rounded** (play, pause, previous, next, shuffle, repeat): they had sharp points; now the corners have a small radius, so they look softer. The icons are scaled down slightly to make up for the rounding.

## 0.1.18

**Now Playing is redone so it can be used in a shaking car.**

- **The "Now playing" text is gone** (only the arrow stays; "Playing on …" shows in the accent colour when you control another device).
- **The title is big and bold** (up to two lines) with the **favorite heart at the right edge of the same row**; the artist is under it, bigger and brighter. This is so on every screen size.
- **On a wide screen (a car, a tablet) everything is spread over the whole height** instead of bunched in the middle, with big targets far apart: the arrow, the heart, shuffle and repeat are 76 dp, previous and next 88 dp, and play / pause is the biggest, a white filled circle of 112 dp. Lyrics, speed, queue and the menu are tall blocks (88 dp) with the **name under each icon**. The seek bar has a bigger handle and bigger times.
- Pulling the screen down to close it now needs a longer pull (200 dp), so a bump in the road does not close it.

## 0.1.17

- **The tabs in the side rail (wide screens) are bigger and start at the top:** each one is a tall, wide block (84 dp high, the rail is 112 dp wide) with the icon above its name, and the whole block is the target, so it is easy to hit in a car that shakes. The selected one is marked with a rounded background. On a low screen they are 60 dp high without names. The round cover with the progress ring stays at the bottom.

## 0.1.16

- **Now Playing closes when you pull it down from anywhere** (the cover, the title, the controls, empty space), not only with the small arrow. The screen follows your finger and goes away when you pull far enough or flick it down; otherwise it springs back. The lists inside it (lyrics, the queue, the song's details) scroll first: only a pull at their very top closes the screen. The arrow and the back button still work.
- **The buttons are rearranged:** the playback controls (shuffle, previous, play / pause, next, repeat) are at the very bottom and bigger. Under the seek bar there is a row of smaller buttons: **favorite (♥)**, lyrics, speed, queue and the **⋮ menu** (the same menu as everywhere else: Play Next, Add to Queue, Add to Device Queue, Download, Favorite, Add to Playlist, Share, Show Album, Show Artist).

## 0.1.15

- **Now Playing background:** the colour of the cover now fades down into the dark of the app (a gradient, top to bottom) and changes smoothly with each song, as on the TV; before it was one flat colour.

## 0.1.14

- **The sign-in form is small on a wide screen** (a car, a tablet): the fields and the button are only about as wide as the title, in the middle, not as wide as the screen; the logo and the title are a bit smaller.
- **Playing in the background is firmer:** the player holds the CPU and the Wi-Fi awake while a song plays (with the screen off or the app left, the phone could put the stream to sleep and the music stopped after a while), and the app now keeps its media service connected, so Android moves it to the foreground with its notification as soon as a song starts and the music goes on when you leave the app.

## 0.1.13

- **The player on a wide screen moved into the side rail, at the bottom:** only the round cover with a ring that shows the progress (it replaces the floating card of 0.1.12, so nothing covers the content and the lists use the whole height). **A tap opens Now Playing, a long press pauses or plays.** When nothing is paused-or-playing there is no cover; when it is paused the cover is dimmed with a play mark. On a low screen (a phone on its side) the tab icons lose their labels so everything fits.

## 0.1.12

- **A small player card instead of a bar on a wide screen** (a tablet, a phone on its side, a car): in the bottom right corner a round cover with a ring that shows the progress, and ⏮ ⏯ ⏭ under it. A tap on the cover opens Now Playing; a long press shows the song's name and artist. It floats over the content, so the width is not used up, and the lists leave room at the bottom so nothing hides behind it. On a narrow screen (a phone held upright) the bar stays as it was.

## 0.1.11

- **Album and playlist pages on a wide screen** (a tablet, a phone on its side, a car) work like Now Playing: the cover, the names and the Play / Shuffle / ⋮ buttons stay at the left, and only the song list scrolls at the right. On a narrow screen nothing changes. The same goes for a playlist and for a kept album or playlist under Library → Downloads.

## 0.1.10

- **Home:** the big "Icosahedron" title is gone. **Random mix** is now a small button in a row of quick buttons (more can be added next to it) with the profile picture at the right.
- **Sound keeps working when the system's audio service restarts:** the player now asks for a fresh audio session if it was given none (every song then failed with "Invalid audio session ID"), and tries the song again once when the audio output cannot be opened.
- **The equalizer effect is only made when the equalizer is on** (or its page is open), so a phone that does not use it does not touch the system's audio effects at all.

## 0.1.9

- **A wide screen (a tablet, a phone on its side, a car) is used properly:** the tabs move to a rail at the left instead of a bar at the bottom, **Now Playing puts the cover on one side and the controls on the other**, and the album and artist grids take as many columns as fit.
- **Car systems with Android Automotive OS** now find the app as a media app (it was marked for Android Auto only); it then shows in the car's media list with the library tree (Recently played, Playlists, Albums, Artists, Random mix).

## 0.1.8

- **Tap the cover in Now Playing** to see the song's details under a smaller cover (title, artist, album, year, genre, format, bitrate, sample rate, bit depth, channels, length, file size, path, BPM, plays, date added); the artist and the album open their pages. Tap the cover again to go back. This is how the iOS app works.
- **A tap on Now Playing no longer reaches the screen under it** (it could press something there, for example "next song").

## 0.1.7

**One menu for albums, playlists and songs, the same as in the iOS app.**

- On an album or playlist page there is a **⋮** button next to Play and Shuffle. The same menu opens on a long press on a card and on a song's ⋮: **Play Next, Add to Queue, Add to Device Queue, Download, Favorite, Add to Playlist, Share**, and Show Album / Show Artist or Rename / Delete where they fit.
- **Favorite** works on albums (the same as Albums → Filter → Favorites) and songs. **Add to Playlist** adds a whole album or playlist (or makes a new playlist from it). **Share** makes a Navidrome share link. **Add to Device Queue** sends it to another of your devices.
- "Keep offline" is now **Download** everywhere, and the offline view is **Library → Downloads**.

## 0.1.6

- **Albums and playlists can be brought offline from the lists:** a long press on an album or a playlist (Home, Library, search) offers Play, Add to queue and Keep offline / Remove from offline. A kept one has a ↓ in front of its name.
- **Library → Offline** now lists the kept albums and playlists (they open without a network, with Play, Shuffle and Remove) above the kept songs.

## 0.1.5

- **Profile picture:** the account's picture (the one set in another Icosahedron app; the sync server keeps it) shows at the top right of Home, and Settings → Account lets you add, change or remove it. Without one, the first letter of the user name is shown. The phone keeps a copy for the next launch and for offline.

## 0.1.4

- **Offline cache:** songs you play are kept on the phone for next time, and the next song in the queue is fetched while the current one plays, so they start at once and play without a network. The oldest are removed when the limit is reached (Settings → Offline: 256 MB to 10 GB, clear the cache). On mobile data nothing is cached or downloaded unless you allow it there.
- **Keep offline:** in a song's menu and on every album and playlist page. Kept songs are never removed by the cache, have a ↓ mark, play without a network and are listed in **Library → Offline** (Play, Shuffle). Settings → Offline shows what is kept and removes it.
- Still to come: nothing planned from the first list; browsing the library itself without a network is not part of this.

## 0.1.3

- **Android Auto:** the app shows up on the car screen with Recently played, Playlists, Albums, Artists and a Random mix, and search by voice or text. A song played from an album or playlist plays the whole list from there. Bluetooth and Assistant use the same library. To try a sideloaded app in the car, switch on Android Auto's developer mode and *Unknown sources* (docs/android.md).
- Still to come: the offline cache and downloads.

## 0.1.2

- **The queue is remembered:** after the app is closed or the phone restarts, the queue, the song and the position are back (paused). A play button on a headset or in a car with nothing loaded continues where it was.
- **BPM in song lists** (from the song's tags; a switch in Settings → Lists).
- **Secure sign-in can be switched on from the phone** (Settings → Secure sign-in, administrator): the recovery codes are shown once, you can make new ones, make an app password for another Subsonic app, or turn it off.

## 0.1.1

The rest of what 0.1.0 was meant to have (0.1.0 was built a little early). Install it over 0.1.0.

- **Sign in** with the server address, user name and password. The server is found on the network (mDNS and broadcast) when it is near. With **secure sign-in** on, the password only asks to be let in: the phone shows a number, you pick it on a device that is already trusted. A recovery code or an invite works when no device is at hand.
- **Approve other devices:** a sign-in request from another device opens a card over everything (also over the player) with three numbers; a notification shows it when the app is in the background.
- **Home** with a *Random mix* button that starts at once, then Discover, Recently played, Newest, Most played and Playlists, each with *See all*.
- **Library** with Albums, Artists and Playlists. Albums and Artists have **sort** (name, album artist, date added, most played, recently played, random, year), **filters** (favorites, decade, genre), a grid or list view and a letter index, like iOS. **Search** across artists, albums and songs; album, artist and playlist pages with Play and Shuffle.
- **Playback speed** 0.5× to 2× with *Keep pitch* (in Now Playing).
- **Player:** a mini player above the tabs and a full Now Playing screen with the cover's colours, seek bar, shuffle, repeat, **lyrics** (timed, from the server or LRCLIB) and the **queue** (jump, remove). Plays in the background with notification and lock-screen controls.
- **Devices tab (remote control):** every online device of the account with what it plays. Tap one and the mini player, Now Playing (play, pause, next, seek, shuffle, repeat, queue, lyrics) and everything you start from the library act on it. *Send* moves this phone's playback there, *Play here* pulls it back.
- **Sync:** the phone is one more player of the account, listed in the other apps, takes their commands and shows what it plays.
- **Settings** like iOS: account, **Sync Server** (status, this phone's name, registered players, forget), **Last.fm** (connect, scrobble, disconnect), **secure sign-in** (trusted devices), **Equalizer** (the phone's own bands), lyrics lookup on or off, **playback quality** for Wi-Fi and mobile data (direct or MP3/AAC from the server), sign out.
- Not in this version: Android Auto, remembering the queue between launches, switching secure sign-in on, the offline cache and downloads, BPM in song lists.

## 0.1.0

First version: sign-in (also with secure sign-in), approving other devices, Home, Library, Search, the player, lyrics, the queue and sync.
