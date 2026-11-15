import Charts
import SwiftUI

/// Strength history shared by the Progress overview and its exercise list.
struct ExerciseHistoryList: View {
    @ObservedObject var sync: SyncModel
    @State private var query = ""
    @FocusState private var searching: Bool

    var body: some View {
        let planned = sync.plan?.workouts.filter { !$0.isArchived && $0.one_time_date == nil }
            .flatMap { $0.exercises.map(\.exercise_id) } ?? []
        let sections = ExerciseHistoryDiscovery.sections(historyIDs: sync.loggedExerciseIDs,
            plannedIDs: planned, catalog: sync.catalog, query: query)
        VStack(spacing: 0) {
            TextField("Search name or alias", text: $query)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.search).focused($searching).onSubmit { searching = false }
                .padding(.horizontal, 12).frame(minHeight: 44)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                .padding(16).accessibilityIdentifier("history.search")
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if !sections.current.isEmpty {
                        Text("In your current plan").font(.headline).foregroundStyle(Theme.text)
                        rows(sections.current)
                    }
                    if !sections.other.isEmpty {
                        Text("Completed history").font(.headline).foregroundStyle(Theme.text)
                        rows(sections.other)
                    }
                    if sections.current.isEmpty && sections.other.isEmpty {
                        Text(query.isEmpty ? "No completed history yet" : "No matching exercises")
                            .font(.headline).foregroundStyle(Theme.text)
                        Text(query.isEmpty ? "Completed working sets will appear here." : "Try another name or common alias.")
                            .font(.subheadline).foregroundStyle(Theme.muted)
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await sync.load() }
        }
    }

    @ViewBuilder private func rows(_ ids: [String]) -> some View {
        ForEach(ids, id: \.self) { id in
            NavigationLink { ExerciseDetailView(sync: sync, exerciseID: id) }
                label: { ExerciseHistoryRow(sync: sync, exerciseID: id) }
                .accessibilityIdentifier("history.exercise." + id)
        }
    }
}

enum ExerciseHistoryDiscovery {
    static func sections(historyIDs: [String], plannedIDs: [String], catalog: [ExerciseCatalog], query: String)
        -> (current: [String], other: [String]) {
        let terms = ExerciseSearchPolicy.normalized(query)
        let matching = Set(ExerciseSearchPolicy.results(catalog, query: query, region: .all).map(\.id))
        func matches(_ id: String) -> Bool {
            terms.isEmpty || matching.contains(id)
                || (catalog.first { $0.id == id } == nil && ExerciseSearchPolicy.normalized(id).contains(terms))
        }
        var seen = Set<String>()
        let recorded = Set(historyIDs)
        let current = plannedIDs.filter { recorded.contains($0) && seen.insert($0).inserted && matches($0) }
        let inPlan = Set(plannedIDs)
        return (current, historyIDs.filter { !inPlan.contains($0) && matches($0) })
    }
}

struct ExerciseHistoryRow: View {
    @ObservedObject var sync: SyncModel
    let exerciseID: String

    var body: some View {
        let id = exerciseID
        let last = sync.latestHistory(for: id)
        return HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(sync.exerciseName(id).uppercased())
                    .font(Theme.display(20)).foregroundStyle(Theme.text)
                if let last {
                    ForEach(Array(last.cohorts.prefix(2))) { cohort in
                        Text(cohort.valueLabel)
                            .font(Theme.mono(11)).foregroundStyle(Theme.muted)
                    }
                    if last.cohorts.count > 2 {
                        Text("+\(last.cohorts.count - 2) more load/mode combinations")
                            .font(Theme.mono(11)).foregroundStyle(Theme.muted)
                    }
                    Text("\(last.setCount) sets · " + WorkoutRecordIdentity.detail(last.session))
                        .font(Theme.mono(11)).foregroundStyle(Theme.muted)
                } else {
                    Text("No completed sets yet").font(.subheadline).foregroundStyle(Theme.muted)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.dim)
        }
        .padding(16)
        .background(Theme.surface).clipShape(RoundedRectangle(cornerRadius: 14))
        .contentShape(Rectangle())
    }
}

