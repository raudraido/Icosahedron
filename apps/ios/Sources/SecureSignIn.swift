import Foundation
import UIKit

/// Secure sign-in, the phone side (docs/secure-sign-in.md): asking the engine to let this phone in,
/// approving other devices, and managing the trusted ones. The engine's `/device/*` API.
enum SecureSignIn {
    struct Granted { let user: String; let secret: String; let recoveryCodes: [String] }

    enum Failure: String, Error { case wrong, noTrustedDevice, rate, busy, offline, notRequired, error }

    enum Started {
        case started(id: String, secret: String, number: Int, expiresIn: Int)
        case failed(Failure)
    }

    enum Poll { case pending, denied, expired, gone, approved(Granted) }

    struct TrustedDevice: Identifiable {
        let id: String
        let name: String
        let kind: String
        let lastSeen: Date
        let address: String
        let appPassword: Bool
    }

    struct HistoryEntry: Identifiable {
        let id = UUID()
        let at: Date
        let device: String
        let result: String
        let address: String
    }

    /// Another device asking to be let in: what the approving phone shows. Three numbers, one is right.
    struct Pending: Identifiable, Equatable {
        let id: String
        let deviceName: String
        let address: String
        let at: Date
        let expiresAt: Date
        let choices: [Int]

        init?(json d: [String: Any]) {
            guard let id = J.str(d, "id"), let dev = d["device"] as? [String: Any] else { return nil }
            self.id = id
            deviceName = J.str(dev, "name") ?? "Device"
            address = J.str(d, "address") ?? ""
            at = Date(timeIntervalSince1970: Double(J.int(d, "at") ?? 0) / 1000)
            expiresAt = Date(timeIntervalSince1970: Double(J.int(d, "expiresAt") ?? 0) / 1000)
            choices = (d["choices"] as? [Any])?.compactMap { ($0 as? NSNumber)?.intValue } ?? []
        }
    }

    /// What the engine is told about this phone, shown on the other device's prompt.
    static var deviceInfo: [String: Any] {
        let idiom = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        return ["name": "Icosahedron on \(idiom)", "kind": "ios", "app": "Icosahedron iOS", "version": version]
    }

    // MARK: Without a sign-in yet

