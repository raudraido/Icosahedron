# Playing on a device (design)

Every app lets you choose **which of your devices plays**, and then controls that device: play and pause, next and previous, seek, volume, the queue, "play now", "play next", "add to queue". Like Spotify Connect.

## Model

- A **player** is a device that makes the sound. **Players are independent**: the one at home and the one in the car can play different music at the same time. Nothing ever pauses another player.
- Every player keeps its **own playback state** (queue, position, playing). The engine keeps them per player and forwards each to the others, so every app can show what every other device is doing.
- Every app has a **target**: the device its playback controls act on and whose now-playing it shows. It is the app's own choice and defaults to *this device*. Choosing a target **only controls**; it never moves music.
- **Moving music is a separate, explicit action:** *Send my playback to X* and *Play here* (a pull from the device being controlled). The old player pauses and the new one continues at the same position.
- **Browsing stays local** (search, library, albums). What a track or album does when you press play, play next or add to queue goes to the target.

## Engine

- `state` messages are per player: a player's state is stored under its own id and forwarded to everyone who follows playback. A pause or position of one player never changes another's.
- `welcome.states` gives a newly connected app the states of the other online players. Apps publish their state when they connect (if they hold a queue) and while they play.
- `transfer { source?, target }` moves `source`'s playback (default: the player that last started playing) to `target`.
- Players that predate this (hello without `proto: 2`) follow one state only: `activeDeviceId` / `state`, the player that last **started** playing. Update all players to get the full behaviour.

## Controlling a target

When the target is another device the app shows **that device's** now-playing (track, progress, queue) and its transport buttons send commands:

| Action | Command |
|---|---|
| Play / pause, next, previous | `toggle` / `play` / `pause`, `next`, `prev` |
| Seek, volume | `seek`, `volume` |
| Play these tracks now (a track, an album, a playlist) | `load` with `{ queue, index, positionMs: 0, playing: true }` |
| Play next, add to queue | `enqueue` (`next`, `end`) |
| Play one track right after the current one and start it | `enqueue` (`now`) |
| Jump to / remove / reorder a queue item | `jump`, `remove`, `move` |
| Shuffle, repeat | `shuffle`, `repeat` (the target publishes its own state in `shuffle` / `repeat`) |

Choosing a different target does not move this device's music. To move it, use *Send playback here* on the other device's row; to bring the other device's music to this one, *Play here*.

## Building it

1. Engine: independent players with per-player states. **Done.**
2. iOS: a target in the app model, the device picker, mini player and Now Playing for the target, every play action routed to it.
3. Desktop and web: the same.

## The player screen

The full-screen player looks the same whether it plays here or controls another device: cover, progress, queue, lyrics, info, favorite and the track menu all work on the target's track and queue. The **devices button is highlighted** with the target's name; tapping it switches target. Controls that only make sense for this phone's own sound (AirPlay, equalizer, playback speed) stay in place but are inactive while another device is the target. A target with nothing playing shows an empty state with the devices button still available. The *Devices* tab is the overview: every device with what it plays; tapping one makes it the target.

## Not decided
- Whether the choice of target is remembered across launches (today: every launch starts on *this device*).
