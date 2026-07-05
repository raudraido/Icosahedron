//! `play` / `chain_preload` — playback startup and the gapless pre-append.
//! Trimmed from psysonic-audio's commands.rs: no replaygain/loudness/hi-res/
//! crossfade params, no analysis dispatch. Plain async fns (no Tauri
//! `#[tauri::command]`/`State`/`AppHandle` — called directly from lib.rs's
//! `#[napi]` methods).
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use rodio::Player;

use crate::decode::build_source;
use crate::engine::AudioEngine;
use crate::events::NapiEmitter;
use crate::helpers::{compute_gain, same_playback_target, url_format_hint};
use crate::play_input::{build_playback_source_with_probe_fallback, select_play_input};
use crate::progress_task::spawn_progress_task;
use crate::state::ChainedInfo;

/// `manual`: true for user-initiated skip/first-play (bypasses the gapless
/// pre-chain hit and starts immediately). `start_paused`: true for session
/// restore — engine sits paused at position 0 until an explicit `seek`/`resume`.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn play(
    state: &AudioEngine,
    emitter: &Arc<NapiEmitter>,
    url: String,
    volume: f32,
    duration_hint: f64,
    manual: bool,
    start_paused: bool,
) -> Result<(), String> {
    // ── Ghost-command guard ───────────────────────────────────────────────
    // After a gapless auto-advance, the renderer may still fire a stale
    // playTrack() IPC call. Within 500ms of the last switch, suppress it.
    {
        let switch_ms = state.gapless_switch_at.load(Ordering::SeqCst);
        if switch_ms > 0 {
            let now_ms = now_ms();
            if now_ms.saturating_sub(switch_ms) < 500 {
                return Ok(());
            }
        }
    }

    // ── Gapless pre-chain hit ──────────────────────────────────────────────
    // chain_preload already appended this URL to the Sink ~30s in advance.
    // Never for manual skips — the current source is still playing until the
    // chain drains, but a manual skip must clear the chain and start now.
    if !manual {
        let already_chained = state.chained_info.lock().unwrap()
            .as_ref()
            .is_some_and(|c| same_playback_target(&c.url, &url));
        if already_chained {
            return Ok(());
        }
    }

    let gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.stream_playback_armed.store(true, Ordering::SeqCst);

    // Manual skip onto the gapless-pre-chained track: reuse raw bytes (no
    // re-download). Otherwise clear any stale chain metadata.
    let reuse_chained_bytes: Option<Vec<u8>> = if manual {
        let mut ci = state.chained_info.lock().unwrap();
        if ci.as_ref().is_some_and(|c| same_playback_target(&c.url, &url)) {
            ci.take().map(|info| Arc::try_unwrap(info.raw_bytes).unwrap_or_else(|a| (*a).clone()))
        } else {
            *ci = None;
            None
        }
    } else {
        *state.chained_info.lock().unwrap() = None;
        None
    };

    let format_hint = url_format_hint(&url);

    let play_input = match select_play_input(&url, gen, reuse_chained_bytes, state).await? {
        Some(input) => input,
        None => return Ok(()), // superseded by a newer play() while resolving input
    };
    if state.generation.load(Ordering::SeqCst) != gen {
        return Ok(());
    }

    let effective_volume = compute_gain(volume);
    // 5ms micro-fade suppresses a DC-offset click on hard cuts; gapless chain
    // (chain_preload, below) uses zero — sample-accurate boundary, no click.
    let fade_in_dur = Duration::from_millis(5);

    let done_flag = Arc::new(AtomicBool::new(false));
    state.samples_played.store(0, Ordering::Relaxed);

    let playback_source = match build_playback_source_with_probe_fallback(
        play_input, &url, gen, format_hint.as_deref(), done_flag.clone(), fade_in_dur, duration_hint, state,
    ).await {
        Ok(p) => p,
        Err(e) => {
            if state.generation.load(Ordering::SeqCst) == gen {
                emitter.emit_error(e.clone());
            }
            return Err(e);
        }
    };

    state.current_is_seekable.store(playback_source.is_seekable, Ordering::SeqCst);
    let built = playback_source.built;
    state.current_sample_rate.store(built.output_rate, Ordering::Relaxed);
    state.current_channels.store(built.output_channels as u32, Ordering::Relaxed);

    if state.generation.load(Ordering::SeqCst) != gen {
        return Ok(());
    }

    let sink = Arc::new(Player::connect_new(state.stream_handle.mixer()));
    sink.set_volume(effective_volume);
    state.volume.store(volume.to_bits(), Ordering::Relaxed);

    let armed_now = state.stream_playback_armed.load(Ordering::Relaxed);
    let defer_for_buffer = !start_paused && !armed_now;
    if start_paused || defer_for_buffer {
        sink.pause();
    }

    sink.append(built.source);

    let old_sink = {
        let mut cur = state.current.lock().unwrap();
        let old = cur.sink.take();
        cur.sink = Some(sink.clone());
        cur.duration_secs = built.duration_secs;
        cur.seek_offset = 0.0;
        cur.play_started = if start_paused || defer_for_buffer { None } else { Some(Instant::now()) };
        cur.paused_at = if start_paused || defer_for_buffer { Some(0.0) } else { None };
        old
    };
    if let Some(old) = old_sink {
        old.stop();
    }

    if start_paused {
        // Session restore — leave paused; caller issues an explicit seek/resume.
    } else if defer_for_buffer {
        spawn_start_when_armed(
            gen, state.generation.clone(), state.stream_playback_armed.clone(),
            state.current.clone(), sink, built.duration_secs, emitter.clone(),
        );
    } else {
        emitter.emit_playing(built.duration_secs);
    }

    spawn_progress_task(
        gen,
        state.generation.clone(),
        state.current.clone(),
        state.chained_info.clone(),
        done_flag,
        emitter.as_ref().clone(),
        state.samples_played.clone(),
        state.current_sample_rate.clone(),
        state.current_channels.clone(),
        state.gapless_switch_at.clone(),
        state.stream_playback_armed.clone(),
    );

    Ok(())
}

