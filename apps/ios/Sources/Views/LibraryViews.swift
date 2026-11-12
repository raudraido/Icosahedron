import SwiftUI

enum LibrarySection: String, Hashable, CaseIterable {
    case artists = "Artists"
    case albums = "Albums"
    case newest = "Newest Albums"
    case recent = "Recently Played Albums"
    case songs = "Songs"
    case favorites = "Favorite Songs"
    case cached = "Cached Songs"
    case directories = "Directories"
    case playlists = "Playlists"
    case radios = "Radios"

    var title: LocalizedStringKey {
        switch self {
        case .artists: return "Artists"
        case .albums: return "Albums"
        case .newest: return "Newest Albums"
        case .recent: return "Recently Played Albums"
        case .songs: return "Songs"
        case .favorites: return "Favorite Songs"
        case .cached: return "Cached Songs"
        case .directories: return "Directories"
        case .playlists: return "Playlists"
        case .radios: return "Radios"
        }
    }

    var icon: String {
        switch self {
        case .artists: return "music.mic"
        case .albums: return "square.stack"
        case .newest: return "rectangle.stack.badge.plus"
        case .recent: return "clock.arrow.circlepath"
        case .songs: return "music.note"
        case .favorites: return "heart.fill"
        case .cached: return "arrow.down.circle.fill"
        case .directories: return "folder.fill"
        case .playlists: return "music.note.list"
        case .radios: return "dot.radiowaves.left.and.right"
        }
    }
}

