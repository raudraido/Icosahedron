# Which versions work together

The apps and the server are versioned separately, so a version number says nothing about compatibility. What counts is the **sync protocol** ([sync-protocol.md](sync-protocol.md)).

- The server tells its protocol number in `GET /config.json` (`{"version": "…", "protocol": 2}`).
- Apps say which protocol they speak in the hello (`device.proto`). A server keeps serving older apps, with fewer features (an app that predates per-player states follows one state only).

| Feature | Needs protocol | First in |
|---|---|---|
| Sync, remote control, shared preferences | 1 | Desktop 0.15.3, Server 0.15.3, iOS 0.15.3 |
| Independent players (each player's own state), choosing a device to control | 2 | Server 0.15.6 |
| Quick Connect, the `tv` device kind, LAN discovery | 2 | Server 0.16.0, Android TV 0.1.0 |

Versions before the split were one shared number (0.15.x). Since the split each product counts on its own: Desktop 0.16.0, Server 0.16.0, iOS 0.1.0, Android TV 0.1.0.

Rule of thumb: **update the server first**, then the apps. A new app against an older server still works for everything the server knows; the new features that need the server are simply missing.
