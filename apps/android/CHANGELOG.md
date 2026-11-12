# Android phone app changelog

A native app (Kotlin, Jetpack Compose, Media3) for Android phones and tablets, built to match the iOS app: [docs/android.md](../../docs/android.md).

## 0.1.0

First version.

- **Sign in** with the server address, user name and password. The server is found on the network (mDNS and broadcast) when it is near. With **secure sign-in** on, the password only asks to be let in: the phone shows a number, you pick it on a device that is already trusted. A recovery code or an invite works when no device is at hand.
- **Approve other devices:** a sign-in request from another device opens a card over everything (also over the player) with three numbers; a notification shows it when the app is in the background.
- **Home** with a *Random mix* button that starts at once, then Discover, Recently played, Newest, Most played and Playlists, each with *See all*.
- **Library** with Albums (grid), Artists and Playlists; **Search** across artists, albums and songs; album, artist and playlist pages with Play and Shuffle.
- **Player:** a mini player above the tabs and a full Now Playing screen with the cover's colours, seek bar, shuffle, repeat, **lyrics** (timed, from the server or LRCLIB) and the **queue** (jump, remove). Plays in the background with notification and lock-screen controls.
- **Sync:** the phone is one more player of the account, listed in the other apps, takes their commands and shows what it plays.
- **Settings:** account, sync state, secure sign-in state and trusted devices (remove), sign out.
- Not in this version: Android Auto, remembering the queue between launches, switching secure sign-in on, downloads.
