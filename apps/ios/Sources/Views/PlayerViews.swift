import SwiftUI

/// Mini player above the tab bar. Opens the full-screen player. When nothing plays on
/// this phone but another device is playing, shows that instead (with "Play here").
struct MiniPlayerBar: View {
    @Environment(AppModel.self) private var app
    @Namespace private var zoom

    var body: some View {
        let p = app.player
        let router = app.router
        Group {
            if let t = p.current {
                bar(title: t.title, subtitle: t.artist, cover: t.coverArt,
                    progress: p.duration > 0 ? p.position / p.duration : 0,
                    playing: p.isPlaying,
                    toggle: { p.toggle() }, next: { p.next() }, open: { router.showPlayer = true })
            } else if let t = app.sync.remoteTrack, let active = app.sync.activeDeviceId, active != app.sync.deviceId {
                let name = app.sync.devices.first(where: { $0.id == active })?.name ?? "another device"
                bar(title: t.title, subtitle: "Playing on \(name)", cover: t.coverArt, progress: 0,
                    playing: app.sync.remotePlaying,
                    toggle: { app.sync.command(to: active, "toggle") },
                    next: { app.sync.command(to: active, "next") },
                    open: { app.sync.transfer(to: app.sync.deviceId) })
            }
        }
        .fullScreenCover(isPresented: Bindable(router).showPlayer) {
            NowPlayingView()
                .navigationTransition(.zoom(sourceID: "cover", in: zoom))
        }
    }

    private func bar(title: String, subtitle: String, cover: String?, progress: Double, playing: Bool,
                     toggle: @escaping () -> Void, next: @escaping () -> Void, open: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Button(action: open) {
                HStack(spacing: 10) {
                    CoverImage(id: cover, size: 100)
                        .frame(width: 36, height: 36).clipShape(RoundedRectangle(cornerRadius: 6))
                        .matchedTransitionSource(id: "cover", in: zoom)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button(action: toggle) { Image(systemName: playing ? "pause.fill" : "play.fill").font(.title3).frame(width: 36, height: 36) }
            Button(action: next) { Image(systemName: "forward.fill").font(.title3).frame(width: 36, height: 36) }
        }
        .padding(.horizontal, 12)
        .foregroundStyle(.primary)
    }
}

struct NowPlayingView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var scrub: Double?
    @State private var showQueue = false
    @State private var showDevices = false

