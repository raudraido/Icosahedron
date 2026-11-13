import AVFoundation
import Combine
import MediaPlayer
import Observation
import UIKit

/// Audio playback: AVPlayer with background audio, lock-screen / Control Center
/// integration (Now Playing + remote commands), queue, shuffle/repeat, scrobbling.
@Observable
final class PlayerModel {
    var queue: [Track] = []
    var index: Int = -1
    var isPlaying = false
    var position: Double = 0
    var duration: Double = 0
    var shuffle = false
    var repeatAll = false
    /// Playback speed (1 = normal) and whether the pitch is kept when it changes.
    var speed: Double = UserDefaults.standard.object(forKey: "playbackSpeed") as? Double ?? 1.0
    var keepPitch: Bool = UserDefaults.standard.object(forKey: "keepPitch") as? Bool ?? true
    var client: SubsonicClient?
    /// Connection type, set by AppModel: decides the streaming quality and whether the cache may download.
    @ObservationIgnored var net: NetworkMonitor?
    /// A track started ("now playing") / was played long enough to count (scrobble). Set by AppModel.
    @ObservationIgnored var onNowPlaying: ((Track) -> Void)?
    @ObservationIgnored var onScrobble: ((Track, Date) -> Void)?
    @ObservationIgnored private var scrobbledKey: String?
    @ObservationIgnored private var trackStartedAt = Date()
    /// What the current track is played as, e.g. "FLAC 889 kbps" or "MP3 192 kbps · transcoded".
    var qualityLabel = ""
    /// Fired when the queue, the current track or the play state changes (sync publishes from it).
    @ObservationIgnored var onChange: (() -> Void)?

    // AVQueuePlayer keeps the next track loaded behind the current one, which is what
    // makes track changes gapless: the queued item starts the instant the current ends.
    @ObservationIgnored private let player = AVQueuePlayer()
    @ObservationIgnored private var playingItem: AVPlayerItem?
    @ObservationIgnored private var queuedNext: (item: AVPlayerItem, index: Int)?
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var itemObserver: AnyCancellable?
    @ObservationIgnored private var seeking = false
    @ObservationIgnored private let cache = AudioCache.shared
    /// True when the current item plays from a cached local file (exact timing) rather than a stream.
    @ObservationIgnored private var playingLocal = false
    @ObservationIgnored private var handlingFailure = false
    /// A track the user asked to play next; wins over shuffle for the very next step.
    @ObservationIgnored private var nextOverrideId: String?
    @ObservationIgnored private var artworkTask: Task<Void, Never>?
    @ObservationIgnored private var artworkFor: String?
    @ObservationIgnored private var artwork: MPMediaItemArtwork?

    var current: Track? { queue.indices.contains(index) ? queue[index] : nil }

    // MARK: Remembering the queue
    // What was playing is kept on disk, so that a "play" from the car, a headset or the lock screen
    // still has something to play after iOS has closed the app: iOS then starts the app again for that
    // command, and an app with nothing to play looks dead to it (it tries another music app).

    /// Asked for "play" with nothing loaded: set by AppModel, which signs in and restores the saved queue first.
    @ObservationIgnored var onPlayWithoutQueue: (() -> Void)?
    @ObservationIgnored private var saveWork: DispatchWorkItem?
    @ObservationIgnored private var lastPositionSave = Date.distantPast

    private struct SavedSession: Codable {
        var queue: [Track]
        var index: Int
        var position: Double
    }

