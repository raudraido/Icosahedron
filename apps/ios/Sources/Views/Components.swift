import SwiftUI

/// Cover art for a Subsonic cover id, with a placeholder.
struct CoverImage: View {
    @Environment(AppModel.self) private var app
    let id: String?
    var size: Int = 300

    var body: some View {
        // The picture is only an overlay on a flexible base: a cover that is not square (wide or
        // tall) would otherwise size the whole layout by its own proportions and push everything
        // around it off the screen.
        Theme.card
            .overlay {
                if let url = app.client?.coverURL(id, size: size) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else {
                            placeholder
                        }
                    }
                } else {
                    placeholder
                }
            }
            .clipped()
            .accessibilityHidden(true)
    }

    private var placeholder: some View {
        Image(systemName: "music.note").font(.title2).foregroundStyle(.secondary)
    }
}

struct AlbumCard: View {
    let album: Album
    var width: CGFloat = 150

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CoverImage(id: album.coverArt, size: 300)
                .frame(width: width, height: width)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            HStack(spacing: 4) {
                if OfflineCollections.shared.contains("album", album.id) {
                    Image(systemName: "arrow.down.circle.fill").font(.caption2).foregroundStyle(.secondary)
                }
                Text(album.name).font(.subheadline.weight(.semibold)).lineLimit(1)
            }
            Text(album.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: width, alignment: .leading)
        .collectionMenu(kind: "album", id: album.id, name: album.name, subtitle: album.artist, coverArt: album.coverArt, album: album)
    }
}

struct AlbumShelf: View {
    let title: LocalizedStringKey
    let albums: [Album]
    /// When set, the heading gets a "See All" button that opens the whole list (an album list type of the server).
    var seeAll: (type: String, title: String)? = nil

