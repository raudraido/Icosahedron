# Android TV / Google TV app

A native app (Kotlin, Jetpack Compose for TV, Media3) in `apps/android-tv`. It is one more player of your account: it shows up in the other apps' device lists, takes their commands and plays through the TV, and it also browses and plays your library with the TV remote.

## What it does

- **Sign in** with **Quick Connect**: the TV finds your server on the network (or you type its address once), shows a six-digit code, and you enter it in another Icosahedron app where you are signed in ([quick-connect.md](quick-connect.md)). Typing user and password is the fallback. Only the salted token is stored, never the password.
- **Browse** Home (recent, newest, most played, random), Albums, Artists, Playlists, Search, and album / artist / playlist pages; play, shuffle, play next, add to queue.
- **Player screen:** cover, progress, previous / play / next, ±10 s, shuffle, repeat and the queue.
- **Sync:** appears as a TV in Devices; other apps can start music on it, control it, edit its queue and *Send* their playback to it. It publishes its own state, so the other apps show what the TV plays.
- Background playback through a media session, so the music goes on when you leave the app.

With secure sign-in on, Quick Connect gives the TV its own trusted device (not yet tried on a real TV).

Not yet: controlling other devices from the TV, lyrics, offline, translations (English only).

## Install (sideload)

The APK is attached to every release (`Icosahedron-TV-<version>.apk`).

1. On the TV: Settings → System → About, tap *Build* seven times (developer mode); then Settings → Apps → Security and restrictions → *Install unknown apps* and allow the app you install with.
2. Easiest: install **Downloader** from the Play Store on the TV, open it and enter the APK's URL (the release asset link). Or with `adb`: `adb connect <tv-ip>:5555 && adb install -r Icosahedron-TV-<version>.apk`.
3. Open *Icosahedron* from the apps row and sign in.

## Updating and the signing key

An APK can update the installed app only if it is signed with the same key. Releases from **0.1.1** on are signed with one permanent key, so a new version installs over the old one. **0.1.0 was signed with a throw-away debug key: uninstall it once before installing 0.1.1 or later.**

### The key and where it is

| What | Where |
|---|---|
| The key | A PKCS12 keystore `release.p12`: RSA 4096, alias `icosahedron`, certificate `CN=Icosahedron TV, O=raudraido`, valid until 2126-10-17. Made on 2026-11-10 with `openssl` |
| Fingerprint (SHA-256 of the certificate) | `99:C3:63:19:33:F5:63:76:A0:BD:F2:52:FA:11:A8:4D:01:02:90:43:69:31:7F:26:E0:F7:C3:24:57:D5:9B:DF` |
| CI | Four repository secrets (Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_BASE64` (the keystore, base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` (the same value as the store password, as a PKCS12 file needs), `ANDROID_KEY_ALIAS` (`icosahedron`). `android.yml` uses them when present and signs with the debug key when not |
| The only copy of the key | The maintainer's dev container: `~/.icosahedron-android-signing/` (`release.p12`, `cert.pem`, `passwords.txt`, mode 600). **Not in the repository, and GitHub cannot show secrets again**, so keep a backup elsewhere (a password manager or an encrypted disk) |

The key and the passwords are never committed and never written in docs or issues.

### Check that a release has the right signature

The fingerprint of the signing certificate in the APK must equal the one above. With the Android SDK: `apksigner verify --print-certs Icosahedron-TV-X.Y.Z.apk` (look for the SHA-256 digest). 0.1.1 was checked by reading the certificate from the APK's signing block and it matched.

### If the key is lost or must be replaced

Nothing breaks for the repository, but every TV has to uninstall the app and install the new build once (the new key differs, so Android refuses the update), and sign in again. To make a new key:

```bash
openssl req -x509 -newkey rsa:4096 -sha256 -days 36500 -nodes -keyout key.pem -out cert.pem -subj "/CN=Icosahedron TV/O=raudraido"
PW=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)
openssl pkcs12 -export -inkey key.pem -in cert.pem -name icosahedron -out release.p12 -passout pass:$PW
base64 -w0 release.p12 | gh secret set ANDROID_KEYSTORE_BASE64
printf %s "$PW" | gh secret set ANDROID_KEYSTORE_PASSWORD
printf %s "$PW" | gh secret set ANDROID_KEY_PASSWORD
printf %s icosahedron | gh secret set ANDROID_KEY_ALIAS
```

(`keytool -genkeypair` from a JDK works too, but then the key password is whatever you chose.) Delete `key.pem` afterwards, back up `release.p12` and the password, and update the fingerprint in this file.

## Building

CI builds it (`.github/workflows/android.yml`, Gradle 8.10, JDK 17). Locally: open `apps/android-tv` in Android Studio, or run `gradle :app:assembleRelease` (the version comes from `-PversionName` and `-PversionCode`, set by CI from the repository's version).

## Layout

| Path | What |
|---|---|
| `data/` | Models, the Subsonic client, the stored session |
| `player/Playback.kt` | The player (ExoPlayer) and the queue as Compose state; `PlaybackService.kt` the media session |
| `sync/SyncClient.kt` | The sync link: hello (`kind: "tv"`, `proto: 2`), commands, state |
| `ui/` | The screens |
