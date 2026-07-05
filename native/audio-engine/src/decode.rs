//! Symphonia `SizedDecoder`, gapless trim, and `build_source` / `build_streaming_source`.
//! Forked from psysonic-audio's decode.rs, trimmed of EQ/playback-rate/hi-res
//! and application-level resampling (rodio's Sink already resamples each
//! appended source to the output device rate internally).
use std::io::{Cursor, Read, Seek};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Arc;
use std::time::Duration;

use rodio::Source;
use symphonia::core::{
    audio::{AudioBufferRef, SampleBuffer, SignalSpec},
    codecs::{DecoderOptions, CODEC_TYPE_NULL},
    formats::{FormatOptions, FormatReader, SeekMode, SeekTo},
    io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    probe::Hint,
    units::{self, Time},
};

use crate::sources::*;

// ─── SizedCursorSource — correct byte_len for seekable in-memory sources ──────
//
// rodio's internal ReadSeekSource wraps Cursor<Vec<u8>> but hardcodes
// byte_len() → None, which prevents the FLAC demuxer from seeking (it
// validates seek offsets against the total stream length). This wrapper
// supplies the real length, fixing seek for all formats.

pub(crate) struct SizedCursorSource {
    inner: Cursor<Vec<u8>>,
    len: u64,
}

impl Read for SizedCursorSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.inner.read(buf)
    }
}

impl Seek for SizedCursorSource {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}

impl MediaSource for SizedCursorSource {
    fn is_seekable(&self) -> bool { true }
    fn byte_len(&self) -> Option<u64> { Some(self.len) }
}

/// Max retries for IO/packet-read errors (fatal — network drop, truncated file).
const DECODE_MAX_RETRIES: usize = 3;
/// Max *consecutive* DecodeErrors before giving up on a file.
const MAX_CONSECUTIVE_DECODE_ERRORS: usize = 100;

pub(crate) struct SizedDecoder {
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    current_frame_offset: usize,
    format: Box<dyn FormatReader>,
    total_duration: Option<Time>,
    buffer: SampleBuffer<f32>,
    spec: SignalSpec,
    consecutive_decode_errors: usize,
}

impl SizedDecoder {
    pub(crate) fn new(data: Vec<u8>, format_hint: Option<&str>) -> Result<Self, String> {
        let data_len = data.len() as u64;
        let source = SizedCursorSource { inner: Cursor::new(data), len: data_len };
        let mss = MediaSourceStream::new(
            Box::new(source) as Box<dyn MediaSource>,
            MediaSourceStreamOptions { buffer_len: 512 * 1024 },
        );

        let mut hint = Hint::new();
        if let Some(ext) = format_hint {
            hint.with_extension(ext);
        }
        let format_opts = FormatOptions {
            // Disable gapless parsing — Symphonia 0.5.5 crashes on `edts` atoms
            // present in older iTunes-purchased M4A files; we do our own
            // iTunSMPB byte-scan instead (parse_gapless_info below).
            enable_gapless: false,
            ..Default::default()
        };
        let meta_opts = MetadataOptions {
            limit_visual_bytes: symphonia::core::meta::Limit::Maximum(8 * 1024 * 1024),
            ..Default::default()
        };

        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &format_opts, &meta_opts)
            .map_err(|e| {
                let hint_str = format_hint.unwrap_or("unknown");
                eprintln!("[audio-engine] probe failed (hint={hint_str}): {e}");
                if e.to_string().to_lowercase().contains("unsupported") {
                    format!("unsupported format: .{hint_str} files cannot be played (no demuxer)")
                } else {
                    format!("could not open audio stream (.{hint_str}): {e}")
                }
            })?;

