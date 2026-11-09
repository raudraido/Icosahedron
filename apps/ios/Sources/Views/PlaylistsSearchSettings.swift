import SwiftUI

struct PlaylistsList: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        List {
            ForEach(app.playlists) { p in
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
                .contextMenu {
                    Button { app.renamePlaylist(p) } label: { Label("Rename", systemImage: "pencil") }
                    Button(role: .destructive) { app.deletePlaylist(p) } label: { Label("Delete", systemImage: "trash") }
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { app.deletePlaylist(p) } label: { Label("Delete", systemImage: "trash") }
                    Button { app.renamePlaylist(p) } label: { Label("Rename", systemImage: "pencil") }.tint(.blue)
                }
            }
            if app.playlists.isEmpty { Text("No playlists yet").foregroundStyle(.secondary) }
        }
        .listStyle(.plain)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { app.newPlaylist() } label: { Image(systemName: "plus") }
            }
        }
        .task { await app.refreshPlaylists() }
        .refreshable { await app.refreshPlaylists() }
    }
}

struct PlaylistScreen: View {
    @Environment(AppModel.self) private var app
    let playlist: Playlist

    var body: some View {
        TrackListScreen(title: playlist.name, loader: { try await app.client?.playlistTracks(playlist.id) ?? [] }, playlist: playlist)
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
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

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
                    LastFmSection()
                } header: {
                    Text("Last.fm")
                } footer: {
                    Text("Scrobbles go through your server, so one connection covers all your devices. Plays made offline are sent later. If your Navidrome is also linked to Last.fm, a play may be counted twice.")
                }
                Section("Sound") {
                    NavigationLink("Equalizer") { EqualizerContent().navigationTitle("Equalizer").navigationBarTitleDisplayMode(.inline) }
                }
                Section("Lists") {
                    Toggle("Show BPM in song lists", isOn: Binding(
                        get: { UserDefaults.standard.object(forKey: "showBPM") as? Bool ?? true },
                        set: { UserDefaults.standard.set($0, forKey: "showBPM") }
                    ))
                }
                Section("Lyrics") {
                    Toggle("Look up lyrics online (LRCLIB)", isOn: Binding(
                        get: { UserDefaults.standard.object(forKey: "lyricsOnline") as? Bool ?? true },
                        set: { UserDefaults.standard.set($0, forKey: "lyricsOnline") }
                    ))
                }
                Section {
                    QualitySection()
                } header: {
                    Text("Playback quality")
                } footer: {
                    Text("Wi-Fi and wired use the Wi-Fi profile; cellular and iOS Low Data Mode use the Cellular one. Transcoding is done by your Navidrome server. A song already on the phone plays as it is. On cellular nothing is downloaded in the background unless you allow it.")
                }
                Section {
                    CacheSettings()
                } header: {
                    Text("Offline cache")
                } footer: {
                    Text("Tracks are downloaded in the background — the next one right away — so they start instantly and play without a network. The oldest files are removed when the limit is reached; songs you keep offline are never removed.")
                }
                Section {
                    Button("Sign out", role: .destructive) { app.signOut() }
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

/// The user's devices from the sync hub, with remote controls and "play here".
struct DevicesList: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let sync = app.sync
        if sync.status != "online" {
            Text(sync.status == "connecting" ? String(localized: "Connecting…") : String(localized: "Sync server not reachable"))
                .foregroundStyle(.secondary)
        }
        ForEach(sync.devices) { d in
            HStack {
                Image(systemName: icon(d.kind)).foregroundStyle(d.id == sync.activeDeviceId ? Theme.accent : Color.secondary)
                VStack(alignment: .leading) {
                    Text(d.name + (d.id == sync.deviceId ? " " + String(localized: "(this phone)") : ""))
                    if d.id == sync.activeDeviceId { Text(sync.remotePlaying ? String(localized: "Playing") : String(localized: "Active")).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if d.id != sync.activeDeviceId, sync.remoteTrack != nil {
                    Button(d.id == sync.deviceId ? String(localized: "Play here") : String(localized: "Send")) { sync.transfer(to: d.id) }
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
                if sync.remoteQueue.count > 1 {
                    DisclosureGroup(String(localized: "Queue") + " (\(sync.remoteQueue.count))") {
                        ForEach(Array(sync.remoteQueue.enumerated()), id: \.offset) { i, q in
                            HStack {
                                Button { sync.jump(on: active, to: i) } label: {
                                    Text("\(q.title) · \(q.artist)").lineLimit(1)
                                        .foregroundStyle(i == sync.remoteIndex ? Theme.accent : Color.primary)
                                }
                                .buttonStyle(.plain)
                                Spacer()
                                Button(role: .destructive) { sync.remove(on: active, at: i) } label: { Image(systemName: "xmark") }
                                    .buttonStyle(.borderless)
                            }
                        }
                    }
                }
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

struct CacheSettings: View {
    @AppStorage(AudioCache.limitKey) private var limitMB = 2048
    @State private var used: Int64 = 0
    @State private var kept: Int64 = 0

    var body: some View {
        Picker("Cache size", selection: $limitMB) {
            Text("Off").tag(0)
            Text("500 MB").tag(500)
            Text("1 GB").tag(1024)
            Text("2 GB").tag(2048)
            Text("5 GB").tag(5120)
            Text("10 GB").tag(10240)
            Text("20 GB").tag(20480)
            Text("50 GB").tag(51200)
            Text("Unlimited").tag(-1)
        }
        .onChange(of: limitMB) { _, new in
            if new == 0 { AudioCache.shared.clear() } else { AudioCache.shared.enforceLimit() }
            refresh()
        }
        LabeledContent("Cache used", value: ByteCountFormatter.string(fromByteCount: used, countStyle: .file))
        LabeledContent("Kept offline", value: ByteCountFormatter.string(fromByteCount: kept, countStyle: .file))
        Button("Clear Cache", role: .destructive) {
            AudioCache.shared.clear()
            refresh()
        }
        .task { refresh() }
    }

    private func refresh() {
        Task.detached {
            let sizes = AudioCache.shared.sizes()
            await MainActor.run {
                used = sizes.auto
                kept = sizes.pinned
            }
        }
    }
}

struct QualitySection: View {
    @Environment(AppModel.self) private var app
    @AppStorage(QualitySettings.wifiKey) private var wifi = "raw"
    @AppStorage(QualitySettings.cellularKey) private var cellular = "mp3-192"
    @AppStorage(QualitySettings.cellularCacheKey) private var cacheOnCellular = false

    var body: some View {
        Picker("Wi-Fi", selection: $wifi) {
            ForEach(StreamQuality.options, id: \.storageKey) { Text($0.label).tag($0.storageKey) }
        }
        Picker("Cellular", selection: $cellular) {
            ForEach(StreamQuality.options, id: \.storageKey) { Text($0.label).tag($0.storageKey) }
        }
        Toggle("Cache and download on cellular", isOn: $cacheOnCellular)
        LabeledContent("Right now", value: nowText)
    }

    private var nowText: String {
        let n = app.net
        switch n.kind {
        case .offline: return String(localized: "Offline")
        case .wifi: return (n.isConstrained ? String(localized: "Low Data Mode") : "Wi-Fi") + " · " + n.streamQuality.label
        case .cellular: return String(localized: "Cellular") + " · " + n.streamQuality.label
        }
    }
}

struct LastFmSection: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let fm = app.lastfm
        switch fm.state {
        case .unknown:
            Text("Not available (needs the web engine)").foregroundStyle(.secondary)
        case .notConfigured:
            Text("Not set up on the server").foregroundStyle(.secondary)
        case .disconnected:
            if fm.pendingToken == nil {
                Button("Connect to Last.fm") { connect() }
            } else {
                Text("Approve the connection in the browser, then come back and finish.").font(.footnote).foregroundStyle(.secondary)
                Button("Finish connecting") { finish() }
                Button("Cancel", role: .cancel) { fm.pendingToken = nil }
            }
        case .connected(let name):
            LabeledContent("Account", value: name)
            Toggle("Scrobble", isOn: Binding(get: { fm.scrobbleEnabled }, set: { on in
                if let c = app.client { Task { await fm.setScrobbling(on, client: c) } }
            }))
            Button("Disconnect", role: .destructive) {
                if let c = app.client { Task { await fm.disconnect(client: c) } }
            }
        }
        if let m = fm.message { Text(m).font(.footnote).foregroundStyle(.orange) }
        let waiting = ScrobbleQueue.shared.count
        if waiting > 0 { Text("\(waiting) plays waiting to be sent").font(.footnote).foregroundStyle(.secondary) }
    }

    private func connect() {
        guard let c = app.client else { return }
        Task { await app.lastfm.beginConnect(client: c) }
    }

    private func finish() {
        guard let c = app.client else { return }
        Task { await app.lastfm.finishConnect(client: c) }
    }
}
