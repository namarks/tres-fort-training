import SwiftUI

/// What a provider's row in Profile → Connections says under its name, so a
/// direct connection (Garmin, WHOOP) reads like intervals.icu and Apple
/// Health: "Connected" once it is, a prompt when it needs the member, and the
/// provider's description otherwise.
enum ConnectionRowStatus: Equatable {
    case checking
    case unavailable
    case notConfigured
    /// Available, but not connected.
    case description
    case connected
    /// The provider asks the member to sign in again.
    case reconnect
    /// Connected, but the member turned off what Tres Fort reads.
    case notSharing

    static func from(configured: Bool?, connected: Bool, needsReauth: Bool,
                     sharing: Bool = true, statusUnavailable: Bool = false) -> ConnectionRowStatus {
        // A failed refresh must not leave a cached connection looking current.
        if statusUnavailable { return .unavailable }
        guard let configured else { return .checking }
        guard configured else { return .notConfigured }
        guard connected else { return .description }
        if needsReauth { return .reconnect }
        if !sharing { return .notSharing }
        return .connected
    }
}

/// The line under a provider's name in Profile → Connections.
struct ConnectionRowSubtitle: View {
    let status: ConnectionRowStatus
    let description: String

    var body: some View {
        switch status {
        case .checking:
            Text("Checking connection…").font(.footnote).foregroundStyle(Theme.muted)
        case .unavailable:
            CautionText("Check connection status", font: .footnote)
        case .notConfigured:
            Text("Not available yet").font(.footnote).foregroundStyle(Theme.muted)
        case .description:
            Text(description).font(.footnote).foregroundStyle(Theme.muted)
        case .connected:
            Label("Connected", systemImage: "checkmark.circle.fill")
                .font(.footnote).foregroundStyle(Theme.done)
        case .reconnect:
            CautionText("Reconnect needed", font: .footnote)
        case .notSharing:
            CautionText("Not sharing activities", font: .footnote)
        }
    }
}
