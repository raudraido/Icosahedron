import Foundation
import Observation
import UIKit

/// Link to the Icosahedron web engine's sync hub (`/sync`): shows the user's other
/// devices, publishes what this phone plays, and takes remote-control commands.
/// Same JSON protocol as the web and desktop apps (see apps/server/src/hub.mjs).
@Observable
final class SyncModel {
    struct Device: Identifiable, Hashable {
        let id: String
        let name: String
        let kind: String
    }

    /// A player in the engine's registry (online or not).
    struct RegistryDevice: Identifiable, Hashable {
        let id: String
        let name: String
        let kind: String
        let online: Bool
        let lastSeen: Date
    }

    /// What this phone keeps in sync (Settings > Sync Server). Stored on the phone, on by default;
    /// views bind to the same keys with @AppStorage.
    enum Switch: String {
        case playback = "syncPlayback", equalizer = "syncEqualizer", lyrics = "syncLyrics"
        var isOn: Bool { UserDefaults.standard.object(forKey: rawValue) as? Bool ?? true }
    }

    var status = "off" // off | connecting | online
    /// The device the playback controls act on; nil = this phone. Chosen in the device lists
    /// (docs/connect.md). Falls back to this phone when that device goes offline.
    private(set) var targetId: String?
    /// The other device being controlled, or nil when the controls act on this phone.
    var remoteTarget: String? {
        guard let t = targetId, t != deviceId else { return nil }
        return t
    }
    /// This phone's name as the engine knows it (renamable in Settings > Sync Server).
    var name: String?
    var registry: [RegistryDevice] = []
    var devices: [Device] = []
    var activeDeviceId: String?
    /// The active device's track and state, for the "playing on …" display.
    var remoteTrack: Track?
    var remotePlaying = false
    /// The active device's position when its state arrived. Not observed: views that show it
    /// tick on their own timer instead of re-rendering on every state message.
    @ObservationIgnored private(set) var remotePositionMs: Double = 0
    @ObservationIgnored private(set) var remoteStamp = Date()

    let deviceId: String
    @ObservationIgnored private var task: URLSessionWebSocketTask?
    @ObservationIgnored private var client: SubsonicClient?
    @ObservationIgnored private weak var player: PlayerModel?
    @ObservationIgnored private var wanted = false
    @ObservationIgnored private var retry = 0
    /// The active device's queue and position, for the jukebox queue view.
    private(set) var remoteQueue: [Track] = []
    private(set) var remoteIndex = 0
    @ObservationIgnored private var lastQueueIds: [String] = []
    @ObservationIgnored private var wasPlaying = false
    @ObservationIgnored private var timer: Timer?
    /// The shared settings blob as the engine holds it (nil until it has been received: until then
    /// nothing is published, or this phone would wipe the other devices' settings).
    @ObservationIgnored private var settingsBlob: [String: String]?
    @ObservationIgnored private var settingsObserver: NSObjectProtocol?
    @ObservationIgnored private var settingsWork: DispatchWorkItem?

    /// Settings this app shares with the web and desktop apps: web key -> UserDefaults key.
    private enum SharedKind { case bool, string }
    private static let sharedKeys: [(web: String, local: String, kind: SharedKind, group: Switch)] = [
        ("icosahedron_lyrics_lrclib_enabled", "lyricsOnline", .bool, .lyrics),
        ("eq_settings", "eq_settings", .string, .equalizer),
    ]

    init() {
        if let id = UserDefaults.standard.string(forKey: "deviceId") {
            deviceId = id
        } else {
            let id = UUID().uuidString
            UserDefaults.standard.set(id, forKey: "deviceId")
            deviceId = id
        }
    }

    var isActiveHere: Bool { activeDeviceId == deviceId }

    // MARK: Lifecycle

