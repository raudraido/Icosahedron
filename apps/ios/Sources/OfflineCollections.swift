import SwiftUI
import Observation

/// An album or a playlist kept offline, with its songs, so it shows in Library > Cached Songs and opens without a connection.
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

/// Play, Add to Queue and Keep Offline / Remove Offline for an album or a playlist; the songs are fetched when needed.
struct CollectionMenuItems: View {
    @Environment(AppModel.self) private var app
    let kind: String
    let id: String
    let name: String
    let subtitle: String
    let coverArt: String?

    var body: some View {
        Button { Task { if let t = await tracks() { app.play(t, at: 0) } } } label: { Label("Play", systemImage: "play.fill") }
        Button { Task { if let t = await tracks() { for x in t { app.addToQueue(x) } } } } label: { Label("Add to Queue", systemImage: "text.badge.plus") }
        if OfflineCollections.shared.contains(kind, id) {
            Button { app.removeCollection(kind: kind, id: id) } label: { Label("Remove Offline", systemImage: "arrow.down.circle.badge.xmark") }
        } else {
            Button {
                Task {
                    if let t = await tracks(), !t.isEmpty {
                        app.keepCollection(kind: kind, id: id, name: name, subtitle: subtitle, coverArt: coverArt, tracks: t)
                    }
                }
            } label: { Label("Keep Offline", systemImage: "arrow.down.circle") }
        }
    }

    private func tracks() async -> [Track]? {
        guard let c = app.client else { return nil }
        if kind == "album" { return (try? await c.album(id))?.1 }
        return try? await c.playlistTracks(id)
    }
}

extension View {
    /// A long press on an album or a playlist offers Play, Add to Queue and Keep Offline.
    func collectionMenu(kind: String, id: String, name: String, subtitle: String, coverArt: String?) -> some View {
        contextMenu { CollectionMenuItems(kind: kind, id: id, name: name, subtitle: subtitle, coverArt: coverArt) }
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
