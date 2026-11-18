import SwiftUI

/// What the event editor opens with, including the plan version the member
/// reviewed, so a later save can't overwrite a newer plan unseen.
struct EventGoalEditTarget: Identifiable {
    let id = UUID()
    let draft: EventGoalDraft
    let version: Int

    /// The editor for the plan on screen: its event, or a new one.
    @MainActor static func opening(_ sync: SyncModel) -> EventGoalEditTarget? {
        guard let plan = sync.plan else { return nil }
        let unit = RunDistanceUnit.preferred()
        let draft = plan.event.map { EventGoalDraft(event: $0, unit: unit) }
            ?? EventGoalDraft(today: sync.todayString, unit: unit)
        return EventGoalEditTarget(draft: draft, version: plan.version)
    }
}

/// The goal event at the top of the Plan tab's Schedule side
/// (coach-free-planning P1): its date and countdown, name, distance, goal time
/// and goal pace. Tapping it opens the editor. With no event the Plan tab
/// shows a "Set an event" row beside Calendar instead.
struct EventPlanCard: View {
    @ObservedObject var sync: SyncModel
    let onEdit: (EventGoalEditTarget) -> Void

    private var unit: RunDistanceUnit { RunDistanceUnit.preferred() }

    var body: some View {
        if let event = sync.plan?.event {
            Button {
                if let target = EventGoalEditTarget.opening(sync) { onEdit(target) }
            } label: { filled(event) }
                .buttonStyle(.plain)
                .disabled(sync.isRoutineMutationInFlight)
                .accessibilityIdentifier("plan.event.card")
        }
    }

    private func filled(_ event: PlanEvent) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "flag.checkered")
                .font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.accent)
                .frame(width: 34, height: 34)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(EventGoal.dateLine(event, today: sync.todayString))
                    .font(Theme.mono(11, .bold)).foregroundStyle(Theme.muted)
                Text(event.name)
                    .font(.headline).foregroundStyle(Theme.text)
                    .lineLimit(2)
                if let detail = EventGoal.detailLine(event, unit: unit) {
                    Text(detail).font(.footnote).foregroundStyle(Theme.muted)
                }
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                .accessibilityHidden(true)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Edit your event")
    }
}

/// Sets, changes or removes the goal event. Every write carries the plan
/// version the editor opened with. When the plan has moved on (a conflict, or
/// a refresh while editing), a failed write closes the editor so the member
/// reviews the latest event before trying again.
struct EventGoalEditor: View {
    @ObservedObject var sync: SyncModel
    let expectedVersion: Int

    @Environment(\.dismiss) private var dismiss
    @State private var draft: EventGoalDraft
    @State private var working = false
    @State private var confirmingRemove = false

    init(sync: SyncModel, draft: EventGoalDraft, expectedVersion: Int) {
        _sync = ObservedObject(wrappedValue: sync)
        self.expectedVersion = expectedVersion
        _draft = State(initialValue: draft)
    }

    private var unit: RunDistanceUnit { RunDistanceUnit.preferred() }