    private static func send(_ method: String, _ base: URL, _ path: String, json: [String: Any]? = nil) async -> (status: Int, json: [String: Any]?) {
        guard let url = URL(string: base.absoluteString + path) else { return (0, nil) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 15
        if let json {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: json)
        }
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            return ((resp as? HTTPURLResponse)?.statusCode ?? 0, (try? JSONSerialization.jsonObject(with: data)) as? [String: Any])
        } catch {
            return (0, nil)
        }
    }

    /// Whether `base` is an engine, and whether it asks for approval. A plain Navidrome answers 404.
    static func probe(_ base: URL) async -> (engine: Bool, secure: Bool) {
        let r = await send("GET", base, "/device/info")
        guard r.status == 200, let secure = r.json?["secure"] as? Bool else { return (false, false) }
        return (true, secure)
    }

    static func request(_ base: URL, user: String, password: String) async -> Started {
        let r = await send("POST", base, "/device/request", json: ["user": user, "password": password, "device": deviceInfo])
        switch r.status {
        case 200:
            guard let j = r.json, let id = J.str(j, "id"), let secret = J.str(j, "secret"), let number = J.int(j, "number") else { return .failed(.error) }
            return .started(id: id, secret: secret, number: number, expiresIn: J.int(j, "expiresIn") ?? 300)
        case 0: return .failed(.offline)
        case 401: return .failed(.wrong)
        case 409: return .failed((r.json?["error"] as? String) == "no_trusted_device" ? .noTrustedDevice : .notRequired)
        case 429: return .failed(((r.json?["error"] as? String) ?? "").contains("open") ? .busy : .rate)
        default: return .failed(.error)
        }
    }

    static func poll(_ base: URL, id: String, secret: String) async -> Poll {
        let r = await send("GET", base, "/device/poll?id=\(id)&secret=\(secret)")
        if r.status == 404 { return .gone }
        guard let j = r.json else { return .pending } // a hiccup: keep asking until it expires
        switch j["state"] as? String {
        case "approved":
            let cred = j["cred"] as? [String: Any]
            return .approved(Granted(user: (cred.flatMap { J.str($0, "u") }) ?? "", secret: J.str(j, "secret") ?? "", recoveryCodes: []))
        case "denied": return .denied
        case "expired": return .expired
        default: return .pending
        }
    }

    /// A recovery code, or an invite from the administrator, instead of an approval.
    static func signIn(withCode code: String, _ base: URL, user: String, password: String) async -> Result<Granted, Failure> {
        for path in ["/device/recover", "/device/redeem"] {
            let r = await send("POST", base, path, json: ["user": user, "password": password, "code": code, "device": deviceInfo])
            if r.status == 200, let j = r.json {
                let cred = j["cred"] as? [String: Any]
                return .success(Granted(user: (cred.flatMap { J.str($0, "u") }) ?? user, secret: J.str(j, "secret") ?? "", recoveryCodes: (j["recoveryCodes"] as? [String]) ?? []))
            }
            if r.status == 0 { return .failure(.offline) }
            if r.status == 429 { return .failure(.rate) }
            if r.status != 401 { return .failure(.error) }
        }
        return .failure(.wrong)
    }

    // MARK: Signed in (Settings, and the approval prompt)

    private static func json(_ data: Data) -> Any? { try? JSONSerialization.jsonObject(with: data) }

    static func isOn(_ c: SubsonicClient) async -> Bool {
        guard let r = try? await c.engine("GET", "/device/info"), r.status == 200 else { return false }
        return ((json(r.data) as? [String: Any])?["secure"] as? Bool) == true
    }

    enum TurnOn {
        case on(secret: String, recoveryCodes: [String])
        case failed(String)
    }

    /// Switches it on (an administrator). This phone becomes the first trusted device and must sign in again with the secret it gets.
    static func turnOn(_ c: SubsonicClient) async -> TurnOn {
        guard let r = try? await c.engine("PUT", "/device/secure", json: ["enabled": true, "device": deviceInfo]) else { return .failed("Could not reach the server.") }
        let j = json(r.data) as? [String: Any]
        switch r.status {
        case 200: return .on(secret: J.str(j ?? [:], "secret") ?? "", recoveryCodes: (j?["recoveryCodes"] as? [String]) ?? [])
        case 403: return .failed("Only a server administrator can switch this on.")
        case 412: return .failed("Navidrome does not accept the sync server yet, so nobody could sign in. Add ExtAuth.TrustedSources (ND_EXTAUTH_TRUSTEDSOURCES) with the sync server's address to Navidrome first (docs/deploy-server.md, Secure sign-in).")
        case 409: return .failed("It is already on.")
        default: return .failed("Something went wrong.")
        }
    }

    static func turnOff(_ c: SubsonicClient) async -> Bool {
        guard let r = try? await c.engine("PUT", "/device/secure", json: ["enabled": false]) else { return false }
        return r.status == 200
    }

    static func devices(_ c: SubsonicClient) async -> (devices: [TrustedDevice], current: String?)? {
        guard let r = try? await c.engine("GET", "/device/list"), r.status == 200, let j = json(r.data) as? [String: Any] else { return nil }
        let list = J.arr(j["devices"]).compactMap { d -> TrustedDevice? in
            guard let id = J.str(d, "id") else { return nil }
            return TrustedDevice(
                id: id, name: J.str(d, "name") ?? "Device", kind: J.str(d, "kind") ?? "web",
                lastSeen: Date(timeIntervalSince1970: Double(J.int(d, "lastSeen") ?? 0) / 1000),
                address: J.str(d, "lastAddress") ?? "", appPassword: (d["appPassword"] as? Bool) ?? false
            )
        }
        return (list, j["current"] as? String)
    }

    static func remove(_ c: SubsonicClient, id: String) async -> Bool {
        guard let r = try? await c.engine("DELETE", "/device/\(id)") else { return false }
        return r.status == 204
    }

    static func history(_ c: SubsonicClient) async -> [HistoryEntry] {
        guard let r = try? await c.engine("GET", "/device/history"), r.status == 200, let a = json(r.data) as? [[String: Any]] else { return [] }
        return a.prefix(20).map {
            HistoryEntry(at: Date(timeIntervalSince1970: Double(J.int($0, "at") ?? 0) / 1000), device: J.str($0, "device") ?? "device", result: J.str($0, "result") ?? "", address: J.str($0, "address") ?? "")
        }
    }

    static func appPassword(_ c: SubsonicClient, name: String) async -> String? {
        guard let r = try? await c.engine("POST", "/device/app-password", json: ["name": name]), r.status == 200 else { return nil }
        return (json(r.data) as? [String: Any]).flatMap { J.str($0, "secret") }
    }

    static func newRecoveryCodes(_ c: SubsonicClient) async -> [String]? {
        guard let r = try? await c.engine("POST", "/device/recovery-codes", json: [:]), r.status == 200 else { return nil }
        return (json(r.data) as? [String: Any])?["recoveryCodes"] as? [String]
    }

    static func invite(_ c: SubsonicClient, user: String) async -> String? {
        guard let r = try? await c.engine("POST", "/device/invite", json: ["user": user]), r.status == 200 else { return nil }
        return (json(r.data) as? [String: Any]).flatMap { J.str($0, "code") }
    }

    static func pending(_ c: SubsonicClient) async -> [Pending] {
        guard let r = try? await c.engine("GET", "/device/pending"), r.status == 200, let a = json(r.data) as? [[String: Any]] else { return [] }
        return a.compactMap { Pending(json: $0) }
    }

    /// "approved", "denied", "wrong", "expired", "unknown" or "offline".
    static func decide(_ c: SubsonicClient, id: String, approve: Bool, number: Int?) async -> String {
        var body: [String: Any] = ["id": id, "approve": approve]
        if let number { body["number"] = number }
        guard let r = try? await c.engine("POST", "/device/decide", json: body) else { return "offline" }
        return ((json(r.data) as? [String: Any])?["result"] as? String) ?? "unknown"
    }

    static let resultText: [String: String] = [
        "requested": "asked to sign in", "approved": "approved", "denied": "denied", "wrong-number": "wrong number, denied",
        "wrong-password": "wrong password", "wrong-recovery-code": "wrong recovery code", "wrong-invite-code": "wrong invite code",
        "recovery-code": "signed in with a recovery code", "invite": "signed in with an invite", "quick-connect": "signed in with Quick Connect",
        "secure-on": "secure sign-in switched on", "secure-off": "secure sign-in switched off", "app-password": "app password made",
        "removed-device": "device removed", "new-recovery-codes": "new recovery codes made",
    ]
}
