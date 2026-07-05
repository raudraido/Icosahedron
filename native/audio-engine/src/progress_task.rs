//! Per-generation progress + ended-detection task. Spawned once per `play`
//! invocation; ticks at 100ms, emits progress (throttled), handles the
//! gapless transition when the current source exhausts and a chained
//! successor is queued, and emits `ended` when no successor exists.
//! Trimmed from psysonic-audio's progress_task.rs: no crossfade near-end
//! timer, no playback-rate/analysis hooks, no replaygain ramp at the
//! transition boundary (volume is uniform across tracks here).
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::engine::AudioCurrent;
use crate::state::ChainedInfo;

pub(crate) struct ProgressPayload {
    pub(crate) current_time: f64,
    pub(crate) duration: f64,
    pub(crate) buffering: bool,
}

/// Sink for the events the task emits. Production wraps a napi
/// `ThreadsafeFunction` (see events.rs).
pub(crate) trait ProgressEmitter: Send + Sync + 'static {
    fn emit_progress(&self, payload: ProgressPayload);
    fn emit_track_switched(&self, duration_secs: f64);
    fn emit_ended(&self);
}

#[cfg(target_os = "linux")]
fn estimated_output_latency_secs(sample_rate_hz: f64) -> f64 {
    let rate = sample_rate_hz.max(1.0);
    (4096.0 / rate) + 0.012
}
#[cfg(not(target_os = "linux"))]
fn estimated_output_latency_secs(_sample_rate_hz: f64) -> f64 {
    0.0
}

const PROGRESS_EMIT_MIN_MS: u64 = 1500;
const PROGRESS_EMIT_MIN_DELTA_SECS: f64 = 0.9;
/// Watchdog ceiling for a source that never signals exhaustion (stalled or
/// malformed decoder). Without this, `ended` relies solely on the
/// sample-accurate `current_done` flag.
const END_WATCHDOG_TICKS: u32 = 80;

#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_progress_task<E: ProgressEmitter>(
    gen: u64,
    gen_counter: Arc<AtomicU64>,
    current_arc: Arc<Mutex<AudioCurrent>>,
    chained_arc: Arc<Mutex<Option<ChainedInfo>>>,
    initial_done: Arc<AtomicBool>,
    emitter: E,
    samples_played: Arc<AtomicU64>,
    sample_rate_arc: Arc<AtomicU32>,
    channels_arc: Arc<AtomicU32>,
    gapless_switch_at: Arc<AtomicU64>,
    stream_playback_armed: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        let mut near_end_ticks: u32 = 0;
        let mut current_done = initial_done;
        let mut samples_played = samples_played;
        let mut last_progress_emit_at = Instant::now() - Duration::from_millis(PROGRESS_EMIT_MIN_MS);
        let mut last_progress_emit_pos = -1.0f64;
        let mut last_progress_emit_paused = false;

        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;

            if gen_counter.load(Ordering::SeqCst) != gen {
                break;
            }

            // ── Gapless transition detection ─────────────────────────────────
            if current_done.load(Ordering::SeqCst) {
                let chained = chained_arc.lock().unwrap().take();
                if let Some(info) = chained {
                    current_done = info.source_done;
                    samples_played = info.sample_counter;

                    {
                        let mut cur = current_arc.lock().unwrap();
                        cur.duration_secs = info.duration_secs;
                        cur.seek_offset = 0.0;
                        cur.play_started = Some(Instant::now());
                        cur.paused_at = None;
                    }

                    let switch_ts = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    gapless_switch_at.store(switch_ts, Ordering::SeqCst);

                    emitter.emit_track_switched(info.duration_secs);
                    near_end_ticks = 0;
                    continue;
                }
                // Source exhausted, no chain queued — real, sample-accurate end.
                gen_counter.fetch_add(1, Ordering::SeqCst);
                emitter.emit_ended();
                break;
            }

            let rate = sample_rate_arc.load(Ordering::Relaxed) as f64;
            let ch = channels_arc.load(Ordering::Relaxed) as f64;
            let samples = samples_played.load(Ordering::Relaxed) as f64;
            let divisor = (rate * ch).max(1.0);

            let (base_dur, paused_at) = {
                let cur = current_arc.lock().unwrap();
                (cur.duration_secs, cur.paused_at)
            };
            let is_paused = paused_at.is_some();

            let pos_raw = if !stream_playback_armed.load(Ordering::Relaxed) {
                0.0
            } else if let Some(p) = paused_at {
                p
            } else {
                (samples / divisor).min(base_dur.max(0.001))
            };
            let progress_latency = if is_paused { 0.0 } else { estimated_output_latency_secs(rate) };
            let pos = (pos_raw - progress_latency).max(0.0);

            let now = Instant::now();
            let should_emit_progress = is_paused != last_progress_emit_paused
                || now.duration_since(last_progress_emit_at) >= Duration::from_millis(PROGRESS_EMIT_MIN_MS)
                || (pos - last_progress_emit_pos).abs() >= PROGRESS_EMIT_MIN_DELTA_SECS;
            if should_emit_progress {
                let buffering = !stream_playback_armed.load(Ordering::Relaxed);
                emitter.emit_progress(ProgressPayload { current_time: pos, duration: base_dur, buffering });
                last_progress_emit_at = now;
                last_progress_emit_pos = pos;
                last_progress_emit_paused = is_paused;
            }

            if is_paused {
                continue;
            }

            let end_threshold = 1.0;
            if base_dur > end_threshold && pos_raw >= base_dur - end_threshold {
                near_end_ticks += 1;
                if near_end_ticks >= 10 {
                    let has_chain = chained_arc.lock().unwrap().is_some();
                    if has_chain {
                        continue;
                    }
                    // No chain yet — the sample-accurate `current_done` branch
                    // above is the real end trigger; this timer only guards
                    // against a source that never signals exhaustion.
                    if near_end_ticks >= END_WATCHDOG_TICKS {
                        gen_counter.fetch_add(1, Ordering::SeqCst);
                        emitter.emit_ended();
                        break;
                    }
                }
            } else {
                near_end_ticks = 0;
            }
        }
    });
}
