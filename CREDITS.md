# Credits

Third-party code and algorithms this project is built on top of, beyond
routine npm/crates.io dependencies (see `package.json` / `Cargo.toml` /
`Cargo.lock` for those).

## Psysonic

The native gapless audio engine (`native/audio-engine/`) is a Rust/napi-rs
port of **psysonic-audio**, the audio crate from Psysonic, a Tauri+Rust
music player. The playback architecture — rodio/Symphonia-based decoding,
transport controls, progress/event handling, gapless chain-preload — traces
directly back to it; individual source files note which upstream file they
were ported or trimmed from.

Psysonic is licensed under the GNU GPLv3. Required attribution terms for
forks and derivative works are set out in full in `NOTICE.md` (unmodified
retention of that file is itself one of those terms) — see it for the
authoritative text.

## QM-DSP

BPM detection (`native/audio-engine/src/bpm.rs`, `vendor/bpm_bridge.cpp`)
runs on **QM-DSP**, developed by the Centre for Digital Music, Queen Mary
University of London. Specifically `dsp/onsets/DetectionFunction` and
`dsp/tempotracking/TempoTrackV2`, which produce the raw beat-onset
positions the rest of the pipeline snaps to a stable BPM value.

Licensed GPL-2.0-or-later. Only the files this project actually uses are
vendored in (`native/audio-engine/vendor/qm-dsp/`, see `build.rs` for the
exact list) — each retains its original copyright header unmodified. See
`native/audio-engine/vendor/README.md`.

Bundles **kissfft** (`vendor/qm-dsp/ext/kissfft/`), BSD-3-Clause.

## Mixxx

QM-DSP's raw beat onsets are noisy; turning them into one stable,
displayable BPM number is **Mixxx**'s `BeatUtils` algorithm (Copyright
Mixxx Development Team, GPL-2.0-or-later) — specifically the constant-tempo
region detection and BPM-snapping logic. This project didn't copy Mixxx's
code directly; it ports the algorithm as this project's own PyQt/QML
predecessor had already adapted it, reimplemented again in Rust in
`bpm.rs`'s `retrieve_const_regions`/`make_const_bpm_ex`/`bpm_round`.