    var body: some View {
        if !albums.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(title).font(.title3.bold())
                    Spacer()
                    if let seeAll {
                        NavigationLink {
                            AlbumsBrowser(sort: AlbumSort(rawValue: seeAll.type) ?? .name).navigationTitle(seeAll.title).navigationBarTitleDisplayMode(.inline)
                        } label: {
                            HStack(spacing: 4) { Text("See All"); Image(systemName: "chevron.right").font(.caption.bold()) }
                                .font(.subheadline.weight(.medium))
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(.quaternary, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 14) {
                        ForEach(albums) { a in
                            NavigationLink(value: a) { AlbumCard(album: a) }.buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
    }
}

/// Home shelf of the user's playlists, with a See All button that opens the full list.
struct PlaylistShelf: View {
    let playlists: [Playlist]

    var body: some View {
        if !playlists.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Playlists").font(.title3.bold())
                    Spacer()
                    NavigationLink {
                        PlaylistsList().navigationTitle("Playlists").navigationBarTitleDisplayMode(.inline)
                    } label: {
                        HStack(spacing: 4) { Text("See All"); Image(systemName: "chevron.right").font(.caption.bold()) }
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(.quaternary, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 14) {
                        ForEach(playlists.prefix(20)) { p in
                            NavigationLink {
                                PlaylistScreen(playlist: p)
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    CoverImage(id: p.coverArt, size: 300)
                                        .frame(width: 150, height: 150)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                    Text(p.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                                    Text("\(p.songCount) tracks").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                .frame(width: 150, alignment: .leading)
                                .collectionMenu(kind: "playlist", id: p.id, name: p.name, subtitle: "\(p.songCount) tracks", coverArt: p.coverArt, playlist: p)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
    }
}

struct TrackRow: View {
    @Environment(AppModel.self) private var app
    @AppStorage("showBPM") private var showBPM = true
    let track: Track
    var number: Int?
    var showCover = false

    private var subtitle: String {
        if showBPM, let b = app.bpm[track.id] { return track.artist + " · " + String(format: "%.0f BPM", b) }
        return track.artist
    }

    var body: some View {
        let playing = app.player.current?.id == track.id
        let _ = app.cacheRevision // the kept-offline badge follows the cache
        HStack(spacing: 12) {
            if showCover {
                CoverImage(id: track.coverArt, size: 100)
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            } else if let number {
                Text("\(number)").font(.caption).foregroundStyle(.secondary).frame(width: 26, alignment: .trailing)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(track.title).lineLimit(1).foregroundStyle(playing ? Theme.accent : Color.primary)
                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            if playing && app.player.isPlaying {
                Image(systemName: "waveform").foregroundStyle(Theme.accent)
            }
            if AudioCache.shared.isPinned(track.id) {
                Image(systemName: "arrow.down.circle.fill").font(.caption).foregroundStyle(.secondary)
            }
            Text(formatTime(Double(track.duration))).font(.caption).foregroundStyle(.secondary).monospacedDigit()
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .contextMenu { TrackMenuContent(track: track) }
    }
}

/// A scrollable list of tracks with Play / Shuffle; tapping a row plays from there.
struct TrackListScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let title: String
    let loader: () async throws -> [Track]
    /// Set for a playlist: the list can then be edited (reorder, remove) and the server is updated.
    var playlist: Playlist? = nil
    @State private var tracks: [Track] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        List {
            if !tracks.isEmpty {
                HStack(spacing: 12) {
                    Button { start(shuffled: false) } label: { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                    Button { start(shuffled: true) } label: { Label("Shuffle", systemImage: "shuffle").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered)
                    Menu {
                        CollectionMenuItems(
                            kind: playlist != nil ? "playlist" : "list", id: playlist?.id ?? title, name: title,
                            subtitle: "\(tracks.count) tracks", coverArt: playlist?.coverArt ?? tracks.first?.coverArt,
                            playlist: playlist, preloaded: tracks, onRemoved: { dismiss() }
                        )
                    } label: { Image(systemName: "ellipsis").rotationEffect(.degrees(90)).frame(width: 24, height: 22) }
                        .buttonStyle(.bordered)
                }
                .listRowSeparator(.hidden)
            }
            ForEach(Array(tracks.enumerated()), id: \.offset) { i, t in
                Button { app.play(tracks, at: i) } label: { TrackRow(track: t, showCover: true) }
                    .buttonStyle(.plain)
            }
            .onDelete(perform: playlist == nil ? nil : { offsets in
                tracks.remove(atOffsets: offsets)
                saveOrder()
            })
            .onMove(perform: playlist == nil ? nil : { from, to in
                tracks.move(fromOffsets: from, toOffset: to)
                saveOrder()
            })
            if loading { ProgressView().frame(maxWidth: .infinity).listRowSeparator(.hidden) }
            if let error { Text(error).foregroundStyle(.red).font(.caption) }
        }
        .listStyle(.plain)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if playlist != nil {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
            }
        }
        .task {
            do { tracks = try await loader() } catch { self.error = error.localizedDescription }
            loading = false
        }
    }

    /// The playlist's new contents (after a removal or a move) go to the server.
    private func saveOrder() {
        guard let playlist, let c = app.client else { return }
        let ids = tracks.map { $0.id }
        Task {
            try? await c.setPlaylistTracks(playlist.id, songIds: ids)
            await app.refreshPlaylists()
        }
    }

    private func start(shuffled: Bool) {
        guard !tracks.isEmpty else { return }
        let list = shuffled ? tracks.shuffled() : tracks
        app.play(list, at: 0)
    }
}

extension View {
    /// The navigation targets every tab shares.
    func libraryDestinations() -> some View {
        navigationDestination(for: Album.self) { AlbumDetailView(album: $0) }
            .navigationDestination(for: Artist.self) { ArtistDetailView(artist: $0) }
            .navigationDestination(for: Playlist.self) { p in
                PlaylistScreen(playlist: p)
            }
            .navigationDestination(for: DirEntry.self) { DirectoryScreen(entry: $0) }
    }
}

