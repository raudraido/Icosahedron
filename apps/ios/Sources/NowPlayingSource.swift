import Foundation

/// What the player screen shows and controls: this phone's own player, or the other device chosen
/// as the target (docs/connect.md). Reads are live (it is built on every render); actions go to
/// the local player or are sent to the target as remote commands.
@MainActor
struct NowPlayingSource {
    let app: AppModel

    private var sync: SyncModel { app.sync }
    private var player: PlayerModel { app.player }

    /// The device the controls act on; nil = this phone.
    var target: String? { sync.remoteTarget }
    var isRemote: Bool { target != nil }
    var targetName: String? { sync.devices.first(where: { $0.id == target })?.name }

    /// The engine only publishes the active device's state, so the target's track and queue are
    /// known only while the target is the active one; otherwise nothing plays there.
    private var targetIsActive: Bool { target != nil && sync.activeDeviceId == target }

    var current: Track? { isRemote ? (targetIsActive ? sync.remoteTrack : nil) : player.current }
    var queue: [Track] { isRemote ? (targetIsActive ? sync.remoteQueue : []) : player.queue }
    var index: Int { isRemote ? (targetIsActive ? sync.remoteIndex : -1) : player.index }
    var isPlaying: Bool { isRemote ? (targetIsActive && sync.remotePlaying) : player.isPlaying }
    var shuffle: Bool { isRemote ? sync.remoteShuffle : player.shuffle }
    var repeatOn: Bool { isRemote ? sync.remoteRepeat : player.repeatAll }
    var duration: Double { isRemote ? Double(current?.duration ?? 0) : player.duration }

    /// Seconds into the track. For another device this moves on locally between its state messages.
    func position(at date: Date = Date()) -> Double {
        isRemote ? sync.remotePosition(at: date) : player.position
    }

    var queueTotal: Double { queue.reduce(0) { $0 + Double($1.duration) } }

    func queueRemaining(at date: Date = Date()) -> Double {
        guard index >= 0, index < queue.count else { return 0 }
        let after = queue[(index + 1)...].reduce(0) { $0 + Double($1.duration) }
        return max(0, duration - position(at: date)) + after
    }

    // MARK: Actions

    func toggle() { if let t = target { sync.command(to: t, "toggle") } else { player.toggle() } }
    func next() { if let t = target { sync.command(to: t, "next") } else { player.next() } }
    func previous() { if let t = target { sync.command(to: t, "prev") } else { player.previous() } }
    func seek(to seconds: Double) { if let t = target { sync.seek(on: t, to: seconds) } else { player.seek(to: seconds) } }
    func toggleShuffle() { if let t = target { sync.shuffle(on: t, !sync.remoteShuffle) } else { player.toggleShuffle() } }
    func toggleRepeat() { if let t = target { sync.repeatMode(on: t, !sync.remoteRepeat) } else { player.toggleRepeat() } }
    func jump(to i: Int) { if let t = target { sync.jump(on: t, to: i) } else { player.play(player.queue, at: i) } }
    func remove(at i: Int) { if let t = target { sync.remove(on: t, at: i) } else { player.removeFromQueue(at: i) } }

    /// `destination` is SwiftUI's `onMove` offset (before the item is taken out).
    func move(from source: IndexSet, to destination: Int) {
        guard let t = target else { player.moveInQueue(from: source, to: destination); return }
        guard let from = source.first else { return }
        sync.move(on: t, from: from, to: destination > from ? destination - 1 : destination)
    }
}

extension AppModel {
    var nowPlaying: NowPlayingSource { NowPlayingSource(app: self) }
}
