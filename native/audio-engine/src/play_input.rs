//! Source-selection logic for `play`: given a URL, decide whether to play
//! from in-memory bytes or a seekable `RangedHttpSource`. Simplified from
//! psysonic-audio's play_input.rs: no local-file scheme (Icosahedron only
//! ever plays Subsonic HTTP stream URLs), no MP4 moov-at-end tail-prefetch
//! gate, no analysis dispatch, no legacy non-seekable streaming fallback
//! (falls back straight to a full in-memory fetch instead).
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use symphonia::core::io::MediaSource;

use crate::decode::{build_source, build_streaming_source, BuiltSource, SizedDecoder};
use crate::engine::AudioEngine;
use crate::helpers::{
    content_type_to_hint, fetch_data, resolve_playback_format_hint, same_playback_target,
    sniff_stream_format_extension, url_format_hint, STREAM_FORMAT_SNIFF_PROBE_BYTES,
};
use crate::stream::{ranged_download_task, RangedHttpSource};

pub(crate) enum PlayInput {
    Bytes(Vec<u8>),
    /// Seekable on-demand `RangedHttpSource` — low-latency path for manual
    /// play/skip. No iTunSMPB scan (bytes aren't fully in memory yet); the
    /// gapless-chain path always uses `Bytes` instead, where the trim applies.
    SeekableMedia { reader: Box<dyn MediaSource>, format_hint: Option<String> },
}

pub(crate) struct PlaybackSource {
    pub(crate) built: BuiltSource,
    pub(crate) is_seekable: bool,
}

/// Resolves the play input for `play`, honouring (in priority order):
/// 1. Reused chained bytes — manual skip onto a pre-chained track.
/// 2. Preload-cache hit — replay in-memory bytes.
/// 3. Otherwise: try ranged HTTP (seekable, low-latency), falling back to a
///    full in-memory fetch if the server doesn't support `Range`.
///
/// Returns `Ok(None)` when superseded by a later `play` call (generation bump).
pub(crate) async fn select_play_input(
    url: &str,
    gen: u64,
    reuse_chained_bytes: Option<Vec<u8>>,
    state: &AudioEngine,
) -> Result<Option<PlayInput>, String> {
    if let Some(d) = reuse_chained_bytes {
        return Ok(Some(PlayInput::Bytes(d)));
    }

    let preloaded_hit = {
        let preloaded = state.preloaded.lock().unwrap();
        preloaded.as_ref().is_some_and(|p| same_playback_target(&p.url, url))
    };
    if preloaded_hit {
        return match fetch_data(url, state, gen).await? {
            Some(d) => Ok(Some(PlayInput::Bytes(d))),
            None => Ok(None),
        };
    }

    open_ranged_or_bytes_input(url, gen, state).await
}

async fn open_ranged_or_bytes_input(
    url: &str,
    gen: u64,
    state: &AudioEngine,
) -> Result<Option<PlayInput>, String> {
    let response = state.http_client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        if state.generation.load(Ordering::SeqCst) != gen {
            return Ok(None);
        }
        return Err(format!("HTTP {}", response.status().as_u16()));
    }

    let mut stream_hint = content_type_to_hint(
        response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or(""),
    ).or_else(|| url_format_hint(url));

    let supports_range = response.headers()
        .get(reqwest::header::ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.to_ascii_lowercase().contains("bytes"));
    let total_size = response.content_length();

    if stream_hint.is_none() && supports_range {
        if let Some(total_u64) = total_size.filter(|&t| t > 0) {
            let last = total_u64.saturating_sub(1).min((STREAM_FORMAT_SNIFF_PROBE_BYTES - 1) as u64);
            if let Ok(pr) = state.http_client.get(url)
                .header(reqwest::header::RANGE, format!("bytes=0-{last}"))
                .send()
                .await
            {
                let ok = pr.status() == reqwest::StatusCode::PARTIAL_CONTENT || pr.status() == reqwest::StatusCode::OK;
                if ok {
                    if let Ok(bytes) = pr.bytes().await {
                        if !bytes.is_empty() {
                            stream_hint = sniff_stream_format_extension(&bytes).or(stream_hint);
                        }
                    }
                }
            }
        }
    }

    if let (true, Some(total), true) = (supports_range, total_size, stream_hint.is_some()) {
        let total_usize = total as usize;
        let buf = Arc::new(Mutex::new(vec![0u8; total_usize]));
        let downloaded_to = Arc::new(AtomicUsize::new(0));
        let done = Arc::new(AtomicBool::new(false));
        state.stream_playback_armed.store(false, Ordering::SeqCst);

        tokio::spawn(ranged_download_task(
            gen,
            state.generation.clone(),
            response,
            buf.clone(),
            downloaded_to.clone(),
            done.clone(),
            state.stream_playback_armed.clone(),
        ));

        let reader = RangedHttpSource {
            buf, downloaded_to, total_size: total, pos: 0, done,
            gen_arc: state.generation.clone(), gen,
        };
        return Ok(Some(PlayInput::SeekableMedia { reader: Box::new(reader), format_hint: stream_hint }));
    }

    // No Range support (or no content-length/hint) — consume this response's
    // body directly as a full in-memory fetch; no second request needed.
    state.stream_playback_armed.store(true, Ordering::SeqCst);
    let data = response.bytes().await.map_err(|e| e.to_string())?.to_vec();
    Ok(Some(PlayInput::Bytes(data)))
}

