import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var app
    @State private var newest: [Album] = []
    @State private var frequent: [Album] = []
    @State private var random: [Album] = []
    @State private var error: String?
    @State private var startingMix = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // Starts at once: no list to open and press Play on a second time.
                    Button { Task { await startRandomMix() } } label: {
                        HStack(spacing: 8) {
                            if startingMix { ProgressView() } else { Image(systemName: "shuffle") }
                            Text("Random mix")
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(startingMix)
                    .padding(.horizontal)

                    AlbumShelf(title: "Discover", albums: random, seeAll: ("random", String(localized: "Discover")))
                    AlbumShelf(title: "Recently added", albums: newest, seeAll: ("newest", String(localized: "Recently added")))
                    AlbumShelf(title: "Most played", albums: frequent, seeAll: ("frequent", String(localized: "Most played")))
                    PlaylistShelf(playlists: app.playlists)
                    if let error { Text(error).font(.footnote).foregroundStyle(.red).padding(.horizontal) }
                }
                .padding(.vertical)
            }
            .navigationTitle("Home")
            .libraryDestinations()
            .profileButton()
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func startRandomMix() async {
        guard let c = app.client, !startingMix else { return }
        startingMix = true
        defer { startingMix = false }
        do {
            let songs = try await c.randomSongs(100)
            if !songs.isEmpty { app.play(songs, at: 0) }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func load() async {
        guard let c = app.client else { return }
        do {
            async let n = c.albums(type: "newest", size: 20)
            async let f = c.albums(type: "frequent", size: 20)
            async let r = c.albums(type: "random", size: 20)
            await app.refreshPlaylists()
            (newest, frequent, random) = try await (n, f, r)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct AlbumsGrid: View {
    @Environment(AppModel.self) private var app
    let type: String

    init(type: String = "alphabeticalByName") { self.type = type }

    @State private var albums: [Album] = []
    @State private var done = false
    @State private var loading = false
    private let pageSize = 60
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 14, alignment: .top)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 18) {
                ForEach(albums) { a in
                    NavigationLink(value: a) { AlbumCard(album: a, width: 160) }
                        .buttonStyle(.plain)
                        .onAppear { if a.id == albums.last?.id { Task { await loadMore() } } }
                }
            }
            .padding(.horizontal)
            if loading { ProgressView().padding() }
        }
        .task { if albums.isEmpty { await loadMore() } }
    }

    private func loadMore() async {
        guard !loading, !done, let c = app.client else { return }
        loading = true
        if let page = try? await c.albums(type: type, size: pageSize, offset: albums.count) {
            // "random" hands out a fresh draw every time, so a page can repeat an album already shown.
            let seen = Set(albums.map(\.id))
            albums += page.filter { !seen.contains($0.id) }
            if page.count < pageSize { done = true }
        }
        loading = false
    }
}

struct ArtistsList: View {
    @Environment(AppModel.self) private var app
    @State private var artists: [Artist] = []

    var body: some View {
        List(artists) { a in
            NavigationLink(value: a) {
                HStack(spacing: 12) {
                    CoverImage(id: a.coverArt, size: 100)
                        .frame(width: 44, height: 44).clipShape(Circle())
                    VStack(alignment: .leading) {
                        Text(a.name)
                        Text("\(a.albumCount) albums").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listStyle(.plain)
        .task { if artists.isEmpty { artists = (try? await app.client?.artists()) ?? [] } }
    }
}

struct AlbumDetailView: View {
    @Environment(AppModel.self) private var app
    let album: Album
    @State private var tracks: [Track] = []

    var body: some View {
        List {
            VStack(spacing: 10) {
                CoverImage(id: album.coverArt, size: 600)
                    .frame(width: 240, height: 240)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .shadow(radius: 12)
                Text(album.name).font(.title3.bold()).multilineTextAlignment(.center)
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                HStack(spacing: 12) {
                    Button { app.play(tracks, at: 0) } label: { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                    Button { app.play(tracks.shuffled(), at: 0) } label: { Label("Shuffle", systemImage: "shuffle").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered)
                }
                .disabled(tracks.isEmpty)
            }
            .frame(maxWidth: .infinity)
            .listRowSeparator(.hidden)

            ForEach(Array(tracks.enumerated()), id: \.offset) { i, t in
                Button { app.play(tracks, at: i) } label: { TrackRow(track: t, number: i + 1) }
                    .buttonStyle(.plain)
            }
        }
        .listStyle(.plain)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !tracks.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { app.keepOffline(tracks) } label: { Label("Keep Album Offline", systemImage: "arrow.down.circle") }
                        Button { app.removeOffline(tracks.map { $0.id }) } label: { Label("Remove Offline", systemImage: "arrow.down.circle.badge.xmark") }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
        }
        .task { tracks = (try? await app.client?.album(album.id).1) ?? [] }
    }

    private var subtitle: String {
        var parts = [album.artist]
        if let y = album.year { parts.append(String(y)) }
        return parts.joined(separator: " · ")
    }
}

struct ArtistDetailView: View {
    @Environment(AppModel.self) private var app
    let artist: Artist
    @State private var albums: [Album] = []
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 14, alignment: .top)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 18) {
                ForEach(albums) { a in
                    NavigationLink(value: a) { AlbumCard(album: a, width: 160) }.buttonStyle(.plain)
                }
            }
            .padding()
        }
        .navigationTitle(artist.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { albums = (try? await app.client?.artist(artist.id).1) ?? [] }
    }
}
