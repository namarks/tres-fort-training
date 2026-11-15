import SwiftUI
import UIKit

/// Setup choices describe AI apps, not models. A model needs a host that can
/// connect to our remote MCP server and complete the per-account OAuth flow.
enum CoachApp: String, CaseIterable, Identifiable {
    case claude, chatgpt, codex, other
    var id: String { rawValue }

    var name: String {
        switch self {
        case .chatgpt: return "ChatGPT"
        case .codex: return "Codex"
        case .claude: return "Claude"
        case .other: return "Other compatible app"
        }
    }

    /// Used inside sentences and on the consent button.
    var shortName: String { self == .other ? "your AI app" : name }

    /// The app's name on its tile in the connection header and app row.
    var tileName: String { self == .other ? "Other" : name }

    var recipient: String {
        switch self {
        case .chatgpt: return "ChatGPT, operated by OpenAI"
        case .codex: return "Codex, operated by OpenAI, and any other model provider you configure in it"
        case .claude: return "Claude, operated by Anthropic"
        case .other: return "Your chosen AI app and its configured model provider"
        }
    }
}

/// The data categories an authorized AI app can read, shown before any setup
/// step and on the approval screen. Keep aligned with the MCP read tools and
/// the privacy policy's AI section.
enum CoachSharing {
    static let sharedData = [
        "Your display name and training profile: goal, activities and weekly activity context, experience, training days and session length, equipment, movements to avoid and lifts you reported",
        "Training plan, schedule and plan history, plus races, trips, training blocks and other coaching settings",
        "Workout history: sessions, sets, weights, reps, durations, effort and fatigue ratings",
        "Saved workout feedback and notes",
        "Activities imported from Apple Health or Intervals.icu, including heart-rate summaries, and planned Intervals.icu events",
        "Group activity and member names visible to you",
    ]

    /// One short line per category above, shown first so consent fits on one
    /// screen; the full list stays one tap away under Full details.
    static let summary: [Item] = [
        Item(symbol: "person.crop.circle", text: "Profile, goals, equipment and lifts you reported"),
        Item(symbol: "calendar", text: "Plan, schedule, races and plan history"),
        Item(symbol: "dumbbell", text: "Workouts: sets, weights, reps and effort"),
        Item(symbol: "text.bubble", text: "Workout feedback and notes"),
        Item(symbol: "heart", text: "Imported activities and heart-rate summaries"),
        Item(symbol: "person.2", text: "Group activity you can see"),
    ]

    struct Item: Hashable {
        let symbol: String
        let text: String
    }
}

/// The short list of what an AI app can read, used before setup and on the
/// approval screen.
struct CoachSharingSummary: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(CoachSharing.summary, id: \.text) { item in
                Label {
                    Text(item.text)
                } icon: {
                    Image(systemName: item.symbol).foregroundStyle(Theme.accent)
                }
            }
        }
        .font(.footnote)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Every category in full, behind a Full details disclosure.
struct CoachSharingDetails: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("What is shared").font(.subheadline.weight(.semibold))
            ForEach(CoachSharing.sharedData, id: \.self) { item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("•").foregroundStyle(.secondary).accessibilityHidden(true)
                    Text(item)
                }
            }
        }
        .font(.footnote)
        .accessibilityElement(children: .combine)
    }
}

/// Très Fort and the chosen AI app side by side, as connection pages show
/// them. The app's tile carries its name, not its logo: Anthropic and OpenAI
/// allow their logos only with permission.
struct CoachConnectionHeader: View {
    /// The name on the AI app's tile.
    let tileName: String
    /// The app's name in "Connect Très Fort to …".
    let appName: String

    init(app: CoachApp) {
        tileName = app.tileName
        appName = app.shortName
    }

