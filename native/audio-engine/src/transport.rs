//! Transport controls: pause / resume / stop / seek / set_volume. Mutate
//! state on an already-running sink; don't drive playback startup (see
//! commands.rs for that). Trimmed from psysonic-audio's transport_commands.rs:
//! no radio cold-resume, no try-lock-with-retry (single-threaded IPC calls
//! don't contend with the 100ms progress-task tick enough to matter).
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::engine::AudioEngine;
use crate::helpers::compute_gain;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn current_position_secs(state: &AudioEngine) -> f64 {
    let rate = state.current_sample_rate.load(Ordering::Relaxed) as f64;
    let ch = state.current_channels.load(Ordering::Relaxed) as f64;
    let samples = state.samples_played.load(Ordering::Relaxed) as f64;
    samples / (rate * ch).max(1.0)
}

pub(crate) fn pause(state: &AudioEngine) {
    let mut cur = state.current.lock().unwrap();
    if let Some(sink) = &cur.sink {
        if !sink.is_paused() {
            let pos = current_position_secs(state).min(cur.duration_secs.max(0.001));
            sink.pause();
            cur.paused_at = Some(pos);
            cur.play_started = None;
        }
    }
}

pub(crate) fn resume(state: &AudioEngine) {
    let mut cur = state.current.lock().unwrap();
    if let Some(sink) = &cur.sink {
        if sink.is_paused() {
            let pos = cur.paused_at.unwrap_or(cur.seek_offset);
            sink.play();
            cur.seek_offset = pos;
            cur.play_started = Some(Instant::now());
            cur.paused_at = None;
        }
    }
}

pub(crate) fn stop(state: &AudioEngine) {
    state.generation.fetch_add(1, Ordering::SeqCst);
    *state.chained_info.lock().unwrap() = None;
    let mut cur = state.current.lock().unwrap();
    if let Some(sink) = cur.sink.take() {
        sink.stop();
    }
    cur.duration_secs = 0.0;
    cur.seek_offset = 0.0;
    cur.play_started = None;
    cur.paused_at = None;
}

pub(crate) fn seek(state: &AudioEngine, seconds: f64) -> Result<(), String> {
    const SEEK_TIMEOUT_MS: u64 = 700;

    // Ghost-command guard: reject seeks within 500ms of a gapless auto-advance
    // (a stale UI drag-seek racing the sample-accurate switch).
    let switch_ms = state.gapless_switch_at.load(Ordering::SeqCst);
    if switch_ms > 0 && now_ms().saturating_sub(switch_ms) < 500 {
        return Ok(());
    }

    // Reject up-front for non-seekable sources so the caller's restart
    // fallback engages instead of rolling the dice on the format reader.
    if !state.current_is_seekable.load(Ordering::SeqCst) {
        return Err("source is not seekable".into());
    }

    // Seeking backward invalidates any pending gapless chain (the trim/decode
    // pipeline for the chained track assumed the current track would finish
    // normally; jumping back means it won't for a while, if ever).
    let cur_pos = current_position_secs(state);
    if seconds < cur_pos - 1.0 {
        *state.chained_info.lock().unwrap() = None;
    }

    let seek_seconds = seconds.max(0.0);
    let seek_duration = Duration::from_secs_f64(seek_seconds);
    let seek_generation = state.generation.load(Ordering::SeqCst);

    let sink = {
        let cur = state.current.lock().unwrap();
        match cur.sink.as_ref() {
            Some(sink) => Arc::clone(sink),
            None => return Ok(()),
        }
    };

    // rodio's try_seek can block on decoder I/O; run it off this call's
    // thread with a hard timeout so a stalled seek can't wedge the caller.
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || {
        let result = sink.try_seek(seek_duration).map_err(|e| e.to_string());
        let _ = tx.send(result);
    });
    match rx.recv_timeout(Duration::from_millis(SEEK_TIMEOUT_MS)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => return Err("audio seek timeout".into()),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return Err("audio seek worker disconnected".into()),
    }

    if state.generation.load(Ordering::SeqCst) != seek_generation {
        return Ok(()); // playback switched while the seek was in flight
    }

    let rate = state.current_sample_rate.load(Ordering::Relaxed) as f64;
    let ch = state.current_channels.load(Ordering::Relaxed) as f64;
    let mut cur = state.current.lock().unwrap();
    if cur.sink.is_none() {
        return Ok(());
    }
    if cur.paused_at.is_some() {
        cur.paused_at = Some(seek_seconds);
    } else {
        cur.seek_offset = seek_seconds;
        cur.play_started = Some(Instant::now());
    }
    state.samples_played.store((seek_seconds * rate * ch) as u64, Ordering::Relaxed);
    Ok(())
}

pub(crate) fn set_volume(state: &AudioEngine, volume: f32) {
    state.volume.store(volume.to_bits(), Ordering::Relaxed);
    let effective = compute_gain(volume);
    let cur = state.current.lock().unwrap();
    if let Some(sink) = &cur.sink {
        sink.set_volume(effective);
    }
}
