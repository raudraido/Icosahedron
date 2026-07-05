//! Small shared structs for preload / gapless chain metadata.
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Arc;

/// Full-buffer bytes fetched ahead of time for a URL — either the byte
/// preload cache or the gapless chain's raw bytes (reused if a manual skip
/// lands on the already-chained track).
pub(crate) struct PreloadedTrack {
    pub(crate) url: String,
    pub(crate) data: Vec<u8>,
}

/// Info about the track that has been appended (chained) to the current Sink
/// but whose source has not yet started playing (gapless mode).
pub(crate) struct ChainedInfo {
    /// The URL that was chained — used by `play` to detect a pre-chain hit.
    pub(crate) url: String,
    /// Raw file bytes (shared with the chained decoder). Lets a manual skip
    /// reuse them instead of re-downloading.
    pub(crate) raw_bytes: Arc<Vec<u8>>,
    pub(crate) duration_secs: f64,
    /// Set by NotifyingSource when this chained track's source is exhausted.
    pub(crate) source_done: Arc<AtomicBool>,
    /// Atomic sample counter for this chained source (swapped into
    /// `samples_played` on transition).
    pub(crate) sample_counter: Arc<AtomicU64>,
}
