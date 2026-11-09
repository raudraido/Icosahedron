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
