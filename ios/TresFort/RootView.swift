import AuthenticationServices
import Foundation
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AuthModel
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var defaults: LocalPersistence = .standard
    var now: () -> Date = Date.init
    var weightReader: (any BodyWeightReading)? = nil

    var body: some View {
        Group {
            switch model.phase {
            case .signedIn:
                if model.onboardingComplete {
                    MainTabView(auth: model, defaults: defaults, now: now, weightReader: weightReader)
                        .id("\(model.featureSessionEpoch)-\(defaults.recoveryGeneration)")
                } else {
                    switch model.onboardingResolution {
                    case .needsSetup:
                        OnboardingView(auth: model, defaults: defaults)
                            .id("\(model.featureSessionEpoch)-\(defaults.recoveryGeneration)")
                    case .unresolved, .checking:
                        accountCheck(error: nil)
                    case .failed(let message):
                        accountCheck(error: message)
                    }
                }
            default:
                ZStack {
                    Theme.bg.ignoresSafeArea()
                    GeometryReader { geometry in
                        ScrollView {
                            VStack(spacing: 28) {
                                Text("TRÈS FORT")
                                    .font(Theme.display(40)).tracking(2)
                                    .foregroundStyle(Theme.text)
                                if case let .working(msg) = model.phase {
                                    ProgressView(msg).tint(Theme.text).foregroundStyle(Theme.text)
                                } else {
                                    signedOut
                                }
                            }
                            .padding(32)
                            .frame(maxWidth: .infinity, minHeight: geometry.size.height)
                        }
                    }
                }
            }
        }
        .safeAreaInset(edge: .top) {
#if DEBUG && targetEnvironment(simulator)
            if let local = LocalDevelopmentConfiguration.current {
                Text("Local server · \(local.baseURL.absoluteString)")
                    .font(.caption).foregroundStyle(Theme.text)
                    .padding(8).frame(maxWidth: .infinity)
                    .background(Theme.surface2)
                    .accessibilityIdentifier("local.server.banner")
            }
#endif
            if model.isTestMember {
                TestMemberBanner(auth: model)
            }
        }
        .safeAreaInset(edge: .top) {
            if defaults.hasFailure(userID: model.userID) || model.entryPersistenceError != nil {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Saved training needs attention").font(.headline)
                    Text("A local save or read failed. Unlock your iPhone and check its available storage, then retry. Keep the app installed to preserve unsynced workouts.")
                        .font(.footnote)
                    if let message = model.entryPersistenceError {
                        Text(message).font(.footnote)
                    }
                    HStack {
                        Button("Retry saved data") { defaults.retry(userID: model.userID) }
                        Link("Contact support", destination: AppInformation.supportURL)
                        if !defaults.hasFailure(userID: model.userID) {
                            Button("Dismiss") { model.dismissEntryPersistenceError() }
                        }
                    }
                }
                .padding().frame(maxWidth: .infinity, alignment: .leading)
                .background(.regularMaterial)
                .accessibilityIdentifier("storage.failure")
            }
        }
        .onChange(of: defaults.recoveryGeneration) { _, _ in
            model.recoverEntryIntents()
        }
        .onChange(of: scenePhase) { _, phase in
            // Complete file protection intentionally denies background reads
            // while locked. Retry on return so a normal unlock does not leave
            // the app paused; disk/corruption failures still show the banner.
            if phase == .active { defaults.retry(userID: model.userID) }
        }
        .task(id: "\(model.featureSessionEpoch)-\(defaults.recoveryGeneration)-\(model.phase == .signedIn)-\(model.onboardingResolutionRevision)") {
            guard model.phase == .signedIn else { return }
            await model.resolveOnboarding()
        }
        // A launch that is not signed in never mounts MainTabView, so clear
        // any widget snapshot and reminders an earlier process published.
        .onChange(of: model.phase, initial: true) { _, phase in
            if phase != .signedIn { TrainingAgendaPublisher.clearPublished() }
        }
        // ActivityKit restores records independently of authentication and
        // onboarding. RootView is always mounted, so process-death cleanup also
        // runs for signed-out, expired-credential, and first-run launches.
        .task {
            // A process-death rest owns both ActivityKit UI and a local
            // notification. Neither has a recoverable timer in the new model,
            // so clear the pair at the same always-mounted launch boundary.
            RestCue.cancelNotification()
            await RestLiveActivity.endStaleActivities()
        }
        // External entry: group/coach Universal Links and the navigation-only
        // iPad setup shortcut route here
        // (onOpenURL on iOS 14+, plus the canonical web-browsing activity
        // hook for belt-and-suspenders). Both funnel into AuthModel, which
        // validates + stashes the code for MainTabView to present — so it
        // works whether or not we're signed in yet.
        .onOpenURL { model.handleDeepLink($0) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { model.handleDeepLink(url) }
        }
        .alert(
            "Finish disconnecting Apple sign-in",
            isPresented: Binding(
                get: { model.postDeletionAppleRevocationRequired },
                set: { isPresented in
                    if !isPresented {
                        model.dismissPostDeletionAppleRevocationHandoff()
                    }
                }
            )
        ) {
            Button("Done") {
                model.dismissPostDeletionAppleRevocationHandoff()
            }
        } message: {
            Text("The account deletion completed, but Apple could not confirm that its Sign in with Apple access was revoked. To remove it manually, open Settings > [your name] > Sign in with Apple > Tres Fort > Delete.")
        }
    }

    private var signedOut: some View {
        SignedOutView(model: model)
    }

    private func accountCheck(error: String?) -> some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            GeometryReader { geometry in
                ScrollView {
                    VStack(spacing: 24) {
                        Text("TRÈS FORT")
                            .font(Theme.display(40)).tracking(2)
                        if let error {
                            Text("Couldn’t load your account")
                                .font(.title2.bold())
                            Text(error)
                                .foregroundStyle(.secondary)
                                .accessibilityIdentifier("onboarding.resolve.error")
                            Button("Retry") {
                                Task { await model.resolveOnboarding() }
                            }
                            .buttonStyle(.borderedProminent)
                            .frame(minHeight: 48)
                            .accessibilityIdentifier("onboarding.resolve.retry")
                            Button("Sign out") { Task { await model.signOutOnServer() } }
                                .disabled(model.signingOut)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("onboarding.resolve.signOut")
                            if let error = model.signOutError { Text(error).foregroundStyle(.red) }
                        } else {
                            ProgressView("Looking for your existing workouts…")
                                .tint(Theme.text)
                                .accessibilityIdentifier("onboarding.resolve.checking")
                        }
                    }
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Theme.text)
                    .padding(32)
                    .frame(maxWidth: .infinity, minHeight: geometry.size.height)
                }
            }
        }
    }
}

