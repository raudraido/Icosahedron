import SwiftUI

/// The Devices tab: every device of the account and what it is doing. Tapping one makes it the
/// device the controls act on (docs/connect.md); the player screen then shows and controls it.
struct DevicesTab: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let sync = app.sync
        NavigationStack {
            List {
                if sync.status != "online" {
                    Text(sync.status == "connecting" ? String(localized: "Connecting…") : String(localized: "Sync server not reachable"))
                        .foregroundStyle(.secondary)
                }
                Section {
                    ForEach(sync.devices) { d in DeviceRow(d: d) }
                    if sync.status == "online", sync.devices.count <= 1 {
                        Text("No other devices online.").foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("Tap a device to play on it and control it. The player shows what it plays.")
                }
            }
            .navigationTitle("Devices")
        }
    }
}

/// A device in the lists. Tapping it chooses it as the device the controls act on (docs/connect.md).
struct DeviceRow: View {
    @Environment(AppModel.self) private var app
    let d: SyncModel.Device

    var body: some View {
        let sync = app.sync
        let isMe = d.id == sync.deviceId
        let selected = (sync.remoteTarget ?? sync.deviceId) == d.id
        let remote = sync.state(of: d.id)
        let track = isMe ? app.player.current : remote?.track
        let playing = isMe ? app.player.isPlaying : (remote?.playing ?? false)
        HStack(spacing: 12) {
            Button { sync.setTarget(isMe ? nil : d.id) } label: {
                HStack(spacing: 12) {
                    Image(systemName: icon(d.kind)).font(.title3)
                        .foregroundStyle(playing ? Theme.accent : Color.secondary).frame(width: 28)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(d.name + (isMe ? " " + String(localized: "(this phone)") : ""))
                            .foregroundStyle(selected ? Theme.accent : Color.primary)
                        if let track {
                            Text("\(playing ? String(localized: "Playing") : String(localized: "Paused")): \(track.title) — \(track.artist)")
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        } else {
                            Text("Idle").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                    if selected { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent) }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // Moving music is explicit: pull the controlled device's playback here, or push this phone's there.
            if isMe, let t = sync.remoteTarget, sync.state(of: t)?.track != nil {
                Button(String(localized: "Play here")) { sync.transfer(from: t, to: sync.deviceId); sync.setTarget(nil) }
                    .buttonStyle(.bordered)
            } else if !isMe, app.player.current != nil {
                Button(String(localized: "Send")) { sync.transfer(from: sync.deviceId, to: d.id); sync.setTarget(d.id) }
                    .buttonStyle(.bordered)
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
