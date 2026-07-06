//! BPM detection — ports Mixxx's `BeatUtils` post-processing (as adapted by
//! the old app's audio_core.cpp) on top of raw beat positions produced by
//! QM-DSP's `DetectionFunction` + `TempoTrackV2` (vendor/bpm_bridge.cpp).
//!
//! QM-DSP alone only gives a list of individual beat onset positions, which
//! wander somewhat beat-to-beat — `retrieve_const_regions`/`make_const_bpm_ex`
//! find the longest phase-coherent constant-tempo stretch of that list and
//! snap it to a "clean" BPM value (whole number, or a recognizable fraction),
//! which is what actually produces a stable, displayable BPM.

use std::os::raw::c_int;

extern "C" {
    fn qmdsp_detect_beat_frames(
        samples: *const f32,
        num_samples: i64,
        sample_rate: f64,
        out_beat_frames: *mut f64,
        max_beats: c_int,
    ) -> c_int;
}

const MAX_BEATS: usize = 20_000;

/// Downmixes interleaved samples to mono, runs the QM-DSP tempo tracker, and
/// returns the snapped constant-tempo BPM — or `None` if detection failed
/// (too short/quiet a track for QM-DSP to find at least 2 beats).
pub fn detect_bpm(interleaved: &[f32], channels: u16, sample_rate: u32) -> Option<f32> {
    let mono = downmix_to_mono(interleaved, channels as usize);
    if mono.is_empty() {
        return None;
    }

    let mut beat_frames = vec![0f64; MAX_BEATS];
    let count = unsafe {
        qmdsp_detect_beat_frames(
            mono.as_ptr(),
            mono.len() as i64,
            sample_rate as f64,
            beat_frames.as_mut_ptr(),
            MAX_BEATS as c_int,
        )
    };
    if count < 2 {
        return None;
    }
    beat_frames.truncate(count as usize);

    let regions = retrieve_const_regions(&beat_frames, sample_rate as f64);
    let bpm = make_const_bpm(&regions, sample_rate as f64);
    if bpm > 0.0 {
        Some(bpm)
    } else {
        None
    }
}

fn downmix_to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

// ── Port of Mixxx's BeatUtils (beatutils.cpp), as adapted by the old app's
// audio_core.cpp — all beat positions/lengths are in audio frames (f64). The
// only difference from that C++ version: `SAMPLE_RATE` there was a hardcoded
// 44100; here it's the file's actual decoded rate, since every use of it
// below is already rate-relative (a duration expressed in frames).

struct ConstRegion {
    first_beat: f64,
    beat_length: f64,
}

fn bpm_try_snap(mn: f32, center: f32, mx: f32, fraction: f32) -> f32 {
    let snap = (center * fraction).round() / fraction;
    if snap > mn && snap < mx {
        snap
    } else {
        -1.0
    }
}

fn bpm_round(mn: f32, center: f32, mx: f32) -> f32 {
    let mut s = bpm_try_snap(mn, center, mx, 1.0);
    if s > 0.0 {
        return s;
    }
    if center < 85.0 {
        s = bpm_try_snap(mn, center, mx, 2.0);
        if s > 0.0 {
            return s;
        }
    }
    if center > 127.0 {
        s = bpm_try_snap(mn, center, mx, 2.0 / 3.0);
        if s > 0.0 {
            return s;
        }
    }
    s = bpm_try_snap(mn, center, mx, 3.0);
    if s > 0.0 {
        return s;
    }
    s = bpm_try_snap(mn, center, mx, 12.0);
    if s > 0.0 {
        return s;
    }
    center
}

/// BeatUtils::retrieveConstRegions — finds phase-coherent tempo regions.
fn retrieve_const_regions(beats: &[f64], sample_rate: f64) -> Vec<ConstRegion> {
    let max_phase_err = 0.025 * sample_rate; // 25ms in frames
    let max_phase_err_sum = 0.1 * sample_rate; // 100ms in frames
    const MAX_OUTLIERS: i32 = 1;

    if beats.len() < 2 {
        return Vec::new();
    }

    let mut left: i64 = 0;
    let mut right: i64 = beats.len() as i64 - 1;
    let mut regions = Vec::new();

    while left < beats.len() as i64 - 1 {
        let mean_bl = (beats[right as usize] - beats[left as usize]) / (right - left) as f64;
        let mut outliers = 0;
        let mut ironed = beats[left as usize];
        let mut err_sum = 0.0;
        let mut i = left + 1;
        while i <= right {
            ironed += mean_bl;
            let err = ironed - beats[i as usize];
            err_sum += err;
            if err.abs() > max_phase_err {
                outliers += 1;
                if outliers > MAX_OUTLIERS || i == left + 1 {
                    break;
                }
            }
            if err_sum.abs() > max_phase_err_sum {
                break;
            }
            i += 1;
        }
        if i > right {
            let mut border_err = 0.0;
            if right > left + 2 {
                let first = beats[(left + 1) as usize] - beats[left as usize];
                let last = beats[right as usize] - beats[(right - 1) as usize];
                border_err = (first + last - 2.0 * mean_bl).abs();
            }
            if border_err < max_phase_err / 2.0 {
                regions.push(ConstRegion { first_beat: beats[left as usize], beat_length: mean_bl });
                left = right;
                right = beats.len() as i64 - 1;
                continue;
            }
        }
        right -= 1;
    }
    regions.push(ConstRegion { first_beat: *beats.last().unwrap(), beat_length: 0.0 }); // sentinel
    regions
}

