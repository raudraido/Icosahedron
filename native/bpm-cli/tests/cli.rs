use std::path::PathBuf;
use std::process::Command;

const RATE: u32 = 44_100;

/// A drum-machine style track: a kick (decaying 60 Hz sine with a short noise click) on every beat and a
/// quiet hi-hat on the off-beats, at `bpm`, as a 16-bit mono WAV.
fn synth_wav(bpm: f64, seconds: f64, channels: u16) -> Vec<u8> {
    let n = (RATE as f64 * seconds) as usize;
    let mut s = vec![0f32; n];
    let beat = 60.0 / bpm * RATE as f64;
    let mut noise: u32 = 12345;
    let mut rnd = move || { noise = noise.wrapping_mul(1664525).wrapping_add(1013904223); (noise >> 8) as f32 / 8_388_608.0 - 1.0 };
    let mut k = 0usize;
    loop {
        let start = (k as f64 * beat) as usize;
        if start >= n { break; }
        for i in 0..(RATE as usize / 5).min(n - start) {
            let t = i as f32 / RATE as f32;
            let env = (-t * 25.0).exp();
            let click = if i < 200 { rnd() * 0.5 } else { 0.0 };
            s[start + i] += 0.8 * env * (2.0 * std::f32::consts::PI * 60.0 * t).sin() + click;
        }
        let off = start + (beat / 2.0) as usize;
        for i in 0..(RATE as usize / 25).min(n.saturating_sub(off)) {
            let t = i as f32 / RATE as f32;
            s[off + i] += 0.2 * (-t * 300.0).exp() * rnd();
        }
        k += 1;
    }
    let data_len = (n * channels as usize * 2) as u32;
    let mut w = Vec::new();
    w.extend_from_slice(b"RIFF");
    w.extend_from_slice(&(36 + data_len).to_le_bytes());
    w.extend_from_slice(b"WAVEfmt ");
    w.extend_from_slice(&16u32.to_le_bytes());
    w.extend_from_slice(&1u16.to_le_bytes());
    w.extend_from_slice(&channels.to_le_bytes());
    w.extend_from_slice(&RATE.to_le_bytes());
    w.extend_from_slice(&(RATE * channels as u32 * 2).to_le_bytes());
    w.extend_from_slice(&(channels * 2).to_le_bytes());
    w.extend_from_slice(&16u16.to_le_bytes());
    w.extend_from_slice(b"data");
    w.extend_from_slice(&data_len.to_le_bytes());
    for v in s {
        let x = ((v.clamp(-1.0, 1.0)) * 32000.0) as i16;
        for _ in 0..channels { w.extend_from_slice(&x.to_le_bytes()); }
    }
    w
}

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("icosahedron-bpm-test-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d.join(name)
}

fn run(path: &PathBuf) -> (bool, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_icosahedron-bpm")).arg(path).output().unwrap();
    (out.status.success(), String::from_utf8(out.stdout).unwrap())
}

/// (bpm, confidence, duration_secs) from `{"bpm": 128.0, "confidence": 0.93, "duration_secs": 90.0}`
fn answer(stdout: &str) -> (f64, f64, f64) {
    let inner = stdout.trim().strip_prefix('{').and_then(|r| r.strip_suffix('}')).unwrap_or_else(|| panic!("not an answer: {stdout}"));
    assert!(inner.starts_with("\"bpm\": ") && inner.contains("\"confidence\": ") && inner.contains("\"duration_secs\": "), "{stdout}");
    let v: Vec<f64> = inner.split(", ").map(|kv| kv.split(": ").nth(1).unwrap().parse().unwrap()).collect();
    (v[0], v[1], v[2])
}

fn bpm_of(stdout: &str) -> f64 { answer(stdout).0 }

#[test]
fn finds_128_bpm_in_a_90_second_synthetic_track() {
    let p = tmp("kick128.wav");
    std::fs::write(&p, synth_wav(128.0, 90.0, 1)).unwrap();
    let (ok, out) = run(&p);
    assert!(ok, "{out}");
    let (b, confidence, duration) = answer(&out);
    assert!((b - 128.0).abs() <= 1.0, "got {b}");
    assert!(confidence > 0.8, "confidence {confidence}");
    assert!((duration - 90.0).abs() < 0.2, "duration {duration}");
}

#[test]
fn an_ambient_signal_gets_a_low_confidence() {
    // noise under a slow swell: no beat at all, yet the tracker still prints a tempo; the confidence says not to trust it
    let mut rnd = 99u32;
    let mut w = synth_wav(128.0, 90.0, 1);
    for i in 0..RATE as usize * 90 {
        rnd = rnd.wrapping_mul(1664525).wrapping_add(1013904223);
        let t = i as f32 / RATE as f32;
        let x = (((rnd >> 8) as f32 / 8_388_608.0 - 1.0) * 0.3 * (0.5 + 0.5 * (t * 0.3).sin()) * 32000.0) as i16;
        w[44 + i * 2..46 + i * 2].copy_from_slice(&x.to_le_bytes());
    }
    let p = tmp("ambient.wav");
    std::fs::write(&p, w).unwrap();
    let (ok, out) = run(&p);
    if ok { assert!(answer(&out).1 < 0.35, "{out}"); } else { assert!(out.contains("error")); }
}

#[test]
fn a_wav_with_another_format_tag_says_which() {
    // format tag 0x0055 (MP3 inside WAV): Symphonia cannot read it, the message names the tag
    let mut w = synth_wav(128.0, 5.0, 1);
    w[20] = 0x55;
    w[21] = 0x00;
    let p = tmp("mp3inwav.wav");
    std::fs::write(&p, w).unwrap();
    let (ok, out) = run(&p);
    assert!(!ok);
    assert!(out.contains("0x0055"), "{out}");
}

#[test]
fn stereo_gives_the_same_tempo() {
    let p = tmp("kick124-stereo.wav");
    std::fs::write(&p, synth_wav(124.0, 90.0, 2)).unwrap();
    let (ok, out) = run(&p);
    assert!(ok, "{out}");
    let b = bpm_of(&out);
    assert!((b - 124.0).abs() <= 1.0, "got {b}");
}

#[test]
fn silence_fails_with_an_error_and_a_non_zero_exit() {
    let p = tmp("silence.wav");
    let mut w = synth_wav(128.0, 20.0, 1);
    for b in w.iter_mut().skip(44) { *b = 0; }
    std::fs::write(&p, w).unwrap();
    let (ok, out) = run(&p);
    assert!(!ok);
    assert!(out.starts_with("{\"error\": \""), "{out}");
}

#[test]
fn a_file_that_is_not_audio_and_a_missing_file_fail() {
    let p = tmp("notes.mp3");
    std::fs::write(&p, b"this is not audio at all, just some text".repeat(50)).unwrap();
    let (ok, out) = run(&p);
    assert!(!ok);
    assert!(out.contains("\"error\""), "{out}");
    let (ok, out) = run(&tmp("does-not-exist.flac"));
    assert!(!ok);
    assert!(out.contains("cannot open"), "{out}");
}
