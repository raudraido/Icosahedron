import AppIntents

/// Siri / Shortcuts actions. They run inside the app process (no extension, so they work with a
/// sideloaded build) and play in the background through the shared AppModel.
@MainActor
private func readyApp() async -> AppModel {
    let app = AppModel.shared
    await app.restore() // opens the saved login if the process was started just for this action
    return app
}

struct PlayPauseIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Play / Pause"
    static let description = IntentDescription("Toggles playback in Icosahedron.")

    @MainActor
    func perform() async throws -> some IntentResult {
        let app = await readyApp()
        app.player.toggle()
        return .result()
    }
}

struct NextTrackIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Next Song"

    @MainActor
    func perform() async throws -> some IntentResult {
        await readyApp().player.next()
        return .result()
    }
}

struct PreviousTrackIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Previous Song"

    @MainActor
    func perform() async throws -> some IntentResult {
        await readyApp().player.previous()
        return .result()
    }
}

struct ShuffleAllIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Shuffle My Music"
    static let description = IntentDescription("Plays a random mix from your library.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let app = await readyApp()
        guard let songs = try? await app.client?.randomSongs(100), !songs.isEmpty else {
            return .result(dialog: "I couldn't reach your music library.")
        }
        app.player.play(songs, at: 0)
        return .result(dialog: "Shuffling your music.")
    }
}

struct PlayFavoritesIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Play My Favorites"

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let app = await readyApp()
        guard let songs = try? await app.client?.starred(), !songs.isEmpty else {
            return .result(dialog: "You have no favorite songs yet.")
        }
        app.player.play(songs.shuffled(), at: 0)
        return .result(dialog: "Playing your favorites.")
    }
}

struct PlaySearchIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Play Search Result"
    static let description = IntentDescription("Searches your library and plays the best match: a song, or an album.")

    @Parameter(title: "Search")
    var query: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let app = await readyApp()
        guard let result = try? await app.client?.search(query) else {
            return .result(dialog: "I couldn't reach your music library.")
        }
        if let album = result.albums.first, let tracks = try? await app.client?.album(album.id).1, !tracks.isEmpty {
            app.player.play(tracks, at: 0)
            return .result(dialog: "Playing \(album.name).")
        }
        if !result.tracks.isEmpty {
            app.player.play(result.tracks, at: 0)
            return .result(dialog: "Playing \(result.tracks[0].title).")
        }
        return .result(dialog: "I couldn't find \(query).")
    }
}

struct LikeCurrentTrackIntent: AppIntent {
    static let title: LocalizedStringResource = "Favorite Current Song"

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let app = await readyApp()
        guard let t = app.player.current else { return .result(dialog: "Nothing is playing.") }
        if !app.isStarred(t) { app.toggleStar(t) }
        return .result(dialog: "Added \(t.title) to your favorites.")
    }
}

struct IcosahedronShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: PlayPauseIntent(),
                    phrases: ["Play or pause \(.applicationName)", "Pause \(.applicationName)"],
                    shortTitle: "Play / Pause", systemImageName: "playpause.fill")
        AppShortcut(intent: ShuffleAllIntent(),
                    phrases: ["Shuffle my music in \(.applicationName)", "Play a random mix in \(.applicationName)"],
                    shortTitle: "Shuffle My Music", systemImageName: "shuffle")
        AppShortcut(intent: PlayFavoritesIntent(),
                    phrases: ["Play my favorites in \(.applicationName)"],
                    shortTitle: "Play My Favorites", systemImageName: "heart.fill")
        AppShortcut(intent: NextTrackIntent(),
                    phrases: ["Next song in \(.applicationName)"],
                    shortTitle: "Next Song", systemImageName: "forward.fill")
        AppShortcut(intent: PreviousTrackIntent(),
                    phrases: ["Previous song in \(.applicationName)"],
                    shortTitle: "Previous Song", systemImageName: "backward.fill")
        AppShortcut(intent: LikeCurrentTrackIntent(),
                    phrases: ["Favorite this song in \(.applicationName)"],
                    shortTitle: "Favorite Song", systemImageName: "heart")
    }
}
