# Android phone app

Native app (Kotlin, Jetpack Compose, Media3) in [`apps/android`](../apps/android), made to look and work like the [iOS app](ios.md). It plays on the phone, browses the library, shows up as a device in the other apps and approves sign-ins when secure sign-in is on ([secure-sign-in.md](secure-sign-in.md)). The TV has its own app: [android-tv.md](android-tv.md).

Needs Android 8.0 (API 26) or newer.

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

## Android Auto

The app is a media app for Android Auto: the browse tree (Recently played, Playlists, Albums, Artists, Random mix), search and the player come from `PlaybackService` (a Media3 `MediaLibraryService`), so the car screen, Bluetooth controls and the Assistant all use the same library.

Because the app is installed from an APK and not from Google Play, Android Auto hides it until you allow it: on the phone open **Settings → Connected devices → Connection preferences → Android Auto**, tap the version number ten times to switch on developer settings, then in the three-dot menu **Developer settings** switch on **Unknown sources**.

Without a car: install the **Android Auto Desktop Head Unit** (Android Studio → SDK Manager → SDK Tools → *Android Auto Desktop Head Unit Emulator*), start *Head unit server* in Android Auto's developer settings on the phone and run `desktop-head-unit` on the computer with the phone connected over USB.
