#if DEBUG && targetEnvironment(simulator)
import Foundation
import OSLog
import SwiftUI

/// Explicit, simulator-only launch fixtures. Release/device builds contain none
/// of this code. An unknown fixture fails closed before constructing real auth.
enum UIFixtureScenario: String, CaseIterable {
    case signIn = "sign-in", empty, emptyPlan = "empty-plan", loadFailure = "load-failure"
    case ordinary, bodyweight, timed, pending, onboarding, groups, library, freestyle
    case workoutSummary = "workout-summary"
    case weight = "weight", progress = "progress"
    case unilateralRow = "unilateral-row", unilateralPress = "unilateral-press"
    var isUnilateral: Bool { self == .unilateralRow || self == .unilateralPress }
    var unilateralName: String { self == .unilateralRow ? "Renegade Row" : "Single-Arm Dumbbell Shoulder Press" }
    case workoutSwap = "workout-swap"
    case appStore = "app-store"
    case groupSafety = "group-safety"
    case coachApproval = "coach-approval"
    case timedNavigation = "timed-navigation", timedPreviewCompletion = "timed-preview-completion"
    var isTimerNavigation: Bool { self == .timedNavigation || self == .timedPreviewCompletion }
    case planChanges = "plan-changes"
    case activationOwner = "activation-owner", activationInvite = "activation-invite"
    case activationManual = "activation-manual", activationCoach = "activation-coach"
    case activationReturning = "activation-returning", activationReturningRetry = "activation-returning-retry"
    case serverFailure = "server-failure", cachedEmpty = "cached-empty", cachedPlan = "cached-plan"
    var isActivation: Bool { rawValue.hasPrefix("activation-") }
    case historySmall = "history-small", historyLarge = "history-large"

    case intervalsConnect = "intervals-connect", intervalsRetry = "intervals-retry"
    case intervalsReauth = "intervals-reauth"
    var isIntervals: Bool { rawValue.hasPrefix("intervals-") }

    case historyProgress = "history-progress"
    case historyReview = "history-review"

    var isHistory: Bool { self == .historySmall || self == .historyLarge || self == .historyProgress }
    case correctionFailure = "correction-failure", readyToFinish = "ready-to-finish"

    static let selected: Self? = {
        guard let raw = ProcessInfo.processInfo.environment["TRESFORT_UI_FIXTURE"] else { return nil }
        guard let value = Self(rawValue: raw) else { fatalError("Unknown synthetic UI fixture") }
        return value
    }()
}

/// Fixed, value-free stages for diagnosing a synthetic UI test's Start path.
/// Opt-in separately from fixtures; never compiled into device/release builds.
enum UIFixtureStartTrace {
    enum Stage: String {
        case fixtureInitialized = "fixture_initialized"
        case todayStartAction = "today_start_action"
        case todayResumeSelected = "today_resume_selected"
        case todayStartSelected = "today_start_selected"
        case prepareEntered = "prepare_entered"
        case prepareAlreadyActive = "prepare_already_active"
        case prepareTaskEntered = "prepare_task_entered"
        case permissionReturned = "permission_returned"
        case prepareTaskCancelled = "prepare_task_cancelled"
        case prepareInvokingStart = "prepare_invoking_start"
        case prepareReturned = "prepare_returned"
        case startTodayEntered = "start_today_entered"
        case startTodayRejected = "start_today_rejected"
        case startWorkoutEntered = "start_workout_entered"
        case startPartnerRejected = "start_partner_rejected"
        case startAuthorityRejected = "start_authority_rejected"
        case startEligibilityRejected = "start_eligibility_rejected"
        case eligibilityPartnerRejected = "eligibility_partner_rejected"
        case eligibilityMutationRejected = "eligibility_mutation_rejected"
        case eligibilityCompletedRejected = "eligibility_completed_rejected"
        case eligibilityExistingWorkoutRejected = "eligibility_existing_workout_rejected"
        case eligibilityAccepted = "eligibility_accepted"
        case startTerminalRejected = "start_terminal_rejected"
        case startCheckpointClearRejected = "start_checkpoint_clear_rejected"
        case startRunningSet = "start_running_set"
        case startCheckpointSaved = "start_checkpoint_saved"
        case startCheckpointRejected = "start_checkpoint_rejected"
        case startWorkoutReturned = "start_workout_returned"
        case runnerAppeared = "runner_appeared"
    }

    private static let enabled = ProcessInfo.processInfo.environment["TRESFORT_UI_TRACE_START"] == "1"
        && UIFixtureScenario.selected != nil
    private static let logger = Logger(subsystem: "com.nmarkspdx.tresfort", category: "UIFixtureStart")

    static func record(_ stage: Stage) {
        guard enabled else { return }
        logger.notice("\(stage.rawValue, privacy: .public)")
    }
}

private final class FixtureTokenStore: AppTokenStore {
    func load() -> String? { nil }
    func save(_ token: String) {}
    func clear() {}
}

@MainActor
enum UIFixtureModel {
    // One synthetic namespace; reset before every launch. Never load Keychain
    // or the standard defaults used by an installed user's account.
    static let defaults: LocalPersistence = {
        let name = "com.nmarkspdx.tresfort.synthetic-ui"
        let value = LocalPersistence(suiteName: name)!
        if ProcessInfo.processInfo.environment["TRESFORT_UI_REUSE_PLAN_CHANGES"] != "1"
            && ProcessInfo.processInfo.environment["TRESFORT_UI_REUSE_FEEDBACK"] != "1"
            && !(UIFixtureScenario.selected?.isHistory == true && ProcessInfo.processInfo.environment["TRESFORT_UI_REUSE_HISTORY"] == "1") {
            value.removePersistentDomain(forName: name)
        }
        return value
    }()
    static func makeAuth() -> AuthModel {
        UIFixtureStartTrace.record(.fixtureInitialized)
        let auth = AuthModel(tokenStore: FixtureTokenStore(), defaults: defaults)
        if UIFixtureScenario.selected != .signIn && UIFixtureScenario.selected?.isActivation != true {
            auth.userID = "synthetic-ui-user"
            auth.jwt = UIFixtureScenario.selected?.isIntervals == true || [.appStore, .progress, .groupSafety, .historyReview].contains(UIFixtureScenario.selected)
                ? UIFixtureServer(scenario: UIFixtureScenario.selected!).syntheticJWT : "synthetic-ui-bearer"
            auth.onboardingComplete = UIFixtureScenario.selected != .onboarding
            auth.phase = .signedIn
        }
        if UIFixtureScenario.selected == .coachApproval {
            if ProcessInfo.processInfo.environment["TRESFORT_UI_PENDING_COACH_SETUP"] == "1" {
                auth.requestEntry(.coach)
            }
            auth.handleDeepLink(URL(string: "https://tresfort.app/coach/authorize?request=" + String(repeating: "a", count: 64))!)
        }
        if UIFixtureScenario.selected == .appStore {
            if let remembered = ProcessInfo.processInfo.environment["TRESFORT_UI_STATION_REMEMBERED_ACCOUNT"] {
                defaults.preferences.set(remembered, forKey: StationLink.stationEnabledAccountDefaultsKey)
            }
        }
        if UIFixtureScenario.selected == .appStore,
           ProcessInfo.processInfo.environment["TRESFORT_UI_PARTNER_READY"] == "1" {
            // Simulate an App Store upgrade with a beta's unfinished setup.
            // No start request or lane key exists: cancellation stays local.
            var workout = (AppStoreScreenshotData.plan["days"] as! [[String: Any]])[0]
            workout["id"] = UUID().uuidString
            workout["exercises"] = (workout["exercises"] as! [[String: Any]]).map { original in
                var slot = original; slot["id"] = UUID().uuidString; return slot
            }
            let decoded = try! JSONDecoder().decode(Workout.self, from: JSONSerialization.data(withJSONObject: workout))
            let offer = PartnerOffer(id: UUID(), hostName: "Synthetic host", planID: UUID().uuidString,
                                     planVersion: 1, workout: decoded)
            precondition(offer.isValid)
            let checkpoint = PartnerCheckpoint(id: offer.id, lane: .host, offer: offer, name: "Synthetic host",
                phase: .ready, slotMap: Dictionary(uniqueKeysWithValues: decoded.exercises.map { ($0.id, $0.id) }),
                receipt: .init(workout_id: decoded.id, plan_id: offer.planID, version: 1))
            precondition(PartnerCheckpointStore.replace(checkpoint, expected: nil,
                accountID: auth.userID!, defaults: defaults))
        }
        if UIFixtureScenario.selected == .activationInvite
            || ProcessInfo.processInfo.environment["TRESFORT_UI_PENDING_INVITE"] == "1" {
            auth.handleDeepLink(Config.apiBaseURL.appendingPathComponent("join/ABC234"))
        }
        if let scenario = UIFixtureScenario.selected, [.cachedEmpty, .cachedPlan].contains(scenario) {
            let plan = scenario == .cachedEmpty ? nil : PlanTree(id: "cached-plan", name: "Saved training", version: 1, workouts: [], meta: nil)
            StateSnapshotStore.save(StateResponse(plan: plan, plan_version: plan == nil ? 0 : 1,
                sessions: [], sets: [], external_events: [], external_activities: [], activities: [], server_time: 1),
                userID: auth.userID, defaults: defaults)
        }
        if let scenario = UIFixtureScenario.selected, scenario.isHistory,
           ProcessInfo.processInfo.environment["TRESFORT_UI_REUSE_HISTORY"] != "1" {
            let history = scenario == .historyProgress ? HistoryFixtureData.progressDataset()
                : HistoryFixtureData.dataset(sessionCount: scenario == .historySmall ? 12 : 1_040)
            let state = StateResponse(plan: PlanTree(id: "synthetic-plan", name: "Synthetic history", version: 1, workouts: [], meta: nil),
                plan_version: 1, sessions: history.sessions, sets: history.sets,
                external_events: [], external_activities: [], activities: [], server_time: history.server_time)
            StateSnapshotStore.save(state, userID: auth.userID, defaults: defaults)
            let catalog = (0..<40).map { ExerciseCatalog(id: "exercise-\($0)", name: "Exercise \($0)",
                primary_muscle: "legs", modality: "barbell", unit: "lb", laterality: nil, load_mode: nil, demo_slug: nil) }
            ExerciseCatalogSnapshotStore.save(catalog, userID: auth.userID, defaults: defaults)
            _ = StateSyncAccountStore.activate(userID: auth.userID, defaults: defaults)

        }
        if UIFixtureScenario.selected == .historyReview {
            StateSnapshotStore.save(HistoryReviewFixtureData.state, userID: auth.userID, defaults: defaults)
            let catalog = try! JSONDecoder().decode([ExerciseCatalog].self,
                from: JSONSerialization.data(withJSONObject: HistoryReviewFixtureData.catalog))
            ExerciseCatalogSnapshotStore.save(catalog, userID: auth.userID, defaults: defaults)
            _ = StateSyncAccountStore.activate(userID: auth.userID, defaults: defaults)
            if let raw = ProcessInfo.processInfo.environment["TRESFORT_UI_HISTORY_RECORD_LINK"], let url = URL(string: raw) {
                auth.handleDeepLink(url)
            }
        }
        return auth
    }
}

/// Whether setup handed Claude a connect link, so the fixture can answer as
/// if Claude finished connecting with it.
enum UIFixtureCoachLink {
    static var opened = false
}

struct UIFixtureView: View {
    @Environment(\.dynamicTypeSize) private var systemDynamicTypeSize
    @ObservedObject var auth: AuthModel
    let scenario: UIFixtureScenario
    @State private var openedURL: URL?
    @ObservedObject private var requestEvidence = UIFixtureRequestEvidence.shared
    @State private var clockStartedAt = ProcessInfo.processInfo.systemUptime

    private var appStoreClock: () -> Date {
        let date = CalendarProjection.date(from: "2026-09-08")!
        guard ProcessInfo.processInfo.environment["TRESFORT_UI_TICKING_CLOCK"] == "1" else {
            return { date }
        }
        // Timer-completion journeys need elapsed time while keeping the
        // fictional calendar/session date. Ordinary asset captures stay fixed.
        let startedAt = clockStartedAt
        return { date.addingTimeInterval(ProcessInfo.processInfo.systemUptime - startedAt) }
    }