/// Library: a plain list of the ways to browse, like Apple Music's.
struct LibraryView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        NavigationStack(path: Bindable(app.router).libraryPath) {
            List {
                if !app.net.isOnline {
                    Label("Offline — only cached songs can be played", systemImage: "wifi.slash")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(LibrarySection.allCases, id: \.self) { section in
                    NavigationLink(value: section) {
                        Label {
                            Text(section.title).font(.title3)
                        } icon: {
                            Image(systemName: section.icon).foregroundStyle(Theme.accent).frame(width: 34)
                        }
                        .padding(.vertical, 6)
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Library")
            .navigationDestination(for: LibrarySection.self) { destination($0) }
            .libraryDestinations()
            .profileButton()
        }
    }

    @ViewBuilder
    private func destination(_ s: LibrarySection) -> some View {
        switch s {
        case .artists:
            ArtistsBrowser().navigationTitle("Artists").navigationBarTitleDisplayMode(.inline)
        case .albums:
            AlbumsBrowser(sort: .name).navigationTitle("Albums").navigationBarTitleDisplayMode(.inline)
        case .newest:
            AlbumsBrowser(sort: .added).navigationTitle("Newest Albums").navigationBarTitleDisplayMode(.inline)
        case .recent:
            AlbumsBrowser(sort: .recentlyPlayed).navigationTitle("Recently Played Albums").navigationBarTitleDisplayMode(.inline)
        case .songs:
            SongsScreen()
        case .favorites:
            TrackListScreen(title: String(localized: "Favorite Songs")) { try await app.client?.starred() ?? [] }
        case .cached:
            CachedSongsScreen()
        case .directories:
            DirectoryScreen(entry: nil)
        case .playlists:
            PlaylistsList().navigationTitle("Playlists").navigationBarTitleDisplayMode(.inline)
        case .radios:
            RadiosScreen()
        }
    }
}

/// Every song in the library, loaded a page at a time.
struct SongsScreen: View {
    @Environment(AppModel.self) private var app
    @State private var tracks: [Track] = []
    @State private var loading = false
    @State private var done = false
    private let pageSize = 100

    var body: some View {
        List {
            HStack(spacing: 12) {
                Button { shuffleAll() } label: { Label("Shuffle all", systemImage: "shuffle").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
            }
            .listRowSeparator(.hidden)
            ForEach(Array(tracks.enumerated()), id: \.offset) { i, t in
                Button { app.play(tracks, at: i) } label: { TrackRow(track: t, showCover: true) }
                    .buttonStyle(.plain)
                    .onAppear { if i >= tracks.count - 10 { Task { await loadMore() } } }
            }
            if loading { ProgressView().frame(maxWidth: .infinity).listRowSeparator(.hidden) }
        }
        .listStyle(.plain)
        .navigationTitle("Songs")
        .navigationBarTitleDisplayMode(.inline)
        .task { if tracks.isEmpty { await loadMore() } }
    }

    private func loadMore() async {
        guard !loading, !done, let c = app.client else { return }
        loading = true
        if let page = try? await c.songs(offset: tracks.count, size: pageSize) {
            tracks += page
            if page.count < pageSize { done = true }
        }
        loading = false
    }

    private func shuffleAll() {
        Task {
            if let songs = try? await app.client?.randomSongs(200), !songs.isEmpty { app.play(songs, at: 0) }
        }
    }
}

/// Folder view: folders first, then the tracks inside; tapping a track plays the folder from there.
struct DirectoryScreen: View {
    @Environment(AppModel.self) private var app
    let entry: DirEntry?
    @State private var entries: [DirEntry] = []
    @State private var loading = true

    private var tracks: [Track] { entries.compactMap { $0.track } }

    var body: some View {
        List {
            ForEach(entries.filter { $0.isDir }) { e in
                NavigationLink(value: e) { Label(e.title, systemImage: "folder.fill") }
            }
            ForEach(Array(tracks.enumerated()), id: \.offset) { i, t in
                Button { app.play(tracks, at: i) } label: { TrackRow(track: t, showCover: true) }
                    .buttonStyle(.plain)
            }
            if loading { ProgressView().frame(maxWidth: .infinity).listRowSeparator(.hidden) }
        }
        .listStyle(.plain)
        .navigationTitle(entry?.title ?? "Directories")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let entry {
                entries = (try? await app.client?.directory(entry.id)) ?? []
            } else {
                entries = (try? await app.client?.directoryRoot()) ?? []
            }
            loading = false
        }
    }
}

struct RadiosScreen: View {
    @Environment(AppModel.self) private var app
    @State private var stations: [RadioStation] = []
    @State private var loading = true

    var body: some View {
        List {
            ForEach(stations) { s in
                Button { app.player.play([Track(radio: s)], at: 0) } label: {
                    Label(s.name, systemImage: "dot.radiowaves.left.and.right").padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
            if !loading && stations.isEmpty {
                Text("No radio stations on this server").foregroundStyle(.secondary)
            }
            if loading { ProgressView().frame(maxWidth: .infinity).listRowSeparator(.hidden) }
        }
        .listStyle(.plain)
        .navigationTitle("Radios")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            stations = (try? await app.client?.radios()) ?? []
            loading = false
        }
    }
}

/// Songs on the phone: the automatic cache plus the ones kept offline. Works without a connection.
struct CachedSongsScreen: View {
    @Environment(AppModel.self) private var app
    @State private var onlyKept = false

    var body: some View {
        let _ = app.cacheRevision // refresh whenever the cache changes
        let all = AudioCache.shared.entries()
        let shown = onlyKept ? all.filter { $0.pinned } : all
        let playable = shown.filter { $0.file != nil }.map { $0.track }
        let sizes = AudioCache.shared.sizes()
        List {
            Section {
                Picker("", selection: $onlyKept) {
                    Text("All").tag(false)
                    Text("Kept Offline").tag(true)
                }
                .pickerStyle(.segmented)
                Text("\(playable.count) songs · cache \(bytes(sizes.auto)) · kept offline \(bytes(sizes.pinned))")
                    .font(.footnote).foregroundStyle(.secondary)
                if !playable.isEmpty {
                    HStack(spacing: 12) {
                        Button { app.play(playable, at: 0) } label: { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent)
                        Button { app.play(playable.shuffled(), at: 0) } label: { Label("Shuffle", systemImage: "shuffle").frame(maxWidth: .infinity) }
                            .buttonStyle(.bordered)
                    }
                }
            }
            .listRowSeparator(.hidden)

            if !OfflineCollections.shared.items.isEmpty {
                Section("Albums and Playlists") {
                    ForEach(OfflineCollections.shared.items) { c in
                        NavigationLink {
                            OfflineCollectionScreen(collection: c)
                        } label: {
                            HStack(spacing: 12) {
                                CoverImage(id: c.coverArt, size: 100)
                                    .frame(width: 48, height: 48).clipShape(RoundedRectangle(cornerRadius: 6))
                                VStack(alignment: .leading) {
                                    Text(c.name).lineLimit(1)
                                    Text("\(c.kind == "album" ? String(localized: "Album") : String(localized: "Playlist")) · \(c.tracks.count)").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }

            ForEach(shown) { e in
                row(e, playable: playable)
            }
            if shown.isEmpty {
                Text(onlyKept ? "Nothing kept offline yet. Use \"Keep Offline\" in a track's menu." : "No songs cached yet.")
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.plain)
        .navigationTitle("Cached Songs")
        .navigationBarTitleDisplayMode(.inline)
        .task { if let c = app.client { await AudioCache.shared.fillMissingMetadata(client: c) } }
    }

    @ViewBuilder
    private func row(_ e: AudioCache.Entry, playable: [Track]) -> some View {
        let ready = e.file != nil
        Button {
            if ready, let i = playable.firstIndex(where: { $0.id == e.id }) { app.play(playable, at: i) }
        } label: {
            HStack(spacing: 8) {
                TrackRow(track: e.track, showCover: true)
                if !ready {
                    VStack(spacing: 2) {
                        ProgressView()
                        Text("Waiting").font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(!ready)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { remove(e) } label: { Label("Remove", systemImage: "trash") }
            if e.pinned {
                Button { app.removeOffline([e.id]) } label: { Label("Unpin", systemImage: "pin.slash") }.tint(.orange)
            } else {
                Button { app.keepOffline([e.track]) } label: { Label("Keep", systemImage: "arrow.down.circle") }.tint(.blue)
            }
        }
    }

    private func remove(_ e: AudioCache.Entry) {
        AudioCache.shared.remove(e.id)
    }

    private func bytes(_ n: Int64) -> String { ByteCountFormatter.string(fromByteCount: n, countStyle: .file) }
}
