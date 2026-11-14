import Foundation

/// One word (or syllable) of a line with its own timing: the server's karaoke lyrics, when the song has them.
struct LyricsWord: Hashable {
    var text: String
    /// Seconds into the track.
    var start: Double
    var end: Double?
}

struct LyricsLine: Hashable {
    /// Start time in seconds; nil for unsynced lyrics.
    var time: Double?
    var text: String
    /// The words with their own times, when the server has karaoke lyrics for the song.
    var words: [LyricsWord]?
}

enum LyricsParser {
    /// "[mm:ss.xx] text" lines (LRC); metadata tags like [ar:...] are skipped.
    static func lrc(_ text: String) -> [LyricsLine] {
        guard let re = try? NSRegularExpression(pattern: #"\[(\d+):(\d+(?:\.\d+)?)\]"#) else { return [] }
        var out: [LyricsLine] = []
        for raw in text.split(whereSeparator: \.isNewline) {
            let line = String(raw)
            let ns = line as NSString
            let matches = re.matches(in: line, range: NSRange(location: 0, length: ns.length))
            guard let last = matches.last else { continue }
            let lyric = ns.substring(from: last.range.location + last.range.length).trimmingCharacters(in: .whitespaces)
            for m in matches {
                let minutes = Double(ns.substring(with: m.range(at: 1))) ?? 0
                let seconds = Double(ns.substring(with: m.range(at: 2))) ?? 0
                out.append(LyricsLine(time: minutes * 60 + seconds, text: lyric))
            }
        }
        return out.sorted { ($0.time ?? 0) < ($1.time ?? 0) }
    }

    static func plain(_ text: String) -> [LyricsLine] {
        text.split(separator: "\n", omittingEmptySubsequences: false).map { LyricsLine(time: nil, text: String($0)) }
    }
}

/// LRCLIB (lrclib.net): a free public lyrics database, used when the server has none.
enum LRCLib {
    static func fetch(_ t: Track) async -> [LyricsLine]? {
        var c = URLComponents(string: "https://lrclib.net/api/get")!
        var items = [
            URLQueryItem(name: "artist_name", value: t.artist),
            URLQueryItem(name: "track_name", value: t.title),
        ]
        if let a = t.album, !a.isEmpty { items.append(URLQueryItem(name: "album_name", value: a)) }
        if t.duration > 0 { items.append(URLQueryItem(name: "duration", value: String(t.duration))) }
        c.queryItems = items
        guard let url = c.url else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 8
        req.setValue("Icosahedron iOS", forHTTPHeaderField: "User-Agent")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if let s = obj["syncedLyrics"] as? String, !s.isEmpty {
            let lines = LyricsParser.lrc(s)
            if !lines.isEmpty { return lines }
        }
        if let p = obj["plainLyrics"] as? String, !p.isEmpty { return LyricsParser.plain(p) }
        return nil
    }
}

/// Lyrics already looked up this session.
@MainActor
enum LyricsCache {
    static var lines: [String: [LyricsLine]] = [:]
}
