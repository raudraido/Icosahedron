# Which versions work together

The apps and the server are versioned separately, so a version number says nothing about compatibility. What counts is the **sync protocol** ([sync-protocol.md](sync-protocol.md)).

- The server tells its protocol number in `GET /config.json` (`{"version": "…", "protocol": 2}`).
- Apps say which protocol they speak in the hello (`device.proto`). A server keeps serving older apps, with fewer features (an app that predates per-player states follows one state only).

| Feature | Needs protocol | First in |
|---|---|---|
| Sync, remote control, shared preferences | 1 | Desktop 0.15.3, Server 0.15.3, iOS 0.15.3 |
| Independent players (each player's own state), choosing a device to control | 2 | Server 0.15.6 |
| Quick Connect, the `tv` device kind, LAN discovery | 2 | Server 0.16.0, Android TV 0.1.0 |
| Finding the server with mDNS (works across networks a router forwards mDNS between) | 2 | Server 0.16.4, Android TV 0.1.1 |
| Quick Connect switched on and off by an administrator in Settings (`/quickconnect/settings`) | 2 | Server 0.16.1, Desktop 0.16.1, iOS 0.1.1 |
| Everyone's profile picture (`GET /avatar/<user>`), user management in Settings → Users | 2 | Server 0.16.3, Desktop 0.16.3 (web app: server 0.16.3) |
| Secure sign-in (`/device/*`, `approval` messages, `secure` in `/config.json`): off by default | 2 | Server 0.17.0, Desktop 0.17.0 (and the web app), iOS 0.2.0, Android phone 0.1.0 (Quick Connect gives the TV its own device) |
| Navidrome plugins page (through the engine's proxy), playback speed (web app) | 2 | Server 0.18.0, Desktop 0.18.0 (needs server 0.17 or newer) |
| The Android phone app: sign-in with approval, remote control, Android Auto | 2 | Android phone 0.1.0 (0.1.1 and later add the rest) |
| Last.fm handed from the desktop to the server (`PUT /lastfm/connection`), profile picture (`/avatar`) | 2 | Server 0.16.2, Desktop 0.16.2 (Last.fm), iOS 0.1.2 (picture) |

**Now (2026-11-13):** Desktop 0.19.0 · Server 0.18.0 · iOS 0.2.6 · Android phone 0.1.22 · Android TV 0.2.0. The Android phone app counts only its last number up (0.1.0, 0.1.1, …).

Versions before the split were one shared number (0.15.x). Since the split each product counts on its own: Desktop 0.16.0, Server 0.16.0, iOS 0.1.0, Android TV 0.1.0 (since then: Desktop 0.16.4, Server 0.16.8, iOS 0.1.2).

Rule of thumb: **update the server first**, then the apps. A new app against an older server still works for everything the server knows; the new features that need the server are simply missing.
