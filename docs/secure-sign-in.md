# Secure sign-in (plan)

Status: **step 1 (the engine) is built, off by default; no app can use it yet** (steps 2 to 4). This is the design for "a password must never be the only thing between the internet and your music".

## Goal

The engine (`apps/server`) is the only thing reachable from the internet; Navidrome is reachable only from the engine. With secure sign-in on, **a new device can only get in when a device that is already trusted approves it**. Knowing or guessing a password is not enough.

Meant for people who just installed the server: no command line in the normal path, plain words ("trusted devices", "approve this sign-in"), and off by choice for people who only use it at home.

## How it works

### The engine speaks to Navidrome as the user

Checked against Navidrome 0.64 (a throw-away container, 2026-11-11): when a request comes from an address listed in `ND_REVERSEPROXYWHITELIST`, Navidrome takes the user from the `Remote-User` header.

| Call | Result with only `Remote-User: alice` |
|---|---|
| `/rest/*` (Subsonic) | works, no `u`, `t`, `s` needed |
| `/api/*` (native: users, shares) | works, no JWT needed |
| `Remote-User: nobody` (no such user) | rejected, Navidrome does not create users |
| `POST /auth/login` | needs the password (not needed, `/api` takes the header) |

So the engine never needs anybody's password or Subsonic token: it checks the device itself and then forwards the request with the header. Requirements: the whitelist holds **only the engine's address** (never `0.0.0.0/0`), Navidrome is not published to the internet, and **the engine strips any `Remote-User` header a client sends**.

### A device has its own secret

When a device is approved the engine gives it a random **device secret**. The device uses it **where it used the password**: Subsonic style, `u=<user>`, `t=md5(secret + salt)`, `s=salt`. Because it has the same shape as today's credentials, every place that builds URLs (streams, covers, WebSocket, `Authorization: Subsonic …`) keeps working unchanged; only the value that is remembered changes (the device secret instead of the password).

The engine finds the device by trying the user's few device secrets, then forwards to Navidrome with `Remote-User` and removes `u`, `t`, `s`, `p`. A removed device simply stops resolving.

Secrets are kept in `data/devices.json` (mode 600, like `lastfm.json`): Subsonic token auth needs the secret itself. A leaked file leaks devices, not passwords, and each device can be removed.

Third-party Subsonic apps (Symfonium, DSub …) cannot ask for approval: **Settings → Devices → App password** creates a device secret for them from a trusted device.

### Signing in from a new device

1. The new device sends user name and password to `POST /device/request`. The engine checks the password with Navidrome (rate limited) and opens a **request**: number (two digits), device name and kind, address, time. It lives **5 minutes**, in memory.
2. The new device shows "Approve this sign-in on one of your devices" and the number.
3. Trusted devices that are online get the request over `/sync` (and can fetch `GET /device/pending`): *"Sign-in attempt from Chrome on Windows, Tallinn, 14:22. Pick the number you see."* Three numbers are offered, the right one is among them (a wrong one denies the request). Approve or Deny.
4. The new device polls `GET /device/status`; when approved it receives the device secret **once**.
5. Every attempt (approved, denied, expired) goes to the **sign-in history** (`data/signins.json`, last 200).

Limits: 3 open requests per user, 5 new requests per user and per address in 15 minutes. A wrong number denies.

TV and other awkward-keyboard devices keep **Quick Connect**: the device shows a code, a trusted device enters it. With secure sign-in on, Quick Connect creates a device secret for the TV instead of handing out the approver's own token, and only a trusted device can authorize.

### Turning it on (the first trusted device)

- **Settings → Sync Server → Secure sign-in → Turn on** (administrator, from an already signed-in device). That device becomes the first trusted device. The other devices that are signed in right now (listed by name, so you can see if one is not yours) can be kept trusted or must approve again.
- **Recovery codes** (10, one use each, stored hashed) are shown once. One code approves a new device when no trusted device is at hand.
- **Last resort, on the server:** `docker compose exec icosahedron node src/devices-cli.mjs invite <user>` prints a one-time code for the first device of a user.
- **Other people:** Settings → Users → *Invite* gives a code (and a QR) for that person's first device; later devices are approved by their own devices.
- The switch cannot lock you out: it only turns on when the device that turns it on is enrolled.

