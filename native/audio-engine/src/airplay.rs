//! AirPlay 2 sender bridge (wraps lmcgartland/airplay2-rs's `AirPlayClient`).
//!
//! Unlike Chromecast/DLNA ("hand the receiver a URL, it fetches and plays"),
//! AirPlay is push-based: we decode and stream PCM to the receiver ourselves.
//! The Node side (electron/main/castAirplay.ts) calls `play(url, startSecs)`;
//! the track is downloaded in the background while it is already being decoded
//! and streamed (see `Download`), so playback starts without waiting for it.
//!
//! Everything is routed through airplay2-rs's *live* streaming path (decoder
//! thread -> bounded `LiveFrameSender`) rather than `play_file`, because the
//! library's own `seek()` is currently a stub and `play_file` can't start at an
//! offset. Seeking is therefore "restart the feeder at the new position".
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use airplay_audio::{AudioDecoder, LiveAudioDecoder, LivePcmFrame};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Condvar;

use airplay_client::{AirPlayClient, Connection, PlaybackState, TrackMetadata};
use airplay_core::{Device, Error as AirplayError, PairingError, StreamConfig};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use futures_util::StreamExt;
use napi::bindgen_prelude::Buffer;
use napi::JsFunction;
use napi_derive::napi;
use symphonia::core::io::MediaSource;
use tokio::sync::Mutex;

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const FEEDBACK_EVERY_N_POLLS: u32 = 4; // receivers expect ~2s keepalives
const PREFILL: Duration = Duration::from_millis(400);
const END_MARGIN_SECS: f64 = 0.4;
/// Consecutive failed keepalives after which the receiver is considered gone.
const KEEPALIVE_FAILURES_BEFORE_DISCONNECT: u32 = 2;

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

/// What the receiver's "now playing" screen should show for the current track.
#[napi(object)]
pub struct AirplayMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// Encoded cover image (JPEG or PNG bytes).
    pub artwork: Option<Buffer>,
    /// `image/jpeg` or `image/png`; sniffed from the bytes when omitted.
    pub artwork_content_type: Option<String>,
}

#[derive(Clone, Default)]
struct NowPlaying {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    artwork: Option<(Vec<u8>, String)>,
}

fn sniff_image_type(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "image/jpeg" }.to_string()
}

impl From<AirplayMetadata> for NowPlaying {
    fn from(m: AirplayMetadata) -> Self {
        let artwork = m.artwork.and_then(|b| {
            let bytes = b.to_vec();
            if bytes.is_empty() {
                return None;
            }
            let content_type = m.artwork_content_type.unwrap_or_else(|| sniff_image_type(&bytes));
            Some((bytes, content_type))
        });
        Self { title: m.title, artist: m.artist, album: m.album, artwork }
    }
}

/// A track being downloaded in the background. The decoder reads it through
/// `ProgressiveSource`, whose reads block until the bytes it needs have
/// arrived, so decoding (and playback) can begin long before the download ends.
struct Download {
    state: StdMutex<DownloadState>,
    cv: Condvar,
    cancelled: AtomicBool,
}

#[derive(Default)]
struct DownloadState {
    data: Vec<u8>,
    /// Content-Length, when the server sent one.
    total: Option<u64>,
    done: bool,
    error: Option<String>,
}

/// How long a read waits for the download to make progress before giving up.
const DOWNLOAD_STALL_TIMEOUT: Duration = Duration::from_secs(30);

impl Download {
    fn new(total: Option<u64>) -> Arc<Self> {
        let state = DownloadState {
            data: Vec::with_capacity(total.unwrap_or(0).min(256 * 1024 * 1024) as usize),
            total,
            ..Default::default()
        };
        Arc::new(Self { state: StdMutex::new(state), cv: Condvar::new(), cancelled: AtomicBool::new(false) })
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
        self.cv.notify_all();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    fn finish(&self, error: Option<String>) {
        let mut st = self.state.lock().unwrap();
        st.done = true;
        st.error = error;
        self.cv.notify_all();
    }
}

async fn run_download(dl: Arc<Download>, resp: reqwest::Response) {
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if dl.is_cancelled() {
            return;
        }
        match chunk {
            Ok(bytes) => {
                dl.state.lock().unwrap().data.extend_from_slice(&bytes);
                dl.cv.notify_all();
            }
            Err(e) => {
                dl.finish(Some(format!("Track download failed: {e}")));
                return;
            }
        }
    }
    dl.finish(None);
}

/// `Read + Seek` over a `Download` (each decoder gets its own position, the
/// bytes are shared — so a seek restart doesn't download the track again).
struct ProgressiveSource {
    dl: Arc<Download>,
    pos: u64,
}

