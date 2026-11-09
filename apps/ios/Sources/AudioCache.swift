import Foundation

/// Audio kept on the phone. Two kinds of files share one index:
///  - the automatic cache (Caches folder, limited by the user's size setting, oldest evicted first):
///    the next track is fetched in full ahead of time, the current one a few seconds in;
///  - "kept offline" tracks (Application Support, never evicted, survive iOS cleaning Caches).
/// The index remembers which track each file is and in which quality, so the library can list it
/// (also without a connection).
final class AudioCache: @unchecked Sendable {
    static let shared = AudioCache()

    /// UserDefaults key of the automatic cache's size limit in MB: 0 = off, -1 = unlimited.
    static let limitKey = "cacheLimitMB"

    struct Entry: Codable, Identifiable {
        var track: Track
        var file: String?       // nil while a kept-offline track is still waiting to download
        var quality: String     // StreamQuality.storageKey of the stored file
        var rank: Int
        var size: Int64
        var cachedAt: Date
        var lastUsed: Date
        var pinned: Bool
        var id: String { track.id }
    }

    private let autoDir: URL
    private let pinDir: URL
    private let indexURL: URL
    private let lock = NSLock()
    private var index: [String: Entry] = [:]
    private var inflight: [String: Task<Void, Never>] = [:]
    private var protectedIds: Set<String> = []

    /// Main-actor callbacks: something in the cache changed / a track finished downloading.
    var onChanged: (@MainActor () -> Void)?
    var onCached: (@MainActor (String) -> Void)?

    init() {
        let fm = FileManager.default
        let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        autoDir = caches.appendingPathComponent("AudioCache", isDirectory: true)
        pinDir = support.appendingPathComponent("Offline", isDirectory: true)
        indexURL = support.appendingPathComponent("cache-index.json")
        try? fm.createDirectory(at: autoDir, withIntermediateDirectories: true)
        try? fm.createDirectory(at: pinDir, withIntermediateDirectories: true)
        var pinURL = pinDir
        var values = URLResourceValues()
        values.isExcludedFromBackup = true // downloads are not worth iCloud backup space
        try? pinURL.setResourceValues(values)
        loadIndex()
    }

    var limitBytes: Int64 {
        let mb = UserDefaults.standard.object(forKey: Self.limitKey) as? Int ?? 2048
        if mb < 0 { return Int64.max }
        return Int64(mb) * 1_048_576
    }

    // MARK: Lookup

