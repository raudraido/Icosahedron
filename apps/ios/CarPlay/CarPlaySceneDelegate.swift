import CarPlay
import UIKit

/// The car's screen. CarPlay starts this scene (in the background, the phone's own screen need not be open) when the
/// phone is connected to a car and the app has the CarPlay Audio entitlement. See docs/carplay.md.
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var browser: CarPlayBrowser?

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didConnect interfaceController: CPInterfaceController) {
        let browser = CarPlayBrowser(interfaceController)
        self.browser = browser
        Task { @MainActor in await browser.start() }
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        browser = nil
    }
}