    var body: some View {
        Group {
            if let mode = PartnerInstructionFixtureData.selected {
                PartnerInstructionFixtureView(auth: auth, mode: mode)
            } else if scenario == .progress {
                RootView(defaults: UIFixtureModel.defaults,
                         now: { CalendarProjection.date(from: "2026-09-08")! },
                         weightReader: FixtureWeightReader()).environmentObject(auth)
            } else if scenario == .weight {
                BodyWeightFixtureView(auth: auth)
            } else if scenario == .appStore {
                // Capture the production view hierarchy with fictional data.
                // QA fixtures retain their banner; this dedicated asset mode
                // is excluded from release and physical-device builds.
                VStack(spacing: 0) {
                    if ProcessInfo.processInfo.environment["TRESFORT_UI_CAPTURE_LINKS"] == "1" {
                        Text("Plan writes: \(requestEvidence.planWrites)")
                            .font(.caption2)
                            .accessibilityIdentifier("fixture.plan-writes")
                            .accessibilityValue(Text(String(requestEvidence.planWrites)))
                        if let openedURL {
                            Text(openedURL.absoluteString).font(.caption2).lineLimit(1)
                                .accessibilityIdentifier("fixture.opened-url")
                        }
                    }
                    RootView(defaults: UIFixtureModel.defaults,
                             now: appStoreClock).environmentObject(auth)
                }
            } else if scenario == .signIn || scenario.isActivation || scenario.isIntervals || scenario == .groupSafety || scenario == .coachApproval || scenario == .historyReview {
                VStack(spacing: 0) {
                    Text("SYNTHETIC · \(scenario.rawValue)")
                        .font(.caption).dynamicTypeSize(.large)
                        .accessibilityIdentifier("fixture.scenario")
                        .accessibilityValue(Text(verbatim: requestEvidence.value))
                    if ProcessInfo.processInfo.environment["TRESFORT_UI_CAPTURE_LINKS"] == "1", let openedURL {
                        Text(openedURL.absoluteString).font(.caption2).lineLimit(1)
                            .accessibilityIdentifier("fixture.opened-url")
                        if openedURL.host == "claude.ai" {
                            Button("Simulate coach return") {
                                auth.handleDeepLink(URL(string: "https://tresfort.app/coach/authorize?request=" + String(repeating: "a", count: 64))!)
                            }
                            .accessibilityIdentifier("fixture.coach-return")
                        }
                    }
                    RootView(defaults: UIFixtureModel.defaults,
                             now: { CalendarProjection.date(from: "2026-09-08")! }).environmentObject(auth)
                }
            } else {
                UIFixtureTrainingView(auth: auth, scenario: scenario)
            }
        }
        .defaultAppStorage(UIFixtureModel.defaults.preferences)
        .tint(Theme.accent)
        .environment(\.openURL, OpenURLAction { url in
            openedURL = url
            if ProcessInfo.processInfo.environment["TRESFORT_UI_CAPTURE_LINKS"] == "1", url.host == "claude.ai",
               url.absoluteString.contains("/mcp/c/") {
                UIFixtureCoachLink.opened = true
            }
            if ProcessInfo.processInfo.environment["TRESFORT_UI_RETURN_WITH_SETUP_OPEN"] == "1", url.host == "claude.ai" {
                // Simulate an incoming link without accepting an outbound
                // handoff: setup must be replaced by the incoming intent alone.
                auth.handleDeepLink(URL(string: "https://tresfort.app/coach/authorize?request=" + String(repeating: "a", count: 64))!)
                return .discarded
            }
            if ProcessInfo.processInfo.environment["TRESFORT_UI_CAPTURE_LINKS"] == "1",
               url.host == "claude.ai" || url == AppInformation.blockPlannerURL {
                return .handled
            }
            return .discarded
        })
        .environment(\.dynamicTypeSize,
            ProcessInfo.processInfo.environment["TRESFORT_UI_LARGE_TEXT"] == "1" ? .accessibility5 : systemDynamicTypeSize)
    }
}

/// Debug-only observations of requests made through the real authentication
/// and RootView paths. Counts include failed attempts, so a recovery test can
/// prove it never silently tried to replace existing training data.
@MainActor
private final class UIFixtureRequestEvidence: ObservableObject {
    static let shared = UIFixtureRequestEvidence()
    @Published private(set) var value = "signIn:0;state:0;profileWrites:0;starterWrites:0;workoutWrites:0;scheduleWrites:0"
    @Published private(set) var planWrites = 0
    private var signIn = 0, state = 0, profileWrites = 0, starterWrites = 0, workoutWrites = 0, scheduleWrites = 0

    func record(method: String, path: String) {
        if ["POST", "PUT", "PATCH", "DELETE"].contains(method),
           path.hasPrefix("/api/plan") || path.hasPrefix("/api/workouts") || path.hasPrefix("/api/starter-workouts/") {
            planWrites += 1
        }
        if method == "POST" && path == "/auth/apple" { signIn += 1 }
        if method == "GET" && path == "/api/state" { state += 1 }
        if method == "PUT" && path == "/api/me/training-profile" { profileWrites += 1 }
        if method == "POST" && path.hasPrefix("/api/starter-workouts/") { starterWrites += 1 }
        if method == "POST" && ["/api/workouts", "/api/workouts/prescribed"].contains(path) { workoutWrites += 1 }
        if method == "PUT" && path == "/api/plan/schedule" { scheduleWrites += 1 }
        value = "signIn:\(signIn);state:\(state);profileWrites:\(profileWrites);starterWrites:\(starterWrites);workoutWrites:\(workoutWrites);scheduleWrites:\(scheduleWrites)"
    }
}

/// RootView owns its own SyncModel. Construct the standalone training model
/// only for fixtures that render it, so an unused subscriber cannot supersede
/// the visible app's state request in the shared account snapshot store.
private struct UIFixtureTrainingView: View {
    @ObservedObject var auth: AuthModel
    let scenario: UIFixtureScenario
    @StateObject private var sync: SyncModel
    @StateObject private var stationLink = StationLinkController()
    @ObservedObject private var requestEvidence = UIFixtureRequestEvidence.shared

    init(auth: AuthModel, scenario: UIFixtureScenario) {
        self.auth = auth
        self.scenario = scenario
        _sync = StateObject(wrappedValue: SyncModel(
            auth: auth, defaults: UIFixtureModel.defaults,
            now: {
                if scenario.isTimerNavigation || scenario == .freestyle { return Date() }
                return CalendarProjection.date(from: "2026-09-08")!
            },
            restActivityUpdater: { _, _ in }, restActivityEnder: {},
            restNotificationCanceller: {}))
    }

    var body: some View {
        VStack(spacing: 0) {
            Text("SYNTHETIC · \(scenario.rawValue)")
                .font(.caption).dynamicTypeSize(.large)
                .accessibilityIdentifier("fixture.scenario")
                .accessibilityValue(Text(verbatim: fixtureEvidence))
            if scenario == .onboarding && !auth.onboardingComplete {
                OnboardingView(auth: auth)
            } else if scenario == .workoutSummary {
                NavigationStack {
                    DayAgendaView(sync: sync, dateString: "2026-09-08")
                        .navigationTitle("Workout date").navigationBarTitleDisplayMode(.inline)
                }
            } else if scenario.isHistory {
                TabView {
                    NavigationStack { HistoryView(sync: sync) }.tabItem { Label("Calendar", systemImage: "calendar") }
                    ActivityTabView(sync: sync).tabItem { Label("Activity", systemImage: "clock.arrow.circlepath") }
                }
            } else {
                TodayView(sync: sync, auth: auth, stationLink: stationLink)
            }
        }
        .task {
            guard !scenario.isHistory else { return }
            await sync.load()
            if scenario == .workoutSummary { return }
            if ProcessInfo.processInfo.environment["TRESFORT_UI_REUSE_FEEDBACK"] == "1" { return }
            if ![.empty, .emptyPlan, .loadFailure, .serverFailure, .cachedEmpty, .cachedPlan, .onboarding, .groups, .library, .planChanges, .freestyle].contains(scenario) {
                sync.startWorkout()
                if scenario.isTimerNavigation {
                    sync.jump(to: 1)
                }
                if [.readyToFinish, .correctionFailure].contains(scenario) {
                    sync.finished = true
                }
                if scenario == .pending, let exercise = sync.currentExercise {
                    await sync.logCurrentSet(expected: exercise, expectedSetNumber: sync.currentPhysicalSetNumber)
                    sync.skipRest()
                }
            }
        }
    }

    private var fixtureEvidence: String {
        if scenario == .groups {
            let slots = sync.workout(id: "synthetic-day")?.exercises ?? []
            let order = slots.map(\.id).joined(separator: ",")
            let groups = slots.map { "\($0.id)=\($0.group_id ?? "none")" }.joined(separator: ",")
            return "plan:\(sync.plan?.version ?? 0);planWrites:\(requestEvidence.planWrites);slots:\(order);groups:\(groups)"
        }
        if (scenario == .library && ProcessInfo.processInfo.environment["TRESFORT_UI_LIFTING_CREATION"] == "1")
            || (scenario == .empty && ProcessInfo.processInfo.environment["TRESFORT_UI_CAPTURE_LINKS"] == "1") {
            return requestEvidence.value + ";planWrites:\(requestEvidence.planWrites)"
        }
        if scenario == .ordinary, ProcessInfo.processInfo.environment["TRESFORT_UI_SESSION_CONTROLS"] == "1" {
            let working = sync.sets.filter { $0.deleted_at == nil && $0.is_warmup == 0 }
            let warmups = sync.sets.filter { $0.deleted_at == nil && $0.is_warmup == 1 }
            return "working:\(working.count);warmups:\(warmups.count);plan:\(sync.plan?.version ?? 0)"
        }
        if scenario == .ordinary {
            let workouts = sync.sessions.map { "\($0.slot ?? 0):\($0.status)" }.sorted().joined(separator: ",")
            return "workouts:\(workouts);selected:\(sync.todaySession?.slot ?? 0);running:\(sync.running);pending:\(sync.pendingAdditionalWorkout != nil);error:\(sync.loadError ?? "none")"
        }
        if scenario.isHistory { return "\(sync.sets.count) sets" }
        if scenario.isUnilateral {
            return "sets:\(sync.sets.count);reps:\(sync.sets.first?.reps ?? 0);total:\(sync.totalReps(for: sync.sets))"
        }
        if scenario == .workoutSwap {
            return "original:\(sync.sets.filter { $0.exercise_id == "synthetic-exercise" }.count);replacement:\(sync.sets.filter { $0.exercise_id == "synthetic-replacement" }.count);plan:\(sync.plan?.version ?? 0)"
        }
        guard scenario.isTimerNavigation else { return "" }
        let bike = sync.sets.filter { $0.template_exercise_id == "synthetic-bike" }
        return "bike:\(bike.count);other:\(sync.sets.count - bike.count);seconds:\(bike.first?.duration_s ?? 0);warmup:\(bike.first?.is_warmup ?? 0)"
    }
}