    init(tileName: String, appName: String) {
        self.tileName = tileName
        self.appName = appName
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Image("brand_tres_fort")
                    .resizable().interpolation(.high)
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                dots
                Image(systemName: "checkmark.shield")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 32, height: 32)
                    .background(Theme.surface2, in: Circle())
                dots
                Text(tileName)
                    .font(.footnote.weight(.bold))
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .padding(.horizontal, 4)
                    .frame(width: 56, height: 56)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .strokeBorder(Theme.text.opacity(0.14)))
            }
            .accessibilityHidden(true)
            Text("Connect Très Fort to \(appName)")
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("coach.connection-title")
        }
        .frame(maxWidth: .infinity)
    }

    private var dots: some View {
        Text("···").font(.headline).foregroundStyle(Theme.dim).accessibilityHidden(true)
    }
}

/// Public setup payloads contain only connection details, never account codes.
enum CoachSetup {
    static func serverURL(baseURL: URL) -> URL { baseURL.appendingPathComponent("mcp") }

    static func claudeInstallURL(baseURL: URL) -> URL {
        var url = URLComponents(string: "https://claude.ai/customize/connectors")!
        url.queryItems = [
            URLQueryItem(name: "modal", value: "add-custom-connector"),
            URLQueryItem(name: "connectorName", value: "Très Fort"),
            URLQueryItem(name: "connectorUrl", value: serverURL(baseURL: baseURL).absoluteString)
        ]
        return url.url!
    }

    static func codexSetupPrompt(baseURL: URL) -> String {
        """
        Help me connect Très Fort as my AI coach in Codex. Add a remote MCP server named tres-fort at \(serverURL(baseURL: baseURL).absoluteString), using OAuth. Preserve my other connections; if that name already exists, check it before changing anything. Start the OAuth sign-in and guide me through approving access in my browser. I will enter any Très Fort connect code directly on its consent page, never in this chat. After connecting, load my Très Fort coaching brief to verify access. Do not change my training plan or log anything during setup.
        """
    }
}

struct CoachConnectView: View {
    @ObservedObject var groupModel: GroupModel
    var onHandoff: () -> Void
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var selectedApp: CoachApp = .claude
    /// App Review 5.1.1(i)/5.1.2(i): setup, connection details and connect codes
    /// stay hidden until the member allows sharing with the named recipient.
    /// Choosing a different app asks again.
    @State private var consentedApp: CoachApp?
    @State private var code: String?
    @State private var generating = false
    @State private var error: String?

    private static let setupTopID = "coach.setup-top"
    private var connectorURL: String { CoachSetup.serverURL(baseURL: Config.apiBaseURL).absoluteString }

