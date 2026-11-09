import SwiftUI

/// Full-screen jukebox: the queue of the device that is playing, big and editable from here.
/// Pushed from the Devices list, so it relies on the surrounding NavigationStack.
struct JukeboxView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let sync = app.sync
        Group {
            if let active = sync.activeDeviceId, active != sync.deviceId, !sync.remoteQueue.isEmpty {
                queue(active, sync)
            } else {
                ContentUnavailableView(
                    String(localized: "No other device is playing"),
                    systemImage: "hifispeaker.2",
                    description: Text("Start music on another device, or send a track there from its menu.")
                )
            }
        }
        .navigationTitle(title(sync))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func title(_ sync: SyncModel) -> String {
        sync.devices.first(where: { $0.id == sync.activeDeviceId })?.name ?? String(localized: "Jukebox")
    }

    private func queue(_ active: String, _ sync: SyncModel) -> some View {
        List {
            if let t = sync.remoteTrack {
                Section {
                    VStack(spacing: 12) {
                        CoverImage(id: t.coverArt, size: 400)
                            .frame(width: 200, height: 200)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        Text(t.title).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
                        Text(t.artist).foregroundStyle(.secondary)
                        RemoteProgress(device: active, duration: Double(t.duration))
                        HStack(spacing: 36) {
                            Button { sync.command(to: active, "prev") } label: { Image(systemName: "backward.fill") }
                            Button { sync.command(to: active, "toggle") } label: { Image(systemName: sync.remotePlaying ? "pause.fill" : "play.fill").font(.title) }
                            Button { sync.command(to: active, "next") } label: { Image(systemName: "forward.fill") }
                        }
                        .font(.title2)
                        .buttonStyle(.borderless)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }
            }
            Section(String(localized: "Queue") + " (\(sync.remoteQueue.count))") {
                ForEach(Array(sync.remoteQueue.enumerated()), id: \.offset) { i, t in
                    Button { sync.jump(on: active, to: i) } label: {
                        HStack(spacing: 12) {
                            CoverImage(id: t.coverArt, size: 100)
                                .frame(width: 44, height: 44)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.title).lineLimit(1).foregroundStyle(i == sync.remoteIndex ? Theme.accent : Color.primary)
                                Text(t.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            if i == sync.remoteIndex {
                                Image(systemName: sync.remotePlaying ? "speaker.wave.2.fill" : "pause.fill").foregroundStyle(Theme.accent)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .swipeActions {
                        Button(role: .destructive) { sync.remove(on: active, at: i) } label: { Label("Remove", systemImage: "trash") }
                    }
                }
            }
        }
    }
}

/// Position of the playing device: moves on by itself, drag to seek.
struct RemoteProgress: View {
    @Environment(AppModel.self) private var app
    let device: String
    let duration: Double
    @State private var dragging: Double?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { ctx in
            let pos = dragging ?? app.sync.remotePosition(at: ctx.date)
            VStack(spacing: 2) {
                Slider(
                    value: Binding(get: { pos }, set: { dragging = $0 }),
                    in: 0...max(duration, 1)
                ) { editing in
                    if !editing, let d = dragging {
                        app.sync.seek(on: device, to: d)
                        dragging = nil
                    }
                }
                .tint(Theme.accent)
                HStack {
                    Text(formatTime(pos))
                    Spacer()
                    Text("-" + formatTime(max(0, duration - pos)))
                }
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
            }
        }
    }
}

/// The Jukebox tab: the user's devices; open the one that is playing to control it.
struct JukeboxTab: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let sync = app.sync
        NavigationStack {
            List {
                if sync.status != "online" {
                    Text(sync.status == "connecting" ? String(localized: "Connecting…") : String(localized: "Sync server not reachable"))
                        .foregroundStyle(.secondary)
                }
                Section(String(localized: "Devices")) {
                    ForEach(sync.devices) { d in
                        row(d, sync)
                    }
                    if sync.status == "online", sync.devices.count <= 1 {
                        Text("No other devices online.").foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Jukebox")
        }
    }

    @ViewBuilder
    private func row(_ d: SyncModel.Device, _ sync: SyncModel) -> some View {
        let isMe = d.id == sync.deviceId
        let isActive = d.id == sync.activeDeviceId
        let content = HStack(spacing: 12) {
            Image(systemName: icon(d.kind)).font(.title3)
                .foregroundStyle(isActive ? Theme.accent : Color.secondary).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(d.name + (isMe ? " " + String(localized: "(this phone)") : ""))
                    .foregroundStyle(isActive ? Theme.accent : Color.primary)
                if isActive, let t = sync.remoteTrack {
                    Text("\(sync.remotePlaying ? String(localized: "Playing") : String(localized: "Paused")): \(t.title) — \(t.artist)")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                } else {
                    Text("Idle").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if !isActive, sync.remoteTrack != nil {
                Button(isMe ? String(localized: "Play here") : String(localized: "Send")) { sync.transfer(to: d.id) }
                    .buttonStyle(.bordered)
            }
        }
        if isActive, !isMe {
            NavigationLink { JukeboxView() } label: { content }
        } else {
            content
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
