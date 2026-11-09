import Foundation
import Network

/// How a track is delivered: the original file ("raw", direct play) or transcoded by the server.
struct StreamQuality: Hashable {
    let format: String   // "raw", "mp3" or "aac"
    let bitrate: Int     // kbps; 0 for raw

    static let direct = StreamQuality(format: "raw", bitrate: 0)

    var isDirect: Bool { format == "raw" }
    /// Higher is better; direct play beats any transcode.
    var rank: Int { isDirect ? 1_000_000 : bitrate }
    var storageKey: String { isDirect ? "raw" : "\(format)-\(bitrate)" }
    var fileExtension: String? { isDirect ? nil : (format == "aac" ? "aac" : "mp3") }
    var label: String { isDirect ? String(localized: "Direct (original)") : "\(format.uppercased()) \(bitrate) kbps" }

    init(format: String, bitrate: Int) {
        self.format = format
        self.bitrate = bitrate
    }

    init?(key: String) {
        if key == "raw" { self = .direct; return }
        let parts = key.split(separator: "-")
        guard parts.count == 2, ["mp3", "aac"].contains(String(parts[0])), let b = Int(parts[1]) else { return nil }
        self.init(format: String(parts[0]), bitrate: b)
    }

    /// Everything the settings offer.
    static let options: [StreamQuality] =
        [.direct] + ["mp3", "aac"].flatMap { f in [96, 128, 192, 256, 320].map { StreamQuality(format: f, bitrate: $0) } }
}

enum QualitySettings {
    static let wifiKey = "qualityWifi"
    static let cellularKey = "qualityCellular"
    static let cellularCacheKey = "cacheOnCellular"

    static func wifi() -> StreamQuality { read(wifiKey) ?? .direct }
    static func cellular() -> StreamQuality { read(cellularKey) ?? StreamQuality(format: "mp3", bitrate: 192) }
    static var cacheOnCellular: Bool { UserDefaults.standard.bool(forKey: cellularCacheKey) }

    private static func read(_ key: String) -> StreamQuality? {
        UserDefaults.standard.string(forKey: key).flatMap { StreamQuality(key: $0) }
    }
}

/// Which kind of connection the phone is on. Wi-Fi and wired count as "Wi-Fi"; cellular (or
/// iOS Low Data Mode, which is the user asking to save data) uses the cellular profile.
/// Always updated on the main queue.
@Observable
final class NetworkMonitor {
    enum Kind { case wifi, cellular, offline }

    var kind: Kind = .wifi
    var isConstrained = false
    @ObservationIgnored var onChange: (() -> Void)?
    @ObservationIgnored private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in self?.apply(path) }
        monitor.start(queue: .main)
    }

    var isOnline: Bool { kind != .offline }
    var usesCellularProfile: Bool { kind == .cellular || isConstrained }

    /// The quality that applies to streaming right now.
    var streamQuality: StreamQuality { usesCellularProfile ? QualitySettings.cellular() : QualitySettings.wifi() }

    /// Whether the background cache may download now (not on cellular unless the user allows it).
    var cachingAllowed: Bool { kind == .offline ? false : (usesCellularProfile ? QualitySettings.cacheOnCellular : true) }

    private func apply(_ path: NWPath) {
        let newKind: Kind
        if path.status != .satisfied {
            newKind = .offline
        } else if path.usesInterfaceType(.cellular), !path.usesInterfaceType(.wifi), !path.usesInterfaceType(.wiredEthernet) {
            newKind = .cellular
        } else {
            newKind = .wifi
        }
        if newKind != kind || path.isConstrained != isConstrained {
            kind = newKind
            isConstrained = path.isConstrained
            onChange?()
        }
    }
}