        let track = probed.format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL && t.codec_params.sample_rate.is_some())
            .ok_or_else(|| "no playable audio track found in file".to_string())?;

        let track_id = track.id;
        let total_duration = track.codec_params.time_base
            .zip(track.codec_params.n_frames)
            .map(|(base, frames)| base.calc_time(frames));

        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| {
                if e.to_string().to_lowercase().contains("unsupported") {
                    "unsupported codec: no decoder available for this audio format".to_string()
                } else {
                    format!("failed to initialise audio decoder: {e}")
                }
            })?;

        let mut format = probed.format;

        let mut decode_errors: usize = 0;
        let decoded = loop {
            let packet = match format.next_packet() {
                Ok(p) => p,
                Err(symphonia::core::errors::Error::IoError(_)) => break decoder.last_decoded(),
                Err(e) => return Err(format!("could not read audio data: {e}")),
            };
            if packet.track_id() != track_id {
                continue;
            }
            match decoder.decode(&packet) {
                Ok(decoded) => break decoded,
                Err(symphonia::core::errors::Error::DecodeError(_)) => {
                    decode_errors += 1;
                    if decode_errors >= MAX_CONSECUTIVE_DECODE_ERRORS {
                        return Err("too many consecutive decode errors during init — file may be corrupt".into());
                    }
                }
                Err(e) => return Err(format!("audio decode error: {e}")),
            }
        };

        let spec = decoded.spec().to_owned();
        let buffer = Self::make_buffer(decoded, &spec);

        Ok(SizedDecoder {
            decoder, current_frame_offset: 0, format, total_duration, buffer, spec,
            consecutive_decode_errors: 0,
        })
    }

    /// Build a decoder from any `MediaSource` (e.g. ranged-HTTP progressive read).
    pub(crate) fn new_streaming(
        media: Box<dyn MediaSource>,
        format_hint: Option<&str>,
    ) -> Result<Self, String> {
        let mss = MediaSourceStream::new(media, MediaSourceStreamOptions { buffer_len: 512 * 1024 });
        let mut hint = Hint::new();
        if let Some(ext) = format_hint { hint.with_extension(ext); }
        let format_opts = FormatOptions { enable_gapless: false, ..Default::default() };
        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &format_opts, &MetadataOptions::default())
            .map_err(|e| format!("format probe failed: {e}"))?;

        let track = probed.format.tracks().iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| "no audio track found".to_string())?;
        let track_id = track.id;
        let total_duration = None;
        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| format!("codec init failed: {e}"))?;
        let mut format = probed.format;

        let mut errors = 0usize;
        let decoded = loop {
            let packet = match format.next_packet() {
                Ok(p) => p,
                Err(_) => break decoder.last_decoded(),
            };
            if packet.track_id() != track_id { continue; }
            match decoder.decode(&packet) {
                Ok(d) => break d,
                Err(symphonia::core::errors::Error::DecodeError(_)) => {
                    errors += 1;
                    if errors >= MAX_CONSECUTIVE_DECODE_ERRORS {
                        return Err("too many consecutive decode errors".into());
                    }
                }
                Err(e) => return Err(format!("decode error: {e}")),
            }
        };
        let spec = decoded.spec().to_owned();
        let buffer = Self::make_buffer(decoded, &spec);
        Ok(SizedDecoder { decoder, current_frame_offset: 0, format, total_duration, buffer, spec, consecutive_decode_errors: 0 })
    }

    #[inline]
    fn make_buffer(decoded: AudioBufferRef, spec: &SignalSpec) -> SampleBuffer<f32> {
        let duration = units::Duration::from(decoded.capacity() as u64);
        let mut buffer = SampleBuffer::<f32>::new(duration, *spec);
        buffer.copy_interleaved_ref(decoded);
        buffer
    }

    fn refine_position(&mut self, seek_res: symphonia::core::formats::SeekedTo) -> Result<(), String> {
        let mut samples_to_pass = seek_res.required_ts - seek_res.actual_ts;
        let packet = loop {
            let candidate = self.format.next_packet().map_err(|e| format!("refine seek: {e}"))?;
            if candidate.dur() > samples_to_pass {
                break candidate;
            }
            samples_to_pass -= candidate.dur();
        };

        let mut decoded = self.decoder.decode(&packet);
        for _ in 0..DECODE_MAX_RETRIES {
            if decoded.is_err() {
                let p = self.format.next_packet().map_err(|e| format!("refine retry: {e}"))?;
                decoded = self.decoder.decode(&p);
            }
        }

        let decoded = decoded.map_err(|e| format!("refine decode: {e}"))?;
        decoded.spec().clone_into(&mut self.spec);
        self.buffer = Self::make_buffer(decoded, &self.spec);
        self.current_frame_offset = samples_to_pass as usize * self.spec.channels.count();
        Ok(())
    }
}

