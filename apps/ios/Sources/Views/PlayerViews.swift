import SwiftUI

/// Mini player above the tab bar. Opens the full-screen player. When nothing plays on
/// this phone but another device is playing, shows that instead (with "Play here").
struct MiniPlayerBar: View {
    @Environment(AppModel.self) private var app
    let zoom: Namespace.ID

    var body: some View {
        let p = app.player
        let router = app.router
        Group {
            if let target = app.sync.remoteTarget {
                // The controls act on another device: show what it plays.
                let name = app.sync.devices.first(where: { $0.id == target })?.name ?? String(localized: "another device")
                if app.sync.activeDeviceId == target, let t = app.sync.remoteTrack {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        bar(title: t.title, subtitle: String(localized: "Playing on \(name)"), cover: t.coverArt,
                            progress: t.duration > 0 ? app.sync.remotePosition(at: ctx.date) / Double(t.duration) : 0,
                            playing: app.sync.remotePlaying, accent: true,
                            toggle: { app.sync.command(to: target, "toggle") },
                            next: { app.sync.command(to: target, "next") },
                            open: { router.showPlayer = true })
                    }
                } else {
                    bar(title: name, subtitle: String(localized: "Nothing playing"), cover: nil, progress: 0, playing: false, accent: true,
                        toggle: {}, next: {}, open: { router.showPlayer = true })
                }
            } else if let t = p.current {
                bar(title: t.title, subtitle: t.artist, cover: t.coverArt,
                    progress: p.duration > 0 ? p.position / p.duration : 0,
                    playing: p.isPlaying,
                    toggle: { p.toggle() }, next: { p.next() }, open: { router.showPlayer = true })
            } else if let t = app.sync.remoteTrack, let active = app.sync.activeDeviceId, active != app.sync.deviceId {
                let name = app.sync.devices.first(where: { $0.id == active })?.name ?? String(localized: "another device")
                bar(title: t.title, subtitle: String(localized: "Playing on \(name)"), cover: t.coverArt, progress: 0,
                    playing: app.sync.remotePlaying,
                    toggle: { app.sync.command(to: active, "toggle") },
                    next: { app.sync.command(to: active, "next") },
                    open: { app.sync.transfer(to: app.sync.deviceId) })
            }
        }
    }

    private func bar(title: String, subtitle: String, cover: String?, progress: Double, playing: Bool, accent: Bool = false,
                     toggle: @escaping () -> Void, next: @escaping () -> Void, open: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Button(action: open) {
                HStack(spacing: 10) {
                    CoverImage(id: cover, size: 100)
                        .frame(width: 36, height: 36).clipShape(RoundedRectangle(cornerRadius: 6))
                        .matchedTransitionSource(id: "cover", in: zoom)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                        HStack(spacing: 4) {
                            if accent { Image(systemName: "hifispeaker.fill").font(.caption2) }
                            Text(subtitle).lineLimit(1)
                        }
                        .font(.caption).foregroundStyle(accent ? Theme.accent : Color.secondary)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button(action: toggle) { Image(systemName: playing ? "pause.fill" : "play.fill").font(.title3).frame(width: 36, height: 36) }
                .accessibilityLabel(LocalizedStringKey(playing ? "Pause" : "Play"))
            Button(action: next) { Image(systemName: "forward.fill").font(.title3).frame(width: 36, height: 36) }
                .accessibilityLabel("Next")
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
    @State private var showInfo = false
    @State private var showEQ = false
    @Namespace private var artNS
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let s = app.nowPlaying
        GeometryReader { g in
            Group {
                if g.size.width > g.size.height {
                    wideLayout(s, g.size)
                } else {
                    narrowLayout(s)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 14)
            .padding(.bottom, 8)
            .frame(width: g.size.width, height: g.size.height)
        }
        .background { background(s.current) }
        .foregroundStyle(.white)
        .sheet(isPresented: $showEQ) { EqualizerSheet() }
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

    // MARK: Layouts

    /// Portrait: everything in one column; the cover shrinks to the corner for info/lyrics.
    private func narrowLayout(_ s: NowPlayingSource) -> some View {
        VStack(spacing: 14) {
            header(s)
            if showQueue {
                QueueView()
            } else if showInfo, s.current != nil {
                infoHeader(s)
                InfoTabs(track: s.current)
            } else {
                Spacer(minLength: 0)
                artwork(s)
                Spacer(minLength: 0)
                titleRow(s)
            }
            progress(s)
            controls(s)
            bottomBar(s)
        }
    }

    /// Landscape and iPad: the cover on the left, everything else on the right.
    private func wideLayout(_ s: NowPlayingSource, _ size: CGSize) -> some View {
        let side = max(160, min(size.height - 90, size.width * 0.42))
        return HStack(spacing: 32) {
            VStack {
                Spacer(minLength: 0)
                artwork(s).frame(width: side)
                Spacer(minLength: 0)
            }
            .frame(width: side)
            VStack(spacing: 12) {
                header(s)
                if showQueue {
                    QueueView()
                } else if showInfo, s.current != nil {
                    InfoTabs(track: s.current)
                } else {
                    Spacer(minLength: 0)
                    titleRow(s)
                    Spacer(minLength: 0)
                }
                progress(s)
                controls(s)
                bottomBar(s)
            }
        }
    }

    // MARK: Pieces

    private func background(_ t: Track?) -> some View {
        Theme.background
            .overlay {
                CoverImage(id: t?.coverArt, size: 200)
                    .scaleEffect(1.6)
                    .blur(radius: 70)
                    .opacity(0.9)
            }
            .overlay { Color.black.opacity(0.35) }
            .clipped()
            .ignoresSafeArea()
    }

    private func header(_ s: NowPlayingSource) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            HStack {
                pill("\(max(s.index + 1, 0)) of \(s.queue.count)")
                Spacer()
                pill("-\(formatLong(s.queueRemaining(at: ctx.date))) / \(formatLong(s.queueTotal))")
            }
        }
        .overlay(Capsule().fill(.white.opacity(0.45)).frame(width: 40, height: 5)) // drag handle hint
    }

    private func pill(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.footnote.weight(.semibold)).monospacedDigit()
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(.ultraThinMaterial, in: Capsule())
    }

    private func artwork(_ s: NowPlayingSource) -> some View {
        CoverImage(id: s.current?.coverArt, size: 800)
            .aspectRatio(1, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .matchedGeometryEffect(id: "art", in: artNS)
            .shadow(color: .black.opacity(0.5), radius: 26, y: 12)
            .scaleEffect(s.isPlaying || reduceMotion ? 1 : 0.86)
            .animation(reduceMotion ? nil : .spring(response: 0.45, dampingFraction: 0.75), value: s.isPlaying)
            .contentShape(Rectangle())
            .onTapGesture { if s.current != nil { toggleInfo() } }
    }

    /// Info mode: the cover has shrunk to the top-left corner, title and actions beside it.
    private func infoHeader(_ s: NowPlayingSource) -> some View {
        HStack(spacing: 12) {
            CoverImage(id: s.current?.coverArt, size: 300)
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .matchedGeometryEffect(id: "art", in: artNS)
                .onTapGesture { toggleInfo() }
            VStack(alignment: .leading, spacing: 3) {
                Text(s.current?.title ?? emptyTitle(s)).font(.headline).lineLimit(2)
                subtitle(s.current)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let t = s.current, t.directURL == nil { actionButtons(t, size: 38) }
        }
    }

    private func toggleInfo() {
        withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) { showInfo.toggle() }
    }

    /// "Nothing playing", or which device has nothing when another one is the target.
    private func emptyTitle(_ s: NowPlayingSource) -> String {
        if let name = s.targetName { return String(localized: "Nothing playing on \(name)") }
        return String(localized: "Nothing playing")
    }

    private func titleRow(_ s: NowPlayingSource) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(s.current?.title ?? emptyTitle(s)).font(.title2.bold()).lineLimit(2)
                subtitle(s.current)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let t = s.current, t.directURL == nil { actionButtons(t, size: 44) }
        }
    }

    private func actionButtons(_ t: Track, size: CGFloat) -> some View {
        HStack(spacing: 10) {
            Button { app.toggleStar(t) } label: {
                Image(systemName: app.isStarred(t) ? "heart.fill" : "heart")
                    .accessibilityLabel(LocalizedStringKey(app.isStarred(t) ? "Remove Favorite" : "Favorite"))
                    .font(.title3).foregroundStyle(app.isStarred(t) ? Color.red : Color.white)
                    .frame(width: size, height: size)
                    .background(.ultraThinMaterial, in: Circle())
            }
            Menu {
                TrackMenuContent(track: t)
            } label: {
                Image(systemName: "ellipsis").font(.title3)
                    .accessibilityLabel("More")
                    .frame(width: size, height: size)
                    .background(.ultraThinMaterial, in: Circle())
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

    private func progress(_ s: NowPlayingSource) -> some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { ctx in
            let pos = scrub ?? s.position(at: ctx.date)
            VStack(spacing: 2) {
                Slider(
                    value: Binding(get: { pos }, set: { scrub = $0 }),
                    in: 0...max(s.duration, 1),
                    onEditingChanged: { editing in
                        if !editing, let v = scrub { s.seek(to: v); scrub = nil }
                    }
                )
                .tint(.white)
                .disabled(s.current == nil)
                .accessibilityLabel("Playback position")
                .accessibilityValue(String(localized: "\(formatTime(pos)) of \(formatTime(s.duration))"))
                HStack {
                    Text(formatTime(pos))
                    Spacer()
                    Text(qualityLine(s)).font(.caption2)
                    Spacer()
                    Text("-" + formatTime(max(0, s.duration - pos) / (s.isRemote ? 1 : max(app.player.speed, 0.1))))
                }
                .font(.caption).foregroundStyle(.white.opacity(0.7)).monospacedDigit()
            }
        }
    }

    private func qualityLine(_ s: NowPlayingSource) -> String {
        if !s.isRemote, !app.player.qualityLabel.isEmpty { return app.player.qualityLabel }
        return qualityText(s.current)
    }

    private func qualityText(_ t: Track?) -> String {
        guard let t else { return "" }
        if t.directURL != nil { return String(localized: "Radio") }
        return [t.format?.uppercased(), t.bitrate.map { "\($0) kbps" }].compactMap { $0 }.joined(separator: " ")
    }

    private func controls(_ s: NowPlayingSource) -> some View {
        HStack {
            Spacer()
            Button { s.previous() } label: { Image(systemName: "backward.fill").font(.system(size: 34)) }
                .accessibilityLabel("Previous")
            Spacer()
            Button { s.toggle() } label: { Image(systemName: s.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 54)) }
                .accessibilityLabel(LocalizedStringKey(s.isPlaying ? "Pause" : "Play"))
            Spacer()
            Button { s.next() } label: { Image(systemName: "forward.fill").font(.system(size: 34)) }
                .accessibilityLabel("Next")
            Spacer()
        }
        .buttonStyle(.plain)
        .disabled(s.current == nil)
        .opacity(s.current == nil ? 0.4 : 1)
        .padding(.vertical, 6)
    }

    private static let speeds: [Double] = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0]

    private func speedLabel(_ v: Double) -> String { String(format: "%g×", v) }

    /// Playback speed, plus "Keep Pitch" (off = the pitch follows the speed, like a record).
    private func speedMenu(_ p: PlayerModel) -> some View {
        Menu {
            Picker("Speed", selection: Binding(get: { p.speed }, set: { p.setSpeed($0) })) {
                ForEach(Self.speeds, id: \.self) { Text(speedLabel($0)).tag($0) }
            }
            Toggle("Keep Pitch", isOn: Binding(get: { p.keepPitch }, set: { p.setKeepPitch($0) }))
        } label: {
            Text(speedLabel(p.speed))
                .font(.subheadline.weight(.bold)).monospacedDigit()
                .foregroundStyle(p.speed == 1.0 ? Color.white.opacity(0.75) : Theme.accent)
                .frame(minWidth: 40)
        }
    }

    private func bottomBar(_ s: NowPlayingSource) -> some View {
        HStack {
            Button { s.toggleShuffle() } label: { Image(systemName: "shuffle") }
                .accessibilityLabel("Shuffle")
                .accessibilityValue(LocalizedStringKey(s.shuffle ? "On" : "Off"))
                .foregroundStyle(s.shuffle ? Theme.accent : Color.white.opacity(0.75))
            Spacer()
            Button { s.toggleRepeat() } label: { Image(systemName: "repeat") }
                .accessibilityLabel("Repeat")
                .accessibilityValue(LocalizedStringKey(s.repeatOn ? "On" : "Off"))
                .foregroundStyle(s.repeatOn ? Theme.accent : Color.white.opacity(0.75))
            // Speed, AirPlay and the equalizer act on this phone's own sound: while another device is
            // the target they stay in place but inactive.
            Spacer()
            speedMenu(app.player)
                .disabled(s.isRemote)
                .opacity(s.isRemote ? 0.3 : 1)
            Spacer()
            AirPlayButton().frame(width: 30, height: 30).accessibilityLabel("AirPlay")
                .allowsHitTesting(!s.isRemote)
                .opacity(s.isRemote ? 0.3 : 1)
            Spacer()
            Button { showEQ = true } label: { Image(systemName: "slider.vertical.3") }
                .foregroundStyle(EQManager.shared.settings.enabled ? Theme.accent : Color.white.opacity(0.75))
                .accessibilityLabel("Equalizer")
                .disabled(s.isRemote)
                .opacity(s.isRemote ? 0.3 : 1)
            Spacer()
            devicesButton(s)
            Spacer()
            Button { withAnimation(.snappy) { showQueue.toggle(); if showQueue { showInfo = false } } } label: {
                Image(systemName: "list.bullet")
                    .accessibilityLabel("Queue")
                    .padding(8)
                    .background(showQueue ? AnyShapeStyle(Color.white) : AnyShapeStyle(Color.clear), in: RoundedRectangle(cornerRadius: 8))
                    .foregroundStyle(showQueue ? Color.black : Color.white.opacity(0.75))
            }
        }
        .font(.title3)
        .buttonStyle(.plain)
    }

    /// The devices button: highlighted, with the device's name, while another device is the target.
    private func devicesButton(_ s: NowPlayingSource) -> some View {
        Button { showDevices = true } label: {
            VStack(spacing: 1) {
                Image(systemName: s.isRemote ? "hifispeaker.fill" : "laptopcomputer.and.iphone")
                if let name = s.targetName {
                    Text(name).font(.system(size: 9, weight: .semibold)).lineLimit(1).frame(maxWidth: 70)
                }
            }
        }
        .accessibilityLabel("Devices")
        .foregroundStyle(s.isRemote ? Theme.accent : (app.sync.status == "online" ? Color.white.opacity(0.75) : Color.white.opacity(0.35)))
    }
}

