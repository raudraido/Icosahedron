# Android phone app

Native app (Kotlin, Jetpack Compose, Media3) in [`apps/android`](../apps/android), made to look and work like the [iOS app](ios.md). It plays on the phone, browses the library, shows up as a device in the other apps and approves sign-ins when secure sign-in is on ([secure-sign-in.md](secure-sign-in.md)). The TV has its own app: [android-tv.md](android-tv.md).

Needs Android 8.0 (API 26) or newer.

## What it does

- **Sign in** with the server address (found on the network when it is near); with **secure sign-in** on the phone shows a number to be approved on a device that is already signed in, and it approves other devices' sign-ins itself (a card over everything, a notification in the background). It can switch secure sign-in on and off and shows the trusted devices.
- **Home** (a quick-button row with Random mix, Discover, Recently played, Newest, Most played, Playlists, each with *See all*), **Library** (Albums and Artists with sort, filters, grid or list and a letter index; Playlists; **Favorite Songs**; **Downloads**) that remembers how you left it, and search.
- **One menu for songs, albums and playlists** (the ⋮ button, a long press): Play Next, Add to Queue, Add to Device Queue, Download, Favorite, Add to Playlist, Share, Show Album / Artist, Rename / Delete.
- **Now Playing:** cover colours, seek bar with the times at its ends, lyrics (timed), the queue, the song's details (tap the cover), speed 0.5×–2× with the pitch kept, the favorite heart; pull it down from anywhere to close it. Built to be used in a car: big targets, words under the icons.
- **Devices:** every device of your account and what it plays; tap one to control it (everything you play then starts there), *Send* and *Play here*.
- **Downloads and cache:** see below. **Remembers the queue.** **Plays in the background.**
- **Wide screens** (a tablet, a phone on its side, a car): the tabs are a big rail at the left with the round cover and a progress ring at its bottom (tap: Now Playing, long press: play / pause), album and playlist pages keep the cover and buttons at the left, Now Playing splits in two.
- **Android Auto**: see below. Settings: Sync Server, Last.fm, Equalizer, lyrics, playback quality for Wi-Fi and mobile data, Downloads and cache, the profile picture.

## Install

Every `android-phone-vX.Y.Z` release has `Icosahedron-Android-X.Y.Z.apk`. Open it on the phone (allow installing from your browser or files app once). Without a fixed signing key (the `ANDROID_KEYSTORE_*` secrets, the same as for the TV app) an update needs the old app uninstalled first.

## Build and test with Android Studio

1. Install Android Studio (it brings the JDK 17 and the SDK).
2. *Open* the folder `apps/android`. Let Gradle sync.
3. Run it on an emulator (Device Manager, any phone with API 26+) or on a phone with USB debugging on.

From the command line: `gradle :app:assembleRelease -PversionName=0.1.0 -PversionCode=100` (Gradle 8.10, JDK 17, Android SDK 35) writes `app/build/outputs/apk/release/app-release.apk`. An emulator reaches a server on your computer as `http://10.0.2.2:<port>`.

## Code

| Folder | What |
|---|---|
| `data/` | Subsonic client, sign-in session, secure sign-in (`/device` calls), lyrics, server discovery |
| `player/` | one ExoPlayer for the process, the queue, the media session service |
| `sync/` | the sync hub link ([sync-protocol.md](sync-protocol.md)), including sign-in approval requests |
| `ui/` | Compose screens: sign-in, home, library, search, details, Now Playing, settings |

The data, player and sync layers are the same as the TV app's, with the phone as device kind `mobile`.

## Offline and downloads

`player/Offline.kt` keeps two caches on disk (Media3 `SimpleCache`): the **cache** in the app cache folder (what is played and the next song, the oldest removed over the limit in Settings → Offline) and the **kept** songs in the app files (never evicted, listed in `kept.json`). The player reads kept songs first, then the cache, then the network. Keys are the song id plus the quality, or `kept:<id>` for kept songs, so a change of quality does not hide a kept song. On mobile data nothing is written to the cache or downloaded unless allowed.

## Android Auto

The app is a media app for Android Auto: the browse tree (Recently played, Playlists, Albums, Artists, Random mix), search and the player come from `PlaybackService` (a Media3 `MediaLibraryService`), so the car screen, Bluetooth controls and the Assistant all use the same library.

Because the app is installed from an APK and not from Google Play, Android Auto hides it until you allow it: on the phone open **Settings → Connected devices → Connection preferences → Android Auto**, tap the version number ten times to switch on developer settings, then in the three-dot menu **Developer settings** switch on **Unknown sources**.

Without a car: install the **Android Auto Desktop Head Unit** (Android Studio → SDK Manager → SDK Tools → *Android Auto Desktop Head Unit Emulator*), start *Head unit server* in Android Auto's developer settings on the phone and run `desktop-head-unit` on the computer with the phone connected over USB.

## Google Play (not published yet)

The app is installed from a GitHub release for now. What publishing needs (checked 2026-11, confirm in the Play Console):

- A **Play Console account** (25 USD once). An organization account needs a **D-U-N-S number** and a verified website; a personal account made after 2023 must first run a **closed test with at least 12 testers for 14 days**. The account declares its **trader status** (an organization is a trader under the EU rules).
- An **Android App Bundle** (`.aab`) instead of the APK, and **Play App Signing**: Google signs the store version, so it is signed differently from the GitHub APK (a user has to uninstall one to install the other).
- A **target API level** that meets Google's yearly requirement (the app targets 35; check what is asked now).
- The store listing: icon, feature graphic, screenshots, descriptions, a **privacy policy URL**, the Data safety form, the content rating, and the declaration for the media-playback foreground service.
- **Test access for the reviewers:** the app is useless without a Navidrome server, so a demo server and account must be given in the *App access* form.