    var body: some View {
        let p = app.player
        ZStack {
            background(p.current)
            VStack(spacing: 14) {
                header(p)
                if showQueue {
                    QueueView()
                } else {
                    Spacer(minLength: 0)
                    artwork(p)
                    Spacer(minLength: 0)
                    titleRow(p)
                }
                progress(p)
                controls(p)
                if !showQueue { volume }
                bottomBar(p)
            }
            .padding(.horizontal, 24)
            .padding(.top, 14)
            .padding(.bottom, 8)
        }
        .foregroundStyle(.white)
        .sheet(isPresented: $showDevices) {
            NavigationStack {
                List { DevicesList() }
                    .navigationTitle("Devices")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showDevices = false } } }
            }
            .presentationDetents([.medium, .large])
        }
    }

    // MARK: Pieces

    private func background(_ t: Track?) -> some View {
        ZStack {
            Theme.background
            CoverImage(id: t?.coverArt, size: 200)
                .scaleEffect(1.6)
                .blur(radius: 70)
                .opacity(0.9)
            Color.black.opacity(0.35)
        }
        .ignoresSafeArea()
    }

    private func header(_ p: PlayerModel) -> some View {
        HStack {
            pill("\(max(p.index + 1, 0)) of \(p.queue.count)")
            Spacer()
            pill("-\(formatLong(p.queueRemaining)) / \(formatLong(p.queueTotal))")
        }
        .overlay(Capsule().fill(.white.opacity(0.45)).frame(width: 40, height: 5)) // drag handle hint
    }

    private func pill(_ text: String) -> some View {
        Text(text)
            .font(.footnote.weight(.semibold)).monospacedDigit()
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(.ultraThinMaterial, in: Capsule())
    }

    private func artwork(_ p: PlayerModel) -> some View {
        CoverImage(id: p.current?.coverArt, size: 800)
            .aspectRatio(1, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.5), radius: 26, y: 12)
            .scaleEffect(p.isPlaying ? 1 : 0.86)
            .animation(.spring(response: 0.45, dampingFraction: 0.75), value: p.isPlaying)
    }

    private func titleRow(_ p: PlayerModel) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(p.current?.title ?? "Nothing playing").font(.title2.bold()).lineLimit(1)
                subtitle(p.current)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let t = p.current, t.directURL == nil {
                Button { p.toggleFavorite(t.id) } label: {
                    Image(systemName: t.starred ? "heart.fill" : "heart")
                        .font(.title3).foregroundStyle(t.starred ? Color.red : Color.white)
                        .frame(width: 44, height: 44)
                        .background(.ultraThinMaterial, in: Circle())
                }
                Menu {
                    TrackMenuContent(track: t)
                } label: {
                    Image(systemName: "ellipsis").font(.title3)
                        .frame(width: 44, height: 44)
                        .background(.ultraThinMaterial, in: Circle())
                }
            }
        }
    }

    @ViewBuilder
    private func subtitle(_ t: Track?) -> some View {
        if let t {
            HStack(spacing: 4) {
                Text(t.artist).lineLimit(1)
                if let album = t.album, !album.isEmpty {
                    Text("•")
                    Text(album).lineLimit(1)
                }
            }
            .font(.body).foregroundStyle(.white.opacity(0.75))
        }
    }

    private func progress(_ p: PlayerModel) -> some View {
        VStack(spacing: 2) {
            Slider(
                value: Binding(get: { scrub ?? p.position }, set: { scrub = $0 }),
                in: 0...max(p.duration, 1),
                onEditingChanged: { editing in
                    if !editing, let s = scrub { p.seek(to: s); scrub = nil }
                }
            )
            .tint(.white)
            HStack {
                Text(formatTime(scrub ?? p.position))
                Spacer()
                Text(qualityText(p.current)).font(.caption2)
                Spacer()
                Text("-" + formatTime(max(0, p.duration - (scrub ?? p.position))))
            }
            .font(.caption).foregroundStyle(.white.opacity(0.7)).monospacedDigit()
        }
    }

    private func qualityText(_ t: Track?) -> String {
        guard let t else { return "" }
        if t.directURL != nil { return "Radio" }
        return [t.format?.uppercased(), t.bitrate.map { "\($0) kbps" }].compactMap { $0 }.joined(separator: " ")
    }

    private func controls(_ p: PlayerModel) -> some View {
        HStack {
            Spacer()
            Button { p.previous() } label: { Image(systemName: "backward.fill").font(.system(size: 34)) }
            Spacer()
            Button { p.toggle() } label: { Image(systemName: p.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 54)) }
            Spacer()
            Button { p.next() } label: { Image(systemName: "forward.fill").font(.system(size: 34)) }
            Spacer()
        }
        .buttonStyle(.plain)
        .padding(.vertical, 6)
    }

    private var volume: some View {
        HStack(spacing: 10) {
            Image(systemName: "speaker.fill").font(.footnote).foregroundStyle(.white.opacity(0.7))
            SystemVolumeSlider().frame(height: 30)
            Image(systemName: "speaker.wave.3.fill").font(.footnote).foregroundStyle(.white.opacity(0.7))
        }
    }

    private func bottomBar(_ p: PlayerModel) -> some View {
        HStack {
            Button { p.toggleShuffle() } label: { Image(systemName: "shuffle") }
                .foregroundStyle(p.shuffle ? Theme.accent : Color.white.opacity(0.75))
            Spacer()
            Button { p.toggleRepeat() } label: { Image(systemName: "repeat") }
                .foregroundStyle(p.repeatAll ? Theme.accent : Color.white.opacity(0.75))
            Spacer()
            AirPlayButton().frame(width: 30, height: 30)
            Spacer()
            Button { showDevices = true } label: { Image(systemName: "laptopcomputer.and.iphone") }
                .foregroundStyle(app.sync.status == "online" ? Color.white.opacity(0.75) : Color.white.opacity(0.35))
            Spacer()
            Button { withAnimation(.snappy) { showQueue.toggle() } } label: {
                Image(systemName: "list.bullet")
                    .padding(8)
                    .background(showQueue ? AnyShapeStyle(Color.white) : AnyShapeStyle(Color.clear), in: RoundedRectangle(cornerRadius: 8))
                    .foregroundStyle(showQueue ? Color.black : Color.white.opacity(0.75))
            }
        }
        .font(.title3)
        .buttonStyle(.plain)
    }
}

func formatLong(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds >= 0 else { return "0:00" }
    let s = Int(seconds)
    let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
}

/// The play queue: the current track highlighted, tracks before and after it. Drag the handles
/// to reorder, long-press a row for the track menu, tap to jump.
struct QueueView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let p = app.player
        ScrollViewReader { proxy in
            List {
                ForEach(Array(p.queue.enumerated()), id: \.offset) { i, t in
                    Button { p.play(p.queue, at: i) } label: { queueRow(t, current: i == p.index) }
                        .buttonStyle(.plain)
                        .listRowBackground(i == p.index ? Color.white.opacity(0.14) : Color.clear)
                        .listRowSeparatorTint(.white.opacity(0.15))
                        .contextMenu {
                            TrackMenuContent(track: t)
                            Divider()
                            Button(role: .destructive) { p.removeFromQueue(at: i) } label: { Label("Remove from Queue", systemImage: "minus.circle") }
                        }
                        .deleteDisabled(true)
                        .id(i)
                }
                .onMove { p.moveInQueue(from: $0, to: $1) }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .environment(\.editMode, .constant(.active)) // shows the reorder handles
            .onAppear { proxy.scrollTo(max(p.index - 1, 0), anchor: .top) }
        }
    }

    private func queueRow(_ t: Track, current: Bool) -> some View {
        HStack(spacing: 12) {
            CoverImage(id: t.coverArt, size: 100)
                .frame(width: 46, height: 46).clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(t.title).font(.body.weight(current ? .bold : .regular)).lineLimit(1)
                Text(t.artist).font(.caption).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}
