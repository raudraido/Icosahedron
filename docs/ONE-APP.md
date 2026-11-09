# ONE APP TO RULE THEM ALL — kokkuvõte

Icosahedron (Navidrome/Subsonic muusikapleier) kõigil platvormidel, kõik sünkroonis.
Töö on harul `feat/platform-adapter` (GitHub: raudraido/Icosahedron), **masterisse merge'imata**.

## Arhitektuur

```
                         ┌──────────────────────────────┐
 Electron (desktop) ───► │  Veebimootor (Docker)        │ ◄─── Veeb / PWA (brauser)
 iOS (SwiftUI)      ───► │  apps/server, 10.0.0.18:8484 │
                         │  • sünkroonihub  /sync (WS)  │
                         │  • Navidrome proxy           │ ───► Navidrome (docker_network)
                         │  • BPM talletus  /bpm        │
                         │  • Last.fm       /lastfm/*   │
                         │  • veebi-UI + PWA            │
                         └──────────────────────────────┘
                              https://music.raud.cloud
```

Kasutaja = Navidrome'i konto. Klient saadab Subsonic-tokeni, server kontrollib seda Navidrome'i `ping`iga; servers ei hoita paroole.

## Komponendid ja seis

### Veebimootor (`apps/server`) — töötab, deploynud
- **Sünkroon (`/sync`, WebSocket):** järjekord, positsioon, kaugjuhtimine (play/pause/seek/next/prev), mängimise üleandmine ("Play here"), seadete plokk. Seis kettal: `~/icosahedron-server/data/`.
- **Navidrome proxy** (`/rest`, `/api`, `/auth`): sama päritolu, Range-päringud töötavad.
- **BPM** (`/bpm`): server ainult talletab; desktop tuvastab ja laeb üles, teised loevad. Käsitsi parandus võidab tuvastatud väärtuse.
- **Last.fm** (`/lastfm/*`): API saladus ja kasutaja sessioonivõti on serveris (`lastfm.json`, õigused 600). Saladus on **ainult hosti compose-failis** (`LASTFM_API_KEY/SECRET`), mitte repos (vanas desktopi koodis on see siiski kirjas).
- 12 testi (`npm test` kaustas `apps/server`).
- **Deploy:** repo tar → `ssh ubuntu-18` → `~/icosahedron-src` → `docker compose -p icosahedron-server up -d --build` kaustas `apps/server`. Hosti `docker-compose.yml` (Last.fm võti) tuleb säilitada.

