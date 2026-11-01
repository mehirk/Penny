import Capacitor
import Foundation
import LocalAuthentication
import Security
import UIKit

/// "Sign in with Face ID": keeps the user's Penny sign-in in the iOS Keychain, readable only after
/// Face ID (or Touch ID) on this device. Nothing leaves the phone, and the item is deleted by iOS
/// if the enrolled faces or fingers change (`.biometryCurrentSet`). Called from `lib/face-id.ts`.
@objc(FaceIDPlugin)
public class FaceIDPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FaceIDPlugin"
    public let jsName = "PennyFaceID"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSignedIn", returnType: CAPPluginReturnPromise),
    ]

    private static let service = (Bundle.main.bundleIdentifier ?? "penny") + ".face-id"
    private static let account = "sign-in"

    private var baseQuery: [String: Any] { Self.baseQuery }
    private static var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    /// Whether Face ID can be used, which kind the device has, and whether a sign-in is saved.
    @objc func status(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        let biometry: String
        switch context.biometryType {
        case .faceID: biometry = "faceID"
        case .touchID: biometry = "touchID"
        default: biometry = "none"
        }
        call.resolve(["available": available, "biometry": biometry, "saved": Self.hasSavedSignIn()])
    }

    /// Asks for Face ID once to confirm, then saves the sign-in behind Face ID (replacing any).
    @objc func save(_ call: CAPPluginCall) {
        guard let email = call.getString("email"), let password = call.getString("password"),
              let data = try? JSONSerialization.data(withJSONObject: ["email": email, "password": password]) else {
            call.reject("Missing email or password", "invalid")
            return
        }
        LAContext().evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Turn on Face ID for Penny") { ok, error in
            guard ok else {
                self.rejectAuth(call, error)
                return
            }
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, nil) else {
                call.reject("Couldn't protect the sign-in", "keychain")
                return
            }
            SecItemDelete(self.baseQuery as CFDictionary)
            var item = self.baseQuery
            item[kSecValueData as String] = data
            item[kSecAttrAccessControl as String] = access
            let status = SecItemAdd(item as CFDictionary, nil)
            status == errSecSuccess ? call.resolve() : call.reject("Couldn't save the sign-in (\(status))", "keychain")
        }
    }

    /// Shows Face ID and returns the saved sign-in.
    @objc func load(_ call: CAPPluginCall) {
        let context = LAContext()
        context.localizedReason = call.getString("reason") ?? "Sign in to Penny"
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecUseAuthenticationContext as String] = context
        // The Keychain shows Face ID and waits for it, so stay off the main thread.
        DispatchQueue.global(qos: .userInitiated).async {
            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            switch status {
            case errSecSuccess:
                guard let data = result as? Data,
                      let saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: String],
                      let email = saved["email"], let password = saved["password"] else {
                    call.reject("The saved sign-in couldn't be read", "not_found")
                    return
                }
                call.resolve(["email": email, "password": password])
            case errSecUserCanceled:
                call.reject("Cancelled", "cancelled")
            case errSecItemNotFound:
                call.reject("No saved sign-in", "not_found")
            default:
                call.reject("Face ID didn't work (\(status))", "failed")
            }
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        SecItemDelete(baseQuery as CFDictionary)
        call.resolve()
    }

    /// The web app reports signing in (the dashboard loaded) and signing out, so the app lock only
    /// covers Penny while someone is signed in; the sign-in page asks for Face ID itself.
    @objc func setSignedIn(_ call: CAPPluginCall) {
        AppLock.signedIn = call.getBool("signedIn") ?? false
        call.resolve()
    }

    /// Checks for a saved sign-in without showing Face ID.
    static func hasSavedSignIn() -> Bool {
        let context = LAContext()
        context.interactionNotAllowed = true
        var query = baseQuery
        query[kSecUseAuthenticationContext as String] = context
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    private func rejectAuth(_ call: CAPPluginCall, _ error: Error?) {
        let code = (error as? LAError)?.code
        if code == .userCancel || code == .systemCancel || code == .appCancel || code == .userFallback {
            call.reject("Cancelled", "cancelled")
        } else {
            call.reject(error?.localizedDescription ?? "Face ID didn't work", "failed")
        }
    }
}