impl Read for ProgressiveSource {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        let mut st = self.dl.state.lock().unwrap();
        loop {
            let len = st.data.len() as u64;
            if self.pos < len {
                let n = out.len().min((len - self.pos) as usize);
                let start = self.pos as usize;
                out[..n].copy_from_slice(&st.data[start..start + n]);
                self.pos += n as u64;
                return Ok(n);
            }
            if let Some(e) = &st.error {
                return Err(io::Error::new(io::ErrorKind::Other, e.clone()));
            }
            if st.done || self.dl.is_cancelled() {
                return Ok(0); // EOF
            }
            let (guard, timeout) = self.dl.cv.wait_timeout(st, DOWNLOAD_STALL_TIMEOUT).unwrap();
            st = guard;
            if timeout.timed_out() && self.pos >= st.data.len() as u64 && !st.done {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "Track download stalled"));
            }
        }
    }
}

impl Seek for ProgressiveSource {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        let target: i128 = match from {
            SeekFrom::Start(n) => n as i128,
            SeekFrom::Current(d) => self.pos as i128 + d as i128,
            SeekFrom::End(d) => {
                // The end is only known up front when the server sent a
                // Content-Length; otherwise wait for the download to finish.
                let mut st = self.dl.state.lock().unwrap();
                while st.total.is_none() && !st.done && !self.dl.is_cancelled() {
                    st = self.dl.cv.wait_timeout(st, DOWNLOAD_STALL_TIMEOUT).unwrap().0;
                }
                if let Some(e) = &st.error {
                    return Err(io::Error::new(io::ErrorKind::Other, e.clone()));
                }
                let end = st.total.unwrap_or(st.data.len() as u64);
                end as i128 + d as i128
            }
        };
        if target < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek before start"));
        }
        self.pos = target as u64;
        Ok(self.pos)
    }
}

impl MediaSource for ProgressiveSource {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        let st = self.dl.state.lock().unwrap();
        st.total.or(if st.done { Some(st.data.len() as u64) } else { None })
    }
}

/// Identifies a restart request, so a stale one (superseded while it waited for
/// `start_lock`) can be skipped instead of costing seconds for nothing.
#[derive(Clone, Copy)]
struct Stamp {
    play: u64,
    /// 0 for a `play`; the seek's own number for a `seek`.
    seek: u64,
}

/// The track currently loaded, kept so seeking (which restarts the stream)
/// can reuse the bytes already downloaded.
#[derive(Clone)]
struct Source {
    dl: Arc<Download>,
    format_hint: Option<String>,
}

/// RTP timestamp rate of the stream we send (airplay2-rs's default format).
const STREAM_RATE_HZ: f64 = 44100.0;

/// `(track start, current, track end)` as RTP timestamps, for the receiver's
/// seek bar. The stream's timestamps start at `base` (see airplay2-rs's
/// `stream_rtp_base`) at its first sample, which sits `offset` seconds into
/// the track, so the track's own start lies `offset` seconds before `base`;
/// `position` is seconds since the stream began.
fn progress_rtp(base: u32, offset: f64, duration: f64, position: f64) -> (u32, u32, u32) {
    let start = base.wrapping_sub((offset * STREAM_RATE_HZ) as u32);
    let current = base.wrapping_add((position * STREAM_RATE_HZ) as u32);
    let end = start.wrapping_add((duration * STREAM_RATE_HZ) as u32);
    (start, current, end)
}

#[derive(Default)]
struct Track {
    /// Shown on the receiver; kept so seeking (which restarts the stream)
    /// can re-send it.
    meta: Option<NowPlaying>,
    /// A track is loaded and hasn't ended/been stopped.
    active: bool,
    paused: bool,
    /// Position (secs) the current stream started at (non-zero after seek).
    offset: f64,
    duration: f64,
    volume: f32,
    /// Track being streamed, so `seek` can restart it at a new offset.
    source: Option<Source>,
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
    /// Held for the whole of `start_stream`: play/seek can be requested while a
    /// previous start is still in flight (the Node side fires them without
    /// waiting), and interleaving two would stop each other's feeder/stream.
    start_lock: Mutex<()>,
    /// Bumped by every `play` (and `stop`): any restart requested earlier is stale.
    play_seq: AtomicU64,
    /// Bumped by every `seek`: only the newest seek of a track is worth doing
    /// (dragging the seek bar fires dozens, each restart costs seconds).
    seek_seq: AtomicU64,
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
                start_lock: Mutex::new(()),
                play_seq: AtomicU64::new(0),
                seek_seq: AtomicU64::new(0),
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

