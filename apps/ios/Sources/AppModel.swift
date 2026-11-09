import Foundation
import Observation
import UIKit

/// App-wide state: the signed-in server connection, the player and the sync link.
@MainActor @Observable
final class AppModel {
    var client: SubsonicClient?
    var restoring = true
    let player = PlayerModel()
    let sync = SyncModel()
    let router = Router()
    let net = NetworkMonitor()
    /// Bumped whenever the offline cache changes, so views listing it refresh.
    var cacheRevision = 0
    var playlists: [Playlist] = []

    var isLoggedIn: Bool { client != nil }

    init() {
        player.net = net
        net.onChange = { [weak self] in
            guard let self else { return }
            self.player.networkChanged()
            if let c = self.client { Task { await AudioCache.shared.fillMissingMetadata(client: c) } }
        }
        AudioCache.shared.onChanged = { [weak self] in self?.cacheRevision += 1 }
    }

    private let urlKey = "serverURL"
    private let userKey = "username"

    var savedURL: String { UserDefaults.standard.string(forKey: urlKey) ?? "" }
    var savedUser: String { UserDefaults.standard.string(forKey: userKey) ?? "" }

    /// Signs in with the saved login on launch, if there is one.
    func restore() async {
        defer { restoring = false }
        guard client == nil,
              let url = UserDefaults.standard.string(forKey: urlKey),
              let user = UserDefaults.standard.string(forKey: userKey),
              let pass = Keychain.get(user) else { return }
        do {
            try await signIn(url: url, user: user, pass: pass, remember: false)
        } catch {
            guard !net.isOnline || (error as? URLError) != nil, let base = URL(string: url) else { return }
            // No connection: open anyway so the cached / kept-offline songs can be played.
            let c = SubsonicClient(baseURL: base, username: user, password: pass)
            client = c
            player.client = c
        }
    }

    func signIn(url: String, user: String, pass: String, remember: Bool = true) async throws {
        var text = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.lowercased().hasPrefix("http") { text = "https://" + text }
        while text.hasSuffix("/") { text.removeLast() }
        guard let base = URL(string: text) else { throw SubsonicError.badResponse }
        let c = SubsonicClient(baseURL: base, username: user, password: pass)
        try await c.ping()
        if remember {
            UserDefaults.standard.set(text, forKey: urlKey)
            UserDefaults.standard.set(user, forKey: userKey)
            Keychain.set(pass, for: user)
        }
        client = c
        player.client = c
        sync.start(client: c, player: player)
        Task { await refreshPlaylists() }
        Task { await AudioCache.shared.fillMissingMetadata(client: c) }
        player.resumePins()
    }

    func refreshPlaylists() async {
        playlists = (try? await client?.playlists()) ?? []
    }

    func addToPlaylist(_ track: Track, _ playlist: Playlist) async {
        do {
            try await client?.addToPlaylist(playlist.id, songId: track.id)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            await refreshPlaylists()
        } catch {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    /// Keeps tracks on the phone permanently (downloads them on Wi-Fi, or cellular if allowed).
    func keepOffline(_ tracks: [Track]) {
        AudioCache.shared.pin(tracks)
        player.resumePins()
    }

    func removeOffline(_ ids: [String]) {
        AudioCache.shared.unpin(ids)
    }

    func signOut() {
        sync.stop()
        player.stop()
        player.client = nil
        client = nil
        Keychain.delete(savedUser)
        UserDefaults.standard.removeObject(forKey: userKey)
    }
}
