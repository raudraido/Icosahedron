import SwiftUI
import UIKit
import Observation

/// The account's profile picture. The sync server keeps it (GET/PUT/DELETE /avatar), so every
/// device shows the same one; the phone keeps a copy to show at launch and offline. Without a
/// picture the first letter of the user name is shown.
@MainActor @Observable
final class AvatarModel {
    private(set) var image: UIImage?
    private var etag: String?
    private var user = ""

    private var file: URL? {
        guard !user.isEmpty else { return nil }
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("avatar-\(user).img")
    }
    private var etagKey: String { "avatarETag-\(user)" }

    /// Shows the kept copy at once, then asks the server whether the picture changed.
    func refresh(client: SubsonicClient) async {
        if user != client.username {
            user = client.username
            image = file.flatMap { try? Data(contentsOf: $0) }.flatMap(UIImage.init(data:))
            etag = image == nil ? nil : UserDefaults.standard.string(forKey: etagKey)
        }
        do {
            let r = try await client.engineRaw("GET", "/avatar", etag: image == nil ? nil : etag)
            switch r.status {
            case 200:
                if let img = UIImage(data: r.data) {
                    image = img
                    etag = r.etag
                    store(r.data)
                }
            case 404:
                image = nil; etag = nil; store(nil)
            default: break // 304: unchanged; others (old server, offline): keep what is shown
            }
        } catch { /* offline: keep what is shown */ }
    }

    /// Crops to a square, shrinks to 256 px and uploads. Returns an error text, or nil when it worked.
    func set(_ picked: UIImage, client: SubsonicClient) async -> String? {
        guard let data = Self.avatarJPEG(picked) else { return String(localized: "That picture could not be used") }
        do {
            let r = try await client.engineRaw("PUT", "/avatar", body: data, contentType: "image/jpeg")
            guard r.status == 204 else {
                return r.status == 404 ? String(localized: "The sync server needs updating (0.16.2 or newer)") : String(localized: "The server did not accept the picture")
            }
            user = client.username
            image = UIImage(data: data)
            etag = nil
            store(data)
            await refresh(client: client)
            return nil
        } catch { return String(localized: "Could not reach the server") }
    }

    func remove(client: SubsonicClient) async {
        _ = try? await client.engineRaw("DELETE", "/avatar")
        image = nil; etag = nil; store(nil)
    }

    /// Forgets the picture (signing out).
    func clear() {
        store(nil)
        image = nil; etag = nil; user = ""
    }

    private func store(_ data: Data?) {
        guard let file else { return }
        if let data { try? data.write(to: file) } else { try? FileManager.default.removeItem(at: file) }
        if let etag { UserDefaults.standard.set(etag, forKey: etagKey) } else { UserDefaults.standard.removeObject(forKey: etagKey) }
    }

    nonisolated static func avatarJPEG(_ img: UIImage, side: CGFloat = 256) -> Data? {
        let s = min(img.size.width, img.size.height)
        guard s > 0 else { return nil }
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1; fmt.opaque = true
        let out = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { _ in
            let k = side / s
            let w = img.size.width * k, h = img.size.height * k
            img.draw(in: CGRect(x: (side - w) / 2, y: (side - h) / 2, width: w, height: h))
        }
        return out.jpegData(compressionQuality: 0.85)
    }
}

/// A round profile picture, or the user's first letter on the accent color.
struct AvatarView: View {
    @Environment(AppModel.self) private var app
    var size: CGFloat = 30

    var body: some View {
        Group {
            if let img = app.avatar.image {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                ZStack {
                    Theme.accent
                    Text(String((app.client?.username ?? "?").prefix(1)).uppercased())
                        .font(.system(size: size * 0.5, weight: .semibold)).foregroundStyle(.white)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityLabel(String(localized: "Account"))
    }
}
