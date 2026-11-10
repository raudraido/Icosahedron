import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useSmoothDisplaySeconds } from "../hooks/useSmoothDisplaySeconds";
import { useSync, syncActions, remotePosition, type SyncDevice } from "./sync";
import { useTarget } from "./target";
import type { Track } from "./api";

// What the player bar and the queue panel show and control: this device's own player, or the
// device chosen as the target (docs/connect.md). The same components render both; only the data
// and the actions differ. Local-only parts (cast, equalizer, stop, BPM analysis) are inactive
// while another device is the target.
export interface PlaybackView {
  remote: boolean;
  targetId: string | null;
  targetName: string | null;
  targetKind: SyncDevice["kind"] | null;
  queue: Track[];
  currentIndex: number;
  playing: boolean;
  shuffle: boolean;
  repeat: boolean;
  /** 0 to 100. */
  volume: number;
  /** Seconds (whole) for the clock labels. */
  currentTime: number;
  duration: number;
  /** Seconds, fractional, read every frame by the waveform. */
  getPosition: () => number;
  playPause: () => void;
  next: () => void;
  prev: () => void;
  seek: (secs: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  /** Queue actions: by index, so they work on either side. */
  playIndex: (i: number) => void;
  removeIndex: (i: number) => void;
  /** Array-move: the item at `from` ends up at `to`. */
  moveIndex: (from: number, to: number) => void;
}

export function usePlaybackView(): PlaybackView {
  const targetId = useTarget((s) => s.targetId);
  const online = useSync((s) => s.status === "online");
  const devices = useSync((s) => s.devices);
  const state = useSync((s) => (targetId ? s.states[targetId] : undefined));
  const remote = online && !!targetId;

  // Local side (always called: hooks cannot be conditional).
  const queue = useStore((s) => s.queue);
  const currentIndex = useStore((s) => s.currentIndex);
  const playing = useStore((s) => s.playing);
  const shuffle = useStore((s) => s.shuffle);
  const repeat = useStore((s) => s.repeat);
  const volume = useStore((s) => s.volume);
  const duration = useStore((s) => s.duration);
  const localTime = useSmoothDisplaySeconds();

  // The other player's position moves on by itself between its reports.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!remote) return;
    const i = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(i);
  }, [remote]);

  if (!remote) {
    const s = useStore.getState;
    return {
      remote: false, targetId: null, targetName: null, targetKind: null,
      queue, currentIndex, playing, shuffle, repeat, volume, currentTime: localTime, duration,
      getPosition: () => {
        const st = s();
        return st.playing ? st.currentTimeRaw + (performance.now() - st.currentTimeAnchorMs) / 1000 : st.currentTimeRaw;
      },
      playPause: () => s().playPause(),
      next: () => s().next(),
      prev: () => s().prev(),
      seek: (secs) => s().setCurrentTime(secs),
      setVolume: (v) => s().setVolume(v),
      toggleShuffle: () => s().toggleShuffle(),
      toggleRepeat: () => s().toggleRepeat(),
      playIndex: (i) => { const q = s().queue; if (q[i]) s().playTrack(q[i], q); },
      removeIndex: (i) => { const t = s().queue[i]; if (t) s().removeFromQueue(t.id); },
      moveIndex: (from, to) => { const t = s().queue[from]; if (t) s().reorderQueue(t.id, to > from ? to + 1 : to); },
    };
  }

  const id = targetId!;
  const device = devices.find((d) => d.deviceId === id);
  const rq = (state?.queue ?? []) as Track[];
  const ri = state?.queue ? state.index : -1;
  const dur = rq[ri]?.duration_secs ?? 0;
  const cmd = (c: string, args?: unknown) => syncActions.command(id, c, args);
  return {
    remote: true, targetId: id, targetName: device?.name ?? "device", targetKind: device?.kind ?? null,
    queue: rq, currentIndex: ri, playing: !!state?.playing, shuffle: !!state?.shuffle, repeat: !!state?.repeat,
    volume: typeof state?.volume === "number" ? state.volume : 100,
    currentTime: Math.floor(remotePosition(id)), duration: dur,
    getPosition: () => remotePosition(id),
    playPause: () => cmd("toggle"),
    next: () => cmd("next"),
    prev: () => cmd("prev"),
    seek: (secs) => syncActions.seekOn(id, secs),
    setVolume: (v) => cmd("volume", { volume: v }),
    toggleShuffle: () => syncActions.shuffle(id, !state?.shuffle),
    toggleRepeat: () => syncActions.repeat(id, !state?.repeat),
    playIndex: (i) => syncActions.jump(id, i),
    removeIndex: (i) => syncActions.removeAt(id, i),
    moveIndex: (from, to) => syncActions.move(id, from, to),
  };
}
