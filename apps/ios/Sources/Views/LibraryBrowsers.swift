import SwiftUI

// Albums and Artists in the Library: sort, filter, grid or list, and a letter index to jump by.
// The server does the sorting it can (getAlbumList2 types); a filtered list is loaded whole and
// sorted here. Phone-side only: nothing here needs a newer server.

// MARK: - Albums

/// How the albums are ordered. The raw value is the server's list type.
enum AlbumSort: String, CaseIterable, Identifiable {
    case name = "alphabeticalByName"
    case albumArtist = "alphabeticalByArtist"
    case added = "newest"
    case mostPlayed = "frequent"
    case recentlyPlayed = "recent"
    case random = "random"
    case year = "byYear"

    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .name: return "Name"
        case .albumArtist: return "Album Artist"
        case .added: return "Date Added"
        case .mostPlayed: return "Most Played"
        case .recentlyPlayed: return "Recently Played"
        case .random: return "Random"
        case .year: return "Release Year"
        }
    }

    /// The letter index only makes sense when the order is alphabetical.
    var hasIndex: Bool { self == .name || self == .albumArtist }

    /// A filtered list is sorted on the phone, which only knows these.
    var worksFiltered: Bool { self == .name || self == .albumArtist || self == .year || self == .random }
}

enum AlbumFilter: Equatable {
    case all
    case favorites
    case genre(String)
    case years(label: String, from: Int, to: Int)

    var key: String {
        switch self {
        case .all: return "all"
        case .favorites: return "fav"
        case .genre(let g): return "genre:" + g
        case .years(_, let f, let t): return "years:\(f)-\(t)"
        }
    }

    var label: String? {
        switch self {
        case .all: return nil
        case .favorites: return String(localized: "Favorites")
        case .genre(let g): return g
        case .years(let l, _, _): return l
        }
    }
}

struct AlbumsBrowser: View {
    @Environment(AppModel.self) private var app
    @AppStorage("browseGrid") private var grid = true
    @State private var sort: AlbumSort
    @State private var filter: AlbumFilter = .all
    @State private var albums: [Album] = []
    @State private var loading = false
    @State private var genres: [String] = []

    init(sort: AlbumSort = .name) { _sort = State(initialValue: sort) }

