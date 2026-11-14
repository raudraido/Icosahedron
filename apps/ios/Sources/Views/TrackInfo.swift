import SwiftUI

/// Details of the playing track, shown under the shrunken cover on the player. The queue's
/// tracks can come from the sync hub with only the basics, so the full song is fetched once.
struct InfoPanel: View {
    @Environment(AppModel.self) private var app
    let track: Track?
    /// Back to the big cover: a tap on the small cover at the top, or anywhere on the panel that is not a button.
    var onBack: (() -> Void)?
    @State private var detail: Track?
    @State private var bpm: Double?

    var body: some View {
        let t = detail ?? track
        ScrollView {
            if let t {
                VStack(spacing: 14) {
                    if let onBack {
                        CoverImage(id: t.coverArt, size: 300)
                            .frame(width: 110, height: 110)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .onTapGesture(perform: onBack)
                            .accessibilityLabel("Back to the cover")
                            .accessibilityAddTraits(.isButton)
                    }
                    card {
                        row("Title", t.title)
                        if let a = Artist(track: t) {
                            tappable("Artist", t.artist) { app.router.show(artist: a) }
                        } else {
                            row("Artist", t.artist)
                        }
                        if let album = Album(track: t), let name = t.album, !name.isEmpty {
                            tappable("Album", name) { app.router.show(album: album) }
                        } else if let name = t.album, !name.isEmpty {
                            row("Album", name)
                        }
                        if t.trackNumber > 0 { row("Track", t.discNumber > 1 ? "\(t.discNumber)-\(t.trackNumber)" : "\(t.trackNumber)") }
                        if let y = t.year { row("Year", String(y)) }
                        if let g = t.genre, !g.isEmpty { row("Genre", g) }
                    }
                    card {
                        if let f = t.format, !f.isEmpty { row("Format", f.uppercased()) }
                        if let b = t.bitrate { row("Bitrate", "\(b) kbps") }
                        if let sr = t.samplingRate { row("Sample rate", sampleRate(sr)) }
                        if let bd = t.bitDepth, bd > 0 { row("Bit depth", "\(bd)-bit") }
                        if let ch = t.channels { row("Channels", channelText(ch)) }
                        row("Length", formatTime(Double(t.duration)))
                        if let s = t.size { row("File size", ByteCountFormatter.string(fromByteCount: Int64(s), countStyle: .file)) }
                        if let p = t.path, !p.isEmpty { row("Path", p, small: true) }
                    }
                    if bpm != nil || t.playCount != nil || t.created != nil {
                        card {
                            if let bpm { row("BPM", bpm == bpm.rounded() ? String(format: "%.0f", bpm) : String(format: "%.1f", bpm)) }
                            if let n = t.playCount { row("Plays", String(n)) }
                            if let d = addedDate(t.created) { row("Added", d) }
                        }
                    }
                }
                .padding(.vertical, 4)
                .contentShape(Rectangle())
                .onTapGesture { onBack?() }
            }
        }
        .scrollIndicators(.hidden)
        .task(id: track?.id) {
            detail = nil
            bpm = nil
            guard let id = track?.id, track?.directURL == nil else { return }
            async let full = app.client?.song(id)
            async let tempo = app.client?.bpm(for: id)
            detail = try? await full
            bpm = await tempo
        }
    }

    // MARK: Pieces

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    private func row(_ label: LocalizedStringKey, _ value: String, small: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).foregroundStyle(.white.opacity(0.65))
            Spacer(minLength: 8)
            Text(value)
                .font(small ? .caption : .body)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .overlay(alignment: .bottom) { Divider().overlay(.white.opacity(0.12)).padding(.leading, 14) }
    }

    private func tappable(_ label: LocalizedStringKey, _ value: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(label).foregroundStyle(.white.opacity(0.65))
                Spacer(minLength: 8)
                Text(value).multilineTextAlignment(.trailing).foregroundStyle(Theme.accent)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.4))
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .overlay(alignment: .bottom) { Divider().overlay(.white.opacity(0.12)).padding(.leading, 14) }
        }
        .buttonStyle(.plain)
    }

    private func addedDate(_ iso: String?) -> String? {
        guard let iso else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let g = ISO8601DateFormatter()
        guard let date = f.date(from: iso) ?? g.date(from: iso) else { return nil }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    private func sampleRate(_ hz: Int) -> String {
        let k = Double(hz) / 1000
        return k == k.rounded() ? String(format: "%.0f kHz", k) : String(format: "%.1f kHz", k)
    }

    private func channelText(_ n: Int) -> String {
        switch n {
        case 1: return "Mono"
        case 2: return "Stereo"
        default: return "\(n) channels"
        }
    }
}
