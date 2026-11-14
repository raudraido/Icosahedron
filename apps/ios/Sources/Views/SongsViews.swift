import SwiftUI

/// Songs: the server does the work (Navidrome's own API), so this is search, quick views, sort and filters on any library size.
struct SongsScreen: View {
    @Environment(AppModel.self) private var app
    @State private var ready: Bool?

    var body: some View {
        Group {
            switch ready {
            case nil:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case true?:
                NativeSongsView()
            case false?:
                VStack(spacing: 0) {
                    Text("Sorting and filters need the server's own API, which is not reachable here. This is the plain list.")
                        .font(.footnote).foregroundStyle(.secondary).padding()
                    BasicSongsScreen()
                }
            }
        }
        .navigationTitle("Songs")
        .navigationBarTitleDisplayMode(.inline)
        .task { if let c = app.client { ready = await NativeAPI.shared.ensure(c) } else { ready = false } }
    }
}

struct NativeSongsView: View {
    @Environment(AppModel.self) private var app
    /// A page of one artist's songs: the filter is fixed, in album order, with no quick views and no sort or filter menus.
    var fixedFilter: SongFilter?

    init(fixedFilter: SongFilter? = nil) {
        self.fixedFilter = fixedFilter
        _filter = State(initialValue: fixedFilter ?? .all)
    }

    @AppStorage("songSort") private var sortRaw = SongSort.title.rawValue
    @AppStorage("songSortAsc") private var asc = true
    @State private var search = ""
    @State private var debounced = ""
    @State private var filter: SongFilter
    @State private var songs: [Track] = []
    @State private var total = 0
    @State private var base = 0
    @State private var loading = false
    @State private var failed = false
    @State private var genres: [(id: String, name: String)] = []
    private let pageSize = 100

    private var sort: SongSort { fixedFilter != nil ? .album : (SongSort(rawValue: sortRaw) ?? .title) }
    private var query: SongQuery { SongQuery(search: debounced, filter: filter, sort: sort, asc: fixedFilter != nil ? true : asc) }

    private static let decades: [SongFilter] = [
        .decade(from: 2020, to: 2029, label: "2020s"), .decade(from: 2010, to: 2019, label: "2010s"),
        .decade(from: 2000, to: 2009, label: "2000s"), .decade(from: 1990, to: 1999, label: "1990s"),
        .decade(from: 1980, to: 1989, label: "1980s"), .decade(from: 1970, to: 1979, label: "1970s"),
        .decade(from: 1960, to: 1969, label: "1960s"), .decade(from: 1950, to: 1959, label: "1950s"),
    ]
    private static let bpmRanges: [SongFilter] = [
        .bpm(from: 1, to: 89, label: "BPM under 90"), .bpm(from: 90, to: 109, label: "BPM 90–110"), .bpm(from: 110, to: 129, label: "BPM 110–130"),
        .bpm(from: 130, to: 149, label: "BPM 130–150"), .bpm(from: 150, to: 169, label: "BPM 150–170"), .bpm(from: 170, to: 180, label: "BPM 170–180"),
        .bpm(from: 181, to: nil, label: "BPM over 180"),
    ]

