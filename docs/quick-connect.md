# Quick Connect

Sign a TV (or any device with an awkward keyboard) in without typing a password: the device shows a six-digit code, you enter it in an app where you are already signed in. Modelled on Jellyfin's Quick Connect.

## Using it

1. Switch it on: a **server administrator** (a Navidrome admin account) turns on *Allow devices to sign in with a code* in **Settings → Sync Server → Quick Connect**. It is off by default. (Setting `QUICK_CONNECT=true` in the engine's environment decides instead and locks that switch.)
2. On the TV: pick or type your server, choose *Quick Connect*. The TV shows a code.
3. On your phone or computer, in Icosahedron: **Settings → Sync Server → Quick Connect**, enter the code, *Authorize*. The section only appears when the engine has Quick Connect on.
4. The TV signs in as you. Codes work for 10 minutes and once.

## Protocol

All under the engine's origin. Requests and answers are JSON.

| Call | Who | Meaning |
|---|---|---|
| `GET /quickconnect/enabled` | anyone | `true` / `false` |
| `POST /quickconnect/initiate` `{deviceId, name, app, version, kind}` | the device | `{secret, code, expiresIn, device}`. `secret` (64 hex characters) stays on the device, `code` (6 digits) is shown. `403` when disabled, `429` when asking too often, `503` when too many are pending |
| `GET /quickconnect/connect?secret=…` | the device, polling | `{authenticated, code, device}`; `404` when unknown or expired |
| `POST /quickconnect/authorize` `{code}` | a signed-in app (Subsonic `Authorization` header) | `200` authorized, `404` unknown code, `409` already authorized, `429` too many wrong codes, `401` not signed in |
| `GET /quickconnect/settings` | a signed-in app | `{enabled, canChange, source}`: `canChange` is true for a Navidrome administrator when the environment does not decide; `source` is `setting` or `env` |
| `PUT /quickconnect/settings` `{enabled}` | an administrator | switches it; `403` for anyone else, `409` when `QUICK_CONNECT` decides. Switching off drops every pending request. The choice is kept in `settings.json` in the data directory |
| `POST /quickconnect/claim` `{secret}` | the device | the authorized account's `{u, t, s}` (Subsonic user, salted token, salt) once; `404` before authorization or after claiming |

An authorized request lives one more minute so the device surely sees it. Requests are held in memory (a restart drops them) and expire after 10 minutes. Limits: 10 requests per minute per address, 100 pending in all, 10 wrong codes per minute per user.

## What the device receives

The same salted Subsonic token the approving app uses, not a device-bound one: it is valid on every device of that account, and changing the account's password signs them all out. (Device-bound, individually revocable tokens would need the engine to broker authentication; not done.) Use an `https` address, the token is sent in the clear otherwise.

## LAN discovery

Like Jellyfin, a client broadcasts `who is Icosahedron?` to **UDP 7360** and every engine answers `{"address": "...", "id": "...", "name": "..."}`. The address is `PUBLIC_URL` when set, else this host's address on the asker's subnet plus `ENGINE_PORT`. The TV app uses it to find your server so nothing has to be typed.

A Docker bridge network does not deliver broadcasts, so the responder is a second container on the host network (see [deploy-server.md](deploy-server.md#lan-discovery)). It is optional: the server can always be typed.
