//! AirPlay 2 sender bridge (wraps lmcgartland/airplay2-rs's `AirPlayClient`).
//!
//! Unlike Chromecast/DLNA ("hand the receiver a URL, it fetches and plays"),
//! AirPlay is push-based: we decode and stream PCM to the receiver ourselves.
//! The Node side (electron/main/castAirplay.ts) downloads the track to a temp
//! file and calls `play(path, startSecs)`.
//!
//! Everything is routed through airplay2-rs's *live* streaming path (decoder
//! thread -> bounded `LiveFrameSender`) rather than `play_file`, because the
//! library's own `seek()` is currently a stub and `play_file` can't start at an
//! offset. Seeking is therefore "restart the feeder at the new position".
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use airplay_audio::{AudioDecoder, LiveAudioDecoder, LivePcmFrame};
use airplay_client::{AirPlayClient, PlaybackState};
use airplay_core::Device;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::JsFunction;
use napi_derive::napi;
use tokio::sync::Mutex;

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const FEEDBACK_EVERY_N_POLLS: u32 = 4; // receivers expect ~2s keepalives
const PREFILL: Duration = Duration::from_millis(400);
const END_MARGIN_SECS: f64 = 0.4;

#[napi(object)]
#[derive(Clone)]
pub struct AirplayDevice {
    /// Colon-separated MAC (stable across scans).
    pub id: String,
    pub name: String,
    pub model: String,
    pub host: String,
    pub port: u32,
    pub requires_password: bool,
}

#[napi(object)]
#[derive(Clone)]
pub struct AirplayEvent {
    /// "status" | "ended" | "disconnected" | "error"
    pub kind: String,
    pub playing: Option<bool>,
    pub current_time: Option<f64>,
    pub duration: Option<f64>,
    pub volume: Option<f64>,
    pub message: Option<String>,
}

fn event(kind: &str) -> AirplayEvent {
    AirplayEvent { kind: kind.into(), playing: None, current_time: None, duration: None, volume: None, message: None }
}

type Emitter = ThreadsafeFunction<AirplayEvent, ErrorStrategy::CalleeHandled>;

fn emit(cb: &Emitter, ev: AirplayEvent) {
    cb.call(Ok(ev), ThreadsafeFunctionCallMode::NonBlocking);
}

fn err<E: std::fmt::Display>(e: E) -> napi::Error {
    napi::Error::from_reason(e.to_string())
}

#[derive(Default)]
struct Track {
    /// A track is loaded and hasn't ended/been stopped.
    active: bool,
    paused: bool,
    /// Position (secs) the current stream started at (non-zero after seek).
    offset: f64,
    duration: f64,
    volume: f32,
    /// File being streamed, so `seek` can restart it at a new offset.
    path: Option<String>,
}

struct Feeder {
    stop: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
}

struct Shared {
    client: Mutex<AirPlayClient>,
    devices: StdMutex<HashMap<String, Device>>,
    track: StdMutex<Track>,
    feeder: StdMutex<Option<Feeder>>,
    cb: Emitter,
}

#[napi]
pub struct AirplayClient {
    shared: Arc<Shared>,
    poller: StdMutex<Option<tokio::task::JoinHandle<()>>>,
}

#[napi]
impl AirplayClient {
    /// `callback(err, event: AirplayEvent)`.
    #[napi(constructor)]
    pub fn new(callback: JsFunction) -> napi::Result<Self> {
        let cb: Emitter = callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
        let client = AirPlayClient::new().map_err(err)?;
        Ok(Self {
            shared: Arc::new(Shared {
                client: Mutex::new(client),
                devices: StdMutex::new(HashMap::new()),
                track: StdMutex::new(Track { volume: 1.0, ..Default::default() }),
                feeder: StdMutex::new(None),
                cb,
            }),
            poller: StdMutex::new(None),
        })
    }