### Veeb (brauser, PWA)
- Sama React-UI, `src/platform/` adapter (Electron vs veeb), Subsonic-klient jagatud (`src/lib/subsonic`).
- PWA (manifest, Service Worker), Media Session, seadete sünkroon (whitelist `localStorage` võtmeid), BPM, Last.fm, **EQ (WebAudio, uus)**.
- Mobiilivaade (`src/mobile`) on esialgne; kasutaja sõnul pole oluline.
- **iOS Safari lukuekraan** ei näita pealkirja/pilti (isegi minimaalne `/mstest.html` ei tööta; Chrome/Firefox iPhone'is töötavad). Lahendus on natiivne rakendus.

### Desktop (Electron)
- Töötab nagu enne, nüüd adapteri taga. Sünkroonserveri aadress sisestatakse seadmete nupu all.
- Natiivne Rust-EQ (10 riba) ja gapless olid juba olemas. Last.fm on endiselt **kohalik** (mitte serveri kaudu), nii et sama kuulamine võib kaks korda loenduda, kui ühendad ka mujal.

### iOS (`apps/ios`) — SwiftUI, iOS 26.1+, iPhone ja iPad
- **Mängimine:** gapless (AVQueuePlayer), kohene algus, taustaheli, lukuekraan/Dynamic Island, kiirus 0,5–2× koos *Keep Pitch*, **EQ (10 riba, MTAudioProcessingTap, uus)**.
- **Vahemälu:** järgmine lugu laetakse täismahus ette, praegune 3 s pärast; suurus seadetes (Off…Unlimited); **Keep Offline** (püsivalt, ei kustutata); **Cached Songs** Library's (töötab ilma võrguta).
- **Kvaliteet ühenduse järgi:** Wi-Fi ja Cellular profiil (Direct või MP3/AAC 96–320 kbps), Low Data Mode loetakse mobiilseks; mobiilil ei laeta taustal midagi, kui pole lubatud.
- **Raamatukogu:** Home, Library (Artists, Albums, Newest, Recently Played, Songs, Favorites, Cached Songs, Directories, Playlists, Radios), Search.
- **Now Playing:** hägune taust, "1 of N", süda, kolme punkti menüü, loo info/sõnad (kaanepilt kahaneb nurka), järjekorra vaade (lohistamine), AirPlay, landscape/iPad kaks veergu.
- **Loo menüü:** Play Next, Add to Queue, Instant Mix, Show Album/Artist, Keep Offline, Favorite, Rating (1–5), Share, Add to Playlist, Track Info.
- **Playlistid:** loo, nimeta ümber, kustuta, järjesta, eemalda lood, Save Queue as Playlist.
- **Scrobble:** loeb pool loost või 4 min; salvestatakse kettale ja saadetakse hiljem (offline ei kao). Last.fm veebimootori kaudu.
- **Sünkroon:** seadmed, kaugjuhtimine, "Play here"; jagatud seaded: *lyrics online* ja *eq_settings*.
- **Siri/Shortcuts** (ilma laiendita): Play/Pause, Next, Previous, Shuffle My Music, Play My Favorites, Favorite Current Song, Play Search Result.
- **Eesti keel** (164 teksti), ligipääsetavuse sildid.
- **Ehitus:** GitHub Actions (`.github/workflows/ios.yml`, macos-26, Xcode 26) annab allkirjastamata `.ipa`. CI ebaõnnestub, kui käivitusfaili pole.

## Paigaldus telefoni (iOS)
`Dev-board` (10.1.0.6, `ssh dev-10-1-0-6`): iPhone on sinna USB-ga ühendatud.
1. Ehitus: `git push` harule → Actions → artefakt `Icosahedron-unsigned-ipa` (või `gh run download <id> -n Icosahedron-unsigned-ipa`).
2. Fail `~/Downloads/iloader/Icosahedron.ipa` (kopeeritakse sinna).
3. `~/Downloads/iloader/run-iloader.sh` → *Import IPA*, Apple ID + 2FA.
4. Telefonis: Seaded → Üldine → VPN ja seadmehaldus → usalda arendajat.
- Tasuta Apple ID: rakendus aegub **7 päeva pärast**, siis tuleb samm 3 korrata. Andmed jäävad alles.
- iloader'i lahtipakitud AppImage (ilma bundlitud `libwayland`-ita) on vajalik, muidu on aken tühi.

## Teadaolevalt testimata või katki
Ma ei saanud iOS-i rakendust ise käivitada; kõik allolev on ehitatud (`BUILD SUCCEEDED`), aga **kasutaja pole veel kinnitanud**:
- **EQ iOS-is** (kõige riskantsem, madala taseme heli): kontrolli, et bass tõuseb, Reset taastab heli, gapless töötab EQ-ga.
- Offline scrobble'id, Last.fm iOS-is, Rating, Share (vajab `ND_ENABLESHARING`), playlistide haldus.
- Instant Mix (vajab Navidrome'is sarnasuse allikat, muidu sama žanri juhuslikud lood), BPM nimekirjades, seadete sünkroon.
- Siri fraasid (iOS võib vajada aega indekseerimiseks), Shortcuts toimingud.
- iPad/landscape, Eesti keel (tõlkeid pole keeletoimetaja üle vaadanud).
- Keep Offline, Cached Songs, kvaliteediprofiilid (teisendamine vajab Navidrome'i transkodeerimist).
- Veebi EQ (iOS Safaris välja jäetud).

## Teadaolevad piirangud
- **Vidin** (home screen widget) tegemata: vajab laiendust ja App Group'i, mis tasuta Apple ID-ga on ebakindel. Soovitus: eraldi eksperimentaalne haru.
- **CarPlay** (oma ikoon ja sirvimine): vajab Apple'i CarPlay Audio entitlementi ⇒ tasuline Developer konto. Seni töötab autos tõenäoliselt sisseehitatud *Now Playing* (kinnitamata).
- **Crossfade** meelega tegemata (gapless jäi); **Android** pole alustatud.
- Teisendatud vooga kerimine on ebatäpne, kuni lugu on vahemälus. Opust ei toetata (iOS ei mängi Oggi).
- Desktopi Last.fm on kohalik ⇒ topeltlugemise oht.

## Turvalisus ja puhastus
- Authelia on `music.raud.cloud` eest **eemaldatud**; kaitse on Navidrome'i parool. Tasub vaadata, kas piirata päringute sagedust (`limit_req`) radadel `/auth/` ja `/rest/ping`.
- Sandbox'is (`~/.config/gh`) on GitHubi token (õigused `repo`, `workflow`) lihttekstina ja SSH-võti `dev_10_1_0_6`. Kui sandbox'i ei kasutata enam: `gh auth logout` ning eemalda võti masina `Dev-board` failist `~/.ssh/authorized_keys`.
- Haru on avalikus repos; sisaldab kogu eelmist tööd. Hosti Last.fm saladus pole selles.

## Mis veel võiks tulla
Vidina eksperiment, Developer konto (püsiv allkiri, TestFlight, CarPlay), desktopi Last.fm serveri kaudu, uus veebi-UI iOS-i disainis, Android.
