import AVFoundation
import MediaToolbox
import os

/// The equalizer settings, in the same JSON the web and desktop apps keep in `eq_settings`:
/// {"enabled":true,"preampDb":0,"bandsDb":[10 values]}. Bands are ISO octaves 31 Hz ... 16 kHz,
/// RBJ peaking filters with Q 1.1 — the same as the desktop engine.
struct EQSettings: Equatable {
    var enabled = false
    var preampDb: Double = 0
    var bandsDb: [Double] = Array(repeating: 0, count: 10)

    static let freqs: [Double] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    static let q = 1.1
    static let defaultsKey = "eq_settings"

    init() {}

    init?(json: String) {
        guard let data = json.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        enabled = (o["enabled"] as? Bool) ?? false
        preampDb = (o["preampDb"] as? NSNumber)?.doubleValue ?? 0
        let raw = (o["bandsDb"] as? [NSNumber])?.map { $0.doubleValue } ?? []
        bandsDb = (0..<10).map { $0 < raw.count ? raw[$0] : 0 }
    }

    var json: String {
        func n(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%g", v) }
        return "{\"enabled\":\(enabled),\"preampDb\":\(n(preampDb)),\"bandsDb\":[\(bandsDb.map(n).joined(separator: ","))]}"
    }

    /// Nothing to do: engaged EQ with every band flat is the same as no EQ.
    var isFlat: Bool { abs(preampDb) < 0.05 && bandsDb.allSatisfy { abs($0) < 0.05 } }
}

/// One biquad section (transposed direct form II coefficients).
struct BiquadCoeffs {
    var band: Int
    var b0: Float, b1: Float, b2: Float, a1: Float, a2: Float

    /// RBJ audio-EQ-cookbook peaking filter.
    init(band: Int, fs: Double, f0: Double, q: Double, gainDb: Double) {
        let a = pow(10, gainDb / 40)
        let w0 = 2 * Double.pi * f0 / fs
        let alpha = sin(w0) / (2 * q)
        let c = cos(w0)
        let a0 = 1 + alpha / a
        self.band = band
        b0 = Float((1 + alpha * a) / a0)
        b1 = Float(-2 * c / a0)
        b2 = Float((1 - alpha * a) / a0)
        a1 = Float(-2 * c / a0)
        a2 = Float((1 - alpha / a) / a0)
    }
}

/// Runs the EQ on the audio of one AVPlayerItem (the tap's processing callback lives here).
final class EQProcessor: @unchecked Sendable {
    struct Config {
        var active = false
        var preamp: Float = 1
        var sections: [BiquadCoeffs] = []
    }

    private static let maxChannels = 8
    private let config = OSAllocatedUnfairLock(initialState: Config())
    private let formatLock = OSAllocatedUnfairLock(initialState: (rate: 0.0, ok: false))
    private var lastConfig = Config()
    private var channels = 2
    private var interleaved = false
    /// z1, z2 per channel and band.
    private let state: UnsafeMutablePointer<Float>

    init() {
        state = UnsafeMutablePointer<Float>.allocate(capacity: Self.maxChannels * 10 * 2)
        state.initialize(repeating: 0, count: Self.maxChannels * 10 * 2)
    }

    deinit { state.deallocate() }

    var sampleRate: Double { formatLock.withLock { $0.rate } }

    // MARK: Called by the tap

    func prepare(_ asbd: AudioStreamBasicDescription) {
        let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0 && asbd.mBitsPerChannel == 32
        interleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0
        channels = min(Int(asbd.mChannelsPerFrame), Self.maxChannels)
        state.update(repeating: 0, count: Self.maxChannels * 10 * 2)
        formatLock.withLock { $0 = (asbd.mSampleRate, isFloat) }
        apply(EQManager.shared.settings)
    }

    func process(_ list: UnsafeMutablePointer<AudioBufferList>, frames: Int) {
        let cfg = config.withLockIfAvailable { $0 } ?? lastConfig
        lastConfig = cfg
        guard cfg.active, formatLock.withLock({ $0.ok }) else { return }
        let abl = UnsafeMutableAudioBufferListPointer(list)
        if interleaved {
            guard let data = abl.first?.mData?.assumingMemoryBound(to: Float.self) else { return }
            for ch in 0..<channels { run(data + ch, frames, stride: channels, ch, cfg) }
        } else {
            for (ch, buf) in abl.enumerated() where ch < channels {
                guard let data = buf.mData?.assumingMemoryBound(to: Float.self) else { continue }
                run(data, frames, stride: 1, ch, cfg)
            }
        }
    }

