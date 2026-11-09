import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var app
    @State private var newest: [Album] = []
    @State private var frequent: [Album] = []
    @State private var random: [Album] = []
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    NavigationLink {
                        TrackListScreen(title: "Random mix") { try await app.client?.randomSongs(100) ?? [] }
                    } label: {
                        Label("Random mix", systemImage: "shuffle")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.horizontal)

                    AlbumShelf(title: "Recently added", albums: newest)
                    AlbumShelf(title: "Most played", albums: frequent)
                    AlbumShelf(title: "Discover", albums: random)
                    if let error { Text(error).font(.footnote).foregroundStyle(.red).padding(.horizontal) }
                }
                .padding(.vertical)
            }
            .navigationTitle("Home")
            .libraryDestinations()
            .task { await load() }
            .refreshable { await load() }
        }
        .withMiniPlayer()
    }

    private func load() async {
        guard let c = app.client else { return }
        do {
            async let n = c.albums(type: "newest", size: 20)
            async let f = c.albums(type: "frequent", size: 20)
            async let r = c.albums(type: "random", size: 20)
            (newest, frequent, random) = try await (n, f, r)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct LibraryView: View {
    enum Mode: String, CaseIterable { case albums = "Albums", artists = "Artists" }
    @State private var mode: Mode = .albums

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding([.horizontal, .bottom])
                if mode == .albums { AlbumsGrid() } else { ArtistsList() }
            }
            .navigationTitle("Library")
            .libraryDestinations()
        }
        .withMiniPlayer()
    }
}

struct AlbumsGrid: View {
    @Environment(AppModel.self) private var app
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
        if let page = try? await c.albums(type: "alphabeticalByName", size: pageSize, offset: albums.count) {
            albums += page
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
                    Button { app.player.play(tracks, at: 0) } label: { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                    Button { app.player.play(tracks.shuffled(), at: 0) } label: { Label("Shuffle", systemImage: "shuffle").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered)
                }
                .disabled(tracks.isEmpty)
            }
            .frame(maxWidth: .infinity)
            .listRowSeparator(.hidden)

            ForEach(Array(tracks.enumerated()), id: \.offset) { i, t in
                Button { app.player.play(tracks, at: i) } label: { TrackRow(track: t, number: i + 1) }
                    .buttonStyle(.plain)
            }
        }
        .listStyle(.plain)
        .navigationBarTitleDisplayMode(.inline)
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
