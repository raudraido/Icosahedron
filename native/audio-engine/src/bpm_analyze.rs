//! Downloads a track in full and runs BPM detection over it (bpm.rs). Unlike
//! playback (commands.rs/play_input.rs), this needs no ranged-HTTP streaming,
//! seeking, or gapless trim — just the whole decoded signal once — so it's a
//! plain, self-contained download+decode path rather than reusing the
//! playback source-building pipeline.
use rodio::Source;

use crate::decode::SizedDecoder;
use crate::engine::AudioEngine;
use crate::helpers::{content_type_to_hint, resolve_playback_format_hint, url_format_hint};

pub(crate) async fn analyze_bpm(state: &AudioEngine, url: String) -> Result<f64, String> {
    let url_hint = url_format_hint(&url);

    let response = state.http_client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    let media_hint = content_type_to_hint(
        response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or(""),
    );
    let data = response.bytes().await.map_err(|e| e.to_string())?.to_vec();
    let hint = resolve_playback_format_hint(url_hint.as_deref(), media_hint.as_deref(), Some(&data));

    let decoder = SizedDecoder::new(data, hint.as_deref())?;
    let channels = decoder.channels().get();
    let sample_rate = decoder.sample_rate().get();
    let samples: Vec<f32> = decoder.collect();

    crate::bpm::detect_bpm(&samples, channels, sample_rate)
        .map(|bpm| bpm as f64)
        .ok_or_else(|| "BPM detection failed (track too short/quiet, or no clear tempo)".to_string())
}
