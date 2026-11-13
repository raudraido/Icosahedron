# Changelog

## 0.19.1
- **Played songs are kept for the next time:** a song you play is also saved on the computer, so it starts at once the next time and plays when the server is away. **Settings → Downloads → Cache** shows how much is kept, sets the limit (off, 512 MB to 10 GB, 1 GB by default) and clears it; over the limit the song played longest ago goes first. Downloaded songs are never touched by the cache, and a cached song you download is kept for good without downloading it again.

## 0.19.0

**Works with server 0.18.x.**

- **Downloads:** keep songs, albums and playlists on this computer so they play without the server. Right-click a song (or several ticked ones), an album card or a playlist and choose **Download** / **Remove Download**; the album page has a download button next to Share. The files are kept in the app's data folder and played from there (through a small server that only listens on this computer), so they start at once and cost no network.
- **A Downloads tab** (next to Favorites) lists the songs, albums and playlists you kept, with Play, Shuffle and Remove, and how much space they use. **Settings → Downloads** shows the same totals and removes everything.
- **Opens without the server:** if the server cannot be reached when the app starts and there are downloads, the app opens on the Downloads tab with a bar "Offline: … Only your downloads play" and a *Try again* button, instead of stopping at the sign-in screen.
- The web app has no downloads (a browser keeps no music for later; use the desktop or the phone apps).

## 0.18.1

**Works with server 0.18.x.**

- **Fixed: a Last.fm connection that is kept on the sync server looked lost after every restart of the desktop app** (Settings → Last.fm showed "Connect" again, and the plays of the first half minute were not scrobbled). At start the app asked the sync server about Last.fm before it had finished signing in, took the missing answer for "no connection" and kept that for 30 seconds. It now does not keep an answer it could not get, and it asks again as soon as the sign-in at start has finished. Nothing was lost on the server: the connection was there all along.

## 0.18.0

