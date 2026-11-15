import StoreKit

/// "Try setup as a new member" is an owner tool for TestFlight builds. The
/// Worker refuses every account but the owner's; this build check only keeps
/// the button out of the App Store app, including for the owner.
enum TestMemberAvailability {
    static func isAvailableInThisBuild() async -> Bool {
        #if DEBUG
        return true
        #elseif APP_STORE_BUILD
        // App Store candidates (project-app-store.yml) also pass through
        // TestFlight before release, so ask StoreKit where this copy came from.
        guard let result = try? await AppTransaction.shared else { return false }
        switch result.unsafePayloadValue.environment {
        case .sandbox, .xcode: return true
        default: return false
        }
        #else
        // Beta builds (project.yml) only ever ship through TestFlight; every
        // App Store release is built with APP_STORE_BUILD=1. The build flavor
        // alone decides, because the button was missing on TestFlight 77 when
        // this also required AppTransaction to report the sandbox.
        return true
        #endif
    }
}