Off by default. Off means exactly today's behaviour. On a new install the administrator sees a notice while the server answers non-local requests ("your server is reachable from the internet").

### Managing

- **Settings → Devices**: trusted devices (name, kind, last seen, address), remove, app passwords, recovery codes (create new), sign-in history, pending requests.
- Removing a device ends its access at once.

## API

All JSON. "Device" below means a request with a trusted device's credentials in the `Authorization: Subsonic u=…&t=…&s=…` header (`t = md5(secret + s)`).

| Call | Who | Meaning |
|---|---|---|
| `GET /device/info` | anyone | `{secure}` (also `secure` in `/config.json`) |
| `POST /device/request` `{user, password, device}` | a new device | checks the password, opens a request: `{id, secret, number, expiresIn}`. `409 not_required` when off, `409 no_trusted_device` when the account has none (use a code), `429` when asking too often |
| `GET /device/poll?id=&secret=` | the new device | `{state: pending\|approved\|denied\|expired}`; on `approved` also `{deviceId, secret, cred:{u,t,s}}`, once |
| `GET /device/pending` | a device | open requests with their three `choices` |
| `POST /device/decide` `{id, approve, number}` | a device | `{result: approved\|denied\|wrong\|expired}`; a wrong number denies |
| `GET /device/list`, `DELETE /device/<id>`, `GET /device/history` | a device | trusted devices (`current` marks this one), remove one, the sign-in history |
| `POST /device/app-password` `{name}` | a device | a device secret for a third-party app, shown once |
| `POST /device/recovery-codes` | a device | new recovery codes (the old ones stop working) |
| `POST /device/recover` `{user, password, code, device}` | a new device | a recovery code makes a device without approval, once |
| `POST /device/invite` `{user}` | an administrator's device | a one-use code (24 hours) for that user's first device |
| `POST /device/redeem` `{user, password, code, device}` | a new device | the invite makes the first device; `recoveryCodes` come with it |
| `PUT /device/secure` `{enabled, device}` | an administrator | on: needs the Navidrome sign-in (old way), checks that Navidrome trusts the engine (`412` if not), makes the calling device trusted, returns `{deviceId, secret, cred, recoveryCodes}`; off: needs a trusted device |

With secure sign-in on, `/rest`, `/api` and the sync WebSocket accept only trusted devices' credentials, `/auth/*` is closed, `/share/*` stays public, and Quick Connect gives the TV a device of its own. Old Navidrome tokens and passwords stop working at the engine at once; sockets that are already open stay until they close. Limits: 15 attempts per address and 30 per account in 15 minutes, 3 open requests per account.

## Compatibility

Sync protocol 3. An old app cannot do the approval; with secure sign-in on it gets a clear "update the app" message. Server, desktop (and web), iOS and Android TV each get a new minor version; `docs/compatibility.md` lists what needs what. Secure sign-in off keeps working with every app.

## Steps (each its own PR, tested, nothing on until the last)

0. **Spike** (done): Navidrome accepts `Remote-User` from the engine, see above.
1. **Engine core**: device store, device-secret check, `Remote-User` forwarding, request / approve / pending / status endpoints, history, rate limits, app passwords, Quick Connect creates device secrets, recovery codes, CLI invite. Secure sign-in stays off; tests. Server 0.17.0.
2. **Desktop and web**: sign-in with approval (waiting screen with the number), approval prompt (in the app and as a system notification on desktop while it runs), Settings → Devices, turn-on flow. Desktop 0.17.0, server follows.
3. **iOS**: the same (the approval prompt appears when the app is opened; local notification while it runs). iOS 0.2.0.
4. **Android TV**: Quick Connect enrolment. Android TV 0.3.0.
5. **Extras**: optional phone notification through ntfy (works with a free Apple ID where Apple push does not), first-run notice, invites with QR, Navidrome compose example with `ND_REVERSEPROXYWHITELIST`.

## Decisions

- Off by default, with a notice when the server is reachable from outside (not forced on).
- Only the **Navidrome administrator's password** during setup claims the server.
- Approval prompts in the apps first; ntfy later, optional.