impl Iterator for SizedDecoder {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        if self.current_frame_offset >= self.buffer.len() {
            loop {
                let packet = self.format.next_packet().ok()?;
                match self.decoder.decode(&packet) {
                    Ok(decoded) => {
                        self.consecutive_decode_errors = 0;
                        decoded.spec().clone_into(&mut self.spec);
                        self.buffer = Self::make_buffer(decoded, &self.spec);
                        self.current_frame_offset = 0;
                        break;
                    }
                    Err(symphonia::core::errors::Error::DecodeError(_)) => {
                        self.consecutive_decode_errors += 1;
                        if self.consecutive_decode_errors >= MAX_CONSECUTIVE_DECODE_ERRORS {
                            return None;
                        }
                    }
                    Err(_) => return None,
                }
            }
        }

        let sample = *self.buffer.samples().get(self.current_frame_offset)?;
        self.current_frame_offset += 1;
        Some(sample)
    }
}

impl Source for SizedDecoder {
    #[inline]
    fn current_span_len(&self) -> Option<usize> { Some(self.buffer.samples().len()) }

    #[inline]
    fn channels(&self) -> rodio::ChannelCount {
        std::num::NonZeroU16::new(self.spec.channels.count() as u16).unwrap_or(std::num::NonZeroU16::MIN)
    }

    #[inline]
    fn sample_rate(&self) -> rodio::SampleRate {
        std::num::NonZeroU32::new(self.spec.rate).unwrap_or(std::num::NonZeroU32::MIN)
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        self.total_duration.map(|Time { seconds, frac }| Duration::new(seconds, (frac * 1_000_000_000.0) as u32))
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        let seek_beyond_end = self.total_duration().is_some_and(|dur| dur.saturating_sub(pos).as_millis() < 1);
        let time: Time = if seek_beyond_end {
            let t = self.total_duration.unwrap_or(pos.as_secs_f64().into());
            let mut secs = t.seconds;
            let mut frac = t.frac - 0.0001;
            if frac < 0.0 { secs = secs.saturating_sub(1); frac = 1.0 - frac; }
            Time { seconds: secs, frac }
        } else {
            pos.as_secs_f64().into()
        };

        let to_skip = self.current_frame_offset % self.channels().get() as usize;
        let seek_res = self.format
            .seek(SeekMode::Accurate, SeekTo::Time { time, track_id: None })
            .map_err(|e| rodio::source::SeekError::Other(Arc::new(std::io::Error::other(e.to_string()))))?;
        self.refine_position(seek_res)
            .map_err(|e| rodio::source::SeekError::Other(Arc::new(std::io::Error::other(e))))?;
        self.current_frame_offset += to_skip;
        Ok(())
    }
}

// ─── Encoder-gap trimming (iTunSMPB) ─────────────────────────────────────────
//
// MP3/AAC encoders prepend an "encoder delay" (576–2112 silent samples for
// LAME) and append end-padding. iTunes embeds the exact counts in an ID3v2
// COMM frame with description "iTunSMPB":
// " 00000000 DELAY PADDING TOTAL ..." (space-separated hex).

#[derive(Default)]
pub(crate) struct GaplessInfo {
    delay_samples: u64,
    total_valid_samples: Option<u64>,
}

pub(crate) fn find_subsequence(data: &[u8], needle: &[u8]) -> Option<usize> {
    data.windows(needle.len()).position(|w| w == needle)
}

pub(crate) fn parse_gapless_info(data: &[u8]) -> GaplessInfo {
    let pos = match find_subsequence(data, b"iTunSMPB") {
        Some(p) => p,
        None => return GaplessInfo::default(),
    };

    // M4A/iTunes files: the key is followed by a binary 'data' atom header
    // (16 bytes) before the value string. Locate the true start via the
    // " 00000000 " sentinel every iTunSMPB value starts with.
    let search_end = data.len().min(pos + 8 + 128);
    let search_window = &data[pos + 8..search_end];
    let value_start = find_subsequence(search_window, b" 00000000 ")
        .map(|off| pos + 8 + off)
        .unwrap_or(pos + 8);

    let tail = &data[value_start..data.len().min(value_start + 256)];
    let text: String = tail.iter()
        .map(|&b| b as char)
        .filter(|c| c.is_ascii_hexdigit() || *c == ' ')
        .collect();

    let parts: Vec<&str> = text.split_whitespace().collect();
    if parts.len() < 3 {
        return GaplessInfo::default();
    }
    let delay = u64::from_str_radix(parts.get(1).unwrap_or(&"0"), 16).unwrap_or(0);
    let total_raw = parts.get(3).and_then(|s| u64::from_str_radix(s, 16).ok());
    let total_valid = total_raw.filter(|&t| t > 0);

    GaplessInfo { delay_samples: delay, total_valid_samples: total_valid }
}

