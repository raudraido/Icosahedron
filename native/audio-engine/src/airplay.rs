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
use std::path::PathBuf;

use airplay_client::{AirPlayClient, Connection, PlaybackState};
use airplay_core::{Device, Error as AirplayError, PairingError, StreamConfig};
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

/// Runs `f` against the live connection, or fails if not connected.
async fn with_conn<T, F>(shared: &Shared, f: F) -> napi::Result<T>
where
    F: for<'a> FnOnce(&'a mut Connection) -> std::pin::Pin<Box<dyn std::future::Future<Output = airplay_core::Result<T>> + Send + 'a>>,
{
    let mut guard = shared.conn.lock().await;
    let conn = guard.as_mut().ok_or_else(|| napi::Error::from_reason("Not connected to an AirPlay device"))?;
    f(conn).await.map_err(err)
}

/// Temporarily points the process cwd at `dir` (created if missing) so
/// airplay2-rs's cwd-relative identity files land somewhere writable.
struct CwdGuard(Option<PathBuf>);

impl CwdGuard {
    fn enter(dir: &PathBuf) -> Self {
        let previous = std::env::current_dir().ok();
        let _ = std::fs::create_dir_all(dir);
        if std::env::set_current_dir(dir).is_err() {
            return Self(None);
        }
        Self(previous)
    }
}

impl Drop for CwdGuard {
    fn drop(&mut self) {
        if let Some(prev) = self.0.take() {
            let _ = std::env::set_current_dir(prev);
        }
    }
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
    /// Only used for mDNS discovery — sessions go through `conn` directly,
    /// since `AirPlayClient` can't drive HomeKit-Normal (PIN) pairing or
    /// pair-verify with a saved identity.
    discovery: Mutex<AirPlayClient>,
    conn: Mutex<Option<Connection>>,
    /// airplay2-rs persists paired identities as `.airplay_sender_identity_*.json`
    /// relative to the process cwd; connect() points the cwd here while pairing.
    identity_dir: PathBuf,
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
    /// `callback(err, event: AirplayEvent)`; `identity_dir`: writable directory
    /// where paired-device identities are kept (so a PIN is only needed once).
    #[napi(constructor)]
    pub fn new(callback: JsFunction, identity_dir: String) -> napi::Result<Self> {
        let cb: Emitter = callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
        let client = AirPlayClient::new().map_err(err)?;
        Ok(Self {
            shared: Arc::new(Shared {
                discovery: Mutex::new(client),
                conn: Mutex::new(None),
                identity_dir: PathBuf::from(identity_dir),
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
            let client = self.shared.discovery.lock().await;
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

    /// Without `pin`: pair-verify with a saved identity if there is one, else
    /// transient pairing (HomePod etc., no user interaction). If the device
    /// needs a PIN first, rejects with `PIN_REQUIRED` — the caller makes the
    /// device display one and retries with `pin`. With `pin`: HomeKit-Normal
    /// pair-setup (Apple TV), which saves the identity for next time; a wrong
    /// PIN rejects with `PIN_WRONG`.
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
        // Bit 3 of the status flags = "PIN required" (AIRPLAY_2_SPEC.md).
        let pin_hint = device.requires_password || (device.status_flags >> 3) & 1 == 1;
        let had_pin = pin.is_some();

        let result = {
            let _cwd = CwdGuard::enter(&self.shared.identity_dir);
            let config = StreamConfig::default();
            match pin {
                Some(p) => Connection::connect_with_pin_pairing(device, config, &p).await,
                None => Connection::connect_auto(device, config, "3939").await,
            }
        };
        let mut connection = match result {
            Ok(c) => c,
            Err(e) => {
                let pairing = matches!(e, AirplayError::Pairing(_));
                return Err(if had_pin && pairing {
                    napi::Error::from_reason(if matches!(e, AirplayError::Pairing(PairingError::InvalidPin)) {
                        "PIN_WRONG".to_string()
                    } else {
                        format!("PIN_WRONG: {e}")
                    })
                } else if !had_pin && (pairing || pin_hint) {
                    napi::Error::from_reason("PIN_REQUIRED")
                } else {
                    err(e)
                });
            }
        };
        connection.set_render_delay_ms(200); // retransmit headroom over WiFi (client default)
        connection.setup().await.map_err(err)?;

        // A previous session (if any) is replaced.
        self.halt_feeder();
        let previous = self.shared.conn.lock().await.replace(connection);
        if let Some(mut old) = previous {
            let _ = old.disconnect().await;
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
        with_conn(&self.shared, |c| Box::pin(c.pause())).await?;
        self.shared.track.lock().unwrap().paused = true;
        Ok(())
    }

    #[napi]
    pub async fn resume(&self) -> napi::Result<()> {
        with_conn(&self.shared, |c| Box::pin(c.resume())).await?;
        self.shared.track.lock().unwrap().paused = false;
        Ok(())
    }

    #[napi]
    pub async fn stop(&self) -> napi::Result<()> {
        self.halt_feeder();
        self.shared.track.lock().unwrap().active = false;
        let _ = with_conn(&self.shared, |c| Box::pin(c.stop())).await;
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
        with_conn(&self.shared, |c| Box::pin(c.set_volume(v))).await
    }

    #[napi]
    pub async fn disconnect(&self) -> napi::Result<()> {
        if let Some(h) = self.poller.lock().unwrap().take() {
            h.abort();
        }
        self.halt_feeder();
        self.shared.track.lock().unwrap().active = false;
        if let Some(mut c) = self.shared.conn.lock().await.take() {
            let _ = c.disconnect().await;
        }
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
        let _ = with_conn(&self.shared, |c| Box::pin(c.stop())).await;

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

        with_conn(&self.shared, |c| Box::pin(c.start_streaming_live(live))).await?;

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
        let _ = with_conn(&self.shared, |c| Box::pin(c.set_volume(v))).await;
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
                let mut guard = shared.conn.lock().await;
                let Some(client) = guard.as_mut() else {
                    emit(&shared.cb, event("disconnected"));
                    return;
                };
                if tick % FEEDBACK_EVERY_N_POLLS == 0 {
                    if let Err(e) = client.send_feedback().await {
                        let mut ev = event("error");
                        ev.message = Some(format!("AirPlay keepalive failed: {e}"));
                        emit(&shared.cb, ev);
                    }
                }
                let state = client.playback_state();
                let position = client.playback_position();
                drop(guard);

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
