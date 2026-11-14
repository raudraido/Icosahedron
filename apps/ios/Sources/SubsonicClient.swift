import Foundation
import CryptoKit

enum SubsonicError: LocalizedError {
    case http(Int)
    case api(Int, String)
    case badResponse

    var errorDescription: String? {
        switch self {
        case .http(let c): return "Server answered HTTP \(c)"
        case .api(_, let m): return m
        case .badResponse: return "Unexpected response from the server"
        }
    }
}

/// Subsonic/OpenSubsonic API (Navidrome). Requests go to the web engine's
/// same-origin proxy or straight to a Navidrome server.
final class SubsonicClient {
    let baseURL: URL
    let username: String
    private let salt: String
    private let token: String
    private let session = URLSession(configuration: .default)

    init(baseURL: URL, username: String, password: String) {
        self.baseURL = baseURL
        self.username = username
        // One salt per client: a token stays valid for its salt, and stable URLs
        // (covers, streams) are what lets the URL cache work at all.
        let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        salt = String((0..<10).map { _ in chars[Int.random(in: 0..<chars.count)] })
        let digest = Insecure.MD5.hash(data: Data((password + salt).utf8))
        token = digest.map { String(format: "%02x", $0) }.joined()
    }

    private func authItems(json: Bool = true) -> [URLQueryItem] {
        var items = [
            URLQueryItem(name: "u", value: username),
            URLQueryItem(name: "t", value: token),
            URLQueryItem(name: "s", value: salt),
            URLQueryItem(name: "v", value: "1.16.1"),
            URLQueryItem(name: "c", value: "IcosahedronIOS"),
        ]
        if json { items.append(URLQueryItem(name: "f", value: "json")) }
        return items
    }

    /// Credentials in the shape the sync hub expects.
    func syncAuth() -> [String: String] { ["u": username, "t": token, "s": salt] }

    private func url(_ endpoint: String, _ extra: [URLQueryItem] = [], json: Bool = true) -> URL {
        var comps = URLComponents(url: baseURL.appendingPathComponent("rest/\(endpoint)"), resolvingAgainstBaseURL: false)!
        comps.queryItems = authItems(json: json) + extra
        return comps.url!
    }

    /// Direct play (the original file) or a transcode by the server (Subsonic `format` + `maxBitRate`).
    func streamURL(_ id: String, quality: StreamQuality = .direct) -> URL {
        var items = [URLQueryItem(name: "id", value: id), URLQueryItem(name: "format", value: quality.format)]
        if !quality.isDirect {
            items.append(URLQueryItem(name: "maxBitRate", value: String(quality.bitrate)))
            items.append(URLQueryItem(name: "estimateContentLength", value: "true"))
        }
        return url("stream", items, json: false)
    }

    func coverURL(_ id: String?, size: Int) -> URL? {
        guard let id, !id.isEmpty else { return nil }
        return url("getCoverArt", [URLQueryItem(name: "id", value: id), URLQueryItem(name: "size", value: String(size))], json: false)
    }

    private func call(_ endpoint: String, _ extra: [URLQueryItem] = []) async throws -> [String: Any] {
        let (data, resp) = try await session.data(from: url(endpoint, extra))
        if let h = resp as? HTTPURLResponse, h.statusCode >= 400 { throw SubsonicError.http(h.statusCode) }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let root = json["subsonic-response"] as? [String: Any] else { throw SubsonicError.badResponse }
        if (root["status"] as? String) != "ok" {
            let e = root["error"] as? [String: Any]
            throw SubsonicError.api(J.int(e ?? [:], "code") ?? 0, J.str(e ?? [:], "message") ?? "Request failed")
        }
        return root
    }

    private func item(_ name: String, _ value: String) -> URLQueryItem { URLQueryItem(name: name, value: value) }

    // MARK: Endpoints

    func ping() async throws { _ = try await call("ping") }

    func albums(type: String, size: Int = 40, offset: Int = 0, genre: String? = nil, fromYear: Int? = nil, toYear: Int? = nil) async throws -> [Album] {
        var items = [item("type", type), item("size", String(size)), item("offset", String(offset))]
        if let genre { items.append(item("genre", genre)) }
        if let fromYear { items.append(item("fromYear", String(fromYear))) }
        if let toYear { items.append(item("toYear", String(toYear))) }
        let r = try await call("getAlbumList2", items)
        let list = (r["albumList2"] as? [String: Any]) ?? [:]
        return J.arr(list["album"]).compactMap { Album(subsonic: $0) }
    }

