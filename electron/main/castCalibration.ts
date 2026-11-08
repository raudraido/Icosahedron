// Test signals for measuring how much later a cast device is audible than the
// player's own (local) output: the cast device plays 1 kHz tone bursts and the
// local output 3 kHz ones, once a second, while the renderer records both with
// the microphone and compares their onsets (see src/lib/castCalibration.ts).
// Different pitches let the two be told apart in one recording.

export const CALIBRATION_SECONDS = 12;
export const CALIBRATION_CAST_HZ = 1000;
export const CALIBRATION_LOCAL_HZ = 3000;

const SAMPLE_RATE = 44100;
const BURST_SECONDS = 0.03;
const FADE_SECONDS = 0.002;

/** 16-bit stereo WAV: a short sine burst at the start of every second. */
export function makeCalibrationWav(freqHz: number, seconds = CALIBRATION_SECONDS): Buffer {
  const frames = SAMPLE_RATE * seconds;
  const buf = Buffer.alloc(44 + frames * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + frames * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // channels
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(frames * 4, 40);

  const burst = Math.round(SAMPLE_RATE * BURST_SECONDS);
  const fade = SAMPLE_RATE * FADE_SECONDS;
  for (let i = 0; i < frames; i++) {
    const t = i % SAMPLE_RATE;
    let v = 0;
    if (t < burst) {
      const envelope = Math.min(1, t / fade, (burst - t) / fade);
      v = Math.sin((2 * Math.PI * freqHz * t) / SAMPLE_RATE) * 0.8 * envelope;
    }
    const s = Math.round(v * 32767);
    buf.writeInt16LE(s, 44 + i * 4);
    buf.writeInt16LE(s, 46 + i * 4);
  }
  return buf;
}