/// Open sign-in. Anyone can sign in with Apple; no invite code required.
/// Invite links and the personal coach setup choice survive authentication;
/// the signed-in host presents their confirmation or setup destination.
private struct SignedOutView: View {
    @ObservedObject var model: AuthModel
    // Apple's guidelines: a white button on dark backgrounds, black on light.
    @Environment(\.colorScheme) private var colorScheme
    var body: some View {
        VStack(spacing: 16) {
            Text("Plan your week with runs, lifts and timed routines. Schedule a run and separate core, each at its own time.")
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

            Text("Sign in to create your plan, or return to the one you already use.")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

            if let reason = model.reauthenticationReason {
                Text(reason)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.orange)
            }

            if model.pendingInviteCode != nil {
                Text("Your group invite is saved. Sign in to review it.")
                    .font(.footnote).multilineTextAlignment(.center)
            }

            signInControl
                .frame(height: 50)
                .cornerRadius(10)

            if model.pendingEntryIntents.contains(where: { $0.destination == .coach }) {
                Text("Sign in to continue setting up your coach.")
                    .font(.footnote).multilineTextAlignment(.center)
            } else {
                Text("An AI coach is optional. You can connect one now or later.")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Theme.muted)
                Button("Set up my coach") { model.requestEntry(.coach) }
                    .frame(minHeight: 44)
            }

            HStack(spacing: 24) {
                PrivacyPolicyLink()
                Link("Contact support", destination: AppInformation.supportURL)
            }
            .font(.footnote)
            .frame(minHeight: 44)

            if case let .error(msg) = model.phase {
                Text(msg)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
        }
    }

    @ViewBuilder private var signInControl: some View {
#if DEBUG && targetEnvironment(simulator)
        if let local = LocalDevelopmentConfiguration.current {
            Button("Sign in to local server") {
                Task { await model.signInLocally(using: local) }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.signalFill).foregroundStyle(Theme.onSignal)
            .frame(maxWidth: .infinity, minHeight: 44)
            .accessibilityIdentifier("local.server.signIn")
        } else if UIFixtureScenario.selected != nil {
            // A synthetic intent must never launch a real Apple exchange,
            // including when someone manually explores the fixture screen.
            Button {
                if UIFixtureScenario.selected?.isActivation == true {
                    Task { await model.exchange(identityToken: "synthetic", fullName: nil) }
                } else {
                    model.phase = .working("Sign-in requested (synthetic)")
                }
            } label: {
                Label("Sign in with Apple", systemImage: "apple.logo")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .foregroundStyle(colorScheme == .dark ? Color.black : Color.white)
                    .background(colorScheme == .dark ? Color.white : Color.black)
            }
        } else {
            nativeSignInControl
        }
#else
        nativeSignInControl
#endif
    }

    private var nativeSignInControl: some View {
        SignInWithAppleButton(.signIn,
                                  onRequest: { req in
                                      req.requestedScopes = [.fullName, .email]
                                  },
                                  onCompletion: model.handleAppleResult)
                .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
    }
}

/// Shown on every screen while the owner is trying setup as a test member,
/// so the way back is always one tap away.
private struct TestMemberBanner: View {
    @ObservedObject var auth: AuthModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("You're in a test account")
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 12)
                Button {
                    Task { await auth.endTestMember() }
                } label: {
                    if auth.isSwitchingTestMember {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Back to my account")
                    }
                }
                .font(.subheadline)
                .disabled(auth.isSwitchingTestMember)
                .accessibilityIdentifier("testMember.end")
            }
            if let message = auth.testMemberError {
                Text(message).font(.footnote)
            }
        }
        .foregroundStyle(Theme.text)
        .padding(.horizontal).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("testMember.banner")
    }
}