    private func run(_ p: UnsafeMutablePointer<Float>, _ n: Int, stride: Int, _ ch: Int, _ cfg: Config) {
        let st = state + ch * 20
        for i in 0..<n {
            var x = p[i * stride] * cfg.preamp
            for c in cfg.sections {
                let z = st + c.band * 2
                let y = c.b0 * x + z[0]
                z[0] = c.b1 * x - c.a1 * y + z[1]
                z[1] = c.b2 * x - c.a2 * y
                x = y
            }
            p[i * stride] = x
        }
    }

    // MARK: Settings (from the main thread)

    /// Computes this item's filters for its own sample rate. Bands at or above 0.45 x the sample
    /// rate cannot be realised and stay out, and flat bands are skipped (identity).
    func apply(_ s: EQSettings) {
        let fs = sampleRate
        var cfg = Config()
        if s.enabled, !s.isFlat, fs > 0 {
            cfg.active = true
            cfg.preamp = Float(pow(10, s.preampDb / 20))
            for (i, f0) in EQSettings.freqs.enumerated() where abs(s.bandsDb[i]) >= 0.05 && f0 < fs * 0.45 {
                cfg.sections.append(BiquadCoeffs(band: i, fs: fs, f0: f0, q: EQSettings.q, gainDb: s.bandsDb[i]))
            }
        }
        config.withLock { $0 = cfg }
    }
}

// MARK: - The tap's C callbacks

private func processor(of tap: MTAudioProcessingTap) -> EQProcessor {
    Unmanaged<EQProcessor>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
}

private let tapInit: MTAudioProcessingTapInitCallback = { _, clientInfo, storageOut in
    storageOut.pointee = clientInfo
}

private let tapFinalize: MTAudioProcessingTapFinalizeCallback = { tap in
    Unmanaged<EQProcessor>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release()
}

private let tapPrepare: MTAudioProcessingTapPrepareCallback = { tap, _, format in
    processor(of: tap).prepare(format.pointee)
}

private let tapUnprepare: MTAudioProcessingTapUnprepareCallback = { _ in }

private let tapProcess: MTAudioProcessingTapProcessCallback = { tap, frames, _, bufferList, framesOut, flagsOut in
    let status = MTAudioProcessingTapGetSourceAudio(tap, frames, bufferList, flagsOut, nil, framesOut)
    guard status == noErr else { return }
    processor(of: tap).process(bufferList, frames: framesOut.pointee)
}

/// Owns the settings and attaches the equalizer to player items.
final class EQManager: @unchecked Sendable {
    static let shared = EQManager()

    private let lock = OSAllocatedUnfairLock(initialState: EQSettings())
    private let processors = NSHashTable<EQProcessor>.weakObjects()
    private let attached = NSMapTable<AVPlayerItem, NSNumber>.weakToStrongObjects()
    /// Called on the main thread when the EQ gets switched on, so items already queued get it too.
    var onEnabled: (() -> Void)?

    init() { reloadFromDefaults() }

    var settings: EQSettings { lock.withLock { $0 } }

    /// Takes the settings from UserDefaults (also after a change arrived through sync).
    func reloadFromDefaults() {
        let s = UserDefaults.standard.string(forKey: EQSettings.defaultsKey).flatMap { EQSettings(json: $0) } ?? EQSettings()
        set(s, save: false)
    }

    func update(_ s: EQSettings) { set(s, save: true) }

    private func set(_ s: EQSettings, save: Bool) {
        let wasEnabled = settings.enabled
        lock.withLock { $0 = s }
        if save { UserDefaults.standard.set(s.json, forKey: EQSettings.defaultsKey) }
        for p in processors.allObjects { p.apply(s) }
        if s.enabled, !wasEnabled { DispatchQueue.main.async { self.onEnabled?() } }
    }

    /// Puts the equalizer on an item's audio. Only done once the EQ is in use, so plain playback
    /// stays untouched until then.
    func attach(to item: AVPlayerItem) {
        guard settings.enabled, attached.object(forKey: item) == nil else { return }
        attached.setObject(1, forKey: item)
        Task {
            guard let track = try? await item.asset.loadTracks(withMediaType: .audio).first else { return }
            let proc = EQProcessor()
            var callbacks = MTAudioProcessingTapCallbacks(
                version: kMTAudioProcessingTapCallbacksVersion_0,
                clientInfo: Unmanaged.passRetained(proc).toOpaque(),
                init: tapInit, finalize: tapFinalize, prepare: tapPrepare, unprepare: tapUnprepare, process: tapProcess)
            var tapOut: MTAudioProcessingTap?
            let status = MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tapOut)
            guard status == noErr, let tap = tapOut else {
                Unmanaged.passUnretained(proc).release() // balance passRetained: the tap was not created
                return
            }
            let params = AVMutableAudioMixInputParameters(track: track)
            params.audioTapProcessor = tap
            let mix = AVMutableAudioMix()
            mix.inputParameters = [params]
            await MainActor.run {
                self.processors.add(proc)
                item.audioMix = mix
            }
        }
    }
}
