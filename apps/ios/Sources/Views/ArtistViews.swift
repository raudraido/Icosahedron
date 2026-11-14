import SwiftUI

/// An artist: the picture, play / shuffle / the queue for all the songs (the compilations and guest appearances too), the
/// biography, the popular songs, the albums, the singles and EPs, the compilations, where the artist only appears, and the
/// similar artists that are in the library. Everything comes from the server, so it works without the Icosahedron server; the text,
/// the popular songs and the similar artists come from what Navidrome is set up to use (Last.fm, Spotify) and are left out when
/// it has none.
struct ArtistDetailView: View {
    @Environment(AppModel.self) private var app
    let artist: Artist
    @State private var detail: Artist?
    @State private var own: [Album] = []
    @State private var others: [Album] = []
    @State private var info: ArtistInfo?
    @State private var top: [Track] = []
    @State private var native = false
    @State private var fav = false
    @State private var busy = false
    @State private var bioOpen = false
    @State private var loaded = false

    private var shown: Artist { detail ?? artist }

    private static func byYear(_ a: Album, _ b: Album) -> Bool {
        (a.year ?? 0, b.name) > (b.year ?? 0, a.name)
    }

    private var albums: [Album] { own.filter { !$0.isSingleOrEp && !$0.isCompilation }.sorted(by: Self.byYear) }
    private var singles: [Album] { own.filter { $0.isSingleOrEp && !$0.isCompilation }.sorted(by: Self.byYear) }
    private var compilations: [Album] {
        var seen = Set<String>()
        return (own.filter { $0.isCompilation } + others.filter { $0.isCompilation }).filter { seen.insert($0.id).inserted }.sorted(by: Self.byYear)
    }
    private var appearsOn: [Album] { others.filter { !$0.isCompilation }.sorted(by: Self.byYear) }
    private var bio: String { info?.biography ?? "" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                actions
                if !bio.isEmpty { about }
                if !top.isEmpty { popular } else if native { allSongsLink }
                AlbumShelf(title: "Albums", albums: albums)
                AlbumShelf(title: "Singles & EPs", albums: singles)
                AlbumShelf(title: "Compilations", albums: compilations)
                AlbumShelf(title: "Appears on", albums: appearsOn)
                if let similar = info?.similar, !similar.isEmpty { similarStrip(similar) }
            }
            .padding(.bottom, 24)
        }
        .navigationTitle(shown.name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: artist.id) { await load() }
    }

    // MARK: Pieces

    private var header: some View {
        HStack(spacing: 16) {
            CoverImage(id: shown.coverArt, size: 400)
                .frame(width: 112, height: 112).clipShape(Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(shown.name).font(.title.bold()).lineLimit(2)
                let songs = own.reduce(0) { $0 + $1.songCount }
                Text([String(localized: "\(max(own.count, shown.albumCount)) albums"), songs > 0 ? String(localized: "\(songs) songs") : nil].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Button { toggleFavorite() } label: {
                Image(systemName: fav ? "heart.fill" : "heart").font(.title2).foregroundStyle(fav ? Theme.accent : Color.primary)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(LocalizedStringKey(fav ? "Remove Favorite" : "Favorite"))
        }
        .padding(.horizontal)
    }

    private var actions: some View {
        HStack(spacing: 12) {
            Button { run { app.play($0, at: 0) } } label: { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
            Button { run { app.play($0.shuffled(), at: 0) } } label: { Label("Shuffle", systemImage: "shuffle").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered)
            Menu {
                CollectionMenuItems(kind: "artist", id: shown.id, name: shown.name, subtitle: "", coverArt: shown.coverArt)
            } label: { Image(systemName: "ellipsis").rotationEffect(.degrees(90)).frame(width: 24, height: 22) }
                .buttonStyle(.bordered)
        }
        .disabled(busy)
        .padding(.horizontal)
    }

    private var about: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("About").font(.title3.bold())
            Text(bio).font(.callout).foregroundStyle(.secondary)
                .lineLimit(bioOpen ? nil : 4)
                .onTapGesture { withAnimation(.snappy) { bioOpen.toggle() } }
            HStack(spacing: 18) {
                Button(bioOpen ? "Less" : "More") { withAnimation(.snappy) { bioOpen.toggle() } }
                if let s = info?.lastFmUrl, let url = URL(string: s) { Link("Last.fm", destination: url) }
            }
            .font(.subheadline)
        }
        .padding(.horizontal)
    }

    private var popular: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Popular").font(.title3.bold())
                Spacer()
                if native { allSongsLink }
            }
            .padding(.horizontal)
            ForEach(Array(top.enumerated()), id: \.offset) { i, t in
                Button { app.play(top, at: i) } label: { TrackRow(track: t, showCover: true).padding(.horizontal) }
                    .buttonStyle(.plain)
            }
        }
    }

    private var allSongsLink: some View {
        NavigationLink {
            NativeSongsView(fixedFilter: .artist(id: shown.id, name: shown.name))
                .navigationTitle(shown.name).navigationBarTitleDisplayMode(.inline)
        } label: {
            HStack(spacing: 4) { Text("All songs"); Image(systemName: "chevron.right").font(.caption) }
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(.quaternary, in: Capsule())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, top.isEmpty ? 16 : 0)
    }

    private func similarStrip(_ similar: [Artist]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Similar artists").font(.title3.bold()).padding(.horizontal)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 16) {
                    ForEach(similar) { a in
                        NavigationLink(value: a) {
                            VStack(spacing: 6) {
                                CoverImage(id: a.coverArt, size: 300).frame(width: 88, height: 88).clipShape(Circle())
                                Text(a.name).font(.footnote).lineLimit(2).multilineTextAlignment(.center).frame(width: 96)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    // MARK: Loading and actions

    private func load() async {
        guard let c = app.client else { return }
        async let page = try? c.artist(artist.id)
        async let infoTask = try? c.artistInfo(artist.id)
        if let (a, albums) = await page { detail = a; own = albums; fav = a?.starred ?? false }
        info = await infoTask ?? nil
        top = (try? await c.topSongs(artistName: detail?.name ?? artist.name, count: 5)) ?? []
        // Navidrome's own API knows every song and album the artist is on; without it only the artist's own albums are shown
        native = await NativeAPI.shared.ensure(c)
        if native {
            others = ((try? await NativeAPI.shared.artistAlbums(c, artist.id)) ?? []).filter { $0.albumArtistId != artist.id }.map { $0.album }
        }
        loaded = true
    }

    /// Fetches all the artist's songs when a button needs them.
    private func run(_ action: @escaping ([Track]) -> Void) {
        guard !busy, let c = app.client else { return }
        busy = true
        Task {
            let all = await NativeAPI.shared.allSongs(c, artistId: artist.id)
            if !all.isEmpty { action(all) }
            busy = false
        }
    }

    private func toggleFavorite() {
        guard let c = app.client else { return }
        let on = !fav
        fav = on
        Task { if (try? await c.setArtistStarred(artist.id, on)) == nil { fav = !on } }
    }
}
