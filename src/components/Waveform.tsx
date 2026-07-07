import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

// Real per-track waveform — ports the old app's Canvas-drawn bar waveform
// (footer_bar.qml's `displayMode: 2`), which is fed by native amplitude
// analysis (audio_core.cpp). We have no native decoder here, so this decodes
// the stream via Web Audio (`decodeAudioData`) instead — same real-amplitude
// result, just computed client-side.
const BAR_WIDTH = 1.8;
const BAR_GAP = 2;
// Matches footer_bar.qml's waveformWrap.height — was 36 here, nearly half the
// real 60, which alone made the bars look much shorter than the old app's.
const HEIGHT = 60;

// Decoded once per track at a fixed, generous resolution and cached by
// trackId alone — resizing the window (which changes how many *displayed*
// bars fit) then just resamples this array, a cheap synchronous operation.
// Previously this decoded at the exact displayed bucket count and cached by
// `trackId:bucketCount`, so every resize tick (bucket count changes on
// almost any width change) was a cache miss that re-fetched + re-decoded the
// whole file, blanking the waveform until it finished — visible as it
// "disappearing" while dragging the window edge.
const DECODE_RESOLUTION = 800;

const rawPeaksCache = new Map<string, number[]>();
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

// Some taggers write a FLAC PICTURE metadata block with a zero-length MIME
// string (the spec requires a real "image/..." string there) — Chromium's
// FLAC demuxer hard-fails decodeAudioData on the *entire* file rather than
// just ignoring the malformed picture, even though the native Symphonia
// engine used for actual playback couldn't care less. Strip every metadata
// block down to just the required STREAMINFO before decoding, so waveform
// generation doesn't depend on every tagger being spec-compliant. No-op for
// non-FLAC streams (checked via the "fLaC" magic) and for well-formed FLACs
// (dropping PICTURE/VORBIS_COMMENT/SEEKTABLE/etc. doesn't affect decoded
// audio samples, only metadata decodeAudioData never surfaces anyway).
function stripFlacMetadata(buf: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 4 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) {
    return buf; // not "fLaC"
  }

  let pos = 4;
  let streamInfo: Uint8Array | null = null;
  while (pos + 4 <= bytes.length) {
    const header = bytes[pos];
    const isLast = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const length = (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (type === 0) streamInfo = bytes.slice(pos, pos + 4 + length);
    pos += 4 + length;
    if (isLast || pos > bytes.length) break;
  }
  if (!streamInfo) return buf; // no STREAMINFO found (shouldn't happen) — leave as-is

  streamInfo[0] |= 0x80; // now the last (only) metadata block, since the rest are dropped
  const audioData = bytes.subarray(pos);
  const result = new Uint8Array(4 + streamInfo.length + audioData.length);
  result.set(bytes.subarray(0, 4), 0);
  result.set(streamInfo, 4);
  result.set(audioData, 4 + streamInfo.length);
  return result.buffer;
}

// Matches the real pipeline exactly, not just its final blend: audio_core.cpp's
// generate_waveform() computes RMS (sqrt(mean(sample^2))) per point — deliberately
// not a plain mean-of-abs, which crushes quiet-but-peaky passages toward zero since
// it weighs every sample equally, nor pure peak, which pegs near-max on any modern
// loudness-limited master. RMS's squaring gives loud transients outsized weight
// while still reflecting a bucket's actual energy. footer_bar.qml's rebuildBarPath
// then blends 0.7*rms + 0.3*peak across however many of those RMS points land in
// each displayed bar, clamped to [0.04, 1.0] with no further normalization.
async function decodePeaks(url: string): Promise<number[]> {
  const resp = await fetch(url);
  const arrayBuffer = await resp.arrayBuffer();
  const ctx = getAudioContext();
  const audioBuffer = await ctx.decodeAudioData(stripFlacMetadata(arrayBuffer));
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.floor(channelData.length / DECODE_RESOLUTION));

  const peaks: number[] = [];
  for (let i = 0; i < DECODE_RESOLUTION; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, channelData.length);
    let sumSq = 0, peak = 0;
    for (let j = start; j < end; j++) {
      const v = channelData[j];
      sumSq += v * v;
      const av = Math.abs(v);
      if (av > peak) peak = av;
    }
    const rms = end > start ? Math.sqrt(sumSq / (end - start)) : 0;
    peaks.push(Math.min(1, Math.max(0.04, 0.7 * rms + 0.3 * peak)));
  }
  return peaks;
}

// Nearest-neighbor resample from the fixed decode resolution down to however
// many bars actually fit the current width — synchronous, no decoding involved.
function resample(peaks: number[], targetCount: number): number[] {
  if (targetCount <= 0 || peaks.length === 0) return [];
  const result = new Array<number>(targetCount);
  for (let i = 0; i < targetCount; i++) {
    result[i] = peaks[Math.min(peaks.length - 1, Math.floor((i / targetCount) * peaks.length))];
  }
  return result;
}