fn play_media_format_hint(input: &PlayInput) -> Option<String> {
    match input {
        PlayInput::SeekableMedia { format_hint, .. } => format_hint.clone(),
        PlayInput::Bytes(_) => None,
    }
}

fn is_ranged_stream_probe_failure(err: &str) -> bool {
    err.contains("format probe failed") || err.contains("no audio track found") || err.contains("end of stream")
}

/// Dispatches `PlayInput` → fully wrapped rodio source. On a ranged-stream
/// probe failure (e.g. moov-at-end MP4, or a server that lied about Range
/// support), falls back once to a full in-memory fetch + `build_source`.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn build_playback_source_with_probe_fallback(
    play_input: PlayInput,
    url: &str,
    gen: u64,
    url_format_hint: Option<&str>,
    done_flag: Arc<AtomicBool>,
    fade_in_dur: Duration,
    duration_hint: f64,
    state: &AudioEngine,
) -> Result<PlaybackSource, String> {
    let media_hint = play_media_format_hint(&play_input);
    let effective_hint = resolve_playback_format_hint(url_format_hint, media_hint.as_deref(), None);

    match build_source_from_play_input(play_input, effective_hint.as_deref(), done_flag.clone(), fade_in_dur, duration_hint, state).await {
        Ok(p) => Ok(p),
        Err(e) if is_ranged_stream_probe_failure(&e) => {
            let data = fetch_data(url, state, gen).await?;
            let data = match data {
                Some(d) => d,
                None => return Err(e),
            };
            if state.generation.load(Ordering::SeqCst) != gen {
                return Err("superseded during full-buffer fallback".into());
            }
            let bytes_hint = resolve_playback_format_hint(url_format_hint, media_hint.as_deref(), Some(&data));
            build_source_from_play_input(
                PlayInput::Bytes(data),
                bytes_hint.as_deref(),
                done_flag,
                fade_in_dur,
                duration_hint,
                state,
            ).await
        }
        Err(e) => Err(e),
    }
}

async fn build_source_from_play_input(
    play_input: PlayInput,
    format_hint: Option<&str>,
    done_flag: Arc<AtomicBool>,
    fade_in_dur: Duration,
    duration_hint: f64,
    state: &AudioEngine,
) -> Result<PlaybackSource, String> {
    let mut is_seekable = true;
    let built = match play_input {
        PlayInput::Bytes(data) => build_source(
            data, duration_hint, done_flag, fade_in_dur, state.samples_played.clone(), format_hint,
        ),
        PlayInput::SeekableMedia { reader, format_hint: media_hint } => {
            let hint = media_hint;
            let decoder = tokio::task::spawn_blocking(move || SizedDecoder::new_streaming(reader, hint.as_deref()))
                .await
                .map_err(|e| e.to_string())??;
            is_seekable = true;
            build_streaming_source(decoder, duration_hint, done_flag, fade_in_dur, state.samples_played.clone())
        }
    }?;
    Ok(PlaybackSource { built, is_seekable })
}
