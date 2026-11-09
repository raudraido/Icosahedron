import Foundation
import Observation

/// App-wide state: the signed-in server connection, the player and the sync link.
@MainActor @Observable
final class AppModel {
    var client: SubsonicClient?
    var restoring = true
    let player = PlayerModel()
    let sync = SyncModel()

    var isLoggedIn: Bool { client != nil }

    private let urlKey = "serverURL"
    private let userKey = "username"

    var savedURL: String { UserDefaults.standard.string(forKey: urlKey) ?? "" }
    var savedUser: String { UserDefaults.standard.string(forKey: userKey) ?? "" }

    /// Signs in with the saved login on launch, if there is one.
    func restore() async {
        defer { restoring = false }
        guard client == nil,
              let url = UserDefaults.standard.string(forKey: urlKey),
              let user = UserDefaults.standard.string(forKey: userKey),
              let pass = Keychain.get(user) else { return }
        try? await signIn(url: url, user: user, pass: pass, remember: false)
    }

    func signIn(url: String, user: String, pass: String, remember: Bool = true) async throws {
        var text = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.lowercased().hasPrefix("http") { text = "https://" + text }
        while text.hasSuffix("/") { text.removeLast() }
        guard let base = URL(string: text) else { throw SubsonicError.badResponse }
        let c = SubsonicClient(baseURL: base, username: user, password: pass)
        try await c.ping()
        if remember {
            UserDefaults.standard.set(text, forKey: urlKey)
            UserDefaults.standard.set(user, forKey: userKey)
            Keychain.set(pass, for: user)
        }
        client = c
        player.client = c
        sync.start(client: c, player: player)
    }

    func signOut() {
        sync.stop()
        player.stop()
        player.client = nil
        client = nil
        Keychain.delete(savedUser)
        UserDefaults.standard.removeObject(forKey: userKey)
    }
}
