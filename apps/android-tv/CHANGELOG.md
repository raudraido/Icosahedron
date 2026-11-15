# Android TV app changelog

A native app (Kotlin, Jetpack Compose for TV, Media3) for Google TV and Android TV: [docs/android-tv.md](../../docs/android-tv.md).

## Unreleased
- **The screensaver puts the TV into its HDR mode** with a tiny silent black HDR video in the corner (like YouTube does), so an OLED has the black pixels really off and only the picture shines.

## 0.2.9
- **A darker screensaver:** while it is on, the app asks the TV for the lowest screen brightness and the HDR colour mode, to get the OLED pixels around the logo to really switch off.

## 0.2.8
- **Screensaver:** after the minutes you choose without a key press (1–10, in Settings, can be turned off) the screen goes black with the small logo that moves to another place every half minute, so nothing burns into an OLED screen. Five more styles to choose in Settings: **Clock**, **Playing cover**, **Cover mosaic** (random albums from your library), **Pulsing logo** (beats while music plays) and **Song text**; everything keeps moving. It does not start while the lyrics are open. The first key press only wakes the screen.

## 0.2.7
- **A long queue no longer traps the remote:** on Now Playing, with the queue open, **Left** jumps to the play button from anywhere in the list (no more pressing Down through hundreds of songs to reach the controls). Coming back into the list (Up or Right from the controls) lands on the song that is playing, not on the first one. The queue's heading shows the number of songs and the hint.
- **The song menu no longer runs the first item when you let go:** holding OK opens the menu, but letting the button go counted as a click on *Play next*. The release of the hold is now ignored.

## 0.2.6
- **Hold OK on any song** (in an album, a playlist, search, the queue, the artist's songs) to open its menu: **Play next**, **Add to queue**, **Go to album**, **Go to artist**, **Add to playlist** (choose the playlist) and **Favorite**.
- **An album's songs show their covers too** (with the track number at the left), and **the album page has the coloured background of Now Playing,** taken from the album's own cover.
- **More room for the queue on Now Playing:** the queue is wider (the song titles and the artists are no longer cut), and while the queue or the lyrics are open the cover and the title move to the left edge instead of sitting in the middle of a smaller space; the lyrics got a little more room too.

## 0.2.5
- **Lists look better:** the song rows have no grey bar any more. The row with the focus gets a soft light background, grows a little and has an accent mark at its left; at the left of each row is the song's **cover** (the playing one has the dancing bars on it; an album's songs show their numbers instead, as the cover is the same), then the title with "artist · album" under it and the length. This is the same in the queue on Now Playing, in search, in the popular songs, in playlists and in the artist's songs.
- **Album, playlist and artist-songs pages have two parts:** the cover, the name and the buttons stay at the left, only the songs scroll at the right.
- **Artists are shown like albums:** the same four-column grid, each with the artist's **round picture** (the first letter when the server has none), the name and the number of albums.
- **Settings → Rename this TV:** the name the other devices see for this TV (in Devices and in the control lists) can be changed here; the sync server keeps it.

## 0.2.4
- **Sort and Filter on Albums, Artists and Playlists,** like on the phones: two buttons over the list open a list of choices (OK picks, Back closes). Albums: sort by name, album artist, date added, most played, recently played, random or release year; filter by favorites, decade or genre. Artists: sort by name, most albums or random; filter by favorites. Playlists: sort by name, most songs or fewest songs. The page remembers the last choice while the app runs.
- **A real artist page,** like on the phones: the picture, the number of albums and songs, **Play**, **Shuffle**, **Play next** and **Add to queue** for *all* the artist's songs (the compilations and guest appearances too), the **biography** (press OK to open or close the whole text), the **popular songs**, rows of **Albums**, **Singles & EPs**, **Compilations** and **Appears on** (newest first), and the **similar artists** that are in your library. **All songs** opens every song of the artist in album order. The text, the popular songs and the similar artists come from what Navidrome is set up to use (Last.fm, Spotify) and are left out when it has none; the songs of the whole artist, the compilations and "Appears on" need the Icosahedron server (the TV has no password to give to Navidrome's own API), without it the artist's own albums are shown and Play uses their songs.

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
