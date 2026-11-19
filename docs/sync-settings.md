# Sync Server settings (design)

What every player's **Settings → Sync Server** section does. The engine side (registry, rename, forget, clear, `playback:false`) is described in [sync-protocol.md](sync-protocol.md#registered-players); the screen is built on the desktop and web app and on iOS (**Settings → Sync Server**). The iOS app only has the switches it can act on: playback and remote control, equalizer, lyrics source (it has no BPM analysis, no themes or library layout, and its server is the address it signed in with, so there is no Join/Leave).

## Sections

1. **Connection:** the engine's address (desktop and iOS; the web app is the engine's own site), the state (online / connecting / offline), the signed-in user. *Join* and *Leave*: leaving disconnects and forgets the address on this device; nothing local is deleted.
2. **This player:** its name (editable; the automatic name is only a starting point).
3. **Registered players:** every player of your account, online or not, with *last seen*. Rename any of them. **Forget** is offered for offline players only. It is housekeeping: a player that is still signed in registers again. Offline players disappear by themselves after 90 days.
4. **What this player keeps in sync:** switches, stored on the player itself (see below).
5. **BPM analysis** (server administrators only; hidden for everyone else and when the HUB is too old): how many songs have a BPM, a **Start analysis** button with the number of songs at a time (default 4), live progress with an estimate, **Stop**, and **Try the failed again**. How it works: [below](#bpm-analysis).
6. **Server data:** *Clear stored queue* and *Clear shared preferences* (the engine's `clear` message).

## What can be synced

The switches belong to the **player**, not the account: a phone can share its queue and nothing else while the desktop shares everything.

| Group | On | Off |
|---|---|---|
| **Playback and remote control** | Publishes its queue and position, is listed in the device picker and can be controlled | Connects with `playback:false`: invisible to the others, neither controls nor is controlled |
| **Preferences** | Sends and receives the shared preferences below | Sends nothing and ignores incoming changes |
| **BPM** | Reads and uploads BPM through the engine | Uses its own BPM cache only |
| **Last.fm through the engine** | Uses the engine's connection | Uses the player's own Last.fm session |

Preferences are split further, because the shared blob is one list of keys (see `src/lib/settingsSync.ts`):

| Preference group | Keys |
|---|---|
| Appearance | theme, custom themes |
| Equalizer | `eq_settings` |
| Library layout | tab order, home row order, left-panel switches, sort choices, "show remaining time" |
| Scrobbling and lyrics | scrobble / BPM-detection / lyrics-source switches, Bandsintown |

The blob is replaced as a whole, so a player with a group switched off must keep sending back the keys it does not manage exactly as it received them, and ignore those keys when they change.

## BPM analysis

An administrator can let the Icosahedron HUB measure the BPM of the whole library in the background, so every player (and the Mix Builder) sees a BPM for almost every song instead of only for the songs a desktop has played.

- **Same detection as the desktop:** the HUB runs `icosahedron-bpm` (`native/bpm-cli`), a small program built from the same Rust crate (`native/bpm-core`: QM-DSP beat tracker and the Mixxx-style snapping) the desktop app uses. For drum & bass the same genre rule as the desktop applies (half or two-thirds tempo is moved into 160-185; hip-hop-like genres next to it are left alone).
- **No music mount:** the HUB fetches each song's original file from Navidrome itself (Subsonic `download`) into a temporary file, measures it and deletes it at once. With secure sign-in on, it asks Navidrome as the administrator's account through the trusted header. With it off, it uses the administrator's own Subsonic token from the start request, kept in memory for the job only, never written to disk or logged.
- **Guarantees:** a song that already has a BPM, set by hand or measured (including everything the desktops uploaded), is never fetched, never measured and never changed. The store is checked when the song is queued, before it is fetched, and once more in the same step that writes the result, which only writes if the song still has none, so a value another player uploads while the job runs wins. Songs that fail (no clear tempo, an unreadable file) are remembered in `bpm-failed.json` and not tried again unless you press **Try the failed again**. A song that fails because Navidrome was busy or away is not remembered as failed; the next start picks it up. The job stops by itself after 25 such errors in a row.
- **Cost:** about 260 times real time per thread on a typical server (a 4-minute song takes about 1 s), so 36,000 songs (2,800 hours) take about 2.7 hours with 4 at a time. Each worker uses one CPU core at low priority (`nice`) and holds one decoded song in memory (about 10 MB per minute of audio: 40 MB for a 4-minute song, about 600 MB for a 1-hour mix), plus a temporary copy of the file on disk. The reading from Navidrome is the same as playing every song once.
- **Stopping and restarting:** **Stop** ends it within a second or two. Starting again skips everything already done, so a restart of the HUB or a stop loses nothing. New songs added to the library later are picked up by the next start; there is no automatic run yet.
- The number "songs in the library" comes from the last listing the job made, or from Navidrome's scan status before the first run.

API: `POST /bpm/analyze` `{workers?: 1-8, retryFailed?}`, `GET /bpm/analyze`, `DELETE /bpm/analyze`, `GET /bpm/analyze/failed` (see [sync-protocol.md](sync-protocol.md)).

## Not decided yet

- Whether *receive only* is useful for preferences (a phone that takes the theme but never sends its own).
- Whether to ask before the first upload when a player joins an engine that already holds preferences (today the first player uploads, later players adopt).