// Pure imperative draw, shared by every animation frame — reads pre-resampled
// peaks (or null, pre-decode) and the already-interpolated position, no store
// or React access here so it can be called as fast as rAF allows.
function draw(canvas: HTMLCanvasElement, width: number, rawPeaks: number[] | null, currentTime: number, duration: number) {
  const dpr = window.devicePixelRatio || 1;
  const pxWidth = Math.round(width * dpr);
  const pxHeight = Math.round(HEIGHT * dpr);
  if (canvas.width !== pxWidth) canvas.width = pxWidth;
  if (canvas.height !== pxHeight) canvas.height = pxHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, HEIGHT);

  // Waveform not decoded yet — a plain seekbar (matches the old app's
  // pre-analysis fallback) instead of a flat inert line, so playback is
  // still scrubbable and legible while the real waveform decodes.
  if (!rawPeaks) {
    const accentFallback = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#44cfcf";
    const trackH = 6;
    const trackY = (HEIGHT - trackH) / 2;
    const playedX = duration > 0 ? (currentTime / duration) * width : 0;

    ctx.fillStyle = "rgba(128,128,128,0.3)";
    ctx.beginPath();
    ctx.roundRect(0, trackY, width, trackH, trackH / 2);
    ctx.fill();

    if (playedX > 0) {
      ctx.fillStyle = accentFallback;
      ctx.beginPath();
      ctx.roundRect(0, trackY, playedX, trackH, trackH / 2);
      ctx.fill();
    }

    const thumbR = 6;
    const thumbX = Math.max(thumbR, Math.min(width - thumbR, playedX));
    ctx.beginPath();
    ctx.arc(thumbX, HEIGHT / 2, thumbR, 0, Math.PI * 2);
    ctx.fillStyle = accentFallback;
    ctx.fill();
    return;
  }

  const bucketCount = Math.max(1, Math.floor(width / (BAR_WIDTH + BAR_GAP)));
  const peaks = resample(rawPeaks, bucketCount);

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#44cfcf";
  const playedX = duration > 0 ? (currentTime / duration) * width : 0;

  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, "white");
  gradient.addColorStop(0.3, accent);
  gradient.addColorStop(1, "black");

  // Two passes instead of one fillStyle-per-bar decision: a long track has
  // far fewer bars than seconds (bar count is capped by pixel width, not by
  // duration), so each bar can represent several seconds of audio. Deciding
  // color per whole bar means the played/unplayed edge only ever advances
  // one full bar at a time — visibly stepping once every few seconds no
  // matter how smoothly `currentTime` itself is computed. Clipping to the
  // exact pixel `playedX` on the second pass instead sweeps continuously
  // through a bar's width, not just at its edges.
  const step = BAR_WIDTH + BAR_GAP;

  ctx.fillStyle = "rgba(80,80,80,0.6)";
  peaks.forEach((p, i) => {
    const x = i * step;
    const barH = Math.max(4, p * HEIGHT * 0.85);
    const y = (HEIGHT - barH) / 2;
    ctx.fillRect(x, y, BAR_WIDTH, barH);
  });

  if (playedX > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, playedX, HEIGHT);
    ctx.clip();
    ctx.fillStyle = gradient;
    peaks.forEach((p, i) => {
      const x = i * step;
      const barH = Math.max(4, p * HEIGHT * 0.85);
      const y = (HEIGHT - barH) / 2;
      ctx.fillRect(x, y, BAR_WIDTH, barH);
    });
    ctx.restore();
  }
}

interface Props {
  streamUrl: string;
  trackId: string;
  duration: number;
  onSeek: (secs: number) => void;
}

export function Waveform({ streamUrl, trackId, duration, onSeek }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [rawPeaks, setRawPeaks] = useState<number[] | null>(null);

  // Mirrors the state above into refs so the rAF draw loop below can read
  // the latest values every frame without depending on them (and therefore
  // without tearing down/restarting the loop whenever they change).
  const widthRef = useRef(0);
  const rawPeaksRef = useRef<number[] | null>(null);
  const durationRef = useRef(duration);
  widthRef.current = width;
  rawPeaksRef.current = rawPeaks;
  durationRef.current = duration;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Decode only depends on the track, not the display width.
  useEffect(() => {
    const cached = rawPeaksCache.get(trackId);
    if (cached) { setRawPeaks(cached); return; }

    setRawPeaks(null);
    let cancelled = false;
    decodePeaks(streamUrl)
      .then((p) => { if (!cancelled) { rawPeaksCache.set(trackId, p); setRawPeaks(p); } })
      .catch(() => { if (!cancelled) setRawPeaks(null); });
    return () => { cancelled = true; };
  }, [streamUrl, trackId]);

  // Its own rAF loop instead of a React-state-driven redraw — the previous
  // approach fed an interpolated `currentTime` in as a prop, which meant
  // every animation frame re-rendered all of PlayerBar (a large component
  // tree) just to get one canvas repainted. That re-render didn't reliably
  // land every frame, which looked like visible stepping instead of the
  // continuous motion it was supposed to produce. Reading position straight
  // from the store here means the canvas repaints every rAF tick regardless
  // of what React itself is doing.
  useEffect(() => {
    let raf = 0;
    function tick() {
      const canvas = canvasRef.current;
      const width = widthRef.current;
      if (canvas && width > 0) {
        const s = useStore.getState();
        const posSecs = s.playing
          ? s.currentTimeRaw + (performance.now() - s.currentTimeAnchorMs) / 1000
          : s.currentTimeRaw;
        draw(canvas, width, rawPeaksRef.current, posSecs, durationRef.current);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!duration) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(frac * duration);
  }

  return (
    <div ref={containerRef} onClick={handleClick} style={{ flex: 1, height: HEIGHT, cursor: "pointer" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
