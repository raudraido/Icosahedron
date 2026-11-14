import SwiftUI

/// Mini player above the tab bar (our own bar, always the same shape: the system's bottom accessory changed shape while scrolling). Opens the full-screen player. When nothing plays on
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
                if let st = app.sync.state(of: target), let t = st.track {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        bar(title: t.title, subtitle: String(localized: "Playing on \(name)"), cover: t.coverArt,
                            progress: t.duration > 0 ? app.sync.position(of: target, at: ctx.date) / Double(t.duration) : 0,
                            playing: st.playing, accent: true,
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
            } else if let other = app.sync.otherPlaying, let t = other.state.track {
                // Silent here, but another device plays: show it; opening it makes it the one to control.
                let name = app.sync.devices.first(where: { $0.id == other.id })?.name ?? String(localized: "another device")
                bar(title: t.title, subtitle: String(localized: "Playing on \(name)"), cover: t.coverArt, progress: 0,
                    playing: true,
                    toggle: { app.sync.command(to: other.id, "toggle") },
                    next: { app.sync.command(to: other.id, "next") },
                    open: { app.sync.setTarget(other.id); router.showPlayer = true })
            }
        }
    }

    private func bar(title: String, subtitle: String, cover: String?, progress: Double, playing: Bool, accent: Bool = false,
                     toggle: @escaping () -> Void, next: @escaping () -> Void, open: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Button(action: open) {
                HStack(spacing: 10) {
                    CoverImage(id: cover, size: 100)
                        .frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 6))
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
        .padding(.vertical, 8)
        .foregroundStyle(.primary)
        .background(.regularMaterial)
        .overlay(alignment: .top) {
            // A thin progress line, like on Android
            GeometryReader { g in
                Rectangle().fill(Theme.accent).frame(width: g.size.width * min(max(progress, 0), 1), height: 2)
            }
            .frame(height: 2)
        }
    }
}

