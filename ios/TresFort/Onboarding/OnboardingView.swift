import SwiftUI

/// The welcome, shown when the server has no evidence of prior setup. An
/// empty account may be returning; the welcome does not infer whether the
/// member is new.
///
/// Get started hands over to first-run setup inside the app (your usual week,
/// then your apps), which writes through the same models as the Plan tab and
/// Profile. Every step there is optional, and a returning member can go
/// straight in.
struct OnboardingView: View {
    @ObservedObject var auth: AuthModel
    @StateObject private var flow: OnboardingFlow

    init(auth: AuthModel, defaults: LocalPersistence = .standard) {
        self.auth = auth
        _flow = StateObject(wrappedValue: OnboardingFlow(auth: auth))
    }

    var body: some View {
        ZStack {
            Theme.background
            GeometryReader { geometry in
                ScrollView {
                    VStack(spacing: 0) {
                        Spacer(minLength: 12)
                        welcome
                            .padding(.horizontal, 28)
                            .frame(maxWidth: 480)
                        Spacer(minLength: 12)
                    }
                    .frame(maxWidth: .infinity, minHeight: geometry.size.height)
                }
            }
        }
    }

    private var welcome: some View {
        let checkpoint = flow.checkpoint
        return WelcomeStep(invitePending: auth.pendingInviteCode != nil,
                           onContinue: { _ = flow.start(from: checkpoint) },
                           onEnter: auth.canContinueWithoutSetup ? {
                               guard flow.isCurrent(checkpoint) else { return }
                               auth.continueWithoutSetup()
                           } : nil)
    }
}

// MARK: - Welcome

private struct WelcomeStep: View {
    let invitePending: Bool
    let onContinue: () -> Void
    let onEnter: (() -> Void)?

    var body: some View {
        VStack(spacing: 22) {
            Text("TRÈS FORT")
                .font(Theme.display(46)).tracking(2)
                .foregroundStyle(Theme.text)
            Text("Everything you train. One plan.")
                .font(.headline)
                .foregroundStyle(Theme.muted)

            VStack(alignment: .leading, spacing: 18) {
                OnboardingBullet(icon: "calendar", title: "Plan your week",
                                 text: "Runs, lifts, sports and separate timed core on one plan.")
                OnboardingBullet(icon: "dumbbell.fill", title: "Train and record",
                                 text: "Follow work and rest timers, log sets and record runs.")
                OnboardingBullet(icon: "person.2.fill", title: "Your crew",
                                 text: "Share progress with family and friends in a private group.")
            }
            .padding(.vertical, 8)

            Text(invitePending
                 ? "Your group invite is saved. Join first, then two quick steps: your usual week and your apps."
                 : "Two quick steps, both optional: your usual week, then the apps you already use.")
                .font(.footnote).foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            OnboardingPrimaryButton("Get started", action: onContinue)
            if let onEnter {
                OnboardingSkipButton("Continue to app", action: onEnter)
                    .accessibilityIdentifier("onboarding.continueToApp")
            }
        }
    }
}

// MARK: - Shared building blocks

private struct OnboardingBullet: View {
    let icon: String
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.text)
                Text(text)
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct OnboardingPrimaryButton: View {
    let title: String
    let enabled: Bool
    let action: () -> Void

    init(_ title: String, enabled: Bool = true, action: @escaping () -> Void) {
        self.title = title
        self.enabled = enabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(enabled ? Theme.accent : Theme.surface2,
                            in: RoundedRectangle(cornerRadius: 12))
                .foregroundStyle(enabled ? Theme.onAccent : Theme.dim)
        }
        .disabled(!enabled)
    }
}

private struct OnboardingSkipButton: View {
    let title: String
    let action: () -> Void

    init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        }
    }
}
