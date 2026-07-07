import { useEffect, useState } from "react";
import { useStore } from "../store";

// The native engine only reports position via throttled (~1.5s) `progress`
// ticks (see store/index.ts's currentTimeRaw/currentTimeAnchorMs comment),
// so a digital clock driven straight off the store's floored `currentTime`
// visibly stutters — some displayed seconds last longer than others,
// depending on when the last tick happened to land, rather than ticking at
// a steady one-per-real-second cadence.
//
// This runs its own rAF loop that extrapolates from the last known tick
// using wall-clock time elapsed since it arrived (same technique
// LyricsPanel.tsx uses for smooth lyric sync), but only actually calls
// setState when the floored second changes — React's setState bails out a
// re-render when given a value equal (via Object.is) to current state, so
// calling this every frame costs nothing extra, it just guarantees the
// *one* re-render per second lands exactly on a real second boundary
// instead of whenever a network tick shows up. Deliberately not used for
// the waveform itself — that needs true per-frame motion, not a once-a-
// second integer, and lives in its own rAF loop in Waveform.tsx so it isn't
// tied to this (or any other) component's render cycle at all.
export function useSmoothDisplaySeconds(): number {
  const [secs, setSecs] = useState(() => Math.floor(useStore.getState().currentTimeRaw));

  useEffect(() => {
    let raf = 0;
    function tick() {
      const s = useStore.getState();
      const pos = s.playing ? s.currentTimeRaw + (performance.now() - s.currentTimeAnchorMs) / 1000 : s.currentTimeRaw;
      setSecs(Math.floor(pos));
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return secs;
}
