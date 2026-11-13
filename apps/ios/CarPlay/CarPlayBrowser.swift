import CarPlay
import UIKit

/// The library as the car shows it: tabs Home (Random mix and recently played albums), Albums, Playlists and Artists;
/// an album, a playlist or an artist opens a list of songs (or albums); a song starts playing and the car's own
/// Now Playing screen opens. The player, the queue and the lock-screen / car controls are the app's own
/// (`AppModel.shared`, `PlayerModel`): this file only browses and starts playing.
@MainActor
final class CarPlayBrowser {
    private let controller: CPInterfaceController
    private var app: AppModel { AppModel.shared }

    init(_ controller: CPInterfaceController) {
        self.controller = controller
    }

    // MARK: Tabs

    func start() async {
        await app.restore() // signed in from the saved login, also when the phone's own screen was never opened

        let home = makeTab("Home", symbol: "house")
        let albums = makeTab("Albums", symbol: "square.stack")
        let playlists = makeTab("Playlists", symbol: "music.note.list")
        let artists = makeTab("Artists", symbol: "music.mic")
        let tabs = CPTabBarTemplate(templates: [home, albums, playlists, artists])
        controller.setRootTemplate(tabs, animated: false, completion: nil)

        guard let client = app.client else {
            home.updateSections([])
            home.emptyViewTitleVariants = ["Sign in on the phone"]
            home.emptyViewSubtitleVariants = ["Open Icosahedron on the phone and sign in to see your music here."]
            return
        }
        Task { await self.loadHome(home, client) }
        Task { await self.loadAlbums(albums, client) }
        Task { await self.loadPlaylists(playlists, client) }
        Task { await self.loadArtists(artists, client) }
    }

    private func makeTab(_ title: String, symbol: String) -> CPListTemplate {
        let template = CPListTemplate(title: title, sections: [])
        template.tabTitle = title
        template.tabImage = UIImage(systemName: symbol) ?? UIImage()
        template.emptyViewTitleVariants = ["Loading…"]
        return template
    }

    private func loadHome(_ template: CPListTemplate, _ client: SubsonicClient) async {
        let random = CPListItem(text: "Random mix", detailText: "100 random songs", image: UIImage(systemName: "shuffle"))
        random.handler = { [weak self] _, done in
            Task { @MainActor in await self?.playRandomMix(); done() }
        }
        let recent = (try? await client.albums(type: "recent", size: 30)) ?? []
        template.updateSections([
            CPListSection(items: [random]),
            CPListSection(items: limited(recent.map(albumItem)), header: "Recently played", sectionIndexTitle: nil),
        ])
    }

    private func loadAlbums(_ template: CPListTemplate, _ client: SubsonicClient) async {
        let albums = (try? await client.albums(type: "alphabeticalByName", size: 200)) ?? []
        template.updateSections([CPListSection(items: limited(albums.map(albumItem)))])
    }

    private func loadPlaylists(_ template: CPListTemplate, _ client: SubsonicClient) async {
        let lists = (try? await client.playlists()) ?? []
        template.updateSections([CPListSection(items: limited(lists.map(playlistItem)))])
    }

    private func loadArtists(_ template: CPListTemplate, _ client: SubsonicClient) async {
        let artists = (try? await client.artists()) ?? []
        template.updateSections([CPListSection(items: limited(artists.map(artistItem)))])
    }

    // MARK: Items

    /// The car limits how many rows a list may have.
    private func limited(_ items: [CPListItem]) -> [CPListItem] {
        Array(items.prefix(CPListTemplate.maximumItemCount))
    }

    private func albumItem(_ album: Album) -> CPListItem {
        let item = CPListItem(text: album.name, detailText: album.artist, image: placeholder)
        item.accessoryType = .disclosureIndicator
        item.handler = { [weak self] _, done in
            Task { @MainActor in await self?.openAlbum(album); done() }
        }
        attachCover(item, album.coverArt)
        return item
    }

    private func playlistItem(_ playlist: Playlist) -> CPListItem {
        let item = CPListItem(text: playlist.name, detailText: "\(playlist.songCount) songs", image: placeholder)
        item.accessoryType = .disclosureIndicator
        item.handler = { [weak self] _, done in
            Task { @MainActor in await self?.openPlaylist(playlist); done() }
        }
        attachCover(item, playlist.coverArt)
        return item
    }

    private func artistItem(_ artist: Artist) -> CPListItem {
        let item = CPListItem(text: artist.name, detailText: artist.albumCount > 0 ? "\(artist.albumCount) albums" : nil, image: UIImage(systemName: "music.mic"))
        item.accessoryType = .disclosureIndicator
        item.handler = { [weak self] _, done in
            Task { @MainActor in await self?.openArtist(artist); done() }
        }
        attachCover(item, artist.coverArt)
        return item
    }

    private var placeholder: UIImage { UIImage(systemName: "music.note") ?? UIImage() }

    /// The cover is fetched in the background and put into the row when it arrives.
    private func attachCover(_ item: CPListItem, _ coverId: String?) {
        guard let url = app.client?.coverURL(coverId, size: 200) else { return }
        Task {
            if let image = await Self.image(at: url) { item.setImage(image) }
        }
    }

    nonisolated private static func image(at url: URL) async -> UIImage? {
        guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
        return UIImage(data: data)
    }

    // MARK: Opening

    private func openAlbum(_ album: Album) async {
        guard let client = app.client, let result = try? await client.album(album.id) else { return }
        push(songList(title: album.name, tracks: result.1))
    }

    private func openPlaylist(_ playlist: Playlist) async {
        guard let client = app.client, let tracks = try? await client.playlistTracks(playlist.id) else { return }
        push(songList(title: playlist.name, tracks: tracks))
    }

    private func openArtist(_ artist: Artist) async {
        guard let client = app.client, let result = try? await client.artist(artist.id) else { return }
        let template = CPListTemplate(title: artist.name, sections: [CPListSection(items: limited(result.1.map(albumItem)))])
        push(template)
    }

    /// Play and Shuffle first, then every song; a tap on a song plays the list from there.
    private func songList(title: String, tracks: [Track]) -> CPListTemplate {
        let play = CPListItem(text: "Play", detailText: nil, image: UIImage(systemName: "play.fill"))
        play.handler = { [weak self] _, done in
            Task { @MainActor in self?.start(tracks, at: 0); done() }
        }
        let shuffle = CPListItem(text: "Shuffle", detailText: nil, image: UIImage(systemName: "shuffle"))
        shuffle.handler = { [weak self] _, done in
            Task { @MainActor in self?.start(tracks.shuffled(), at: 0); done() }
        }
        let songs: [CPListItem] = tracks.enumerated().map { index, track in
            let item = CPListItem(text: track.title, detailText: track.artist, image: nil)
            item.handler = { [weak self] _, done in
                Task { @MainActor in self?.start(tracks, at: index); done() }
            }
            return item
        }
        return CPListTemplate(title: title, sections: [
            CPListSection(items: [play, shuffle]),
            CPListSection(items: limited(songs)),
        ])
    }

    // MARK: Playing

    private func playRandomMix() async {
        guard let client = app.client, let tracks = try? await client.randomSongs(100), !tracks.isEmpty else { return }
        start(tracks, at: 0)
    }

    private func start(_ tracks: [Track], at index: Int) {
        guard !tracks.isEmpty else { return }
        app.play(tracks, at: index)
        if !(controller.topTemplate is CPNowPlayingTemplate) {
            controller.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
        }
    }

    private func push(_ template: CPTemplate) {
        controller.pushTemplate(template, animated: true, completion: nil)
    }
}
