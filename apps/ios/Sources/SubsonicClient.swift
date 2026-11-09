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

    func streamURL(_ id: String) -> URL { url("stream", [URLQueryItem(name: "id", value: id)], json: false) }

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

    func albums(type: String, size: Int = 40, offset: Int = 0) async throws -> [Album] {
        let r = try await call("getAlbumList2", [item("type", type), item("size", String(size)), item("offset", String(offset))])
        let list = (r["albumList2"] as? [String: Any]) ?? [:]
        return J.arr(list["album"]).compactMap { Album(subsonic: $0) }
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

    func randomSongs(_ count: Int = 100) async throws -> [Track] {
        let r = try await call("getRandomSongs", [item("size", String(count))])
        let s = (r["randomSongs"] as? [String: Any]) ?? [:]
        return J.arr(s["song"]).compactMap { Track(subsonic: $0) }
    }

    func setStarred(_ id: String, _ on: Bool) async throws {
        _ = try await call(on ? "star" : "unstar", [item("id", id)])
    }

    /// `submission: false` = "now playing", `true` = a finished play.
    func scrobble(_ id: String, submission: Bool) async throws {
        _ = try await call("scrobble", [item("id", id), item("submission", submission ? "true" : "false")])
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
}
