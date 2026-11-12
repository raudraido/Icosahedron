import SwiftUI
import UIKit
import UserNotifications

// Secure sign-in on the phone (docs/secure-sign-in.md): the prompt to approve another device, the
// "wait for approval" screen of the sign-in, and Settings > Sync Server > Secure sign-in.

/// Another device asks to sign in to this account. It shows a number; three are offered here and the
/// one that matches approves. A request nobody recognises is denied.
struct ApprovalPromptView: View {
    @Environment(AppModel.self) private var app
    let request: SecureSignIn.Pending
    @State private var busy = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let left = max(0, Int(request.expiresAt.timeIntervalSince(ctx.date)))
            VStack(spacing: 16) {
                Text("Sign-in attempt").font(.title2.bold())
                Text("\(request.deviceName) wants to sign in to your account\(request.address.isEmpty ? "" : " from \(request.address)") at \(request.at.formatted(date: .omitted, time: .shortened)).")
                    .multilineTextAlignment(.center)
                Text("If that is you, pick the number shown on that device. If you do not know it, deny it.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                HStack(spacing: 12) {
                    ForEach(request.choices, id: \.self) { n in
                        Button { Task { await answer(approve: true, number: n) } } label: {
                            Text("\(n)").font(.title.bold()).frame(maxWidth: .infinity, minHeight: 60)
                        }
                        .buttonStyle(.bordered)
                        .disabled(busy)
                    }
                }
                Button(role: .destructive) { Task { await answer(approve: false, number: nil) } } label: {
                    Text("It was not me").frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .disabled(busy)
                Text(String(format: "%d:%02d left", left / 60, left % 60)).font(.footnote).foregroundStyle(.secondary)
            }
            .padding(24)
        }
        .task(id: request.id) {
            // Ask once to be allowed to notify: a request that comes while the app is behind is then noticed.
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            while !Task.isCancelled && request.expiresAt > Date() { try? await Task.sleep(for: .seconds(1)) }
            app.sync.approvals.removeAll { $0.id == request.id }
        }
    }

    private func answer(approve: Bool, number: Int?) async {
        busy = true
        _ = await app.sync.answerApproval(request, approve: approve, number: number)
        busy = false
    }
}

/// The approval prompt as a card over a dimmed screen: it is shown in a window of its own (below), not as a
/// sheet, because a sheet cannot open while the player (a full-screen cover) or another sheet is up.
struct ApprovalOverlay: View {
    let request: SecureSignIn.Pending

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            ApprovalPromptView(request: request)
                .background(Theme.background, in: RoundedRectangle(cornerRadius: 24))
                .overlay(RoundedRectangle(cornerRadius: 24).stroke(Color.white.opacity(0.12)))
                .padding(.horizontal, 16)
                .frame(maxWidth: 460)
        }
        .preferredColorScheme(.dark)
    }
}

/// Shows the prompt above everything the app has on screen (the player, sheets, menus): another window at alert level.
@MainActor
final class ApprovalWindow {
    static let shared = ApprovalWindow()
    private var window: UIWindow?

    func show(_ request: SecureSignIn.Pending?, app: AppModel) {
        guard let request else { hide(); return }
        let root = ApprovalOverlay(request: request).environment(app)
        if let host = window?.rootViewController as? UIHostingController<AnyView> {
            host.rootView = AnyView(root)
            window?.isHidden = false
            return
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else { return }
        let w = UIWindow(windowScene: scene)
        w.windowLevel = UIWindow.Level.alert + 1
        w.backgroundColor = .clear
        let host = UIHostingController(rootView: AnyView(root))
        host.view.backgroundColor = .clear
        w.rootViewController = host
        w.makeKeyAndVisible()
        window = w
    }

    private func hide() {
        guard let w = window else { return }
        let scene = w.windowScene
        w.isHidden = true
        window = nil
        scene?.windows.first(where: { !$0.isHidden })?.makeKey() // the app's own window takes the keyboard focus back
    }
}

/// The sign-in of a server with secure sign-in: a number on this screen, approved on a device that is already signed in.
struct SignInApprovalView: View {
    let base: URL
    let user: String
    let password: String
    let onGranted: (SecureSignIn.Granted) async -> Void
    let onCancel: () -> Void

    private enum Stage {
        case starting
        case waiting(number: Int, expires: Date)
        case failed(String)
        case code(error: String?, busy: Bool)
        case codes([String], SecureSignIn.Granted)
    }
    @State private var stage: Stage = .starting
    @State private var code = ""
    @State private var started = false