/// Proactively appends the next track to the current Sink ~30s before the
/// current track ends (the frontend decides *when* to call this, based on
/// `audio:progress`). Because this runs well before the boundary, the IPC
/// round-trip is irrelevant — by the time the current track actually ends,
/// the next source is already live in the Sink queue and rodio transitions
/// at sample accuracy. `play()` checks `chained_info.url` on arrival: if it
/// matches, it no-ops (pure no-op on the audio path).
pub(crate) async fn chain_preload(
    state: &AudioEngine,
    url: String,
    duration_hint: f64,
) -> Result<(), String> {
    {
        let chained = state.chained_info.lock().unwrap();
        if chained.as_ref().is_some_and(|c| same_playback_target(&c.url, &url)) {
            return Ok(());
        }
    }
    let has_sink = state.current.lock().unwrap().sink.is_some();
    if !has_sink {
        return Ok(());
    }

    let snapshot_gen = state.generation.load(Ordering::SeqCst);

    let cached = {
        let mut preloaded = state.preloaded.lock().unwrap();
        if preloaded.as_ref().is_some_and(|p| same_playback_target(&p.url, &url)) {
            preloaded.take().map(|p| p.data)
        } else {
            None
        }
    };
    let data = match cached {
        Some(d) => d,
        None => {
            let resp = state.http_client.get(&url).send().await.map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Ok(()); // silently fail — play() will retry when the boundary arrives
            }
            let hint = resp.content_length().unwrap_or(0) as usize;
            let mut stream = resp.bytes_stream();
            let mut buf = Vec::with_capacity(hint);
            while let Some(chunk) = stream.next().await {
                if state.generation.load(Ordering::SeqCst) != snapshot_gen {
                    return Ok(()); // superseded by a manual skip — abort download
                }
                buf.extend_from_slice(&chunk.map_err(|e| e.to_string())?);
            }
            buf
        }
    };

    if state.generation.load(Ordering::SeqCst) != snapshot_gen {
        return Ok(());
    }

    let raw_bytes = Arc::new(data);
    let done_next = Arc::new(AtomicBool::new(false));
    let chain_counter = Arc::new(AtomicU64::new(0));
    let format_hint = url_format_hint(&url);

    let built = build_source(
        (*raw_bytes).clone(), duration_hint, done_next.clone(), Duration::ZERO, chain_counter.clone(), format_hint.as_deref(),
    )?;

    if state.generation.load(Ordering::SeqCst) != snapshot_gen {
        return Ok(());
    }

    {
        let cur = state.current.lock().unwrap();
        match &cur.sink {
            Some(sink) => sink.append(built.source),
            None => return Ok(()), // playback stopped while we were downloading/decoding
        }
    }

    *state.chained_info.lock().unwrap() = Some(ChainedInfo {
        url,
        raw_bytes,
        duration_secs: built.duration_secs,
        source_done: done_next,
        sample_counter: chain_counter,
    });

    Ok(())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Ranged-HTTP first play: the sink starts paused until the download task
/// arms playback (enough bytes buffered), then this resets counters and
/// emits `playing` so the UI doesn't extrapolate ahead of audible output.
fn spawn_start_when_armed(
    gen: u64,
    gen_arc: Arc<AtomicU64>,
    playback_armed: Arc<AtomicBool>,
    current: Arc<std::sync::Mutex<crate::engine::AudioCurrent>>,
    sink: Arc<Player>,
    duration_secs: f64,
    emitter: Arc<NapiEmitter>,
) {
    tokio::spawn(async move {
        loop {
            if gen_arc.load(Ordering::SeqCst) != gen {
                return;
            }
            if playback_armed.load(Ordering::Relaxed) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if gen_arc.load(Ordering::SeqCst) != gen {
            return;
        }
        {
            let mut cur = current.lock().unwrap();
            cur.play_started = Some(Instant::now());
            cur.paused_at = None;
            cur.seek_offset = 0.0;
        }
        sink.play();
        emitter.emit_playing(duration_secs);
    });
}