    private func safe(_ id: String) -> String {
        String(id.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" })
    }

    private func url(for e: Entry) -> URL? {
        guard let f = e.file else { return nil }
        return (e.pinned ? pinDir : autoDir).appendingPathComponent(f)
    }

    /// The local file of a track, if there is one (whatever its quality: playing it costs no data).
    func localURL(for t: Track) -> URL? {
        lock.lock(); defer { lock.unlock() }
        guard let e = index[t.id], let u = url(for: e), FileManager.default.fileExists(atPath: u.path) else { return nil }
        return u
    }

    func isPinned(_ id: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return index[id]?.pinned ?? false
    }

    /// "FLAC 889 kbps" / "MP3 192 kbps" for the stored file.
    func qualityLabel(for t: Track) -> String? {
        lock.lock(); defer { lock.unlock() }
        guard let e = index[t.id], e.file != nil else { return nil }
        if e.quality == "raw" {
            return [t.format?.uppercased(), t.bitrate.map { "\($0) kbps" }].compactMap { $0 }.joined(separator: " ")
        }
        return StreamQuality(key: e.quality).map { "\($0.format.uppercased()) \($0.bitrate) kbps" }
    }

    func entries() -> [Entry] {
        lock.lock(); defer { lock.unlock() }
        return index.values.sorted { $0.cachedAt > $1.cachedAt }
    }

    func sizes() -> (auto: Int64, pinned: Int64) {
        lock.lock(); defer { lock.unlock() }
        var a: Int64 = 0, p: Int64 = 0
        for e in index.values where e.file != nil { if e.pinned { p += e.size } else { a += e.size } }
        return (a, p)
    }

    func touch(_ t: Track) {
        lock.lock()
        index[t.id]?.lastUsed = Date()
        lock.unlock()
    }

    // MARK: Downloading

    /// Fetches a track into the automatic cache (or, if it is kept offline, into the offline
    /// folder), unless a file of at least that quality is already there.
    func prefetch(_ t: Track, client: SubsonicClient, quality: StreamQuality) {
        lock.lock()
        let existing = index[t.id]
        let pinned = existing?.pinned ?? false
        let haveBetter = existing?.file != nil && (existing?.rank ?? 0) >= quality.rank
        let busy = inflight[t.id] != nil
        lock.unlock()
        guard t.directURL == nil, !haveBetter, !busy, pinned || limitBytes > 0 else { return }
        lock.lock()
        inflight[t.id] = Task.detached(priority: .utility) { [weak self] in
            await self?.download(t, client: client, quality: quality)
        }
        lock.unlock()
    }

    private func download(_ t: Track, client: SubsonicClient, quality: StreamQuality) async {
        defer {
            lock.lock(); inflight[t.id] = nil; lock.unlock()
        }
        do {
            let (tmp, response) = try await URLSession.shared.download(from: client.streamURL(t.id, quality: quality))
            guard (response as? HTTPURLResponse)?.statusCode == 200, !Task.isCancelled else {
                try? FileManager.default.removeItem(at: tmp)
                return
            }
            let ext = quality.fileExtension ?? ((t.format?.isEmpty == false) ? t.format! : "mp3")
            let name = "\(safe(t.id))~\(quality.storageKey).\(ext)"
            let size = (try? FileManager.default.attributesOfItem(atPath: tmp.path)[.size] as? Int64) ?? 0

            lock.lock()
            var entry = index[t.id] ?? Entry(track: t, file: nil, quality: quality.storageKey, rank: 0, size: 0,
                                             cachedAt: Date(), lastUsed: Date(), pinned: false)
            let dir = entry.pinned ? pinDir : autoDir
            if let old = url(for: entry) { try? FileManager.default.removeItem(at: old) }
            let dest = dir.appendingPathComponent(name)
            try? FileManager.default.removeItem(at: dest)
            do { try FileManager.default.moveItem(at: tmp, to: dest) } catch { lock.unlock(); return }
            entry.track = t
            entry.file = name
            entry.quality = quality.storageKey
            entry.rank = quality.rank
            entry.size = size
            entry.cachedAt = Date()
            entry.lastUsed = Date()
            index[t.id] = entry
            saveIndexLocked()
            lock.unlock()

            enforceLimit()
            let id = t.id
            let cached = onCached, changed = onChanged
            await MainActor.run { cached?(id); changed?() }
        } catch {
            // Cancelled or offline: the stream keeps working, nothing to clean up.
        }
    }

    /// Stops downloads of tracks that are no longer coming up (kept-offline ones continue).
    func cancel(except keep: Set<String>) {
        lock.lock()
        let stale = inflight.filter { !keep.contains($0.key) && !(index[$0.key]?.pinned ?? false) }
        lock.unlock()
        for (_, task) in stale { task.cancel() }
    }

    /// Tracks that must not be evicted or cancelled (current and next).
    func setProtected(_ ids: Set<String>) {
        lock.lock(); protectedIds = ids; lock.unlock()
        cancel(except: ids)
    }

    // MARK: Keep offline

    /// Marks tracks as kept offline: their files move to the offline folder (or get downloaded there).
    func pin(_ tracks: [Track]) {
        lock.lock()
        for t in tracks where t.directURL == nil {
            var e = index[t.id] ?? Entry(track: t, file: nil, quality: "raw", rank: 0, size: 0,
                                         cachedAt: Date(), lastUsed: Date(), pinned: false)
            if !e.pinned, let from = url(for: e) {
                let to = pinDir.appendingPathComponent(e.file!)
                try? FileManager.default.removeItem(at: to)
                if (try? FileManager.default.moveItem(at: from, to: to)) == nil { e.file = nil }
            }
            e.pinned = true
            index[t.id] = e
        }
        saveIndexLocked()
        lock.unlock()
        notifyChanged()
    }

    func unpin(_ ids: [String]) {
        lock.lock()
        for id in ids {
            guard var e = index[id], e.pinned else { continue }
            if let from = url(for: e), let f = e.file {
                let to = autoDir.appendingPathComponent(f)
                try? FileManager.default.removeItem(at: to)
                if (try? FileManager.default.moveItem(at: from, to: to)) == nil { e.file = nil }
            }
            e.pinned = false
            if e.file == nil { index[id] = nil } else { index[id] = e }
        }
        saveIndexLocked()
        lock.unlock()
        enforceLimit()
        notifyChanged()
    }

    /// Downloads kept-offline tracks that are still missing.
    func resumePending(client: SubsonicClient, quality: StreamQuality) {
        lock.lock()
        let pending = index.values.filter { $0.pinned && $0.file == nil }.map { $0.track }
        lock.unlock()
        for t in pending { prefetch(t, client: client, quality: quality) }
    }

    func remove(_ id: String) {
        lock.lock()
        inflight[id]?.cancel()
        if let e = index[id], let u = url(for: e) { try? FileManager.default.removeItem(at: u) }
        index[id] = nil
        saveIndexLocked()
        lock.unlock()
        notifyChanged()
    }

    // MARK: Size management

    /// Deletes the least recently used automatic-cache files until the limit is met.
    func enforceLimit() {
        lock.lock()
        let limit = limitBytes
        let keep = protectedIds
        var total = index.values.filter { !$0.pinned && $0.file != nil }.reduce(Int64(0)) { $0 + $1.size }
        let victims = index.values.filter { !$0.pinned && $0.file != nil && !keep.contains($0.track.id) }.sorted { $0.lastUsed < $1.lastUsed }
        var changed = false
        for e in victims where total > limit {
            if let u = url(for: e) { try? FileManager.default.removeItem(at: u) }
            index[e.track.id] = nil
            total -= e.size
            changed = true
        }
        if changed { saveIndexLocked() }
        lock.unlock()
        if changed { notifyChanged() }
    }

    /// Clears the automatic cache (kept-offline tracks stay).
    func clear() {
        lock.lock()
        let keep = protectedIds
        for e in index.values where !e.pinned && !keep.contains(e.track.id) {
            inflight[e.track.id]?.cancel()
            if let u = url(for: e) { try? FileManager.default.removeItem(at: u) }
            index[e.track.id] = nil
        }
        saveIndexLocked()
        lock.unlock()
        notifyChanged()
    }

    // MARK: Index

    private func notifyChanged() {
        let changed = onChanged
        Task { @MainActor in changed?() }
    }

    private func loadIndex() {
        if let data = try? Data(contentsOf: indexURL),
           let decoded = try? JSONDecoder().decode([String: Entry].self, from: data) {
            index = decoded
        }
        // Forget entries whose file has gone (iOS may clean the Caches folder).
        for (id, e) in index {
            guard let u = url(for: e) else { continue }
            if !FileManager.default.fileExists(atPath: u.path) {
                if e.pinned { index[id]?.file = nil } else { index[id] = nil }
            }
        }
        // Files from before the index existed ("<id>.<ext>"): adopt them; their metadata is filled in later.
        let known = Set(index.values.compactMap { $0.file })
        let files = (try? FileManager.default.contentsOfDirectory(at: autoDir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])) ?? []
        for f in files where !known.contains(f.lastPathComponent) {
            let base = f.deletingPathExtension().lastPathComponent
            let id = base.split(separator: "~").first.map(String.init) ?? base
            guard let t = Track(subsonic: ["id": id]) else { continue }
            let v = try? f.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            let date = v?.contentModificationDate ?? Date()
            index[id] = Entry(track: t, file: f.lastPathComponent, quality: "raw", rank: StreamQuality.direct.rank,
                              size: Int64(v?.fileSize ?? 0), cachedAt: date, lastUsed: date, pinned: false)
        }
        saveIndexLocked()
    }

    private func saveIndexLocked() {
        if let data = try? JSONEncoder().encode(index) { try? data.write(to: indexURL, options: .atomic) }
    }

    /// Looks up the title/artist of entries that were adopted without metadata.
    func fillMissingMetadata(client: SubsonicClient) async {
        lock.lock()
        let ids = index.values.filter { $0.track.title.isEmpty }.map { $0.track.id }
        lock.unlock()
        guard !ids.isEmpty else { return }
        for id in ids.prefix(300) {
            guard let t = try? await client.song(id) else { continue }
            lock.lock()
            if index[id] != nil { index[id]?.track = t }
            lock.unlock()
        }
        lock.lock(); saveIndexLocked(); lock.unlock()
        notifyChanged()
    }
}
