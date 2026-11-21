import SwiftUI

/// Choosing a sport never starts or logs it. The member chooses an intent
/// before entering the existing date planner, recorder or completed-activity log.
struct TodayActivitySheet: View {
    enum Action {
        case lift, run, log(String)
    }
    private enum Route: Hashable {
        case activity(String), plan(String)
    }

    @ObservedObject var sync: SyncModel
    let date: String
    let canStartLift: Bool
    let canRecordRun: Bool
    let canLog: Bool
    let onAction: (Action) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var path: [Route]
    @State private var search = ""

    init(sync: SyncModel, date: String, initialKind: String?, canStartLift: Bool,
         canRecordRun: Bool, canLog: Bool, onAction: @escaping (Action) -> Void) {
        self.sync = sync
        self.date = date
        self.canStartLift = canStartLift
        self.canRecordRun = canRecordRun
        self.canLog = canLog
        self.onAction = onAction
        _path = State(initialValue: initialKind.map { [.activity($0)] } ?? [])
    }

    private var kinds: [String] {
        let first = ["run", "ride", "swim", "walk", "lift"]
        let all = first + PendingActivity.kinds.filter { !first.contains($0) }
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return all.filter { query.isEmpty || Self.title($0).localizedStandardContains(query) }
    }

    private static func title(_ kind: String) -> String {
        kind == "lift" ? "Lift" : PendingActivity.label(for: kind)
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    ForEach(kinds, id: \.self) { kind in
                        Button { path.append(.activity(kind)) } label: {
                            Label(Self.title(kind), systemImage: PendingActivity.glyph(for: kind))
                                .foregroundStyle(Theme.text)
                                .frame(minHeight: 44)
                        }
                        .accessibilityIdentifier("todayActivity.sport.\(kind)")
                    }
                } footer: {
                    Text("Choose an activity, then plan it for today, start now, or log what you've done.")
                }
                .listRowBackground(Theme.surface)
            }
            .searchable(text: $search, prompt: "Search activities")
            .overlay {
                if kinds.isEmpty { ContentUnavailableView.search(text: search) }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Choose activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { cancelToolbar }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .activity(let kind): actions(for: kind)
                case .plan(let kind): planner(for: kind)
                }
            }
        }
        .interactiveDismissDisabled(sync.isRoutineMutationInFlight)
        .tint(Theme.accent)
    }

    private func actions(for kind: String) -> some View {
        let current = sync.previewWorkout(forDateString: date)
        let unavailable = sync.plan == nil ? "Load your training plan before planning an activity."
            : sync.calendarAssignmentUnavailableReason(date: date)
        return List {
            Section {
                Button { path.append(.plan(kind)) } label: {
                    actionLabel(current == nil ? "Plan for today" : "Change today's plan",
                                detail: current.map { "Replace \($0.name) for today only." }
                                    ?? "Choose the details and save it for later.",
                                glyph: "calendar.badge.plus")
                }
                .disabled(unavailable != nil)
                .accessibilityIdentifier("todayActivity.plan")
            } footer: {
                if let unavailable { Text(unavailable) }
            }
            .listRowBackground(Theme.surface)
            Section {
                if kind == "lift" && canStartLift {
                    Button { finish(.lift) } label: {
                        actionLabel("Start now", detail: "Start a freestyle lift.", glyph: "play.fill")
                    }
                    .accessibilityIdentifier("todayActivity.start")
                }
                if kind == "run" && canRecordRun {
                    Button { finish(.run) } label: {
                        actionLabel("Start now", detail: "Open the run recorder.", glyph: "play.fill")
                    }
                    .accessibilityIdentifier("todayActivity.start")
                }
                if canLog {
                    Button { finish(.log(Self.title(kind))) } label: {
                        actionLabel("Log completed", detail: "Add an activity you've already done.",
                                    glyph: "square.and.pencil")
                    }
                    .accessibilityIdentifier("todayActivity.log")
                }
            }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(Self.title(kind))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { cancelToolbar }
    }

    private var cancelToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button("Cancel") { dismiss() }
                .accessibilityIdentifier("todayActivity.cancel")
        }
    }

    private func actionLabel(_ title: String, detail: String, glyph: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: glyph).foregroundStyle(Theme.accent)
                .frame(width: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline).foregroundStyle(Theme.text)
                Text(detail).font(.subheadline).foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                .foregroundStyle(Theme.muted).accessibilityHidden(true)
        }
        .padding(.vertical, 8)
        .frame(minHeight: 44)
    }

    @ViewBuilder private func planner(for kind: String) -> some View {
        switch kind {
        case "run":
            DayRunChangeView(sync: sync, date: date, source: nil) { dismiss() }
        case "ride", "swim":
            DayEnduranceChangeView(sync: sync, date: date, kind: kind == "swim" ? .swim : .ride) { dismiss() }
        case "lift":
            DayPickView(sync: sync, date: date, kind: .lift) { dismiss() }
        default:
            DayPickView(sync: sync, date: date, kind: .sport,
                        initialName: kind == "other" ? nil : Self.title(kind)) { dismiss() }
        }
    }

    private func finish(_ action: Action) {
        onAction(action)
        dismiss()
    }
}
