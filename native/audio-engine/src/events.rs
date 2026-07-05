//! napi event bridge — replaces psysonic-audio's `AppHandle::emit` with a
//! `ThreadsafeFunction`-backed emitter implementing the same `ProgressEmitter`
//! seam, so `progress_task.rs` is otherwise unchanged.
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::JsFunction;
use napi_derive::napi;

use crate::progress_task::{ProgressEmitter, ProgressPayload};

#[napi(object)]
#[derive(Clone)]
pub struct AudioEventPayload {
    /// "progress" | "playing" | "track_switched" | "ended" | "error"
    pub kind: String,
    pub current_time: Option<f64>,
    pub duration: Option<f64>,
    pub buffering: Option<bool>,
    pub message: Option<String>,
}

fn empty_payload(kind: &str) -> AudioEventPayload {
    AudioEventPayload { kind: kind.into(), current_time: None, duration: None, buffering: None, message: None }
}

#[derive(Clone)]
pub(crate) struct NapiEmitter {
    cb: ThreadsafeFunction<AudioEventPayload, ErrorStrategy::CalleeHandled>,
}

impl NapiEmitter {
    pub(crate) fn new(callback: JsFunction) -> napi::Result<Self> {
        let cb: ThreadsafeFunction<AudioEventPayload, ErrorStrategy::CalleeHandled> =
            callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
        Ok(Self { cb })
    }

    fn send(&self, payload: AudioEventPayload) {
        self.cb.call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking);
    }

    pub(crate) fn emit_playing(&self, duration_secs: f64) {
        self.send(AudioEventPayload { duration: Some(duration_secs), ..empty_payload("playing") });
    }

    pub(crate) fn emit_error(&self, message: String) {
        self.send(AudioEventPayload { message: Some(message), ..empty_payload("error") });
    }
}

impl ProgressEmitter for NapiEmitter {
    fn emit_progress(&self, payload: ProgressPayload) {
        self.send(AudioEventPayload {
            current_time: Some(payload.current_time),
            duration: Some(payload.duration),
            buffering: Some(payload.buffering),
            ..empty_payload("progress")
        });
    }
    fn emit_track_switched(&self, duration_secs: f64) {
        self.send(AudioEventPayload { duration: Some(duration_secs), ..empty_payload("track_switched") });
    }
    fn emit_ended(&self) {
        self.send(empty_payload("ended"));
    }
}
