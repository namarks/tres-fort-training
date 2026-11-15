import SwiftUI

struct CoachApprovalPreview: Decodable, Equatable {
    let client_name: String
    let redirect_uri: String
    let expires_at: Double
}

struct CoachApprovalDecision: Decodable, Equatable {
    let redirect_uri: String
    let allowed: Bool
}

protocol CoachApprovalAPI {
    func coachApproval(id: String, jwt: String) async throws -> CoachApprovalPreview
    func decideCoachApproval(id: String, allow: Bool, jwt: String) async throws -> CoachApprovalDecision
}

extension APIClient: CoachApprovalAPI {
    func coachApproval(id: String, jwt: String) async throws -> CoachApprovalPreview {
        try await get("api/coach-requests/\(id)", jwt: jwt)
    }

    func decideCoachApproval(id: String, allow: Bool, jwt: String) async throws -> CoachApprovalDecision {
        try await post("api/coach-requests/\(id)", body: ["decision": allow ? "allow" : "deny"], jwt: jwt)
    }
}

@MainActor
final class CoachApprovalModel: ObservableObject {
    enum State: Equatable {
        case loading, review(CoachApprovalPreview), sending
        case finished(CoachApprovalDecision), failed(String)
    }
    @Published private(set) var state: State = .loading
    private let auth: AuthModel
    private let accountID: String?
    private let epoch: UInt64
    private let requestID: String
    private let api: any CoachApprovalAPI

    init(auth: AuthModel, requestID: String, api: any CoachApprovalAPI = APIClient()) {
        self.auth = auth
        accountID = auth.userID
        epoch = auth.featureSessionEpoch
        self.requestID = requestID
        self.api = api
    }

    private var isCurrent: Bool { auth.isCurrentFeatureSession(accountID: accountID, epoch: epoch) }

    func load() async {
        await load(retryAfterRenewal: true)
    }

    private func load(retryAfterRenewal: Bool) async {
        guard isCurrent, let jwt = auth.featureJWT, state == .loading else { return }
        do {
            let preview = try await api.coachApproval(id: requestID, jwt: jwt)
            guard isCurrent else { return }
            guard Self.httpsURL(preview.redirect_uri) != nil,
                  preview.expires_at > Date().timeIntervalSince1970 * 1000 else {
                state = .failed("This connection request has expired or is unavailable. Start connecting again in your AI app.")
                return
            }
            state = .review(preview)
        } catch {
            guard isCurrent else { return }
            if case APIError.http(401, _) = error {
                if auth.featureJWT == jwt {
                    auth.requireReauthentication(reason: "Sign in again to finish connecting your AI app.")
                    return
                }
                // A normal renewal can overtake this read. Retry once with
                // the new bearer without invalidating that healthy session.
                if retryAfterRenewal {
                    await load(retryAfterRenewal: false)
                    return
                }
            }
            state = .failed("Could not load this connection request. Start connecting again in your AI app.")
        }
    }

    func decide(allow: Bool) async {
        guard isCurrent, let jwt = auth.featureJWT, case let .review(preview) = state else { return }
        guard preview.expires_at > Date().timeIntervalSince1970 * 1000 else {
            state = .failed("This request expired. Start connecting again in your AI app.")
            return
        }
        state = .sending // Synchronous latch: repeated taps cannot issue two decisions.
        do {
            let decision = try await api.decideCoachApproval(id: requestID, allow: allow, jwt: jwt)
            if decision.allowed { auth.noteAccountStatePersisted(for: accountID) }
            guard isCurrent else { return }
            guard Self.httpsURL(decision.redirect_uri) != nil else {
                state = .failed("Your decision was saved, but the return link is unavailable. Return to your AI app to reconnect.")
                return
            }
            state = .finished(decision)
        } catch {
            guard isCurrent else { return }
            if case APIError.http(401, _) = error {
                // Auth middleware rejected this request before any write.
                // Retain the account-bound intent through reauthentication.
                // An old-bearer rejection reloads consent, never the decision.
                if auth.featureJWT == jwt {
                    auth.requireReauthentication(reason: "Sign in again to finish connecting your AI app.")
                } else {
                    state = .loading
                    await load()
                }
                return
            }
            // An uncertain response may already have committed. Never repeat
            // an approval or claim denial from a transport failure.
            state = .failed("Could not confirm your decision. Start a new connection in your AI app. You can disconnect AI apps in Profile to stop access.")
        }
    }

    /// Names who receives the data from the return address, which the client
    /// registered, rather than from the self-reported client name.
    static func recipient(for preview: CoachApprovalPreview) -> String {
        let host = httpsURL(preview.redirect_uri)?.host?.lowercased() ?? ""
        func within(_ domain: String) -> Bool { host == domain || host.hasSuffix("." + domain) }
        if within("claude.ai") || within("anthropic.com") { return "Claude, operated by Anthropic" }
        if within("chatgpt.com") || within("openai.com") { return "ChatGPT, operated by OpenAI" }
        if within("meta.ai") || within("meta.com") { return "Meta AI, operated by Meta" }
        return "The app at \(host.isEmpty ? "the return address above" : host) and its configured model provider"
    }

