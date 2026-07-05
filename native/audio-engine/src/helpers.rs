//! URL identity, format-hint resolution, gain math, and byte-fetch helpers.
//! Trimmed from psysonic-audio's helpers.rs: no replaygain/loudness/analysis.
use std::sync::atomic::Ordering;

use futures_util::StreamExt;

use crate::engine::AudioEngine;

pub(crate) fn content_type_to_hint(ct: &str) -> Option<String> {
    let ct = ct.to_ascii_lowercase();
    if ct.contains("mpeg") || ct.contains("mp3") { Some("mp3".into()) }
    else if ct.contains("aac") || ct.contains("aacp") { Some("aac".into()) }
    else if ct.contains("ogg") { Some("ogg".into()) }
    else if ct.contains("flac") { Some("flac".into()) }
    else if ct.contains("wav") || ct.contains("wave") { Some("wav".into()) }
    else if ct.contains("audio/mp4") || ct.contains("x-m4a") || ct.contains("/m4a") { Some("m4a".into()) }
    else { None }
}

/// Magic-byte sniff on the start of an HTTP body when headers/URL didn't yield a hint.
pub(crate) fn sniff_stream_format_extension(data: &[u8]) -> Option<String> {
    if data.is_empty() { return None; }
    if data.len() >= 4 && data[0..4] == *b"fLaC" { return Some("flac".into()); }
    if data.len() >= 4 && data[0..4] == *b"OggS" { return Some("ogg".into()); }
    if data.len() >= 12 && data[0..4] == *b"RIFF" && data[8..12] == *b"WAVE" { return Some("wav".into()); }
    let scan = data.len().min(4096).saturating_sub(4);
    for i in 0..=scan {
        if data[i..i + 4] == *b"ftyp" { return Some("m4a".into()); }
    }
    None
}

pub(crate) const STREAM_FORMAT_SNIFF_PROBE_BYTES: usize = 256 * 1024;

/// Strip the query string first so Subsonic-style URLs
/// (`stream?...&v=1.16.1&...`) don't latch onto random query-param
/// substrings; only accept short alphanumeric tails that look like a real
/// audio extension.
pub(crate) fn url_format_hint(url: &str) -> Option<String> {
    url.split('?').next()
        .and_then(|path| path.rsplit('.').next())
        .filter(|ext| {
            (1..=5).contains(&ext.len())
                && ext.chars().all(|c| c.is_ascii_alphanumeric())
                && matches!(
                    ext.to_ascii_lowercase().as_str(),
                    "mp3" | "flac" | "ogg" | "oga" | "opus" | "m4a" | "mp4"
                    | "aac" | "wav" | "wave" | "ape" | "wv" | "webm" | "mka"
                )
        })
        .map(|s| s.to_lowercase())
}

pub(crate) fn resolve_playback_format_hint(
    url_hint: Option<&str>,
    media_hint: Option<&str>,
    data: Option<&[u8]>,
) -> Option<String> {
    media_hint.map(str::to_string)
        .or_else(|| url_hint.map(str::to_string))
        .or_else(|| data.and_then(sniff_stream_format_extension))
}

/// Subsonic stream URLs carry a fresh random salt/token on every call
/// (`t=`/`s=` params), so two URLs for the same track differ byte-for-byte.
/// Compare a stable key instead: the `id=` query param on a `/rest/stream` path.
pub(crate) fn playback_identity(url: &str) -> Option<String> {
    if !url.contains("/rest/stream") {
        return None;
    }
    let q = url.split('?').nth(1)?;
    for pair in q.split('&') {
        if let Some(v) = pair.strip_prefix("id=") {
            let v = v.split('&').next().unwrap_or(v);
            return Some(format!("stream:{v}"));
        }
    }
    None
}

pub(crate) fn same_playback_target(a_url: &str, b_url: &str) -> bool {
    match (playback_identity(a_url), playback_identity(b_url)) {
        (Some(a), Some(b)) => a == b,
        _ => a_url == b_url,
    }
}

/// -1 dB headroom applied at full scale to prevent inter-sample clipping.
pub(crate) const MASTER_HEADROOM: f32 = 0.891_254;

/// No replaygain/loudness normalization — just the user's volume slider,
/// clamped, with fixed anti-clip headroom.
pub(crate) fn compute_gain(volume: f32) -> f32 {
    (volume.clamp(0.0, 1.0) * MASTER_HEADROOM).clamp(0.0, 1.0)
}

/// Fetch track bytes from the preload cache or via HTTP, aborting mid-stream
/// if the generation counter moves (a rapid manual skip supersedes this fetch).
pub(crate) async fn fetch_data(
    url: &str,
    state: &AudioEngine,
    gen: u64,
) -> Result<Option<Vec<u8>>, String> {
    let cached = {
        let mut preloaded = state.preloaded.lock().unwrap();
        if preloaded.as_ref().is_some_and(|p| same_playback_target(&p.url, url)) {
            preloaded.take().map(|p| p.data)
        } else {
            None
        }
    };
    if let Some(data) = cached {
        return Ok(Some(data));
    }

    let response = state.http_client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        if state.generation.load(Ordering::SeqCst) != gen {
            return Ok(None);
        }
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    let hint = response.content_length().unwrap_or(0) as usize;
    let mut stream = response.bytes_stream();
    let mut data = Vec::with_capacity(hint);
    while let Some(chunk) = stream.next().await {
        if state.generation.load(Ordering::SeqCst) != gen {
            return Ok(None);
        }
        data.extend_from_slice(&chunk.map_err(|e| e.to_string())?);
    }
    Ok(Some(data))
}