    private static let decades: [AlbumFilter] = [
        .years(label: "2020s", from: 2020, to: 2029), .years(label: "2010s", from: 2010, to: 2019),
        .years(label: "2000s", from: 2000, to: 2009), .years(label: "1990s", from: 1990, to: 1999),
        .years(label: "1980s", from: 1980, to: 1989), .years(label: "1970s", from: 1970, to: 1979),
        .years(label: "1960s", from: 1960, to: 1969), .years(label: "1950s", from: 1950, to: 1959),
        .years(label: "Earlier", from: 1, to: 1949),
    ]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 14, alignment: .top)]

    var body: some View {
        ScrollViewReader { proxy in
            ZStack(alignment: .trailing) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        summary
                        if grid {
                            LazyVGrid(columns: columns, spacing: 18) {
                                ForEach(albums) { a in
                                    NavigationLink(value: a) { AlbumCard(album: a, width: 160) }
                                        .buttonStyle(.plain).id(a.id)
                                }
                            }
                        } else {
                            LazyVStack(spacing: 0) {
                                ForEach(albums) { a in
                                    NavigationLink(value: a) { row(a) }.buttonStyle(.plain).id(a.id)
                                    Divider()
                                }
                            }
                        }
                    }
                    .padding(.leading)
                    .padding(.trailing, sort.hasIndex ? 28 : 16)
                    .padding(.bottom, 16)
                }
                if sort.hasIndex && letters.count > 1 {
                    LetterIndex(letters: letters) { l in
                        if let first = albums.first(where: { letter($0) == l }) { proxy.scrollTo(first.id, anchor: .top) }
                    }
                    .padding(.trailing, 4)
                }
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                sortMenu
                filterMenu
                Button { grid.toggle() } label: { Image(systemName: grid ? "list.bullet" : "square.grid.2x2") }
            }
        }
        .task { if genres.isEmpty { genres = (try? await app.client?.genres()) ?? [] } }
        .task(id: sort.rawValue + "|" + filter.key) { await load() }
    }

    // MARK: Parts

    private var summary: some View {
        HStack(spacing: 8) {
            if let l = filter.label { Text(l).font(.subheadline.weight(.semibold)) ; Text("·").foregroundStyle(.secondary) }
            Text("\(albums.count) albums").font(.subheadline).foregroundStyle(.secondary)
            if loading { ProgressView().controlSize(.small) }
            Spacer()
        }
        .padding(.top, 4)
    }

    private func row(_ a: Album) -> some View {
        HStack(spacing: 12) {
            CoverImage(id: a.coverArt, size: 120)
                .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(a.name).font(.body).lineLimit(2)
                Text([a.artist, a.year.map(String.init)].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private var sortMenu: some View {
        Menu {
            ForEach(AlbumSort.allCases) { s in
                Button { sort = s } label: {
                    if sort == s { Label(s.title, systemImage: "checkmark") } else { Text(s.title) }
                }
                .disabled(filter != .all && !s.worksFiltered)
            }
        } label: { Image(systemName: "arrow.up.arrow.down") }
    }

    private var filterMenu: some View {
        Menu {
            Button { setFilter(.all) } label: {
                if filter == .all { Label("All albums", systemImage: "checkmark") } else { Text("All albums") }
            }
            Button { setFilter(.favorites) } label: {
                if filter == .favorites { Label("Favorites", systemImage: "checkmark") } else { Text("Favorites") }
            }
            if !genres.isEmpty {
                Menu("Genres") {
                    ForEach(genres, id: \.self) { g in
                        Button { setFilter(.genre(g)) } label: {
                            if filter == .genre(g) { Label(g, systemImage: "checkmark") } else { Text(verbatim: g) }
                        }
                    }
                }
            }
            Menu("Years") {
                ForEach(Self.decades, id: \.key) { d in
                    Button { setFilter(d) } label: {
                        if filter == d { Label(d.label ?? "", systemImage: "checkmark") } else { Text(verbatim: d.label ?? "") }
                    }
                }
            }
        } label: {
            Image(systemName: filter == .all ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
    }

    private func setFilter(_ f: AlbumFilter) {
        filter = f
        // The server-only orders do not apply to a filtered list.
        if f != .all && !sort.worksFiltered { sort = .name }
    }

    // MARK: Letters

    private func letter(_ a: Album) -> String {
        let s = (sort == .albumArtist ? a.artist : a.name).trimmingCharacters(in: .whitespaces)
        guard let f = s.first.map({ String($0).folding(options: .diacriticInsensitive, locale: nil).uppercased() })?.first else { return "#" }
        return f.isLetter ? String(f) : "#"
    }

    private var letters: [String] {
        let set = Set(albums.map { letter($0) })
        return set.sorted { a, b in
            if a == "#" { return true }
            if b == "#" { return false }
            return a < b
        }
    }

    // MARK: Loading

    private func load() async {
        guard let c = app.client else { return }
        albums = []
        loading = true
        defer { loading = false }
        do {
            switch filter {
            case .all:
                if sort == .random {
                    albums = try await c.albums(type: "random", size: 200)
                } else {
                    try await pages(c, type: sort.rawValue, fromYear: sort == .year ? 3000 : nil, toYear: sort == .year ? 1 : nil, genre: nil, sorted: false)
                }
            case .favorites:
                albums = sorted(try await c.starredAlbumsAndArtists().albums)
            case .genre(let g):
                try await pages(c, type: "byGenre", fromYear: nil, toYear: nil, genre: g, sorted: true)
            case .years(_, let from, let to):
                try await pages(c, type: "byYear", fromYear: from, toYear: to, genre: nil, sorted: true)
            }
        } catch {
            // cancelled by a new sort or filter, or the server is out of reach: keep what is shown
        }
    }

    /// Every page of a list, shown as it arrives.
    private func pages(_ c: SubsonicClient, type: String, fromYear: Int?, toYear: Int?, genre: String?, sorted doSort: Bool) async throws {
        var offset = 0
        var all: [Album] = []
        while offset < 10_000 {
            let page = try await c.albums(type: type, size: 500, offset: offset, genre: genre, fromYear: fromYear, toYear: toYear)
            try Task.checkCancellation()
            all += page
            albums = doSort ? sorted(all) : all
            if page.count < 500 { break }
            offset += 500
        }
    }

    private func sorted(_ list: [Album]) -> [Album] {
        switch sort {
        case .albumArtist:
            return list.sorted {
                let c = $0.artist.localizedCaseInsensitiveCompare($1.artist)
                return c != .orderedSame ? c == .orderedAscending : $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
        case .year:
            return list.sorted { ($0.year ?? 0) != ($1.year ?? 0) ? ($0.year ?? 0) > ($1.year ?? 0) : $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .random:
            return list.shuffled()
        default:
            return list.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        }
    }
}

// MARK: - Artists

enum ArtistSort: String, CaseIterable, Identifiable {
    case name, mostAlbums, random
    var id: String { rawValue }
    var title: LocalizedStringKey {
        switch self {
        case .name: return "Name"
        case .mostAlbums: return "Most albums"
        case .random: return "Random"
        }
    }
}

struct ArtistsBrowser: View {
    @Environment(AppModel.self) private var app
    @AppStorage("browseGrid") private var grid = false
    @State private var sort: ArtistSort = .name
    @State private var favoritesOnly = false
    @State private var all: [Artist] = []
    @State private var favoriteIds: Set<String> = []
    @State private var shuffled: [Artist] = []
    @State private var loading = true

    private let columns = [GridItem(.adaptive(minimum: 110), spacing: 14, alignment: .top)]

    private var artists: [Artist] {
        var list = favoritesOnly ? all.filter { favoriteIds.contains($0.id) } : all
        switch sort {
        case .name: list.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .mostAlbums: list.sort { $0.albumCount != $1.albumCount ? $0.albumCount > $1.albumCount : $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .random:
            let order = Dictionary(uniqueKeysWithValues: shuffled.enumerated().map { ($1.id, $0) })
            list.sort { (order[$0.id] ?? 0) < (order[$1.id] ?? 0) }
        }
        return list
    }

    var body: some View {
        let list = artists
        let letters = letterList(list)
        ScrollViewReader { proxy in
            ZStack(alignment: .trailing) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            if favoritesOnly { Text("Favorites").font(.subheadline.weight(.semibold)); Text("·").foregroundStyle(.secondary) }
                            Text("\(list.count) artists").font(.subheadline).foregroundStyle(.secondary)
                            if loading { ProgressView().controlSize(.small) }
                            Spacer()
                        }
                        .padding(.top, 4)
                        if grid {
                            LazyVGrid(columns: columns, spacing: 18) {
                                ForEach(list) { a in
                                    NavigationLink(value: a) { tile(a) }.buttonStyle(.plain).id(a.id)
                                }
                            }
                        } else {
                            LazyVStack(spacing: 0) {
                                ForEach(list) { a in
                                    NavigationLink(value: a) { row(a) }.buttonStyle(.plain).id(a.id)
                                    Divider()
                                }
                            }
                        }
                    }
                    .padding(.leading)
                    .padding(.trailing, sort == .name ? 28 : 16)
                    .padding(.bottom, 16)
                }
                if sort == .name && letters.count > 1 {
                    LetterIndex(letters: letters) { l in
                        if let first = list.first(where: { letter($0) == l }) { proxy.scrollTo(first.id, anchor: .top) }
                    }
                    .padding(.trailing, 4)
                }
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    ForEach(ArtistSort.allCases) { s in
                        Button {
                            sort = s
                            if s == .random { shuffled = all.shuffled() }
                        } label: {
                            if sort == s { Label(s.title, systemImage: "checkmark") } else { Text(s.title) }
                        }
                    }
                } label: { Image(systemName: "arrow.up.arrow.down") }
                Button { favoritesOnly.toggle() } label: { Image(systemName: favoritesOnly ? "heart.fill" : "heart") }
                Button { grid.toggle() } label: { Image(systemName: grid ? "list.bullet" : "square.grid.2x2") }
            }
        }
        .task {
            guard all.isEmpty, let c = app.client else { return }
            all = (try? await c.artists()) ?? []
            shuffled = all.shuffled()
            loading = false
            favoriteIds = Set(((try? await c.starredAlbumsAndArtists())?.artists ?? []).map(\.id))
        }
    }

    private func row(_ a: Artist) -> some View {
        HStack(spacing: 12) {
            CoverImage(id: a.coverArt, size: 120)
                .frame(width: 52, height: 52).clipShape(Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(a.name).font(.body).lineLimit(1)
                Text("\(a.albumCount) albums").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private func tile(_ a: Artist) -> some View {
        VStack(spacing: 6) {
            CoverImage(id: a.coverArt, size: 300)
                .frame(width: 110, height: 110).clipShape(Circle())
            Text(a.name).font(.subheadline.weight(.semibold)).lineLimit(1)
            Text("\(a.albumCount) albums").font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: 110)
    }

    private func letter(_ a: Artist) -> String {
        let s = a.name.trimmingCharacters(in: .whitespaces)
        guard let f = s.first.map({ String($0).folding(options: .diacriticInsensitive, locale: nil).uppercased() })?.first else { return "#" }
        return f.isLetter ? String(f) : "#"
    }

    private func letterList(_ list: [Artist]) -> [String] {
        Set(list.map { letter($0) }).sorted { a, b in
            if a == "#" { return true }
            if b == "#" { return false }
            return a < b
        }
    }
}

// MARK: - Letter index

/// The A–Z strip on the right edge: touch or drag along it to jump.
struct LetterIndex: View {
    let letters: [String]
    let onPick: (String) -> Void
    @State private var last: String?

    var body: some View {
        GeometryReader { geo in
            let step = geo.size.height / CGFloat(max(letters.count, 1))
            VStack(spacing: 0) {
                ForEach(letters, id: \.self) { l in
                    Text(l)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                        .frame(maxWidth: .infinity)
                        .frame(height: step)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        let i = Int(v.location.y / step)
                        guard letters.indices.contains(i), letters[i] != last else { return }
                        last = letters[i]
                        onPick(letters[i])
                    }
                    .onEnded { _ in last = nil }
            )
        }
        .frame(width: 22)
        .frame(maxHeight: min(CGFloat(letters.count) * 17, 520))
    }
}
