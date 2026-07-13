//! `AudioEngine` / `AudioCurrent` — the output device handle and live-sink state.
//! Trimmed from psysonic-audio's engine.rs: no device hot-swap/reopen thread
//! (opened once at default rate/device, no Hi-Res/device-picker feature here),
//! no EQ/crossfade/normalization/radio/preview state.
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rodio::Player;

use crate::state::ChainedInfo;

pub struct AudioEngine {
    pub(crate) stream_handle: Arc<rodio::MixerDeviceSink>,
    pub(crate) current: Arc<Mutex<AudioCurrent>>,
    /// Monotonically incremented on each `play` (non-chain) / `stop` call.
    /// Used to detect superseded in-flight downloads/decodes.
    pub(crate) generation: Arc<AtomicU64>,
    pub(crate) http_client: reqwest::Client,
    pub(crate) preloaded: Arc<Mutex<Option<crate::state::PreloadedTrack>>>,
    /// True when the currently playing source supports seeking (in-memory
    /// bytes or `RangedHttpSource`).
    pub(crate) current_is_seekable: Arc<AtomicBool>,
    /// False while a ranged-HTTP stream hasn't buffered its initial play
    /// window yet. Bytes-based playback keeps this true.
    pub(crate) stream_playback_armed: Arc<AtomicBool>,
    /// Info about the next-up chained track (gapless). The progress task
    /// reads this when the current source's done flag fires.
    pub(crate) chained_info: Arc<Mutex<Option<ChainedInfo>>>,
    /// Atomic sample counter — incremented by CountingSource in the audio thread.
    pub(crate) samples_played: Arc<AtomicU64>,
    pub(crate) current_sample_rate: Arc<AtomicU32>,
    pub(crate) current_channels: Arc<AtomicU32>,
    /// Timestamp (ms since epoch) of the last gapless auto-advance. Commands
    /// arriving within 500ms are rejected as ghost commands (stale IPC calls
    /// racing the sample-accurate switch).
    pub(crate) gapless_switch_at: Arc<AtomicU64>,
    pub(crate) volume: Arc<AtomicU32>,
    /// Engine-wide 10-band EQ + preamp parameters — shared into every built
    /// source (see eq.rs), so live UI changes apply mid-playback and persist
    /// across gapless chaining.
    pub(crate) eq: Arc<crate::eq::EqParams>,
}

pub struct AudioCurrent {
    pub(crate) sink: Option<Arc<Player>>,
    pub(crate) duration_secs: f64,
    pub(crate) seek_offset: f64,
    pub(crate) play_started: Option<Instant>,
    pub(crate) paused_at: Option<f64>,
}

/// Open the default output device, preferring a named "pipewire"/"pulse" ALSA
/// alias on Linux (the raw ALSA `default` alias can route to a null sink at
/// app-start on some PipeWire distros — the named alias goes through
/// pipewire-alsa's real sink and just works).
fn open_default_stream() -> (Arc<rodio::MixerDeviceSink>, u32) {
    use rodio::cpal::traits::{DeviceTrait, HostTrait};

    #[cfg(unix)]
    let _guard = unsafe {
        struct StderrGuard(i32);
        impl Drop for StderrGuard {
            fn drop(&mut self) { unsafe { libc::dup2(self.0, 2); libc::close(self.0); } }
        }
        let saved = libc::dup(2);
        let devnull = libc::open(c"/dev/null".as_ptr(), libc::O_WRONLY);
        libc::dup2(devnull, 2);
        libc::close(devnull);
        StderrGuard(saved)
    };

    let host = rodio::cpal::default_host();
    let find_by_name = |name: &str| -> Option<_> {
        host.output_devices().ok()?.find(|d| {
            d.description().ok().map(|desc| desc.name().to_string()).as_deref() == Some(name)
        })
    };

    let device = {
        #[cfg(target_os = "linux")]
        { find_by_name("pipewire").or_else(|| find_by_name("pulse")) }
        #[cfg(not(target_os = "linux"))]
        { None }
    }
    .or_else(|| host.default_output_device());

    if let Some(device) = device {
        if let Ok(handle) = rodio::DeviceSinkBuilder::from_device(device.clone()).and_then(|b| b.open_stream()) {
            let rate = device.default_output_config().map(|c| c.sample_rate()).unwrap_or(44100);
            return (Arc::new(handle), rate);
        }
    }

    let handle = rodio::DeviceSinkBuilder::open_default_sink().expect("cannot open any audio output device");
    let rate = rodio::cpal::default_host()
        .default_output_device()
        .and_then(|d| d.default_output_config().ok())
        .map(|c| c.sample_rate())
        .unwrap_or(44100);
    (Arc::new(handle), rate)
}

pub fn create_engine() -> AudioEngine {
    let (stream_handle, rate) = open_default_stream();

    AudioEngine {
        stream_handle,
        current: Arc::new(Mutex::new(AudioCurrent {
            sink: None,
            duration_secs: 0.0,
            seek_offset: 0.0,
            play_started: None,
            paused_at: None,
        })),
        generation: Arc::new(AtomicU64::new(0)),
        http_client: reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default(),
        preloaded: Arc::new(Mutex::new(None)),
        current_is_seekable: Arc::new(AtomicBool::new(true)),
        stream_playback_armed: Arc::new(AtomicBool::new(true)),
        chained_info: Arc::new(Mutex::new(None)),
        samples_played: Arc::new(AtomicU64::new(0)),
        current_sample_rate: Arc::new(AtomicU32::new(rate)),
        current_channels: Arc::new(AtomicU32::new(2)),
        gapless_switch_at: Arc::new(AtomicU64::new(0)),
        volume: Arc::new(AtomicU32::new(1.0f32.to_bits())),
        eq: Arc::new(crate::eq::EqParams::new()),
    }
}
