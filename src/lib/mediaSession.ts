// Media Session API: lock-screen / notification / headset / media-key controls
// and now-playing info for the browser and mobile builds. The <audio> element
// the web platform plays through is what makes the OS treat the page as a
// media player; this tells it what is playing and routes its buttons back to
// the store. (Electron keeps its own handling.)
import { platform } from "../platform";
import { useStore } from "../store";

const ART_SIZES = [96, 192, 256, 384, 512];

export function initMediaSession(): void {
  if (!("mediaSession" in navigator) || platform.kind === "electron") return;
  const ms = navigator.mediaSession;
  const st = () => useStore.getState();

  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ["play", () => { if (!st().playing) st().playPause(); }],
    ["pause", () => { if (st().playing) st().playPause(); }],
    ["stop", () => st().stop()],
    ["previoustrack", () => st().prev()],
    ["nexttrack", () => st().next()],
    ["seekto", (d) => { if (typeof d.seekTime === "number") st().setCurrentTime(d.seekTime); }],
  ];
  for (const [action, fn] of handlers) {
    try { ms.setActionHandler(action, fn); } catch { /* action unsupported by this browser */ }
  }

  let lastTrackId: string | null = null;
  let lastPlaying: boolean | null = null;
  let lastPos = { at: 0, time: 0 };

  const updateMetadata = () => {
    const s = st();
    const track = s.queue[s.currentIndex];
    if (!track) { ms.metadata = null; lastTrackId = null; return; }
    ms.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album ?? "",
      artwork: track.cover_id
        ? ART_SIZES.map((n) => ({ src: platform.coverUrl(track.cover_id, n), sizes: `${n}x${n}`, type: "image/jpeg" }))
        : [],
    });
  };

  const updatePosition = () => {
    const s = st();
    if (!(s.duration > 0)) return;
    try {
      ms.setPositionState({ duration: s.duration, position: Math.min(Math.max(0, s.currentTime), s.duration), playbackRate: 1 });
    } catch { /* duration/position out of range during track changes */ }
    lastPos = { at: Date.now(), time: s.currentTime };
  };

  useStore.subscribe((s) => {
    const track = s.queue[s.currentIndex];
    const id = track?.id ?? null;
    if (id !== lastTrackId) {
      lastTrackId = id;
      updateMetadata();
      updatePosition();
    }
    if (s.playing !== lastPlaying) {
      lastPlaying = s.playing;
      if (s.playing) updateMetadata(); // Safari can drop metadata set before the element was playing
      ms.playbackState = track ? (s.playing ? "playing" : "paused") : "none";
      updatePosition();
    }
    // The OS extrapolates the position while playing; only correct it after a
    // seek (the reported time jumped away from where it should be by now).
    if (s.playing && lastPos.at) {
      const expected = lastPos.time + (Date.now() - lastPos.at) / 1000;
      if (Math.abs(s.currentTime - expected) > 2) updatePosition();
    }
  });
}
