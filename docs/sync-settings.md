# Sync Server settings (design)

What every player's **Settings → Sync Server** section does. The engine side (registry, rename, forget, clear, `playback:false`) is described in [sync-protocol.md](sync-protocol.md#registered-players); the screens are built per platform (desktop and web first, then iOS).

## Sections

1. **Connection:** the engine's address (desktop and iOS; the web app is the engine's own site), the state (online / connecting / offline), the signed-in user. *Join* and *Leave*: leaving disconnects and forgets the address on this device; nothing local is deleted.
2. **This player:** its name (editable; the automatic name is only a starting point).
3. **Registered players:** every player of your account, online or not, with *last seen*. Rename any of them. **Forget** is offered for offline players only. It is housekeeping: a player that is still signed in registers again. Offline players disappear by themselves after 90 days.
4. **What this player keeps in sync:** switches, stored on the player itself (see below).
5. **Server data:** *Clear stored queue* and *Clear shared preferences* (the engine's `clear` message).

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

## Not decided yet

- Whether *receive only* is useful for preferences (a phone that takes the theme but never sends its own).
- Whether to ask before the first upload when a player joins an engine that already holds preferences (today the first player uploads, later players adopt).
