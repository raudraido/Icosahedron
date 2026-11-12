# Android phone app changelog

A native app (Kotlin, Jetpack Compose, Media3) for Android phones and tablets, built to match the iOS app: [docs/android.md](../../docs/android.md).

## 0.1.1

The rest of what 0.1.0 was meant to have (0.1.0 was built a little early). Install it over 0.1.0.

- **Sign in** with the server address, user name and password. The server is found on the network (mDNS and broadcast) when it is near. With **secure sign-in** on, the password only asks to be let in: the phone shows a number, you pick it on a device that is already trusted. A recovery code or an invite works when no device is at hand.
- **Approve other devices:** a sign-in request from another device opens a card over everything (also over the player) with three numbers; a notification shows it when the app is in the background.
- **Home** with a *Random mix* button that starts at once, then Discover, Recently played, Newest, Most played and Playlists, each with *See all*.
- **Library** with Albums, Artists and Playlists. Albums and Artists have **sort** (name, album artist, date added, most played, recently played, random, year), **filters** (favorites, decade, genre), a grid or list view and a letter index, like iOS. **Search** across artists, albums and songs; album, artist and playlist pages with Play and Shuffle.
- **Playback speed** 0.5× to 2× with *Keep pitch* (in Now Playing).
- **Player:** a mini player above the tabs and a full Now Playing screen with the cover's colours, seek bar, shuffle, repeat, **lyrics** (timed, from the server or LRCLIB) and the **queue** (jump, remove). Plays in the background with notification and lock-screen controls.
- **Devices tab (remote control):** every online device of the account with what it plays. Tap one and the mini player, Now Playing (play, pause, next, seek, shuffle, repeat, queue, lyrics) and everything you start from the library act on it. *Send* moves this phone's playback there, *Play here* pulls it back.
- **Sync:** the phone is one more player of the account, listed in the other apps, takes their commands and shows what it plays.
- **Settings** like iOS: account, **Sync Server** (status, this phone's name, registered players, forget), **Last.fm** (connect, scrobble, disconnect), **secure sign-in** (trusted devices), **Equalizer** (the phone's own bands), lyrics lookup on or off, **playback quality** for Wi-Fi and mobile data (direct or MP3/AAC from the server), sign out.
- Not in this version: Android Auto, remembering the queue between launches, switching secure sign-in on, the offline cache and downloads, BPM in song lists.

## 0.1.0

First version: sign-in (also with secure sign-in), approving other devices, Home, Library, Search, the player, lyrics, the queue and sync.
