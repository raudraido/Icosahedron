# Android TV app changelog

A native app (Kotlin, Jetpack Compose for TV, Media3) for Google TV and Android TV: [docs/android-tv.md](../../docs/android-tv.md).

## 0.2.3
- **The tile on the Google TV home screen:** the logo was too big and cut off at the top and bottom, with no name. It is now the logo and the name "Icosahedron" side by side on the app's dark background, all of it in view.

## 0.2.2
- **The app icon is the real logo,** a little smaller so that none of its corners is cut: a transparent background and the same logo file the app shows, with no circle or plate behind it.

## 0.2.1
- **The app icon is the bare logo:** a transparent background, no circle or plate behind it, as big as the visible area allows.

## 0.2.0

**The screen is redone.** Install it over 0.1.2 (same signing key).

- **Now Playing is always at the top right** as a small card, like Spotify's: the cover, the song and the artist on two lines, and bars that dance while it plays. It is one step up from wherever you are. It is only there while something plays. The tabs (Home, Albums, Artists, Playlists, Search) and the logo stay on screen too.
- **No strip at the bottom any more:** the card at the top right already shows what plays; pause and next are in the player.
- **Search by voice:** a microphone button in Search (it has the focus when Search opens; Right goes to the text field). Android asks once to allow the microphone. A pulsing microphone and the words as you say them show on the app's own screen, then the search runs; Back cancels. No system search bar pops up.
- **Your profile button** next to it shows your picture (the one you set in another Icosahedron app, kept by the server; the first letter of your name without one) and opens Settings.
- **Back goes one step at a time and never closes the app at once:** out of an album, artist or playlist to the list before it; from anywhere in the content (also far down a 100-song list) up to the top bar; from another tab to Home; on Home a second Back within two seconds closes the app ("Press Back again to exit"). The **Menu** key of the remote opens Now Playing from anywhere.
- **The real logo** instead of a drawn placeholder: in the top bar, on the sign-in screen, as the app icon and on the Google TV home screen tile.
- **The player screen is almost empty:** the cover in the middle on a background that takes its colours from the cover (it changes smoothly with the song), the title and artist under it, a progress bar across the screen and a row of controls (shuffle, previous, play / pause, next, repeat). **Lyrics** and the **queue** open as a panel at the right (Back closes it). Lyrics come from the server if it has them, else from LRCLIB, and the line that is sung is highlighted and followed.
- **Nothing stays lit on an OLED screen:** after 20 seconds without a key press everything but the cover goes (the top bar too; lyrics stay if you are reading them); the first key press only brings it back. The picture also drifts a few pixels over minutes.
- **You can scrub with the progress bar:** it has the focus when the player opens (it grows and shows a round knob, no frame). Left / Right scrub (10 seconds a press, faster when held; the fast-forward and rewind keys jump 30 seconds) and **OK pauses and resumes**.
- **Text you can read:** the active and the focused button no longer lose their text (it was white on white), and headings and song titles are no longer dark on dark. The song that plays is marked with a note.

## 0.1.2

**Fixes the app closing by itself** when you start a song, seen on Android 14 (Chromecast with Google TV). Install it over 0.1.1: the signing key is the same.

- **No more crash when playing.** The playback service was started as a foreground service and Android ended the app when it was not promoted within a few seconds (while the track was still loading). It is started normally now and Android's media notification takes it to the foreground when music plays.

## 0.1.1

Finds the server in more situations. Needs the [server](../server/CHANGELOG.md) 0.16.4 for mDNS.

- **Finds the server with mDNS as well as the broadcast**, so it works when the TV is on another network (a VLAN) than the server and the router forwards mDNS (UniFi: Gateway mDNS Proxy). Both searches run at once.
- **Remembers the server** you used last: the next sign-in starts with it, even after signing out.
- **A clearer message** when no server is found: it says what to try.

## 0.1.0

**The first version.** It plays through the TV, browses your library with the remote and is one more player of your account, so the other apps can start music on it and control it.

### Signing in
- **Quick Connect:** the TV finds your server on the network (or you type its address once), shows a six-digit code, and you enter it in **Settings → Sync Server → Quick Connect** of another Icosahedron app where you are signed in. Needs the [server](../server/CHANGELOG.md) 0.16.0 with `QUICK_CONNECT=true`; finding the server on the network needs its optional discovery container ([docs/quick-connect.md](../../docs/quick-connect.md)).
- Or sign in with the server address, user and password typed with the TV's keyboard (works with any server, also plain Navidrome). Only the salted token is stored, never the password.

### Browsing and playing
- **Home** (recently played, newest, most played, random, shuffle all songs, favourites), **Albums**, **Artists**, **Playlists**, **Search**, and album, artist and playlist pages.
- Play, shuffle, play next and add to queue.
- **Player screen:** cover, progress, previous / play / next, ±10 s, shuffle, repeat and the queue; a mini player on every screen.
- Music goes on when you leave the app (a media session); the server counts your plays.

### A player in your device list
- Appears as a **TV** in the other apps. They can start music on it, play next, add to its queue, seek, change shuffle and repeat, reorder and remove from the queue, and *Send* their playback to it. It publishes its own state, so the other apps show what the TV plays. Players are independent: starting music on the TV does not stop another device.

### Not yet
- Controlling other devices from the TV, lyrics, offline, translations (English only).

### Install
Sideload the `.apk` from the release (Downloader app or `adb`), see [docs/android-tv.md](../../docs/android-tv.md#install-sideload). Until a signing key is set up an update means uninstalling the old version first ([docs/android-tv.md](../../docs/android-tv.md#updating)).
