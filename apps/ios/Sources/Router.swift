import SwiftUI
import Observation

/// App-wide navigation state: which tab is selected, the Library stack (so "Show Album" can
/// open an album from anywhere, including the full-screen player) and whether the player is up.
@MainActor @Observable
final class Router {
    enum AppTab: Hashable { case home, library, devices, search }

    var tab: AppTab = .home
    var libraryPath = NavigationPath()
    var showPlayer = false

    func show(album: Album) {
        showPlayer = false
        tab = .library
        libraryPath.append(album)
    }

    func show(artist: Artist) {
        showPlayer = false
        tab = .library
        libraryPath.append(artist)
    }
}

extension Album {
    /// The album a track belongs to, when the server told us its id.
    init?(track t: Track) {
        guard let id = t.albumId else { return nil }
        self.id = id
        name = t.album ?? ""
        artist = t.artist
        artistId = t.artistId
        coverArt = t.coverArt
        year = t.year
        songCount = 0
    }
}

extension Artist {
    init?(track t: Track) {
        guard let id = t.artistId else { return nil }
        self.id = id
        name = t.artist
        coverArt = nil
        albumCount = 0
    }
}