    /// The short name for the Allow button, from the same return address.
    static func appName(for preview: CoachApprovalPreview) -> String {
        switch recipient(for: preview) {
        case "Claude, operated by Anthropic": return "Claude"
        case "ChatGPT, operated by OpenAI": return "ChatGPT"
        case "Meta AI, operated by Meta": return "Meta AI"
        default: return "your AI app"
        }
    }

    /// The name on the AI app's tile in the connection header.
    static func tileName(for preview: CoachApprovalPreview) -> String {
        let name = appName(for: preview)
        return name == "your AI app" ? "AI app" : name
    }

    static func returnHost(for preview: CoachApprovalPreview) -> String {
        httpsURL(preview.redirect_uri)?.host?.lowercased() ?? "an unverified address"
    }

    static func httpsURL(_ value: String) -> URL? {
        guard let url = URL(string: value), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.fragment == nil else { return nil }
        return url
    }
}

struct CoachApprovalView: View {
    @StateObject private var model: CoachApprovalModel
    @Environment(\.openURL) private var openURL
    let accountName: String
    let onDone: () -> Void

    init(auth: AuthModel, requestID: String, accountName: String, onDone: @escaping () -> Void) {
        _model = StateObject(wrappedValue: CoachApprovalModel(auth: auth, requestID: requestID))
        self.accountName = accountName
        self.onDone = onDone
    }

    var body: some View {
        NavigationStack {
            List {
                switch model.state {
                case .loading, .sending:
                    ProgressView(model.state == .sending ? "Saving your decision…" : "Loading request…")
                case let .review(preview):
                    Section {
                        CoachConnectionHeader(tileName: CoachApprovalModel.tileName(for: preview),
                                              appName: CoachApprovalModel.appName(for: preview))
                    }
                    .listRowBackground(Color.clear)
                    Section {
                        Text("Share your training data with \(CoachApprovalModel.recipient(for: preview))?")
                            .font(.headline)
                            .accessibilityIdentifier("coach-approval.recipient")
                        Text("Signed in as \(accountName). Requested by “\(preview.client_name)”, which returns to \(CoachApprovalModel.returnHost(for: preview)). Only allow access if you started this connection in an app you trust. They process your data under their own terms and privacy policy.")
                            .font(.footnote).foregroundStyle(.secondary)
                            .accessibilityIdentifier("coach-approval.client")
                    }
                    Section("It can read") {
                        CoachSharingSummary()
                        Text("It can change your plan and record training. Disconnect AI apps in Profile to stop future access; this does not delete data already retrieved into AI conversations.")
                            .font(.footnote).foregroundStyle(.secondary)
                        DisclosureGroup("Full details") {
                            CoachSharingDetails()
                            Text("Return address: \(preview.redirect_uri)").font(.footnote)
                            Text("Apple Health group sharing does not limit your own coach’s access.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        .font(.footnote)
                        PrivacyPolicyLink().font(.footnote)
                    }
                case let .finished(decision):
                    Section {
                        Text(decision.allowed ? "Access allowed" : "Access denied").font(.headline)
                        Text(decision.allowed ? "Returning you to your AI app to finish connecting." : "Continue in your AI app.")
                        if let url = CoachApprovalModel.httpsURL(decision.redirect_uri) {
                            Button("Continue to AI app") { openURL(url) }
                                .accessibilityIdentifier("coach-approval.continue")
                        }
                    }
                case let .failed(message):
                    Text(message).accessibilityIdentifier("coach-approval.error")
                }
            }
            // The decision stays on screen while the member reads.
            .safeAreaInset(edge: .bottom) {
                if case let .review(preview) = model.state { decisionButtons(preview) }
            }
            .navigationTitle("Review AI access")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done", action: onDone) } }
            .task { await model.load() }
            // Allowing access finishes the connection in the AI app: go back
            // there without a second tap. Continue stays as a fallback.
            .onChange(of: model.state) { _, state in
                guard case let .finished(decision) = state, decision.allowed,
                      let url = CoachApprovalModel.httpsURL(decision.redirect_uri) else { return }
                openURL(url)
            }
        }
    }

    private func decisionButtons(_ preview: CoachApprovalPreview) -> some View {
        VStack(spacing: 4) {
            Button("Allow and return to \(CoachApprovalModel.appName(for: preview))") {
                Task { await model.decide(allow: true) }
            }
            .buttonStyle(WorkoutPrimaryButtonStyle())
            .accessibilityIdentifier("coach-approval.allow")
            Button("Deny access", role: .cancel) { Task { await model.decide(allow: false) } }
                .frame(maxWidth: .infinity, minHeight: 44)
                .accessibilityIdentifier("coach-approval.deny")
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .background(.bar)
    }
}
