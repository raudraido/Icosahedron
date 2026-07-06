// Thin C bridge around QM-DSP's onset DetectionFunction + TempoTrackV2 tempo
// tracker — the same two classes the old app's audio_core.cpp (Sonar/
// player/components/audio_core.cpp) drove for BPM detection, ported here
// verbatim minus the decode step (Rust already has a Symphonia decoder;
// this bridge only receives already-decoded mono f32 samples).
//
// Unlike the old app, sample_rate is a runtime parameter rather than a
// hardcoded 44100 — all the frame-domain math below is already rate-relative
// (e.g. "0.01161f * sample_rate" is just "the step size in frames for an
// ~11.6ms hop"), so no resampling is needed for files at other rates.
#include <algorithm>
#include <cstdint>
#include <vector>

#include "qm-dsp/dsp/onsets/DetectionFunction.h"
#include "qm-dsp/dsp/tempotracking/TempoTrackV2.h"

extern "C" {

// Runs the QM-DSP onset detection function + tempo tracker over `samples`
// (mono, already downmixed) and writes each detected beat's position, in
// audio *frames* at `sample_rate`, into `out_beat_frames` (caller-allocated,
// `max_beats` capacity). Returns the number of beats written, or a negative
// value on failure (too few samples / detection produced <2 beats).
int32_t qmdsp_detect_beat_frames(
    const float* samples,
    int64_t num_samples,
    double sample_rate,
    double* out_beat_frames,
    int32_t max_beats
) {
    if (!samples || num_samples <= 0 || sample_rate <= 0 || !out_beat_frames || max_beats <= 0) {
        return -1;
    }

    const float kStepSecs = 0.01161f;   // ~512 samples @ 44.1kHz — same hop Mixxx uses
    const int   kMaxBinHz = 50;
    const int   stepSizeFrames = (int)(sample_rate * kStepSecs);
    int windowSize = 1;
    while (windowSize < (int)(sample_rate / kMaxBinHz)) windowSize <<= 1;

    DFConfig dfCfg;
    dfCfg.DFType              = DF_COMPLEXSD;
    dfCfg.stepSize            = stepSizeFrames;
    dfCfg.frameLength         = windowSize;
    dfCfg.dbRise              = 3;
    dfCfg.adaptiveWhitening   = false;
    dfCfg.whiteningRelaxCoeff = -1;
    dfCfg.whiteningFloor      = -1;

    DetectionFunction df(dfCfg);

    // Mixxx's DownmixAndOverlapHelper: pre-center first frame with silence.
    std::vector<double> win_buf(windowSize, 0.0);
    int write_pos = windowSize / 2;
    std::vector<double> detResults;

    auto feed = [&](const float* src, int64_t n) {
        int64_t inRead = 0;
        while (inRead < n) {
            size_t avail  = (size_t)(windowSize - write_pos);
            size_t toCopy = std::min((size_t)(n - inRead), avail);
            if (src) {
                for (size_t i = 0; i < toCopy; i++) win_buf[write_pos + i] = (double)src[inRead + i];
            } else {
                for (size_t i = 0; i < toCopy; i++) win_buf[write_pos + i] = 0.0;
            }
            write_pos += (int)toCopy;
            inRead    += (int64_t)toCopy;
            if (write_pos == windowSize) {
                detResults.push_back(df.processTimeDomain(win_buf.data()));
                for (int j = 0; j < windowSize - stepSizeFrames; j++)
                    win_buf[j] = win_buf[j + stepSizeFrames];
                write_pos -= stepSizeFrames;
            }
        }
    };

    feed(samples, num_samples);

    // Finalize: flush remaining samples with silence (same as Mixxx finalize()).
    int64_t silenceNeeded = std::max((int64_t)(windowSize - write_pos), (int64_t)(windowSize / 2 - 1));
    feed(nullptr, silenceNeeded);

    if ((int)detResults.size() < 6) return -1;

    // Skip first 2 frames (noise artifact) — same as Mixxx.
    std::vector<double> df_vals(detResults.begin() + 2, detResults.end());

    std::vector<int> beatPeriod(df_vals.size() / 128 + 1);
    TempoTrackV2 tt((float)sample_rate, stepSizeFrames);
    tt.calculateBeatPeriod(df_vals, beatPeriod);

    std::vector<double> rawBeats;
    tt.calculateBeats(df_vals, beatPeriod, rawBeats);
    if (rawBeats.size() < 2) return -1;

    int32_t count = 0;
    for (double b : rawBeats) {
        if (count >= max_beats) break;
        out_beat_frames[count++] = b * stepSizeFrames + stepSizeFrames / 2.0;
    }
    return count;
}

} // extern "C"