    var body: some View {
        VStack(spacing: 18) {
            Text("Approve this sign-in").font(.title2.bold())
            switch stage {
            case .starting:
                ProgressView()
            case .waiting(let number, let expires):
                Text("Open Icosahedron on one of your devices that is already signed in and pick this number:")
                    .multilineTextAlignment(.center)
                Text("\(number)").font(.system(size: 64, weight: .bold, design: .rounded)).foregroundStyle(Theme.accent)
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    let left = max(0, Int(expires.timeIntervalSince(ctx.date)))
                    Text(String(format: "Waiting for approval… %d:%02d", left / 60, left % 60)).font(.footnote).foregroundStyle(.secondary)
                }
                Button("No device at hand? Use a code") { stage = .code(error: nil, busy: false) }.font(.footnote)
            case .failed(let text):
                Text(text).foregroundStyle(.red).multilineTextAlignment(.center)
            case .code(let error, let busy):
                Text("Enter a recovery code, or the code you got from the server's administrator.").multilineTextAlignment(.center)
                TextField("XXXX-XXXX-XXXX", text: $code)
                    .textFieldStyle(.roundedBorder).textInputAutocapitalization(.characters).autocorrectionDisabled().multilineTextAlignment(.center)
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Button { Task { await useCode() } } label: {
                    Group { if busy { ProgressView() } else { Text("Sign in with code").bold() } }.frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || code.trimmingCharacters(in: .whitespaces).isEmpty)
            case .codes(let codes, let granted):
                Text("This is your first device. Write these recovery codes down and keep them safe. Each works once, if you lose every device:")
                    .multilineTextAlignment(.center)
                Text(codes.joined(separator: "\n")).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                    .padding(10).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                Button { Task { await onGranted(granted) } } label: { Text("I have saved them").bold().frame(maxWidth: .infinity, minHeight: 28) }
                    .buttonStyle(.borderedProminent)
            }
            Button(failed ? "Back" : "Cancel", action: onCancel).font(.footnote)
        }
        .padding(28)
        .frame(maxWidth: 460)
        .task { await start() }
    }

    private var failed: Bool { if case .failed = stage { return true } else { return false } }

    private func text(for f: SecureSignIn.Failure) -> String {
        switch f {
        case .wrong: return "Wrong user name or password."
        case .rate: return "Too many attempts. Wait a few minutes and try again."
        case .busy: return "There are already several sign-in requests open for this account. Wait for them to expire or answer them."
        case .offline: return "Could not reach the server."
        case .notRequired: return "This server does not ask for approval."
        default: return "Something went wrong."
        }
    }

    private func start() async {
        guard !started else { return }
        started = true
        switch await SecureSignIn.request(base, user: user, password: password) {
        case .failed(let f):
            stage = f == .noTrustedDevice ? .code(error: nil, busy: false) : .failed(text(for: f))
        case .started(let id, let secret, let number, let expiresIn):
            stage = .waiting(number: number, expires: Date().addingTimeInterval(Double(expiresIn)))
            await pollLoop(id: id, secret: secret)
        }
    }

    private func pollLoop(id: String, secret: String) async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(2))
            guard case .waiting = stage else { return } // the person chose a code instead
            switch await SecureSignIn.poll(base, id: id, secret: secret) {
            case .approved(let g): await onGranted(g); return
            case .denied: stage = .failed("The sign-in was denied."); return
            case .expired, .gone: stage = .failed("Nobody answered in time."); return
            case .pending: continue
            }
        }
    }

    private func useCode() async {
        stage = .code(error: nil, busy: true)
        switch await SecureSignIn.signIn(withCode: code, base, user: user, password: password) {
        case .failure(let f):
            stage = .code(error: f == .wrong ? "That code is not valid." : text(for: f), busy: false)
        case .success(let g):
            if g.recoveryCodes.isEmpty { await onGranted(g) } else { stage = .codes(g.recoveryCodes, g) }
        }
    }
}

/// Settings > Sync Server > Secure sign-in (its own screen): switch it on, trusted devices, app passwords, recovery codes, invites, history.
struct SecureSignInSettings: View {
    @Environment(AppModel.self) private var app
    @State private var on: Bool?
    @State private var devices: [SecureSignIn.TrustedDevice] = []
    @State private var current: String?
    @State private var history: [SecureSignIn.HistoryEntry] = []
    @State private var message: String?
    @State private var busy = false
    @State private var confirmOn = false
    @State private var confirmOff = false
    @State private var codes: CodesSheet?
    @State private var appName = ""
    @State private var inviteName = ""

    struct CodesSheet: Identifiable {
        let id = UUID()
        let title: String
        let codes: [String]
    }

