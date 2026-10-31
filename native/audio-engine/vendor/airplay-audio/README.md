# airplay-audio (vendored)

Copy of `crates/airplay-audio` from https://github.com/lmcgartland/airplay2-rs
at commit a2f980cf25bf13ae20158497cc2d2ea69cd88fa7 (GPL-3.0-or-later), with one
change: `set_socket_qos` in `src/rtp.rs` uses `socket2` instead of Unix-only
`as_raw_fd`/`libc::setsockopt`, so it compiles on Windows. The Linux-only
`SO_PRIORITY` call is kept behind `cfg(target_os = "linux")`.

Wired in through `[patch]` in `../../Cargo.toml`. Drop this directory once
upstream has an equivalent fix.