    /// Streams the track at `url`, starting `start_secs` in. The download runs in
    /// the background; playback starts as soon as enough has arrived to decode.
    /// `content_type` is only a format hint for the decoder.
    #[napi]
    pub async fn play(
        &self,
        url: String,
        start_secs: f64,
        metadata: Option<AirplayMetadata>,
        content_type: Option<String>,
    ) -> napi::Result<()> {
        let stamp = Stamp { play: self.shared.play_seq.fetch_add(1, Ordering::SeqCst) + 1, seek: 0 };
        let resp = reqwest::Client::new().get(&url).send().await.map_err(err)?;
        if !resp.status().is_success() {
            return Err(napi::Error::from_reason(format!("Couldn't fetch track for AirPlay (HTTP {})", resp.status())));
        }
        let format_hint = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .and_then(crate::helpers::content_type_to_hint)
            .or_else(|| content_type.as_deref().and_then(crate::helpers::content_type_to_hint));
        let dl = Download::new(resp.content_length());
        tokio::spawn(run_download(dl.clone(), resp));

        let source = Source { dl, format_hint };
        {
            // A newer track replaces (and stops downloading) the previous one.
            let mut t = self.shared.track.lock().unwrap();
            if let Some(old) = t.source.replace(source.clone()) {
                old.dl.cancel();
            }
            t.meta = metadata.map(NowPlaying::from);
        }
        self.start_stream(source, start_secs.max(0.0), stamp).await
    }

    /// Cover art for the track `play` just started — separate from `play` so a
    /// slow cover fetch never delays the music.
    #[napi]
    pub async fn set_artwork(&self, artwork: Buffer, content_type: Option<String>) -> napi::Result<()> {
        let bytes = artwork.to_vec();
        if bytes.is_empty() {
            return Ok(());
        }
        let content_type = content_type.unwrap_or_else(|| sniff_image_type(&bytes));
        self.shared.track.lock().unwrap().meta.get_or_insert_with(NowPlaying::default).artwork = Some((bytes, content_type));
        self.push_now_playing().await;
        Ok(())
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
        // The receiver's seek bar needs a fresh position after a pause.
        self.push_progress().await;
        Ok(())
    }

    #[napi]
    pub async fn stop(&self) -> napi::Result<()> {
        // A restart still queued must not bring the stream back after a stop.
        self.shared.play_seq.fetch_add(1, Ordering::SeqCst);
        self.halt_feeder();
        self.shared.track.lock().unwrap().active = false;
        let _ = with_conn(&self.shared, |c| Box::pin(c.stop())).await;
        Ok(())
    }

    /// airplay2-rs's own `seek()` is a stub — restart the feeder at `seconds`.
    #[napi]
    pub async fn seek(&self, seconds: f64) -> napi::Result<()> {
        let source = self.current_source().ok_or_else(|| napi::Error::from_reason("Nothing playing"))?;
        let stamp = Stamp {
            play: self.shared.play_seq.load(Ordering::SeqCst),
            seek: self.shared.seek_seq.fetch_add(1, Ordering::SeqCst) + 1,
        };
        self.start_stream(source, seconds.max(0.0), stamp).await
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
        {
            let mut t = self.shared.track.lock().unwrap();
            t.active = false;
            if let Some(src) = t.source.take() {
                src.dl.cancel();
            }
        }
        if let Some(mut c) = self.shared.conn.lock().await.take() {
            let _ = c.disconnect().await;
        }
        Ok(())
    }
}

impl AirplayClient {
    fn current_source(&self) -> Option<Source> {
        self.shared.track.lock().unwrap().source.clone()
    }

    fn halt_feeder(&self) {
        if let Some(f) = self.shared.feeder.lock().unwrap().take() {
            f.stop.store(true, Ordering::Relaxed);
        }
    }