    var body: some View {
        Form {
            Section {
                TextField("Name, such as Turkey Trot 5k", text: $draft.name)
                    .textInputAutocapitalization(.words)
                    .accessibilityIdentifier("event.name")
                DatePicker("Date", selection: Binding(get: { draft.date }, set: { draft.setDate($0) }),
                           displayedComponents: .date)
                    .accessibilityIdentifier("event.date")
            }
            Section {
                Picker("Type", selection: Binding(get: { draft.disciplineChoice },
                                                  set: { draft.setDiscipline($0) })) {
                    ForEach(EventGoal.disciplines) { Text($0.label).tag($0.id) }
                    Text("Something else").tag(EventGoalDraft.otherDiscipline)
                }
                .accessibilityIdentifier("event.type")
                if draft.disciplineChoice == EventGoalDraft.otherDiscipline {
                    TextField("What kind of event, such as Biathlon",
                              text: Binding(get: { draft.otherText }, set: { draft.setOtherText($0) }))
                        .accessibilityIdentifier("event.otherType")
                }
                distanceRows
            } footer: {
                if draft.kind == nil {
                    Text("Any distance, such as Sprint or 70.3. It's shown with your event.")
                }
            }
            Section {
                LabeledContent("Goal time") {
                    TextField("Optional", text: $draft.goal)
                        .multilineTextAlignment(.trailing)
                        .keyboardType(.numbersAndPunctuation)
                        .accessibilityIdentifier("event.goal")
                }
            } footer: {
                Text(goalFooter)
            }
            if let problem = shownProblem {
                Section {
                    Text(problem).foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("event.problem")
                }
            }
            if !draft.isNew {
                Section {
                    Button("Remove event", role: .destructive) { confirmingRemove = true }
                        .frame(maxWidth: .infinity)
                        .disabled(working)
                        .accessibilityIdentifier("event.remove")
                } footer: {
                    Text("Your coach and the web read the same event. Changing or removing it leaves your weeks and history as they are.")
                }
            }
            if let error = sync.loadError {
                Section { Text(error).foregroundStyle(Theme.danger) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(draft.isNew ? "Set an event" : "Event")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") { dismiss() }.foregroundStyle(Theme.muted)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(working ? "Saving…" : "Save") { save() }
                    .disabled(working || !draft.canSave)
                    .accessibilityIdentifier("event.save")
            }
        }
        .tint(Theme.accent)
        .alert("Remove \(draft.name.isEmpty ? "this event" : draft.name)?", isPresented: $confirmingRemove) {
            Button("Remove", role: .destructive) { remove() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your plan and training history stay as they are.")
        }
    }

    @ViewBuilder private var distanceRows: some View {
        if let kind = draft.kind {
            Picker("Distance", selection: $draft.distanceChoice) {
                Text("No set distance").tag(EventGoalDraft.DistanceChoice.noDistance)
                let saved = draft.distanceLabel.trimmingCharacters(in: .whitespacesAndNewlines)
                if draft.distanceChoice == .text, !saved.isEmpty {
                    Text(saved).tag(EventGoalDraft.DistanceChoice.text)
                }
                ForEach(EventGoal.presets(kind)) { Text($0.label).tag(EventGoalDraft.DistanceChoice.preset($0.label)) }
                Text("Another distance").tag(EventGoalDraft.DistanceChoice.custom)
            }
            .accessibilityIdentifier("event.distance")
            if draft.distanceChoice == .custom {
                HStack {
                    Text("How far")
                    Spacer()
                    TextField("0", text: $draft.customAmount)
                        .multilineTextAlignment(.trailing)
                        .keyboardType(.decimalPad)
                        .frame(maxWidth: 110)
                        .accessibilityIdentifier("event.amount")
                    Picker("Unit", selection: $draft.customUnit) {
                        ForEach(EventDistanceUnit.choices(for: kind)) { Text($0.rawValue).tag($0) }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .accessibilityIdentifier("event.unit")
                }
            }
        } else {
            LabeledContent("Distance") {
                TextField("Optional", text: $draft.distanceLabel)
                    .multilineTextAlignment(.trailing)
                    .accessibilityIdentifier("event.distanceLabel")
            }
        }
    }

    /// "Optional, like 20:00 or 1:45:30. Goal pace 6:26/mi."
    private var goalFooter: String {
        var text = "Optional, like 20:00 or 1:45:30."
        if case .success(let event) = draft.event(), let pace = EventGoal.goalPaceText(event, unit: unit) {
            text += " Goal \(EventGoal.singleKind(event.discipline ?? "") == .ride ? "speed" : "pace") \(pace)."
        }
        return text
    }

    /// What to fix, once there is something to fix: an empty name only
    /// disables Save, since every new event starts without one.
    private var shownProblem: String? {
        guard let problem = draft.problem else { return nil }
        if draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return nil }
        return problem
    }

    private func save() {
        guard case .success(let event) = draft.event() else { return }
        working = true
        Task {
            let saved = await sync.saveEvent(event, expectedVersion: expectedVersion)
            working = false
            if saved || planMovedOn { dismiss() }
        }
    }

    private func remove() {
        working = true
        Task {
            let removed = await sync.removeEvent(expectedVersion: expectedVersion)
            working = false
            if removed || planMovedOn { dismiss() }
        }
    }

    /// The plan on screen is no longer the one this editor opened with.
    private var planMovedOn: Bool { sync.plan?.version != expectedVersion }
}
