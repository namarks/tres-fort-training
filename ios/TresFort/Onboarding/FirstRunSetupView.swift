import SwiftUI

/// What first-run setup reads from the plan the member just made.
enum FirstRunSetup {
    /// Sports whose workouts come from a watch, bike computer or Zwift, so
    /// the sources that carry them lead the list of apps to connect.
    static let enduranceSports: Set<String> = ["run", "ride", "swim"]

    /// The plan holds a run: an outdoor run, or an activity called a run.
    static func plansRuns(_ plan: PlanTree?) -> Bool {
        plan?.libraryWorkouts.contains {
            PlannedRunCreation.runSlot(in: $0) != nil || PlannedActivity.sport(named: $0.name)?.id == "run"
        } ?? false
    }

    /// The plan holds a run, a ride or a swim.
    static func plansEndurance(_ plan: PlanTree?) -> Bool {
        plansRuns(plan) || (plan?.libraryWorkouts.contains {
            PlannedActivity.sport(named: $0.name).map { enduranceSports.contains($0.id) } ?? false
        } ?? false)
    }

    /// Something is on the week already.
    static func hasWeek(_ plan: PlanTree?) -> Bool {
        WorkoutLibraryPolicy.weekRows(plan: plan).contains { $0.workoutID != nil }
            || PlanSchedule.weekdayKeys.contains { !ScheduleExtras.workouts(on: $0, plan: plan).isEmpty }
    }

    /// Saving a workout does not put it on the week. Keep planning reachable
    /// until the member has a recurring week, a block, or a workout on a date.
    /// Existing date assignments still count when their workout needs review.
    static func needsWeekPlanning(plan: PlanTree?, sessions: [SessionRow], today: String) -> Bool {
        !hasWeek(plan) && plan?.program == nil
            && !sessions.contains {
                $0.date >= today && ["planned", "in_progress"].contains($0.status)
            }
    }
}

/// First-run setup inside the app: your usual week, then the apps you already
/// use. The week is the Plan tab's own (the same rows, Add to your week sheet
/// and weekday sheet), and the apps are the Connections rows, so nothing here
/// is a second copy of either. Every step can be skipped, and setup ends on
/// Today, never on a workout.
struct FirstRunSetupView: View {
    @ObservedObject var sync: SyncModel
    @ObservedObject var groupModel: GroupModel
    @ObservedObject var health: HealthKitSyncModel
    @ObservedObject var auth: AuthModel
    /// Closes setup. A coach chosen on the apps step is queued before this.
    var onDone: () -> Void

    private enum Page: Hashable { case apps, workout(String) }
    @State private var path: [Page] = []

    var body: some View {
        NavigationStack(path: $path) {
            FirstRunWeekPage(sync: sync, onNext: { path.append(.apps) }, onSkip: onDone,
                            onOpenWorkout: { path.append(.workout($0)) })
                .navigationDestination(for: Page.self) { page in
                    switch page {
                    case .apps:
                        FirstRunAppsPage(sync: sync, groupModel: groupModel, health: health, auth: auth,
                                         onCoach: {
                                             // Shown once setup closes, so the coach
                                             // sheet never stacks on this one.
                                             if auth.requestEntry(.coach) { onDone() }
                                         },
                                         onDone: onDone)
                    case let .workout(id):
                        // Review and edit on setup's own stack. No Start action:
                        // returning to the week keeps both setup steps intact.
                        WorkoutDetailsView(sync: sync, workoutID: id, isPushed: true)
                    }
                }
        }
        .tint(Theme.accent)
    }
}

// MARK: - Your usual week

private struct FirstRunWeekPage: View {
    @ObservedObject var sync: SyncModel
    let onNext: () -> Void
    let onSkip: () -> Void
    let onOpenWorkout: (String) -> Void

    @State private var adding = false
    @State private var weekdayTarget: IdentifiedString?
    @State private var workoutAfterWeekday: String?
    @State private var preparing = false

    /// A new account has no plan yet. The week can show (all rest) once a
    /// live read has proved that; any other missing plan is a read to retry.
    private var canShowWeek: Bool { sync.plan != nil || sync.canCreateRoutine }