struct NowPlayingView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var scrub: Double?
    /// What takes the cover's place, like on Android: the queue, the lyrics, or the song's details (tap the cover).
    private enum Panel { case cover, queue, lyrics, info }
    @State private var panel: Panel = .cover
    @State private var showDevices = false
    @State private var showEQ = false
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

    // MARK: Closing

    /// Pull down to close. The system's own dismissal only starts for a quick, straight pull and gives way to
    /// anything under the finger, so this one is ours: a pull of about 90 pt (or a quick flick) that is mostly
    /// downward always closes. It is put on the header, the cover and the title, not on the seek bar, the
    /// buttons or the scrolling lists.
    private var closeGesture: some Gesture {
        DragGesture(minimumDistance: 16)
            .onEnded { v in
                let down = v.translation.height, side = abs(v.translation.width)
                guard down > 0, down > side * 1.2 else { return }
                if down > 90 || (down > 30 && v.predictedEndTranslation.height > 260) { dismiss() }
            }
    }

    // MARK: Layouts

    /// Portrait, like the Android player from top to bottom: the way out (and the devices), the cover or what replaces
    /// it, the song with its favorite heart, the seek bar with the times at its ends, the tools, the controls.
    private func narrowLayout(_ s: NowPlayingSource) -> some View {
        VStack(spacing: 12) {
            header(s).contentShape(Rectangle()).simultaneousGesture(closeGesture)
            panelOrCover(s)
            titleRow(s).contentShape(Rectangle()).simultaneousGesture(closeGesture)
            progress(s)
            tools(s)
            controls(s)
        }
    }

    /// Landscape and iPad: the cover (or its replacement) on the left, everything else on the right.
    private func wideLayout(_ s: NowPlayingSource, _ size: CGSize) -> some View {
        let side = max(160, min(size.height - 90, size.width * 0.42))
        return HStack(spacing: 32) {
            panelOrCover(s)
                .frame(width: side)
            VStack(spacing: 12) {
                header(s).contentShape(Rectangle()).simultaneousGesture(closeGesture)
                Spacer(minLength: 0)
                titleRow(s)
                progress(s)
                tools(s)
                controls(s)
            }
        }
    }

    /// The cover, or the queue / the lyrics / the details that take its place.
    @ViewBuilder
    private func panelOrCover(_ s: NowPlayingSource) -> some View {
        switch panel {
        case .queue:
            QueueView()
        case .lyrics:
            LyricsView(track: s.current)
        case .info where s.current != nil:
            InfoPanel(track: s.current)
        default:
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                artwork(s)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
            .simultaneousGesture(closeGesture)
        }
    }

    private func show(_ p: Panel) {
        withAnimation(.snappy) { panel = panel == p ? .cover : p }
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

    /// The way out at the left (and who plays, when it is another device); AirPlay and the devices at the right.
    private func header(_ s: NowPlayingSource) -> some View {
        HStack(spacing: 14) {
            Button { dismiss() } label: { Image(systemName: "chevron.down").font(.title3.weight(.semibold)).frame(width: 44, height: 44) }
                .accessibilityLabel("Close")
            if s.isRemote, let name = s.targetName {
                Text("Playing on \(name)").font(.subheadline).foregroundStyle(Theme.accent).lineLimit(1)
            }
            Spacer(minLength: 0)
            // AirPlay and the equalizer act on this phone's own sound: while another device is the target they stay in
            // place but inactive.
            AirPlayButton().frame(width: 30, height: 30).accessibilityLabel("AirPlay")
                .allowsHitTesting(!s.isRemote)
                .opacity(s.isRemote ? 0.3 : 1)
            devicesButton(s)
        }
        .buttonStyle(.plain)
    }

    private func artwork(_ s: NowPlayingSource) -> some View {
        CoverImage(id: s.current?.coverArt, size: 800)
            .aspectRatio(1, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.5), radius: 26, y: 12)
            .scaleEffect(s.isPlaying || reduceMotion ? 1 : 0.86)
            .animation(reduceMotion ? nil : .spring(response: 0.45, dampingFraction: 0.75), value: s.isPlaying)
            .contentShape(Rectangle())
            .onTapGesture { if s.current != nil { show(.info) } }
    }

    /// "Nothing playing", or which device has nothing when another one is the target.
    private func emptyTitle(_ s: NowPlayingSource) -> String {
        if let name = s.targetName { return String(localized: "Nothing playing on \(name)") }
        return String(localized: "Nothing playing")
    }

    /// The title big, the artist and the album under it, the favorite heart at the right edge of the same row.
    private func titleRow(_ s: NowPlayingSource) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(s.current?.title ?? emptyTitle(s)).font(.title2.bold()).lineLimit(2)
                if let t = s.current {
                    Text(t.artist).font(.body).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
                    if let album = t.album, !album.isEmpty {
                        Text(album).font(.subheadline).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let t = s.current, t.directURL == nil {
                Button { app.toggleStar(t) } label: {
                    Image(systemName: app.isStarred(t) ? "heart.fill" : "heart")
                        .font(.title2).foregroundStyle(app.isStarred(t) ? Theme.accent : Color.white)
                        .frame(width: 48, height: 48)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(LocalizedStringKey(app.isStarred(t) ? "Remove Favorite" : "Favorite"))
            }
        }
    }

    /// The seek bar with the time played at its left end and the time left (with a minus) at its right end.
    private func progress(_ s: NowPlayingSource) -> some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { ctx in
            let pos = scrub ?? s.position(at: ctx.date)
            HStack(spacing: 8) {
                Text(formatTime(pos)).frame(minWidth: 38, alignment: .leading)
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
                Text("-" + formatTime(max(0, s.duration - pos) / (s.isRemote ? 1 : max(app.player.speed, 0.1))))
                    .frame(minWidth: 44, alignment: .trailing)
            }
            .font(.caption).foregroundStyle(.white.opacity(0.75)).monospacedDigit()
        }
    }

    /// The playback controls at the very bottom: play is the biggest (a white circle), the others are far apart.
    private func controls(_ s: NowPlayingSource) -> some View {
        HStack {
            Button { s.toggleShuffle() } label: { Image(systemName: "shuffle").font(.system(size: 24, weight: .semibold)).frame(width: 52, height: 52) }
                .accessibilityLabel("Shuffle")
                .accessibilityValue(LocalizedStringKey(s.shuffle ? "On" : "Off"))
                .foregroundStyle(s.shuffle ? Theme.accent : Color.white)
            Spacer()
            Button { s.previous() } label: { Image(systemName: "backward.end.fill").font(.system(size: 34)).frame(width: 60, height: 60) }
                .accessibilityLabel("Previous")
            Spacer()
            Button { s.toggle() } label: {
                Image(systemName: s.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 36)).foregroundStyle(Theme.background)
                    .frame(width: 78, height: 78).background(Color.white, in: Circle())
            }
            .accessibilityLabel(LocalizedStringKey(s.isPlaying ? "Pause" : "Play"))
            Spacer()
            Button { s.next() } label: { Image(systemName: "forward.end.fill").font(.system(size: 34)).frame(width: 60, height: 60) }
                .accessibilityLabel("Next")
            Spacer()
            Button { s.toggleRepeat() } label: { Image(systemName: "repeat").font(.system(size: 24, weight: .semibold)).frame(width: 52, height: 52) }
                .accessibilityLabel("Repeat")
                .accessibilityValue(LocalizedStringKey(s.repeatOn ? "On" : "Off"))
                .foregroundStyle(s.repeatOn ? Theme.accent : Color.white)
        }
        .buttonStyle(.plain)
        .disabled(s.current == nil)
        .opacity(s.current == nil ? 0.4 : 1)
        .padding(.top, 2)
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
                .font(.title3.weight(.bold)).monospacedDigit()
                .foregroundStyle(p.speed == 1.0 ? Color.white : Theme.accent)
                .frame(width: 52, height: 44)
        }
    }

    /// The tools under the seek bar, like on Android: lyrics, speed, the queue and the menu (the favorite is next to
    /// the title).
    private func tools(_ s: NowPlayingSource) -> some View {
        HStack {
            Spacer()
            tool("quote.bubble", label: "Lyrics", active: panel == .lyrics) { show(.lyrics) }
            Spacer()
            if !s.isRemote {
                speedMenu(app.player)
                Spacer()
            }
            tool("list.bullet", label: "Queue", active: panel == .queue) { show(.queue) }
            Spacer()
            Menu {
                if let t = s.current { TrackMenuContent(track: t) }
                Divider()
                if !s.isRemote {
                    Button { showEQ = true } label: { Label("Equalizer", systemImage: "slider.vertical.3") }
                }
            } label: {
                Image(systemName: "ellipsis").rotationEffect(.degrees(90)).font(.title3)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("More")
            .disabled(s.current == nil)
            Spacer()
        }
        .foregroundStyle(.white)
        .font(.title3)
        .buttonStyle(.plain)
    }

    private func tool(_ icon: String, label: LocalizedStringKey, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.title3)
                .foregroundStyle(active ? Theme.accent : Color.white)
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel(label)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    /// The devices button: highlighted while another device is the target.
    private func devicesButton(_ s: NowPlayingSource) -> some View {
        Button { showDevices = true } label: {
            Image(systemName: s.isRemote ? "hifispeaker.fill" : "laptopcomputer.and.iphone")
                .font(.title3).frame(width: 36, height: 36)
        }
        .accessibilityLabel("Devices")
        .foregroundStyle(s.isRemote ? Theme.accent : (app.sync.status == "online" ? Color.white : Color.white.opacity(0.4)))
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
