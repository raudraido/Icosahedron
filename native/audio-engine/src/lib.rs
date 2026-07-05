//! napi-rs native addon exposing a gapless Subsonic-stream audio engine to
//! Electron's main process. Forked from psysonic-audio (a Tauri+Rust music
//! player's audio crate) — see native/audio-engine/README.md for the scope
//! this port covers vs. the original.
#![deny(clippy::all)]

use std::sync::Arc;

use napi::JsFunction;
use napi_derive::napi;

mod commands;
mod decode;
mod engine;
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
}
