import Foundation

/// On-disk cache of the audio files the player has used or is about to use. Tracks are
/// downloaded whole in the background (the next track right away, the current one a few
/// seconds in), so the next track starts from a local file and seeks in a cached track are exact.
/// Size is limited by the user's setting; the oldest files go first.
final class AudioCache: @unchecked Sendable {
    static let shared = AudioCache()

    /// UserDefaults key of the limit in MB: 0 = off, -1 = unlimited.
    static let limitKey = "cacheLimitMB"

    private let dir: URL
    private let lock = NSLock()
    private var inflight: [String: Task<Void, Never>] = [:]
    private var protectedIds: Set<String> = []
    /// Called on the main actor when a track finished downloading.
    var onCached: (@MainActor (String) -> Void)?

    init() {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        dir = base.appendingPathComponent("AudioCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    var limitBytes: Int64 {
        let mb = UserDefaults.standard.object(forKey: Self.limitKey) as? Int ?? 2048
        if mb < 0 { return Int64.max }
        return Int64(mb) * 1_048_576
    }

    private func safe(_ id: String) -> String {
        String(id.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" })
    }

    private func fileURL(_ t: Track) -> URL {
        let ext = (t.format?.isEmpty == false) ? t.format! : "mp3"
        return dir.appendingPathComponent("\(safe(t.id)).\(ext)")
    }

    /// The local file of a fully cached track.
    func localURL(for t: Track) -> URL? {
        let u = fileURL(t)
        return FileManager.default.fileExists(atPath: u.path) ? u : nil
    }

    /// Marks a file as recently used so it is the last to be evicted.
    func touch(_ t: Track) {
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: fileURL(t).path)
    }

    func remove(_ t: Track) {
        try? FileManager.default.removeItem(at: fileURL(t))
    }

    /// Tracks that must not be evicted or cancelled (current and next).
    func setProtected(_ ids: Set<String>) {
        lock.lock(); protectedIds = ids; lock.unlock()
        cancel(except: ids)
    }

    func prefetch(_ t: Track, client: SubsonicClient) {
        guard limitBytes > 0, t.directURL == nil, localURL(for: t) == nil else { return }
        lock.lock()
        defer { lock.unlock() }
        guard inflight[t.id] == nil else { return }
        inflight[t.id] = Task.detached(priority: .utility) { [weak self] in
            await self?.download(t, client: client)
        }
    }

    private func download(_ t: Track, client: SubsonicClient) async {
        defer {
            lock.lock(); inflight[t.id] = nil; lock.unlock()
        }
        do {
            let (tmp, response) = try await URLSession.shared.download(from: client.streamURL(t.id))
            guard (response as? HTTPURLResponse)?.statusCode == 200, !Task.isCancelled else {
                try? FileManager.default.removeItem(at: tmp)
                return
            }
            let dest = fileURL(t)
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: tmp, to: dest)
            enforceLimit()
            let id = t.id
            let callback = onCached
            await MainActor.run { callback?(id) }
        } catch {
            // Cancelled or offline: the stream keeps working, nothing to clean up.
        }
    }

    /// Stops downloads of tracks that are no longer coming up.
    func cancel(except keep: Set<String>) {
        lock.lock()
        let stale = inflight.filter { !keep.contains($0.key) }
        lock.unlock()
        for (_, task) in stale { task.cancel() }
    }

    // MARK: Size management

    private func files() -> [(url: URL, size: Int64, date: Date)] {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        let urls = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys)) ?? []
        return urls.compactMap { u in
            guard let v = try? u.resourceValues(forKeys: Set(keys)) else { return nil }
            return (u, Int64(v.fileSize ?? 0), v.contentModificationDate ?? .distantPast)
        }
    }

    func totalSize() -> Int64 { files().reduce(0) { $0 + $1.size } }

    /// Deletes the oldest files until the cache fits the limit (never the protected ones).
    func enforceLimit() {
        lock.lock(); let keep = protectedIds.map(safe); lock.unlock()
        let limit = limitBytes
        var items = files().sorted { $0.date < $1.date }
        var total = items.reduce(Int64(0)) { $0 + $1.size }
        while total > limit, !items.isEmpty {
            let victim = items.removeFirst()
            if keep.contains(victim.url.deletingPathExtension().lastPathComponent) { continue }
            try? FileManager.default.removeItem(at: victim.url)
            total -= victim.size
        }
    }

    func clear() {
        lock.lock()
        let tasks = inflight.values
        let keep = protectedIds.map(safe)
        lock.unlock()
        for t in tasks { t.cancel() }
        for f in files() where !keep.contains(f.url.deletingPathExtension().lastPathComponent) {
            try? FileManager.default.removeItem(at: f.url)
        }
    }
}
