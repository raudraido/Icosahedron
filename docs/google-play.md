# Publishing the Android phone app on Google Play

Status: the account exists (organization); nothing is published yet. The app stays on GitHub releases as a pre-release meanwhile. The TV app (`cloud.icosahedron.tv`) is a **separate app** with its own listing and review, done later the same way: Google TV's store only offers apps that are made for TV.

## The plan

1. **Internal testing first** (up to 100 testers, no review, ready in hours): check that the app installs and works from Play.
2. **Production** after that, with the store listing, privacy policy and review access below.

The 12-testers-for-14-days rule applies to *personal* accounts made after 2023, not to organization accounts.

## One-time setup

### 1. The upload key

Google signs the app that users get (**Play App Signing**). We sign the bundle we upload with an **upload key**; if it is ever lost, Google can reset it. The GitHub APK keeps its own key, so the Play version and the GitHub APK cannot update each other (uninstall one to install the other).

Make the upload key on any computer with a JDK and keep the file safe:

```bash
keytool -genkeypair -v -keystore play-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 play-upload.jks      # the value for the first secret below
```

GitHub → repository → *Settings → Secrets and variables → Actions*, four secrets:

| Secret | Value |
|---|---|
| `PLAY_UPLOAD_KEYSTORE_BASE64` | the base64 text of `play-upload.jks` |
| `PLAY_UPLOAD_KEYSTORE_PASSWORD` | the keystore password |
| `PLAY_UPLOAD_KEY_ALIAS` | `upload` |
| `PLAY_UPLOAD_KEY_PASSWORD` | the key password |

With them, every build of the *Android phone build* workflow also makes `Icosahedron-Android-X.Y.Z.aab` (a workflow artifact named *Icosahedron-Android-aab*; it is not attached to the GitHub release). Without them the step is skipped.

### 2. Create the app in the Play Console

*Create app*: name **Icosahedron**, default language English (United States), *App*, *Free*. Package name `cloud.icosahedron.phone` is fixed by the first upload and cannot change later. Accept Play App Signing when the first bundle is uploaded.

### 3. Testing and release

*Testing → Internal testing → Create release →* upload the `.aab` from the workflow run, release notes from the changelog, add the testers' e-mail addresses (a list), save, and open the opt-in link on a phone. Each upload needs a higher `versionCode` (the release workflow does this: 0.1.24 → 124).

## Store listing

Short description (80 characters):

> A music player for your own Navidrome server: sync, remote control, offline.

Full description:

> Icosahedron plays the music on **your own Navidrome server**. It is made for people who run their own music library.
>
> • Browse artists, albums, playlists, songs, folders and internet radio; search; lyrics (timed)
> • Gapless playback, equalizer, speed 0.5×–2× with the pitch kept, plays in the background
> • Download albums and playlists for offline listening, or let played songs be cached
> • Your devices work together: see what plays on each, control one from another, move playback with Send and Play here
> • Secure sign-in: a new device is approved from one that is already signed in
> • Android Auto, a layout for big screens and cars
> • Last.fm scrobbling through the Icosahedron server (optional)
>
> You need a Navidrome server (and for sync and Last.fm, the Icosahedron server). The app comes with no music of its own.

Estonian (*et*):

> **Icosahedron** mängib muusikat sinu enda Navidrome'i serverist.
>
> • Artistid, albumid, esitusloendid, laulud, kaustad ja internetiraadiod; otsing; sünkroonitud sõnad
> • Katkestusteta mäng, ekvalaiser, kiirus 0,5×–2× helikõrgust muutmata, mängib taustal
> • Albumid ja esitusloendid võrguta kuulamiseks; mängitud lood salvestuvad vahemällu
> • Seadmed töötavad koos: näe, mis kus mängib, juhi ühest teisest, Send / Play here
> • Turvaline sisselogimine: uue seadme kinnitad juba sisse logitud seadmest
> • Android Auto, lai paigutus tahvlile ja autole
> • Last.fm (valikuline, Icosahedroni serveri kaudu)
>
> Vaja on Navidrome'i serverit. Äpil endal muusikat kaasas ei ole.

Graphics:

