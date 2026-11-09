import SwiftUI

/// Cover art for a Subsonic cover id, with a placeholder.
struct CoverImage: View {
    @Environment(AppModel.self) private var app
    let id: String?
    var size: Int = 300

    var body: some View {
        ZStack {
            Theme.card
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
            Text(album.name).font(.subheadline.weight(.semibold)).lineLimit(1)
            Text(album.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: width, alignment: .leading)
    }
}

struct AlbumShelf: View {
    let title: String
    let albums: [Album]

    var body: some View {
        if !albums.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(title).font(.title3.bold()).padding(.horizontal)
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

struct TrackRow: View {
    @Environment(AppModel.self) private var app
    let track: Track
    var number: Int?
    var showCover = false

    var body: some View {
        let playing = app.player.current?.id == track.id
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
                Text(track.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            if playing && app.player.isPlaying {
                Image(systemName: "waveform").foregroundStyle(Theme.accent)
            }
            Text(formatTime(Double(track.duration))).font(.caption).foregroundStyle(.secondary).monospacedDigit()
        }
        .contentShape(Rectangle())
    }
}

/// A scrollable list of tracks with Play / Shuffle; tapping a row plays from there.
struct TrackListScreen: View {
    @Environment(AppModel.self) private var app
    let title: String
    let loader: () async throws -> [Track]
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
                }
                .listRowSeparator(.hidden)
            }
            ForEach(Array(tracks.enumerated()), id: \.offset) { i, t in
                Button { app.player.play(tracks, at: i) } label: { TrackRow(track: t, showCover: true) }
                    .buttonStyle(.plain)
            }
            if loading { ProgressView().frame(maxWidth: .infinity).listRowSeparator(.hidden) }
            if let error { Text(error).foregroundStyle(.red).font(.caption) }
        }
        .listStyle(.plain)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { tracks = try await loader() } catch { self.error = error.localizedDescription }
            loading = false
        }
    }

    private func start(shuffled: Bool) {
        guard !tracks.isEmpty else { return }
        let list = shuffled ? tracks.shuffled() : tracks
        app.player.play(list, at: 0)
    }
}

extension View {
    /// Mini player above the tab bar, plus the navigation targets every tab shares.
    func withMiniPlayer() -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) { MiniPlayerBar() }
    }

    func libraryDestinations() -> some View {
        navigationDestination(for: Album.self) { AlbumDetailView(album: $0) }
            .navigationDestination(for: Artist.self) { ArtistDetailView(artist: $0) }
            .navigationDestination(for: Playlist.self) { p in
                PlaylistScreen(playlist: p)
            }
    }
}
