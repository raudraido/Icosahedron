//! napi-rs native addon exposing a gapless Subsonic-stream audio engine to
//! Electron's main process. Forked from psysonic-audio (a Tauri+Rust music
//! player's audio crate) — see native/audio-engine/README.md for the scope
//! this port covers vs. the original.
#![deny(clippy::all)]

use std::sync::Arc;

use napi::JsFunction;
use napi_derive::napi;

mod airplay;
mod bpm;
mod bpm_analyze;
mod commands;
mod decode;
mod engine;
mod eq;
mod events;
mod helpers;
mod play_input;
mod progress_task;
mod sources;
mod state;
mod stream;
mod transport;

use engine::AudioEngine as EngineInner;
use events::NapiEmitter;

#[napi]
pub struct AudioEngine {
    inner: Arc<EngineInner>,
    emitter: Arc<NapiEmitter>,
}

#[napi]
impl AudioEngine {
    /// `callback(payload: AudioEventPayload)` — required at construction (no
    /// "played before registered" race). Opens the default output device
    /// immediately.
    #[napi(constructor)]
    pub fn new(callback: JsFunction) -> napi::Result<Self> {
        let emitter = NapiEmitter::new(callback)?;
        Ok(Self { inner: Arc::new(engine::create_engine()), emitter: Arc::new(emitter) })
    }

    /// Manual/first-play + skip path: low-latency ranged-HTTP streaming
    /// source, 5ms anti-click fade-in, no gapless-tag trim.
    /// `start_paused`: session restore — sits paused at position 0 until an
    /// explicit `seek`/`resume`.
    #[napi]
    pub async fn play(
        &self,
        url: String,
        volume: f64,
        duration_hint: f64,
        manual: bool,
        start_paused: bool,
    ) -> napi::Result<()> {
        let inner = self.inner.clone();
        let emitter = self.emitter.clone();
        commands::play(&inner, &emitter, url, volume as f32, duration_hint, manual, start_paused)
            .await
            .map_err(napi::Error::from_reason)
    }

    /// Gapless pre-append ~30s before the current track ends: full-buffer
    /// decode + iTunSMPB trim, appended directly onto the live Sink.
    #[napi]
    pub async fn chain_preload(&self, url: String, duration_hint: f64) -> napi::Result<()> {
        let inner = self.inner.clone();
        commands::chain_preload(&inner, url, duration_hint)
            .await
            .map_err(napi::Error::from_reason)
    }

    #[napi]
    pub fn pause(&self) -> napi::Result<()> {
        transport::pause(&self.inner);
        Ok(())
    }

    #[napi]
    pub fn resume(&self) -> napi::Result<()> {
        transport::resume(&self.inner);
        Ok(())
    }

    /// Resume `offset_ms` after the most recent AirPlay stream started (its
    /// first audio went out), on a dedicated thread — so the moment is
    /// microsecond-accurate and independent of the JS side's timers and IPC.
    /// A cast device plays a stream some time after it is sent; resuming this
    /// output that much later lines the two up. If the moment has already
    /// passed, resumes immediately.
    #[napi]
    pub fn resume_at_cast_start(&self, offset_ms: f64) -> napi::Result<()> {
        let started = airplay::stream_started_at_us();
        let base = if started == 0 { airplay::now_us() } else { started };
        let target = base + (offset_ms.max(0.0) * 1000.0) as u64;
        let inner = self.inner.clone();
        std::thread::Builder::new()
            .name("resume-at".into())
            .spawn(move || {
                loop {
                    let now = airplay::now_us();
                    if now >= target {
                        break;
                    }
                    let left = target - now;
                    if left > 2000 {
                        std::thread::sleep(std::time::Duration::from_micros(left - 1500));
                    } else {
                        std::hint::spin_loop();
                    }
                }
                transport::resume(&inner);
            })
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        Ok(())
    }

    #[napi]
    pub fn stop(&self) -> napi::Result<()> {
        transport::stop(&self.inner);
        Ok(())
    }

    #[napi]
    pub fn seek(&self, seconds: f64) -> napi::Result<()> {
        transport::seek(&self.inner, seconds).map_err(napi::Error::from_reason)
    }

    #[napi]
    pub fn set_volume(&self, volume: f64) -> napi::Result<()> {
        transport::set_volume(&self.inner, volume as f32);
        Ok(())
    }

    /// 10-band EQ + preamp — applies live to whatever is playing (and to
    /// every future/gapless-chained source). `bands_db`: 10 gains in dB for
    /// the ISO octave bands 31 Hz…16 kHz; `preamp_db`: master pre-gain.
    #[napi]
    pub fn set_eq(&self, enabled: bool, preamp_db: f64, bands_db: Vec<f64>) -> napi::Result<()> {
        let bands: Vec<f32> = bands_db.iter().map(|&b| b as f32).collect();
        self.inner.eq.set(enabled, preamp_db as f32, &bands);
        Ok(())
    }

    /// Downloads `url` in full and runs QM-DSP beat detection over it,
    /// returning the snapped constant-tempo BPM. Independent of playback
    /// state — safe to call for a track that isn't (or isn't yet) playing.
    #[napi]
    pub async fn analyze_bpm(&self, url: String) -> napi::Result<f64> {
        bpm_analyze::analyze_bpm(&self.inner, url).await.map_err(napi::Error::from_reason)
    }
}
