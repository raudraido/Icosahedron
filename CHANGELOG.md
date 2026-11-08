# Changelog

## 0.15.2

### AirPlay (Apple TV)
- **Pairing:** the PIN now appears on the Apple TV (it refused the request that makes it show the code).
- **Faster start, track change and seek:** playback starts while the track is still downloading, and changing track or seeking takes about 1.3 s instead of 9–23 s. Fast skipping and dragging the seek bar no longer pile up restarts.
- **No more silence after the first track:** the stream now continues the receiver's timeline across tracks, so the Apple TV no longer stays silent for as long as the previous track had played, and the second track no longer fails with "Cannot process phase 1".
- **Hi-res and unusual sources:** 96 kHz tracks no longer play at about twice the speed; mono and multichannel sources are converted to stereo.
- **Now playing on the TV:** title, artist, cover art and a moving seek bar.
- **Apple TV remote works:** play, pause, next and scrubbing on the remote now control the player.
- **Lost connections are noticed:** if the Apple TV drops the connection, the cast picker shows it as disconnected instead of silently failing.

### Output sync
- The player's own speakers are now held back so they are heard together with the cast device (a cast device plays a stream a moment after it is sent). Start, pause/resume and seek all stay lined up.
- **Calibrate** in the cast picker measures the offset with the microphone (the cast device and the player each play short test tones); a slider sets it by hand. The offset is remembered per device; an uncalibrated AirPlay device starts at 150 ms.

### Cast picker
- The panel no longer grows out of the window while devices are being discovered: it opens upward and stays on screen.

### Notes
- While casting, gapless playback is off (a cast device can't follow it), so there is a short pause between tracks, as with any cast.
- The AirPlay library is now our `airplay2-rs` fork (upstream plus fixes proposed in lmcgartland/airplay2-rs #15–#23); the vendored copy of `airplay-audio` is gone because the fork carries the same Windows build fix.

## 0.15.1

- AirPlay 2 casting alongside Chromecast and DLNA; seeking during AirPlay playback.
- PIN-paired devices (e.g. Apple TV): the device shows the code, the cast picker has an inline field for it, and paired devices are remembered.