    /// mDNS scan; results are cached so `connect` can look a device up by id.
    #[napi]
    pub async fn discover(&self, timeout_ms: u32) -> napi::Result<Vec<AirplayDevice>> {
        let found = {
            let client = self.shared.client.lock().await;
            client.discover(Duration::from_millis(timeout_ms as u64)).await.map_err(err)?
        };
        let mut cache = self.shared.devices.lock().unwrap();
        cache.clear();
        let mut out = Vec::new();
        for d in found {
            let Some(addr) = d.addresses.iter().find(|a| a.is_ipv4()).or(d.addresses.first()) else { continue };
            let id = d.id.to_mac_string();
            out.push(AirplayDevice {
                id: id.clone(),
                name: d.name.clone(),
                model: d.model.clone(),
                host: addr.to_string(),
                port: d.port as u32,
                requires_password: d.requires_password,
            });
            cache.insert(id, d);
        }
        Ok(out)
    }

    #[napi]
    pub async fn connect(&self, device_id: String, pin: Option<String>) -> napi::Result<()> {
        let device = self
            .shared
            .devices
            .lock()
            .unwrap()
            .get(&device_id)
            .cloned()
            .ok_or_else(|| napi::Error::from_reason("Unknown AirPlay device — try rescanning"))?;
        {
            let mut client = self.shared.client.lock().await;
            match pin {
                Some(p) => client.connect_with_pin(&device, &p).await.map_err(err)?,
                None => client.connect(&device).await.map_err(err)?,
            }
        }
        self.start_poller();
        Ok(())
    }

    /// Streams the audio file at `path`, starting `start_secs` in.
    #[napi]
    pub async fn play(&self, path: String, start_secs: f64) -> napi::Result<()> {
        self.start_stream(path, start_secs.max(0.0)).await
    }

    #[napi]
    pub async fn pause(&self) -> napi::Result<()> {
        self.shared.client.lock().await.pause().await.map_err(err)?;
        self.shared.track.lock().unwrap().paused = true;
        Ok(())
    }

    #[napi]
    pub async fn resume(&self) -> napi::Result<()> {
        self.shared.client.lock().await.resume().await.map_err(err)?;
        self.shared.track.lock().unwrap().paused = false;
        Ok(())
    }

    #[napi]
    pub async fn stop(&self) -> napi::Result<()> {
        self.halt_feeder();
        self.shared.track.lock().unwrap().active = false;
        let _ = self.shared.client.lock().await.stop().await;
        Ok(())
    }

    /// airplay2-rs's own `seek()` is a stub — restart the feeder at `seconds`.
    #[napi]
    pub async fn seek(&self, seconds: f64) -> napi::Result<()> {
        let path = self.current_path().ok_or_else(|| napi::Error::from_reason("Nothing playing"))?;
        self.start_stream(path, seconds.max(0.0)).await
    }

    /// `volume`: 0.0–1.0.
    #[napi]
    pub async fn set_volume(&self, volume: f64) -> napi::Result<()> {
        let v = volume.clamp(0.0, 1.0) as f32;
        self.shared.track.lock().unwrap().volume = v;
        self.shared.client.lock().await.set_volume(v).await.map_err(err)
    }

    #[napi]
    pub async fn disconnect(&self) -> napi::Result<()> {
        if let Some(h) = self.poller.lock().unwrap().take() {
            h.abort();
        }
        self.halt_feeder();
        self.shared.track.lock().unwrap().active = false;
        let _ = self.shared.client.lock().await.disconnect().await;
        Ok(())
    }
}

impl AirplayClient {
    fn current_path(&self) -> Option<String> {
        self.shared.track.lock().unwrap().path.clone()
    }

    fn halt_feeder(&self) {
        if let Some(f) = self.shared.feeder.lock().unwrap().take() {
            f.stop.store(true, Ordering::Relaxed);
        }
    }