    async fn start_stream(&self, source: Source, start_secs: f64, stamp: Stamp) -> napi::Result<()> {
        let _start_guard = self.shared.start_lock.lock().await;
        // Superseded while waiting for the lock: by a newer `play`/`stop`, or
        // (for a seek) by a newer seek.
        let stale = stamp.play != self.shared.play_seq.load(Ordering::SeqCst)
            || (stamp.seek != 0 && stamp.seek != self.shared.seek_seq.load(Ordering::SeqCst));
        if stale || source.dl.is_cancelled() {
            return Ok(());
        }
        self.halt_feeder();
        self.shared.track.lock().unwrap().active = false;
        // Flush whatever the receiver still has queued from the previous stream.
        let _ = with_conn(&self.shared, |c| Box::pin(c.stop())).await;

        let reader = ProgressiveSource { dl: source.dl.clone(), pos: 0 };
        let hint = source.format_hint.clone();
        let (decoder, sample_rate, channels, duration) = tokio::task::spawn_blocking(move || {
            // Blocks until enough of the (still downloading) track has arrived.
            let mut d = AudioDecoder::from_reader(Box::new(reader), hint.as_deref())?;
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
        }
        // Receivers reset to their own volume on a fresh RECORD.
        let v = self.shared.track.lock().unwrap().volume;
        let _ = with_conn(&self.shared, |c| Box::pin(c.set_volume(v))).await;
        self.push_now_playing().await;
        Ok(())
    }

    /// Title/artist/artwork plus progress for the receiver's now-playing
    /// screen. Best effort — a receiver that ignores these still plays audio.
    /// Re-sent after every stream (re)start, since a flush clears the display.
    async fn push_now_playing(&self) {
        let (meta, duration) = {
            let t = self.shared.track.lock().unwrap();
            (t.meta.clone(), t.duration)
        };
        if let Some(m) = meta {
            let tm = TrackMetadata {
                title: m.title,
                artist: m.artist,
                album: m.album,
                duration_ms: (duration > 0.0).then(|| (duration * 1000.0) as u32),
            };
            let _ = with_conn(&self.shared, move |c| {
                Box::pin(async move {
                    let base = c.stream_rtp_base();
                    c.set_track_metadata(&tm, base).await
                })
            })
            .await;
            if let Some((bytes, content_type)) = m.artwork {
                let _ = with_conn(&self.shared, move |c| {
                    Box::pin(async move {
                        let base = c.stream_rtp_base();
                        c.set_artwork(bytes, &content_type, base).await
                    })
                })
                .await;
            }
        }
        self.push_progress().await;
    }

    /// Progress in RTP timestamps: the stream's timestamps start at 0 at the
    /// stream's first sample, which corresponds to `offset` seconds into the
    /// track, so the track's own start lies `offset` seconds before 0.
    async fn push_progress(&self) {
        let (offset, duration) = {
            let t = self.shared.track.lock().unwrap();
            (t.offset, t.duration)
        };
        if duration <= 0.0 {
            return;
        }
        let position = {
            let guard = self.shared.conn.lock().await;
            guard.as_ref().map_or((0, 0.0), |c| (c.stream_rtp_base(), c.playback_position()))
        };
        let (base, position) = position;
        let (start, current, end) = progress_rtp(base, offset, duration, position);
        let _ = with_conn(&self.shared, move |c| Box::pin(async move { c.set_progress(start, current, end).await })).await;
    }

    fn start_poller(&self) {
        let mut slot = self.poller.lock().unwrap();
        if let Some(h) = slot.take() {
            h.abort();
        }
        let shared = self.shared.clone();
        *slot = Some(tokio::spawn(async move {
            let mut tick: u32 = 0;
            let mut keepalive_failures: u32 = 0;
            loop {
                tokio::time::sleep(POLL_INTERVAL).await;
                tick = tick.wrapping_add(1);
                let mut guard = shared.conn.lock().await;
                let Some(client) = guard.as_mut() else {
                    emit(&shared.cb, event("disconnected"));
                    return;
                };
                if tick % FEEDBACK_EVERY_N_POLLS == 0 {
                    match client.send_feedback().await {
                        Ok(()) => keepalive_failures = 0,
                        Err(e) => {
                            keepalive_failures += 1;
                            let mut ev = event("error");
                            ev.message = Some(format!("AirPlay keepalive failed: {e}"));
                            emit(&shared.cb, ev);
                            // The receiver closed the connection (e.g. it dropped the
                            // session): nothing will bring it back, so report it
                            // instead of failing every 2 s forever.
                            if keepalive_failures >= KEEPALIVE_FAILURES_BEFORE_DISCONNECT {
                                guard.take();
                                drop(guard);
                                if let Some(f) = shared.feeder.lock().unwrap().take() {
                                    f.stop.store(true, Ordering::Relaxed);
                                }
                                shared.track.lock().unwrap().active = false;
                                emit(&shared.cb, event("disconnected"));
                                return;
                            }
                        }
                    }
                }
                let state = client.playback_state();
                let position = client.playback_position();

                let (active, paused, offset, duration, volume) = {
                    let t = shared.track.lock().unwrap();
                    (t.active, t.paused, t.offset, t.duration, t.volume)
                };
                // Receivers (Apple TV) don't keep advancing the seek bar on
                // their own after a single `progress`, so refresh it with the
                // keepalive.
                if tick % FEEDBACK_EVERY_N_POLLS == 0 && active && !paused && duration > 0.0 {
                    let (start, current, end) = progress_rtp(client.stream_rtp_base(), offset, duration, position);
                    let _ = client.set_progress(start, current, end).await;
                }
                drop(guard);
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
