//! 10-band peaking equalizer + preamp — restores the EqSource stage the
//! psysonic-audio fork dropped (see sources.rs header). Parameters live in a
//! single engine-wide `EqParams` shared with every playing source through an
//! `Arc`: the UI writes via `AudioEngine::set_eq`, and each `EqSource`
//! notices the version bump from inside the audio thread and rebuilds its
//! biquad cascade — no source rebuild, changes are audible immediately and
//! survive gapless chaining (each chained source wraps the same params).
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rodio::Source;

/// ISO octave centers — the classic 10-band graphic EQ layout.
pub(crate) const BAND_FREQS: [f32; 10] =
    [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
const BAND_Q: f32 = 1.1;

pub struct EqParams {
    enabled: AtomicBool,
    /// Bumped on every `set` — sources poll this (Relaxed read per frame is
    /// cheap) and reconfigure when it moves.
    version: AtomicU64,
    preamp_db: AtomicU32,        // f32 bits
    bands_db: [AtomicU32; 10],   // f32 bits each
}

impl EqParams {
    pub(crate) fn new() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            version: AtomicU64::new(0),
            preamp_db: AtomicU32::new(0f32.to_bits()),
            bands_db: std::array::from_fn(|_| AtomicU32::new(0f32.to_bits())),
        }
    }

    pub(crate) fn set(&self, enabled: bool, preamp_db: f32, bands_db: &[f32]) {
        self.enabled.store(enabled, Ordering::Relaxed);
        self.preamp_db.store(preamp_db.to_bits(), Ordering::Relaxed);
        for (i, slot) in self.bands_db.iter().enumerate() {
            slot.store(bands_db.get(i).copied().unwrap_or(0.0).to_bits(), Ordering::Relaxed);
        }
        self.version.fetch_add(1, Ordering::Release);
    }

    fn snapshot(&self) -> (u64, bool, f32, [f32; 10]) {
        let version = self.version.load(Ordering::Acquire);
        let enabled = self.enabled.load(Ordering::Relaxed);
        let preamp = f32::from_bits(self.preamp_db.load(Ordering::Relaxed));
        let bands = std::array::from_fn(|i| f32::from_bits(self.bands_db[i].load(Ordering::Relaxed)));
        (version, enabled, preamp, bands)
    }
}

/// RBJ audio-EQ-cookbook peaking biquad, transposed direct form II.
#[derive(Clone, Copy, Default)]
struct Biquad {
    b0: f32, b1: f32, b2: f32, a1: f32, a2: f32,
    z1: f32, z2: f32,
}

impl Biquad {
    fn peaking(fs: f32, f0: f32, q: f32, gain_db: f32) -> Self {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        let a0 = 1.0 + alpha / a;
        Self {
            b0: (1.0 + alpha * a) / a0,
            b1: -2.0 * cos_w0 / a0,
            b2: (1.0 - alpha * a) / a0,
            a1: -2.0 * cos_w0 / a0,
            a2: (1.0 - alpha / a) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

pub(crate) struct EqSource<S: Source<Item = f32>> {
    inner: S,
    params: Arc<EqParams>,
    version: u64,
    enabled: bool,
    preamp: f32,
    /// filters[channel][active band] — flat biquad cascade per channel.
    filters: Vec<Vec<Biquad>>,
    chan: usize,
    channels: usize,
}

impl<S: Source<Item = f32>> EqSource<S> {
    pub(crate) fn new(inner: S, params: Arc<EqParams>) -> Self {
        let channels = inner.channels().get() as usize;
        let mut src = Self {
            inner, params, version: 0, enabled: false, preamp: 1.0,
            filters: Vec::new(), chan: 0, channels,
        };
        let v = src.params.version.load(Ordering::Acquire);
        src.reconfigure(v);
        src
    }

    fn reconfigure(&mut self, version: u64) {
        let (_, enabled, preamp_db, bands_db) = self.params.snapshot();
        self.version = version;
        self.enabled = enabled;
        self.preamp = 10f32.powf(preamp_db / 20.0);
        let fs = self.inner.sample_rate().get() as f32;
        // Flat bands are true identity filters — skip them entirely; bands at
        // or above Nyquist can't be realized and are skipped too (16 kHz on a
        // 32 kHz-or-lower stream).
        let cascade: Vec<Biquad> = BAND_FREQS.iter().zip(bands_db.iter())
            .filter(|(f0, db)| db.abs() >= 0.05 && **f0 < fs * 0.45)
            .map(|(f0, db)| Biquad::peaking(fs, *f0, BAND_Q, *db))
            .collect();
        self.filters = (0..self.channels).map(|_| cascade.clone()).collect();
    }

    fn reset_state(&mut self) {
        for chain in &mut self.filters {
            for f in chain {
                f.z1 = 0.0;
                f.z2 = 0.0;
            }
        }
        self.chan = 0;
    }
}

impl<S: Source<Item = f32>> Iterator for EqSource<S> {
    type Item = f32;
    #[inline]
    fn next(&mut self) -> Option<f32> {
        let x = self.inner.next()?;
        // Poll for parameter changes once per frame (on channel 0) so both
        // channels of a frame always run the same coefficients.
        if self.chan == 0 {
            let v = self.params.version.load(Ordering::Acquire);
            if v != self.version {
                self.reconfigure(v);
            }
        }
        // Advance the channel cursor whether or not the EQ is engaged —
        // otherwise toggling mid-stream would desync which filter chain each
        // channel's samples run through.
        let ch = self.chan;
        self.chan = (self.chan + 1) % self.channels;
        if !self.enabled {
            return Some(x);
        }
        let mut y = x * self.preamp;
        for f in &mut self.filters[ch] {
            y = f.process(y);
        }
        Some(y.clamp(-1.0, 1.0))
    }
}

impl<S: Source<Item = f32>> Source for EqSource<S> {
    fn current_span_len(&self) -> Option<usize> { self.inner.current_span_len() }
    fn channels(&self) -> rodio::ChannelCount { self.inner.channels() }
    fn sample_rate(&self) -> rodio::SampleRate { self.inner.sample_rate() }
    fn total_duration(&self) -> Option<Duration> { self.inner.total_duration() }
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        // Stale filter memory from the pre-seek position would smear into the
        // first post-seek samples — clear it.
        self.reset_state();
        self.inner.try_seek(pos)
    }
}