    func start(client: SubsonicClient, player: PlayerModel) {
        stop()
        self.client = client
        self.player = player
        wanted = true
        retry = 0
        player.onChange = { [weak self] in self?.publish() }
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            if self?.player?.isPlaying == true { self?.publish() }
        }
        settingsObserver = NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.settingsMaybeChanged()
        }
        open()
    }

    func stop() {
        if let o = settingsObserver { NotificationCenter.default.removeObserver(o) }
        settingsObserver = nil
        settingsBlob = nil
        wanted = false
        timer?.invalidate()
        timer = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        status = "off"
        devices = []
        activeDeviceId = nil
    }

    private func open() {
        guard wanted, let client else { return }
        var comps = URLComponents(url: client.baseURL, resolvingAgainstBaseURL: false)!
        comps.scheme = comps.scheme == "https" ? "wss" : "ws"
        comps.path = "/sync"
        guard let url = comps.url else { return }
        let t = URLSession.shared.webSocketTask(with: url)
        task = t
        status = "connecting"
        t.resume()
        send([
            "type": "hello", "auth": client.syncAuth(),
            "device": ["deviceId": deviceId, "name": UIDevice.current.name, "kind": "mobile", "playback": Switch.playback.isOn],
        ])
        receive(t)
    }

    private func receive(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                DispatchQueue.main.async { self.closed(t) }
            case .success(let message):
                if case .string(let text) = message,
                   let data = text.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    DispatchQueue.main.async { self.handle(obj) }
                }
                self.receive(t)
            }
        }
    }

    private func closed(_ t: URLSessionWebSocketTask) {
        guard task === t else { return }
        task = nil
        status = "off"
        devices = []
        activeDeviceId = nil
        guard wanted else { return }
        retry += 1
        let delay = min(30.0, pow(2.0, Double(retry)))
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.open() }
    }

    private func send(_ obj: [String: Any]) {
        guard let task,
              let data = try? JSONSerialization.data(withJSONObject: obj),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    // MARK: Incoming

    private func handle(_ m: [String: Any]) {
        switch m["type"] as? String {
        case "welcome":
            retry = 0
            status = "online"
            name = m["name"] as? String
            applyDevices(m)
            if let s = m["state"] as? [String: Any] { applyRemoteState(s) }
            if let st = m["settings"] as? [String: Any] { applySettings(st) }
        case "settings":
            if let st = m["settings"] as? [String: Any] { applySettings(st) }
        case "devices":
            applyDevices(m)
        case "registry":
            applyRegistry(m)
        case "renamed":
            name = m["name"] as? String
        case "cleared":
            if (m["state"] as? Bool) == true {
                remoteQueue = []; remoteTrack = nil; remotePlaying = false; activeDeviceId = nil
            }
            if (m["settings"] as? Bool) == true { settingsBlob = [:] } // nothing shared any more; ours can be published again
        case "state":
            if let s = m["state"] as? [String: Any] { applyRemoteState(s) }
        case "command":
            handleCommand(m["cmd"] as? String ?? "", m["args"] as? [String: Any])
        default:
            break
        }
    }

    private func applyDevices(_ m: [String: Any]) {
        // The server lists devices in the order they connected, so a reconnect moved a device to
        // the end. Keep a fixed order instead: this phone first, the rest by name.
        devices = J.arr(m["devices"]).compactMap { d in
            guard let id = J.str(d, "deviceId") else { return nil }
            return Device(id: id, name: J.str(d, "name") ?? "Device", kind: J.str(d, "kind") ?? "web")
        }
        .sorted { a, b in
            if (a.id == deviceId) != (b.id == deviceId) { return a.id == deviceId }
            return (a.name.lowercased(), a.id) < (b.name.lowercased(), b.id)
        }
        activeDeviceId = m["activeDeviceId"] as? String
        // The target went offline (or stopped taking part in playback sync): back to this phone.
        if let t = targetId, !devices.contains(where: { $0.id == t }) { targetId = nil }
    }

    private func applyRegistry(_ m: [String: Any]) {
        registry = J.arr(m["devices"]).compactMap { d in
            guard let id = J.str(d, "deviceId") else { return nil }
            return RegistryDevice(
                id: id, name: J.str(d, "name") ?? "Device", kind: J.str(d, "kind") ?? "web",
                online: (d["online"] as? Bool) ?? false,
                lastSeen: Date(timeIntervalSince1970: ((d["lastSeen"] as? Double) ?? 0) / 1000)
            )
        }
        .sorted { a, b in
            if (a.id == deviceId) != (b.id == deviceId) { return a.id == deviceId }
            if a.online != b.online { return a.online }
            return (a.name.lowercased(), a.id) < (b.name.lowercased(), b.id)
        }
    }

    private func applyRemoteState(_ s: [String: Any]) {
        // Only assign what really changed: this arrives every few seconds, and an assignment
        // (even of an equal value) re-renders every view that shows it, which made lists flicker.
        if let q = s["queue"] as? [[String: Any]] {
            let tracks = q.compactMap { Track(wire: $0) }
            if tracks != remoteQueue { remoteQueue = tracks }
        }
        let i = J.int(s, "index") ?? 0
        if i != remoteIndex { remoteIndex = i }
        let track = remoteQueue.indices.contains(i) ? remoteQueue[i] : nil
        if track != remoteTrack { remoteTrack = track }
        let playing = (s["playing"] as? Bool) ?? false
        if playing != remotePlaying { remotePlaying = playing }
        remotePositionMs = (s["positionMs"] as? Double) ?? 0
        remoteStamp = Date()
    }

    private func handleCommand(_ cmd: String, _ args: [String: Any]?) {
        guard let player, Switch.playback.isOn else { return } // remote control is switched off on this phone
        switch cmd {
        case "play": player.resume()
        case "pause": player.pause()
        case "toggle": player.toggle()
        case "next": player.next()
        case "prev": player.previous()
        case "seek": if let ms = args?["positionMs"] as? Double { player.seek(to: ms / 1000) }
        case "load":
            guard let s = args?["state"] as? [String: Any],
                  let q = s["queue"] as? [[String: Any]] else { return }
            let tracks = q.compactMap { Track(wire: $0) }
            let i = J.int(s, "index") ?? 0
            let pos = ((s["positionMs"] as? Double) ?? 0) / 1000
            let playing = (s["playing"] as? Bool) ?? true
            player.play(tracks, at: tracks.indices.contains(i) ? i : 0, startPaused: !playing, startAt: pos)
        case "enqueue":
            guard let raw = args?["tracks"] as? [[String: Any]] else { return }
            let tracks = raw.compactMap { Track(wire: $0) }
            let at = (args?["at"] as? String) ?? "end"
            if player.current == nil { // nothing queued: just start
                if !tracks.isEmpty { player.play(tracks, at: 0) }
                return
            }
            let first = player.index + 1 // where the first inserted track lands
            if at == "end" {
                for t in tracks { player.addToQueue(t) }
            } else {
                for t in tracks.reversed() { player.playNext(t) } // keeps the given order
                if at == "now", player.queue.indices.contains(first) { player.play(player.queue, at: first) }
            }
        case "jump":
            if let i = J.int(args ?? [:], "index"), player.queue.indices.contains(i) {
                player.play(player.queue, at: i)
            }
        case "remove":
            if let i = J.int(args ?? [:], "index") { player.removeFromQueue(at: i) }
        default:
            break
        }
    }

    // MARK: Shared settings

    /// Takes over the values this app shares with the other platforms.
    private func applySettings(_ st: [String: Any]) {
        guard let values = st["values"] as? [String: Any] else { return }
        var blob: [String: String] = [:]
        for (k, v) in values { if let str = v as? String { blob[k] = str } }
        settingsBlob = blob
        for (web, local, kind, group) in Self.sharedKeys {
            guard group.isOn, let str = blob[web] else { continue } // a group this phone does not share is left alone
            switch kind {
            case .bool:
                let on = str == "true"
                if UserDefaults.standard.object(forKey: local) as? Bool != on { UserDefaults.standard.set(on, forKey: local) }
            case .string:
                if UserDefaults.standard.string(forKey: local) != str {
                    UserDefaults.standard.set(str, forKey: local)
                    if local == EQSettings.defaultsKey { EQManager.shared.reloadFromDefaults() }
                }
            }
        }
    }

    private func settingsMaybeChanged() {
        settingsWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.publishSettingsIfChanged() }
        settingsWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: work)
    }

    /// Sends the whole blob back with only this app's keys changed.
    private func publishSettingsIfChanged() {
        guard status == "online", var blob = settingsBlob else { return }
        var changed = false
        for (web, local, kind, group) in Self.sharedKeys where group.isOn {
            let value: String?
            switch kind {
            case .bool: value = (UserDefaults.standard.object(forKey: local) as? Bool).map { $0 ? "true" : "false" }
            case .string: value = UserDefaults.standard.string(forKey: local)
            }
            if let value, blob[web] != value {
                blob[web] = value
                changed = true
            }
        }
        guard changed else { return }
        settingsBlob = blob
        send(["type": "settings", "settings": ["values": blob, "at": Int(Date().timeIntervalSince1970 * 1000)]])
    }

    // MARK: Outgoing

    /// Only the device that is playing publishes (an idle phone restoring nothing must not
    /// overwrite the state of the one in use); a pause or stop is still published once.
    private func publish() {
        guard status == "online", Switch.playback.isOn, let player, !player.queue.isEmpty else { return }
        guard player.isPlaying || wasPlaying else { return }
        wasPlaying = player.isPlaying
        let ids = player.queue.map { $0.id }
        var state: [String: Any] = [
            "index": player.index, "positionMs": Int(player.position * 1000), "playing": player.isPlaying,
        ]
        if ids != lastQueueIds || !isActiveHere {
            state["queue"] = player.queue.map { $0.wire() }
            lastQueueIds = ids
        }
        send(["type": "state", "state": state])
    }

    // MARK: Playing on a device

    /// Chooses the device the controls act on. Picking another device while this phone plays moves
    /// the music there (the phone pauses); picking this phone just points the controls back.
    func setTarget(_ id: String?) {
        let new = (id == deviceId) ? nil : id
        targetId = new
        if let new, player?.isPlaying == true { transfer(to: new) }
    }

    /// Starts `tracks` on another device (the whole list, or a window of it when it is very long).
    func playOn(_ target: String, _ tracks: [Track], at index: Int) {
        guard !tracks.isEmpty else { return }
        let start = max(0, index - 20)
        let window = Array(tracks.dropFirst(start).prefix(1000))
        send(["type": "command", "target": target, "cmd": "load",
              "args": ["state": ["queue": window.map { $0.wire() }, "index": index - start, "positionMs": 0, "playing": true]]])
    }

    // MARK: Sync Server settings

    func rename(_ target: String, to name: String) {
        send(["type": "rename", "target": target, "name": name])
    }

    /// Removes an offline player from the registry (the engine refuses online ones).
    func forget(_ target: String) {
        send(["type": "forget", "target": target])
    }

    func clearServerData(state: Bool = false, settings: Bool = false) {
        send(["type": "clear", "state": state, "settings": settings])
    }

    /// A switch changed: playback is part of the hello, so it reconnects; a settings group that was
    /// switched on takes over what the engine holds (or shares ours if it holds nothing for it).
    func switchChanged(_ s: Switch) {
        if s == .playback {
            guard wanted else { return }
            let old = task
            task = nil
            old?.cancel(with: .goingAway, reason: nil)
            retry = 0
            open()
        } else if let blob = settingsBlob {
            applySettings(["values": blob])
            publishSettingsIfChanged()
        }
    }

    func command(to target: String, _ cmd: String) {
        send(["type": "command", "target": target, "cmd": cmd])
    }

    /// The active device's position in seconds, moving on locally while it plays.
    func remotePosition(at now: Date = Date()) -> Double {
        let base = remotePositionMs / 1000
        let pos = remotePlaying ? base + now.timeIntervalSince(remoteStamp) : base
        let limit = Double(remoteTrack?.duration ?? 0)
        return limit > 0 ? min(pos, limit) : pos
    }

    func seek(on target: String, to seconds: Double) {
        send(["type": "command", "target": target, "cmd": "seek", "args": ["positionMs": Int(seconds * 1000)]])
        remotePositionMs = seconds * 1000
        remoteStamp = Date()
    }

    func transfer(to target: String) {
        send(["type": "transfer", "target": target])
    }

    // Jukebox: edit another device's queue.
    enum QueueAt: String { case now, next, end }

    func enqueue(on target: String, _ tracks: [Track], at: QueueAt) {
        send(["type": "command", "target": target, "cmd": "enqueue",
              "args": ["at": at.rawValue, "tracks": tracks.map { $0.wire() }]])
    }

    func jump(on target: String, to index: Int) {
        send(["type": "command", "target": target, "cmd": "jump", "args": ["index": index]])
    }

    func remove(on target: String, at index: Int) {
        send(["type": "command", "target": target, "cmd": "remove", "args": ["index": index]])
    }
}
