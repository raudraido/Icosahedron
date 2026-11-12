import SwiftUI
import Observation

/// An album or a playlist kept offline, with its songs, so it shows in Library > Downloads and opens without a connection.
struct OfflineCollection: Codable, Identifiable, Hashable {
    let kind: String      // "album" or "playlist"
    let id: String
    var name: String
    var subtitle: String
    var coverArt: String?
    var tracks: [Track]

    var key: String { kind + ":" + id }
    var uid: String { key }
}

/// The albums and playlists kept offline. The songs themselves live in `AudioCache` (pinned).
@MainActor @Observable
final class OfflineCollections {
    static let shared = OfflineCollections()

    private(set) var items: [OfflineCollection] = []
    @ObservationIgnored private let file: URL

    private init() {
        let fm = FileManager.default
        let dir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        file = dir.appendingPathComponent("offline-collections.json")
        if let data = try? Data(contentsOf: file), let list = try? JSONDecoder().decode([OfflineCollection].self, from: data) {
            items = list
        }
    }

    func contains(_ kind: String, _ id: String) -> Bool { items.contains { $0.kind == kind && $0.id == id } }

    func add(_ c: OfflineCollection) {
        items.removeAll { $0.key == c.key }
        items.append(c)
        save()
    }

    @discardableResult
    func remove(_ kind: String, _ id: String) -> OfflineCollection? {
        guard let i = items.firstIndex(where: { $0.kind == kind && $0.id == id }) else { return nil }
        let c = items.remove(at: i)
        save()
        return c
    }

    func removeAll() { items = []; save() }

    private func save() {
        if let data = try? JSONEncoder().encode(items) { try? data.write(to: file) }
    }
}

/// The actions for an album, a playlist or a plain list of songs: the same menu on the page's "…" button and on a long press.
/// kind: "album", "playlist" or "list" (a list without an id of its own, like Favorite Songs).
struct CollectionMenuItems: View {
    @Environment(AppModel.self) private var app
    let kind: String
    let id: String
    let name: String
    let subtitle: String
    let coverArt: String?
    var album: Album? = nil
    var playlist: Playlist? = nil
    /// The songs when the page already has them; otherwise they are fetched when an action needs them.
    var preloaded: [Track]? = nil
    /// Called after the playlist was deleted (the page closes).
    var onRemoved: (() -> Void)? = nil

    var body: some View {
        Button { Task { if let t = await tracks() { for x in t.reversed() { app.playNext(x) } } } } label: { Label("Play Next", systemImage: "text.line.first.and.arrowtriangle.forward") }
        Button { Task { if let t = await tracks() { for x in t { app.addToQueue(x) } } } } label: { Label("Add to Queue", systemImage: "text.line.last.and.arrowtriangle.forward") }
        let others = app.sync.status == "online" ? app.sync.devices.filter { $0.id != app.sync.deviceId } : []
        if !others.isEmpty {
            Menu {
                ForEach(others) { d in
                    Button { sendToDevice(d.id, at: .now) } label: { Label(d.name + ": " + String(localized: "Play Now"), systemImage: "play.fill") }
                    Button { sendToDevice(d.id, at: .next) } label: { Label(d.name + ": " + String(localized: "Play Next"), systemImage: "text.line.first.and.arrowtriangle.forward") }
                    Button { sendToDevice(d.id, at: .end) } label: { Label(d.name + ": " + String(localized: "Add to Queue"), systemImage: "text.line.last.and.arrowtriangle.forward") }
                }
            } label: { Label("Add to Device Queue", systemImage: "hifispeaker.2") }
        }
        Divider()
        if downloaded {
            Button { toggleDownload() } label: { Label("Remove Download", systemImage: "arrow.down.circle.badge.xmark") }
        } else {
            Button { toggleDownload() } label: { Label("Download", systemImage: "arrow.down.circle") }
        }
        if let album {
            if app.isStarred(album: album) {
                Button { app.toggleStar(album: album) } label: { Label("Remove Favorite", systemImage: "heart.slash") }
            } else {
                Button { app.toggleStar(album: album) } label: { Label("Favorite", systemImage: "heart") }
            }
        }
        Menu {
            Button { Task { if let t = await tracks() { app.newPlaylist(with: t) } } } label: { Label("New Playlist…", systemImage: "plus") }
            if !app.playlists.isEmpty {
                Divider()
                ForEach(app.playlists) { p in
                    Button(p.name) { Task { if let t = await tracks() { await app.addToPlaylist(t, p) } } }
                }
            }
        } label: { Label("Add to Playlist", systemImage: "text.badge.plus") }
        if kind != "list" {
            Button { app.shareItem(id) } label: { Label("Share", systemImage: "square.and.arrow.up") }
        }
        if let album, let artistId = album.artistId, let artist = Artist(subsonic: ["id": artistId, "name": album.artist]) {
            Button { app.router.show(artist: artist) } label: { Label("Show Artist", systemImage: "music.mic") }
        }
        if let playlist {
            Divider()
            Button { app.renamePlaylist(playlist) } label: { Label("Rename", systemImage: "pencil") }
            Button(role: .destructive) { app.deletePlaylist(playlist); onRemoved?() } label: { Label("Delete", systemImage: "trash") }
        }
    }

