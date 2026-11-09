import Foundation

/// Helpers for the loosely typed Subsonic JSON (a single item arrives as an
/// object, several as an array; numbers sometimes as strings).
enum J {
    static func arr(_ v: Any?) -> [[String: Any]] {
        if let a = v as? [[String: Any]] { return a }
        if let d = v as? [String: Any] { return [d] }
        return []
    }
    static func str(_ d: [String: Any], _ k: String) -> String? {
        if let s = d[k] as? String { return s }
        if let n = d[k] as? NSNumber { return n.stringValue }
        return nil
    }
    static func int(_ d: [String: Any], _ k: String) -> Int? {
        if let n = d[k] as? NSNumber { return n.intValue }
        if let s = d[k] as? String { return Int(s) }
        return nil
    }
    static func orNull(_ v: Any?) -> Any { v ?? NSNull() }
}

struct Track: Identifiable, Hashable, Codable {
    let id: String
    var title: String
    var artist: String
    var artistId: String?
    var album: String?
    var albumId: String?
    var trackNumber: Int
    var discNumber: Int
    var duration: Int
    var coverArt: String?
    var starred: Bool
    var year: Int?
    var genre: String?
    var bitrate: Int?
    var format: String?
    /// Set for internet radio: plays this URL instead of a Subsonic stream.
    var directURL: URL?
    // Technical details, only on tracks read from the server's own song objects.
    var size: Int?
    var path: String?
    var samplingRate: Int?
    var bitDepth: Int?
    var channels: Int?
    var playCount: Int?
    var created: String?
    var userRating: Int?

    /// From a Subsonic `song` / `entry` object.
    init?(subsonic d: [String: Any]) {
        guard let id = J.str(d, "id") else { return nil }
        self.id = id
        title = J.str(d, "title") ?? ""
        artist = J.str(d, "artist") ?? ""
        artistId = J.str(d, "artistId")
        album = J.str(d, "album")
        albumId = J.str(d, "albumId")
        trackNumber = J.int(d, "track") ?? 0
        discNumber = J.int(d, "discNumber") ?? 0
        duration = J.int(d, "duration") ?? 0
        coverArt = J.str(d, "coverArt")
        starred = d["starred"] != nil
        year = J.int(d, "year")
        genre = J.str(d, "genre")
        bitrate = J.int(d, "bitRate")
        format = J.str(d, "suffix")
        directURL = nil
        size = J.int(d, "size")
        path = J.str(d, "path")
        samplingRate = J.int(d, "samplingRate")
        bitDepth = J.int(d, "bitDepth")
        channels = J.int(d, "channelCount")
        playCount = J.int(d, "playCount")
        created = J.str(d, "created")
        userRating = J.int(d, "userRating")
    }

    /// From the sync protocol's track object (the web/desktop Track shape).
    init?(wire d: [String: Any]) {
        guard let id = J.str(d, "id") else { return nil }
        self.id = id
        title = J.str(d, "title") ?? ""
        artist = J.str(d, "artist") ?? ""
        artistId = J.str(d, "artist_id")
        album = J.str(d, "album")
        albumId = J.str(d, "album_id")
        trackNumber = J.int(d, "track_number") ?? 0
        discNumber = J.int(d, "disc_number") ?? 0
        duration = J.int(d, "duration_secs") ?? 0
        coverArt = J.str(d, "cover_id")
        starred = (d["starred"] as? Bool) ?? false
        year = J.int(d, "year")
        genre = J.str(d, "genre")
        bitrate = J.int(d, "bitrate")
        format = J.str(d, "format")
        directURL = nil
    }

    func wire() -> [String: Any] {
        [
            "id": id, "title": title, "artist": artist,
            "artist_id": J.orNull(artistId), "album": J.orNull(album), "album_id": J.orNull(albumId),
            "track_number": trackNumber, "disc_number": discNumber, "duration_secs": duration,
            "cover_id": J.orNull(coverArt), "starred": starred, "genre": J.orNull(genre),
            "year": J.orNull(year), "play_count": 0, "bitrate": J.orNull(bitrate),
            "bpm": NSNull(), "created": NSNull(), "format": J.orNull(format),
        ]
    }
}

struct Album: Identifiable, Hashable {
    let id: String
    var name: String
    var artist: String
    var artistId: String?
    var coverArt: String?
    var year: Int?
    var songCount: Int

    init?(subsonic d: [String: Any]) {
        guard let id = J.str(d, "id") else { return nil }
        self.id = id
        name = J.str(d, "name") ?? J.str(d, "title") ?? ""
        artist = J.str(d, "artist") ?? ""
        artistId = J.str(d, "artistId")
        coverArt = J.str(d, "coverArt")
        year = J.int(d, "year")
        songCount = J.int(d, "songCount") ?? 0
    }
}

struct Artist: Identifiable, Hashable {
    let id: String
    var name: String
    var coverArt: String?
    var albumCount: Int

    init?(subsonic d: [String: Any]) {
        guard let id = J.str(d, "id") else { return nil }
        self.id = id
        name = J.str(d, "name") ?? ""
        coverArt = J.str(d, "coverArt")
        albumCount = J.int(d, "albumCount") ?? 0
    }
}

struct Playlist: Identifiable, Hashable {
    let id: String
    var name: String
    var songCount: Int
    var coverArt: String?

    init?(subsonic d: [String: Any]) {
        guard let id = J.str(d, "id") else { return nil }
        self.id = id
        name = J.str(d, "name") ?? ""
        songCount = J.int(d, "songCount") ?? 0
        coverArt = J.str(d, "coverArt")
    }
}

func formatTime(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds >= 0 else { return "0:00" }
    let s = Int(seconds)
    return String(format: "%d:%02d", s / 60, s % 60)
}

struct RadioStation: Identifiable, Hashable {
    let id: String
    var name: String
    var streamURL: URL
    var homepage: String?

    init?(subsonic d: [String: Any]) {
        guard let id = J.str(d, "id"), let s = J.str(d, "streamUrl"), let url = URL(string: s) else { return nil }
        self.id = id
        name = J.str(d, "name") ?? "Radio"
        streamURL = url
        homepage = J.str(d, "homePageUrl")
    }
}

extension Track {
    init(radio r: RadioStation) {
        id = "radio-" + r.id
        title = r.name
        artist = "Internet radio"
        artistId = nil
        album = nil
        albumId = nil
        trackNumber = 0
        discNumber = 0
        duration = 0
        coverArt = nil
        starred = false
        year = nil
        genre = nil
        bitrate = nil
        format = nil
        directURL = r.streamURL
    }
}

/// A folder or a track in Navidrome's folder (directory) view.
struct DirEntry: Identifiable, Hashable {
    let id: String
    var title: String
    var isDir: Bool
    var track: Track?

    init?(subsonic d: [String: Any]) {
        guard let id = J.str(d, "id") else { return nil }
        self.id = id
        title = J.str(d, "title") ?? J.str(d, "name") ?? ""
        isDir = (d["isDir"] as? Bool) ?? false
        track = isDir ? nil : Track(subsonic: d)
    }
}
