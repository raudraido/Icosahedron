# Android TV app changelog

A native app (Kotlin, Jetpack Compose for TV, Media3) for Google TV and Android TV: [docs/android-tv.md](../../docs/android-tv.md).

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