struct ExerciseDetailView: View {
    @ObservedObject var sync: SyncModel
    let exerciseID: String

    @State private var selectedProgress: ExerciseHistoryProgress.ID?
    @State private var selectedDate: String?

    var body: some View {
        let hist = sync.history(for: exerciseID)
        let options = ExerciseHistoryProgress.options(hist)
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let progress = ExerciseHistoryProgress.selected(selectedProgress, from: options) {
                    progressCard(progress, options: options)
                }
                if hist.isEmpty {
                    Text("No completed working sets yet.").foregroundStyle(Theme.muted)
                }
                ForEach(hist.reversed()) { session in
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 10) {
                            NavigationLink("Open workout record") {
                                WorkoutRecordView(sync: sync, sessionID: session.id,
                                                  expectedAttempt: session.session.attempt ?? 0)
                            }
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("history.record.\(session.id)")
                            if session.totalReps > 0 {
                                Text("\(session.totalReps) total reps · work logged")
                            }
                            if !session.volumeByUnit.isEmpty {
                                // Each unit keeps its own total; lb and kg never sum.
                                Text("\(WeightUnit.totals(session.volumeByUnit, number: SetValueFormatter.number)) external-load volume")
                            }
                            if let row = sync.sessions.first(where: { $0.id == session.id }) {
                                let feedback = WorkoutFeedback(notes: row.notes, perceivedFatigue: row.perceived_fatigue)
                                if !feedback.isEmpty { SavedWorkoutFeedbackView(feedback: feedback) }
                            }
                            ForEach(sessionSets(session.id)) { set in
                                NavigationLink {
                                    WorkoutRecordView(sync: sync, sessionID: session.id, focusedSetID: set.id,
                                                      expectedAttempt: session.session.attempt ?? 0)
                                } label: {
                                    Text(WorkoutRecordIdentity.sourceSetLabel(set, timed: sync.isTimedSet(set),
                                        bodyweight: sync.isBodyweightExercise(exerciseID),
                                        unilateral: sync.sides(for: exerciseID) == 2,
                                        perHand: sync.implements(for: exerciseID) == 2))
                                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                }
                                .accessibilityIdentifier("history.set.\(set.id)")
                            }
                        }
                        .font(Theme.mono(12)).foregroundStyle(Theme.text)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(WorkoutRecordIdentity.title(session.session, plan: sync.plan)).font(.headline)
                            Text(WorkoutRecordIdentity.detail(session.session))
                            Text("\(session.setCount) working sets")
                        }.frame(minHeight: 44)
                    }
                    .font(Theme.mono(11)).foregroundStyle(Theme.muted)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("history.session.\(session.id)")
                }
            }
            .padding(20)
        }
        .background(Theme.background)
        .navigationTitle(sync.exerciseName(exerciseID))
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: selectedProgress) { _, _ in selectedDate = nil }
    }

    private func progressCard(_ progress: ExerciseHistoryProgress,
                              options: [ExerciseHistoryProgress]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("PROGRESS").font(Theme.mono(10, .bold)).tracking(2)
                .foregroundStyle(Theme.muted)
            if options.count > 1 {
                Picker("Progress", selection: Binding(
                    get: { progress.id },
                    set: { selectedProgress = $0 }
                )) {
                    ForEach(options) { option in
                        Text(option.title).tag(option.id)
                    }
                }
                .pickerStyle(.menu)
                .tint(Theme.accent)
                .accessibilityIdentifier("history.progress.selector")
            } else {
                Text(progress.title).font(Theme.mono(13, .bold)).foregroundStyle(Theme.text)
            }
            if let last = progress.points.last {
                if progress.hasTrend {
                    Text("Best \(SetValueFormatter.number(progress.points.map(\.value).max() ?? 0)) · Latest \(SetValueFormatter.number(last.value)) \(progress.unit)")
                        .font(Theme.mono(12)).foregroundStyle(Theme.accent)
                    Chart(progress.points) { point in
                        LineMark(x: .value("Date", point.date), y: .value(progress.title, point.value))
                            .foregroundStyle(Theme.accent)
                        PointMark(x: .value("Date", point.date), y: .value(progress.title, point.value))
                            .foregroundStyle(Theme.accent)
                            .symbolSize(point.date == (selectedDate ?? progress.points.last?.date) ? 80 : 30)
                    }
                    .chartXAxis {
                        AxisMarks(values: axisDates(progress.points.map(\.date))) { value in
                            AxisGridLine()
                            AxisValueLabel(anchor: value.index == 0 ? .topLeading
                                : value.index == value.count - 1 ? .topTrailing : .top)
                                .foregroundStyle(Theme.muted)
                        }
                    }
                    .chartYAxis { AxisMarks { AxisValueLabel().foregroundStyle(Theme.muted) } }
                    .chartXSelection(value: $selectedDate)
                    .frame(height: 180)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("history.progress.chart")
                } else {
                    Text("\(SetValueFormatter.number(last.value)) \(progress.unit) · \(last.date)")
                        .font(Theme.mono(14)).foregroundStyle(Theme.accent)
                        .accessibilityIdentifier("history.progress.summary")
                    Text("Log another day to see a trend.")
                        .font(Theme.mono(11)).foregroundStyle(Theme.muted)
                }
                Text(progress.explanation).font(.caption).foregroundStyle(Theme.muted)
                    .accessibilityIdentifier("history.progress.explanation")
                sourceReview(progress)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.surface).clipShape(RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder private func sourceReview(_ progress: ExerciseHistoryProgress) -> some View {
        if let point = progress.points.first(where: { $0.date == selectedDate }) ?? progress.points.last,
           let index = progress.points.firstIndex(where: { $0.id == point.id }) {
            HStack {
                Button { selectedDate = progress.points[index - 1].date } label: {
                    Image(systemName: "chevron.left").frame(minWidth: 44, minHeight: 44)
                }.disabled(index == 0).accessibilityLabel("Previous recorded day")
                    .accessibilityIdentifier("history.progress.previous")
                Spacer()
                Text(point.date).font(.subheadline).foregroundStyle(Theme.text)
                Spacer()
                Button { selectedDate = progress.points[index + 1].date } label: {
                    Image(systemName: "chevron.right").frame(minWidth: 44, minHeight: 44)
                }.disabled(index == progress.points.count - 1).accessibilityLabel("Next recorded day")
                    .accessibilityIdentifier("history.progress.next")
            }
            NavigationLink {
                WorkoutRecordView(sync: sync, sessionID: point.sessionID, focusedSetID: point.setID,
                                  expectedAttempt: point.sessionAttempt)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Daily best: \(SetValueFormatter.number(point.value)) \(progress.unit)").font(.subheadline.bold())
                    if let session = sync.sessions.first(where: { $0.id == point.sessionID }) {
                        Text(WorkoutRecordIdentity.title(session, plan: sync.plan) + " · Workout \((session.slot ?? 0) + 1)")
                            .font(.caption)
                    }
                    if let source = sync.setsForSession(point.sessionID).first(where: { $0.id == point.setID }) {
                        Text(WorkoutRecordIdentity.sourceSetLabel(source, timed: sync.isTimedSet(source),
                            bodyweight: sync.isBodyweightExercise(exerciseID),
                            unilateral: sync.sides(for: exerciseID) == 2,
                            perHand: sync.implements(for: exerciseID) == 2))
                            .font(.caption).accessibilityIdentifier("history.progress.sourceValues")
                    }
                    Label("View source set", systemImage: "arrow.right").font(.subheadline)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }.accessibilityIdentifier("history.progress.source")
        }
    }

    /// Retain every plotted day, but label only the range endpoints so full
    /// civil dates stay readable inside the progress card at phone widths.
    private func axisDates(_ dates: [String]) -> [String] {
        let unique = Array(Set(dates)).sorted()
        guard unique.count > 2 else { return unique }
        return [unique[0], unique[unique.count - 1]]
    }

    private func sessionSets(_ sid: String) -> [SetLog] {
        sync.setsForSession(sid).filter { $0.exercise_id == exerciseID
            && $0.is_warmup == 0 && $0.deleted_at == nil }
            .sorted { $0.set_index < $1.set_index }
    }
}
