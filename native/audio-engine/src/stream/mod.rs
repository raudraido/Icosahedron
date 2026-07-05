mod ranged_http;

pub(crate) use ranged_http::{ranged_download_task, RangedHttpSource};

/// Seconds a blocked `Read` waits for new bytes before giving up (network stall).
pub(crate) const TRACK_READ_TIMEOUT_SECS: u64 = 20;
/// Poll interval while a `Read` blocks waiting for the download task to catch up.
pub(crate) const READ_POLL_MS: u64 = 15;
/// Bytes buffered (or full download, if the file is smaller) before playback
/// is armed — avoids starting on the first few KB and immediately stalling.
pub(crate) const PLAY_START_BYTES: usize = 256 * 1024;
