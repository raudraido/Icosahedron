import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if app.restoring {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if app.isLoggedIn {
                MainTabs()
            } else {
                LoginView()
            }
        }
        .background(Theme.background.ignoresSafeArea())
    }
}

struct MainTabs: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @Namespace private var zoom

    private var showPlayer: Bool {
        if app.sync.remoteTarget != nil { return true }
        if app.player.current != nil { return true }
        if app.sync.otherPlaying != nil { return true }
        return false
    }

    var body: some View {
        TabView(selection: Bindable(app.router).tab) {
            Tab("Home", systemImage: "house.fill", value: Router.AppTab.home) { HomeView() }
            Tab("Library", systemImage: "music.note.square.stack.fill", value: Router.AppTab.library) { LibraryView() }
            Tab("Devices", systemImage: "hifispeaker.2.fill", value: Router.AppTab.devices) { DevicesTab() }
            Tab("Search", systemImage: "magnifyingglass", value: Router.AppTab.search, role: .search) { SearchView() }
        }
        // The player is presented from here, not from the mini player: the system rebuilds the
        // accessory on every playback tick, which tore the player (and any sheet on it) down.
        .tabViewStyle(.sidebarAdaptable)
        .tabViewBottomAccessory(isEnabled: showPlayer) { MiniPlayerBar(zoom: zoom) }
        .fullScreenCover(isPresented: Bindable(app.router).showPlayer) {
            NowPlayingView()
                .navigationTransition(.zoom(sourceID: "cover", in: zoom))
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        // Secure sign-in: another device asks this phone to approve it.
        .sheet(item: Binding(get: { app.sync.approvals.first }, set: { _ in })) { request in
            ApprovalPromptView(request: request)
                .presentationDetents([.medium])
                .interactiveDismissDisabled()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await app.sync.refreshApprovals() } }
        }
    }
}

struct LoginView: View {
    @Environment(AppModel.self) private var app
    @State private var url = ""
    @State private var user = ""
    @State private var pass = ""
    @State private var busy = false
    @State private var error: String?
    /// Set when the server asks for approval of a new device (secure sign-in): the sign-in waits for it.
    @State private var approval: (base: URL, url: String, user: String, pass: String)?

    var body: some View {
        if let approval {
            SignInApprovalView(
                base: approval.base, user: approval.user, password: approval.pass,
                onGranted: { granted in
                    do { try await app.signIn(url: approval.url, user: approval.user, pass: granted.secret) }
                    catch { self.approval = nil; self.error = error.localizedDescription }
                },
                onCancel: { self.approval = nil }
            )
        } else {
            form
        }
    }

    private var form: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "hexagon.fill").font(.system(size: 56)).foregroundStyle(Theme.accent)
            Text("Icosahedron").font(.largeTitle.bold())
            VStack(spacing: 12) {
                TextField("Server (https://music.example.com)", text: $url)
                    .textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Username", text: $user)
                    .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Password", text: $pass).textContentType(.password)
            }
            .textFieldStyle(.roundedBorder)
            if let error { Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center) }
            Button {
                Task { await signIn() }
            } label: {
                Group { if busy { ProgressView() } else { Text("Sign in").bold() } }.frame(maxWidth: .infinity, minHeight: 28)
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy || url.isEmpty || user.isEmpty || pass.isEmpty)
            Spacer()
        }
        .padding(28)
        .frame(maxWidth: 460)
        .onAppear {
            if url.isEmpty { url = app.savedURL }
            if user.isEmpty { user = app.savedUser }
        }
    }

    private func signIn() async {
        busy = true
        error = nil
        do {
            // A server with secure sign-in asks a device that is already signed in to approve this one.
            let text = app.normalizedURL(url)
            if let base = URL(string: text) {
                let probe = await SecureSignIn.probe(base)
                if probe.engine && probe.secure {
                    approval = (base, text, user, pass)
                    busy = false
                    return
                }
            }
            try await app.signIn(url: url, user: user, pass: pass)
        } catch { self.error = error.localizedDescription }
        busy = false
    }
}
