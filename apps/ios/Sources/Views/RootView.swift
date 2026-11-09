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

    private var showPlayer: Bool {
        if app.player.current != nil { return true }
        if let active = app.sync.activeDeviceId, active != app.sync.deviceId, app.sync.remoteTrack != nil { return true }
        return false
    }

    var body: some View {
        TabView(selection: Bindable(app.router).tab) {
            Tab("Home", systemImage: "house.fill", value: Router.AppTab.home) { HomeView() }
            Tab("Library", systemImage: "music.note.square.stack.fill", value: Router.AppTab.library) { LibraryView() }
            Tab("Search", systemImage: "magnifyingglass", value: Router.AppTab.search, role: .search) { SearchView() }
        }
        .tabViewBottomAccessory(isEnabled: showPlayer) { MiniPlayerBar() }
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}

struct LoginView: View {
    @Environment(AppModel.self) private var app
    @State private var url = ""
    @State private var user = ""
    @State private var pass = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
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
        do { try await app.signIn(url: url, user: user, pass: pass) } catch { self.error = error.localizedDescription }
        busy = false
    }
}