    var body: some View {
        ScrollViewReader { proxy in
            Form {
                if groupModel.me?.coach.connected == true {
                    Section {
                        Label("An AI app has access", systemImage: "checkmark.circle.fill")
                            .accessibilityIdentifier("coach.connected-status")
                        Text("You can connect more than one AI app to the same training account.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section {
                    CoachConnectionHeader(app: selectedApp)
                    appChoices
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                if consentedApp == selectedApp {
                    setupSections
                } else {
                    consentSection
                }
            }
            // The consent button sits below the disclosure; bring the member back
            // to the first setup step once they allow sharing.
            .onChange(of: consentedApp) { _, app in
                guard app != nil else { return }
                DispatchQueue.main.async { proxy.scrollTo(Self.setupTopID, anchor: .top) }
            }
        }
        // The decision stays on screen while the member reads, at any text size.
        .safeAreaInset(edge: .bottom) {
            if consentedApp != selectedApp { consentActions }
        }
        .navigationTitle("Connect your coach")
        .navigationBarTitleDisplayMode(.inline)
        .task { await groupModel.refreshMe() }
    }

    /// The AI apps as named tiles. Names only: Anthropic and OpenAI allow
    /// their logos only with permission (see "Brand logos" in DESIGN-SYSTEM.md).
    private var appChoices: some View {
        HStack(spacing: 8) {
            ForEach(CoachApp.allCases) { app in
                Button { selectedApp = app } label: {
                    Text(app.tileName)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .foregroundStyle(selectedApp == app ? Theme.onAccent : Theme.text)
                        .background(selectedApp == app ? Theme.accent : Theme.surface,
                                    in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(app.name)
                .accessibilityAddTraits(selectedApp == app ? .isSelected : [])
                .accessibilityIdentifier("coach.app.\(app.rawValue)")
            }
        }
        .padding(.top, 8)
    }

    @ViewBuilder
    private var consentSection: some View {
        Section {
            Text("Share your training data with \(selectedApp.recipient)?")
                .font(.headline)
                .accessibilityIdentifier("coach.data-sharing")
            Text("To coach you, \(selectedApp.shortName) reads and changes your Très Fort data, using your account with them and under their own terms and privacy policy. It can read:")
                .font(.footnote)
            CoachSharingSummary()
                .accessibilityIdentifier("coach.shared-data")
            Text("It can also change your plan and record training; changes are saved to your plan history. Stop access anytime in Profile.")
                .font(.footnote).foregroundStyle(.secondary)
            DisclosureGroup("Full details") {
                CoachSharingDetails()
                Text("Nothing is sent to a new app until you allow it here and then approve its connection. Apps you already connected keep access until you disconnect them in Profile → Disconnect all AI apps. Information already sent stays subject to the recipient’s policies.")
                    .font(.footnote).foregroundStyle(.secondary)
                if selectedApp == .claude {
                    Text("Claude opens to add Très Fort. Confirm it there, then choose Open Très Fort to review access. If Claude opens without the setup form, press and hold Allow and connect Claude to copy the setup link instead, then paste it into Safari.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Text("Très Fort isn’t affiliated with or endorsed by Anthropic or OpenAI. Claude and ChatGPT are their trademarks.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .font(.footnote)
            .accessibilityIdentifier("coach.full-details")
            policyLinks
        }
    }

    private var consentActions: some View {
        VStack(spacing: 4) {
            Button(action: allowSharing) {
                Text(selectedApp == .claude ? "Allow and connect Claude" : "Allow sharing with \(selectedApp.shortName)")
            }
            .buttonStyle(WorkoutPrimaryButtonStyle())
            .accessibilityIdentifier("coach.consent-allow")
            .contextMenu {
                if selectedApp == .claude {
                    Button("Allow and copy setup link", systemImage: "link") {
                        consentedApp = selectedApp
                        UIPasteboard.general.url = CoachSetup.claudeInstallURL(baseURL: Config.apiBaseURL)
                    }
                }
            }
            Button("Not now", role: .cancel) { dismiss() }
                .frame(maxWidth: .infinity, minHeight: 44)
                .accessibilityIdentifier("coach.consent-decline")
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .background(.bar)
    }

    /// Allowing sharing with Claude opens Claude straight away: the member
    /// gave permission on this screen, and Claude's own form is the next step.
    private func allowSharing() {
        consentedApp = selectedApp
        if selectedApp == .claude { openClaude() }
    }

    private func openClaude() {
        openURL(CoachSetup.claudeInstallURL(baseURL: Config.apiBaseURL)) { accepted in
            guard accepted else { return }
            // Free the setup presentation before the browser returns
            // with a separate, explicit access-approval intent.
            onHandoff()
        }
    }

    /// Both policies on one compact row; borderless so each link keeps its own tap.
    @ViewBuilder
    private var policyLinks: some View {
        HStack(spacing: 20) {
            switch selectedApp {
            case .claude:
                Link(destination: AppInformation.anthropicPrivacyURL) { Text("Anthropic privacy").frame(minHeight: 44) }
            case .chatgpt, .codex:
                Link(destination: AppInformation.openAIPrivacyURL) { Text("OpenAI privacy").frame(minHeight: 44) }
            case .other:
                EmptyView()
            }
            Link(destination: AppInformation.privacyURL) { Text("Privacy policy").frame(minHeight: 44) }
                .accessibilityIdentifier("app.privacy-policy")
        }
        .font(.footnote)
        .buttonStyle(.borderless)
        if selectedApp == .other || selectedApp == .codex {
            Text(selectedApp == .other
                 ? "Review your chosen app and model provider’s privacy policies before connecting."
                 : "If you configure another model provider, review that provider’s privacy policy too.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var setupSections: some View {
        setupInstructions
        Section {
            Text("Once connected, ask your AI app: “Use Très Fort to load my coaching brief.”")
                .font(.footnote)
            DisclosureGroup("Use a connect code") {
                Text("Use this if your AI app asks for a code or you cannot return to Très Fort to approve. Paste it only on the Très Fort consent page, never in a chat.")
                    .font(.footnote)
                if let code {
                    CopyRow(label: "Connect code", value: code, mono: true)
                }
                Button { Task { await generate() } } label: {
                    Label(generating ? "Generating…" : code == nil ? "Generate connect code" : "Generate a new code",
                          systemImage: code == nil ? "key.fill" : "arrow.clockwise")
                }
                .disabled(generating)
                .accessibilityIdentifier("coach.generate-code")
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.danger) }
                Text("This code expires in 10 minutes and works once. Keep it private. A new code does not disconnect linked apps. Manage AI access in Profile to disconnect them.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            DisclosureGroup("Data and access") { sharingDetails }
        }
    }

    @ViewBuilder
    private var setupInstructions: some View {
        Section("Connect \(selectedApp.name)") {
            Label("You allowed sharing with \(selectedApp.recipient).", systemImage: "checkmark.shield")
                .font(.footnote).foregroundStyle(.secondary)
                .accessibilityIdentifier("coach.consent-given")
                .id(Self.setupTopID)
            switch selectedApp {
            case .claude:
                Button(action: openClaude) {
                    Label("Connect with Claude", systemImage: "arrow.up.right.square")
                        .font(.headline).frame(minHeight: 44)
                }
                .accessibilityIdentifier("coach.connect-claude")
                .contextMenu {
                    Button("Copy setup link", systemImage: "link") {
                        UIPasteboard.general.url = CoachSetup.claudeInstallURL(baseURL: Config.apiBaseURL)
                    }
                }
                Text("Confirm Très Fort in Claude, then choose Open Très Fort to review access. If Claude opens without the setup form, press and hold Connect with Claude to copy the link and paste it into Safari.")
                    .font(.footnote).foregroundStyle(.secondary)
                DisclosureGroup("Manual setup") {
                    Text("On claude.ai, open Customize → Connectors → + → Add custom connector.")
                        .font(.footnote)
                    connectionDetails
                }
            case .chatgpt:
                Text("Set this up once in ChatGPT on the web.")
                    .font(.footnote)
                VStack(alignment: .leading, spacing: 8) {
                    Text("1. Open chatgpt.com/plugins, choose Add, then Add custom MCP server.")
                    Text("2. Name it Très Fort, paste the URL below and choose OAuth.")
                    Text("3. On the Très Fort page that opens, choose Continue with Apple and allow access.")
                }
                .font(.footnote)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("coach.chatgpt-steps")
                connectionDetails
                Link("Open ChatGPT plugins", destination: AppInformation.chatGPTPluginsURL)
                Text("OpenAI may limit custom plugins on some ChatGPT plans, for example to reading only.")
                    .font(.footnote).foregroundStyle(.secondary)
            case .codex:
                CopyRow(label: "Copy setup for Codex",
                        value: CoachSetup.codexSetupPrompt(baseURL: Config.apiBaseURL),
                        mono: false, hideValue: true)
                    .accessibilityIdentifier("coach.codex-setup")
                Text("Paste this into Codex and let it set up the connection. Complete the browser sign-in on the computer running Codex; use a connect code below when asked.")
                    .font(.footnote)
                Text("Codex currently needs a computer for initial setup. Once paired, ChatGPT’s Remote feature lets you use that connection from your phone while the computer stays online.")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("coach.codex-mobile-limit")
                Link("Using Codex from your phone", destination: AppInformation.codexRemoteGuideURL)
                DisclosureGroup("Manual setup") {
                    Text("In the Codex desktop app, open Settings → MCP servers → Add server. Choose Streamable HTTP and enter these details. Save, restart if prompted, then select Authenticate.")
                        .font(.footnote)
                    connectionDetails
                    Link("Codex connection guide", destination: AppInformation.codexMCPGuideURL)
                    DisclosureGroup("Command-line setup") {
                        CopyRow(label: "Add server", value: "codex mcp add tres-fort --url \(connectorURL)", mono: true)
                        CopyRow(label: "Sign in", value: "codex mcp login tres-fort", mono: true)
                    }
                }
            case .other:
                Text("In your AI app, add a remote MCP server with OAuth sign-in using these details. Models need a compatible host app to connect.")
                    .font(.footnote)
                connectionDetails
                Text("On the Très Fort page that opens, choose Continue with Apple, or use a connect code below. Apps that only accept API keys or static tokens are not supported by this setup.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var sharingDetails: some View {
        Text("\(selectedApp.recipient) can read your training plan, workout history, saved feedback and available group information, including workouts imported from Apple Health or Intervals.icu. The connection also allows changes to your plan and training records.")
            .font(.footnote)
        Text("Disconnect AI apps in Profile to stop future access. Information already retrieved stays subject to the app and model provider’s policies and account settings. The Apple Health group-sharing switch does not limit your own coach’s access.")
            .font(.footnote).foregroundStyle(.secondary)
        Text("Use your own AI account. Availability and usage limits depend on the provider.")
            .font(.footnote).foregroundStyle(.secondary)
        PrivacyPolicyLink()
        providerPolicyLinks
    }

    @ViewBuilder
    private var providerPolicyLinks: some View {
        switch selectedApp {
        case .chatgpt:
            Link("OpenAI privacy policy", destination: AppInformation.openAIPrivacyURL)
        case .codex:
            Link("OpenAI privacy policy", destination: AppInformation.openAIPrivacyURL)
            Text("If you configure another model provider, review that provider’s privacy policy too.")
                .font(.footnote).foregroundStyle(.secondary)
        case .claude:
            Link("Anthropic privacy policy", destination: AppInformation.anthropicPrivacyURL)
        case .other:
            Text("Review your chosen app and model provider’s privacy policies before connecting.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var connectionDetails: some View {
        CopyRow(label: "Name", value: selectedApp == .codex ? "tres-fort" : "Très Fort", mono: false)
        CopyRow(label: "URL", value: connectorURL, mono: true)
    }

    @MainActor
    private func generate() async {
        generating = true
        error = nil
        defer { generating = false }
        do {
            code = try await groupModel.generateCoachConnectCode()
        } catch is CancellationError {
            code = nil
        } catch let APIError.http(status, _) where status == 409 {
            error = "That code was already taken — tap again for a new one."
        } catch {
            self.error = "Couldn’t generate a code. Check your connection and try again."
        }
    }
}

private struct CopyRow: View {
    let label: String
    let value: String
    let mono: Bool
    var hideValue = false
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = value
            copied = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(copied && hideValue ? "Copied setup for Codex" : label)
                        .font(hideValue ? .headline : .caption)
                        .foregroundStyle(hideValue ? .primary : .secondary)
                    if !hideValue { Text(value)
                        .font(mono ? .system(.footnote, design: .monospaced) : .body)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 12)
                Image(systemName: copied ? "checkmark.circle.fill" : "doc.on.doc")
                    .foregroundStyle(copied ? .green : Theme.accent)
            }
        }
    }
}
