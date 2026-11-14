import Foundation

enum SongSort: String, CaseIterable, Identifiable {
    case title, artist, album, year, added, plays, length, bpm, random
    var id: String { rawValue }

    var label: String {
        switch self {
        case .title: return String(localized: "Title")
        case .artist: return String(localized: "Artist")
        case .album: return String(localized: "Album")
        case .year: return String(localized: "Year")
        case .added: return String(localized: "Date added")
        case .plays: return String(localized: "Play count")
        case .length: return String(localized: "Length")
        case .bpm: return "BPM"
        case .random: return String(localized: "Random")
        }
    }

    /// The field of Navidrome's /api/song.
    var field: String {
        switch self {
        case .title: return "title"
        case .artist: return "artist"
        case .album: return "album"
        case .year: return "year"
        case .added: return "createdAt"
        case .plays: return "playCount"
        case .length: return "duration"
        case .bpm: return "bpm"
        case .random: return "random"
        }
    }

    var ascByDefault: Bool { self != .year && self != .added && self != .plays }
}

/// What the songs are narrowed to. The range ones (a decade, a BPM range, never played) are found by a search in the
/// list sorted by that field; the others are done by the server.
enum SongFilter: Hashable {
    case all, favorites, unplayed
    case genre(id: String, name: String)
    /// Every song the artist is on, with the compilations and the guest appearances.
    case artist(id: String, name: String)
    case decade(from: Int, to: Int, label: String)
    case bpm(from: Int, to: Int?, label: String)

    var key: String {
        switch self {
        case .all: return "all"
        case .favorites: return "fav"
        case .unplayed: return "unplayed"
        case .genre(let id, _): return "g:\(id)"
        case .artist(let id, _): return "a:\(id)"
        case .decade(let f, let t, _): return "y:\(f)-\(t)"
        case .bpm(let f, let t, _): return "b:\(f)-\(t.map(String.init) ?? "")"
        }
    }

    var label: String {
        switch self {
        case .all: return String(localized: "All songs")
        case .favorites: return String(localized: "Favorites")
        case .unplayed: return String(localized: "Never played")
        case .genre(_, let name), .artist(_, let name): return name
        case .decade(_, _, let l), .bpm(_, _, let l): return l
        }
    }

    /// (field, min, max) of a filter that is a range on a number.
    var range: (field: String, min: Int, max: Int?)? {
        switch self {
        case .unplayed: return ("playCount", 0, 0)
        case .decade(let f, let t, _): return ("year", f, t)
        case .bpm(let f, let t, _): return ("bpm", f, t)
        default: return nil
        }
    }
}

struct SongQuery: Equatable {
    var search = ""
    var filter: SongFilter = .all
    var sort: SongSort = .title
    var asc = true
    var key: String { "\(search)|\(filter.key)|\(sort.rawValue)|\(asc)" }
}

/// Navidrome's own API (/api/song): the server sorts, searches and filters and hands out a page at a time, so even a
/// library of tens of thousands of songs needs no copy on the phone. It does not take the Subsonic token directly:
/// through the Icosahedron server the token is enough (the header the engine reads); without it the saved password signs
/// in once for a JWT.
final class NativeAPI {
    static let shared = NativeAPI()

    private let session = URLSession(configuration: .default)
    private var forKey = ""
    private var ready = false
    private var viaJWT = false
    private var jwt: String?

    private func header(_ c: SubsonicClient) -> (String, String) {
        if viaJWT, let jwt { return ("x-nd-authorization", "Bearer \(jwt)") }
        var comps = URLComponents()
        comps.queryItems = c.syncAuth().map { URLQueryItem(name: $0.key, value: $0.value) }
        return ("Authorization", "Subsonic " + (comps.percentEncodedQuery ?? ""))
    }

