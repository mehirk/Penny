import UIKit
import WebKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = PennyViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Loads pages from Penny's Next.js static export (`npm run ios:build`) and adds what a browser
/// would otherwise handle: the system text size and a light/dark background behind the page.
class PennyViewController: CAPBridgeViewController {
    /// Penny's canvas colour (globals.css), shown while the page loads and when it bounces.
    private static let canvas = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x0d / 255, green: 0x17 / 255, blue: 0x20 / 255, alpha: 1)
            : UIColor(red: 0xf6 / 255, green: 0xf8 / 255, blue: 0xfb / 255, alpha: 1)
    }

    override func router() -> Router {
        StaticExportRouter()
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.isOpaque = false
        webView?.backgroundColor = Self.canvas
        webView?.scrollView.backgroundColor = Self.canvas
        // Runs before each page's own scripts, so text starts at the right size.
        let script = WKUserScript(source: Self.textSizeScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true)
        webView?.configuration.userContentController.addUserScript(script)
        NotificationCenter.default.addObserver(self, selector: #selector(textSizeChanged), name: UIContentSizeCategory.didChangeNotification, object: nil)
    }

    /// Follows Settings → Display & Brightness → Text Size (Dynamic Type) by scaling text only,
    /// not the layout, the way Safari's text size does. Capped so the layout stays usable.
    private static func textSizeScript() -> String {
        let percent = min(200, max(80, Int(UIFontMetrics(forTextStyle: .body).scaledValue(for: 100).rounded())))
        return "document.documentElement.style.webkitTextSizeAdjust = '\(percent)%';"
    }

    @objc private func textSizeChanged() {
        webView?.evaluateJavaScript(Self.textSizeScript())
    }
}

/// Capacitor's default router answers every extensionless path with the home page, so reopening
/// `/login/` would show the dashboard. Serve the exported `<path>/index.html` when it exists.
struct StaticExportRouter: Router {
    var basePath: String = ""

    func route(for path: String) -> String {
        if !URL(fileURLWithPath: path).pathExtension.isEmpty {
            return basePath + path
        }
        let page = basePath + (path.hasSuffix("/") ? path : path + "/") + "index.html"
        return FileManager.default.fileExists(atPath: page) ? page : basePath + "/index.html"
    }
}