    private var downloaded: Bool {
        if kind == "list" {
            guard let p = preloaded, !p.isEmpty else { return false }
            return p.allSatisfy { AudioCache.shared.isPinned($0.id) }
        }
        return OfflineCollections.shared.contains(kind, id)
    }

    private func toggleDownload() {
        if kind == "list" {
            Task {
                guard let t = await tracks(), !t.isEmpty else { return }
                if t.allSatisfy({ AudioCache.shared.isPinned($0.id) }) { app.removeOffline(t.map { $0.id }) } else { app.keepOffline(t) }
            }
        } else if OfflineCollections.shared.contains(kind, id) {
            app.removeCollection(kind: kind, id: id)
        } else {
            Task {
                if let t = await tracks(), !t.isEmpty {
                    app.keepCollection(kind: kind, id: id, name: name, subtitle: subtitle, coverArt: coverArt, tracks: t)
                }
            }
        }
    }

    private func sendToDevice(_ device: String, at: SyncModel.QueueAt) {
        Task { if let t = await tracks() { app.sync.enqueue(on: device, t, at: at) } }
    }

    private func tracks() async -> [Track]? {
        if let preloaded { return preloaded }
        guard let c = app.client else { return nil }
        if kind == "album" { return (try? await c.album(id))?.1 }
        if kind == "playlist" { return try? await c.playlistTracks(id) }
        return nil
    }
}

extension View {
    /// A long press on an album or a playlist offers the same menu as the "…" button on its page.
    func collectionMenu(kind: String, id: String, name: String, subtitle: String, coverArt: String?, album: Album? = nil, playlist: Playlist? = nil) -> some View {
        contextMenu { CollectionMenuItems(kind: kind, id: id, name: name, subtitle: subtitle, coverArt: coverArt, album: album, playlist: playlist) }
    }
}

/// A kept album or playlist, read from the phone: opens without a connection.
struct OfflineCollectionScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let collection: OfflineCollection

    var body: some View {
        List {
            VStack(spacing: 6) {
                CoverImage(id: collection.coverArt, size: 400)
                    .frame(width: 200, height: 200).clipShape(RoundedRectangle(cornerRadius: 10))
                Text(collection.name).font(.title3.bold()).multilineTextAlignment(.center)
                Text(collection.subtitle).font(.subheadline).foregroundStyle(.secondary)
                HStack(spacing: 12) {
                    Button { app.play(collection.tracks, at: 0) } label: { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                    Button { app.play(collection.tracks.shuffled(), at: 0) } label: { Label("Shuffle", systemImage: "shuffle").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered)
                }
            }
            .frame(maxWidth: .infinity)
            .listRowSeparator(.hidden)

            ForEach(Array(collection.tracks.enumerated()), id: \.offset) { i, t in
                Button { app.play(collection.tracks, at: i) } label: { TrackRow(track: t, number: i + 1) }
                    .buttonStyle(.plain)
            }
        }
        .listStyle(.plain)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(role: .destructive) { app.removeCollection(kind: collection.kind, id: collection.id); dismiss() } label: {
                    Image(systemName: "arrow.down.circle.badge.xmark")
                }
            }
        }
    }
}