pub(crate) type BuiltSourceStack = PriorityBoostSource<CountingSource<NotifyingSource<EqualPowerFadeIn<DynSource>>>>;

pub(crate) struct BuiltSource {
    pub(crate) source: BuiltSourceStack,
    pub(crate) duration_secs: f64,
    pub(crate) output_rate: u32,
    pub(crate) output_channels: u16,
}

/// Build a fully-prepared playback source: decode → trim → fade-in → notify → count → boost.
///
/// `fade_in_dur`: `Duration::ZERO` for gapless chain (unity gain, no click);
/// `Duration::from_millis(5)` micro-fade for manual/first play (anti-click).
pub(crate) fn build_source(
    data: Vec<u8>,
    duration_hint: f64,
    done_flag: Arc<AtomicBool>,
    fade_in_dur: Duration,
    sample_counter: Arc<AtomicU64>,
    format_hint: Option<&str>,
) -> Result<BuiltSource, String> {
    let gapless = parse_gapless_info(&data);
    let decoder = SizedDecoder::new(data, format_hint)?;
    let sample_rate = decoder.sample_rate();
    let channels = decoder.channels();

    let effective_dur = if duration_hint > 1.0 {
        duration_hint
    } else {
        decoder.total_duration().map(|d| d.as_secs_f64()).unwrap_or(duration_hint)
    };

    let dyn_src: DynSource = if gapless.delay_samples > 0 || gapless.total_valid_samples.is_some() {
        let delay_dur = Duration::from_secs_f64(gapless.delay_samples as f64 / sample_rate.get() as f64);
        let base = decoder.skip_duration(delay_dur);
        if let Some(total) = gapless.total_valid_samples {
            let valid_dur = Duration::from_secs_f64(total as f64 / sample_rate.get() as f64);
            DynSource::new(base.take_duration(valid_dur))
        } else {
            DynSource::new(base)
        }
    } else {
        DynSource::new(decoder)
    };

    let fade_in = EqualPowerFadeIn::new(dyn_src, fade_in_dur);
    let notifying = NotifyingSource::new(fade_in, done_flag);
    let counting = CountingSource::new(notifying, sample_counter);
    let boosted = PriorityBoostSource::new(counting);

    Ok(BuiltSource {
        source: boosted,
        duration_secs: effective_dur,
        output_rate: sample_rate.get(),
        output_channels: channels.get(),
    })
}

/// Streaming variant: uses a live `SizedDecoder` source (non-seekable-friendly
/// progressive read) and skips iTunSMPB parsing (bytes aren't fully in memory).
pub(crate) fn build_streaming_source(
    decoder: SizedDecoder,
    duration_hint: f64,
    done_flag: Arc<AtomicBool>,
    fade_in_dur: Duration,
    sample_counter: Arc<AtomicU64>,
) -> Result<BuiltSource, String> {
    let sample_rate = decoder.sample_rate();
    let channels = decoder.channels();

    let effective_dur = if duration_hint > 1.0 {
        duration_hint
    } else {
        decoder.total_duration().map(|d| d.as_secs_f64()).unwrap_or(duration_hint)
    };

    let dyn_src = DynSource::new(decoder);
    let fade_in = EqualPowerFadeIn::new(dyn_src, fade_in_dur);
    let notifying = NotifyingSource::new(fade_in, done_flag);
    let counting = CountingSource::new(notifying, sample_counter);
    let boosted = PriorityBoostSource::new(counting);

    Ok(BuiltSource {
        source: boosted,
        duration_secs: effective_dur,
        output_rate: sample_rate.get(),
        output_channels: channels.get(),
    })
}
