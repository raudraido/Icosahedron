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
    let lastfm = LastFmModel()
    /// Favorite / rating changes made in the app, so every list and menu shows them at once.
    var starredOverrides: [String: Bool] = [:]
    var ratingOverrides: [String: Int] = [:]
    /// Bumped whenever the offline cache changes, so views listing it refresh.
    var cacheRevision = 0
    var playlists: [Playlist] = []

    var isLoggedIn: Bool { client != nil }

    init() {
        player.net = net
        player.onNowPlaying = { [weak self] t in self?.nowPlaying(t) }
        player.onScrobble = { [weak self] t, time in self?.scrobble(t, time) }
        net.onChange = { [weak self] in
            guard let self else { return }
            self.player.networkChanged()
            if self.net.isOnline { self.flushScrobbles() }
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
        Task { await lastfm.refresh(client: c) }
        flushScrobbles()
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

    // MARK: Plays (Navidrome + Last.fm)

    private func nowPlaying(_ t: Track) {
        guard let c = client else { return }
        Task { try? await c.scrobble(t.id, submission: false) }
        if lastfm.isConnected && lastfm.scrobbleEnabled {
            let body: [String: Any] = ["track": ["title": t.title, "artist": t.artist, "album": t.album ?? "", "duration": t.duration]]
            Task { _ = try? await c.engine("POST", "/lastfm/nowplaying", json: body) }
        }
    }

    /// A play that counts: stored first, then sent (immediately, or when the connection is back).
    private func scrobble(_ t: Track, _ time: Date) {
        ScrobbleQueue.shared.add(t, time: time, lastfm: lastfm.isConnected && lastfm.scrobbleEnabled)
        flushScrobbles()
    }

    func flushScrobbles() {
        guard let c = client else { return }
        Task { await ScrobbleQueue.shared.flush(client: c) }
    }

    // MARK: Favorites, rating, sharing

    func isStarred(_ t: Track) -> Bool { starredOverrides[t.id] ?? t.starred }
    func rating(_ t: Track) -> Int { ratingOverrides[t.id] ?? t.userRating ?? 0 }

    func toggleStar(_ t: Track) {
        guard let c = client else { return }
        let on = !isStarred(t)
        starredOverrides[t.id] = on
        player.applyStarred(t.id, on)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        Task {
            do { try await c.setStarred(t.id, on) } catch {
                starredOverrides[t.id] = !on
                player.applyStarred(t.id, !on)
            }
        }
    }

    func setRating(_ t: Track, _ value: Int) {
        guard let c = client else { return }
        let old = rating(t)
        ratingOverrides[t.id] = value
        player.applyRating(t.id, value)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        Task {
            do { try await c.setRating(t.id, value) } catch {
                ratingOverrides[t.id] = old
                player.applyRating(t.id, old)
            }
        }
    }

    func share(_ t: Track) {
        guard let c = client else { return }
        Task {
            if let url = try? await c.createShare(t.id) {
                Presenter.share(url)
            } else {
                Presenter.alert("Sharing is not available", "Turn on sharing in the Navidrome server settings (ND_ENABLESHARING).")
            }
        }
    }

    // MARK: Playlists

    func newPlaylist(with tracks: [Track] = []) {
        Presenter.prompt(title: "New Playlist", placeholder: "Name", action: "Create") { [weak self] name in
            guard let self, let c = self.client else { return }
            Task {
                try? await c.createPlaylist(name: name, songIds: tracks.map { $0.id })
                await self.refreshPlaylists()
            }
        }
    }

    func renamePlaylist(_ p: Playlist) {
        Presenter.prompt(title: "Rename Playlist", placeholder: "Name", text: p.name, action: "Rename") { [weak self] name in
            guard let self, let c = self.client else { return }
            Task {
                try? await c.renamePlaylist(p.id, name: name)
                await self.refreshPlaylists()
            }
        }
    }

    func deletePlaylist(_ p: Playlist) {
        Presenter.confirm(title: "Delete \"\(p.name)\"?", message: "The songs themselves are not deleted.", destructive: "Delete") { [weak self] in
            guard let self, let c = self.client else { return }
            Task {
                try? await c.deletePlaylist(p.id)
                await self.refreshPlaylists()
            }
        }
    }

    func saveQueueAsPlaylist() {
        let tracks = player.queue
        guard !tracks.isEmpty else { return }
        newPlaylist(with: tracks)
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
