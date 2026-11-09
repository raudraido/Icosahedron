import SwiftUI
import AVKit
import MediaPlayer

/// The actions for a track — used in the player's "…" button, queue rows and (as a context
/// menu) everywhere tracks are listed.
struct TrackMenuContent: View {
    @Environment(AppModel.self) private var app
    let track: Track

    var body: some View {
        let isRadio = track.directURL != nil
        if !isRadio {
            Button { app.player.playNext(track) } label: { Label("Play Next", systemImage: "text.line.first.and.arrowtriangle.forward") }
            Button { app.player.addToQueue(track) } label: { Label("Add to Queue", systemImage: "text.line.last.and.arrowtriangle.forward") }
            Button { app.instantMix(for: track) } label: { Label("Instant Mix", systemImage: "wand.and.stars") }
            Divider()
            if let album = Album(track: track) {
                Button { app.router.show(album: album) } label: { Label("Show Album", systemImage: "square.stack") }
            }
            if let artist = Artist(track: track) {
                Button { app.router.show(artist: artist) } label: { Label("Show Artist", systemImage: "music.mic") }
            }
            Divider()
            if AudioCache.shared.isPinned(track.id) {
                Button { app.removeOffline([track.id]) } label: { Label("Remove Offline", systemImage: "arrow.down.circle.badge.xmark") }
            } else {
                Button { app.keepOffline([track]) } label: { Label("Keep Offline", systemImage: "arrow.down.circle") }
            }
            Button { app.toggleStar(track) } label: {
                Label(app.isStarred(track) ? String(localized: "Remove Favorite") : String(localized: "Favorite"), systemImage: app.isStarred(track) ? "heart.slash" : "heart")
            }
            Menu {
                ForEach(1...5, id: \.self) { n in
                    Button { app.setRating(track, n) } label: {
                        Label(String(repeating: "★", count: n), systemImage: app.rating(track) == n ? "checkmark" : "star")
                    }
                }
                if app.rating(track) > 0 { Button("Clear Rating", role: .destructive) { app.setRating(track, 0) } }
            } label: {
                Label(app.rating(track) > 0 ? String(localized: "Rating") + ": " + String(repeating: "★", count: app.rating(track)) : String(localized: "Rating"), systemImage: "star")
            }
            Button { app.share(track) } label: { Label("Share", systemImage: "square.and.arrow.up") }
            Menu {
                Button { app.newPlaylist(with: [track]) } label: { Label("New Playlist…", systemImage: "plus") }
                if !app.playlists.isEmpty {
                    Divider()
                    ForEach(app.playlists) { p in
                        Button(p.name) { Task { await app.addToPlaylist(track, p) } }
                    }
                }
            } label: { Label("Add to Playlist", systemImage: "text.badge.plus") }
            Menu {
                ForEach(info, id: \.self) { Text($0) }
            } label: { Label("Track Info", systemImage: "info.circle") }
        }
    }

    private var info: [String] {
        var rows: [String] = []
        let quality = [track.format?.uppercased(), track.bitrate.map { "\($0) kbps" }].compactMap { $0 }.joined(separator: " · ")
        if !quality.isEmpty { rows.append(quality) }
        if let a = track.album { rows.append(String(localized: "Album: \(a)")) }
        if let y = track.year { rows.append(String(localized: "Year: \(y)")) }
        if let g = track.genre { rows.append(String(localized: "Genre: \(g)")) }
        rows.append(String(localized: "Length: \(formatTime(Double(track.duration)))"))
        return rows
    }
}

/// System AirPlay route picker.
struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let v = AVRoutePickerView()
        v.tintColor = UIColor.white.withAlphaComponent(0.75)
        v.activeTintColor = UIColor(Theme.accent)
        v.prioritizesVideoDevices = false
        return v
    }
    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}

/// The system output volume slider.
struct SystemVolumeSlider: UIViewRepresentable {
    func makeUIView(context: Context) -> MPVolumeView {
        let v = MPVolumeView(frame: .zero)
        v.tintColor = UIColor.white.withAlphaComponent(0.85)
        return v
    }
    func updateUIView(_ uiView: MPVolumeView, context: Context) {}
}