    async fn start_stream(&self, path: String, start_secs: f64) -> napi::Result<()> {
        self.halt_feeder();
        self.shared.track.lock().unwrap().active = false;
        // Flush whatever the receiver still has queued from the previous stream.
        let _ = self.shared.client.lock().await.stop().await;

        let open_path = path.clone();
        let (decoder, sample_rate, channels, duration) = tokio::task::spawn_blocking(move || {
            let mut d = AudioDecoder::open(&open_path)?;
            let sr = d.sample_rate();
            let ch = d.channels();
            let dur = d.duration_samples().map(|s| s as f64 / sr as f64).unwrap_or(0.0);
            if start_secs > 0.0 {
                d.seek((start_secs * sr as f64) as u64)?;
            }
            Ok::<_, airplay_core::Error>((d, sr, ch, dur))
        })
        .await
        .map_err(err)?
        .map_err(err)?;

        let (sender, live) = LiveAudioDecoder::create_pair(sample_rate, channels, 64);
        let stop = Arc::new(AtomicBool::new(false));
        let done = Arc::new(AtomicBool::new(false));
        {
            let (stop, done) = (stop.clone(), done.clone());
            std::thread::Builder::new()
                .name("airplay-feeder".into())
                .spawn(move || {
                    let mut decoder = decoder;
                    while !stop.load(Ordering::Relaxed) {
                        match decoder.decode_frame() {
                            Ok(Some(f)) => {
                                let frame = LivePcmFrame { samples: f.samples, channels: f.channels, sample_rate: f.sample_rate };
                                // Blocks while the channel is full — natural pacing.
                                if !sender.send(frame) {
                                    break;
                                }
                            }
                            _ => break, // EOF or decode error
                        }
                    }
                    done.store(true, Ordering::Relaxed);
                    // `sender` drops here -> the live decoder sees EOF.
                })
                .map_err(err)?;
        }
        *self.shared.feeder.lock().unwrap() = Some(Feeder { stop, done });

        // Let the channel fill before the first RTP packet goes out (avoids
        // startup artifacts — see start_live_streaming_with_decoder's docs).
        tokio::time::sleep(PREFILL).await;

        self.shared.client.lock().await.start_live_streaming_with_decoder(live).await.map_err(err)?;

        {
            let mut t = self.shared.track.lock().unwrap();
            t.active = true;
            t.paused = false;
            t.offset = start_secs;
            t.duration = duration;
            t.path = Some(path);
        }
        // Receivers reset to their own volume on a fresh RECORD.
        let v = self.shared.track.lock().unwrap().volume;
        let _ = self.shared.client.lock().await.set_volume(v).await;
        Ok(())
    }

    fn start_poller(&self) {
        let mut slot = self.poller.lock().unwrap();
        if let Some(h) = slot.take() {
            h.abort();
        }
        let shared = self.shared.clone();
        *slot = Some(tokio::spawn(async move {
            let mut tick: u32 = 0;
            loop {
                tokio::time::sleep(POLL_INTERVAL).await;
                tick = tick.wrapping_add(1);
                let mut client = shared.client.lock().await;
                if !client.is_connected() {
                    emit(&shared.cb, event("disconnected"));
                    return;
                }
                if tick % FEEDBACK_EVERY_N_POLLS == 0 {
                    if let Err(e) = client.send_feedback().await {
                        let mut ev = event("error");
                        ev.message = Some(format!("AirPlay keepalive failed: {e}"));
                        emit(&shared.cb, ev);
                    }
                }
                let state = client.playback_state();
                let position = client.playback_position();
                drop(client);

                let (active, paused, offset, duration, volume) = {
                    let t = shared.track.lock().unwrap();
                    (t.active, t.paused, t.offset, t.duration, t.volume)
                };
                if !active {
                    continue;
                }
                let current = offset + position;
                let feeder_done = shared.feeder.lock().unwrap().as_ref().map_or(true, |f| f.done.load(Ordering::Relaxed));
                // The library doesn't reliably flip to Stopped at live-source EOF, so
                // "ended" = we've decoded everything and playback reached the end.
                let reached_end = duration > 0.0 && current >= duration - END_MARGIN_SECS;
                let stopped = matches!(state, PlaybackState::Stopped | PlaybackState::Error);
                if feeder_done && !paused && (reached_end || stopped) {
                    shared.track.lock().unwrap().active = false;
                    emit(&shared.cb, event("ended"));
                    continue;
                }
                let mut ev = event("status");
                ev.playing = Some(!paused && matches!(state, PlaybackState::Playing | PlaybackState::Buffering));
                ev.current_time = Some(current);
                ev.duration = Some(duration);
                ev.volume = Some(volume as f64);
                emit(&shared.cb, ev);
            }
        }));
    }
}
