import SwiftUI

struct PlaylistsView: View {
    @Environment(AppModel.self) private var app
    @State private var playlists: [Playlist] = []

    var body: some View {
        NavigationStack {
            List {
                NavigationLink {
                    TrackListScreen(title: "Favorites") { try await app.client?.starred() ?? [] }
                } label: {
                    Label("Favorites", systemImage: "heart.fill").foregroundStyle(Theme.accent)
                }
                ForEach(playlists) { p in
                    NavigationLink(value: p) {
                        HStack(spacing: 12) {
                            CoverImage(id: p.coverArt, size: 100)
                                .frame(width: 48, height: 48).clipShape(RoundedRectangle(cornerRadius: 6))
                            VStack(alignment: .leading) {
                                Text(p.name)
                                Text("\(p.songCount) tracks").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Playlists")
            .libraryDestinations()
            .task { playlists = (try? await app.client?.playlists()) ?? [] }
            .refreshable { playlists = (try? await app.client?.playlists()) ?? [] }
        }
        .withMiniPlayer()
    }
}

struct PlaylistScreen: View {
    @Environment(AppModel.self) private var app
    let playlist: Playlist

    var body: some View {
        TrackListScreen(title: playlist.name) { try await app.client?.playlistTracks(playlist.id) ?? [] }
    }
}

struct SearchView: View {
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @State private var artists: [Artist] = []
    @State private var albums: [Album] = []
    @State private var tracks: [Track] = []

    var body: some View {
        NavigationStack {
            List {
                if !artists.isEmpty {
                    Section("Artists") {
                        ForEach(artists) { a in NavigationLink(value: a) { Text(a.name) } }
                    }
                }
                if !albums.isEmpty {
                    Section("Albums") {
                        ForEach(albums) { a in
                            NavigationLink(value: a) {
                                VStack(alignment: .leading) {
                                    Text(a.name)
                                    Text(a.artist).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                if !tracks.isEmpty {
                    Section("Tracks") {
                        ForEach(Array(tracks.enumerated()), id: \.offset) { i, t in
                            Button { app.player.play(tracks, at: i) } label: { TrackRow(track: t, showCover: true) }
                                .buttonStyle(.plain)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Artists, albums, tracks")
            .libraryDestinations()
            .task(id: query) {
                let q = query.trimmingCharacters(in: .whitespaces)
                guard q.count >= 2 else { artists = []; albums = []; tracks = []; return }
                try? await Task.sleep(nanoseconds: 300_000_000)
                if Task.isCancelled { return }
                if let r = try? await app.client?.search(q) { (artists, albums, tracks) = (r.artists, r.albums, r.tracks) }
            }
        }
        .withMiniPlayer()
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    LabeledContent("Server", value: app.client?.baseURL.host ?? "")
                    LabeledContent("User", value: app.client?.username ?? "")
                }
                Section("Devices") {
                    DevicesList()
                }
                Section {
                    Button("Sign out", role: .destructive) { app.signOut() }
                }
            }
            .navigationTitle("More")
        }
        .withMiniPlayer()
    }
}

/// The user's devices from the sync hub, with remote controls and "play here".
struct DevicesList: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let sync = app.sync
        if sync.status != "online" {
            Text(sync.status == "connecting" ? "Connecting…" : "Sync server not reachable")
                .foregroundStyle(.secondary)
        }
        ForEach(sync.devices) { d in
            HStack {
                Image(systemName: icon(d.kind)).foregroundStyle(d.id == sync.activeDeviceId ? Theme.accent : Color.secondary)
                VStack(alignment: .leading) {
                    Text(d.name + (d.id == sync.deviceId ? " (this phone)" : ""))
                    if d.id == sync.activeDeviceId { Text(sync.remotePlaying ? "Playing" : "Active").font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if d.id != sync.activeDeviceId, sync.remoteTrack != nil {
                    Button(d.id == sync.deviceId ? "Play here" : "Send") { sync.transfer(to: d.id) }
                        .buttonStyle(.bordered)
                }
            }
        }
        if let active = sync.activeDeviceId, active != sync.deviceId, let t = sync.remoteTrack {
            VStack(alignment: .leading, spacing: 6) {
                Text("\(t.title) — \(t.artist)").lineLimit(1)
                HStack(spacing: 24) {
                    Button { sync.command(to: active, "prev") } label: { Image(systemName: "backward.fill") }
                    Button { sync.command(to: active, "toggle") } label: { Image(systemName: sync.remotePlaying ? "pause.fill" : "play.fill") }
                    Button { sync.command(to: active, "next") } label: { Image(systemName: "forward.fill") }
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private func icon(_ kind: String) -> String {
        switch kind {
        case "mobile": return "iphone"
        case "electron": return "desktopcomputer"
        default: return "laptopcomputer"
        }
    }
}
