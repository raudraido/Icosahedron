import { useEffect, useRef, useState } from "react";

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
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
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

interface Props {
  streamUrl: string;
  trackId: string;
  currentTime: number;
  duration: number;
  onSeek: (secs: number) => void;
}

export function Waveform({ streamUrl, trackId, currentTime, duration, onSeek }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [rawPeaks, setRawPeaks] = useState<number[] | null>(null);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pxWidth = Math.round(width * dpr);
    const pxHeight = Math.round(HEIGHT * dpr);
    if (canvas.width !== pxWidth) canvas.width = pxWidth;
    if (canvas.height !== pxHeight) canvas.height = pxHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    if (!rawPeaks) {
      ctx.fillStyle = "rgba(128,128,128,0.3)";
      ctx.fillRect(0, HEIGHT / 2 - 1, width, 2);
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

    const step = BAR_WIDTH + BAR_GAP;
    peaks.forEach((p, i) => {
      const x = i * step;
      const barH = Math.max(4, p * HEIGHT * 0.85);
      const y = (HEIGHT - barH) / 2;
      ctx.fillStyle = x < playedX ? gradient : "rgba(80,80,80,0.6)";
      ctx.fillRect(x, y, BAR_WIDTH, barH);
    });
  }, [rawPeaks, currentTime, duration, width]);

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