    private func request(_ c: SubsonicClient, _ path: String, _ items: [URLQueryItem]) -> URLRequest? {
        guard var comps = URLComponents(url: c.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else { return nil }
        comps.queryItems = items
        guard let url = comps.url else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 25
        let h = header(c)
        req.setValue(h.1, forHTTPHeaderField: h.0)
        return req
    }

    private func login(_ c: SubsonicClient) async -> (status: Int, token: String?) {
        guard let password = Keychain.get(c.username),
              let url = URL(string: c.baseURL.absoluteString + "/auth/login") else { return (0, nil) }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["username": c.username, "password": password])
        guard let (data, resp) = try? await session.data(for: req), let http = resp as? HTTPURLResponse else { return (0, nil) }
        let token = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["token"] as? String
        return (http.statusCode, http.statusCode == 200 ? token : nil)
    }

    /// Finds a way to sign in to the native API: the Subsonic header (through the Icosahedron server), else the JWT.
    func ensure(_ c: SubsonicClient) async -> Bool {
        let key = c.baseURL.absoluteString + "|" + c.username
        if forKey != key { forKey = key; ready = false; viaJWT = false; jwt = nil }
        if ready { return true }
        if let req = request(c, "api/song", [URLQueryItem(name: "_start", value: "0"), URLQueryItem(name: "_end", value: "1")]),
           let (_, resp) = try? await session.data(for: req), let http = resp as? HTTPURLResponse {
            if http.statusCode == 200 { ready = true; viaJWT = false; return true }
            if http.statusCode == 404 { return false }
        } else { return false }
        let (_, token) = await login(c)
        guard let token else { return false }
        jwt = token; viaJWT = true; ready = true
        return true
    }

