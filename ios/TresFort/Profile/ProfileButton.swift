import SwiftUI

/// How a tab opens Profile: the main tab view supplies it through the
/// environment, so each tab's bar can show the avatar without knowing where
/// Profile lives.
struct ProfileEntry {
    let groupModel: GroupModel
    let open: () -> Void
}

private struct ProfileEntryKey: EnvironmentKey {
    static let defaultValue: ProfileEntry? = nil
}

extension EnvironmentValues {
    var profileEntry: ProfileEntry? {
        get { self[ProfileEntryKey.self] }
        set { self[ProfileEntryKey.self] = newValue }
    }
}

/// The avatar on a tab's bar that opens Profile. It carries the member's
/// initials and an orange dot when a connection needs them, such as an
/// intervals.icu reconnect. Shows nothing outside the main tabs.
struct ProfileButton: View {
    @Environment(\.profileEntry) private var entry

    var body: some View {
        if let entry {
            ProfileAvatarButton(groupModel: entry.groupModel, open: entry.open)
        }
    }

    /// Up to two initials from a display name: "Nick Marks" → "NM".
    static func initials(_ name: String?) -> String? {
        let words = (name ?? "").split(whereSeparator: { $0.isWhitespace })
        let letters = words.prefix(2).compactMap { $0.first.map { String($0).uppercased() } }
        return letters.isEmpty ? nil : letters.joined()
    }
}

private struct ProfileAvatarButton: View {
    @ObservedObject var groupModel: GroupModel
    let open: () -> Void

    private var needsAttention: Bool { groupModel.intervalsStatus?.needs_reauth == true }

    var body: some View {
        Button(action: open) {
            ZStack(alignment: .topTrailing) {
                Group {
                    if let initials = ProfileButton.initials(groupModel.me?.display_name) {
                        Text(initials).font(.system(size: 12, weight: .bold))
                    } else {
                        Image(systemName: "person.fill").font(.system(size: 13, weight: .semibold))
                    }
                }
                .foregroundStyle(Theme.onAccent)
                .frame(width: 30, height: 30)
                .background(Theme.accent, in: Circle())
                if needsAttention {
                    Circle().fill(Theme.signal)
                        .frame(width: 10, height: 10)
                        .overlay(Circle().stroke(Theme.surface, lineWidth: 2))
                        .offset(x: 2, y: -2)
                }
            }
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Profile")
        .accessibilityValue(needsAttention ? "A connection needs attention" : "")
        .accessibilityIdentifier("profile.open")
        // The dot needs the connection status, which Profile used to load
        // when its tab first opened.
        .task { if groupModel.me == nil { await groupModel.refreshMe() } }
    }
}
