//! Rodio `Source` wrappers: type erasure, fade-in, end-of-source notify,
//! sample counter, thread-priority boost. Forked from psysonic-audio's
//! sources.rs with EqSource/TriggeredFadeOut dropped (no EQ/crossfade here).
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rodio::Source;

// ─── DynSource — type-erased Source wrapper ───────────────────────────────────
//
// Lets build_source's two branches (trimmed vs. untrimmed decode) produce a
// single concrete type for the rest of the wrapper chain.

pub(crate) struct DynSource {
    inner: Box<dyn Source<Item = f32> + Send>,
    channels: rodio::ChannelCount,
}

impl DynSource {
    pub(crate) fn new(src: impl Source<Item = f32> + Send + 'static) -> Self {
        let channels = src.channels();
        Self { inner: Box::new(src), channels }
    }
}

impl Iterator for DynSource {
    type Item = f32;
    fn next(&mut self) -> Option<f32> { self.inner.next() }
}

impl Source for DynSource {
    fn current_span_len(&self) -> Option<usize> { self.inner.current_span_len() }
    fn channels(&self) -> rodio::ChannelCount { self.channels }
    fn sample_rate(&self) -> rodio::SampleRate { self.inner.sample_rate() }
    fn total_duration(&self) -> Option<Duration> { self.inner.total_duration() }
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        self.inner.try_seek(pos)
    }
}

// ─── EqualPowerFadeIn — per-sample sin(t·π/2) fade-in envelope ───────────────
//
//   • Gapless chain: fade_dur = 0            → unity gain (no click, no fade)
//   • Manual/first play: fade_dur = 5 ms     → micro-fade eliminates DC-click

pub(crate) struct EqualPowerFadeIn<S: Source<Item = f32>> {
    inner: S,
    sample_count: u64,
    fade_samples: u64,
}

impl<S: Source<Item = f32>> EqualPowerFadeIn<S> {
    pub(crate) fn new(inner: S, fade_dur: Duration) -> Self {
        let sample_rate = inner.sample_rate();
        let channels = inner.channels().get() as u64;
        let fade_samples = if fade_dur.is_zero() {
            0
        } else {
            (fade_dur.as_secs_f64() * sample_rate.get() as f64 * channels as f64) as u64
        };
        Self { inner, sample_count: 0, fade_samples }
    }
}

impl<S: Source<Item = f32>> Iterator for EqualPowerFadeIn<S> {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next()?;
        let gain = if self.fade_samples == 0 || self.sample_count >= self.fade_samples {
            1.0
        } else {
            let t = self.sample_count as f32 / self.fade_samples as f32;
            (t * std::f32::consts::FRAC_PI_2).sin()
        };
        self.sample_count += 1;
        Some((sample * gain).clamp(-1.0, 1.0))
    }
}

impl<S: Source<Item = f32>> Source for EqualPowerFadeIn<S> {
    fn current_span_len(&self) -> Option<usize> { self.inner.current_span_len() }
    fn channels(&self) -> rodio::ChannelCount { self.inner.channels() }
    fn sample_rate(&self) -> rodio::SampleRate { self.inner.sample_rate() }
    fn total_duration(&self) -> Option<Duration> { self.inner.total_duration() }
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        if pos.as_millis() < 100 {
            self.sample_count = 0;
        } else {
            self.sample_count = self.fade_samples;
        }
        self.inner.try_seek(pos)
    }
}

// ─── NotifyingSource — sets a flag when the inner iterator is exhausted ───────
//
// The key mechanism for gapless: the progress task polls `done` to know
// exactly when source N has finished inside the Sink.

pub(crate) struct NotifyingSource<S: Source<Item = f32>> {
    inner: S,
    done: Arc<AtomicBool>,
    signalled: bool,
}

impl<S: Source<Item = f32>> NotifyingSource<S> {
    pub(crate) fn new(inner: S, done: Arc<AtomicBool>) -> Self {
        Self { inner, done, signalled: false }
    }
}

impl<S: Source<Item = f32>> Iterator for NotifyingSource<S> {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next();
        if sample.is_none() && !self.signalled {
            self.signalled = true;
            self.done.store(true, Ordering::SeqCst);
        }
        sample
    }
}

impl<S: Source<Item = f32>> Source for NotifyingSource<S> {
    fn current_span_len(&self) -> Option<usize> { self.inner.current_span_len() }
    fn channels(&self) -> rodio::ChannelCount { self.inner.channels() }
    fn sample_rate(&self) -> rodio::SampleRate { self.inner.sample_rate() }
    fn total_duration(&self) -> Option<Duration> { self.inner.total_duration() }
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        self.signalled = false;
        self.done.store(false, Ordering::SeqCst);
        self.inner.try_seek(pos)
    }
}

// ─── CountingSource — atomic sample counter for drift-free position tracking ─

pub(crate) struct CountingSource<S: Source<Item = f32>> {
    inner: S,
    counter: Arc<AtomicU64>,
}

impl<S: Source<Item = f32>> CountingSource<S> {
    pub(crate) fn new(inner: S, counter: Arc<AtomicU64>) -> Self {
        Self { inner, counter }
    }
}

impl<S: Source<Item = f32>> Iterator for CountingSource<S> {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next();
        if sample.is_some() {
            self.counter.fetch_add(1, Ordering::Relaxed);
        }
        sample
    }
}

impl<S: Source<Item = f32>> Source for CountingSource<S> {
    fn current_span_len(&self) -> Option<usize> { self.inner.current_span_len() }
    fn channels(&self) -> rodio::ChannelCount { self.inner.channels() }
    fn sample_rate(&self) -> rodio::SampleRate { self.inner.sample_rate() }
    fn total_duration(&self) -> Option<Duration> { self.inner.total_duration() }
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        let result = self.inner.try_seek(pos);
        if result.is_ok() {
            let samples = (pos.as_secs_f64() * self.inner.sample_rate().get() as f64
                * self.inner.channels().get() as f64) as u64;
            self.counter.store(samples, Ordering::Relaxed);
        }
        result
    }
}

// ─── PriorityBoostSource — promote the calling thread on first sample ────────
//
// rodio's Sink runs Source::next inside the cpal output-stream callback. On
// Linux/macOS this is a no-op (PipeWire/rtkit, CoreAudio already promote audio
// threads externally) — kept only for structural parity / future Windows use.

pub(crate) struct PriorityBoostSource<S: Source<Item = f32>> {
    inner: S,
}

impl<S: Source<Item = f32>> PriorityBoostSource<S> {
    pub(crate) fn new(inner: S) -> Self {
        Self { inner }
    }
}

impl<S: Source<Item = f32>> Iterator for PriorityBoostSource<S> {
    type Item = f32;
    #[inline]
    fn next(&mut self) -> Option<f32> {
        self.inner.next()
    }
}

impl<S: Source<Item = f32>> Source for PriorityBoostSource<S> {
    fn current_span_len(&self) -> Option<usize> { self.inner.current_span_len() }
    fn channels(&self) -> rodio::ChannelCount { self.inner.channels() }
    fn sample_rate(&self) -> rodio::SampleRate { self.inner.sample_rate() }
    fn total_duration(&self) -> Option<Duration> { self.inner.total_duration() }
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        self.inner.try_seek(pos)
    }
}