    private func get(_ c: SubsonicClient, _ path: String, _ items: [URLQueryItem], retry: Bool = true) async throws -> (rows: [[String: Any]], total: Int) {
        guard let req = request(c, path, items) else { throw SubsonicError.badResponse }
        let (data, resp) = try await session.data(for: req)
        let http = resp as? HTTPURLResponse
        if http?.statusCode == 401, viaJWT, retry { // the JWT ran out: sign in again
            if let token = await login(c).token { jwt = token; return try await get(c, path, items, retry: false) }
        }
        guard let http, http.statusCode == 200 else { throw SubsonicError.http(http?.statusCode ?? 0) }
        let rows = (try JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
        return (rows, Int(http.value(forHTTPHeaderField: "x-total-count") ?? "") ?? rows.count)
    }

    private func items(_ q: SongQuery, field: String, asc: Bool, start: Int, end: Int) -> [URLQueryItem] {
        var out = [
            URLQueryItem(name: "_start", value: String(start)), URLQueryItem(name: "_end", value: String(end)),
            URLQueryItem(name: "_sort", value: field), URLQueryItem(name: "_order", value: asc ? "ASC" : "DESC"),
        ]
        let s = q.search.trimmingCharacters(in: .whitespaces)
        if !s.isEmpty { out.append(URLQueryItem(name: "title", value: s)) } // Navidrome matches it against the title, the artist and the album
        switch q.filter {
        case .genre(let id, _): out.append(URLQueryItem(name: "genre_id", value: id))
        case .artist(let id, _): out.append(URLQueryItem(name: "artist_id", value: id))
        case .favorites: out.append(URLQueryItem(name: "starred", value: "true"))
        default: break
        }
        return out
    }

    /// One page. For a range filter the numbers are positions in the list sorted by the range's field (see `slice`).
    func page(_ c: SubsonicClient, _ q: SongQuery, start: Int, end: Int) async throws -> [Track] {
        let r = q.filter.range
        let rows = try await get(c, "api/song", r != nil
            ? items(q, field: r!.field, asc: true, start: start, end: end)
            : items(q, field: q.sort.field, asc: q.sort == .random ? true : q.asc, start: start, end: end)).rows
        return rows.compactMap { Track(native: $0) }
    }

    /// The number of songs under a query; for a range filter where they sit in the sorted list: [from, to).
    func slice(_ c: SubsonicClient, _ q: SongQuery) async throws -> (from: Int, to: Int) {
        guard let r = q.filter.range else {
            return (0, try await get(c, "api/song", items(q, field: q.sort.field, asc: true, start: 0, end: 1)).total)
        }
        let total = try await get(c, "api/song", items(q, field: r.field, asc: true, start: 0, end: 1)).total
        // The first position where the field is at least `min` (or above `max`): a search in the sorted list, one song per step
        func valueAt(_ i: Int) async throws -> Int {
            let row = try await get(c, "api/song", items(q, field: r.field, asc: true, start: i, end: i + 1)).rows.first
            return row.flatMap { J.int($0, r.field) } ?? 0
        }
        func firstWhere(_ pass: (Int) -> Bool) async throws -> Int {
            var lo = 0, hi = total
            while lo < hi {
                let mid = (lo + hi) / 2
                if pass(try await valueAt(mid)) { hi = mid } else { lo = mid + 1 }
            }
            return lo
        }
        let from = try await firstWhere { $0 >= r.min }
        let to = r.max == nil ? total : try await firstWhere { $0 > r.max! }
        return (from, to)
    }

    /// Every album the artist is on as Navidrome counts it (its own, the compilations, where it only appears), with the album artist's id.
    func artistAlbums(_ c: SubsonicClient, _ artistId: String) async throws -> [(album: Album, albumArtistId: String?)] {
        let rows = try await get(c, "api/album", [
            URLQueryItem(name: "_start", value: "0"), URLQueryItem(name: "_end", value: "1000"),
            URLQueryItem(name: "_sort", value: "name"), URLQueryItem(name: "_order", value: "ASC"),
            URLQueryItem(name: "artist_id", value: artistId),
        ]).rows
        return rows.compactMap { r in Album(native: r).map { ($0, J.str(r, "albumArtistId")) } }
    }

    /// All the artist's songs in album order, up to `limit`.
    func artistSongs(_ c: SubsonicClient, _ artistId: String, limit: Int = 3000) async throws -> [Track] {
        var out: [Track] = []
        var q = SongQuery(); q.filter = .artist(id: artistId, name: ""); q.sort = .album
        while out.count < limit {
            let page = try await page(c, q, start: out.count, end: out.count + 500)
            out += page
            if page.count < 500 { break }
        }
        return out.sorted {
            ($0.album ?? "", $0.discNumber, $0.trackNumber) < ($1.album ?? "", $1.discNumber, $1.trackNumber)
        }
    }

    /// The songs for "Play" on an artist: all of them through the server's own API, else those of the artist's own albums.
    func allSongs(_ c: SubsonicClient, artistId: String) async -> [Track] {
        if await ensure(c), let all = try? await artistSongs(c, artistId), !all.isEmpty { return all }
        var out: [Track] = []
        for album in ((try? await c.artist(artistId))?.1 ?? []).prefix(60) {
            out += (try? await c.album(album.id))?.1 ?? []
        }
        return out
    }

    func genres(_ c: SubsonicClient) async throws -> [(id: String, name: String)] {
        let rows = try await get(c, "api/genre", [
            URLQueryItem(name: "_start", value: "0"), URLQueryItem(name: "_end", value: "2000"),
            URLQueryItem(name: "_sort", value: "name"), URLQueryItem(name: "_order", value: "ASC"),
        ]).rows
        return rows.compactMap { r in J.str(r, "id").map { ($0, J.str(r, "name") ?? $0) } }
    }

    /// A random selection for Shuffle: from the whole query, or from a window of the slice for a range filter.
    func shuffled(_ c: SubsonicClient, _ q: SongQuery, count: Int = 300) async throws -> [Track] {
        if q.filter.range == nil {
            var r = q; r.sort = .random
            return try await page(c, r, start: 0, end: count)
        }
        let (from, to) = try await slice(c, q)
        guard to > from else { return [] }
        let span = to - from
        let start = span > count ? from + Int.random(in: 0...(span - count)) : from
        return try await page(c, q, start: start, end: min(start + count, to)).shuffled()
    }
}
