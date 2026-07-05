//! `RangedHttpSource` — seekable HTTP-backed `MediaSource`, plus its
//! background linear-fill download task. Simplified from psysonic-audio's
//! ranged_http.rs: no moov-at-end MP4 tail-prefetch gate, no loudness/analysis
//! hooks, no on-disk spill for oversized downloads.
//!
//! Pre-allocates a `Vec<u8>` of total track size. The download task fills it
//! linearly from offset 0 via streaming HTTP. `Read` blocks (with timeout)
//! until requested bytes are downloaded; `Seek` only updates the cursor —
//! forward seeks past `downloaded_to` block until the linear download catches
//! up (fine for a local/self-hosted server; this is the low-latency
//! first-play/manual-skip path, not the gapless boundary itself).
//!
//! Requires the server to respond with `Content-Length` and
//! `Accept-Ranges: bytes`; callers fall back to a full in-memory fetch
//! otherwise (see play_input.rs).

use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use symphonia::core::io::MediaSource;

use super::{PLAY_START_BYTES, READ_POLL_MS, TRACK_READ_TIMEOUT_SECS};

pub(crate) struct RangedHttpSource {
    /// Pre-allocated buffer of total size. Filled linearly from offset 0.
    pub(crate) buf: Arc<Mutex<Vec<u8>>>,
    /// Bytes contiguously downloaded from offset 0.
    pub(crate) downloaded_to: Arc<AtomicUsize>,
    pub(crate) total_size: u64,
    pub(crate) pos: u64,
    /// Set when the download task terminates (success or error).
    pub(crate) done: Arc<AtomicBool>,
    pub(crate) gen_arc: Arc<AtomicU64>,
    pub(crate) gen: u64,
}

impl Read for RangedHttpSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.gen_arc.load(Ordering::SeqCst) != self.gen {
            return Ok(0);
        }
        if self.pos >= self.total_size {
            return Ok(0);
        }
        let max_read = ((self.total_size - self.pos) as usize).min(buf.len());
        if max_read == 0 {
            return Ok(0);
        }
        let target_end = self.pos + max_read as u64;

        let stall_timeout = Duration::from_secs(TRACK_READ_TIMEOUT_SECS);
        let mut deadline = Instant::now() + stall_timeout;
        let mut last_dl_seen = self.downloaded_to.load(Ordering::Relaxed) as u64;
        loop {
            if self.gen_arc.load(Ordering::SeqCst) != self.gen {
                return Ok(0);
            }
            let dl = self.downloaded_to.load(Ordering::SeqCst) as u64;
            if target_end <= dl {
                break;
            }
            if dl > last_dl_seen {
                last_dl_seen = dl;
                deadline = Instant::now() + stall_timeout;
            }
            if self.done.load(Ordering::SeqCst) {
                if target_end <= dl {
                    break;
                }
                if dl > self.pos {
                    let avail = (dl - self.pos) as usize;
                    let src = self.buf.lock().unwrap();
                    let start = self.pos as usize;
                    buf[..avail].copy_from_slice(&src[start..start + avail]);
                    drop(src);
                    self.pos += avail as u64;
                    return Ok(avail);
                }
                return Ok(0);
            }
            if Instant::now() >= deadline {
                return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "ranged-http: no data within timeout"));
            }
            std::thread::sleep(Duration::from_millis(READ_POLL_MS));
        }

        let src = self.buf.lock().unwrap();
        let start = self.pos as usize;
        let end = start + max_read;
        buf[..max_read].copy_from_slice(&src[start..end]);
        drop(src);
        self.pos += max_read as u64;
        Ok(max_read)
    }
}

impl Seek for RangedHttpSource {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let new_pos: i64 = match pos {
            SeekFrom::Start(p) => p as i64,
            SeekFrom::End(p) => self.total_size as i64 + p,
            SeekFrom::Current(p) => self.pos as i64 + p,
        };
        if new_pos < 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "seek before start"));
        }
        self.pos = new_pos as u64;
        Ok(self.pos)
    }
}

impl MediaSource for RangedHttpSource {
    fn is_seekable(&self) -> bool { true }
    fn byte_len(&self) -> Option<u64> { Some(self.total_size) }
}

/// Streams `response`'s body linearly into `buf`, updating `downloaded_to` as
/// bytes land and arming `playback_armed` once `PLAY_START_BYTES` (or the
/// full file, if smaller) is available. Aborts early if `gen_arc` moves past
/// `gen` (superseded by a newer `play`/`chain_preload` call).
pub(crate) async fn ranged_download_task(
    gen: u64,
    gen_arc: Arc<AtomicU64>,
    response: reqwest::Response,
    buf: Arc<Mutex<Vec<u8>>>,
    downloaded_to: Arc<AtomicUsize>,
    done: Arc<AtomicBool>,
    playback_armed: Arc<AtomicBool>,
) {
    let total_len = buf.lock().unwrap().len();
    let arm_threshold = PLAY_START_BYTES.min(total_len.max(1));
    let mut stream = response.bytes_stream();
    let mut offset = 0usize;

    while let Some(chunk) = stream.next().await {
        if gen_arc.load(Ordering::SeqCst) != gen {
            break;
        }
        let Ok(chunk) = chunk else { break };
        {
            let mut guard = buf.lock().unwrap();
            let end = (offset + chunk.len()).min(guard.len());
            if end > offset {
                guard[offset..end].copy_from_slice(&chunk[..end - offset]);
            }
        }
        offset += chunk.len();
        downloaded_to.store(offset.min(total_len), Ordering::SeqCst);
        if !playback_armed.load(Ordering::Relaxed) && offset >= arm_threshold {
            playback_armed.store(true, Ordering::SeqCst);
        }
    }

    playback_armed.store(true, Ordering::SeqCst);
    done.store(true, Ordering::SeqCst);
}
