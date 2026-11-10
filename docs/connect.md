# Playing on a device (design)

Every app lets you choose **which of your devices plays**, and then controls that device: play and pause, next and previous, seek, volume, the queue, "play now", "play next", "add to queue". Like Spotify Connect.

## Model

- A **player** is a device that makes the sound. The account has **one active player at a time**.
- Every app has a **target**: the device its playback controls act on. It is the app's own choice (a phone can control the desktop while the desktop's own app keeps its own target) and defaults to *this device*.
- **Browsing stays local** (search, library, albums). What a track or album does when you press play, play next or add to queue goes to the target.

## Engine rule (one active player)

- A player that starts playing becomes the active one. The previous active player is sent `pause` and is *fenced* for 5 seconds: its in-flight "playing" updates are ignored, so two players cannot take the role back and forth.
- Only the active player (or one that starts playing) changes the stored state. A pause from a player that is no longer active is ignored; it would overwrite the real state with its own position.
- `transfer` does the same: the old player pauses, the target loads the stored state and plays.

## Controlling a target

When the target is another device the app shows **that device's** now-playing (track, progress, queue) and its transport buttons send commands:

| Action | Command |
|---|---|
| Play / pause, next, previous | `toggle` / `play` / `pause`, `next`, `prev` |
| Seek, volume | `seek`, `volume` |
| Play these tracks now (a track, an album, a playlist) | `load` with `{ queue, index, positionMs: 0, playing: true }` |
| Play next, add to queue | `enqueue` (`next`, `end`) |
| Play one track right after the current one and start it | `enqueue` (`now`) |
| Jump to / remove a queue item | `jump`, `remove` |

Choosing a different target while this device is playing **transfers** the playback to it (the music follows you); choosing *this device* while another plays offers *Play here* (a transfer back).

## Building it

1. Engine: the one-active-player rule. **Done.**
2. iOS: a target in the app model, the device picker, mini player and Now Playing for the target, every play action routed to it.
3. Desktop and web: the same.

## Not decided

- Shuffle and repeat of the target (no commands yet).
- Whether the choice of target is remembered across launches (today: every launch starts on *this device*).
