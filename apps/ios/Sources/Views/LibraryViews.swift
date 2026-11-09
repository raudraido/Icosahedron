import SwiftUI

enum LibrarySection: String, Hashable, CaseIterable {
    case artists = "Artists"
    case albums = "Albums"
    case newest = "Newest Albums"
    case recent = "Recently Played Albums"
    case songs = "Songs"
    case favorites = "Favorite Songs"
    case directories = "Directories"
    case playlists = "Playlists"
    case radios = "Radios"

    var icon: String {
        switch self {
        case .artists: return "music.mic"
        case .albums: return "square.stack"
        case .newest: return "rectangle.stack.badge.plus"
        case .recent: return "clock.arrow.circlepath"
        case .songs: return "music.note"
        case .favorites: return "heart.fill"
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
            List(LibrarySection.allCases, id: \.self) { section in
                NavigationLink(value: section) {
                    Label {
                        Text(section.rawValue).font(.title3)
                    } icon: {
                        Image(systemName: section.icon).foregroundStyle(Theme.accent).frame(width: 34)
                    }
                    .padding(.vertical, 6)
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
            ArtistsList().navigationTitle("Artists").navigationBarTitleDisplayMode(.inline)
        case .albums:
            AlbumsGrid(type: "alphabeticalByName").navigationTitle("Albums").navigationBarTitleDisplayMode(.inline)
        case .newest:
            AlbumsGrid(type: "newest").navigationTitle("Newest Albums").navigationBarTitleDisplayMode(.inline)
        case .recent:
            AlbumsGrid(type: "recent").navigationTitle("Recently Played").navigationBarTitleDisplayMode(.inline)
        case .songs:
            SongsScreen()
        case .favorites:
            TrackListScreen(title: "Favorite Songs") { try await app.client?.starred() ?? [] }
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
                Button { app.player.play(tracks, at: i) } label: { TrackRow(track: t, showCover: true) }
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
            if let songs = try? await app.client?.randomSongs(200), !songs.isEmpty { app.player.play(songs, at: 0) }
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
                Button { app.player.play(tracks, at: i) } label: { TrackRow(track: t, showCover: true) }
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