    var body: some View {
        List {
            if fixedFilter == nil { chips.listRowSeparator(.hidden).listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16)) }
            summary.listRowSeparator(.hidden)
            if failed { Text("Could not load the songs.").foregroundStyle(Theme.accent).listRowSeparator(.hidden) }
            if !loading, !failed, total == 0 { Text("No songs match.").foregroundStyle(.secondary).listRowSeparator(.hidden) }
            ForEach(Array(songs.enumerated()), id: \.offset) { i, t in
                Button { app.play(songs, at: i) } label: {
                    TrackRow(track: t, showCover: true, subtitleOverride: subtitle(t), trailing: trailing(t))
                }
                .buttonStyle(.plain)
                .onAppear { if i >= songs.count - 10 { Task { await more() } } }
            }
            if loading { ProgressView().frame(maxWidth: .infinity).listRowSeparator(.hidden) }
        }
        .listStyle(.plain)
        .searchable(text: $search, prompt: "Search songs, artists, albums")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) { if fixedFilter == nil { sortMenu; filterMenu } }
        }
        .task(id: search) {
            try? await Task.sleep(nanoseconds: 350_000_000)
            if !Task.isCancelled { debounced = search.trimmingCharacters(in: .whitespaces) }
        }
        .task { if let c = app.client { genres = (try? await NativeAPI.shared.genres(c)) ?? [] } }
        .task(id: query.key) { await reload() }
    }

    // MARK: Pieces

    private func subtitle(_ t: Track) -> String {
        [t.artist, t.album].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// The value the list is sorted by, at the right of each row.
    private func trailing(_ t: Track) -> String? {
        switch filter.range?.field ?? sort.field {
        case "playCount": return String(localized: "\(t.playCount ?? 0) plays")
        case "year": return t.year.map(String.init)
        case "bpm": return t.bpm.map { "\($0) BPM" } ?? app.bpm[t.id].map { String(format: "%.0f BPM", $0) }
        case "createdAt": return t.created.map { String($0.prefix(10)) }
        default: return nil
        }
    }

    private func quick(_ f: SongFilter, _ s: SongSort, _ a: Bool) { filter = f; sortRaw = s.rawValue; asc = a }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All", filter == .all && sort == .title) { quick(.all, .title, true) }
                chip("Recently added", filter == .all && sort == .added) { quick(.all, .added, false) }
                chip("Most played", filter == .all && sort == .plays) { quick(.all, .plays, false) }
                chip("Never played", filter == .unplayed) { quick(.unplayed, sort, asc) }
                chip("Favorites", filter == .favorites) { quick(.favorites, sort, asc) }
                chip("Random", sort == .random) { quick(.all, .random, true) }
            }
        }
    }

    private func chip(_ title: LocalizedStringKey, _ on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.subheadline)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(on ? Theme.accent : Color.white.opacity(0.1), in: Capsule())
                .foregroundStyle(on ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text([filter == .all ? nil : filter.label, loading && songs.isEmpty ? "…" : String(localized: "\(total.formatted()) songs")].compactMap { $0 }.joined(separator: " · "))
                .font(.footnote).foregroundStyle(.secondary)
            HStack(spacing: 12) {
                Button { if !songs.isEmpty { app.play(songs, at: 0) } } label: { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent).disabled(songs.isEmpty)
                Button { shuffle() } label: { Label("Shuffle", systemImage: "shuffle").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered).disabled(total == 0)
            }
        }
    }

    private var sortMenu: some View {
        Menu {
            if let r = filter.range {
                Text("Sorted by \(r.field)")
            } else {
                ForEach(SongSort.allCases) { s in
                    Button {
                        if s == sort, s != .random { asc.toggle() } else { sortRaw = s.rawValue; asc = s.ascByDefault }
                    } label: {
                        if s == sort { Label(s.label + (s == .random ? "" : (asc ? " ↑" : " ↓")), systemImage: "checkmark") } else { Text(s.label) }
                    }
                }
            }
        } label: { Image(systemName: "arrow.up.arrow.down") }
    }

    private var filterMenu: some View {
        Menu {
            filterItem(.all)
            filterItem(.favorites)
            filterItem(.unplayed)
            Menu("Decade") { ForEach(Self.decades, id: \.self) { filterItem($0) } }
            Menu("BPM") { ForEach(Self.bpmRanges, id: \.self) { filterItem($0) } }
            if !genres.isEmpty {
                Menu("Genre") { ForEach(genres, id: \.id) { filterItem(.genre(id: $0.id, name: $0.name)) } }
            }
        } label: { Image(systemName: filter == .all ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill") }
    }

    private func filterItem(_ f: SongFilter) -> some View {
        Button { filter = f } label: {
            if filter == f { Label(f.label, systemImage: "checkmark") } else { Text(f.label) }
        }
    }

    // MARK: Loading

    private func reload() async {
        guard let c = app.client else { return }
        songs = []; total = 0; base = 0; failed = false; loading = true
        let q = query
        do {
            let (from, to) = try await NativeAPI.shared.slice(c, q)
            if Task.isCancelled { return }
            if q.filter.range != nil { base = from; total = to - from } else { base = 0; total = to }
        } catch {
            if Task.isCancelled { return }
            failed = true
        }
        loading = false
        await more()
    }

    private func more() async {
        guard let c = app.client, !loading, songs.count < total else { return }
        loading = true
        let q = query
        do {
            let page = try await NativeAPI.shared.page(c, q, start: base + songs.count, end: base + min(songs.count + pageSize, total))
            if !Task.isCancelled, q == query { songs += page }
        } catch {
            if !Task.isCancelled { failed = true }
        }
        loading = false
    }

    private func shuffle() {
        guard let c = app.client else { return }
        let q = query
        Task {
            if let list = try? await NativeAPI.shared.shuffled(c, q), !list.isEmpty { app.play(list, at: 0) }
        }
    }
}
