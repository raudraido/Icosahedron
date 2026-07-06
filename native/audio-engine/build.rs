extern crate napi_build;

fn main() {
    napi_build::setup();

    // QM-DSP (Queen Mary DSP library) — vendored under vendor/qm-dsp, used for
    // BPM detection (DetectionFunction + TempoTrackV2). Two include roots are
    // needed: `vendor/` so bpm_bridge.cpp's own `qm-dsp/dsp/...` includes
    // resolve, and `vendor/qm-dsp/` so the library's *internal* cross-includes
    // (e.g. DetectionFunction.h's `"maths/MathUtilities.h"`) resolve the same
    // way they do in the upstream tree.
    cc::Build::new()
        .cpp(true)
        .std("c++14")
        .include("vendor")
        .include("vendor/qm-dsp")
        .define("kiss_fft_scalar", Some("double"))
        // MSVC doesn't expose M_PI (etc.) from <cmath> unless this is defined
        // before the first include — GCC/Clang expose it unconditionally, so
        // this define is a no-op there.
        .define("_USE_MATH_DEFINES", None)
        .file("vendor/bpm_bridge.cpp")
        .file("vendor/qm-dsp/dsp/onsets/DetectionFunction.cpp")
        .file("vendor/qm-dsp/dsp/tempotracking/TempoTrackV2.cpp")
        .file("vendor/qm-dsp/dsp/phasevocoder/PhaseVocoder.cpp")
        .file("vendor/qm-dsp/dsp/transforms/FFT.cpp")
        .file("vendor/qm-dsp/maths/MathUtilities.cpp")
        .warnings(false)
        .compile("qmdsp_bpm");

    // kissfft is plain C, compiled separately from the C++ files above (a
    // single cc::Build mixes languages badly across platforms/compilers).
    cc::Build::new()
        .include("vendor/qm-dsp")
        .define("kiss_fft_scalar", Some("double"))
        .file("vendor/qm-dsp/ext/kissfft/kiss_fft.c")
        .file("vendor/qm-dsp/ext/kissfft/tools/kiss_fftr.c")
        .warnings(false)
        .compile("qmdsp_kissfft");

    println!("cargo:rerun-if-changed=vendor");
}
