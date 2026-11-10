import SwiftUI

/// Settings > Sync Server: the connection, this phone's name, the players the engine knows,
/// what this phone keeps in sync and what the engine stores. Design: docs/sync-settings.md.
struct SyncSettingsView: View {
    @Environment(AppModel.self) private var app
    @AppStorage(SyncModel.Switch.playback.rawValue) private var playback = true
    @AppStorage(SyncModel.Switch.equalizer.rawValue) private var equalizer = true
    @AppStorage(SyncModel.Switch.lyrics.rawValue) private var lyrics = true
    @State private var nameDraft = ""
    @State private var renaming: SyncModel.RegistryDevice?
    @State private var renameDraft = ""
    @State private var confirm: ClearKind?

    private enum ClearKind: Identifiable {
        case queue, settings
        var id: Int { self == .queue ? 0 : 1 }
    }

    var body: some View {
        let sync = app.sync
        List {
            Section("Connection") {
                LabeledContent("Server", value: app.client?.baseURL.host ?? "")
                LabeledContent("Status", value: statusText(sync.status))
                Text("The sync server is the address you signed in with. To use a different one, sign out and sign in with it.")
                    .font(.footnote).foregroundStyle(.secondary)
            }

            if sync.status == "online" {
                Section("This phone") {
                    HStack {
                        TextField("Name", text: $nameDraft)
                            .onSubmit { saveName() }
                        Button("Save") { saveName() }
                            .disabled(nameDraft.trimmingCharacters(in: .whitespaces).isEmpty || nameDraft == (sync.name ?? ""))
                    }
                }

                Section {
                    ForEach(sync.registry) { d in
                        row(d, sync)
                    }
                } header: {
                    Text("Registered players")
                } footer: {
                    Text("Every player signed in with your account. Players that stay offline for 90 days are removed automatically. Forgetting is housekeeping, not a lock-out: a player that is still signed in comes back when it connects.")
                }

                Section {
                    Toggle("Playback and remote control", isOn: $playback)
                        .onChange(of: playback) { _, _ in sync.switchChanged(.playback) }
                    Toggle("Equalizer", isOn: $equalizer)
                        .onChange(of: equalizer) { _, _ in sync.switchChanged(.equalizer) }
                    Toggle("Lyrics source", isOn: $lyrics)
                        .onChange(of: lyrics) { _, _ in sync.switchChanged(.lyrics) }
                } header: {
                    Text("What this phone keeps in sync")
                } footer: {
                    Text("Playback off: the other players do not see this phone and cannot control it. Theme, library layout and BPM belong to the desktop and web apps and are not changed from here.")
                }

                Section {
                    Button("Clear stored queue", role: .destructive) { confirm = .queue }
                    Button("Clear shared preferences", role: .destructive) { confirm = .settings }
                } header: {
                    Text("Server data")
                } footer: {
                    Text("What the sync server stores for your account. Clearing does not touch anything on your players.")
                }
            }
        }
        .navigationTitle("Sync Server")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { nameDraft = sync.name ?? "" }
        .onChange(of: sync.name) { _, new in nameDraft = new ?? "" }
        .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $renameDraft)
            Button("Save") {
                let n = renameDraft.trimmingCharacters(in: .whitespaces)
                if let d = renaming, !n.isEmpty { sync.rename(d.id, to: n) }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .confirmationDialog(
            confirm == .queue ? String(localized: "Clear the stored queue?") : String(localized: "Clear the shared preferences?"),
            isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
            titleVisibility: .visible
        ) {
            Button("Clear", role: .destructive) {
                switch confirm {
                case .queue: sync.clearServerData(state: true)
                case .settings: sync.clearServerData(settings: true)
                case nil: break
                }
                confirm = nil
            }
        }
    }

    private func saveName() {
        let n = nameDraft.trimmingCharacters(in: .whitespaces)
        if !n.isEmpty { app.sync.rename(app.sync.deviceId, to: n) }
    }

    @ViewBuilder
    private func row(_ d: SyncModel.RegistryDevice, _ sync: SyncModel) -> some View {
        let me = d.id == sync.deviceId
        HStack(spacing: 12) {
            Image(systemName: icon(d.kind)).font(.title3)
                .foregroundStyle(d.online ? Theme.accent : Color.secondary).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(d.name + (me ? " " + String(localized: "(this phone)") : "")).lineLimit(1)
                if d.online {
                    Text("Online").font(.caption).foregroundStyle(.secondary)
                } else {
                    Text(String(localized: "Last seen") + " " + d.lastSeen.formatted(.relative(presentation: .named)))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .swipeActions(edge: .trailing) {
            if !d.online {
                Button("Forget", role: .destructive) { sync.forget(d.id) }
            }
            Button("Rename") { renameDraft = d.name; renaming = d }.tint(.blue)
        }
    }

    private func statusText(_ s: String) -> String {
        switch s {
        case "online": return String(localized: "Connected")
        case "connecting": return String(localized: "Connecting…")
        default: return String(localized: "Sync server not reachable")
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