func formatLong(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds >= 0 else { return "0:00" }
    let s = Int(seconds)
    let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
}

/// The play queue: the current track highlighted, tracks before and after it. Drag the handles
/// to reorder, long-press a row for the track menu, tap to jump. While another device is the
/// target this is that device's queue and every change is sent to it.
struct QueueView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let s = app.nowPlaying
        VStack(spacing: 6) {
            HStack {
                Text("Queue").font(.headline)
                Spacer()
                Menu {
                    Button { app.newPlaylist(with: s.queue) } label: { Label("Save Queue as Playlist", systemImage: "text.badge.plus") }
                        .disabled(s.queue.isEmpty)
                    Button(role: .destructive) { app.player.clearQueue() } label: { Label("Clear Queue", systemImage: "trash") }
                        .disabled(s.isRemote) // only this phone's own queue can be cleared
                } label: { Image(systemName: "ellipsis.circle").font(.title3) }
            }
            queueList(s)
        }
    }

    private func queueList(_ s: NowPlayingSource) -> some View {
        ScrollViewReader { proxy in
            List {
                ForEach(Array(s.queue.enumerated()), id: \.offset) { i, t in
                    Button { s.jump(to: i) } label: { queueRow(t, current: i == s.index) }
                        .buttonStyle(.plain)
                        .listRowBackground(i == s.index ? Color.white.opacity(0.14) : Color.clear)
                        .listRowSeparatorTint(.white.opacity(0.15))
                        .contextMenu {
                            TrackMenuContent(track: t)
                            Divider()
                            Button(role: .destructive) { s.remove(at: i) } label: { Label("Remove from Queue", systemImage: "minus.circle") }
                        }
                        .deleteDisabled(true)
                        .id(i)
                }
                .onMove { s.move(from: $0, to: $1) }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .environment(\.editMode, .constant(.active)) // shows the reorder handles
            .onAppear { proxy.scrollTo(max(s.index - 1, 0), anchor: .top) }
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
