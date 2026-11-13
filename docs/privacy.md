# Privacy policy

*Icosahedron (the Android app `cloud.icosahedron.phone`, the iOS app, the desktop app, and the Icosahedron server). Last changed: 2026-11-13.*

Icosahedron is a music player for a music server you (or someone you know) run yourself. The developer is the Icosahedron open-source project (github.com/raudraido/Icosahedron). **The developer does not run any server for it and receives no data from the apps.**

## What the app stores on your device

The address of your server, your user name and what is needed to sign in again (a password or a device key), your settings, the songs you downloaded or that were cached for playback, and the queue you were playing.

## What the app sends, and where

Everything the app sends goes to **the server whose address you typed in**, and only to it:

- your sign-in, and your requests for music, covers, lyrics and playlists;
- what you play and when (so the server can count plays, offer "recently played" and move playback between your devices), your favorites and ratings, and the playlists you make;
- your **profile picture**, if you set one;
- the name and kind of your device, so your other devices can show it.

Who can see that data is decided by whoever runs that server. If it is your own, nobody else. This policy does not cover other people's servers.

If you connect **Last.fm**, the plays you make are passed on to Last.fm by your server, under Last.fm's own privacy policy. If you do not connect it, nothing goes to Last.fm. If your server has no lyrics for a song, the app looks them up at **LRCLIB** (lrclib.net, a free public lyrics database) and sends it the song's title, artist, album and length (nothing that identifies you except the usual IP address of any web request); LRCLIB's own terms apply to that request.

## What the app does not do

No advertising, no analytics, no crash reporting and no tracking, and it does not read your location, contacts, photos (other than the one picture you choose as your profile picture), microphone or camera. It looks for servers on your local Wi-Fi network (multicast DNS) only to fill in the server address for you.

## Permissions

- *Internet*, *network state*, *Wi-Fi multicast*: to reach your server and find it on the local network.
- *Notifications*: the "now playing" control and sign-in approval requests.
- *Foreground service (media playback)* and *wake lock*: to keep playing with the screen off.

## Your control

Sign out in Settings to remove the sign-in from the device; uninstall the app to remove everything it stored. Delete downloads in Library → Downloads. To remove data held by a server (plays, profile picture), ask the person who runs it, or delete it there if you run it.

## Children

The app is a general music player and is not directed at children; it collects no data from anyone.

## Contact

Questions and requests: open an issue at https://github.com/raudraido/Icosahedron/issues or write to the address in the Google Play listing.

*Changes to this policy are made in this file; the date above changes with them.*