/// This ephemeral URLSession has exactly one protocol. Every request is either
/// answered from memory or rejected; no request is forwarded to a network.
final class UIFixtureProtocol: URLProtocol {
    static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [UIFixtureProtocol.self]
        return URLSession(configuration: config)
    }()
    private static let lock = NSLock()
    private static var server = UIFixtureServer(scenario: UIFixtureScenario.selected ?? .empty)
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if UIFixtureScenario.selected?.isActivation == true
            || UIFixtureScenario.selected == .groups
            || ((UIFixtureScenario.selected == .appStore || UIFixtureScenario.selected == .empty)
                && ProcessInfo.processInfo.environment["TRESFORT_UI_CAPTURE_LINKS"] == "1")
            || (UIFixtureScenario.selected == .library
                && ProcessInfo.processInfo.environment["TRESFORT_UI_LIFTING_CREATION"] == "1") {
            let method = request.httpMethod ?? "GET", path = request.url?.path ?? ""
            Task { @MainActor in UIFixtureRequestEvidence.shared.record(method: method, path: path) }
        }
        // An unanswered read proves Skip does not depend on transport timeout.
        if request.url?.path == "/api/me/training-profile",
           ProcessInfo.processInfo.environment["TRESFORT_UI_PENDING_TRAINING_PROFILE"] == "1" { return }
        let pendingStage = ProcessInfo.processInfo.environment["TRESFORT_UI_PENDING_TRAINING_STAGE"]
        if (pendingStage == "save" && request.httpMethod == "PUT" && request.url?.path == "/api/me/training-profile")
            || (pendingStage == "preview" && request.httpMethod == "GET" && request.url?.path == "/api/starter-workouts")
            || (pendingStage == "accept" && request.httpMethod == "POST" && request.url?.path == "/api/starter-workouts/bodyweight-v1") { return }
        Self.lock.lock()
        let result = Result { try Self.server.respond(request) }
        Self.lock.unlock()
        do {
            let (status, data) = try result.get()
            let response = HTTPURLResponse(url: request.url!, statusCode: status,
                httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

/// A bounded transport fixture, not a second implementation of the backend.
/// Stateful responses exist only for the creation/log/correction/finish smoke.
private struct UIFixtureServer {
    let scenario: UIFixtureScenario
    var plan: [String: Any]?
    var trainingProfile: [String: Any]?
    var trainingProfileVersion = 0
    var starterAccepted = false
    var sessions: [[String: Any]] = []
    var sets: [[String: Any]] = []
    var groupReceipts: [String: [String: Any]] = [:]
    var returnedGroupConflict = false
    var prescribedWorkoutReceipts: [String: (request: Data, receipt: [String: Any])] = [:]
    var returnedFeedbackConflict = false
    var completedFeedbackConflictedProposals: Set<String> = []
    var failCreatedWorkoutRefresh = false
    var failedEnsureRequest = false
    var returnedMoveConflict = false
    var returnedScheduleFailure = false
    var returnedProgramConflict = false
    var scheduleAttempts = 0
    var signInAttempts = 0
    var stateAttempts = 0
    var inviteAttempts = 0
    var joined = false
    var coachConnected = false
    var intervalsConnected = false
    var intervalsReauth = false
    var intervalsPending = false
    var intervalsGeneration = 0
    var importedActivities: [[String: Any]] = []
    var intervalsStatus: [String: Any] {
        ["connected": intervalsConnected, "needs_reauth": intervalsReauth,
         "athlete_id": intervalsConnected ? "synthetic-athlete" as Any : NSNull(),
         "credential_generation": intervalsGeneration, "sync_pending": intervalsPending,
         "last_synced_at": intervalsConnected && !intervalsPending ? revision as Any : NSNull()]
    }

    /// The same catalog enriches a created prescription and its picker rows.
    var liftingCreationCatalog: [[String: Any]] {
        [
            ["id": "creation-dumbbell", "name": "Dumbbell Row", "modality": "dumbbell", "unit": "lb", "primary_muscle": "back", "laterality": "unilateral", "load_mode": "per_hand"],
            ["id": "creation-pullup", "name": "Pull-Up", "modality": "bw", "unit": "lb", "primary_muscle": "back"],
            ["id": "creation-bike", "name": "Stationary Bike", "modality": "cardio", "unit": "lb", "primary_muscle": "legs"]
        ]
    }

    var creationCatalog: [[String: Any]] {
        let home: [(id: String, name: String, modality: String, muscle: String)] = [
            ("ex_plank", "Plank", "timed", "core"),
            ("ex_dead_bug", "Dead Bug", "bw", "core"),
            ("ex_side_plank", "Side Plank", "timed", "core"),
            ("ex_bird_dog", "Bird Dog", "bw", "core"),
            ("ex_hollow", "Hollow Hold", "timed", "core"),
            ("ex_cat_cow", "Cat-Cow", "bw", "core"),
            ("ex_thoracic_rotation", "Thoracic Rotation", "bw", "back"),
            ("ex_90_90_hip", "90/90 Hip Switch", "bw", "glutes"),
            ("ex_pigeon_pose", "Pigeon Pose", "bw", "glutes"),
            ("ex_couch_stretch", "Couch Stretch", "bw", "quads"),
            ("ex_pushup", "Push-Up", "bw", "chest"),
            ("ex_bw_squat", "Bodyweight Squat", "bw", "quads"),
            ("ex_bw_reverse_lunge", "Bodyweight Reverse Lunge", "bw", "quads"),
            ("ex_glute_bridge_march", "Glute Bridge March", "bw", "glutes")]
        return AppStoreScreenshotData.catalog + liftingCreationCatalog + home.map {
            ["id": $0.id, "name": $0.name, "modality": $0.modality,
             "unit": $0.modality == "timed" ? "sec" : "lb", "primary_muscle": $0.muscle]
        } + [
            ["id": "synthetic-exercise", "name": "Barbell Squat", "modality": "barbell", "unit": "lb", "primary_muscle": "legs"],
            ["id": "synthetic-upper", "name": "Bench Press", "modality": "barbell", "unit": "lb", "primary_muscle": "chest"],
            ["id": "synthetic-core", "name": "Plank", "modality": "timed", "unit": "lb", "primary_muscle": "core"],
            ["id": RunPlan.exerciseID, "name": "Outdoor Run", "modality": "cardio", "unit": "lb", "primary_muscle": "legs"]]
    }
    /// Rows accepted by the synthetic manual-activity endpoint.
    private var enteredActivities: [[String: Any]] = []

    /// Activities logged by hand, including this fixture session's writes.
    var loggedActivities: [[String: Any]] {
        guard scenario == .progress,
              ProcessInfo.processInfo.environment["TRESFORT_UI_PROGRESS_EMPTY"] != "1" else { return enteredActivities }
        return enteredActivities + [["id": "synthetic-soccer", "user_id": syntheticUserID, "date": "2026-09-07", "type": "other",
                 "title": "Soccer", "duration_minutes": 90, "notes": NSNull(), "logged_at": revision,
                 "source": "ios", "deleted_at": NSNull(), "updated_at": revision],
                // Shares its date with a finished workout, so History has two
                // rows on one day and each must open itself.
                ["id": "synthetic-yoga", "user_id": syntheticUserID, "date": "2026-09-05", "type": "yoga",
                 "title": "Yoga", "duration_minutes": 30, "notes": NSNull(), "logged_at": revision,
                 "source": "ios", "deleted_at": NSNull(), "updated_at": revision]]
    }

    mutating func importIntervalsActivity() {
        importedActivities = [["id": "synthetic-imported-ride", "source": "intervals", "external_id": "ride-1",
            "date": "2026-09-08", "kind": "ride", "name": "Morning ride", "start_date_local_ms": revision,
            "moving_time_sec": 1800, "training_load": 25, "synced_at": revision,
            "source_attribution": "Garmin Edge 840", "attribution_version": 1]]
    }
    var syntheticUserID: String { scenario == .activationOwner ? "synthetic-owner" : "synthetic-ui-user" }
    var syntheticJWT: String {
        let data = try! JSONSerialization.data(withJSONObject: ["sub": syntheticUserID, "exp": 4_000_000_000], options: [.sortedKeys])
        return "header." + data.base64EncodedString().replacingOccurrences(of: "=", with: "") + ".synthetic"
    }
    let safetyPeerID = "c3223561-0e27-4727-b369-681078533ca6"
    var healthSharing = ProcessInfo.processInfo.environment["TRESFORT_UI_HEALTH_SHARED"] == "1"
    var safetyBlocked = false
    var safetyRestricted = false
    var syntheticGroup: [String: Any] {
        var members: [[String: Any]] = [["group_id": "synthetic-group", "user_id": syntheticUserID,
            "display_name": "Synthetic member", "effective_display_name": "Synthetic member", "joined_at": 1]]
        if scenario == .groupSafety && !safetyBlocked {
            members.append(["group_id": "synthetic-group", "user_id": safetyPeerID,
                "display_name": "Sample member", "effective_display_name": "Sample member", "joined_at": 2])
        }
        return ["id": "synthetic-group", "name": "Synthetic Crew", "created_by": "synthetic-owner", "created_at": 1, "members": members]
    }
    var planRestored = false
    var returnedCreationFailure = false
    var revision = 1_788_912_000_000
    var dayID: String { PartnerInstructionFixtureData.selected == nil ? "synthetic-day" : PartnerInstructionFixtureData.workoutID }
    let sessionID = "synthetic-session"

    init(scenario: UIFixtureScenario) {
        self.scenario = scenario
        if scenario == .groupSafety { joined = true }
        coachConnected = [.activationOwner, .activationCoach, .activationInvite].contains(scenario)
        if ![.signIn, .empty, .loadFailure, .serverFailure, .cachedEmpty, .cachedPlan, .onboarding, .activationManual].contains(scenario) {
            plan = makePlan()
            sessions = [.groups, .library, .planChanges, .freestyle].contains(scenario) ? [] : [makeSession()]
            if scenario == .planChanges { plan?["version"] = 3 }
            if [.readyToFinish, .correctionFailure, .workoutSwap].contains(scenario) {
                sets = [["id": "synthetic-set", "session_id": sessionID,
                    "exercise_id": "synthetic-exercise", "template_exercise_id": "synthetic-slot",
                    "set_index": 1, "weight": 45, "reps": 5, "is_warmup": 0,
                    "logged_at": revision, "updated_at": revision, "is_timed": 0]]
            }
        }
        if let fixture = workoutSummaryFixture {
            sessions = [fixture["session"] as! [String: Any]]
            sets = fixture["sets"] as! [[String: Any]]
        }
        if scenario == .readyToFinish && ProcessInfo.processInfo.environment["TRESFORT_UI_COMPLETED_FEEDBACK_EXTRA"] == "1" {
            var extra = makeSession(status: "completed", attempt: 0)
            extra["id"] = "feedback-extra"; extra["slot"] = 1
            extra["notes"] = "Additional workout note"
            sessions.append(extra)
        }
        if scenario == .emptyPlan { plan?["days"] = []; sessions = [] }
        if ProcessInfo.processInfo.environment["TRESFORT_UI_STARTER_ALREADY_USED"] == "1" { starterAccepted = true }
        if scenario.isIntervals { sessions = [] }
        if scenario == .historyReview {
            plan = HistoryReviewFixtureData.plan
            sessions = HistoryReviewFixtureData.sessions
            sets = HistoryReviewFixtureData.sets
            revision = HistoryReviewFixtureData.base + 2 * 86_400_000
        }
        if scenario == .appStore || scenario == .progress {
            sessions = AppStoreScreenshotData.sessions
            sets = AppStoreScreenshotData.sets
            if ProcessInfo.processInfo.environment["TRESFORT_UI_SESSION_CONTROLS"] == "1",
               var days = plan?["days"] as? [[String: Any]], !days.isEmpty,
               var slots = days[0]["exercises"] as? [[String: Any]], !slots.isEmpty {
                slots[0]["cues"] = "Keep your heels down."
                days[0]["exercises"] = slots; plan?["days"] = days
            }
            if scenario == .appStore,
               ProcessInfo.processInfo.environment["TRESFORT_UI_BLOCK_HANDOFF"] == "1",
               let rawMeta = plan?["meta"] as? String,
               var meta = try? JSONSerialization.jsonObject(with: Data(rawMeta.utf8)) as? [String: Any] {
                let week: [String: Any] = ["week": ["tue": "synthetic-day", "thu": "strength-b", "sat": "synthetic-day"]]
                meta["program"] = ["id": "synthetic-block", "name": "Strength block", "start": "2026-09-07",
                                   "repeat": false, "weeks": [week, week, week]]
                plan?["meta"] = String(data: try! JSONSerialization.data(withJSONObject: meta), encoding: .utf8)!
            }
            if ProcessInfo.processInfo.environment["TRESFORT_UI_RUNNER_UNKNOWN_LOAD"] == "1",
               var days = plan?["days"] as? [[String: Any]], !days.isEmpty,
               var slots = days[0]["exercises"] as? [[String: Any]], !slots.isEmpty {
                slots[0]["target_weight"] = NSNull()
                slots[0]["target_rpe"] = 7
                slots[0]["exercise_name"] = "Dumbbell Bench Press"
                slots[0]["exercise_modality"] = "dumbbell"
                slots[0]["exercise_load_mode"] = "per_hand"
                let exerciseID = slots[0]["exercise_id"] as? String
                sets.removeAll { $0["exercise_id"] as? String == exerciseID }
                days[0]["exercises"] = slots; plan?["days"] = days
            }
            if ProcessInfo.processInfo.environment["TRESFORT_UI_PRESCRIPTION_REVIEW"] != nil,
               var days = plan?["days"] as? [[String: Any]], !days.isEmpty,
               var slots = days[0]["exercises"] as? [[String: Any]], !slots.isEmpty {
                slots[0]["target_weight"] = 135
                days[0]["exercises"] = slots; plan?["days"] = days
            }
            if scenario == .appStore,
               ProcessInfo.processInfo.environment["TRESFORT_UI_GROUP_CONTRACT"] != nil,
               var days = plan?["days"] as? [[String: Any]], !days.isEmpty {
                days[0]["exercises"] = groupFixture["slots"]
                days[0]["day_label"] = days[0]["name"]
                plan?["days"] = days
            }
            if scenario == .progress && ProcessInfo.processInfo.environment["TRESFORT_UI_PROGRESS_EMPTY"] == "1" {
                sessions = []; sets = []
            }
            if ProcessInfo.processInfo.environment["TRESFORT_UI_UNASSIGNED_DATE"] == "1" {
                sessions.append(["id": "unassigned-date", "date": "2026-09-09",
                    "status": "planned", "workout_id": NSNull(), "attempt": 1,
                    "updated_at": revision, "write_protocol": "attempt-v1"])
            }
            if ProcessInfo.processInfo.environment["TRESFORT_UI_REST_DAY"] == "1" {
                // Keep the rest of the week, as on an ordinary rest day.
                plan?["meta"] = #"{"schedule":{"version":1,"week":{"thu":"strength-b","sat":"synthetic-day"}}}"#
                sessions.removeAll { $0["date"] as? String == "2026-09-08" }
            }
            if ProcessInfo.processInfo.environment["TRESFORT_UI_EMPTY_WORKOUT_LIBRARY"] == "1" {
                plan?["days"] = []; plan?["meta"] = "{}"
            }
            if let status = ProcessInfo.processInfo.environment["TRESFORT_UI_UNRESOLVED_TODAY"] {
                var unresolved = makeSession(status: status)
                unresolved["workout_id"] = status == "planned" ? NSNull() : "removed-workout" as Any
                sessions.append(unresolved)
                if status == "planned" { plan?["meta"] = "{}" }
                if status == "in_progress", var set = sets.first {
                    set["id"] = "unresolved-set"; set["session_id"] = sessionID
                    sets.append(set)
                }
            }
            if let agenda = ProcessInfo.processInfo.environment["TRESFORT_UI_MIXED_AGENDA"] {
                plan = ["id": "synthetic-plan", "name": "Run and core", "version": 1,
                    "meta": #"{"schedule":{"version":1,"week":{"tue":"agenda-run","thu":"agenda-run"},"extras":{"tue":["agenda-core","agenda-walk"],"thu":["agenda-core"]},"times":{"tue":{"agenda-run":"07:00","agenda-core":"18:00","agenda-walk":"20:00"},"thu":{"agenda-run":"07:00","agenda-core":"18:00"}}}}"#,
                    "days": [
                        ["id": "agenda-run", "name": "Morning Run", "order_index": 0,
                         "exercises": [["id": "agenda-run-slot", "exercise_id": "ex_outdoor_run",
                            "exercise_name": "Outdoor Run", "exercise_unit": "lb", "exercise_modality": "cardio",
                            "order_index": 0, "target_sets": 1, "target_reps": 1,
                            "target_duration_s": 300, "rest_seconds": 0]]],
                        ["id": "agenda-core", "name": "Evening Core", "order_index": 1,
                         "exercises": [["id": "agenda-core-slot", "exercise_id": "ex_plank",
                            "exercise_name": "Plank", "exercise_unit": "lb", "exercise_modality": "timed",
                            "order_index": 0, "target_sets": 1, "target_reps": 1,
                            "target_duration_s": 1, "rest_seconds": 0]]],
                        ["id": "agenda-walk", "name": "Evening Walk", "order_index": 2, "exercises": []]
                    ]]
                sessions = agenda == "completed-run" ? [["id": "agenda-run-session", "date": "2026-09-08",
                    "slot": 0, "status": "completed", "workout_id": "agenda-run", "attempt": 1,
                    "updated_at": revision, "write_protocol": "attempt-v1"]] : []
                sets = []
            }
        }
        if scenario == .intervalsReauth {
            intervalsReauth = true
            importIntervalsActivity()
        }
        if let fixture = coachingFixture {
            sessions = [fixture["session"] as! [String: Any]]
            sets = fixture["sets"] as! [[String: Any]]
            let meta = try! JSONSerialization.data(withJSONObject: fixture["meta"]!)
            plan?["meta"] = String(decoding: meta, as: UTF8.self)
        }

    }

    var workoutSummaryFixture: [String: Any]? {
        guard scenario == .workoutSummary,
              let raw = ProcessInfo.processInfo.environment["TRESFORT_UI_SUMMARY_CONTRACT"],
              let data = raw.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    var coachingFixture: [String: Any]? {
        guard let raw = ProcessInfo.processInfo.environment["TRESFORT_UI_COACHING_CONTRACT"],
              let data = raw.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    // The same contract is consumed by real-D1 and unit tests. Only the UI
    // test bundle carries the file; the app receives it via launch environment.
    var groupFixture: [String: Any] {
        guard let raw = ProcessInfo.processInfo.environment["TRESFORT_UI_GROUP_CONTRACT"],
              let data = raw.data(using: .utf8),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            preconditionFailure("Missing synthetic group contract")
        }
        return fixture
    }

    func makeSession(status: String = "in_progress", attempt: Int = 1) -> [String: Any] {
        ["id": sessionID, "date": (scenario.isTimerNavigation || scenario == .freestyle) ? CalendarProjection.dateString(Date()) : "2026-09-08", "status": status,
         "workout_id": dayID, "updated_at": revision,
         "attempt": attempt, "write_protocol": "attempt-v1"]
    }
    func makePlan(name: String = "Synthetic Training", workouts: Bool = true) -> [String: Any] {
        if let mode = PartnerInstructionFixtureData.selected { return PartnerInstructionFixtureData.plan(mode) }
        if scenario == .appStore || scenario == .progress { return AppStoreScreenshotData.plan }
        if scenario.isTimerNavigation {
            let slots: [[String: Any]] = [
                ["id": "synthetic-squat", "exercise_id": "synthetic-squat-exercise",
                 "exercise_name": "Goblet Squat", "exercise_modality": "dumbbell",
                 "exercise_unit": "lb", "order_index": 0, "target_sets": 2,
                 "target_reps": 8, "target_weight": 25, "rest_seconds": 60],
                ["id": "synthetic-bike", "exercise_id": "synthetic-bike-exercise",
                 "exercise_name": "Stationary Bike", "exercise_modality": "cardio",
                 "exercise_unit": "lb", "order_index": 1, "target_sets": 1,
                 "target_reps": 1, "target_duration_s": scenario == .timedNavigation ? 300 : 15,
                 "is_warmup": 1, "rest_seconds": 0],
                ["id": "synthetic-pushup", "exercise_id": "synthetic-pushup-exercise",
                 "exercise_name": "Push-Up", "exercise_modality": "bw",
                 "exercise_unit": "lb", "order_index": 2, "target_sets": 2,
                 "target_reps": 10, "rest_seconds": 60]
            ]
            return ["id": "synthetic-plan", "name": name, "version": 1,
                "meta": "{\"schedule\":{\"version\":1,\"week\":{\"\(CalendarProjection.weekdayKey(for: Date()))\":\"synthetic-day\"}}}",
                "days": [["id": dayID, "name": "Strength + Bike", "order_index": 0,
                          "exercises": slots]]]
        }
        if scenario == .library {
            return ["id": "synthetic-plan", "name": "My Workouts", "version": 1,
                "meta": "{\"schedule\":{\"version\":1,\"week\":{\"tue\":\"synthetic-day\"}}}",
                "days": [["id": dayID, "name": "Gym", "order_index": 0, "exercises": []],
                         ["id": "hotel", "name": "Hotel", "order_index": 1, "exercises": []]]]
        }
        if scenario == .groups {
            return ["id": "synthetic-plan", "name": groupFixture["name"]!, "version": 1,
                "meta": "{\"schedule\":{\"version\":1,\"week\":{\"tue\":\"synthetic-day\"}}}",
                "days": [["id": dayID, "name": groupFixture["day_name"]!, "order_index": 0,
                          "exercises": groupFixture["slots"]!]]]
        }
        let modality = scenario == .bodyweight ? "bw" : scenario == .timed ? "timed" : "barbell"
        var slot: [String: Any] = ["id": "synthetic-slot", "exercise_id": "synthetic-exercise",
            "exercise_name": scenario == .bodyweight ? "Pull-Up" : scenario == .timed ? "Plank" : "Barbell Squat",
            "exercise_unit": "lb", "exercise_modality": modality, "order_index": 0,
            "target_sets": 1, "target_reps": 5, "rest_seconds": 0,
            "target_weight": modality == "barbell" ? 45 : 0]
        if scenario.isUnilateral {
            slot["exercise_name"] = scenario.unilateralName
            slot["exercise_modality"] = "dumbbell"
            slot["exercise_laterality"] = "unilateral"
            slot["target_reps"] = 10
            slot["target_sets"] = 3
        }
        if scenario == .timed { slot["target_duration_s"] = 5 }
        if scenario == .workoutSwap { slot["target_sets"] = 3 }
        let meta = scenario == .activationManual ? "{}"
            : "{\"schedule\":{\"version\":1,\"week\":{\"tue\":\"synthetic-day\"}}}"
        return ["id": "synthetic-plan", "name": name, "version": 1, "meta": meta,
            "days": workouts ? [["id": dayID, "name": "Workout A", "order_index": 0,
                              "exercises": [slot]]] : []]
    }

    mutating func respond(_ request: URLRequest) throws -> (Int, Data) {
        guard request.url?.host == "ui-fixture.invalid" else { throw URLError(.unsupportedURL) }
        guard !scenario.isHistory else { throw URLError(.notConnectedToInternet) }
        if (scenario == .coachApproval || scenario.isActivation), request.url?.path.hasPrefix("/api/coach-requests/") == true {
            let value: [String: Any]
            if request.httpMethod == "POST" {
                value = ["allowed": true, "redirect_uri": "https://client.example/callback?code=synthetic"]
            } else {
                value = ["client_name": "Synthetic AI app", "redirect_uri": "https://client.example/callback",
                         "expires_at": Date.distantFuture.timeIntervalSince1970 * 1000]
            }
            return (200, try JSONSerialization.data(withJSONObject: value))
        }
        let path = request.url!.path
        let method = request.httpMethod ?? "GET"
        if scenario.isActivation && path != "/auth/apple" {
            guard request.value(forHTTPHeaderField: "Authorization") == "Bearer \(syntheticJWT)" else {
                throw URLError(.userAuthenticationRequired)
            }
        }
        var data = request.httpBody
        if data == nil, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 4096)
            var body = Data()
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                if count < 0 { throw URLError(.cannotDecodeContentData) }
                if count == 0 { break }
                body.append(contentsOf: bytes.prefix(count))
            }
            data = body
        }
        let body = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        revision += 1
        var response: Any
        var status = 200
        switch (method, path) {
        case ("POST", "/auth/apple"):
            signInAttempts += 1
            if ProcessInfo.processInfo.environment["TRESFORT_UI_AUTH_RETRY"] == "1", signInAttempts == 1 {
                throw URLError(.notConnectedToInternet)
            }
            response = ["jwt": syntheticJWT, "user": ["id": syntheticUserID, "display_name": "Synthetic member"]]
        case ("GET", "/api/me/training-profile"):
            response = ["profile": trainingProfile as Any? ?? NSNull(), "version": trainingProfileVersion, "updated_at": revision]
        case ("PUT", "/api/me/training-profile"):
            trainingProfile = body["profile"] as? [String: Any]
            trainingProfileVersion += 1
            response = ["profile": trainingProfile as Any? ?? NSNull(), "version": trainingProfileVersion, "updated_at": revision]
        case ("GET", "/api/starter-workouts"):
            response = ["profile_version": trainingProfileVersion, "can_accept": !starterAccepted && (plan == nil || (plan?["days"] as? [[String: Any]])?.isEmpty == true), "workouts": [[
                "id": "bodyweight-v1", "name": "Start moving", "explanation": "Consistency matters more than a perfect workout. Fit strength around your other activities.",
                "exercises": [["exercise_id": "synthetic-exercise", "name": "Bodyweight Squat", "sets": 1, "reps": 8, "cues": "Choose a comfortable range of motion."]]
            ]]]
        case ("POST", "/api/starter-workouts/bodyweight-v1"):
            if !starterAccepted {
                plan = makePlan(name: "My Training")
                var days = plan?["days"] as? [[String: Any]] ?? []
                days[0]["name"] = "Start moving"
                var slots = days[0]["exercises"] as? [[String: Any]] ?? []
                slots[0]["target_sets"] = 1; slots[0]["target_reps"] = 8; slots[0]["target_weight"] = 0
                slots[0]["exercise_name"] = "Bodyweight Squat"; slots[0]["exercise_modality"] = "bw"
                days[0]["exercises"] = slots; plan?["days"] = days
                starterAccepted = true
            }
            response = ["acknowledged": true, "plan_id": "synthetic-plan", "workout_id": dayID, "version": 1]
        case ("GET", "/api/me"):
            if ProcessInfo.processInfo.environment["TRESFORT_UI_HEALTH_PROFILE_FAIL"] == "1" {
                throw URLError(.notConnectedToInternet)
            }
            response = ["display_name": "Synthetic member", "email": NSNull(),
                "intervals": intervalsStatus,
                "claude": ["is_owner": scenario == .activationOwner, "connected": coachConnected],
                "health": ["sharing_in_group": healthSharing]]
        case ("GET", let path) where scenario == .activationManual && ["/api/me/garmin", "/api/me/whoop"].contains(path):
            // Discovery only: these fixtures never authorize a provider or
            // leave the app. The real settings screens read their own status.
            response = ["configured": true, "connected": false,
                        "needs_reauth": false, "activity_permission": false,
                        "connected_at": NSNull(), "last_synced_at": NSNull()]
        case ("PATCH", "/api/me/health-sharing"):
            healthSharing = body["enabled"] as? Bool ?? false
            response = ["sharing_in_group": healthSharing]
        case ("PATCH", "/api/me/integrations/intervals") where scenario.isIntervals:
            intervalsGeneration += 1
            intervalsConnected = body["api_key"] is String
            intervalsReauth = false
            intervalsPending = intervalsConnected && scenario == .intervalsRetry
            if intervalsConnected && !intervalsPending { importIntervalsActivity() }
            response = ["connected": intervalsConnected, "credential_generation": intervalsGeneration]
        case ("POST", "/api/me/integrations/intervals/sync") where scenario.isIntervals:
            guard body["expected_generation"] as? Int == intervalsGeneration, intervalsConnected
            else { throw URLError(.badServerResponse) }
            intervalsPending = false
            importIntervalsActivity()
            response = ["status": "synced", "connection": intervalsStatus]
        case ("POST", "/api/activities"):
            guard let id = body["id"] as? String, UUID(uuidString: id) != nil,
                  let date = body["date"] as? String, let type = body["type"] as? String,
                  let loggedAt = body["logged_at"] as? Int else { throw URLError(.badServerResponse) }
            // Like the Worker, a retry returns the original row. State pulls
            // expose the accepted activity so the real history refresh runs.
            if let existing = enteredActivities.first(where: { $0["id"] as? String == id }) {
                response = existing
            } else {
                let row: [String: Any] = ["id": id, "user_id": syntheticUserID, "date": date,
                    "type": type, "title": body["title"] ?? NSNull(),
                    "duration_minutes": body["duration_minutes"] ?? NSNull(),
                    "notes": body["notes"] ?? NSNull(), "logged_at": loggedAt,
                    "source": "ios", "deleted_at": NSNull(), "updated_at": revision]
                enteredActivities.append(row)
                response = row
            }
            status = 201
        case ("POST", "/api/activities/endurance") where scenario.isIntervals && intervalsConnected:
            // Like the Worker: the run lands on intervals.icu and comes back
            // through the activity sync; a retry with the same id is a no-op.
            guard let id = body["id"] as? String, let date = body["date"] as? String,
                  let type = body["type"] as? String, let duration = body["duration_s"] as? Int
            else { throw URLError(.badServerResponse) }
            let known = importedActivities.contains { $0["id"] as? String == id }
            if !known {
                importedActivities.append(["id": id, "source": "intervals", "external_id": "manual-\(id)",
                    "date": date, "kind": type, "name": body["title"] as? String ?? type.capitalized,
                    "moving_time_sec": duration, "distance_m": body["distance_m"] ?? NSNull(),
                    "synced_at": revision, "attribution_version": 1])
            }
            status = known ? 200 : 201
            response = ["ok": true, "destination": "intervals.icu", "deduplicated": known, "activity_id": id]
        case ("POST", "/api/me/mcp-passphrase"):
            response = ["code": String(repeating: "C", count: 43),
                        "expires_at": Date().timeIntervalSince1970 * 1000 + 600_000]
        case ("GET", "/api/me/coach-grants"):
            // Claude "connects" once setup has handed it a connect link.
            response = ["grants": UIFixtureCoachLink.opened
                ? [["id": "synthetic-grant", "client_id": "synthetic-claude", "scope": "mcp",
                    "created_at": Date().timeIntervalSince1970 * 1000, "last_refreshed_at": NSNull(), "legacy": false]]
                : [[String: Any]]()]
        case ("POST", "/auth/logout"):
            response = ["ok": true]
        case ("GET", "/api/me/group-safety"):
            response = ["blocks": safetyBlocked ? [["user_id": safetyPeerID, "created_at": revision]] : [],
                "restriction": NSNull(), "can_moderate": true]
        case ("PUT", "/api/me/group-blocks/\(safetyPeerID)"):
            safetyBlocked = body["active"] as? Bool ?? false
            response = ["ok": true]
        case ("PUT", "/api/group-safety/restrictions/\(safetyPeerID)"):
            safetyRestricted = body["active"] as? Bool ?? false
            response = ["ok": true]
        case ("GET", "/api/groups"):
            response = ["groups": joined ? [syntheticGroup] : []]
        case ("GET", "/api/groups/invite/ABC234"):
            inviteAttempts += 1
            if ProcessInfo.processInfo.environment["TRESFORT_UI_INVITE_RETRY"] == "1", inviteAttempts == 1 {
                throw URLError(.notConnectedToInternet)
            }
            response = ["status": "valid", "group_name": "Synthetic Crew"]
        case ("POST", "/api/groups/join"):
            guard body["code"] as? String == "ABC234" else { throw URLError(.badServerResponse) }
            joined = true
            response = ["ok": true, "group": syntheticGroup]
        case ("GET", "/api/groups/synthetic-group"):
            response = syntheticGroup
        case ("GET", "/api/groups/synthetic-group/feed"):
            let items: [[String: Any]] = scenario == .groupSafety && !safetyBlocked && !safetyRestricted
                ? [["type": "activity", "id": "synthetic-shared-walk", "user_id": safetyPeerID,
                    "user_display_name": "Sample member", "is_me": false, "date": "2026-09-08", "occurred_at": revision,
                    "activity": ["kind": "walk", "title": "Evening walk", "duration_min": 20, "notes": "A gentle loop"]]] : []
            response = ["group_id": "synthetic-group", "items": items, "next_since": NSNull(), "server_time": revision]
        case ("GET", "/api/groups/synthetic-group/stats"):
            response = ["group_id": "synthetic-group", "range": "week", "members": []]
        case ("GET", "/api/groups/synthetic-group/activity"):
            response = ["group_id": "synthetic-group", "days": 371, "server_time": revision, "members": []]
        case ("GET", "/api/state"):
            stateAttempts += 1
            if failCreatedWorkoutRefresh {
                failCreatedWorkoutRefresh = false
                throw URLError(.notConnectedToInternet)
            }
            if [.loadFailure, .cachedEmpty, .cachedPlan].contains(scenario) { throw URLError(.notConnectedToInternet) }
            if [.serverFailure, .activationReturningRetry].contains(scenario) && stateAttempts == 1 {
                status = 500; response = ["error": "synthetic_server_failure"]; break
            }
            if scenario == .groups {
                guard request.value(forHTTPHeaderField: "X-TresFort-Capabilities")?
                    .split(separator: ",").contains(where: { $0.trimmingCharacters(in: .whitespaces) == "groups" }) == true
                else { throw URLError(.badServerResponse) }
            }
            response = ["plan": plan as Any? ?? NSNull(), "plan_version": plan?["version"] ?? 0,
                "sessions": sessions, "sets": sets, "server_time": revision, "plan_groups_version": 1,
                "activities": loggedActivities, "external_events": [], "external_activities": importedActivities]
        case ("GET", "/api/plan/history"):
            let version = plan?["version"] as? Int ?? 1
            var items: [[String: Any]] = []
            if scenario == .planChanges {
                items = [
                    ["version": 3, "actor": "ios", "operation": "update_exercise", "reason": "Prefer five reps",
                     "created_at": 1_788_883_200_000, "previous_version": 2, "affected": ["Workout A · Barbell Squat"]],
                    ["version": 2, "actor": "mcp", "operation": "update_exercise", "reason": "Reduced load after your feedback",
                     "created_at": 1_788_879_600_000, "previous_version": 1, "affected": ["Workout A · Barbell Squat"]],
                    ["version": 1, "actor": "ios", "operation": "create_plan", "created_at": 1_788_793_200_000],
                ]
                if planRestored {
                    items.insert(["version": 4, "actor": "ios", "operation": "restore_plan", "reason": "Restored from Workout history",
                                  "created_at": 1_788_886_800_000, "previous_version": 3, "affected": ["Workout A · Barbell Squat"]], at: 0)
                }
            }
            response = ["plan_id": "synthetic-plan", "current_version": version, "items": items]
        case ("GET", let path) where path.hasPrefix("/api/plan/history/") && path.hasSuffix("/compare") && scenario == .planChanges:
            let from = Int(path.split(separator: "/")[3])!
            let to = plan?["version"] as? Int ?? 3
            response = ["plan_id": "synthetic-plan", "from_version": from, "to_version": to,
                "changes": from == to ? [] : [["kind": "exercise", "path": "Workout A · Barbell Squat", "before": "65 lb", "after": "45 lb"]],
                "summary": ["plan_fields": 0, "schedule_days": 0, "days_added": 0, "days_removed": 0,
                            "days_changed": 0, "exercises_added": 0, "exercises_removed": 0, "exercises_changed": 1]]
        case ("POST", "/api/plan/history/1/restore") where scenario == .planChanges:
            guard body["expected_plan_id"] as? String == "synthetic-plan", body["expected_version"] as? Int == 3 else {
                throw URLError(.badServerResponse)
            }
            planRestored = true
            plan?["version"] = 4
            response = ["ok": true, "plan_id": "synthetic-plan", "restored_from_version": 1, "version": 4]
        case ("GET", "/api/exercises") where scenario == .groups:
            response = (groupFixture["slots"] as! [[String: Any]]).map { slot in
                ["id": slot["exercise_id"]!, "name": slot["exercise_name"]!,
                 "modality": slot["exercise_modality"]!, "unit": "lb", "primary_muscle": "full body"]
            }
        case ("GET", "/api/exercises") where scenario == .workoutSwap || scenario == .freestyle
            || (scenario == .ordinary && ProcessInfo.processInfo.environment["TRESFORT_UI_SESSION_CONTROLS"] == "1"):
            response = [["id": "synthetic-exercise", "name": "Barbell Squat", "modality": "barbell", "unit": "lb", "primary_muscle": "legs"],
                        ["id": "synthetic-replacement", "name": "Dumbbell Goblet Squat", "modality": "dumbbell", "unit": "lb", "primary_muscle": "legs", "aliases": "[\"front loaded squat\"]"],
                        ["id": "synthetic-upper", "name": "Arnold Press", "modality": "dumbbell", "unit": "lb", "primary_muscle": "shoulders", "aliases": "[\"rotating press\"]"],
                        ["id": "synthetic-hold", "name": "Goblet Hold", "modality": "timed", "unit": "lb", "primary_muscle": "legs", "aliases": "[\"front loaded hold\"]"],
                        ["id": "synthetic-cardio", "name": "Bike", "modality": "cardio", "unit": "lb", "primary_muscle": "legs"]]
        case ("GET", "/api/exercises"):
            if scenario == .historyReview { response = HistoryReviewFixtureData.catalog; break }
            if let fixture = workoutSummaryFixture { response = fixture["catalog"]!; break }
            if let fixture = coachingFixture { response = fixture["catalog"]!; break }
            if scenario == .appStore || scenario == .progress {
                var catalog = AppStoreScreenshotData.catalog
                if ProcessInfo.processInfo.environment["TRESFORT_UI_PRESCRIPTION_REVIEW"] != nil {
                    catalog.append(["id": "review-dumbbell", "name": "Dumbbell Bench Press", "modality": "dumbbell",
                        "primary_muscle": "chest", "unit": "lb", "load_mode": "per_hand", "laterality": "bilateral"])
                }
                response = catalog; break
            }
            if scenario == .activationManual { response = creationCatalog; break }
            response = [["id": "synthetic-exercise",
                "name": scenario == .bodyweight ? "Pull-Up" : scenario == .timed ? "Plank" : "Barbell Squat",
                "modality": scenario == .bodyweight ? "bw" : scenario == .timed ? "timed" : "barbell",
                "unit": "lb", "primary_muscle": "legs"]]
            if scenario.isUnilateral {
                response = [["id": "synthetic-exercise", "name": scenario.unilateralName,
                    "modality": "dumbbell", "unit": "lb", "primary_muscle": "upper body",
                    "laterality": "unilateral", "load_mode": "total"]]
            }
            if scenario == .library && ProcessInfo.processInfo.environment["TRESFORT_UI_LIFTING_CREATION"] == "1" {
                response = (response as! [[String: Any]]) + liftingCreationCatalog
            }
            if scenario == .empty || scenario == .library {
                response = (response as! [[String: Any]]) + [
                    ["id": "synthetic-upper", "name": "Bench Press", "modality": "barbell", "unit": "lb", "primary_muscle": "chest", "aliases": "[\"bench\",\"bp\"]"],
                    ["id": "synthetic-core", "name": "Plank", "modality": "timed", "unit": "lb", "primary_muscle": "core"]]
            }
        case ("PUT", "/api/plan/active"):
            let ensureFailure = ProcessInfo.processInfo.environment["TRESFORT_UI_ENSURE_FAILURE"]
            if ensureFailure == "request", !failedEnsureRequest {
                failedEnsureRequest = true
                status = 503; response = ["error": "Synthetic ensure failure"]; break
            }
            plan = makePlan(name: body["name"] as? String ?? "My Training", workouts: false)
            failCreatedWorkoutRefresh = ensureFailure == "refresh"
            response = ["plan": ["id": "synthetic-plan", "name": plan!["name"]!, "version": 1], "created": true]
        case ("PUT", "/api/plan/program") where scenario == .appStore:
            let version = plan?["version"] as? Int ?? 1
            if ProcessInfo.processInfo.environment["TRESFORT_UI_PROGRAM_CONFLICT"] == "1", !returnedProgramConflict {
                returnedProgramConflict = true
                plan?["version"] = version + 1
                status = 409; response = ["conflict": true, "current_version": version + 1]; break
            }
            guard body["expected_version"] as? Int == version,
                  var program = body["program"] as? [String: Any], program["weeks"] is [[String: Any]] else {
                status = 409; response = ["conflict": true, "current_version": version]; break
            }
            var meta = (plan?["meta"] as? String)
                .flatMap { $0.data(using: .utf8) }
                .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            program["id"] = (meta["program"] as? [String: Any])?["id"] ?? "synthetic-block"
            meta["program"] = program
            plan?["meta"] = String(data: try JSONSerialization.data(withJSONObject: meta), encoding: .utf8)
            plan?["version"] = version + 1
            response = ["ok": true, "version": version + 1]
        case ("PUT", "/api/plan/schedule") where [.library, .appStore, .onboarding, .activationManual].contains(scenario):
            let currentVersion = plan?["version"] as? Int ?? 1
            scheduleAttempts += 1
            let failureAt = ProcessInfo.processInfo.environment["TRESFORT_UI_SCHEDULE_FAILURE_AT"].flatMap(Int.init) ?? 1
            if let failure = ProcessInfo.processInfo.environment["TRESFORT_UI_SCHEDULE_FAILURE"],
               scheduleAttempts == failureAt, !returnedScheduleFailure {
                returnedScheduleFailure = true
                if failure == "conflict" {
                    plan?["version"] = currentVersion + 1
                    status = 409; response = ["error": "Synthetic schedule conflict", "current_version": currentVersion + 1]
                } else {
                    status = 503; response = ["error": "Synthetic schedule save failed"]
                }
                break
            }
            guard body["expected_plan_id"] as? String == plan?["id"] as? String,
                  body["expected_version"] as? Int == currentVersion else {
                status = 409; response = ["error": "Synthetic schedule conflict", "current_version": currentVersion]; break
            }
            let version = currentVersion + 1
            // Like the server: extras in the body replace the saved ones, and
            // a week-only write keeps them.
            var schedule: [String: Any] = ["version": 1, "week": body["week"] ?? [:]]
            let savedSchedule = (plan?["meta"] as? String)
                .flatMap { $0.data(using: .utf8) }
                .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                .flatMap { $0["schedule"] as? [String: Any] }
            if let extras = body["extras"] as? [String: [String]] {
                if !extras.isEmpty { schedule["extras"] = extras }
            } else if let savedExtras = savedSchedule?["extras"] {
                schedule["extras"] = savedExtras
            }
            // Times work the same way: sent replaces, omitted keeps.
            if let times = body["times"] as? [String: [String: String]] {
                if !times.isEmpty { schedule["times"] = times }
            } else if let savedTimes = savedSchedule?["times"] {
                schedule["times"] = savedTimes
            }
            plan?["meta"] = String(data: try JSONSerialization.data(withJSONObject: ["schedule": schedule]), encoding: .utf8)
            plan?["version"] = version
            response = ["ok": true, "version": version, "schedule": schedule]
        case ("PUT", let path) where path.hasPrefix("/api/calendar/"):
            let date = String(path.split(separator: "/").last!)
            let prior = sessions.first { $0["date"] as? String == date }
            guard body["expected_attempt"] as? Int == (prior?["attempt"] as? Int ?? 0) else {
                status = 409; response = ["error": "synthetic_calendar_attempt_mismatch"]; break
            }
            let workout = body["workout_id"] as? String
            let row: [String: Any] = ["id": prior?["id"] ?? "assignment-\(date)", "date": date,
                "status": workout == nil ? "skipped" : "planned",
                "workout_id": workout as Any? ?? NSNull(),
                "attempt": (prior?["attempt"] as? Int ?? 0) + 1, "updated_at": revision]
            sessions.removeAll { $0["date"] as? String == date }; sessions.append(row)
            response = ["ok": true, "session": row]
        case ("POST", "/api/calendar/2026-09-08/move") where scenario == .appStore:
            guard body["to_date"] as? String == "2026-09-09", body["today"] as? String == "2026-09-08",
                  body["workout_id"] as? String == dayID,
                  body["expected_plan_id"] as? String == "synthetic-plan",
                  body["expected_version"] as? Int == plan?["version"] as? Int,
                  body["expected_from_attempt"] as? Int == 0, body["expected_to_attempt"] as? Int == 0,
                  UUID(uuidString: body["id"] as? String ?? "") != nil else { throw URLError(.badServerResponse) }
            if ProcessInfo.processInfo.environment["TRESFORT_UI_MOVE_CONFLICT"] == "1", !returnedMoveConflict {
                returnedMoveConflict = true
                plan?["version"] = 2
                status = 409; response = ["error": "calendar_move_conflict"]; break
            }
            let from: [String: Any] = ["id": "move-from", "date": "2026-09-08", "status": "skipped", "attempt": 1, "updated_at": revision]
            let to: [String: Any] = ["id": "move-to", "date": "2026-09-09", "status": "planned", "workout_id": dayID, "attempt": 1, "updated_at": revision]
            sessions += [from, to]
            response = ["ok": true, "from": from, "to": to]
        case ("PATCH", let path) where scenario == .library && path.hasPrefix("/api/workouts/") && path.split(separator: "/").count == 3:
            guard body["expected_version"] as? Int == plan?["version"] as? Int else {
                status = 409; response = ["conflict": true]; break
            }
            let id = String(path.split(separator: "/").last!)
            var days = plan?["days"] as? [[String: Any]] ?? []
            guard let index = days.firstIndex(where: { $0["id"] as? String == id }) else { throw URLError(.badServerResponse) }
            if let tags = body["tags"] as? [String] {
                days[index]["tags"] = String(data: try JSONSerialization.data(withJSONObject: tags), encoding: .utf8)!
            }
            if let archived = body["archived_at"] {
                days[index]["archived_at"] = archived
                if !(archived is NSNull) {
                    let metaText = plan?["meta"] as? String ?? "{}"
                    var meta = try JSONSerialization.jsonObject(with: Data(metaText.utf8)) as? [String: Any] ?? [:]
                    var schedule = meta["schedule"] as? [String: Any] ?? [:]
                    var week = schedule["week"] as? [String: Any] ?? [:]
                    for key in Array(week.keys) where week[key] as? String == id { week[key] = NSNull() }
                    schedule["week"] = week; meta["schedule"] = schedule
                    plan?["meta"] = String(data: try JSONSerialization.data(withJSONObject: meta), encoding: .utf8)!
                }
            }
            plan?["days"] = days
            let nextVersion = (plan?["version"] as? Int ?? 1) + 1
            plan?["version"] = nextVersion
            response = ["id": id]
        case ("DELETE", "/api/workouts/hotel") where scenario == .library:
            let remaining = (plan?["days"] as? [[String: Any]] ?? []).filter { $0["id"] as? String != "hotel" }
            let version = (plan?["version"] as? Int ?? 1) + 1
            plan?["days"] = remaining
            plan?["version"] = version
            response = ["ok": true, "version": plan?["version"] ?? 1]
        case ("PATCH", "/api/workouts/created-workout/exercises/created-slot-0") where scenario == .appStore:
            // A run made from a weekday saves its planned steps here.
            guard body["expected_version"] as? Int == plan?["version"] as? Int else {
                status = 409; response = ["conflict": true, "current_version": plan?["version"] ?? 0]; break
            }
            guard let steps = body["run_steps"] else { throw URLError(.badServerResponse) }
            var days = plan!["days"] as! [[String: Any]]
            guard let dayIndex = days.firstIndex(where: { $0["id"] as? String == "created-workout" }) else {
                throw URLError(.badServerResponse)
            }
            var slots = days[dayIndex]["exercises"] as! [[String: Any]]
            slots[0]["run_steps"] = steps is NSNull ? NSNull()
                : String(data: try JSONSerialization.data(withJSONObject: steps), encoding: .utf8)!
            days[dayIndex]["exercises"] = slots; plan?["days"] = days
            let version = (plan?["version"] as? Int ?? 1) + 1
            plan?["version"] = version
            response = ["id": "created-slot-0"]
        case ("PATCH", "/api/workouts/\(dayID)/exercises/created-slot-0") where scenario == .activationManual:
            var days = plan!["days"] as! [[String: Any]]
            var slots = days[0]["exercises"] as! [[String: Any]]
            guard slots[0]["id"] as? String == "created-slot-0" else { throw URLError(.badServerResponse) }
            for key in ["target_sets", "target_reps", "target_weight", "rest_seconds"] {
                if let value = body[key] { slots[0][key] = value }
            }
            if let steps = body["run_steps"] {
                slots[0]["run_steps"] = steps is NSNull ? NSNull()
                    : String(data: try JSONSerialization.data(withJSONObject: steps), encoding: .utf8)!
            }
            let version = (plan?["version"] as? Int ?? 1) + 1
            days[0]["exercises"] = slots; plan?["days"] = days
            plan?["version"] = version
            response = ["id": "created-slot-0"]
        case ("POST", "/api/workouts/\(dayID)/exercises") where scenario == .activationManual:
            guard body["exercise"] as? String == "synthetic-exercise" else { throw URLError(.badServerResponse) }
            var days = plan!["days"] as! [[String: Any]]
            let source = makePlan()["days"] as! [[String: Any]]
            var slot = (source[0]["exercises"] as! [[String: Any]])[0]
            for key in ["target_sets", "target_reps", "target_weight", "rest_seconds"] {
                slot[key] = body[key] ?? slot[key]
            }
            slot["target_weight"] = body["target_weight"] ?? NSNull()
            days[0]["exercises"] = [slot]; plan?["days"] = days; plan?["version"] = 3
            response = ["id": "synthetic-slot"]
        case ("POST", "/api/workouts/prescribed"):
            guard let id = body["workout_id"] as? String, UUID(uuidString: id) != nil,
                  let name = body["name"] as? String, !name.isEmpty,
                  let slots = body["slots"] as? [[String: Any]], !slots.isEmpty,
                  body["expected_plan_id"] != nil,
                  let reviewedVersion = body["expected_version"] as? Int else {
                status = 400; response = ["error": "invalid_prescription"]; break
            }
            // This journey only acknowledges the exact reviewed prescription.
            // A UI that drops a field, reorders the wrong slot or invents a load
            // cannot reach its success assertion through this fixture.
            if ProcessInfo.processInfo.environment["TRESFORT_UI_LIFTING_CREATION"] == "1" {
                guard name == "Reviewed lift",
                      slots.compactMap({ $0["exercise_id"] as? String }) == ["synthetic-exercise", "synthetic-upper", "creation-dumbbell", "synthetic-core", "creation-pullup", "creation-bike"],
                      slots[0]["target_sets"] as? Int == 4, slots[0]["target_reps"] as? Int == 5,
                      slots[0]["rest_seconds"] as? Int == 135, slots[0]["target_weight"] as? Double == nil,
                      slots[1]["target_weight"] as? Double == nil,
                      slots[2]["target_weight"] as? Double == 22.5, slots[2]["target_weight_unit"] as? String == "kg",
                      slots[2]["target_reps_max"] as? Int == 12,
                      slots[3]["target_duration_s"] as? Int == 40,
                      slots[4]["target_weight"] as? Double == nil,
                      slots[5]["target_sets"] as? Int == 1, slots[5]["target_duration_s"] as? Int == 300,
                      slots.enumerated().allSatisfy({ $0.element["order_index"] as? Int == $0.offset }) else {
                    status = 400; response = ["error": "reviewed_targets_not_preserved"]; break
                }
            }
            let requestBytes = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
            if let saved = prescribedWorkoutReceipts[id] {
                if saved.request == requestBytes {
                    var receipt = saved.receipt
                    receipt["version"] = plan?["version"] ?? receipt["version"]
                    status = 201; response = receipt
                }
                else { status = 409; response = ["error": "idempotency_conflict"] }
                break
            }
            let creationFailure = ProcessInfo.processInfo.environment["TRESFORT_UI_CREATE_FAILURE"]
            if creationFailure == "conflict", !returnedCreationFailure {
                returnedCreationFailure = true
                if plan == nil { plan = makePlan(name: "My Training", workouts: false) }
                let conflictingVersion = (plan?["version"] as? Int ?? 0) + 1
                plan?["version"] = conflictingVersion
            }
            let matchesPlan = plan == nil
                ? body["expected_plan_id"] is NSNull && reviewedVersion == 0
                : body["expected_plan_id"] as? String == plan?["id"] as? String
                    && reviewedVersion == plan?["version"] as? Int
            guard matchesPlan else {
                status = 409; response = ["conflict": true, "current_version": plan?["version"] ?? 0]; break
            }
            let enriched: [[String: Any]] = try slots.map { slot in
                guard let slotID = slot["id"] as? String, UUID(uuidString: slotID) != nil,
                      let exerciseID = slot["exercise_id"] as? String,
                      let exercise = creationCatalog.first(where: { $0["id"] as? String == exerciseID }),
                      slot["progression"] != nil else { throw URLError(.badServerResponse) }
                var enriched = slot
                enriched["exercise_name"] = exercise["name"]
                enriched["exercise_modality"] = exercise["modality"]
                enriched["exercise_unit"] = exercise["unit"] ?? "lb"
                for field in ["laterality", "load_mode", "demo_slug"] {
                    if let value = exercise[field] { enriched["exercise_\(field)"] = value }
                }
                return enriched
            }
            if plan == nil {
                plan = makePlan(name: "My workouts", workouts: false)
                plan?["version"] = 0
            }
            var days = plan?["days"] as? [[String: Any]] ?? []
            days.append(["id": id, "name": name, "order_index": days.count, "exercises": enriched])
            let version = (plan?["version"] as? Int ?? 0) + 1
            plan?["days"] = days; plan?["version"] = version
            let receipt: [String: Any] = ["workout_id": id, "plan_id": plan!["id"]!, "version": version]
            prescribedWorkoutReceipts[id] = (requestBytes, receipt)
            if creationFailure == "lost-response", !returnedCreationFailure {
                returnedCreationFailure = true
                throw URLError(.networkConnectionLost)
            }
            failCreatedWorkoutRefresh = ProcessInfo.processInfo.environment["TRESFORT_UI_CREATE_REFRESH_FAILURE"] == "1"
            status = 201; response = receipt
        case ("POST", "/api/workouts"):
            let creationFailure = ProcessInfo.processInfo.environment["TRESFORT_UI_CREATE_FAILURE"]
            if creationFailure == "conflict", !returnedCreationFailure {
                returnedCreationFailure = true
                let changedVersion = (plan?["version"] as? Int ?? 0) + 1
                plan?["version"] = changedVersion
            }
            guard body["expected_version"] as? Int == plan?["version"] as? Int else {
                status = 409; response = ["conflict": true, "current_version": plan?["version"] ?? 0]; break
            }
            var days = plan?["days"] as? [[String: Any]] ?? []
            let id = days.isEmpty ? dayID : "created-workout"
            let selected = body["exercise_ids"] as? [String] ?? []
            let slots: [[String: Any]] = try selected.enumerated().map { index, exerciseID in
                guard let exercise = creationCatalog.first(where: { $0["id"] as? String == exerciseID }) else {
                    throw URLError(.badServerResponse)
                }
                let timed = exercise["modality"] as? String == "timed"
                return ["id": "created-slot-\(index)", "exercise_id": exerciseID,
                        "exercise_name": exercise["name"]!, "exercise_modality": exercise["modality"]!,
                        "exercise_unit": "lb", "order_index": index, "target_sets": 3,
                        "target_reps": timed ? 45 : 8, "target_duration_s": timed ? 45 : NSNull(),
                        "target_weight": 0, "rest_seconds": 120]
            }
            let day: [String: Any] = ["id": id, "name": body["name"] ?? "Workout A",
                                      "order_index": days.count, "exercises": slots]
            days.append(day)
            let version = (plan?["version"] as? Int ?? 0) + 1
            plan?["days"] = days; plan?["version"] = version
            if creationFailure == "lost-response", !returnedCreationFailure {
                returnedCreationFailure = true
                throw URLError(.networkConnectionLost)
            }
            failCreatedWorkoutRefresh = ProcessInfo.processInfo.environment["TRESFORT_UI_CREATE_REFRESH_FAILURE"] == "1"
            response = ["id": id]
        case ("PUT", "/api/workouts/\(dayID)/groups") where scenario == .groups:
            let receiptKey = String(data: try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]), encoding: .utf8)!
            if let receipt = groupReceipts[receiptKey] { response = receipt; break }
            guard let version = plan?["version"] as? Int, body["expected_version"] as? Int == version else {
                status = 409; response = ["conflict": true, "current_version": plan?["version"] ?? 0]; break
            }
            guard let groupID = body["group_id"] as? String, UUID(uuidString: groupID) != nil,
                  let ids = body["exercises"] as? [String] else { throw URLError(.badServerResponse) }
            var days = plan!["days"] as! [[String: Any]]
            var slots = days[0]["exercises"] as! [[String: Any]]
            if ProcessInfo.processInfo.environment["TRESFORT_UI_GROUP_CONFLICT"] == "1", !returnedGroupConflict {
                returnedGroupConflict = true
                for index in slots.indices where slots[index]["group_id"] as? String == groupID {
                    slots[index]["target_sets"] = 4
                }
                days[0]["exercises"] = slots; plan?["days"] = days; plan?["version"] = version + 1
                status = 409; response = ["conflict": true, "current_version": version + 1]; break
            }
            guard Set(ids).count == ids.count, ids.isEmpty || ids.count >= 2,
                  ids.allSatisfy({ id in slots.contains { slot in
                      slot["id"] as? String == id && (slot["group_id"] as? String == nil || slot["group_id"] as? String == groupID)
                  } }) else { throw URLError(.badServerResponse) }
            if !ids.isEmpty {
                guard let rounds = body["target_sets"] as? Int, rounds > 0,
                      let rest = body["round_rest"] as? Int, rest >= 0,
                      let transition = body["transition_rest"] as? Int, transition >= 0 else { throw URLError(.badServerResponse) }
            }
            let positions = slots.filter { ids.contains($0["id"] as! String) }.map { $0["order_index"] as! Int }.sorted()
            for index in slots.indices {
                if let memberIndex = ids.firstIndex(of: slots[index]["id"] as! String) {
                    slots[index]["group_id"] = groupID
                    slots[index]["group_rest_seconds"] = body["round_rest"]!
                    slots[index]["group_transition_seconds"] = body["transition_rest"]!
                    slots[index]["target_sets"] = body["target_sets"]!
                    slots[index]["order_index"] = positions[memberIndex]
                } else if slots[index]["group_id"] as? String == groupID {
                    slots[index]["group_id"] = NSNull()
                    slots[index]["group_rest_seconds"] = NSNull()
                    slots[index]["group_transition_seconds"] = NSNull()
                }
            }
            if let destination = body["order_index"] as? Int, !ids.isEmpty {
                let others = slots.filter { !ids.contains($0["id"] as! String) }
                let selected = ids.map { id in slots.first { $0["id"] as? String == id }! }
                let destination = min(max(0, destination), others.count)
                slots = Array(others.prefix(destination)) + selected + Array(others.dropFirst(destination))
                for index in slots.indices { slots[index]["order_index"] = index }
            } else {
                slots.sort { ($0["order_index"] as! Int) < ($1["order_index"] as! Int) }
            }
            days[0]["exercises"] = slots; plan?["days"] = days; plan?["version"] = version + 1
            let ack: [String: Any] = ["ok": true, "plan_id": "synthetic-plan", "version": version + 1,
                "group_id": groupID, "day_id": dayID, "members": ids,
                "round_rest": body["round_rest"] ?? NSNull(), "transition_rest": body["transition_rest"] ?? NSNull(),
                "target_sets": body["target_sets"] ?? NSNull(), "cleared": ids.isEmpty]
            groupReceipts[receiptKey] = ack
            response = ack
        case ("POST", "/api/sessions") where body["additional"] as? Bool == true:
            guard let id = body["id"] as? String, let date = body["date"] as? String else { throw URLError(.badServerResponse) }
            if let existing = sessions.first(where: { $0["id"] as? String == id }) { response = existing; break }
            let slot = (sessions.filter { $0["date"] as? String == date }.map { $0["slot"] as? Int ?? 0 }.max() ?? 0) + 1
            var row = makeSession(status: body["kind"] as? String == "freestyle" ? "in_progress" : "planned", attempt: 0)
            row["id"] = id; row["date"] = date; row["slot"] = slot
            row["workout_id"] = body["workout_id"] ?? NSNull(); row["kind"] = body["kind"] ?? "planned"
            sessions.append(row); response = row
        case ("POST", "/api/sessions") where scenario == .freestyle:
            if sessions.isEmpty {
                guard body["kind"] as? String == "freestyle" else { throw URLError(.badServerResponse) }
                var session = makeSession(attempt: 0)
                session["kind"] = "freestyle"; session["workout_id"] = NSNull()
                sessions = [session]
            }
            response = sessions[0]
        case ("GET", "/api/sessions/\(sessionID)/workout-draft") where scenario == .freestyle:
            let live = sets.filter { $0["is_warmup"] as? Int == 0 }
            var slots: [[String:Any]] = []
            for set in live {
                if let index = slots.firstIndex(where: { $0["exercise_id"] as? String == set["exercise_id"] as? String }) {
                    slots[index]["target_sets"] = (slots[index]["target_sets"] as! Int) + 1
                } else {
                    slots.append(["exercise_id":set["exercise_id"]!,"target_sets":1,"target_reps":set["reps"]!,
                        "target_weight":set["weight"]!,"target_duration_s":set["duration_s"] ?? NSNull(),
                        "rest_seconds":120,"source_set_ids":[set["id"]!]])
                }
            }
            response = ["session":sessions[0],"source_signature":"synthetic-source","slots":slots]
        case ("POST", "/api/sessions/\(sessionID)/save-workout") where scenario == .freestyle:
            guard sessions[0]["status"] as? String == "completed",
                  body["source_signature"] as? String == "synthetic-source" else { throw URLError(.badServerResponse) }
            let id = body["workout_id"] as! String
            var days = plan!["days"] as! [[String:Any]]
            let slots = (body["slots"] as! [[String:Any]]).enumerated().map { index, slot -> [String:Any] in
                var row = slot
                row["id"] = "saved-\(index)"; row["order_index"] = index
                row["exercise_name"] = "Barbell Squat"; row["exercise_unit"] = "lb"
                row["exercise_modality"] = "barbell"
                return row
            }
            days.append(["id":id,"name":body["name"]!,"order_index":days.count,"exercises":slots])
            let nextVersion = (plan?["version"] as? Int ?? 1) + 1
            plan?["days"] = days; plan?["version"] = nextVersion
            sessions[0]["workout_id"] = id; sessions[0]["attempt"] = 1; sessions[0]["updated_at"] = revision
            response = ["workout_id":id,"plan_id":"synthetic-plan","version":plan!["version"]!,"session":sessions[0]]
        case ("POST", "/api/sessions") where scenario == .appStore:
            // The screenshot fixture includes earlier sessions. Starting today
            // must bind today's session, never the first historical record.
            if let existing = sessions.first(where: { $0["date"] as? String == body["date"] as? String }) {
                response = existing
            } else {
                guard body["expected_attempt"] as? Int == 0 else { throw URLError(.badServerResponse) }
                let session = makeSession(attempt: 0)
                sessions.append(session)
                response = session
            }
        case ("POST", "/api/sessions"):
            if sessions.isEmpty {
                guard body["expected_attempt"] as? Int == 0 else { throw URLError(.badServerResponse) }
                var session = makeSession(attempt: 0)
                if let workoutID = body["workout_id"] as? String { session["workout_id"] = workoutID }
                sessions = [session]
            }
            response = sessions[0]
        case ("POST", "/api/sessions/\(sessionID)/exercises/synthetic-slot/swap") where scenario == .workoutSwap:
            guard body["to_exercise"] as? String == "synthetic-replacement",
                  body["expected_attempt"] as? Int == sessions[0]["attempt"] as? Int,
                  body["expected_version"] as? Int == 1,
                  body["expected_revision"] as? Int == 0 else { throw URLError(.badServerResponse) }
            let original = (plan!["days"] as! [[String: Any]])[0]["exercises"] as! [[String: Any]]
            var replacement = original[0]
            replacement["exercise_id"] = "synthetic-replacement"
            replacement["exercise_name"] = "Dumbbell Goblet Squat"
            replacement["exercise_modality"] = "dumbbell"
            replacement["target_weight"] = NSNull()
            let envelope: [String: Any] = ["attempt": sessions[0]["attempt"]!, "revision": 1,
                "entries": [["original": original[0], "replacement": replacement,
                             "exercise_ids": ["synthetic-exercise", "synthetic-replacement"]]]]
            sessions[0]["exercise_swaps"] = String(decoding: try JSONSerialization.data(withJSONObject: envelope), as: UTF8.self)
            sessions[0]["updated_at"] = revision
            response = sessions[0]
        case ("POST", let path) where path.hasPrefix("/api/sessions/") && path.hasSuffix("/sets"):
            let sessionID = String(path.split(separator: "/")[2])

            if scenario == .pending { throw URLError(.notConnectedToInternet) }
            if scenario == .groups, !sets.contains(where: { $0["id"] as? String == body["id"] as? String }) {
                let indices = groupFixture["execution_indices"] as! [Int]
                let slots = groupFixture["slots"] as! [[String: Any]]
                guard sets.count < indices.count,
                      body["template_exercise_id"] as? String == slots[indices[sets.count]]["id"] as? String else {
                    // A wrong member is observable as a failed set; never bless a
                    // sequential runner just because it eventually logs eight sets.
                    status = 422; response = ["error": "Synthetic member sequence mismatch"]; break
                }
            }
            if scenario == .freestyle {
                guard body["template_exercise_id"] == nil && body["prescription"] == nil else { throw URLError(.badServerResponse) }
            }
            var set = body
            set["is_warmup"] = (body["is_warmup"] as? Bool == true) ? 1 : 0
            set["is_timed"] = (body["is_timed"] as? Bool == true) ? 1 : 0
            set["session_id"] = sessionID; set["updated_at"] = revision
            set["logged_at"] = revision
            sets.removeAll { ($0["id"] as? String) == (set["id"] as? String) }
            sets.append(set)
            var current = sessions.first(where: { $0["id"] as? String == sessionID }) ?? makeSession(attempt: 0)
            current["status"] = "in_progress"; current["updated_at"] = revision
            if scenario == .freestyle { current["kind"] = "freestyle"; current["workout_id"] = NSNull() }
            current["exercise_swaps"] = sessions.first { $0["id"] as? String == sessionID }?["exercise_swaps"]
            sessions.removeAll { $0["id"] as? String == sessionID }
            sessions.append(current)
            response = ["set": set, "session": current, "deduped": false]
        case ("DELETE", let path) where scenario == .appStore && path.hasPrefix("/api/workouts/\(dayID)/exercises/"):
            let slotID = String(path.split(separator: "/").last ?? "")
            var days = plan!["days"] as! [[String: Any]]
            let index = days.firstIndex { $0["id"] as? String == dayID }!
            var slots = days[index]["exercises"] as! [[String: Any]]
            guard slots.contains(where: { $0["id"] as? String == slotID }) else { throw URLError(.badServerResponse) }
            slots.removeAll { $0["id"] as? String == slotID }
            days[index]["exercises"] = slots
            plan?["days"] = days
            let version = (plan?["version"] as? Int ?? 1) + 1
            plan?["version"] = version
            response = ["id": slotID]
        case ("PATCH", let path) where scenario == .groups && path.hasPrefix("/api/workouts/\(dayID)/exercises/"):
            guard let version = plan?["version"] as? Int, body["expected_version"] as? Int == version else {
                status = 409; response = ["conflict": true, "current_version": plan?["version"] ?? 0]; break
            }
            let slotID = String(path.split(separator: "/").last ?? "")
            var days = plan!["days"] as! [[String: Any]]
            var slots = days[0]["exercises"] as! [[String: Any]]
            guard let index = slots.firstIndex(where: { $0["id"] as? String == slotID }) else { throw URLError(.badServerResponse) }
            let allowed: Set<String> = ["expected_version", "target_sets", "target_reps", "target_reps_max", "target_weight",
                "target_weight_unit", "target_rpe", "rest_seconds", "target_duration_s", "cues", "is_warmup"]
            guard Set(body.keys).isSubset(of: allowed) else { throw URLError(.badServerResponse) }
            if slots[index]["group_id"] is String {
                guard body["rest_seconds"] == nil, body["target_sets"] == nil else { throw URLError(.badServerResponse) }
            } else {
                guard let rest = body["rest_seconds"] as? Int, rest >= 0,
                      rest <= 3600 || rest == slots[index]["rest_seconds"] as? Int else { throw URLError(.badServerResponse) }
            }
            for (key, value) in body where key != "expected_version" { slots[index][key] = value }
            if let warmup = body["is_warmup"] as? Bool { slots[index]["is_warmup"] = warmup ? 1 : 0 }
            days[0]["exercises"] = slots
            plan?["days"] = days
            plan?["version"] = version + 1
            response = ["id": slotID]
        case ("POST", let path) where scenario == .appStore && path.hasSuffix("/swap")
            && path.hasPrefix("/api/workouts/") && ProcessInfo.processInfo.environment["TRESFORT_UI_PRESCRIPTION_REVIEW"] != nil:
            let slotID = String(path.split(separator: "/").dropLast().last ?? "")
            var days = plan!["days"] as! [[String: Any]]
            let index = days.firstIndex { $0["id"] as? String == dayID }!
            var slots = days[index]["exercises"] as! [[String: Any]]
            let version = plan?["version"] as? Int ?? 1
            guard let i = slots.firstIndex(where: { $0["id"] as? String == slotID }),
                  body["to_exercise"] as? String == "review-dumbbell",
                  let targets = body["targets"] as? [String: Any],
                  body["expected_version"] as? Int == version else { throw URLError(.badServerResponse) }
            slots[i]["exercise_id"] = "review-dumbbell"
            slots[i]["exercise_name"] = "Dumbbell Bench Press"
            slots[i]["exercise_modality"] = "dumbbell"
            slots[i]["exercise_load_mode"] = "per_hand"
            for (key, value) in targets { slots[i][key] = value }
            days[index]["exercises"] = slots; plan?["days"] = days; plan?["version"] = version + 1
            response = ["id": slotID]
        case ("PATCH", let path) where scenario == .appStore && path.hasPrefix("/api/workouts/\(dayID)/exercises/")
            && ProcessInfo.processInfo.environment["TRESFORT_UI_PRESCRIPTION_REVIEW"] != nil:
            let slotID = String(path.split(separator: "/").last ?? "")
            var days = plan!["days"] as! [[String: Any]]
            let index = days.firstIndex { $0["id"] as? String == dayID }!
            var slots = days[index]["exercises"] as! [[String: Any]]
            let i = slots.firstIndex { $0["id"] as? String == slotID }!
            let version = plan?["version"] as? Int ?? 1
            if ProcessInfo.processInfo.environment["TRESFORT_UI_PRESCRIPTION_REVIEW"] == "conflict", version == 1 {
                slots[i]["target_weight"] = 140
                slots[i]["target_rpe"] = 9
                slots[i]["is_warmup"] = 1
                days[index]["exercises"] = slots; plan?["days"] = days; plan?["version"] = version + 1
                status = 409; response = ["conflict": true, "current_version": version + 1]; break
            }
            guard body["expected_version"] as? Int == version else {
                status = 409; response = ["conflict": true, "current_version": version]; break
            }
            for (key, value) in body where key != "expected_version" { slots[i][key] = value }
            if let warmup = body["is_warmup"] as? Bool { slots[i]["is_warmup"] = warmup ? 1 : 0 }
            days[index]["exercises"] = slots; plan?["days"] = days; plan?["version"] = version + 1
            response = ["id": slotID]
        case ("PATCH", let path) where scenario == .appStore && path.hasPrefix("/api/workouts/\(dayID)/exercises/"):
            let slotID = String(path.split(separator: "/").last ?? "")
            var days = plan!["days"] as! [[String: Any]]
            let dayIndex = days.firstIndex { $0["id"] as? String == dayID }!
            var slots = days[dayIndex]["exercises"] as! [[String: Any]]
            guard let from = slots.firstIndex(where: { $0["id"] as? String == slotID }),
                  let to = body["order_index"] as? Int, slots.indices.contains(to) else { throw URLError(.badServerResponse) }
            let slot = slots.remove(at: from)
            slots.insert(slot, at: to)
            for index in slots.indices { slots[index]["order_index"] = index }
            days[dayIndex]["exercises"] = slots
            plan?["days"] = days
            let version = (plan?["version"] as? Int ?? 1) + 1
            plan?["version"] = version
            response = ["id": slotID]
        case ("PATCH", let path) where scenario == .historyReview && path.hasPrefix("/api/sets/"):
            let id = String(path.split(separator: "/").last ?? "")
            guard let index = sets.firstIndex(where: { $0["id"] as? String == id }),
                  let sessionID = sets[index]["session_id"] as? String,
                  let session = sessions.first(where: { $0["id"] as? String == sessionID }),
                  body["expected_session_id"] as? String == sessionID,
                  body["expected_attempt"] as? Int == session["attempt"] as? Int,
                  body["expected_updated_at"] as? Int == sets[index]["updated_at"] as? Int else {
                status = 409; response = ["error": "Synthetic exact-set conflict"]; break
            }
            for key in ["weight", "reps", "rpe", "duration_s"] where body.keys.contains(key) { sets[index][key] = body[key] }
            if body["deleted"] as? Bool == true { sets[index]["deleted_at"] = revision }
            sets[index]["updated_at"] = revision
            var corrected = sets[index]
            corrected["session"] = session
            response = corrected
        case ("PATCH", let path) where scenario == .appStore && path.hasPrefix("/api/sets/")
            && ProcessInfo.processInfo.environment["TRESFORT_UI_ACCEPT_CORRECTIONS"] == "1":
            let setID = String(path.split(separator: "/").last ?? "")
            guard let index = sets.firstIndex(where: { $0["id"] as? String == setID }),
                  sets[index]["session_id"] as? String == sessionID else { throw URLError(.badServerResponse) }
            for key in ["weight", "reps", "rpe", "duration_s"] where body.keys.contains(key) {
                sets[index][key] = body[key]
            }
            if body["deleted"] as? Bool == true { sets[index]["deleted_at"] = revision }
            sets[index]["updated_at"] = revision
            var corrected = sets[index]
            corrected["session"] = sessions.first { $0["id"] as? String == sessionID }
            response = corrected
        case ("PATCH", "/api/sets/synthetic-set") where scenario == .readyToFinish && body["deleted"] as? Bool == true:
            guard let index = sets.firstIndex(where: { $0["id"] as? String == "synthetic-set" }) else { throw URLError(.badServerResponse) }
            sets[index]["deleted_at"] = revision
            sets[index]["updated_at"] = revision
            var corrected = sets[index]
            corrected["session"] = sessions[0]
            response = corrected
        case ("PATCH", "/api/sets/synthetic-set"):
            status = 422; response = ["error": "Synthetic correction rejected"]
        case ("PATCH", let path) where path.hasPrefix("/api/sessions/") && path.hasSuffix("/feedback"):
            let sessionID = String(path.split(separator: "/")[2])
            guard Set(body.keys) == Set(["expected_attempt", "notes", "perceived_fatigue", "expected_feedback"]),
                  let expectedAttempt = body["expected_attempt"] as? Int,
                  let expected = body["expected_feedback"] as? [String: Any],
                  let index = sessions.firstIndex(where: { $0["id"] as? String == sessionID }) else {
                status = 400; response = ["error": "invalid_feedback_request"]; break
            }
            let current = sessions[index]
            guard current["status"] as? String == "completed",
                  (current["attempt"] as? Int ?? 0) == expectedAttempt else {
                status = 409; response = ["error": "session_state_conflict", "current_session": current]; break
            }
            // One competing write per distinct submitted proposal exercises
            // both explicit conflict choices without repeatedly conflicting
            // the same reviewed retry.
            if ProcessInfo.processInfo.environment["TRESFORT_UI_COMPLETED_FEEDBACK_CONFLICT"] == "1",
               let proposal = body["notes"] as? String,
               ["Reviewed version", "Discard this replacement"].contains(proposal),
               completedFeedbackConflictedProposals.insert(proposal).inserted {
                let first = completedFeedbackConflictedProposals.count == 1
                sessions[index]["notes"] = first ? "Competing saved note" : "Another saved note"
                sessions[index]["perceived_fatigue"] = first ? 8 : 5
                sessions[index]["updated_at"] = revision
                status = 409
                response = ["error": "session_feedback_conflict", "current_session": sessions[index]]
                break
            }
            let same: ([String: Any], [String: Any]) -> Bool = { lhs, rhs in
                lhs["notes"] as? String == rhs["notes"] as? String
                    && lhs["perceived_fatigue"] as? Int == rhs["perceived_fatigue"] as? Int
            }
            guard same(current, expected) || same(current, body) else {
                status = 409; response = ["error": "session_feedback_conflict", "current_session": current]; break
            }
            if let fatigue = body["perceived_fatigue"] as? Int, !(1...10).contains(fatigue) {
                status = 400; response = ["error": "invalid_feedback_fatigue"]; break
            }
            sessions[index]["notes"] = body["notes"] ?? NSNull()
            sessions[index]["perceived_fatigue"] = body["perceived_fatigue"] ?? NSNull()
            sessions[index]["updated_at"] = revision
            response = sessions[index]
        case ("PATCH", let path) where path.hasPrefix("/api/sessions/") && path.split(separator: "/").count == 3:
            let sessionID = String(path.split(separator: "/")[2])
            if ProcessInfo.processInfo.environment["TRESFORT_UI_FINISH_FAILURE"] == "1",
               body["status"] as? String == "completed" {
                status = 503; response = ["error": "Synthetic finish failure"]; break
            }
            if ProcessInfo.processInfo.environment["TRESFORT_UI_FEEDBACK_CONFLICT"] == "1", !returnedFeedbackConflict {
                returnedFeedbackConflict = true
                sessions[0]["notes"] = "Newer saved feedback"
                sessions[0]["perceived_fatigue"] = 8
                sessions[0]["updated_at"] = revision
                status = 409
                response = ["error": "session_feedback_conflict", "current_session": sessions[0]]
                break
            }
            let current = sessions.first { $0["id"] as? String == sessionID }
            var completed = current ?? makeSession(status: "completed", attempt: 0)
            completed["status"] = body["status"] ?? "completed"; completed["updated_at"] = revision
            if scenario == .freestyle { completed["kind"] = "freestyle"; completed["workout_id"] = NSNull() }
            completed["notes"] = body["notes"] ?? current?["notes"]
            completed["perceived_fatigue"] = body["perceived_fatigue"] ?? current?["perceived_fatigue"]
            sessions.removeAll { $0["id"] as? String == sessionID }
            sessions.append(completed)
            response = completed
        case ("GET", let path) where path.hasPrefix("/api/sessions/") && path.hasSuffix("/summary"):
            let sessionID = String(path.split(separator: "/")[2])
            if let fixture = workoutSummaryFixture { response = fixture["summary"]!; break }
            let workingSets = sets.filter { $0["is_warmup"] as? Int == 0 && $0["session_id"] as? String == sessionID && $0["deleted_at"] == nil }
            let totalReps = workingSets.reduce(0) { $0 + ($1["reps"] as? Int ?? 0) }
            let externalVolume = workingSets.reduce(0.0) {
                $0 + ($1["weight"] as? Double ?? 0) * Double($1["reps"] as? Int ?? 0)
            }
            let current = sessions.first { $0["id"] as? String == sessionID }
            response = ["version": 1, "session_id": sessionID, "date": "2026-09-08", "attempt": current?["attempt"] ?? 0,
                "final": current?["status"] as? String == "completed", "working_sets": workingSets.count,
                "total_reps": totalReps, "external_load_volume": externalVolume,
                "cohorts": [], "records": [], "targets_available": false, "targets": []]
        default:
            // Unsupported UI interactions are visible failures, never passthrough.
            status = 501; response = ["error": "No synthetic response for \(method) \(path)"]
        }
        return (status, try JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]))
    }
}
/// Exercises the real editor lifecycle without microphone, provider, or network access.
@MainActor
final class SyntheticFeedbackTranscriber: WorkoutFeedbackTranscribing {
    private var callback: (@MainActor (WorkoutFeedbackTranscription) -> Void)?
    func start(result: @escaping @MainActor (WorkoutFeedbackTranscription) -> Void) async throws {
        callback = result
        switch ProcessInfo.processInfo.environment["TRESFORT_FEEDBACK_SPEECH"] {
        case "denied": throw FeedbackRecordingError.denied
        case "unavailable": throw FeedbackRecordingError.unavailable
        case "empty": result(.transcript(""))
        default: result(.transcript(ProcessInfo.processInfo.environment["TRESFORT_FEEDBACK_TRANSCRIPT"] ?? "Left shoulder felt fine overhead."))
        }
    }
    func finish() { callback?(.finished); callback = nil }
    func stop() { callback = nil }
}
#endif
