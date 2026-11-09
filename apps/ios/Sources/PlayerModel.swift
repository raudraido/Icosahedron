import AVFoundation
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

    @ObservationIgnored private let player = AVPlayer()
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var artworkTask: Task<Void, Never>?
    @ObservationIgnored private var artworkFor: String?
    @ObservationIgnored private var artwork: MPMediaItemArtwork?

    var current: Track? { queue.indices.contains(index) ? queue[index] : nil }

    init() {
        configureSession()
        configureRemoteCommands()
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
            self?.tick(time)
        }
    }

    // MARK: Transport

    func play(_ tracks: [Track], at i: Int, startPaused: Bool = false, startAt: Double = 0) {
        guard tracks.indices.contains(i) else { return }
        queue = tracks
        index = i
        load(startPaused: startPaused, startAt: startAt)
    }

    func resume() {
        guard current != nil else { return }
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
        if shuffle, queue.count > 1 {
            var n = Int.random(in: 0..<queue.count)
            while n == index { n = Int.random(in: 0..<queue.count) }
            index = n
        } else if index + 1 < queue.count {
            index += 1
        } else if repeatAll {
            index = 0
        } else {
            pause()
            seek(to: 0)
            return
        }
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
        player.seek(to: CMTime(seconds: t, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        position = t
        updateNowPlaying()
        onChange?()
    }

    func stop() {
        player.pause()
        player.replaceCurrentItem(with: nil)
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
        let item = AVPlayerItem(url: client.streamURL(t.id))
        if let e = endObserver { NotificationCenter.default.removeObserver(e) }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            self?.trackEnded()
        }
        player.replaceCurrentItem(with: item)
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
        Task { try? await client.scrobble(id, submission: false) } // "now playing"
        onChange?()
    }

    private func trackEnded() {
        if let t = current, let client {
            Task { try? await client.scrobble(t.id, submission: true) }
        }
        next()
    }

    private func tick(_ time: CMTime) {
        let s = time.seconds
        if s.isFinite { position = s }
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
        if let art = artwork, artworkFor == t.id { info[MPMediaItemPropertyArtwork] = art }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
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