**Works with server 0.17.x** (Navidrome's own plugin API, through the sync server).

- **Fixed: a Daily Mix (or any list kept from before) added to the queue played nothing and the seekbar stayed empty** after secure sign-in was switched on. A track kept its stream address with the old sign-in in it, which the server then refused. The address is now made again, with the current sign-in, when a track is played, preloaded, analysed for BPM or drawn as a waveform.

- **Playback speed.** A speed button in the footer bar (next to the equalizer) opens presets from 0.5× to 2×, a slider and Reset; **Alt+Up / Alt+Down** change it by 0.05 (rebindable in Settings → Hotkeys). It is kept on each device. In the web app the pitch stays the same; **in the desktop app the pitch changes with the speed** (keeping it needs a time-stretch step that comes later). The BPM in the footer shows the BPM at the current speed, and the lock-screen / media keys know the rate. The speed does not apply to a cast device.

- **Settings → Navidrome plugins** (for a Navidrome administrator): the plugins installed in Navidrome with their version, author and what they may do (internet, your music files, their own storage), **what uses them** (for example AudioMuse-AI is what Instant Mix needs, nd-lyrics is where lyrics can come from), a switch to turn each on and off, and their settings (drawn from the plugin's own description, secrets such as API tokens hidden). A list at the top shows which features need a plugin and whether it is installed and working. **Rescan** finds a plugin copied into Navidrome's plugins folder. Adding a plugin from the app through the sync server is planned.

## 0.17.0

**Needs server 0.17.0.** Secure sign-in, for people whose server is reachable from the internet: **a new device has to be approved by a device that is already signed in**, so a password alone gets nobody in. It is off until an administrator switches it on (Settings → Sync Server → Secure sign-in), and nothing changes while it is off. The plan: [docs/secure-sign-in.md](docs/secure-sign-in.md); what Navidrome needs: [docs/deploy-server.md](docs/deploy-server.md#secure-sign-in-optional).

- **Signing in to such a server** shows a number and waits: on one of your signed-in devices a prompt asks you to pick that number out of three (or deny it). No device at hand: enter a recovery code, or the code an administrator made for you.
- **The approval prompt** appears in the app (and as a system notification) when another device asks; "It was not me" denies it.
- **Settings → Sync Server → Secure sign-in:** turn it on (you get recovery codes, this device stays signed in), trusted devices with remove, app passwords for apps that cannot ask for approval, new recovery codes, invites for other users, sign-in history, turn off.
- With it on, Users and Share keep working: the native calls use this device's sign-in, since the engine closes the password login.
- If the server address you type is a sync server with secure sign-in, the desktop app also remembers it as its sync server.

## 0.16.6

- **Drum & bass BPM: fewer false corrections.** A track whose genre tag also holds Hip-Hop, Rap, Trap, Reggae or Dancehall is no longer treated as drum & bass (an album tagged "Rap • Hip-Hop • Electronic • Drum & Bass" got 190 BPM for a 95 BPM hip-hop track), and the corrected tempo must now be 160 to 185. A wrong BPM already stored for such a track is corrected by hand in the footer BPM menu.

## 0.16.5

- **Drum & bass BPM.** The tempo tracker found half (about 87) or two thirds (about 116) of the real tempo of drum & bass tracks. When the track's genre says drum & bass (Drum & Bass, DnB, Liquid Funk, Neurofunk, Jungle, Jump Up, Techstep, Darkstep), a BPM of 75 to 100 is now doubled and one of 105 to 127 is multiplied by 1.5, as long as the result is 160 to 190 (later narrowed to 185) (87 becomes 174, 116 becomes 174). Other genres are not touched. Tracks whose BPM was already stored keep their old value; it can be corrected by hand in the footer BPM menu.

## 0.16.4

**Update the server first** (0.16.8), then this app.

- **One click plays a song** in the queue, playlists, albums and the artist's popular songs, instead of a double-click. Tick boxes appear when you hover a row; Shift + click ticks a range, Ctrl/Cmd + click adds one, and a bar above the list plays, queues or adds the ticked songs to a playlist. Same as the web app.
- **On Tour in artist info works again.** Bandsintown no longer gives concert lists to apps like this one (it hands out keys only to approved companies and per artist), so the dates now come from Ticketmaster. Only the artist's own concerts are listed, not tribute acts. Artists Ticketmaster has no dates for show nothing.

## 0.16.3

**Update the server first** (0.16.3), then this app.

- **Profile picture.** A round button at the top right of the queue panel shows who is signed in; click it to add, change or remove your picture (or open Settings). It is the same picture on every device, kept by the sync server, and also in Settings → System → Active Connection.
- **Settings → Users** (for a Navidrome administrator): list accounts with their pictures, add users, reset passwords, change who is an administrator, delete users. The tab that said "coming soon" now works. Other accounts see "only a server administrator can manage users".
- Needs a sync server for the pictures; user management works with plain Navidrome.

## 0.16.2

**Update the server first** (0.16.2), then this app. The Last.fm connection you already made here is now shared with the server.

- **Your Last.fm connection reaches all your devices.** With a sync server, the desktop app hands its existing Last.fm connection to the server once; the server then scrobbles for every device (phone, web, TV) and they all show "Connected as …" without approving again. The desktop stops scrobbling by itself while the server does it, so nothing is counted twice. Disconnecting here disconnects it everywhere. Without a sync server nothing changes.

## 0.16.1

A small addition to Quick Connect. **Update the server first** (0.16.1), then this app; the switch needs it.

- **Quick Connect on/off in Settings → Sync Server** for a server administrator (the code entry stays for everyone while it is on). See the [server changelog](apps/server/CHANGELOG.md).

## 0.16.0

**What's new since 0.15.1.** The desktop app can now work together with your other devices: sync, remote control, a jukebox, signing a TV in with a code. Everything new is **optional**: without a sync server the app behaves as before.

From this release **every app has its own version, release and changelog**: this one is the desktop app (Linux and Windows); the server (with the web app it serves), the iOS app and the Android TV app are separate. The entries below `## 0.16.0` describe the shared releases 0.15.1 to 0.15.9 and cover all apps. See [docs/releasing.md](docs/releasing.md) and [docs/compatibility.md](docs/compatibility.md).

### Your devices work together
Set the address of your sync server once (the **Devices** button next to the cast button) and the desktop app, the web app, the iOS app and the Android TV app see each other. The server is optional: [docs/deploy-server.md](docs/deploy-server.md).

- **Every device with what it plays.** The Devices popover lists all players of your account (desktop, browsers, phone, TV) and what each is doing right now.
- **Players are independent.** Music at home and in the car can play at the same time; starting one never pauses another.
- **Control any device.** Click a device and the **normal bottom bar and queue panel show and control that device**: seek bar and waveform, shuffle, repeat, volume (not for the phone), the queue (click to play, ✕ to remove, drag to reorder). "Controlling X" appears in the corner and the Devices button is highlighted. Play, play next and add to queue from anywhere in the app go to that device. Things that only make sense for this machine (cast, equalizer, stop, BPM analysis, the lyrics and artist tabs, clearing the queue) stay in place but inactive. Choosing a device only controls it.
- **Move your music.** *Send* moves this device's playback to another (the old one pauses, the new one continues at the same position); *Play here* brings another device's music to this one.
- **Jukebox.** **Add to Device Queue** in the track menu: pick a device, then *Play Now*, *Play Next* or *Add to Queue*. Open `/?player=1` of your server on a screen that only plays (a tablet, a spare PC); it registers as "Jukebox" and takes commands from your other devices.
- **Quick Connect.** Sign a TV (or any device with an awkward keyboard) in with a six-digit code: **Settings → Sync Server → Quick Connect**, enter the code the device shows. The server has it off until `QUICK_CONNECT=true`. See [docs/quick-connect.md](docs/quick-connect.md).

### Sync Server settings
**Settings → Sync Server** collects everything about the link:
- join or leave the server (the address), the name of this player, **every registered player** (online or not, last seen; rename, forget the offline ones; players offline for 90 days disappear by themselves);
- **what this player keeps in sync**, per player: playback and remote control, four groups of preferences (appearance, equalizer, library layout, scrobbling and lyrics), BPM, Last.fm through the server;
- clear what the server stores (the queue, the shared preferences).

### Shared between your devices
- **Preferences:** theme and custom themes, equalizer, the scrobble / BPM-detection / lyrics-source toggles, what the left panel shows (Recently Played, Playlists, Daily Mix), tab order, home row order, "show remaining time", Bandsintown, and the artist/album sort choices. Layout that depends on the screen, hotkeys, saved logins, the queue and game scores stay per device. A change from another device reloads the window, or, while music plays, offers a toast so playback is never cut off.
- **BPM:** detections of the native analyzer are stored on the server and read by every player (a manual correction always wins). Your existing local cache is uploaded once.
- **Last.fm through the server:** connect once for all devices; a desktop that already has its own Last.fm session keeps it until the server has one.
- **Equalizer** presets use one format on every platform.

### Casting and AirPlay (0.15.1 and 0.15.2)
- AirPlay 2 casting next to Chromecast and DLNA, with PIN pairing for devices such as the Apple TV (the code shows on the TV; paired devices are remembered).
- Faster start, track change and seek (about 1.3 s instead of 9 to 23 s), no silence after the first track, 96 kHz tracks at the right speed, mono and multichannel converted to stereo, title / artist / cover and a moving seek bar on the TV, the Apple TV remote controls the player, lost connections are noticed.
- Output sync: the player's own speakers are held back so they are heard together with the cast device; **Calibrate** in the cast picker measures the offset with the microphone, a slider sets it by hand, the offset is remembered per device.
- While casting there is a short pause between tracks (a cast device cannot follow gapless playback).

### Smaller things
- The version number is shown in Settings → System → About in every app.
- The desktop reports its playback position in fractions of a second, so other devices show a steadier progress.
- The list of devices keeps a fixed order (this device first, the rest by name); a TV has its own icon.
- The update check now only looks at desktop releases (tags `vX.Y.Z`), since the other apps release separately.

### The other apps (separate versions and changelogs)
- **Server** (engine and web app): [apps/server/CHANGELOG.md](apps/server/CHANGELOG.md), 0.16.0.
- **iOS app:** [apps/ios/CHANGELOG.md](apps/ios/CHANGELOG.md), 0.1.0.
- **Android TV app:** [apps/android-tv/CHANGELOG.md](apps/android-tv/CHANGELOG.md), 0.1.0.

### Updating
Update the **server first** (`docker compose pull && docker compose up -d`), then the apps. An app newer than its server still works for everything the server knows; only the features that need the server are missing.

## 0.15.9

A web fix for controlling a browser player from another device. **Update the server image** (`docker compose pull && docker compose up -d`): it serves the web app. The engine itself is unchanged since 0.15.6.

- **Web: a browser that blocks sound no longer pretends to play.** A browser tab that was reloaded and is then told to play by another device (remote control) is refused by the browser until someone clicks in it. The player now says so ("Your browser blocked playback on this device. Click to play"), shows paused instead of playing, and one click starts it. In Firefox you can also allow audio for the site (the permission icon in the address bar).

## 0.15.8

Controlling another device now uses the normal player bar and queue panel, and the version number is shown in the web and iOS apps. **Update the server image too** (`docker compose pull && docker compose up -d`): it serves the web app. The engine itself is unchanged since 0.15.6.

- **Desktop and web: the same player bar and queue panel for another device.** Controlling another device no longer swaps in a different bar: the normal bar and queue panel show that device's track, position (waveform too), shuffle, repeat, volume and queue, with "Controlling X" in the corner and the devices button highlighted. Cast, equalizer, stop, BPM analysis, the lyrics / artist tabs and clearing the queue stay in place but inactive.
- **The version number is visible everywhere:** in the web app (Settings → System → About) and in the iOS app (Settings → About); the desktop app already showed it.

## 0.15.7

The desktop and web apps get the same "choose a device and control it" as iOS. The engine is unchanged since 0.15.6, so there is nothing to update on the server; update the desktop app (and reload the web app). Design: [docs/connect.md](docs/connect.md).

- **Desktop and web: choose a device and control it.** The devices button lists every device with what it plays; click one and the bottom bar and the queue panel show and control **that** device (seek bar, shuffle, repeat, volume, queue: click to play, ✕ to remove, drag to reorder). Choosing only controls; *Send* moves this device's music there and *Play here* brings its music here. Play, play next and add to queue from anywhere in the app go to the chosen device. The devices button is highlighted with its name. The Now Playing tab and the phone layout still show this device only.
- **iOS: steadier progress while controlling another device.** The bar moves on by itself between the other player's reports and no longer jumps back by a fraction of a second at each report; a state that was already on its way no longer pulls the bar back right after a seek. The desktop reports its position in fractions of a second instead of whole seconds.

## 0.15.6

Players are now **independent**: music at home and in the car can play at the same time, and any device can be chosen and controlled from another. **Update the engine first** (`docker compose pull && docker compose up -d`) and then the iOS app; the desktop and web apps keep working as before (they follow one player only until their own device mode arrives). Design: [docs/connect.md](docs/connect.md).

- **Independent players (engine).** Every player keeps its own playback state; the engine stores them per player and forwards each to the others, so nothing pauses another player and nobody overwrites another's state. `transfer` moves a player's playback to another (`source`, `target`). A player that predates this follows one state only, the player that last started playing. See [docs/sync-protocol.md](docs/sync-protocol.md).
- **iOS: Devices tab and choosing a device.** Every device with what it plays; tap one to control it. Choosing only controls; **Send** moves this phone's music to that device and **Play here** brings its music to this phone.
- **iOS: one player screen for every device.** Choose a device in the new **Devices** tab (or with the devices button in the player) and the player looks the same but shows and controls that device: cover, progress (drag to seek), queue (tap, remove, drag to reorder), lyrics, shuffle, repeat. The devices button is highlighted with the device's name; speed, AirPlay and the equalizer stay in place but inactive while another device is the target. A device with nothing playing shows "Nothing playing on …". Replaces the separate Jukebox screen.
- **Remote control grows:** new commands `shuffle`, `repeat` and `move` (reorder the queue) on the engine, the desktop/web app and iOS; every player now also publishes its shuffle and repeat state. See [docs/sync-protocol.md](docs/sync-protocol.md).
- **iOS: Settings → Sync Server.** Name this phone, see and rename the registered players (forget offline ones), choose what the phone keeps in sync (playback and remote control, equalizer, lyrics source) and clear the queue or preferences the server stores. Needs the 0.15.5 engine.

## 0.15.5

A Sync Server section in the settings, a registry of your players and Last.fm through the server on the desktop. **Update the engine first** (`docker compose pull && docker compose up -d`): the new settings screen and the registry need it; an older engine still works, the registry list just stays empty. The iOS settings screen follows in a later release.

- **Desktop and web: Settings → Sync Server.** Join or leave the sync server (desktop), name this player, see and rename every registered player (forget offline ones), choose per player what it keeps in sync (playback and remote control, four groups of preferences, BPM, Last.fm through the server) and clear the queue or preferences the server stores. See [docs/sync-settings.md](docs/sync-settings.md). The iOS screen follows.
- **Engine: registry of your players.** Each player has a name the engine remembers (renamable), offline players stay in the list and are dropped after 90 days, and the engine can forget a player or wipe the stored playback state / shared settings. A player can connect for preference sync only (`playback:false`). See [docs/sync-protocol.md](docs/sync-protocol.md#registered-players). 
- **Desktop: Last.fm through the engine.** With the engine's address set and a Last.fm connection on the engine, the desktop app scrobbles and shows now-playing through it, so you connect once for all devices. A local desktop session keeps working until the engine has a connection; without an engine nothing changes.

## 0.15.4

Adds the **jukebox**: control another of your devices — queue music on it, play it now, edit its queue and watch its progress — from the desktop app, the web app and the iOS app. It needs the web engine; with plain Navidrome nothing changes.

### Web engine
- New remote commands, validated by the engine: `enqueue` (`now`, `next` or `end`, 1 to 1000 tracks), `jump` and `remove`. Documented in [docs/sync-protocol.md](docs/sync-protocol.md).
- **Update the engine** (`docker compose pull && docker compose up -d`) before using them; an older engine ignores the new commands.

### Desktop and web app
- **Add to Device Queue** in the track menu: pick a device, then *Play Now*, *Play Next* or *Add to Queue*. A short confirmation shows what was sent.
- The devices popover lists the playing device's queue (**Show queue**): click a track to play it, ✕ to remove it.
- **Player-only page** `/?player=1`: shows the current track and the next ones, registers as "Jukebox" and is controlled from your other devices. It asks for one tap only when the browser would block audio. See [docs/web.md](docs/web.md#jukebox).
- The devices list keeps a fixed order (this device first, the rest by name); a reconnect no longer moves a device around.

### iOS app
- New **Jukebox tab**: your devices and what each one is doing. Open the one that is playing for a large cover, a **progress bar you can drag to seek**, previous / play-pause / next and its whole queue (tap a track to play it, swipe to remove).
- **Add to Device Queue** in every track menu (*Play Now*, *Play Next*, *Add to Queue*).
- The playing device can also be controlled from Settings > Devices.
- Fixed: the devices list flickered because the remote state was re-assigned every few seconds even when nothing changed.
- Fixed: devices swapped places in the list after a reconnect (see above).

### Known limits
- `jump` and `remove` use the queue position the controller last saw, so two controllers editing the same queue at once can hit the wrong track.
- Not tested on every browser: `/?player=1` autoplay was tried in Firefox only.

## 0.15.3

This release adds an optional **web engine** that keeps all your players in step, and a **platform layer** that lets the same UI run in a browser and in a new **iOS app**. Nothing changes for the desktop app unless you set up a sync server; every desktop feature below is opt-in.

### Desktop app

#### Sync across your devices (new, optional)
- **Devices button** next to the cast button. The first time you open it you are asked for the address of your web engine (for example `https://music.example.com`); the address is kept on this device and can be cleared by saving an empty value.
- **Device list:** every device signed in with the same Navidrome account (desktop, browser, phone) with its name and kind, and which one is playing.
- **Continue on another device:** the queue and the position are stored on the engine, so a device that connects later can pick up where another left off. **Play here** and **Send** move playback between devices: the old device pauses, the new one loads the queue at the same position and plays.
- **Remote control:** previous, play/pause and next on whichever device is playing, with the track shown in the panel.
- **Only the playing device publishes its state**, so an idle device that just restored its saved queue can never overwrite the one in use. A pause or stop is still published once, and the position refreshes every 3 seconds while playing.
- **Reconnects by itself** with a growing delay; a wrong password (the engine answers with a bad-credentials close) is not retried in a loop. The engine keeps the shared state in files, so it survives restarts.
- **Sign-in uses your Navidrome account:** the app sends a salted Subsonic token, the engine replays it as a `ping` against Navidrome. The engine never sees or stores your password.

#### Shared preferences
These keep in step between your devices through the engine: theme and custom themes, equalizer, the scrobble / BPM-detection / lyrics-source toggles, whether the left panel shows Recently Played, Playlists and Daily Mix, tab order, home row order, "show remaining time", Bandsintown, and the artist/album sort choices.
- Layout that depends on the screen (panel and column widths), hotkeys, saved logins, the play queue and game scores stay per device.
- A change from another device is written to local storage and the window is reloaded to pick it up. While music plays, a small toast offers the reload instead, so playback is never cut off. Automatic reloads happen at most once a minute.
- The first device to connect to an engine with no preferences uploads its own; later devices adopt what the engine holds.

#### BPM is stored on the engine
- Detections made by the native analyzer are uploaded; every other player reads them. Detection stays on the desktop (the engine only stores).
- Your existing local BPM cache is uploaded once in one request the first time the app connects.
- A manual correction always wins over a detected value.

#### Equalizer
- The equalizer settings use the shared `eq_settings` format, so a preset saved on one platform appears on the others after sync. Bands, Q and ranges are unchanged (ISO octaves 31 Hz to 16 kHz, Q 1.1, ±12 dB, preamp −12 to +6 dB).

### Web app (new)
The same UI, served by the engine and installable as a PWA.
- Sign-in with your Navidrome account; stays signed in on the device by default and needs no server address (it is the site itself).
- Playback with one persistent audio element, Media Session (lock-screen / notification controls, now-playing info, cover art as a `data:` URL), browser **equalizer** (WebAudio, same bands as the desktop; not on iOS Safari), Last.fm through the engine, BPM, shared preferences, the device list and remote control.
- Installable: manifest, 192/512 px and maskable icons, apple-touch-icon, an offline UI shell (API, streams and sync always use the network).
- A basic phone layout (header, bottom tabs, mini player, full-screen player; `?layout=mobile|desktop|auto` forces one).
- Known limits: no gapless between tracks (one audio element), and iOS Safari does not show title and cover on the lock screen for any web page we tried; use the iOS app for that.

### iOS app (new, SwiftUI, iOS 26.1 or later, iPhone and iPad)
Built by the `iOS build` workflow as an unsigned `.ipa` (sign it with AltStore, SideStore or Sideloadly).
- **Playback:** gapless, instant start, background audio, lock screen and Dynamic Island, playback speed 0.5× to 2× with "Keep Pitch", 10-band equalizer, queue with drag-to-reorder, AirPlay.
- **Now Playing:** blurred cover background, "1 of N" and remaining time, favorite heart, "…" menu, info and synced lyrics under a cover that shrinks to the corner, quality line, landscape and iPad two-column layout.
- **Library:** Artists, Albums, Newest, Recently Played, Songs, Favorites, Cached Songs, Directories, Playlists, Radios; Search; track menu (play next, add to queue, Instant Mix, show album/artist, keep offline, favorite, rating, share, add to playlist, info).
- **Offline:** background cache (the next track is fetched in full ahead of time; size set in Settings), "Keep Offline" for songs you want to keep for good, "Cached Songs" works without a connection.
- **Quality per connection:** separate Wi-Fi and Cellular profiles (direct play, or MP3/AAC 96 to 320 kbps transcoded by your Navidrome); Low Data Mode counts as cellular; nothing is downloaded in the background on cellular unless allowed.
- **Plays:** counted after half the track or 4 minutes, stored on disk first and sent when online with their real time; Last.fm through the engine.
- **Playlists:** create, rename, delete, reorder, remove tracks, save the queue as a playlist.
- **Siri and Shortcuts** (no extension needed): play/pause, next, previous, shuffle my music, play my favorites, favorite the current song, play a search result.
- Estonian translation, accessibility labels, shared preferences (lyrics lookup and equalizer).

### Web engine (`apps/server`)
- Node 22 container: WebSocket sync hub (`/sync`), same-origin Navidrome proxy (`/rest`, `/api`, `/auth`, Range requests supported), BPM store (`/bpm`, bulk upload), Last.fm (`/lastfm/*`, the API secret and each account's session key live on the engine, session file mode 600), static web UI.
- Configuration by environment: `NAVIDROME_URL`, optional `LASTFM_API_KEY` and `LASTFM_API_SECRET`, `DATA_DIR`, `PORT`. See `apps/server/docker-compose.example.yml`.
- 12 automated tests (`npm test` in `apps/server`).

### Under the hood
- The UI no longer talks to Electron directly: all access goes through `src/platform` (an Electron adapter and a browser adapter), including cover URLs and the new `sync_auth` command.
- The Subsonic client and its models moved to `src/lib/subsonic` and are shared between the Electron main process and the browser (MD5 now comes from the `md5` package).
- `electron/` and `tsconfig.json` no longer reference each other as TypeScript project references.

### Notes
- If your Navidrome is also linked to Last.fm and you scrobble through the engine too, a play can be counted twice.
- If the engine is exposed to the internet without a login proxy in front, the Navidrome password is the only protection; consider rate-limiting `/auth/` and `/rest/ping`.

## 0.15.2

### AirPlay (Apple TV)
- **Pairing:** the PIN now appears on the Apple TV (it refused the request that makes it show the code).
- **Faster start, track change and seek:** playback starts while the track is still downloading, and changing track or seeking takes about 1.3 s instead of 9–23 s. Fast skipping and dragging the seek bar no longer pile up restarts.
- **No more silence after the first track:** the stream now continues the receiver's timeline across tracks, so the Apple TV no longer stays silent for as long as the previous track had played, and the second track no longer fails with "Cannot process phase 1".
- **Hi-res and unusual sources:** 96 kHz tracks no longer play at about twice the speed; mono and multichannel sources are converted to stereo.
- **Now playing on the TV:** title, artist, cover art and a moving seek bar.
- **Apple TV remote works:** play, pause, next and scrubbing on the remote now control the player.
- **Lost connections are noticed:** if the Apple TV drops the connection, the cast picker shows it as disconnected instead of silently failing.

### Output sync
- The player's own speakers are now held back so they are heard together with the cast device (a cast device plays a stream a moment after it is sent). Start, pause/resume and seek all stay lined up.
- **Calibrate** in the cast picker measures the offset with the microphone (the cast device and the player each play short test tones); a slider sets it by hand. The offset is remembered per device; an uncalibrated AirPlay device starts at 150 ms.

### Cast picker
- The panel no longer grows out of the window while devices are being discovered: it opens upward and stays on screen.

### Notes
- While casting, gapless playback is off (a cast device can't follow it), so there is a short pause between tracks, as with any cast.
- The AirPlay library is now our `airplay2-rs` fork (upstream plus fixes proposed in lmcgartland/airplay2-rs #15–#23); the vendored copy of `airplay-audio` is gone because the fork carries the same Windows build fix.

## 0.15.1

- AirPlay 2 casting alongside Chromecast and DLNA; seeking during AirPlay playback.
- PIN-paired devices (e.g. Apple TV): the device shows the code, the cast picker has an inline field for it, and paired devices are remembered.