| Item | Size |
|---|---|
| App icon | 512 × 512 PNG, 32-bit, up to 1 MB (the launcher icon, no rounded corners of its own) |
| Feature graphic | 1024 × 500 PNG or JPG |
| Phone screenshots | at least 2, up to 8, 16:9 or 9:16, 320–3840 px on a side. Suggested: Home, Library, Album, Now Playing, Devices, Downloads |
| 7" and 10" tablet screenshots | recommended (the wide layout) |

## Forms in the Play Console (suggested answers; check them against what the form asks at the time)

- **Privacy policy URL:** `https://github.com/raudraido/Icosahedron/blob/master/docs/privacy.md` ([privacy.md](privacy.md)). It can be moved to the website (raud.cloud) later; the URL then changes in the listing.
- **App access → restricted.** Give the reviewers a **demo server and account** (below). Without it the app cannot be signed in and the review fails.
- **Ads:** none.
- **Target audience:** 13+ or 18+, not for children. **Content rating:** answer the questionnaire as a music player with no user-generated content shared between users: usually *Everyone / PEGI 3*.
- **Data safety:** no data is sent to the developer. What the app sends goes to the server the user types in. Google asks about data "collected", which includes data sent to a server run by the user or others, so answer conservatively: **Personal info** (user name), **App activity** (plays, in-app history), **Photos** (the optional profile picture, uploaded to the user's server) are collected, **not shared**, **encrypted in transit** if the server uses https (say "no" if http is allowed, as a self-hosted server may use plain http), and **users can ask for deletion** (by the server owner). No data is shared with third parties by the app. Check the exact wording when filling the form.
- **Foreground service permission (mediaPlayback):** *Music playback in the background.* A short demo video (screen recording: start a song, leave the app, the notification and sound continue) is asked for.
- **Permissions:** `POST_NOTIFICATIONS`, `WAKE_LOCK`, multicast (server discovery); nothing sensitive.
- **Government app / financial / health:** no.
- **News app:** no. **COVID-19:** no.

## Demo server for the reviewers

A small Navidrome with ten songs by Kevin MacLeod (incompetech.com, Creative Commons Attribution 4.0, credits in `CREDITS.txt` in the music folder) and a **public non-admin account**. Not the real library, not a real account. It runs on the Docker host as the container `navidrome-demo` (folder `~/icosahedron-demo`: `docker-compose.yml`, `music/`, `data/`), listening on port **4534** on the LAN.

| | |
|---|---|
| LAN address | `http://10.0.0.18:4534` |
| Account for the reviewers | user `reviewer`, password `icosahedron-review` (not an admin; safe to publish) |
| Admin (private) | user `demo-admin`, the password is kept with the upload key, not here |

**To make it reachable for Google** (the reviewers are outside the LAN): add a DNS record (for example `demo.raud.cloud`) and a proxy host in Nginx Proxy Manager from `https://demo.raud.cloud` to `http://10.0.0.18:4534` with a Let's Encrypt certificate, then use that address below. Until then Google cannot sign in.

Text for *App access → Instructions* (replace the address if it differs):

> The app needs a Navidrome music server. Use this demo server: address **https://demo.raud.cloud**, user name **reviewer**, password **icosahedron-review**. Sign in, open *Library → Songs*, tap a song to play it, then tap the player at the bottom to open Now Playing. No other account is needed. The demo library has ten Creative Commons songs.

Test it before submitting: sign in from a phone that is **not** on the home Wi-Fi.

```yaml
# ~/icosahedron-demo/docker-compose.yml
services:
  navidrome-demo:
    image: deluan/navidrome:latest
    container_name: navidrome-demo
    restart: unless-stopped
    ports: ["4534:4533"]
    volumes: ["./music:/music:ro", "./data:/data"]
    environment: { ND_SCANSCHEDULE: 1h, ND_SESSIONTIMEOUT: 24h }
```

## Later

- **Updates:** each release makes a new `.aab`; upload it to the track (*Internal → Closed → Production*), or later with the Play API from the workflow.
- **Target API:** Google raises the minimum every year (August); the app targets 35 and must be rebuilt for the new level in time.
- **TV:** a separate listing for `cloud.icosahedron.tv` (TV banner, D-pad, the *TV* form factor in the Play Console).
