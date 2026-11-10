# Android TV / Google TV app

A native app (Kotlin, Jetpack Compose for TV, Media3) in `apps/android-tv`. It is one more player of your account: it shows up in the other apps' device lists, takes their commands and plays through the TV, and it also browses and plays your library with the TV remote.

## What it does

- **Sign in** with **Quick Connect**: the TV finds your server on the network (or you type its address once), shows a six-digit code, and you enter it in another Icosahedron app where you are signed in ([quick-connect.md](quick-connect.md)). Typing user and password is the fallback. Only the salted token is stored, never the password.
- **Browse** Home (recent, newest, most played, random), Albums, Artists, Playlists, Search, and album / artist / playlist pages; play, shuffle, play next, add to queue.
- **Player screen:** cover, progress, previous / play / next, ±10 s, shuffle, repeat and the queue.
- **Sync:** appears as a TV in Devices; other apps can start music on it, control it, edit its queue and *Send* their playback to it. It publishes its own state, so the other apps show what the TV plays.
- Background playback through a media session, so the music goes on when you leave the app.

Not yet: controlling other devices from the TV, lyrics, offline, translations (English only).

## Install (sideload)

The APK is attached to every release (`Icosahedron-TV-<version>.apk`).

1. On the TV: Settings → System → About, tap *Build* seven times (developer mode); then Settings → Apps → Security and restrictions → *Install unknown apps* and allow the app you install with.
2. Easiest: install **Downloader** from the Play Store on the TV, open it and enter the APK's URL (the release asset link). Or with `adb`: `adb connect <tv-ip>:5555 && adb install -r Icosahedron-TV-<version>.apk`.
3. Open *Icosahedron* from the apps row and sign in.

## Updating

An APK can update the installed app only if it is signed with the same key. Without the signing secrets CI signs with a throw-away debug key, so a new version has to be installed after uninstalling the old one. To keep one key, create a keystore once and add four repository secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`); the workflow uses them when present.

```bash
keytool -genkeypair -v -keystore release.jks -alias icosahedron -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.jks   # the value of ANDROID_KEYSTORE_BASE64
```

Keep `release.jks` and its passwords safe: losing them means uninstalling and signing in again on every TV.

## Building

CI builds it (`.github/workflows/android.yml`, Gradle 8.10, JDK 17). Locally: open `apps/android-tv` in Android Studio, or run `gradle :app:assembleRelease` (the version comes from `-PversionName` and `-PversionCode`, set by CI from the repository's version).

## Layout

| Path | What |
|---|---|
| `data/` | Models, the Subsonic client, the stored session |
| `player/Playback.kt` | The player (ExoPlayer) and the queue as Compose state; `PlaybackService.kt` the media session |
| `sync/SyncClient.kt` | The sync link: hello (`kind: "tv"`, `proto: 2`), commands, state |
| `ui/` | The screens |
