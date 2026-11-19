//! `icosahedron-bpm <file>` prints `{"bpm": 128.0}` and exits 0, or `{"error": "..."}` and exits 1.
//! The file is decoded with Symphonia and measured by `icosahedron_bpm_core`, the same detection the
//! desktop app runs, so every player sees the same numbers. The song's genre is not known here;
//! the HUB applies the drum & bass correction afterwards.
use std::fs::File;
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Decodes the whole file to mono f32 (channels averaged the way the core does it) and its sample rate.
fn decode_mono(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let file = File::open(path).map_err(|e| format!("cannot open file: {e}"))?;
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("unknown audio format: {e}"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("no audio track")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("unsupported codec: {e}"))?;

    let mut mono: Vec<f32> = Vec::new();
    let mut rate = track.codec_params.sample_rate.unwrap_or(0);
    let mut buf: Option<SampleBuffer<f32>> = None;
    let mut bad_packets = 0u32;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => break,
            Err(e) => return Err(format!("read error: {e}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                rate = spec.rate;
                let channels = spec.channels.count().max(1);
                let need = decoded.capacity() as u64;
                if buf.as_ref().map_or(true, |b| (b.capacity() as u64) < need * channels as u64) {
                    buf = Some(SampleBuffer::new(need, spec));
                }
                let b = buf.as_mut().unwrap();
                b.copy_interleaved_ref(decoded);
                if channels == 1 {
                    mono.extend_from_slice(b.samples());
                } else {
                    mono.extend(b.samples().chunks_exact(channels).map(|f| f.iter().sum::<f32>() / channels as f32));
                }
            }
            // a damaged packet is skipped (players do the same); a file that is only damage fails below
            Err(SymError::DecodeError(_)) => {
                bad_packets += 1;
                if bad_packets > 200 && mono.is_empty() {
                    return Err("the file cannot be decoded".into());
                }
            }
            Err(e) => return Err(format!("decode error: {e}")),
        }
    }
    if mono.is_empty() || rate == 0 {
        return Err("no audio decoded".into());
    }
    Ok((mono, rate))
}

fn json_escape(s: &str) -> String {
    let mut o = String::new();
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push(' '),
            c => o.push(c),
        }
    }
    o
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        println!("{{\"error\": \"usage: icosahedron-bpm <file>\"}}");
        std::process::exit(2);
    }
    let result = decode_mono(Path::new(&args[1])).and_then(|(mono, rate)| {
        icosahedron_bpm_core::detect_bpm(&mono, 1, rate)
            .ok_or_else(|| "no clear tempo (track too short or quiet, or no beat)".to_string())
    });
    match result {
        Ok(bpm) => println!("{{\"bpm\": {:?}}}", bpm),
        Err(e) => {
            println!("{{\"error\": \"{}\"}}", json_escape(&e));
            std::process::exit(1);
        }
    }
}