    private static var sessionURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("playback-session.json")
    }

    /// Every change to the queue, the track or the play state: told to sync, and kept on disk a moment later.
    private func changed() {
        onChange?()
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveSession() }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }

    private func saveSession() {
        guard current != nil else { return }
        lastPositionSave = Date()
        let session = SavedSession(queue: queue, index: index, position: position)
        let url = Self.sessionURL
        DispatchQueue.global(qos: .utility).async {
            if let data = try? JSONEncoder().encode(session) { try? data.write(to: url, options: .atomic) }
        }
    }

    private func forgetSession() {
        saveWork?.cancel()
        try? FileManager.default.removeItem(at: Self.sessionURL)
    }

    /// Puts the last queue back, paused where it was (or playing: a "play" command started the app).
    func restoreLastSession(play: Bool) {
        guard queue.isEmpty else { if play { resume() }; return }
        guard client != nil,
              let data = try? Data(contentsOf: Self.sessionURL),
              let saved = try? JSONDecoder().decode(SavedSession.self, from: data),
              saved.queue.indices.contains(saved.index) else { return }
        queue = saved.queue
        index = saved.index
        nextOverrideId = nil
        load(startPaused: true, startAt: saved.position, silent: true)
        if play { resume() }
    }

    init() {
        configureSession()
        configureRemoteCommands()
        player.actionAtItemEnd = .advance
        player.defaultRate = Float(speed)
        cache.onCached = { [weak self] id in self?.trackCached(id) }
        // Switching the EQ on mid-track: the items already in the queue get it too.
        EQManager.shared.onEnabled = { [weak self] in
            guard let self else { return }
            for item in self.player.items() { EQManager.shared.attach(to: item) }
        }
        installTimeObserver(seconds: 0.5)
        // The player is the source of truth for which track is playing: when its current item
        // becomes the one we queued behind the old one (gapless), or empties (queue ran out),
        // the model catches up. Comparing against our own state (not flags) keeps this
        // race-free with our own load()/stop().
        itemObserver = player.publisher(for: \.currentItem)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.currentItemChanged() }
    }

    // MARK: Transport

    func play(_ tracks: [Track], at i: Int, startPaused: Bool = false, startAt: Double = 0) {
        guard tracks.indices.contains(i) else { return }
        queue = tracks
        index = i
        nextOverrideId = nil
        load(startPaused: startPaused, startAt: startAt)
    }

    /// The progress clock runs twice a second with the app on screen and every 5 s otherwise (a locked phone does not need
    /// the progress bar moving; the lock screen extrapolates the time itself).
    func setAppActive(_ active: Bool) {
        let want = active ? 0.5 : 5.0
        guard want != timeObserverInterval else { return }
        installTimeObserver(seconds: want)
    }

    @ObservationIgnored private var timeObserverInterval = 0.0
    private func installTimeObserver(seconds: Double) {
        if let o = timeObserver { player.removeTimeObserver(o) }
        timeObserverInterval = seconds
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: seconds, preferredTimescale: 600), queue: .main) { [weak self] time in
            self?.tick(time)
        }
    }

    func resume() {
        guard current != nil else { return }
        activateSession()
        // Nothing loaded any more (the queue ran out): start the current track again.
        if playingItem == nil { load(); return }
        player.play()
        isPlaying = true
        updateNowPlaying()
        // A restored queue was loaded paused without fetching anything: playing it starts the fetching
        preloadNext()
        cacheCurrentSoon()
        changed()
    }

    func pause() {
        player.pause()
        isPlaying = false
        updateNowPlaying()
        changed()
    }

    func toggle() { isPlaying ? pause() : resume() }

    func next() {
        guard !queue.isEmpty else { return }
        guard let i = nextIndex() else {
            pause()
            seek(to: 0)
            return
        }
        if nextOverrideId == queue[i].id { nextOverrideId = nil }
        index = i
        load()
    }

    func previous() {
        guard !queue.isEmpty else { return }
        if position > 3 || index == 0 {
            seek(to: 0)
        } else {
            index -= 1
            load()
        }
    }

    func seek(to seconds: Double) {
        let t = max(0, seconds)
        if let cur = current, cur.directURL == nil, !playingLocal, cache.localURL(for: cur) != nil {
            load(startPaused: !isPlaying, startAt: t, silent: true) // now from the exact local copy
            return
        }
        // The periodic clock keeps reporting the old time until the seek has finished; ignore it
        // meanwhile, otherwise the progress bar jumps back for a moment.
        seeking = true
        // Exact only for a local file; on a stream an exact seek makes AVPlayer read far ahead to find the spot
        let tol = playingLocal ? CMTime.zero : CMTime(seconds: 1, preferredTimescale: 600)
        player.seek(to: CMTime(seconds: t, preferredTimescale: 600), toleranceBefore: tol, toleranceAfter: tol) { [weak self] _ in
            DispatchQueue.main.async { self?.seeking = false }
        }
        position = t
        updateNowPlaying()
        changed()
    }

    // MARK: Queue editing

    /// Plays `track` right after the current one (starts it if nothing is playing).
    func playNext(_ track: Track) {
        guard current != nil else { play([track], at: 0); return }
        queue.insert(track, at: index + 1)
        nextOverrideId = track.id
        preloadNext()
        changed()
    }

    func addToQueue(_ track: Track) {
        guard current != nil else { play([track], at: 0); return }
        queue.append(track)
        preloadNext() // it may have become the next one (end of queue with repeat)
        changed()
    }

    func moveInQueue(from source: IndexSet, to destination: Int) {
        var order = Array(queue.indices)
        order.move(fromOffsets: source, toOffset: destination)
        queue.move(fromOffsets: source, toOffset: destination)
        if let newIndex = order.firstIndex(of: index) { index = newIndex }
        preloadNext()
        changed()
    }

    func removeFromQueue(at i: Int) {
        guard queue.indices.contains(i) else { return }
        if i == index {
            queue.remove(at: i)
            if queue.isEmpty {
                stop()
            } else {
                index = min(i, queue.count - 1)
                load()
            }
        } else {
            queue.remove(at: i)
            if i < index { index -= 1 }
            preloadNext()
        }
        changed()
    }

    // MARK: Favorites

    /// Flips the favorite state of a track everywhere it appears in the queue, optimistically.
    func toggleFavorite(_ trackId: String) {
        guard let client, let current = queue.first(where: { $0.id == trackId }) else { return }
        let on = !current.starred
        setStarredLocally(trackId, on)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        Task { [weak self] in
            do { try await client.setStarred(trackId, on) } catch { self?.setStarredLocally(trackId, !on) }
        }
    }

    private func setStarredLocally(_ id: String, _ on: Bool) {
        for i in queue.indices where queue[i].id == id { queue[i].starred = on }
    }

    /// Keeps the queue's copies of a track in step when its favorite state / rating changes elsewhere.
    func applyStarred(_ id: String, _ on: Bool) { setStarredLocally(id, on) }

    func applyRating(_ id: String, _ rating: Int) {
        for i in queue.indices where queue[i].id == id { queue[i].userRating = rating }
    }

    func clearQueue() { stop() }

    // MARK: Totals (for the "1 of N" / remaining-time header)

    var queueTotal: Double { queue.reduce(0) { $0 + Double($1.duration) } }

    var queueRemaining: Double {
        guard index >= 0, index < queue.count else { return 0 }
        let after = queue[(index + 1)...].reduce(0) { $0 + Double($1.duration) }
        return max(0, duration - position) + after
    }

    // MARK: Playback speed

    func setSpeed(_ value: Double) {
        speed = value
        UserDefaults.standard.set(value, forKey: "playbackSpeed")
        player.defaultRate = Float(value)
        if isPlaying { player.rate = Float(value) }
        updateNowPlaying()
    }

    func setKeepPitch(_ on: Bool) {
        keepPitch = on
        UserDefaults.standard.set(on, forKey: "keepPitch")
        for item in player.items() { item.audioTimePitchAlgorithm = pitchAlgorithm }
    }

    @ObservationIgnored private var pendingShuffleId: String?

    func toggleShuffle() {
        shuffle.toggle()
        pendingShuffleId = nil
        preloadNext() // the track queued behind the current one may no longer be the right one
        changed()
    }

    func toggleRepeat() {
        repeatAll.toggle()
        preloadNext()
        changed()
    }

    func stop() {
        player.pause()
        player.removeAllItems()
        playingItem = nil
        queuedNext = nil
        queue = []
        index = -1
        isPlaying = false
        position = 0
        duration = 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        forgetSession()
    }

    // MARK: Internals

    private func load(startPaused: Bool = false, startAt: Double = 0, silent: Bool = false) {
        guard let t = current, let client else { return }
        playingLocal = t.directURL == nil && cache.localURL(for: t) != nil
        let item = makeItem(t, client: client)
        player.removeAllItems()
        queuedNext = nil
        playingItem = item
        player.insert(item, after: nil)
        position = startAt
        duration = Double(t.duration)
        if startAt > 0 { player.seek(to: CMTime(seconds: startAt, preferredTimescale: 600)) }
        if startPaused {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
        updateNowPlaying(reloadArtwork: true)
        if t.directURL == nil, !silent {
            scrobbledKey = nil
            trackStartedAt = Date()
            onNowPlaying?(t)
        }
        if !startPaused { activateSession() }
        // Opening the app with the saved queue must not download anything: a paused load fetches only when it is played
        preloadNext(prefetch: !startPaused)
        if !startPaused { cacheCurrentSoon() }
        updateQualityLabel()
        changed()
    }

    /// Streams start at once (no precise-timing scan: that makes AVFoundation read the whole
    /// file before it plays). A cached local file is cheap to scan, so there it is used: seeks
    /// then land exactly where the progress bar says, which AVPlayer only estimates for a
    /// stream of a VBR MP3 or a file without a seek table.
    private func makeItem(_ t: Track, client: SubsonicClient) -> AVPlayerItem {
        let item = makeBaseItem(t, client: client)
        item.audioTimePitchAlgorithm = pitchAlgorithm
        EQManager.shared.attach(to: item)
        return item
    }

    private var pitchAlgorithm: AVAudioTimePitchAlgorithm { keepPitch ? .spectral : .varispeed }

    private func makeBaseItem(_ t: Track, client: SubsonicClient) -> AVPlayerItem {
        if let direct = t.directURL { return AVPlayerItem(url: direct) } // radio: live, no timeline
        if let local = cache.localURL(for: t) {
            cache.touch(t)
            let asset = AVURLAsset(url: local, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
            return AVPlayerItem(asset: asset)
        }
        return AVPlayerItem(url: client.streamURL(t.id, quality: wantedQuality()))
    }

    // MARK: Connection-dependent quality

    func wantedQuality() -> StreamQuality { net?.streamQuality ?? QualitySettings.wifi() }

    private var cachingAllowed: Bool { net?.cachingAllowed ?? true }

    private func updateQualityLabel() {
        guard let t = current else { qualityLabel = ""; return }
        if t.directURL != nil { qualityLabel = String(localized: "Radio"); return }
        if playingLocal, let l = cache.qualityLabel(for: t) { qualityLabel = l + " · " + String(localized: "cached"); return }
        let q = wantedQuality()
        if q.isDirect {
            qualityLabel = [t.format?.uppercased(), t.bitrate.map { "\($0) kbps" }].compactMap { $0 }.joined(separator: " ")
        } else {
            qualityLabel = "\(q.format.uppercased()) \(q.bitrate) kbps · " + String(localized: "transcoded")
        }
    }

    /// The connection changed: the queued next track is re-created with the new profile
    /// (the current one plays on as it is), and kept-offline downloads may continue.
    func networkChanged() {
        if let q = queuedNext { preloadNext(reuseIndex: q.index) }
        resumePins()
    }

    /// Downloads kept-offline tracks that are still missing (Wi-Fi, or cellular if the user allowed it).
    func resumePins() {
        guard let client, cachingAllowed else { return }
        cache.resumePending(client: client, quality: QualitySettings.wifi())
    }

    /// What must stay on disk / keep downloading: the playing track and the queued next one.
    private func protectedIds() -> Set<String> {
        var ids = Set<String>()
        if let t = current { ids.insert(t.id) }
        if let q = queuedNext, queue.indices.contains(q.index) { ids.insert(queue[q.index].id) }
        return ids
    }

    /// The current track is cached too, a few seconds in (a skipped track shouldn't cost a download).
    private func cacheCurrentSoon() {
        guard cachingAllowed, let t = current, let client, t.directURL == nil, cache.localURL(for: t) == nil else { return }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard let self, self.current?.id == t.id else { return }
            guard self.cachingAllowed else { return }
            self.cache.prefetch(t, client: client, quality: self.wantedQuality())
        }
    }

    /// A track finished downloading. If it is the queued next one, swap its stream item for the
    /// local file so the gapless step needs no network.
    private func trackCached(_ id: String) {
        if let q = queuedNext, queue.indices.contains(q.index), queue[q.index].id == id {
            preloadNext(reuseIndex: q.index)
        }
    }

    /// The index that follows the current one under shuffle/repeat, or nil at the end of the queue.
    private func nextIndex() -> Int? {
        guard !queue.isEmpty, index >= 0 else { return nil }
        if let id = nextOverrideId, let i = queue.firstIndex(where: { $0.id == id }), i != index { return i }
        if shuffle, queue.count > 1 {
            // The same pick until it is played: every preload (a queue edit, a switch) would otherwise choose again and
            // throw away the download of the one before
            if let id = pendingShuffleId, let i = queue.firstIndex(where: { $0.id == id }), i != index { return i }
            var n = Int.random(in: 0..<queue.count)
            while n == index { n = Int.random(in: 0..<queue.count) }
            pendingShuffleId = queue[n].id
            return n
        }
        if index + 1 < queue.count { return index + 1 }
        return repeatAll ? 0 : nil
    }

    /// Puts the next track behind the current one so it is already loaded when this one ends.
    private func preloadNext(reuseIndex: Int? = nil, prefetch: Bool = true) {
        if let q = queuedNext {
            player.remove(q.item)
            queuedNext = nil
        }
        guard let client, playingItem != nil, let idx = reuseIndex ?? nextIndex(), queue.indices.contains(idx) else {
            cache.setProtected(protectedIds())
            return
        }
        let item = makeItem(queue[idx], client: client)
        player.insert(item, after: player.items().last)
        queuedNext = (item, idx)
        cache.setProtected(protectedIds())
        if cachingAllowed, prefetch {
            cache.prefetch(queue[idx], client: client, quality: wantedQuality()) // the next track is fetched in full right away
        }
    }

    /// The player moved to another item (or ran out). With our queued next item that is the
    /// seamless gapless step — catch the model up: index, scrobbles, lock screen.
    private func currentItemChanged() {
        let cur = player.currentItem
        if cur === playingItem { return } // our own load(), or nothing changed
        if let q = queuedNext, cur === q.item {
            queuedNext = nil
            index = q.index
            if nextOverrideId == queue[q.index].id { nextOverrideId = nil }
            playingItem = q.item
            position = 0
            duration = Double(current?.duration ?? 0)
            isPlaying = true
            updateNowPlaying(reloadArtwork: true)
            if let t = current, t.directURL == nil {
                scrobbledKey = nil
                trackStartedAt = Date()
                onNowPlaying?(t)
            }
            playingLocal = current.map { $0.directURL == nil && cache.localURL(for: $0) != nil } ?? false
            preloadNext()
            cacheCurrentSoon()
            updateQualityLabel()
            changed()
        } else if cur == nil, playingItem != nil {
            // Possibly the end of the queue — but the player can also be empty for a moment
            // while it hops between items, so look again shortly before concluding that.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.endOfQueueIfReally() }
        }
    }

    private func endOfQueueIfReally() {
        guard player.currentItem == nil, player.items().isEmpty, playingItem != nil else { return }
        playingItem = nil
        queuedNext = nil
        isPlaying = false
        position = 0
        updateNowPlaying()
        changed()
    }

    private func tick(_ time: CMTime) {
        let s = time.seconds
        if s.isFinite, !seeking { position = s }
        scrobbleIfDue()
        if isPlaying, Date().timeIntervalSince(lastPositionSave) > 30 { saveSession() }
        if let d = player.currentItem?.duration.seconds, d.isFinite, d > 0 { duration = d }
        if let item = player.currentItem, item.status == .failed, let cur = current, !handlingFailure {
            handlingFailure = true
            if playingLocal { cache.remove(cur.id) }
            let resumeAt = position
            let wasPlaying = isPlaying
            if playingLocal { load(startPaused: !wasPlaying, startAt: resumeAt, silent: true) } else { isPlaying = false; changed() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.handlingFailure = false }
        }
        // Pick up pauses/resumes that happened outside the app's own buttons.
        let playing = player.timeControlStatus != .paused
        if playing != isPlaying, current != nil {
            isPlaying = playing
            updateNowPlaying()
            changed()
        }
    }

    /// A play counts after half the track or 4 minutes (Last.fm's rule), once per play.
    private func scrobbleIfDue() {
        guard isPlaying, let t = current, t.directURL == nil, t.duration >= 30 else { return }
        let key = "\(t.id)@\(trackStartedAt.timeIntervalSince1970)"
        guard scrobbledKey != key else { return }
        let threshold = min(Double(t.duration) / 2, 240)
        guard position >= threshold else { return }
        scrobbledKey = key
        onScrobble?(t, trackStartedAt)
    }

    // MARK: Lock screen & audio session

    /// Takes the audio session when playback starts.
    private func activateSession() {
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    private func configureSession() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default)
        // Not activated here: opening the app must not silence the music of other apps. activateSession() runs when something plays.
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
            guard let self,
                  let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began {
                self.isPlaying = false
                self.changed()
            } else if let o = n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt,
                      AVAudioSession.InterruptionOptions(rawValue: o).contains(.shouldResume) {
                self.resume()
            }
        }
    }

    private func remotePlay() { if current == nil { onPlayWithoutQueue?() } else { resume() } }
    private func remoteToggle() { if current == nil { onPlayWithoutQueue?() } else { toggle() } }

    private func configureRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in self?.remotePlay(); return .success }
        c.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in self?.remoteToggle(); return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in self?.next(); return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in self?.previous(); return .success }
        c.changePlaybackRateCommand.supportedPlaybackRates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
        c.changePlaybackRateCommand.addTarget { [weak self] event in
            if let e = event as? MPChangePlaybackRateCommandEvent { self?.setSpeed(Double(e.playbackRate)) }
            return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] event in
            if let e = event as? MPChangePlaybackPositionCommandEvent { self?.seek(to: e.positionTime) }
            return .success
        }
    }

    private func updateNowPlaying(reloadArtwork: Bool = false) {
        guard let t = current else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: t.title,
            MPMediaItemPropertyArtist: t.artist,
            MPMediaItemPropertyAlbumTitle: t.album ?? "",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? speed : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: speed,
        ]
        // Keep the previous cover until the new one has loaded, rather than flashing an empty one at every track change.
        if let art = artwork { info[MPMediaItemPropertyArtwork] = art }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
        if reloadArtwork || artworkFor != t.id { loadArtwork(for: t) }
    }

    private func loadArtwork(for t: Track) {
        artworkTask?.cancel()
        guard let url = client?.coverURL(t.coverArt, size: 600) else { return }
        let id = t.id
        artworkTask = Task { [weak self] in
            guard let (data, _) = try? await URLSession.shared.data(from: url),
                  let image = UIImage(data: data), !Task.isCancelled else { return }
            await MainActor.run {
                guard let self, self.current?.id == id else { return }
                self.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.artworkFor = id
                self.updateNowPlaying()
            }
        }
    }
}
