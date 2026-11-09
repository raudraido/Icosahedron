import SwiftUI

/// Mini player above the tab bar. Opens the full-screen player. When nothing plays on
/// this phone but another device is playing, shows that instead (with "Play here").
struct MiniPlayerBar: View {
    @Environment(AppModel.self) private var app
    @State private var showPlayer = false

    var body: some View {
        let p = app.player
        Group {
            if let t = p.current {
                bar(title: t.title, subtitle: t.artist, cover: t.coverArt,
                    progress: p.duration > 0 ? p.position / p.duration : 0,
                    playing: p.isPlaying,
                    toggle: { p.toggle() }, next: { p.next() }, open: { showPlayer = true })
            } else if let t = app.sync.remoteTrack, let active = app.sync.activeDeviceId, active != app.sync.deviceId {
                let name = app.sync.devices.first(where: { $0.id == active })?.name ?? "another device"
                bar(title: t.title, subtitle: "Playing on \(name)", cover: t.coverArt, progress: 0,
                    playing: app.sync.remotePlaying,
                    toggle: { app.sync.command(to: active, "toggle") },
                    next: { app.sync.command(to: active, "next") },
                    open: { app.sync.transfer(to: app.sync.deviceId) })
            }
        }
        .fullScreenCover(isPresented: $showPlayer) { NowPlayingView() }
    }

    private func bar(title: String, subtitle: String, cover: String?, progress: Double, playing: Bool,
                     toggle: @escaping () -> Void, next: @escaping () -> Void, open: @escaping () -> Void) -> some View {
        VStack(spacing: 0) {
            GeometryReader { g in
                Rectangle().fill(Theme.accent).frame(width: g.size.width * min(max(progress, 0), 1), height: 2)
            }
            .frame(height: 2)
            HStack(spacing: 12) {
                Button(action: open) {
                    HStack(spacing: 12) {
                        CoverImage(id: cover, size: 100)
                            .frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 6))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Button(action: toggle) { Image(systemName: playing ? "pause.fill" : "play.fill").font(.title2).frame(width: 40, height: 40) }
                Button(action: next) { Image(systemName: "forward.fill").font(.title3).frame(width: 40, height: 40) }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .foregroundStyle(.primary)
        }
        .background(.ultraThinMaterial)
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
        VStack(spacing: 18) {
            HStack {
                Button { dismiss() } label: { Image(systemName: "chevron.down").font(.title2).padding(8) }
                Spacer()
                Text("Now Playing").font(.footnote).foregroundStyle(.secondary)
                Spacer()
                Button { showDevices = true } label: {
                    Image(systemName: "airplayaudio").font(.title3).padding(8)
                        .foregroundStyle(app.sync.status == "online" ? Color.primary : Color.secondary)
                }
            }

            Spacer(minLength: 0)
            CoverImage(id: p.current?.coverArt, size: 800)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .shadow(color: .black.opacity(0.45), radius: 24, y: 10)
                .padding(.horizontal, 6)

            VStack(alignment: .leading, spacing: 4) {
                Text(p.current?.title ?? "Nothing playing").font(.title2.bold()).lineLimit(1)
                Text(p.current?.artist ?? "").font(.body).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 2) {
                Slider(
                    value: Binding(get: { scrub ?? p.position }, set: { scrub = $0 }),
                    in: 0...max(p.duration, 1),
                    onEditingChanged: { editing in
                        if !editing, let s = scrub { p.seek(to: s); scrub = nil }
                    }
                )
                HStack {
                    Text(formatTime(scrub ?? p.position))
                    Spacer()
                    Text("-" + formatTime(max(0, p.duration - (scrub ?? p.position))))
                }
                .font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }

            HStack {
                Button { p.toggleShuffle() } label: { Image(systemName: "shuffle").font(.title3) }
                    .foregroundStyle(p.shuffle ? Theme.accent : Color.secondary)
                Spacer()
                Button { p.previous() } label: { Image(systemName: "backward.fill").font(.title) }
                Spacer()
                Button { p.toggle() } label: {
                    Image(systemName: p.isPlaying ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 72))
                }
                Spacer()
                Button { p.next() } label: { Image(systemName: "forward.fill").font(.title) }
                Spacer()
                Button { p.toggleRepeat() } label: { Image(systemName: "repeat").font(.title3) }
                    .foregroundStyle(p.repeatAll ? Theme.accent : Color.secondary)
            }
            .foregroundStyle(.primary)
            .buttonStyle(.plain)

            Button { showQueue = true } label: { Label("Queue", systemImage: "list.bullet") }
                .font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 24).padding(.bottom, 8)
        .background(Theme.background.ignoresSafeArea())
        .sheet(isPresented: $showQueue) { QueueSheet() }
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
}

struct QueueSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            let p = app.player
            List {
                ForEach(Array(p.queue.enumerated()), id: \.offset) { i, t in
                    Button { p.play(p.queue, at: i) } label: { TrackRow(track: t, showCover: true) }
                        .buttonStyle(.plain)
                        .listRowBackground(i == p.index ? Theme.accent.opacity(0.15) : Color.clear)
                }
            }
            .listStyle(.plain)
            .navigationTitle("Queue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