/// Wealthsimple-style app lock. With Face ID on and someone signed in, Penny is covered whenever it
/// leaves the screen (so the app switcher shows no balances either) and when it launches, and asks
/// for Face ID when it comes back. The device passcode works as a fallback; cancelling leaves an
/// "Unlock" button rather than asking again in a loop.
final class AppLock {
    static let shared = AppLock()
    private static let signedInKey = "penny.signedIn"

    static var signedIn: Bool {
        get { UserDefaults.standard.bool(forKey: signedInKey) }
        set { UserDefaults.standard.set(newValue, forKey: signedInKey) }
    }

    private var cover: LockView?
    private var authenticating = false
    // Face ID is asked for once each time Penny comes back; after that, the button asks again.
    private var askedThisTime = false

    private var enabled: Bool { Self.signedIn && FaceIDPlugin.hasSavedSignIn() }

    /// Covers the app (when leaving the screen, and at launch). Safe to call more than once.
    func lock(in window: UIWindow?) {
        askedThisTime = false
        guard cover == nil, enabled, let window else { return }
        let view = LockView(frame: window.bounds, biometry: Self.biometryName()) { [weak self] in self?.unlock() }
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(view)
        cover = view
    }

    /// When Penny is back on screen: ask for Face ID once if it's covered.
    func appBecameActive() {
        guard cover != nil, !askedThisTime else { return }
        askedThisTime = true
        unlock()
    }

    private func unlock() {
        guard let cover, !authenticating else { return }
        // Turned off (or the saved sign-in removed) while covered: nothing to protect any more.
        guard enabled else { remove(cover); return }
        authenticating = true
        let context = LAContext()
        context.localizedFallbackTitle = "Use Passcode"
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Penny") { ok, _ in
            DispatchQueue.main.async {
                self.authenticating = false
                if ok { self.remove(cover) }
            }
        }
    }

    private func remove(_ view: LockView) {
        cover = nil
        UIView.animate(withDuration: 0.2, animations: { view.alpha = 0 }, completion: { _ in view.removeFromSuperview() })
    }

    private static func biometryName() -> String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return context.biometryType == .touchID ? "Touch ID" : "Face ID"
    }
}

/// What shows while Penny is locked: the app's canvas colour, a lock, and an Unlock button.
private final class LockView: UIView {
    private let onUnlock: () -> Void

    init(frame: CGRect, biometry: String, onUnlock: @escaping () -> Void) {
        self.onUnlock = onUnlock
        super.init(frame: frame)
        backgroundColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0x0d / 255, green: 0x17 / 255, blue: 0x20 / 255, alpha: 1)
                : UIColor(red: 0xf6 / 255, green: 0xf8 / 255, blue: 0xfb / 255, alpha: 1)
        }

        let icon = UIImageView(image: UIImage(systemName: biometry == "Touch ID" ? "touchid" : "faceid"))
        icon.tintColor = .label
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 48, weight: .regular)
        icon.isAccessibilityElement = false

        let title = UILabel()
        title.text = "Penny is locked"
        title.font = UIFont.preferredFont(forTextStyle: .title2).withTraits(.traitBold)
        title.adjustsFontForContentSizeCategory = true
        title.textColor = .label
        title.accessibilityTraits = .header

        var config = UIButton.Configuration.filled()
        config.title = "Unlock with \(biometry)"
        config.cornerStyle = .capsule
        config.baseBackgroundColor = .label
        config.baseForegroundColor = .systemBackground
        config.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 28, bottom: 14, trailing: 28)
        let button = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in self?.onUnlock() })

        let stack = UIStackView(arrangedSubviews: [icon, title, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 20
        stack.setCustomSpacing(36, after: title)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
        ])
        accessibilityViewIsModal = true
    }

    required init?(coder: NSCoder) { fatalError("not used") }
}

private extension UIFont {
    func withTraits(_ traits: UIFontDescriptor.SymbolicTraits) -> UIFont {
        guard let descriptor = fontDescriptor.withSymbolicTraits(traits) else { return self }
        return UIFont(descriptor: descriptor, size: 0)
    }
}
