import SwiftUI
import UserNotifications

/// Device permission is independent of the account's saved schedule and daily
/// reminder preferences. This model never writes either one.
@MainActor
final class ScheduleReminderPermissionModel: ObservableObject {
    enum State: Equatable {
        case checking, notRequested, allowed, quiet, denied, failed

        static func read(_ status: UNAuthorizationStatus) -> Self {
            switch status {
            case .notDetermined: return .notRequested
            case .authorized, .ephemeral: return .allowed
            case .provisional: return .quiet
            case .denied: return .denied
            @unknown default: return .failed
            }
        }
    }

    @Published private(set) var state: State = .checking
    @Published private(set) var requesting = false
    private var generation = 0
    private let readStatus: @MainActor () async -> UNAuthorizationStatus
    private let requestPermission: @MainActor () async -> Bool
    private let didChange: @MainActor () -> Void

    init(readStatus: @escaping @MainActor () async -> UNAuthorizationStatus = {
        await WorkoutReminderCoordinator.shared.authorizationStatus()
    }, requestPermission: @escaping @MainActor () async -> Bool = {
        await WorkoutReminderCoordinator.shared.requestAuthorization()
    }, didChange: @escaping @MainActor () -> Void = {
        NotificationCenter.default.post(name: WorkoutReminderSettings.changed, object: nil)
    }) {
        self.readStatus = readStatus
        self.requestPermission = requestPermission
        self.didChange = didChange
    }

    func refresh() async {
        guard !requesting else { return }
        generation += 1
        let ticket = generation
        let status = await readStatus()
        guard ticket == generation, !Task.isCancelled else { return }
        state = .read(status)
    }

    func enable() async {
        guard !requesting else { return }
        requesting = true
        generation += 1 // Retire any earlier status read.
        let granted = await requestPermission()
        let status = await readStatus()
        state = !granted && status == .notDetermined ? .failed : .read(status)
        requesting = false
        // Permission can change without changing the schedule. Reapply the
        // current account's agenda; never retain a member or plan here.
        didChange()
    }

    static func live() -> ScheduleReminderPermissionModel {
        #if DEBUG && targetEnvironment(simulator)
        if let fixture = fixture {
            return ScheduleReminderPermissionModel(readStatus: { fixture.status }, requestPermission: {
                fixture.status = fixture.grant ? .authorized : .denied
                return fixture.grant
            })
        }
        #endif
        return ScheduleReminderPermissionModel()
    }

    #if DEBUG && targetEnvironment(simulator)
    private final class Fixture {
        var status: UNAuthorizationStatus = .notDetermined
        let grant: Bool
        init(grant: Bool) { self.grant = grant }
    }
    private static let fixture: Fixture? = {
        let environment = ProcessInfo.processInfo.environment
        guard environment["TRESFORT_UI_FIXTURE"] != nil,
              let result = environment["TRESFORT_UI_REMINDER_PERMISSION"],
              ["granted", "denied"].contains(result) else { return nil }
        return Fixture(grant: result == "granted")
    }()
    #endif
}

struct ScheduleReminderPermissionView: View {
    @StateObject private var permission = ScheduleReminderPermissionModel.live()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(message)
                .font(Theme.mono(12))
                .foregroundStyle(Theme.muted)
                .accessibilityIdentifier("scheduleReminder.status")
            if permission.state == .notRequested || permission.state == .failed {
                Button(permission.state == .failed ? "Try enabling reminders again" : "Enable reminders") {
                    Task { await permission.enable() }
                }
                .disabled(permission.requesting)
                .accessibilityIdentifier("scheduleReminder.enable")
            }
            if permission.state == .denied || permission.state == .quiet,
               let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                Link("Open notification settings", destination: url)
                    .accessibilityIdentifier("scheduleReminder.settings")
            }
        }
        .task { await permission.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await permission.refresh() } }
        }
    }

    private var message: String {
        if permission.requesting { return "Checking notification permission… Your time can still be saved." }
        switch permission.state {
        case .checking: return "Checking notification permission…"
        case .notRequested: return "Your time will be saved on the plan. Enable notifications if you want a reminder then."
        case .allowed: return "Notifications are allowed. Your saved times can remind you when it's time to train."
        case .quiet: return "Notifications are allowed quietly. Change notification settings if you want alerts or sounds."
        case .denied: return "Notifications are off. Your time will still be saved; turn notifications on in Settings to get reminders."
        case .failed: return "Notification permission couldn't be confirmed. You can retry or save your time without reminders."
        }
    }
}
