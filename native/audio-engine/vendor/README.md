# Vendored third-party code

## qm-dsp/

The **QM-DSP** library (Centre for Digital Music, Queen Mary University of
London), used for BPM detection — specifically `dsp/onsets/DetectionFunction`
and `dsp/tempotracking/TempoTrackV2`. Licensed GPLv2-or-later; each source
file retains its original copyright header unmodified. Includes a bundled
copy of `kissfft` (BSD-3-Clause, under `ext/kissfft/`).

Only the files this crate actually uses were vendored in (not the full
upstream qm-dsp tree) — see `build.rs` for the exact file list compiled.

## bpm_bridge.cpp

Not third-party — a thin bridge we wrote, exposing QM-DSP's detection
function + tempo tracker as a plain `extern "C"` function callable from Rust.
The windowing/overlap logic in it (and `src/bpm.rs`'s post-processing:
`retrieve_const_regions`/`make_const_bpm_ex`/`bpm_round`) ports the BPM
analysis pipeline this project's old PyQt6/QML predecessor built on top of
QM-DSP, which was itself adapted from Mixxx's `BeatUtils`.
