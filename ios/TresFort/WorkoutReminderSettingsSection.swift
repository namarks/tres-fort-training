import SwiftUI
import UserNotifications

/// Opt-in workout reminders. Turning them on asks for notification permission
/// once; the time is local and applies to every workout day.
struct WorkoutReminderSettingsSection: View {
    @AppStorage private var enabled: Bool
    @AppStorage private var minutes: Int
    /// The evening nudge for what's left (app-design-pass P22): on unless
    /// the member turns it off.
    @AppStorage private var stillToDo: Bool
    @AppStorage private var stillToDoMinutes: Int
    @State private var permissionDenied = false
    @State private var requesting = false
    @Environment(\.scenePhase) private var scenePhase
    private var reminders: WorkoutReminderCoordinator { .shared }

    init(userID: String) {
        _enabled = AppStorage(wrappedValue: false, WorkoutReminderSettings.enabledKey(userID: userID))
        _minutes = AppStorage(wrappedValue: WorkoutReminderSettings.defaultMinutes,
                              WorkoutReminderSettings.minutesKey(userID: userID))
        _stillToDo = AppStorage(wrappedValue: true, WorkoutReminderSettings.stillToDoEnabledKey(userID: userID))
        _stillToDoMinutes = AppStorage(wrappedValue: WorkoutReminderSettings.defaultStillToDoMinutes,
                                       WorkoutReminderSettings.stillToDoMinutesKey(userID: userID))
    }

    var body: some View {
        Section {
            Toggle("Workout reminders", isOn: Binding(get: { enabled }, set: setEnabled))
                .disabled(requesting)
                .accessibilityIdentifier("profile.reminders.toggle")
            if enabled {
                DatePicker("Remind me at", selection: time($minutes), displayedComponents: .hourAndMinute)
                    .accessibilityIdentifier("profile.reminders.time")
            }
            Toggle("Still to do", isOn: Binding(get: { stillToDo }, set: setStillToDo))
                .disabled(requesting)
                .accessibilityIdentifier("profile.reminders.stillToDo")
            if stillToDo {
                DatePicker("Nudge me at", selection: time($stillToDoMinutes), displayedComponents: .hourAndMinute)
                    .accessibilityIdentifier("profile.reminders.stillToDoTime")
            }
            if permissionDenied {
                Text("Notifications are off for Très Fort. Turn them on in Settings to get reminders.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                    Link("Open notification settings", destination: url)
                        .accessibilityIdentifier("profile.reminders.settings")
                }
            }
        } header: {
            Text("Reminders")
        } footer: {
            Text("Workout reminders: a notification on each day your schedule or calendar has a workout. Rest days, skipped days and workouts you've started or finished stay quiet. Still to do: one nudge in the evening for anything planned that day that isn't done yet and has no time of its own. Things with a time remind you then. Add the Très Fort widget to your Home or Lock Screen to see today's workout at a glance.")
        }
        .task { await refreshPermission() }
        // Permission may change in Settings while this section stays mounted.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refreshPermission() } }
        }
    }

    private func time(_ minutes: Binding<Int>) -> Binding<Date> {
        Binding(
            get: {
                let calendar = Calendar.current
                let start = calendar.startOfDay(for: Date())
                let value = minutes.wrappedValue
                return calendar.date(bySettingHour: value / 60, minute: value % 60, second: 0, of: start) ?? start
            },
            set: { date in
                let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                minutes.wrappedValue = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
                NotificationCenter.default.post(name: WorkoutReminderSettings.changed, object: nil)
            })
    }

    /// Turning the nudge on asks for permission if it was never asked; it is
    /// on by default, but reaches only someone who has allowed notifications.
    private func setStillToDo(_ on: Bool) {
        stillToDo = on
        NotificationCenter.default.post(name: WorkoutReminderSettings.changed, object: nil)
        guard on else { Task { await refreshPermission() }; return }
        requesting = true
        Task { @MainActor in
            defer { requesting = false }
            let granted = await reminders.requestAuthorization()
            permissionDenied = !granted
            NotificationCenter.default.post(name: WorkoutReminderSettings.changed, object: nil)
        }
    }

    private func setEnabled(_ on: Bool) {
        guard on else {
            enabled = false
            NotificationCenter.default.post(name: WorkoutReminderSettings.changed, object: nil)
            return
        }
        requesting = true
        Task { @MainActor in
            defer { requesting = false }
            let granted = await reminders.requestAuthorization()
            permissionDenied = !granted
            enabled = granted
            NotificationCenter.default.post(name: WorkoutReminderSettings.changed, object: nil)
        }
    }

    private func refreshPermission() async {
        guard enabled || stillToDo else { permissionDenied = false; return }
        let status = await reminders.authorizationStatus()
        permissionDenied = status == .denied
    }
}
