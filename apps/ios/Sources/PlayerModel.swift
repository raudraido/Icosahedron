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
    var client: SubsonicClient?
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
    /// A track the user asked to play next; wins over shuffle for the very next step.
    @ObservationIgnored private var nextOverrideId: String?
    @ObservationIgnored private var artworkTask: Task<Void, Never>?
    @ObservationIgnored private var artworkFor: String?
    @ObservationIgnored private var artwork: MPMediaItemArtwork?

    var current: Track? { queue.indices.contains(index) ? queue[index] : nil }

    init() {
        configureSession()
        configureRemoteCommands()
        player.actionAtItemEnd = .advance
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
            self?.tick(time)
        }
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

    func resume() {
        guard current != nil else { return }
        // Nothing loaded any more (the queue ran out): start the current track again.
        if playingItem == nil { load(); return }
        player.play()
        isPlaying = true
        updateNowPlaying()
        onChange?()
    }

    func pause() {
        player.pause()
        isPlaying = false
        updateNowPlaying()
        onChange?()
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
        // The periodic clock keeps reporting the old time until the seek has finished; ignore it
        // meanwhile, otherwise the progress bar jumps back for a moment.
        seeking = true
        player.seek(to: CMTime(seconds: t, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            DispatchQueue.main.async { self?.seeking = false }
        }
        position = t
        updateNowPlaying()
        onChange?()
    }

    // MARK: Queue editing

    /// Plays `track` right after the current one (starts it if nothing is playing).
    func playNext(_ track: Track) {
        guard current != nil else { play([track], at: 0); return }
        queue.insert(track, at: index + 1)
        nextOverrideId = track.id
        preloadNext()
        onChange?()
    }

    func addToQueue(_ track: Track) {
        guard current != nil else { play([track], at: 0); return }
        queue.append(track)
        preloadNext() // it may have become the next one (end of queue with repeat)
        onChange?()
    }

    func moveInQueue(from source: IndexSet, to destination: Int) {
        var order = Array(queue.indices)
        order.move(fromOffsets: source, toOffset: destination)
        queue.move(fromOffsets: source, toOffset: destination)
        if let newIndex = order.firstIndex(of: index) { index = newIndex }
        preloadNext()
        onChange?()
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
        onChange?()
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

    // MARK: Totals (for the "1 of N" / remaining-time header)

    var queueTotal: Double { queue.reduce(0) { $0 + Double($1.duration) } }

    var queueRemaining: Double {
        guard index >= 0, index < queue.count else { return 0 }
        let after = queue[(index + 1)...].reduce(0) { $0 + Double($1.duration) }
        return max(0, duration - position) + after
    }

    func toggleShuffle() {
        shuffle.toggle()
        preloadNext() // the track queued behind the current one may no longer be the right one
    }

    func toggleRepeat() {
        repeatAll.toggle()
        preloadNext()
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
    }

    // MARK: Internals

    private func load(startPaused: Bool = false, startAt: Double = 0) {
        guard let t = current, let client else { return }
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
        let id = t.id
        if t.directURL == nil { Task { try? await client.scrobble(id, submission: false) } } // "now playing"
        preloadNext()
        onChange?()
    }

    /// A stream item with exact duration and timing. Without it AVPlayer *estimates* the
    /// position of a seek from the byte offset (wrong for VBR MP3 and files without a seek
    /// table): it then reports the requested time while the audio comes from somewhere else,
    /// so the real end of the track arrives at a different time than the progress bar says.
    private func makeItem(_ t: Track, client: SubsonicClient) -> AVPlayerItem {
        if let direct = t.directURL { return AVPlayerItem(url: direct) } // radio: live, no timeline
        let asset = AVURLAsset(url: client.streamURL(t.id), options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        return AVPlayerItem(asset: asset)
    }

    /// The index that follows the current one under shuffle/repeat, or nil at the end of the queue.
    private func nextIndex() -> Int? {
        guard !queue.isEmpty, index >= 0 else { return nil }
        if let id = nextOverrideId, let i = queue.firstIndex(where: { $0.id == id }), i != index { return i }
        if shuffle, queue.count > 1 {
            var n = Int.random(in: 0..<queue.count)
            while n == index { n = Int.random(in: 0..<queue.count) }
            return n
        }
        if index + 1 < queue.count { return index + 1 }
        return repeatAll ? 0 : nil
    }

    /// Puts the next track behind the current one so it is already loaded when this one ends.
    private func preloadNext() {
        if let q = queuedNext {
            player.remove(q.item)
            queuedNext = nil
        }
        guard let client, playingItem != nil, let idx = nextIndex() else { return }
        let item = makeItem(queue[idx], client: client)
        player.insert(item, after: player.items().last)
        queuedNext = (item, idx)
    }

    /// The player moved to another item (or ran out). With our queued next item that is the
    /// seamless gapless step — catch the model up: index, scrobbles, lock screen.
    private func currentItemChanged() {
        let cur = player.currentItem
        if cur === playingItem { return } // our own load(), or nothing changed
        if let q = queuedNext, cur === q.item {
            if let t = current, t.directURL == nil, let client {
                let id = t.id
                Task { try? await client.scrobble(id, submission: true) } // the previous track played out
            }
            queuedNext = nil
            index = q.index
            if nextOverrideId == queue[q.index].id { nextOverrideId = nil }
            playingItem = q.item
            position = 0
            duration = Double(current?.duration ?? 0)
            isPlaying = true
            updateNowPlaying(reloadArtwork: true)
            if let t = current, t.directURL == nil, let client {
                let id = t.id
                Task { try? await client.scrobble(id, submission: false) }
            }
            preloadNext()
            onChange?()
        } else if cur == nil, playingItem != nil {
            // Possibly the end of the queue — but the player can also be empty for a moment
            // while it hops between items, so look again shortly before concluding that.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.endOfQueueIfReally() }
        }
    }

    private func endOfQueueIfReally() {
        guard player.currentItem == nil, player.items().isEmpty, playingItem != nil else { return }
        if let t = current, t.directURL == nil, let client {
            let id = t.id
            Task { try? await client.scrobble(id, submission: true) }
        }
        playingItem = nil
        queuedNext = nil
        isPlaying = false
        position = 0
        updateNowPlaying()
        onChange?()
    }

    private func tick(_ time: CMTime) {
        let s = time.seconds
        if s.isFinite, !seeking { position = s }
        if let d = player.currentItem?.duration.seconds, d.isFinite, d > 0 { duration = d }
        // Pick up pauses/resumes that happened outside the app's own buttons.
        let playing = player.timeControlStatus != .paused
        if playing != isPlaying, current != nil {
            isPlaying = playing
            updateNowPlaying()
            onChange?()
        }
    }

    // MARK: Lock screen & audio session

    private func configureSession() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default)
        try? s.setActive(true)
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
            guard let self,
                  let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began {
                self.isPlaying = false
                self.onChange?()
            } else if let o = n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt,
                      AVAudioSession.InterruptionOptions(rawValue: o).contains(.shouldResume) {
                self.resume()
            }
        }
    }

    private func configureRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in self?.resume(); return .success }
        c.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in self?.toggle(); return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in self?.next(); return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in self?.previous(); return .success }
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
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
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
