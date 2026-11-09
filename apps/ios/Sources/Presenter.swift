import UIKit

/// UIKit presentation that works from anywhere, including above the full-screen player (a SwiftUI
/// sheet or alert attached to the tab view cannot appear over it).
@MainActor
enum Presenter {
    private static func top() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        guard var vc = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return nil }
        while let next = vc.presentedViewController { vc = next }
        return vc
    }

    static func share(_ url: URL) {
        guard let vc = top() else { return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = vc.view
        vc.present(sheet, animated: true)
    }

    static func alert(_ title: String, _ message: String? = nil) {
        let a = UIAlertController(title: title, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: String(localized: "OK"), style: .default))
        top()?.present(a, animated: true)
    }

    static func prompt(title: String, message: String? = nil, placeholder: String, text: String = "",
                       action: String, _ done: @escaping (String) -> Void) {
        let a = UIAlertController(title: title, message: message, preferredStyle: .alert)
        a.addTextField { f in
            f.placeholder = placeholder
            f.text = text
            f.autocapitalizationType = .sentences
        }
        a.addAction(UIAlertAction(title: String(localized: "Cancel"), style: .cancel))
        a.addAction(UIAlertAction(title: action, style: .default) { _ in
            let value = (a.textFields?.first?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { done(value) }
        })
        top()?.present(a, animated: true)
    }

    static func confirm(title: String, message: String? = nil, destructive: String, _ done: @escaping () -> Void) {
        let a = UIAlertController(title: title, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: String(localized: "Cancel"), style: .cancel))
        a.addAction(UIAlertAction(title: destructive, style: .destructive) { _ in done() })
        top()?.present(a, animated: true)
    }
}
