import SwiftUI

/// Lyrics of the playing track. Synced lyrics follow the song (the current line is bright and
/// centered, tap a line to jump there); plain lyrics just scroll. Looked up on the server first,
/// then on LRCLIB (can be switched off in settings).
struct LyricsView: View {
    @Environment(AppModel.self) private var app
    let track: Track?
    @AppStorage("lyricsOnline") private var lookOnline = true

    private enum Phase { case loading, ready, none }
    @State private var phase: Phase = .loading
    @State private var lines: [LyricsLine] = []

    private var synced: Bool { !lines.isEmpty && lines.allSatisfy { $0.time != nil } }

    var body: some View {
        Group {
            switch phase {
            case .loading:
                ProgressView().tint(.white)
            case .none:
                Text("No lyrics found").foregroundStyle(.white.opacity(0.6))
            case .ready:
                list
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: track?.id) { await load() }
    }

    private var list: some View {
        // Ticks on its own: another device's position is not an observed property.
        TimelineView(.periodic(from: .now, by: 0.25)) { ctx in listBody(at: ctx.date) }
    }

    private func listBody(at date: Date) -> some View {
        let s = app.nowPlaying
        let current = currentIndex(s.position(at: date))
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                        let active = synced ? i == current : true
                        lineText(line, active: active, source: s)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                            .onTapGesture { if let t = line.time { s.seek(to: t) } }
                            .animation(.easeInOut(duration: 0.25), value: active)
                            .id(i)
                    }
                }
                .padding(.vertical, 40)
            }
            .scrollIndicators(.hidden)
            .onChange(of: current) { _, new in
                guard synced, let new else { return }
                withAnimation(.easeInOut(duration: 0.45)) { proxy.scrollTo(new, anchor: .center) }
            }
        }
    }

    /// A line of text. The sung line of a song with karaoke lyrics is drawn word by word (its own clock, 10 times a second, only
    /// for that one line); every other line is plain.
    @ViewBuilder
    private func lineText(_ line: LyricsLine, active: Bool, source s: NowPlayingSource) -> some View {
        if active, synced, let words = line.words {
            TimelineView(.periodic(from: .now, by: 0.1)) { ctx in
                Text(Self.styled(words, at: s.livePosition(at: ctx.date))).font(.title2.weight(.bold))
            }
        } else {
            Text(line.text.isEmpty ? "♪" : line.text)
                .font(.title2.weight(.bold))
                .foregroundStyle(.white.opacity(active ? 1 : 0.38))
        }
    }

    /// The words already sung are white, the one being sung is in the accent colour, the rest is dim.
    private static func styled(_ words: [LyricsWord], at position: Double) -> AttributedString {
        var out = AttributedString()
        for (k, w) in words.enumerated() {
            let end = w.end ?? (k + 1 < words.count ? words[k + 1].start : .infinity)
            var a = AttributedString(w.text)
            a.foregroundColor = position >= end ? Color.white : (position >= w.start ? Theme.accent : Color.white.opacity(0.38))
            out += a
        }
        return out
    }

    /// The last line that has started (a quarter second early, so it lights up as it begins).
    private func currentIndex(_ position: Double) -> Int? {
        guard synced else { return nil }
        var lo = 0, hi = lines.count - 1
        var answer: Int?
        while lo <= hi {
            let mid = (lo + hi) / 2
            if (lines[mid].time ?? .infinity) <= position + 0.25 {
                answer = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        return answer
    }

    private func load() async {
        guard let t = track, t.directURL == nil, let client = app.client else {
            phase = .none
            return
        }
        if let cached = LyricsCache.lines[t.id] {
            lines = cached
            phase = cached.isEmpty ? .none : .ready
            return
        }
        phase = .loading
        lines = []
        var found: [LyricsLine]? = try? await client.structuredLyrics(songId: t.id)
        if found == nil, let text = try? await client.plainLyrics(artist: t.artist, title: t.title) {
            found = LyricsParser.plain(text)
        }
        if found == nil, lookOnline { found = await LRCLib.fetch(t) }
        guard track?.id == t.id else { return } // skipped to another track meanwhile
        LyricsCache.lines[t.id] = found ?? []
        lines = found ?? []
        phase = lines.isEmpty ? .none : .ready
    }
}

/// Info / Lyrics switch shown under the shrunken cover.
struct InfoTabs: View {
    let track: Track?
    @AppStorage("infoTab") private var tab = 0

    var body: some View {
        VStack(spacing: 10) {
            Picker("", selection: $tab) {
                Text("Info").tag(0)
                Text("Lyrics").tag(1)
            }
            .pickerStyle(.segmented)
            if tab == 0 {
                InfoPanel(track: track)
            } else {
                LyricsView(track: track)
            }
        }
    }
}
