// Measures how much later a cast device is heard than the player's own output,
// with the microphone. The main process plays 1 kHz tone bursts on the cast
// device and 3 kHz ones locally (once a second, electron/main/castCalibration.ts)
// while this records; the offset between each pair of onsets is the delay the
// local output has to wait to line up with the cast device.

const CAST_HZ = 1000;
const LOCAL_HZ = 3000;
/** How long to record once the test signals have been started. */
const RECORD_SECONDS = 10.5;
/** Minimum number of cast/local onset pairs for a trustworthy measurement. */
const MIN_PAIRS = 5;
/** Largest tolerated spread (ms) between the pairs' offsets. */
const MAX_SPREAD_MS = 60;
const MAX_OFFSET_MS = 3000;

export interface CalibrationResult {
  /** Delay (ms) the local output should wait so it is heard together with the cast device. */
  offsetMs: number;
  /** Onset pairs the median was taken over. */
  pairs: number;
}

/** Magnitude of one frequency in `x[offset .. offset+length)` (Goertzel). */
function goertzel(x: Float32Array, offset: number, length: number, freq: number, sampleRate: number): number {
  const k = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < length; i++) {
    const s = x[offset + i] + k * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / length;
}

/** Times (s) at which tone bursts at `freq` begin, and how clearly they stand out. */
function findOnsets(x: Float32Array, freq: number, sampleRate: number): { times: number[]; snr: number } {
  const win = Math.round(sampleRate * 0.004);
  const hop = Math.round(sampleRate * 0.001);
  const mags: number[] = [];
  for (let o = 0; o + win < x.length; o += hop) mags.push(goertzel(x, o, win, freq, sampleRate));
  const sorted = [...mags].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.5)] || 1e-9;
  const peak = sorted[sorted.length - 1] || 0;
  const threshold = Math.max(noise * 8, peak * 0.2);
  const times: number[] = [];
  let last = -Infinity;
  mags.forEach((m, i) => {
    const t = (i * hop) / sampleRate;
    // One onset per burst: ignore anything within half a second of the last.
    if (m > threshold && t - last > 0.5) {
      times.push(t);
      last = t;
    }
  });
  return { times, snr: peak / noise };
}

/** Turns a recording into the local-output delay, or throws with the reason it can't. */
export function analyseCalibration(x: Float32Array, sampleRate: number): CalibrationResult {
  const cast = findOnsets(x, CAST_HZ, sampleRate);
  const local = findOnsets(x, LOCAL_HZ, sampleRate);
  if (local.times.length < MIN_PAIRS || local.snr < 6) {
    throw new Error("The microphone didn't pick up the player's own sound — check the microphone and the volume");
  }
  if (cast.times.length < MIN_PAIRS || cast.snr < 6) {
    throw new Error("The microphone didn't pick up the cast device — check that it is audible near the microphone");
  }
  const deltas: number[] = [];
  for (const tl of local.times) {
    const near = cast.times.filter((tc) => Math.abs(tc - tl) < 0.6).sort((a, b) => Math.abs(a - tl) - Math.abs(b - tl))[0];
    if (near !== undefined) deltas.push((near - tl) * 1000);
  }
  if (deltas.length < MIN_PAIRS) throw new Error("Couldn't match the two sounds up — try again in a quieter room");
  deltas.sort((a, b) => a - b);
  const spread = deltas[deltas.length - 1] - deltas[0];
  if (spread > MAX_SPREAD_MS) throw new Error(`The measurements disagree by ${Math.round(spread)} ms — try again in a quieter room`);
  const median = deltas[Math.floor(deltas.length / 2)];
  return { offsetMs: Math.max(0, Math.min(MAX_OFFSET_MS, Math.round(median))), pairs: deltas.length };
}

/**
 * Records with the microphone while `start()` plays the test signals; `stop()`
 * always runs afterwards. Resolves with the measured delay.
 */
export async function measureCastDelay(start: () => Promise<void>, stop: () => Promise<void>): Promise<CalibrationResult> {
  // Raw signal: any processing meant for speech (echo cancellation, noise
  // suppression, gain control) would fight the very sounds being measured.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const recorder = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  recorder.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  // A script processor only runs while connected to the destination; mute it.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(recorder);
  recorder.connect(mute);
  mute.connect(ctx.destination);

  try {
    await new Promise((r) => setTimeout(r, 600)); // let the input settle
    await start();
    await new Promise((r) => setTimeout(r, RECORD_SECONDS * 1000));
  } finally {
    await stop().catch(() => {});
    recorder.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => {});
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const samples = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    samples.set(c, at);
    at += c.length;
  }
  return analyseCalibration(samples, ctx.sampleRate);
}
