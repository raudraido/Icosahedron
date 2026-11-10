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

The server also announces itself with **mDNS / DNS-SD** (service `_icosahedron._tcp`, the TXT record `address=` holds the same address, plus `id` and `name`). The TV app asks both ways at once. mDNS is the one that works when the TV is on another network than the server (see [below](#when-the-tv-is-on-another-network)); the UDP broadcast only reaches the same network.

A Docker bridge network does not deliver broadcasts or multicast, so the responder is a second container on the host network (see [deploy-server.md](deploy-server.md#lan-discovery)). It is optional: the server can always be typed.

### When the TV is on another network

A router keeps broadcasts inside their own network, so a TV on a different VLAN (for example an "IoT" Wi-Fi) cannot hear the UDP broadcast. mDNS can be forwarded between networks by the router:

- **UniFi:** Settings → Networks → **Gateway mDNS Proxy**: *Auto* only forwards well-known services; choose **Custom**, put both networks in *VLAN Scope* and leave *Service Scope* on *All* (or add `_icosahedron._tcp`).
- Other routers: look for "mDNS reflector", "Bonjour forwarding" or "Avahi reflector".
- Without that, type the address once in the TV app: it is remembered.

The TV must also be allowed to open connections to the server (a firewall rule from its network to the server's address and port, or just use a public `PUBLIC_URL`, which goes the normal way out and back).

**Host firewall:** the UDP broadcast needs UDP 7360 open on the server host (for `ufw`: `sudo ufw allow 7360/udp`, or limit it to your networks with `from <subnet>`). mDNS (UDP 5353 to 224.0.0.251) is allowed by `ufw` by default.
