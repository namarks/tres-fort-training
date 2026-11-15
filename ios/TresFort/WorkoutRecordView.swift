import SwiftUI

struct WorkoutRecordTarget: Equatable {
    let sessionID: String
    let date: String
    let slot: Int
    let attempt: Int

    init(_ session: SessionRow) {
        sessionID = session.id
        date = session.date
        slot = session.slot ?? 0
        attempt = session.attempt ?? 0
    }

    func matches(_ session: SessionRow) -> Bool {
        session.status == "completed" && session.id == sessionID && session.date == date
            && (session.slot ?? 0) == slot && (session.attempt ?? 0) == attempt
    }
}

enum WorkoutRecordIdentity {
    static func sourceSetLabel(_ set: SetLog, timed: Bool, bodyweight: Bool,
                               unilateral: Bool, perHand: Bool) -> String {
        let value = SetValueFormatter.value(weight: set.weight, reps: set.reps,
            durationSeconds: set.duration_s, timed: timed, bodyweight: bodyweight,
            unit: set.weightUnit.rawValue, unilateral: unilateral, repLoadUnit: set.weightUnit.rawValue)
        return "Set \(set.set_index) · " + value + (perHand && set.weight != 0 ? " · load each hand" : "")
    }

    static func title(_ session: SessionRow, plan: PlanTree?) -> String {
        if session.isFreestyle { return "Freestyle" }
        return plan?.workouts.first { $0.id == session.workout_id }?.name ?? "Recorded workout"
    }

    static func detail(_ session: SessionRow) -> String {
        var parts = [session.date, "Workout \((session.slot ?? 0) + 1)"]
        if let timestamp = session.started_at ?? session.completed_at {
            let formatter = DateFormatter()
            formatter.timeStyle = .short
            parts.append(formatter.string(from: Date(timeIntervalSince1970: Double(timestamp) / 1_000)))
        }
        return parts.joined(separator: " · ")
    }
}

/// Exact recorded session; opening it never selects or reopens the runner.
struct WorkoutRecordView: View {
    @ObservedObject var sync: SyncModel
    let sessionID: String
    var focusedSetID: String? = nil
    var expectedAttempt: Int? = nil
    @State private var target: WorkoutRecordTarget?

    private var session: SessionRow? { sync.sessions.first { $0.id == sessionID } }

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if sync.canReviewWorkoutRecords, let session, target?.matches(session) == true {
                        Text(WorkoutRecordIdentity.title(session, plan: sync.plan))
                            .font(.title2.bold()).foregroundStyle(Theme.text)
                            .accessibilityIdentifier("workoutRecord.title")
                        Text(WorkoutRecordIdentity.detail(session))
                            .font(.subheadline).foregroundStyle(Theme.muted)
                            .accessibilityIdentifier("workoutRecord.identity")
                        WorkoutSummaryView(sync: sync, session: session)
                        let sets = sync.setsForSession(session.id).filter { $0.deleted_at == nil }
                            .sorted { ($0.logged_at, $0.set_index, $0.id) < ($1.logged_at, $1.set_index, $1.id) }
                        if let focusedSetID, !sets.contains(where: { $0.id == focusedSetID }) {
                            Text("The requested set is unavailable. It may have been deleted. No other set has been selected.")
                                .foregroundStyle(Theme.muted).accessibilityIdentifier("workoutRecord.setUnavailable")
                        } else {
                            Text("Recorded sets").font(.headline).foregroundStyle(Theme.text)
                            if sets.isEmpty { Text("No sets recorded.").foregroundStyle(Theme.muted) }
                            ForEach(sets) { set in
                                VStack(alignment: .leading, spacing: 6) {
                                    if set.id == focusedSetID {
                                        Text("Selected from history").font(.caption).foregroundStyle(Theme.accent)
                                    }
                                    SetReviewList(sync: sync, sets: [set], pending: [])
                                }
                                .id(set.id)
                            }
                        }
                        CompletedWorkoutFeedbackEntry(sync: sync, session: session)
                    } else {
                        ContentUnavailableView("Workout unavailable", systemImage: "doc.text.magnifyingglass",
                            description: Text("This completed workout is missing or its attempt changed. Return to history and open the current record."))
                            .accessibilityIdentifier("workoutRecord.unavailable")
                    }
                }
                .readableColumn()
                .padding(20)
            }
            .task(id: sync.summaryRevision) {
                guard target == nil, sync.canReviewWorkoutRecords, let session,
                      session.status == "completed",
                      expectedAttempt == nil || expectedAttempt == (session.attempt ?? 0) else { return }
                target = WorkoutRecordTarget(session)
            }
            .onChange(of: target) { _, value in
                if value != nil, let focusedSetID { reader.scrollTo(focusedSetID, anchor: .center) }
            }
            .refreshable { await sync.load() }
        }
        .background(Theme.background)
        .navigationTitle("Workout record")
        .navigationBarTitleDisplayMode(.inline)
    }
}