    /// Genre names, for the Albums filter.
    func genres() async throws -> [String] {
        let r = try await call("getGenres")
        let g = (r["genres"] as? [String: Any]) ?? [:]
        return J.arr(g["genre"]).compactMap { J.str($0, "value") }.filter { !$0.isEmpty }.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    /// The favourite albums and artists.
    func starredAlbumsAndArtists() async throws -> (albums: [Album], artists: [Artist]) {
        let r = try await call("getStarred2")
        let s = (r["starred2"] as? [String: Any]) ?? [:]
        return (J.arr(s["album"]).compactMap { Album(subsonic: $0) }, J.arr(s["artist"]).compactMap { Artist(subsonic: $0) })
    }

    func artists() async throws -> [Artist] {
        let r = try await call("getArtists")
        let root = (r["artists"] as? [String: Any]) ?? [:]
        return J.arr(root["index"]).flatMap { J.arr($0["artist"]) }.compactMap { Artist(subsonic: $0) }
    }

    func artist(_ id: String) async throws -> (Artist?, [Album]) {
        let r = try await call("getArtist", [item("id", id)])
        let a = (r["artist"] as? [String: Any]) ?? [:]
        return (Artist(subsonic: a), J.arr(a["album"]).compactMap { Album(subsonic: $0) })
    }

    /// The biography, the Last.fm link and the similar artists that are in the library.
    func artistInfo(_ id: String) async throws -> ArtistInfo? {
        let r = try await call("getArtistInfo2", [item("id", id), item("count", "20")])
        guard let o = r["artistInfo2"] as? [String: Any] else { return nil }
        // The text comes with HTML (a link to Last.fm at its end): only the words are kept
        var bio = J.str(o, "biography") ?? ""
        bio = bio.replacingOccurrences(of: "<a [^>]*>.*?</a>\\.?", with: "", options: [.regularExpression])
        bio = bio.replacingOccurrences(of: "<[^>]+>", with: "", options: [.regularExpression]).trimmingCharacters(in: .whitespacesAndNewlines)
        return ArtistInfo(biography: bio, lastFmUrl: J.str(o, "lastFmUrl"), similar: J.arr(o["similarArtist"]).compactMap { Artist(subsonic: $0) })
    }

    func topSongs(artistName: String, count: Int = 5) async throws -> [Track] {
        let r = try await call("getTopSongs", [item("artist", artistName), item("count", String(count))])
        let s = (r["topSongs"] as? [String: Any]) ?? [:]
        return J.arr(s["song"]).compactMap { Track(subsonic: $0) }
    }

    func setArtistStarred(_ id: String, _ on: Bool) async throws {
        _ = try await call(on ? "star" : "unstar", [item("artistId", id)])
    }

    func album(_ id: String) async throws -> (Album?, [Track]) {
        let r = try await call("getAlbum", [item("id", id)])
        let a = (r["album"] as? [String: Any]) ?? [:]
        return (Album(subsonic: a), J.arr(a["song"]).compactMap { Track(subsonic: $0) })
    }

    func playlists() async throws -> [Playlist] {
        let r = try await call("getPlaylists")
        let p = (r["playlists"] as? [String: Any]) ?? [:]
        return J.arr(p["playlist"]).compactMap { Playlist(subsonic: $0) }
    }

    func playlistTracks(_ id: String) async throws -> [Track] {
        let r = try await call("getPlaylist", [item("id", id)])
        let p = (r["playlist"] as? [String: Any]) ?? [:]
        return J.arr(p["entry"]).compactMap { Track(subsonic: $0) }
    }

    func search(_ query: String) async throws -> (artists: [Artist], albums: [Album], tracks: [Track]) {
        let r = try await call("search3", [item("query", query), item("artistCount", "10"), item("albumCount", "20"), item("songCount", "40")])
        let s = (r["searchResult3"] as? [String: Any]) ?? [:]
        return (J.arr(s["artist"]).compactMap { Artist(subsonic: $0) },
                J.arr(s["album"]).compactMap { Album(subsonic: $0) },
                J.arr(s["song"]).compactMap { Track(subsonic: $0) })
    }

    func starred() async throws -> [Track] {
        let r = try await call("getStarred2")
        let s = (r["starred2"] as? [String: Any]) ?? [:]
        return J.arr(s["song"]).compactMap { Track(subsonic: $0) }
    }

    func randomSongs(_ count: Int = 100, genre: String? = nil) async throws -> [Track] {
        var items = [item("size", String(count))]
        if let genre { items.append(item("genre", genre)) }
        let r = try await call("getRandomSongs", items)
        let s = (r["randomSongs"] as? [String: Any]) ?? [:]
        return J.arr(s["song"]).compactMap { Track(subsonic: $0) }
    }

    func setStarred(_ id: String, _ on: Bool) async throws {
        _ = try await call(on ? "star" : "unstar", [item("id", id)])
    }

    func setAlbumStarred(_ id: String, _ on: Bool) async throws {
        _ = try await call(on ? "star" : "unstar", [item("albumId", id)])
    }

    /// `submission: false` = "now playing", `true` = a finished play.
    /// `time` is when the play happened (so a delayed, offline-queued scrobble still gets the right time).
    func scrobble(_ id: String, submission: Bool, time: Date? = nil) async throws {
        var items = [item("id", id), item("submission", submission ? "true" : "false")]
        if let time { items.append(item("time", String(Int64(time.timeIntervalSince1970 * 1000)))) }
        _ = try await call("scrobble", items)
    }

    /// All songs, paged (Navidrome answers an empty search with the whole library).
    func songs(offset: Int, size: Int) async throws -> [Track] {
        let r = try await call("search3", [item("query", ""), item("artistCount", "0"), item("albumCount", "0"),
                                           item("songCount", String(size)), item("songOffset", String(offset))])
        let s = (r["searchResult3"] as? [String: Any]) ?? [:]
        return J.arr(s["song"]).compactMap { Track(subsonic: $0) }
    }

    /// Top level of the folder view.
    func directoryRoot() async throws -> [DirEntry] {
        let r = try await call("getIndexes")
        let root = (r["indexes"] as? [String: Any]) ?? [:]
        var out = J.arr(root["index"]).flatMap { J.arr($0["artist"]) }.compactMap { d -> DirEntry? in
            guard var e = DirEntry(subsonic: d) else { return nil }
            e.isDir = true
            return e
        }
        out += J.arr(root["child"]).compactMap { DirEntry(subsonic: $0) }
        return out
    }

    func directory(_ id: String) async throws -> [DirEntry] {
        let r = try await call("getMusicDirectory", [item("id", id)])
        let d = (r["directory"] as? [String: Any]) ?? [:]
        return J.arr(d["child"]).compactMap { DirEntry(subsonic: $0) }
    }

    func radios() async throws -> [RadioStation] {
        let r = try await call("getInternetRadioStations")
        let s = (r["internetRadioStations"] as? [String: Any]) ?? [:]
        return J.arr(s["internetRadioStation"]).compactMap { RadioStation(subsonic: $0) }
    }

    func addToPlaylist(_ playlistId: String, songId: String) async throws {
        _ = try await call("updatePlaylist", [item("playlistId", playlistId), item("songIdToAdd", songId)])
    }

    func addToPlaylist(_ playlistId: String, songIds: [String]) async throws {
        var items = [item("playlistId", playlistId)]
        items += songIds.map { item("songIdToAdd", $0) }
        _ = try await call("updatePlaylist", items)
    }

    func createPlaylist(name: String, songIds: [String]) async throws {
        var items = [item("name", name)]
        items += songIds.map { item("songId", $0) }
        _ = try await call("createPlaylist", items)
    }

    func song(_ id: String) async throws -> Track? {
        let r = try await call("getSong", [item("id", id)])
        return Track(subsonic: (r["song"] as? [String: Any]) ?? [:])
    }

    // MARK: Lyrics and BPM

    /// Lyrics from the server (OpenSubsonic getLyricsBySongId); synced ones are preferred.
    func structuredLyrics(songId: String) async throws -> [LyricsLine]? {
        // enhanced=true: Navidrome 0.63+ then also sends the words' own times (cueLine) when the song has a karaoke lyrics file
        let r = try await call("getLyricsBySongId", [item("id", songId), item("enhanced", "true")])
        let list = (r["lyricsList"] as? [String: Any]) ?? [:]
        let all = J.arr(list["structuredLyrics"])
        // The main track: a server may also send a translation or a pronunciation as separate entries
        guard let pick = all.first(where: { ($0["synced"] as? Bool) == true && (J.str($0, "kind") ?? "main") == "main" })
                ?? all.first(where: { ($0["synced"] as? Bool) == true }) ?? all.first else { return nil }
        let synced = (pick["synced"] as? Bool) ?? false
        let offset = Double(J.int(pick, "offset") ?? 0) / 1000
        // The words of each line: only the main voice (a duet's other voice and the backing vocals are left out)
        let agents = J.arr(pick["agents"])
        let main = agents.first(where: { J.str($0, "role") == "main" }).flatMap { J.str($0, "id") }
        var wordsByLine: [Int: [LyricsWord]] = [:]
        if synced {
            for cl in J.arr(pick["cueLine"]) {
                let agent = J.str(cl, "agentId")
                if !agents.isEmpty, let main, let agent, agent != main { continue }
                guard let i = J.int(cl, "index"), wordsByLine[i] == nil else { continue }
                let words = J.arr(cl["cue"]).map { c in
                    LyricsWord(text: J.str(c, "value") ?? "", start: Double(J.int(c, "start") ?? 0) / 1000 + offset,
                               end: J.int(c, "end").map { Double($0) / 1000 + offset })
                }
                if !words.isEmpty { wordsByLine[i] = words }
            }
        }
        let lines = J.arr(pick["line"]).enumerated().map { i, d -> LyricsLine in
            let start = J.int(d, "start")
            return LyricsLine(time: synced ? start.map { Double($0) / 1000 + offset } : nil, text: J.str(d, "value") ?? "", words: wordsByLine[i])
        }
        return lines.isEmpty ? nil : lines
    }

    func plainLyrics(artist: String, title: String) async throws -> String? {
        let r = try await call("getLyrics", [item("artist", artist), item("title", title)])
        let l = (r["lyrics"] as? [String: Any]) ?? [:]
        let v = J.str(l, "value")
        return (v?.isEmpty == false) ? v : nil
    }

    /// BPM stored by the web engine (it only stores; the desktop app detects). nil when unknown
    /// or when the server is a plain Navidrome without the engine.
    func bpm(for id: String) async -> Double? {
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = URL(string: baseURL.absoluteString + "/bpm/" + encoded) else { return nil }
        var comps = URLComponents()
        comps.queryItems = syncAuth().map { URLQueryItem(name: $0.key, value: $0.value) }
        var req = URLRequest(url: url)
        req.timeoutInterval = 6
        req.setValue("Subsonic " + (comps.percentEncodedQuery ?? ""), forHTTPHeaderField: "Authorization")
        guard let (data, resp) = try? await session.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let b = obj["bpm"] as? Double else { return nil }
        return b
    }

    // MARK: Rating, sharing, playlist management

    /// 1-5 stars, 0 clears.
    func setRating(_ id: String, _ rating: Int) async throws {
        _ = try await call("setRating", [item("id", id), item("rating", String(rating))])
    }

    /// A public link to a track/album (needs sharing enabled on the Navidrome server).
    func createShare(_ id: String) async throws -> URL? {
        let r = try await call("createShare", [item("id", id)])
        let shares = (r["shares"] as? [String: Any]) ?? [:]
        guard let first = J.arr(shares["share"]).first, let s = J.str(first, "url") else { return nil }
        return URL(string: s)
    }

    func renamePlaylist(_ id: String, name: String) async throws {
        _ = try await call("updatePlaylist", [item("playlistId", id), item("name", name)])
    }

    func deletePlaylist(_ id: String) async throws {
        _ = try await call("deletePlaylist", [item("id", id)])
    }

    /// Replaces a playlist's contents (used for reordering and removing tracks).
    func setPlaylistTracks(_ id: String, songIds: [String]) async throws {
        var items = [item("playlistId", id)]
        items += songIds.map { item("songId", $0) }
        _ = try await call("createPlaylist", items)
    }

    // MARK: Web engine (Last.fm lives there)

    /// Authenticated request to the web engine (apps/server) on the same host.
    func engine(_ method: String, _ path: String, json: [String: Any]? = nil) async throws -> (status: Int, data: Data) {
        guard let url = URL(string: baseURL.absoluteString + path) else { throw SubsonicError.badResponse }
        var comps = URLComponents()
        comps.queryItems = syncAuth().map { URLQueryItem(name: $0.key, value: $0.value) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 12
        req.setValue("Subsonic " + (comps.percentEncodedQuery ?? ""), forHTTPHeaderField: "Authorization")
        if let json {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: json)
        }
        let (data, resp) = try await session.data(for: req)
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
    }

    /// Like `engine`, for bodies that are not JSON (a picture) and answers that carry an ETag.
    func engineRaw(_ method: String, _ path: String, body: Data? = nil, contentType: String? = nil, etag: String? = nil) async throws -> (status: Int, data: Data, etag: String?) {
        guard let url = URL(string: baseURL.absoluteString + path) else { throw SubsonicError.badResponse }
        var comps = URLComponents()
        comps.queryItems = syncAuth().map { URLQueryItem(name: $0.key, value: $0.value) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 20
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("Subsonic " + (comps.percentEncodedQuery ?? ""), forHTTPHeaderField: "Authorization")
        if let etag { req.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        req.httpBody = body
        let (data, resp) = try await session.data(for: req)
        let http = resp as? HTTPURLResponse
        return (http?.statusCode ?? 0, data, http?.value(forHTTPHeaderField: "ETag"))
    }

    /// Songs similar to a song or artist (the server needs a similarity source such as Last.fm).
    func similarSongs(_ id: String, count: Int = 50) async throws -> [Track] {
        let r = try await call("getSimilarSongs2", [item("id", id), item("count", String(count))])
        let s = (r["similarSongs2"] as? [String: Any]) ?? [:]
        return J.arr(s["song"]).compactMap { Track(subsonic: $0) }
    }
}