    var body: some View {
        List {
            if let on {
                Section {
                    Text(on
                         ? "On. A new device must be approved by a device that is already signed in, so knowing the password is not enough."
                         : "Off. A password is all it takes to sign in. When you switch this on, every other device asks for approval from this one the next time it signs in.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let message { Text(message).font(.footnote).foregroundStyle(.red) }
                    if !on {
                        Button(busy ? "Switching on…" : "Turn on") { confirmOn = true }.disabled(busy)
                    }
                } header: { Text("Secure sign-in") }

                if on {
                    Section("Trusted devices") {
                        ForEach(devices) { d in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(d.name + (d.id == current ? " (this phone)" : "") + (d.appPassword ? " · app password" : ""))
                                Text("Last seen \(d.lastSeen.formatted(.relative(presentation: .named)))\(d.address.isEmpty ? "" : " · " + d.address)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            .swipeActions {
                                Button("Remove", role: .destructive) { Task { await remove(d) } }
                            }
                        }
                        Text("Swipe a device to remove it. It loses access at once.").font(.footnote).foregroundStyle(.secondary)
                    }

                    Section {
                        HStack {
                            TextField("Name, e.g. Symfonium", text: $appName)
                            Button("Create") { Task { await makeAppPassword() } }
                        }
                    } header: { Text("App password") } footer: {
                        Text("For an app that cannot ask for approval (Symfonium, DSub …): use it as the password.")
                    }

                    Section {
                        Button("New recovery codes") { Task { await makeRecoveryCodes() } }
                        HStack {
                            TextField("Invite: user name", text: $inviteName).textInputAutocapitalization(.never).autocorrectionDisabled()
                            Button("Invite") { Task { await makeInvite() } }.disabled(inviteName.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                        Button("Turn off", role: .destructive) { confirmOff = true }
                    } footer: {
                        Text("An invite is a one-use code (24 hours) for someone's first device; they enter it with their own Navidrome password. Inviting and turning off are for administrators.")
                    }

                    if !history.isEmpty {
                        Section("Sign-in history") {
                            ForEach(history) { h in
                                Text("\(h.at.formatted(.relative(presentation: .named))) · \(h.device) · \(SecureSignIn.resultText[h.result] ?? h.result)\(h.address.isEmpty ? "" : " · " + h.address)")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Secure sign-in")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .alert("Turn on secure sign-in?", isPresented: $confirmOn) {
            Button("Turn on") { Task { await turnOn() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every other device will have to be approved from this phone the next time it signs in. You will get recovery codes to keep safe.")
        }
        .alert("Turn off secure sign-in?", isPresented: $confirmOff) {
            Button("Turn off", role: .destructive) { Task { await turnOff() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Devices that were approved stay signed in. New ones sign in with the password again.")
        }
        .sheet(item: $codes) { c in
            NavigationStack {
                List {
                    Section { Text(c.title).font(.footnote) }
                    Section { Text(c.codes.joined(separator: "\n")).font(.system(.body, design: .monospaced)).textSelection(.enabled) }
                    Section { Button("Copy") { UIPasteboard.general.string = c.codes.joined(separator: "\n") } }
                }
                .navigationTitle("Keep these safe")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { codes = nil } } }
            }
        }
    }

    private func load() async {
        guard let c = app.client else { return }
        let isOn = await SecureSignIn.isOn(c)
        on = isOn
        guard isOn else { return }
        if let d = await SecureSignIn.devices(c) { devices = d.devices; current = d.current }
        history = await SecureSignIn.history(c)
    }

    private func turnOn() async {
        guard let c = app.client else { return }
        busy = true
        message = nil
        switch await SecureSignIn.turnOn(c) {
        case .failed(let text):
            message = text
        case .on(let secret, let recoveryCodes):
            // This phone now signs in with its own secret instead of the password; the old sign-in no longer works.
            do { try await app.signIn(url: app.savedURL, user: app.savedUser, pass: secret) }
            catch { message = "Switched on, but this phone could not sign in again. Sign out and sign in (you will be asked to approve)." }
            codes = CodesSheet(title: "Write these recovery codes down and keep them safe. Each works once if you lose every device.", codes: recoveryCodes)
        }
        busy = false
        await load()
    }

    private func turnOff() async {
        guard let c = app.client else { return }
        if await SecureSignIn.turnOff(c) { await load() } else { message = "Only a server administrator can switch this off." }
    }

    private func remove(_ d: SecureSignIn.TrustedDevice) async {
        guard let c = app.client else { return }
        _ = await SecureSignIn.remove(c, id: d.id)
        await load()
    }

    private func makeAppPassword() async {
        guard let c = app.client else { return }
        let name = appName.trimmingCharacters(in: .whitespaces)
        if let secret = await SecureSignIn.appPassword(c, name: name.isEmpty ? "App password" : name) {
            appName = ""
            codes = CodesSheet(title: "User name \(app.savedUser). The password is shown only now:", codes: [secret])
            await load()
        }
    }

    private func makeRecoveryCodes() async {
        guard let c = app.client, let list = await SecureSignIn.newRecoveryCodes(c) else { return }
        codes = CodesSheet(title: "The old recovery codes no longer work. Keep these safe.", codes: list)
    }

    private func makeInvite() async {
        guard let c = app.client else { return }
        let user = inviteName.trimmingCharacters(in: .whitespaces)
        if let code = await SecureSignIn.invite(c, user: user) {
            inviteName = ""
            codes = CodesSheet(title: "Code for \(user), valid for 24 hours:", codes: [code])
        } else {
            message = "Only a server administrator can invite."
        }
    }
}