    var body: some View {
        List {
            Section {
                FirstRunHeader(step: 1, title: "Your usual week",
                               text: "Add the runs, lifts, rides and sports you already do. They go on your plan, so Today knows what's next.")
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 4, trailing: 4))

            if canShowWeek {
                Section {
                    PlanWeekSummary(sync: sync) { day in
                        withPlan { weekdayTarget = IdentifiedString(id: day) }
                    }
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    Button { withPlan { adding = true } } label: {
                        if preparing {
                            ProgressView().tint(Theme.onSignal)
                        } else {
                            Label("Add to your week", systemImage: "plus")
                        }
                    }
                    .buttonStyle(WorkoutPrimaryButtonStyle())
                    .disabled(preparing || sync.isRoutineMutationInFlight)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    .accessibilityIdentifier("setup.addToWeek")
                } footer: {
                    Text("Tap a day to change it. A lift lets you pick your own exercises. You can change any of this on the Plan tab.")
                }
                if let error = sync.loadError {
                    Section {
                        Text(error).foregroundStyle(Theme.danger)
                            .accessibilityIdentifier("setup.error")
                    }
                }
            } else {
                Section {
                    PlanLoadRecoveryView(sync: sync)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("Set up")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                // Leaving never cancels a save already sent; the Plan tab
                // shows whatever it saved.
                Button("Skip setup", action: onSkip)
                    .accessibilityIdentifier("setup.skip")
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button(FirstRunSetup.hasWeek(sync.plan) ? "Next" : "Next, plan later", action: onNext)
                .buttonStyle(WorkoutPrimaryButtonStyle())
                .accessibilityIdentifier("setup.next")
                .padding()
                .background(Theme.background)
        }
        .sheet(isPresented: $adding) {
            NavigationStack {
                PlanComposerView(sync: sync, isRoot: true) { adding = false }
            }
        }
        .sheet(item: $weekdayTarget, onDismiss: {
            // Match the Plan tab: wait until the day sheet has closed before
            // pushing details, instead of leaving the new member at the week.
            if let id = workoutAfterWeekday {
                workoutAfterWeekday = nil
                onOpenWorkout(id)
            }
        }) { target in
            WeekdayPlanSheet(sync: sync, weekdayKey: target.id) { id in
                workoutAfterWeekday = id
                weekdayTarget = nil
            }
        }
    }

    /// Opens a sheet that edits the plan, first making the empty plan a new
    /// account doesn't have yet, the way the Plan tab's first workout does.
    /// Only a member who adds something gets one; skipping makes nothing.
    private func withPlan(_ open: @escaping () -> Void) {
        if sync.plan != nil { open(); return }
        guard sync.canCreateRoutine, !preparing else { return }
        preparing = true
        Task {
            defer { preparing = false }
            guard await sync.ensureRoutinePlan(name: "My Training") != nil, sync.plan != nil else { return }
            open()
        }
    }
}

// MARK: - Your apps

private struct FirstRunAppsPage: View {
    @ObservedObject var sync: SyncModel
    @ObservedObject var groupModel: GroupModel
    @ObservedObject var health: HealthKitSyncModel
    @ObservedObject var auth: AuthModel
    let onCoach: () -> Void
    let onDone: () -> Void

    var body: some View {
        Form {
            Section {
                FirstRunHeader(step: 2, title: "Connect your apps",
                               text: "Bring in workouts from the apps and devices you already use. Every connection is optional; you can plan and record workouts without one.")
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 4, trailing: 4))

            Section("Activity sources") {
                ConnectionSourceRows(groupModel: groupModel, health: health, auth: auth,
                                     order: ConnectionSourceRows.setupOrder(
                                        endurance: FirstRunSetup.plansEndurance(sync.plan)))
            }

            Section {
                ConnectionDeviceGuidance()
            } footer: {
                Text("Connect later or change your choices in Profile → Connections. Your group never sees your routes or heart rate.")
                    .accessibilityIdentifier("setup.connectLater")
            }

            if !auth.isReviewAccount {
                Section {
                    Button(action: onCoach) {
                        HStack(spacing: 12) {
                            Image(systemName: "sparkles")
                                .font(.title3).foregroundStyle(Theme.accent)
                                .frame(width: ConnectionLogo.column)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("AI coach").font(.headline).foregroundStyle(Theme.text)
                                Text("Let Claude, ChatGPT or another AI app read and adjust your plan")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold)).foregroundStyle(Theme.dim)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("setup.coach")
                } header: {
                    Text("Optional AI coach")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("Set up")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            Button("Go to Today", action: onDone)
                .buttonStyle(WorkoutPrimaryButtonStyle())
                .accessibilityIdentifier("setup.done")
                .padding()
                .background(Theme.background)
        }
        .task { await groupModel.refreshMe() }
    }
}

private struct FirstRunHeader: View {
    let step: Int
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Step \(step) of 2")
                .font(Theme.mono(12, .bold)).foregroundStyle(Theme.muted)
            Text(title)
                .font(.title2.weight(.bold)).foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            Text(text)
                .font(.subheadline).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
