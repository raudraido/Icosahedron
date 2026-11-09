import SwiftUI

@main
struct IcosahedronApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .tint(Theme.accent)
                .preferredColorScheme(.dark)
                .task { await app.restore() }
        }
    }
}

enum Theme {
    static let accent = Color(red: 0.86, green: 0.30, blue: 0.27)
    static let background = Color(red: 28 / 255, green: 30 / 255, blue: 39 / 255)
    static let card = Color.white.opacity(0.07)
}
