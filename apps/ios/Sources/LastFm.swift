import Foundation
import Observation
import UIKit

/// Last.fm through the web engine: it holds the API secret and the account's session key, and
/// signs the requests, so the phone only says "connect", "scrobble this".
@MainActor @Observable
final class LastFmModel {
    enum State { case unknown, notConfigured, disconnected, connected(String) }

    var state: State = .unknown
    var scrobbleEnabled = false
    var pendingToken: String?
    var message: String?

    var isConnected: Bool { if case .connected = state { return true } else { return false } }

    func refresh(client: SubsonicClient) async {
        do {
            let cfg = try await client.engine("GET", "/lastfm/config")
            guard cfg.status == 200,
                  let c = try JSONSerialization.jsonObject(with: cfg.data) as? [String: Any] else { state = .notConfigured; return }
            guard (c["configured"] as? Bool) == true else { state = .notConfigured; return }
            let conn = try await client.engine("GET", "/lastfm/connection")
            if conn.status == 200, let o = try JSONSerialization.jsonObject(with: conn.data) as? [String: Any],
               let name = o["username"] as? String {
                state = .connected(name)
                scrobbleEnabled = (o["scrobbleEnabled"] as? Bool) ?? false
            } else {
                state = .disconnected
            }
        } catch {
            state = .unknown // no engine (plain Navidrome) or offline
        }
    }

    /// Step 1: opens Last.fm's approval page in the browser.
    func beginConnect(client: SubsonicClient) async {
        message = nil
        do {
            let r = try await client.engine("POST", "/lastfm/token")
            guard r.status == 200,
                  let o = try JSONSerialization.jsonObject(with: r.data) as? [String: Any],
                  let token = o["token"] as? String, let s = o["authUrl"] as? String, let url = URL(string: s) else {
                message = String(localized: "Last.fm did not answer")
                return
            }
            pendingToken = token
            await UIApplication.shared.open(url)
        } catch {
            message = String(localized: "Could not reach the server")
        }
    }

    /// Step 2: after approving in the browser.
    func finishConnect(client: SubsonicClient) async {
        guard let token = pendingToken else { return }
        do {
            let r = try await client.engine("POST", "/lastfm/session", json: ["token": token])
            if let o = try JSONSerialization.jsonObject(with: r.data) as? [String: Any], (o["connected"] as? Bool) == true {
                pendingToken = nil
                message = nil
                await refresh(client: client)
            } else {
                message = String(localized: "Not approved yet — approve on Last.fm, then try again")
            }
        } catch {
            message = String(localized: "Could not reach the server")
        }
    }

    func setScrobbling(_ on: Bool, client: SubsonicClient) async {
        scrobbleEnabled = on
        _ = try? await client.engine("PUT", "/lastfm/toggles", json: ["scrobbleEnabled": on])
    }

    func disconnect(client: SubsonicClient) async {
        _ = try? await client.engine("DELETE", "/lastfm/connection")
        state = .disconnected
        scrobbleEnabled = false
    }
}

/// Plays that have to reach Navidrome / Last.fm. They are stored on disk first, so a play made
/// offline (cached songs!) is not lost: it is sent, with its real time, when the connection is back.
final class ScrobbleQueue: @unchecked Sendable {
    static let shared = ScrobbleQueue()

    struct Pending: Codable {
        var id: String
        var title: String
        var artist: String
        var album: String
        var duration: Int
        var time: Date
        var navidromeDone = false
        var lastfmDone = false
        var needsLastfm = false
    }

    private let lock = NSLock()
    private var items: [Pending] = []
    private var flushing = false
    private let fileURL: URL

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        fileURL = support.appendingPathComponent("scrobble-queue.json")
        if let data = try? Data(contentsOf: fileURL), let decoded = try? JSONDecoder().decode([Pending].self, from: data) {
            items = decoded
        }
    }

    func add(_ t: Track, time: Date, lastfm: Bool) {
        lock.lock()
        items.append(Pending(id: t.id, title: t.title, artist: t.artist, album: t.album ?? "", duration: t.duration,
                             time: time, needsLastfm: lastfm))
        save()
        lock.unlock()
    }

    var count: Int { lock.lock(); defer { lock.unlock() }; return items.count }

    private func save() {
        if let data = try? JSONEncoder().encode(items) { try? data.write(to: fileURL, options: .atomic) }
    }

    /// Sends what is pending; whatever fails stays for the next attempt.
    func flush(client: SubsonicClient) async {
        lock.lock()
        guard !flushing, !items.isEmpty else { lock.unlock(); return }
        flushing = true
        let snapshot = items
        lock.unlock()

        for (i, p) in snapshot.enumerated() {
            var item = p
            if !item.navidromeDone {
                if (try? await client.scrobble(item.id, submission: true, time: item.time)) != nil { item.navidromeDone = true }
            }
            if item.needsLastfm, !item.lastfmDone {
                let body: [String: Any] = [
                    "track": ["title": item.title, "artist": item.artist, "album": item.album, "duration": item.duration],
                    "timestamp": Int(item.time.timeIntervalSince1970),
                ]
                if let r = try? await client.engine("POST", "/lastfm/scrobble", json: body), r.status == 204 || r.status == 200 {
                    item.lastfmDone = true
                }
            }
            lock.lock()
            if let idx = items.firstIndex(where: { $0.id == p.id && $0.time == p.time }) {
                if item.navidromeDone && (!item.needsLastfm || item.lastfmDone) { items.remove(at: idx) } else { items[idx] = item }
            }
            _ = i
            save()
            lock.unlock()
        }
        lock.lock(); flushing = false; lock.unlock()
    }
}