/// BeatUtils::makeConstBpm — picks BPM from the longest coherent region,
/// tries to extend it from both ends, then snaps to a clean value.
fn make_const_bpm(regions: &[ConstRegion], sample_rate: f64) -> f32 {
    let max_phase_err = 0.025 * sample_rate;
    const MIN_BEATS: i32 = 16;

    if regions.len() < 2 {
        return 0.0;
    }

    // Find longest region.
    let mut mid_idx = 0usize;
    let mut long_len = 0.0;
    let mut long_bl = 0.0;
    for i in 0..regions.len() - 1 {
        let len = regions[i + 1].first_beat - regions[i].first_beat;
        if len > long_len {
            long_len = len;
            long_bl = regions[i].beat_length;
            mid_idx = i;
        }
    }
    if long_len == 0.0 {
        return 0.0;
    }

    let mut long_n = (long_len / long_bl + 0.5) as i32;
    let mut bl_min = long_bl - max_phase_err / long_n as f64;
    let mut bl_max = long_bl + max_phase_err / long_n as f64;
    let mut start_idx = mid_idx;

    // Extend toward start.
    for i in 0..mid_idx {
        let len = regions[i + 1].first_beat - regions[i].first_beat;
        let nb = (len / regions[i].beat_length + 0.5) as i32;
        if nb < MIN_BEATS {
            continue;
        }
        let t_min = regions[i].beat_length - max_phase_err / nb as f64;
        let t_max = regions[i].beat_length + max_phase_err / nb as f64;
        if long_bl <= t_min || long_bl >= t_max {
            continue;
        }
        let new_len = regions[mid_idx + 1].first_beat - regions[i].first_beat;
        let r_min = bl_min.max(t_min);
        let r_max = bl_max.min(t_max);
        let max_nb = (new_len / r_min).round() as i32;
        let min_nb = (new_len / r_max).round() as i32;
        if min_nb != max_nb {
            continue;
        }
        let new_bl = new_len / min_nb as f64;
        if new_bl <= bl_min || new_bl >= bl_max {
            continue;
        }
        long_len = new_len;
        long_bl = new_bl;
        long_n = min_nb;
        bl_min = long_bl - max_phase_err / long_n as f64;
        bl_max = long_bl + max_phase_err / long_n as f64;
        start_idx = i;
        break;
    }

    // Extend toward end.
    for i in (mid_idx + 1..regions.len() - 1).rev() {
        let len = regions[i + 1].first_beat - regions[i].first_beat;
        let nb = (len / regions[i].beat_length + 0.5) as i32;
        if nb < MIN_BEATS {
            continue;
        }
        let t_min = regions[i].beat_length - max_phase_err / nb as f64;
        let t_max = regions[i].beat_length + max_phase_err / nb as f64;
        if long_bl <= t_min || long_bl >= t_max {
            continue;
        }
        let new_len = regions[i + 1].first_beat - regions[start_idx].first_beat;
        let r_min = bl_min.max(t_min);
        let r_max = bl_max.min(t_max);
        let max_nb = (new_len / r_min).round() as i32;
        let min_nb = (new_len / r_max).round() as i32;
        if min_nb != max_nb {
            continue;
        }
        let new_bl = new_len / min_nb as f64;
        if new_bl <= bl_min || new_bl >= bl_max {
            continue;
        }
        long_len = new_len;
        long_bl = new_bl;
        long_n = min_nb;
        break;
    }
    let _ = long_len; // no longer read past this point, matches the C++ (kept for parity/readability)

    bl_min = long_bl - max_phase_err / long_n as f64;
    bl_max = long_bl + max_phase_err / long_n as f64;

    let center = (60.0 * sample_rate / long_bl) as f32;
    let mn = (60.0 * sample_rate / bl_max) as f32;
    let mx = (60.0 * sample_rate / bl_min) as f32;
    bpm_round(mn, center, mx)
}
