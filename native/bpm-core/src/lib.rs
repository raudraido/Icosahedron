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
        out_clarity: *mut f64,
    ) -> c_int;
}

const MAX_BEATS: usize = 20_000;

/// One detection with a measure of how much to trust it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BpmResult {
    pub bpm: f32,
    /// 0..1, see [`detect_bpm_detailed`].
    pub confidence: f32,
}

/// Downmixes interleaved samples to mono, runs the QM-DSP tempo tracker, and
/// returns the snapped constant-tempo BPM — or `None` if detection failed
/// (too short/quiet a track for QM-DSP to find at least 2 beats).
pub fn detect_bpm(interleaved: &[f32], channels: u16, sample_rate: u32) -> Option<f32> {
    detect_bpm_detailed(interleaved, channels, sample_rate).map(|r| r.bpm)
}

/// Same detection as [`detect_bpm`] (the BPM is bit-for-bit the same), plus a confidence.
///
/// confidence = coverage x clarity, both 0..1:
/// * coverage: the share of the track's duration that the constant-tempo stretch deciding the BPM
///   spans (first to last beat of the region(s) `make_const_bpm` settled on). A track whose beats
///   keep one steady tempo from start to end scores near 1; a track where the tempo wanders, or where
///   only a short part is steady (a beat that starts late, an intro, a break), scores low.
/// * clarity: how much the onset detection function stands out at the detected beats compared with
///   its overall level (QM-DSP's own measure of "something happened here"): with r = mean of the
///   function at the beats / mean of the function everywhere, clarity = 1 - 1/r. The tempo tracker
///   always lays a beat grid over a track, even over ambient noise, where coverage alone would be
///   misleadingly high; there the detection function is flat and clarity is low.
pub fn detect_bpm_detailed(interleaved: &[f32], channels: u16, sample_rate: u32) -> Option<BpmResult> {
    let mono = downmix_to_mono(interleaved, channels as usize);
    if mono.is_empty() {
        return None;
    }

    let mut beat_frames = vec![0f64; MAX_BEATS];
    let mut clarity = 0f64;
    let count = unsafe {
        qmdsp_detect_beat_frames(
            mono.as_ptr(),
            mono.len() as i64,
            sample_rate as f64,
            beat_frames.as_mut_ptr(),
            MAX_BEATS as c_int,
            &mut clarity,
        )
    };
    if count < 2 {
        return None;
    }
    beat_frames.truncate(count as usize);

    let regions = retrieve_const_regions(&beat_frames, sample_rate as f64);
    let (bpm, covered) = make_const_bpm(&regions, sample_rate as f64);
    if bpm > 0.0 {
        let coverage = (covered / mono.len() as f64).clamp(0.0, 1.0);
        // the bridge reports the ratio r (>= about 1); 1 - 1/r maps it to 0..1 (1.3 -> 0.2, 4 -> 0.75, 12 -> 0.92)
        let clarity = 1.0 - 1.0 / clarity.max(1.0);
        let confidence = (coverage * clarity) as f32;
        Some(BpmResult { bpm, confidence })
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
fn make_const_bpm(regions: &[ConstRegion], sample_rate: f64) -> (f32, f64) {
    let max_phase_err = 0.025 * sample_rate;
    const MIN_BEATS: i32 = 16;

    if regions.len() < 2 {
        return (0.0, 0.0);
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
        return (0.0, 0.0);
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

    bl_min = long_bl - max_phase_err / long_n as f64;
    bl_max = long_bl + max_phase_err / long_n as f64;

    let center = (60.0 * sample_rate / long_bl) as f32;
    let mn = (60.0 * sample_rate / bl_max) as f32;
    let mx = (60.0 * sample_rate / bl_min) as f32;
    (bpm_round(mn, center, mx), long_len)
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: u32 = 44_100;

    struct Rng(u32);
    impl Rng {
        fn next(&mut self) -> f32 {
            self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
            (self.0 >> 8) as f32 / 8_388_608.0 - 1.0
        }
    }

    /// A kick (decaying 60 Hz sine with a click) on every beat, the first one at `start` seconds.
    fn kicks(bpm: f64, secs: f64, start: f64) -> Vec<f32> {
        let n = (R as f64 * secs) as usize;
        let mut s = vec![0f32; n];
        let mut r = Rng(7);
        let beat = 60.0 / bpm * R as f64;
        let mut k = 0;
        loop {
            let st = (start * R as f64 + k as f64 * beat) as usize;
            if st >= n { break; }
            for i in 0..(R as usize / 5).min(n - st) {
                let t = i as f32 / R as f32;
                s[st + i] += 0.8 * (-t * 25.0).exp() * (2.0 * std::f32::consts::PI * 60.0 * t).sin() + if i < 200 { r.next() * 0.5 } else { 0.0 };
            }
            k += 1;
        }
        s
    }

    fn conf(s: &[f32]) -> f32 {
        detect_bpm_detailed(s, 1, R).map_or(0.0, |r| r.confidence)
    }

    #[test]
    fn rounds_to_clean_values() {
        assert_eq!(bpm_round(127.6, 128.02, 128.4), 128.0);
        // no whole number fits, a third does
        assert!((bpm_round(100.1, 100.4, 100.45) - 100.0 - 1.0 / 3.0).abs() < 1e-4);
    }

    #[test]
    fn too_short_or_silent_input_has_no_tempo() {
        assert_eq!(detect_bpm(&[], 2, 44100), None);
        assert_eq!(detect_bpm(&vec![0.0; 44100], 1, 44100), None);
    }

    #[test]
    fn detailed_gives_the_same_bpm_as_detect_bpm() {
        let s = kicks(128.0, 60.0, 0.0);
        assert_eq!(detect_bpm(&s, 1, R), detect_bpm_detailed(&s, 1, R).map(|r| r.bpm));
    }

    #[test]
    fn a_steady_beat_has_high_confidence() {
        for bpm in [100.0, 128.0, 140.0] {
            let c = conf(&kicks(bpm, 90.0, 0.0));
            assert!(c > 0.8, "{bpm} BPM gave {c}");
        }
    }

    #[test]
    fn a_beat_that_starts_late_has_lower_confidence_than_one_from_the_start() {
        let late = conf(&kicks(128.0, 90.0, 45.0));
        let steady = conf(&kicks(128.0, 90.0, 0.0));
        assert!(late < steady - 0.2, "late {late}, steady {steady}");
    }

    #[test]
    fn ambient_like_signals_have_low_confidence() {
        let n = R as usize * 90;
        let mut r = Rng(3);
        let noise: Vec<f32> = (0..n).map(|i| { let t = i as f32 / R as f32; r.next() * 0.3 * (0.5 + 0.5 * (t * 0.3).sin()) }).collect();
        let pad: Vec<f32> = (0..n).map(|i| { let t = i as f32 / R as f32; 0.3 * (t * 220.0 * 6.283).sin() * (0.6 + 0.4 * (t * 0.2).sin()) + 0.1 * (t * 330.5 * 6.283).sin() }).collect();
        let mut sparse = vec![0f32; n];
        let mut t = 2.0f64;
        while t < 88.0 {
            let st = (t * R as f64) as usize;
            for i in 0..2000.min(n - st) { sparse[st + i] += r.next() * 0.6 * (-(i as f32) / 300.0).exp(); }
            t += 1.0 + (r.next() as f64 + 1.0) * 3.0;
        }
        for (name, s) in [("noise with a slow envelope", &noise), ("steady pad", &pad), ("sparse irregular clicks", &sparse)] {
            let c = conf(s);
            assert!(c < 0.35, "{name} gave {c}");
        }
    }
}
