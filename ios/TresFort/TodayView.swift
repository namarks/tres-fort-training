import SwiftUI

private func clock(_ s: Int) -> String {
    s <= 0 ? "GO" : String(format: "%d:%02d", s / 60, s % 60)
}

private struct PendingSetBanner: View {
    @ObservedObject var sync: SyncModel
    @State private var showAbandonConfirm = false
    @State private var abandonTarget: WorkoutTerminalActionTarget?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: sync.failedSetIntentCount > 0
                ? "exclamationmark.triangle.fill"
                : "arrow.triangle.2.circlepath")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(sync.failedSetIntentCount > 0
                    ? Theme.danger : Theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(sync.pendingSetIntentCount) SET\(sync.pendingSetIntentCount == 1 ? "" : "S") WAITING TO SYNC")
                    .font(Theme.mono(10, .bold)).tracking(1)
                    .foregroundStyle(Theme.text)
                Text(sync.failedSetIntentCount > 0
                    ? "\(sync.failedSetIntentCount) failed — retry when ready"
                    : (sync.sendingSetIntentCount > 0 ? "Sending…" : "Saved on this device"))
                    .font(Theme.mono(10)).foregroundStyle(Theme.muted)
            }
            Spacer()
            if sync.failedSetIntentCount > 0 {
                HStack(spacing: 10) {
                    Button("RETRY") {
                        Task { await sync.retryFailedSetIntents() }
                    }
                    .foregroundStyle(Theme.accent)
                    if sync.canAbandonRecoveredWorkout {
                        Button("DISCARD") {
                            abandonTarget = sync.terminalActionTarget
                            showAbandonConfirm = abandonTarget != nil
                        }
                            .foregroundStyle(Theme.danger)
                    }
                }
                .font(Theme.mono(10, .bold))
            } else if sync.queuedSetIntentCount > 0,
                      sync.sendingSetIntentCount == 0 {
                Button("RETRY") {
                    Task { await sync.drainWorkoutWriteOutboxes() }
                }
                .font(Theme.mono(10, .bold))
                .foregroundStyle(Theme.accent)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Theme.surface)
        .overlay(alignment: .bottom) { Divider().overlay(Theme.surface2) }
        .confirmationDialog(
            "Discard this recovered workout?",
            isPresented: $showAbandonConfirm,
            titleVisibility: .visible
        ) {
            Button("Discard workout", role: .destructive) {
                guard let target = abandonTarget else { return }
                Task { await sync.discardWorkout(expected: target) }
            }
            Button("Keep workout", role: .cancel) {}
        } message: {
            Text("The failed saved sets will be removed and the server session will be discarded so you can start again.")
        }
    }
}

/// Normal online delivery takes a moment but does not need to move the whole
/// runner down and announce itself. Keep the durable queue truthful, while
/// surfacing its banner only when it outlives a short online grace period (or
/// immediately when the server rejects a set and the user can act on it).
private struct PendingSetBannerGate: View {
    @ObservedObject var sync: SyncModel
    @State private var graceElapsed = false

    var body: some View {
        Group {
            if sync.pendingSetIntentCount > 0,
               sync.failedSetIntentCount > 0 || graceElapsed {
                PendingSetBanner(sync: sync)
            }
        }
        .task(id: sync.pendingSetIntentCount > 0) {
            guard sync.pendingSetIntentCount > 0 else {
                graceElapsed = false
                return
            }
            graceElapsed = false
            do {
                try await Task.sleep(nanoseconds: 3_000_000_000)
            } catch {
                return
            }
            guard sync.pendingSetIntentCount > 0 else { return }
            graceElapsed = true
        }
    }
}

struct CachedStateBanner: View {
    var canTrainOffline = false
    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.muted)
            Text(canTrainOffline ? "OFFLINE · SAVING WORK ON THIS IPHONE" : "OFFLINE · SHOWING LAST SAVED DATA")
                .font(Theme.mono(10, .bold)).tracking(1)
                .foregroundStyle(Theme.muted)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(Theme.surface)
        .overlay(alignment: .bottom) { Divider().overlay(Theme.surface2) }
    }
}

private struct PendingTerminalBanner: View {
    @ObservedObject var sync: SyncModel
    @State private var reviewingFeedback: WorkoutTerminalIntent?

    var body: some View {
        if let intent = sync.visibleTerminalIntent {
            if intent.feedbackConflict != nil {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Feedback changed elsewhere").font(.headline)
                        Text("Your version is saved on this device.").font(.caption)
                    }
                    Spacer()
                    Button("Review feedback") { reviewingFeedback = intent }
                        .frame(minHeight: 44)
                }
                .padding(14).background(Theme.surface).foregroundStyle(Theme.text)
                .sheet(item: $reviewingFeedback) { item in
                    WorkoutFeedbackConflictSheet(sync: sync, intent: item)
                }
            } else {
            HStack(spacing: 10) {
                Image(systemName: intent.deliveryState == .failed
                    ? "exclamationmark.triangle.fill"
                    : "arrow.triangle.2.circlepath")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(intent.deliveryState == .failed
                        ? Theme.danger : Theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(intent.action == .finish
                        ? "WORKOUT FINISH WAITING TO SYNC"
                        : "WORKOUT DISCARDED — WAITING TO SYNC")
                        .font(Theme.mono(10, .bold)).tracking(1)
                        .foregroundStyle(Theme.text)
                    Text(intent.deliveryState == .failed
                        ? "Server rejected it — retry when ready"
                        : (sync.sendingTerminalIntentCount > 0
                            ? "Sending…" : "Saved on this device"))
                        .font(Theme.mono(10)).foregroundStyle(Theme.muted)
                }
                Spacer()
                if intent.deliveryState == .failed {
                    Button("RETRY") {
                        Task { await sync.retryTerminalIntent(id: intent.id) }
                    }
                    .font(Theme.mono(10, .bold))
                    .foregroundStyle(Theme.accent)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Theme.surface)
            .overlay(alignment: .bottom) { Divider().overlay(Theme.surface2) }
            }
        }
    }
}

struct TodayView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var sync: SyncModel
    @ObservedObject var auth: AuthModel
    @ObservedObject var stationLink: StationLinkController
    /// Opens the shared ManualActivitySheet hosted by MainTabView so a user
    /// can log "I just did Pilates" without tab-switching. Optional so
    /// existing tests / previews can construct the view without the new
    /// dependency.
    var onLogActivity: (() -> Void)? = nil
    /// Logs today's planned activity (a workout with no exercises, such as a
    /// soccer match), starting the log sheet on its name.
    var onLogPlannedActivity: ((String) -> Void)? = nil
    /// Opens the run recorder MainTabView hosts. Nil where recording isn't
    /// supported (before iOS 26, iPad, the App Store build).
    var onRecordRun: (() -> Void)? = nil
    /// Opens the run recorder with a planned run from the plan. Nil where
    /// recording isn't supported.
    var onStartRun: ((PlannedRun) -> Void)? = nil
    var isWorkoutFocused = true
    var onMinimizeWorkout: (() -> Void)? = nil
    var onResumeWorkout: (() -> Void)? = nil
    /// A partner workout owns the link while it is open.
    var onPartnerOpenChange: ((Bool) -> Void)? = nil
    /// Shows the Activity tab, from this week's fort.
    var onOpenActivity: (() -> Void)? = nil
    @State private var isLocallyMinimized = false
    /// The member chose Finish workout before every exercise was done. Shows
    /// the finish screen without changing the runner's own progress.
    @State private var reviewingEarlyFinish = false
    private var workoutFocused: Bool { sync.running && !sync.finished && isWorkoutFocused && !isLocallyMinimized }

    /// Opens the saved workout library from the explicit Today action.
    @State private var showOverridePicker = false
    @State private var showTodayPicker: IdentifiedString?
    /// Skip on today's card asks once before the day becomes a rest day.
    @State private var confirmSkipToday = false
    /// Confirms discarding the in-progress workout (destructive, undo-less).
    @State private var showDiscardConfirm = false
    @State private var discardTarget: WorkoutTerminalActionTarget?
    /// Compact controls are the default. Expanding the clock is a presentation
    /// choice only; the model retains the rest deadline while navigating.
    @State private var restExpanded = false
    /// Direct creation of a named saved workout.
    @State private var showRoutine = false
    @State private var showWeekPlanning = false
    @State private var preparingWeek = false
    /// The day whose workout the editor sheet is editing.
    @State private var previewTarget: IdentifiedString?
    @State private var unresolvedDate: IdentifiedString?
    /// Keeps a double tap from starting twice while iOS is presenting the
    /// one-time notification permission prompt before a new workout.
    @State private var isPreparingWorkoutStart = false
    @State private var showFreestyle = false
    @State private var activityChoice: IdentifiedString?
    @State private var pendingActivityAction: TodayActivitySheet.Action?
    /// "Build a workout" in the + menu: the same picker as the card's Add
    /// another workout, for a day whose card doesn't carry that line.
    @State private var showAddWorkout = false
    /// Record a run or log an activity chosen in Add to today, opened once
    /// that sheet is gone.
    @State private var afterAddToToday: (() -> Void)?
    /// A row of today's list whose choices are open (P30), and the choice
    /// made there, carried out once that sheet is gone.
    @State private var itemChoices: DailyWorkoutAgenda.Item?
    @State private var pendingChoice: (choice: TodayItemChoice, item: DailyWorkoutAgenda.Item)?
    /// A suggested routine done today in place of an activity (P30).
    @State private var routineInstead: TodayRoutineInstead?
    /// The list row whose Details are open, so Start there starts that
    /// row's own session, never the day's main one (P30).
    @State private var previewItem: DailyWorkoutAgenda.Item?
    @State private var showStation = false
    @State private var showStationConnection = false
    @StateObject private var partner = PartnerPhoneModel()
    @State private var showPartner = false
    @AppStorage(StationLink.enabledAccountDefaultsKey) private var stationLinkEnabledAccount = ""
    private var stationLinkAccount: String? {
        StationLink.phoneAccount(storedAccount: stationLinkEnabledAccount, auth: auth)
    }
    private var stationLinkRequestID: String {
        "\(stationLinkAccount ?? ""):\(stationLink.connectionAttempt)"
    }
    /// The full calendar, pushed from the week strip.
    @State private var showCalendar = false
    /// The day Today's card is swiped to, when it isn't today (P20).
    @State private var shownDate: String?
    @StateObject private var daySwipe = DaySwipeState()
    /// Another day opened from the swiped card, in its own sheet.
    @State private var otherDayAgenda: IdentifiedString?
    @State private var otherDayPicker: IdentifiedString?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let fullRestOverlayVisible = !sync.isPartnerWorkout && sync.restEndDate != nil && restExpanded && (workoutFocused || sync.finished)
        NavigationStack {
            ZStack(alignment: .top) {
                Theme.background
                VStack(spacing: 0) {
                    if sync.isUsingCachedState {
                        CachedStateBanner(canTrainOffline: sync.canUseOfflineWorkoutState)
                    }
                    if sync.pendingTerminalIntentCount > 0 {
                        PendingTerminalBanner(sync: sync)
                    }
                    PendingSetBannerGate(sync: sync)
                    if !sync.setCorrections.isEmpty {
                        PendingCorrectionsView(sync: sync)
                    }
                    // An unfinished partner lane remains reachable after relaunch.
                    // Starting a new one lives in the "+" menu with the other
                    // occasional ways to train.
                    if partner.isOpen && UIDevice.current.userInterfaceIdiom == .phone {
                        Button("Partner workout setup") { showPartner = true }
                            .frame(minHeight: 44).accessibilityIdentifier("today.partner")
                    }
                    if partner.isActive { PartnerPhoneRunner(model: partner, sync: sync) }
                    else { content.disabled(sync.partnerReserved) }
                }
                // The full rest screen is modal. Without explicitly removing
                // the runner from hit testing and the accessibility tree,
                // assistive actions can start/log a hidden set underneath it.
                .disabled(fullRestOverlayVisible)
                .accessibilityHidden(fullRestOverlayVisible)
                if fullRestOverlayVisible {
                    RestOverlay(sync: sync) { restExpanded = false }
                }
            }
            .navigationTitle(sync.running ? "Workout" : "Today")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: $showCalendar) {
                // Starting or continuing today's workout from a date sheet
                // returns here, where the runner lives.
                HistoryView(sync: sync, onStartWorkout: {
                    showCalendar = false
                    isLocallyMinimized = false
                    onResumeWorkout?()
                })
            }
            .toolbar {
                // Profile's avatar, left of the + menu. A workout in focus
                // keeps the bar for its own controls.
                if !workoutFocused {
                    ToolbarItem(placement: .topBarTrailing) { ProfileButton() }
                }
                if hasMoreWaysToTrain {
                    ToolbarItem(placement: .topBarTrailing) { moreWaysToTrain }
                }
                // Once this phone has turned the iPad display on, its status
                // earns a toolbar icon. Before that it waits in a menu.
                if showsLinkedDisplayButton {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showStationConnection = true } label: {
                            Label("iPad display", systemImage: stationLink.isConnected ? "checkmark.circle.fill" : "ipad.landscape")
                                .labelStyle(.iconOnly)
                        }
                        .accessibilityIdentifier("today.ipadDisplay")
                        .accessibilityValue(stationLink.isConnected ? "Connected" : "")
                    }
                }
                if UIDevice.current.userInterfaceIdiom == .pad {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { showStation = true } label: {
                            Label("Station Mode", systemImage: "figure.strengthtraining.traditional")
                        }
                        .accessibilityIdentifier("today.station")
                        .disabled(sync.running || sync.partnerReserved)
                    }
                }
                if sync.running && !sync.isPartnerWorkout {
                    if workoutFocused {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Minimize", systemImage: "chevron.down") {
                                restExpanded = false
                                if let onMinimizeWorkout { onMinimizeWorkout() }
                                else { isLocallyMinimized = true }
                            }
                            .accessibilityIdentifier("runner.minimize")
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            if !sync.finished && !reviewingEarlyFinish {
                                // Finishing early opens the same finish screen
                                // the last set leads to.
                                Button("Finish workout", systemImage: "checkmark.circle") {
                                    restExpanded = false
                                    reviewingEarlyFinish = true
                                }
                                .disabled(sync.hasPendingTerminalIntentForCurrentWorkout)
                            }
                            if offersDisplayInMenu {
                                Button("iPad display", systemImage: "ipad.landscape") { showStationConnection = true }
                                    .accessibilityIdentifier("today.ipadDisplay")
                            }
                            Button("Discard workout", systemImage: "trash", role: .destructive) {
                                discardTarget = sync.terminalActionTarget
                                showDiscardConfirm = discardTarget != nil
                            }
                            .disabled(sync.hasDiscardIntentForCurrentWorkout)
                            .accessibilityIdentifier("today.discardWorkout")
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                        .accessibilityLabel("Workout actions")
                        .accessibilityIdentifier("today.workoutActions")
                    }
                }
            }
            // The expanded rest screen is modal across the whole app chrome,
            // not just the scroll content. Hiding both bars removes Log
            // Activity, destructive menu actions, and tab switches from taps
            // and the VoiceOver tree until rest is minimized or dismissed.
            .toolbar(
                fullRestOverlayVisible ? .hidden : .visible,
                for: .navigationBar)
            .toolbar(
                workoutFocused || fullRestOverlayVisible ? .hidden : .visible,
                for: .tabBar)
            .alert(
                "Discard this workout?",
                isPresented: $showDiscardConfirm
            ) {
                Button("Discard — don't save", role: .destructive) {
                    guard let target = discardTarget else { return }
                    Task { await sync.discardWorkout(expected: target) }
                }
                Button("Keep workout", role: .cancel) {}
            } message: {
                Text("The sets you logged will be deleted and this session won't count. The day goes back to its normal schedule. This can't be undone.")
            }
            .sheet(isPresented: $showStationConnection) {
                StationPhoneSetupView(auth: auth, link: stationLink) {
                    showStationConnection = false
                }
            }
            .fullScreenCover(isPresented: $showStation) {
                let accountID = auth.userID
                let epoch = auth.featureSessionEpoch
                let workout = sync.stationWorkout
                StationEntryView(workoutName: workout?.name,
                    workout: (workout?.exercises ?? []).map { StationExerciseOption(prescription: $0) },
                    catalog: sync.catalog.map { StationExerciseOption(catalog: $0) },
                    accountID: accountID, epoch: epoch,
                    isCurrentSession: { [weak stationAuth = auth] in
                        stationAuth?.isCurrentFeatureSession(accountID: accountID, epoch: epoch) == true
                    }, observeBoundary: { [weak stationAuth = auth] observer in
                        _ = stationAuth?.observeFeatureSessionBoundary(observer)
                    }, loadLinkKey: { [weak stationAuth = auth] in
                        guard let accountID, let stationAuth,
                              stationAuth.isCurrentFeatureSession(accountID: accountID, epoch: epoch) else { return nil }
                        return await StationLinkKeyStore.load(accountID: accountID, jwt: stationAuth.featureJWT)
                    })
                    .environment(\.dynamicTypeSize, dynamicTypeSize)
            }
            .sheet(item: $previewTarget, onDismiss: { previewItem = nil }) { target in
                let start = previewStart(for: target.id)
                // A list row with nothing to start reads its details only:
                // with no date, Details offers no "Schedule for today" that
                // would put it in the day's own place.
                let fromRow = previewItem?.workout?.id == target.id
                let readOnly = start == nil && fromRow
                // A workout beside the day's own can't be changed for today
                // here: that change would replace the day's own workout.
                WorkoutDetailsView(sync: sync, workoutID: target.id,
                                   date: readOnly ? nil : sync.todayString, onStart: start,
                                   changesForDate: !(fromRow && previewItem?.source != .primary),
                                   startScopedByCaller: fromRow && start != nil)
            }
            .sheet(item: $unresolvedDate) { target in
                NavigationStack {
                    DayAgendaView(sync: sync, dateString: target.id)
                        .navigationTitle("Workout record")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { unresolvedDate = nil }
                        } }
                }
            }
            .sheet(isPresented: $showOverridePicker) {
                WorkoutsView(sync: sync, onStart: sync.todayIsCompleted ? nil : startChosenWorkout)
            }
            .sheet(item: $activityChoice, onDismiss: performActivityAction) { choice in
                TodayActivitySheet(sync: sync, date: sync.todayString,
                                   initialKind: choice.id == "all" ? nil : choice.id,
                                   canStartLift: canOfferFreestyle, canRecordRun: canOfferRecordRun,
                                   canLog: canOfferLogActivity && onLogPlannedActivity != nil) {
                    pendingActivityAction = $0
                }
            }
            .sheet(item: $showTodayPicker) { target in
                WorkoutDatePickerView(sync: sync, date: target.id)
            }
            .dayRestConfirmation(isPresented: $confirmSkipToday, weekday: "today",
                                 name: sync.previewWorkout(forDateString: sync.todayString)?.name) {
                let today = sync.todayString
                Task { await sync.setCalendarOverride(date: today, dayID: nil) }
            }
            .sheet(item: $otherDayPicker) { target in
                WorkoutDatePickerView(sync: sync, date: target.id)
            }
            .sheet(item: $otherDayAgenda) { target in
                NavigationStack {
                    DayAgendaView(sync: sync, dateString: target.id)
                        .navigationTitle(DateLabel.short(target.id))
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { otherDayAgenda = nil }
                        } }
                }
            }
            .sheet(isPresented: $showPartner) { PartnerPhoneSetup(model: partner, sync: sync) }
            .sheet(isPresented: $showFreestyle) { FreestyleExercisePicker(sync: sync, starting: true) }
            .sheet(isPresented: $showAddWorkout, onDismiss: {
                let next = afterAddToToday
                afterAddToToday = nil
                next?()
            }) {
                AdditionalWorkoutPicker(
                    sync: sync, title: usesDayList ? "Add to today" : todayHoldsNothing ? "Add a workout" : "Add another workout",
                    onRecordRun: usesDayList && canOfferRecordRun ? afterAddingToToday(onRecordRun) : nil,
                    onLogActivity: usesDayList && canOfferLogActivity ? afterAddingToToday(onLogActivity) : nil)
            }
            .sheet(item: $itemChoices, onDismiss: {
                guard let pending = pendingChoice else { return }
                pendingChoice = nil
                perform(pending.choice, on: pending.item)
            }) { item in
                TodayItemChoicesSheet(item: item, choices: choices(for: item)) { choice in
                    pendingChoice = (choice, item)
                    itemChoices = nil
                }
                .presentationDetents([.medium, .large])
            }
            .sheet(item: $routineInstead) { target in
                TodayRoutineInsteadSheet(sync: sync, target: target)
            }
            .sheet(isPresented: $showRoutine) {
                CreateWorkoutView(sync: sync, onStart: sync.todayIsCompleted ? nil : startChosenWorkout)
            }
            .sheet(isPresented: $showWeekPlanning) {
                NavigationStack {
                    PlanComposerView(sync: sync,
                                     kind: (sync.plan?.libraryWorkouts.isEmpty ?? true) ? .run : .saved,
                                     isRoot: true) { showWeekPlanning = false }
                }
            }
        }
        // Coming back to the app later starts on today again.
        .onChange(of: scenePhase) { _, phase in if phase == .background { shownDate = nil } }
        .task(id: auth.featureSessionEpoch) {
            guard UIDevice.current.userInterfaceIdiom == .phone else { return }
            partner.bind(auth: auth, sync: sync, link: stationLink)
        }
        .onChange(of: partner.needsReview) { _, needed in if needed { showPartner = true } }
        .task(id: stationLinkRequestID) {
            guard let account = stationLinkAccount else { stationLink.stop(); return }
            let key = await StationLinkKeyStore.load(accountID: account, jwt: auth.featureJWT)
            guard !Task.isCancelled, stationLinkAccount == account else { return }
            if let key { stationLink.start(key: key) } else { stationLink.keyUnavailable() }
        }
        // The tab shell publishes the workout to a linked iPad on every tab.
        .onChange(of: partner.isOpen, initial: true) { _, open in onPartnerOpenChange?(open) }
        // A rotated key restarts the running link so both devices meet again.
        .onReceive(NotificationCenter.default.publisher(for: StationLinkKeyStore.refreshed)) { note in
            guard let account = stationLinkAccount, note.userInfo?["accountID"] as? String == account else { return }
            Task { @MainActor in
                guard let key = await StationLinkKeyStore.load(accountID: account, jwt: nil),
                      stationLinkAccount == account else { return }
                stationLink.start(key: key)
            }
        }
        .onChange(of: sync.restEndDate) { if sync.restEndDate == nil { restExpanded = false } }
        .onChange(of: sync.currentWorkoutScope) { _, _ in
            restExpanded = false
            reviewingEarlyFinish = false
        }
        .onChange(of: sync.running) { _, running in
            if !running {
                isLocallyMinimized = false
                reviewingEarlyFinish = false
                stationLink.resetWorkout()
            }
        }
        // Once every exercise is done the regular finish screen takes over, so
        // reopened work later returns to the runner, not to an early finish.
        .onChange(of: sync.finished) { _, finished in if finished { reviewingEarlyFinish = false } }
        // Only the open runner logs counts, so a minimized workout is not armed;
        // resuming arms the current set again.
        .onChange(of: workoutFocused) { _, focused in if !focused { stationLink.pause() } }
    }

    private var canOfferFreestyle: Bool { !sync.partnerReserved && sync.canStartFreestyle }
    private var canOfferLogActivity: Bool {
        onLogActivity != nil && !sync.partnerReserved && !sync.running && !sync.finished
    }
    private var canOfferTrainTogether: Bool {
        StationLink.isAvailable && !partner.isOpen && !sync.running
            && UIDevice.current.userInterfaceIdiom == .phone
    }
    private var canOfferRecordRun: Bool {
        onRecordRun != nil && !sync.partnerReserved && !sync.running
    }
    /// The iPad display is an iPhone feature, kept from the App Review account.
    private var canOfferIPadDisplay: Bool {
        UIDevice.current.userInterfaceIdiom == .phone && !auth.isReviewAccount
    }
    private var showsLinkedDisplayButton: Bool { canOfferIPadDisplay && stationLinkAccount != nil }
    /// Until the display is turned on it lives in the + menu, or in the
    /// workout menu while a workout is open.
    private var offersDisplayInMenu: Bool { canOfferIPadDisplay && !showsLinkedDisplayButton }
    /// The saved workouts: start one today, or browse them once today is done.
    /// The library itself lives in the Plan tab; this keeps it one menu away.
    private var canOfferSavedWorkouts: Bool {
        !sync.running && !sync.partnerReserved && sync.plan != nil
    }
    /// Building a routine right now, or adding a workout beside the day's
    /// own. The day's card carries the same thing as its last line, except
    /// on a day with nothing planned.
    private var canOfferBuildWorkout: Bool {
        !sync.running && !sync.partnerReserved && sync.plan != nil
    }
    private var hasMoreWaysToTrain: Bool {
        canOfferFreestyle || canOfferLogActivity || canOfferRecordRun || canOfferTrainTogether
            || canOfferSavedWorkouts || (offersDisplayInMenu && !sync.running)
    }
    /// Today has no workout, session or activity planned: the card reads
    /// "Rest day".
    private var todayHoldsNothing: Bool {
        !sync.isFreestyle && sync.todayPreviewWorkout == nil && sync.todaySession == nil
            && todayArrangement(main: nil).lead == nil
    }
    /// A sport is a choice of activity, not an instruction to start it.
    private var hasQuickStarts: Bool {
        canOfferFreestyle || canOfferLogActivity || canOfferRecordRun
    }

    /// Present a recorder or log only after the activity sheet has closed.
    private func performActivityAction() {
        let action = pendingActivityAction
        pendingActivityAction = nil
        switch action {
        case .lift where canOfferFreestyle: showFreestyle = true
        case .run where canOfferRecordRun: onRecordRun?()
        case .log(let name) where canOfferLogActivity: onLogPlannedActivity?(name)
        default: break
        }
    }

    /// Occasional ways to train and the saved workouts, kept off the main
    /// screen so today's workout and the week stay in front.
    private var moreWaysToTrain: some View {
        Menu {
            if canOfferFreestyle {
                Button { showFreestyle = true } label: {
                    Label(sync.isFreestyle ? "Continue freestyle" : "Start freestyle",
                          systemImage: "figure.strengthtraining.traditional")
                }
                .accessibilityIdentifier("today.startFreestyle")
            }
            if canOfferLogActivity, let onLogActivity {
                Button(action: onLogActivity) {
                    Label("Log an activity", systemImage: "figure.walk")
                }
                .accessibilityIdentifier("today.logActivity")
            }
            if canOfferRecordRun, let onRecordRun {
                Button(action: onRecordRun) {
                    Label("Record a run", systemImage: "figure.run")
                }
                .accessibilityIdentifier("today.recordRun")
            }
            if canOfferTrainTogether {
                Button { showPartner = true } label: {
                    Label("Train together", systemImage: "person.2")
                }
                .accessibilityIdentifier("today.trainTogether")
            }
            if canOfferBuildWorkout {
                Button { showAddWorkout = true } label: {
                    Label("Build a workout", systemImage: "square.stack.3d.up")
                }
                .disabled(!sync.canAddAnotherWorkout)
                .accessibilityIdentifier("today.buildWorkout")
            }
            if canOfferSavedWorkouts {
                Divider()
                Button { showOverridePicker = true } label: {
                    Label("Saved workouts", systemImage: "list.bullet.clipboard")
                }
                .accessibilityIdentifier("today.chooseWorkout")
            }
            if offersDisplayInMenu && !sync.running {
                Divider()
                Button { showStationConnection = true } label: {
                    Label("iPad display", systemImage: "ipad.landscape")
                }
                .accessibilityIdentifier("today.ipadDisplay")
            }
        } label: {
            Image(systemName: "plus")
        }
        .accessibilityLabel("More ways to train")
        .accessibilityIdentifier("today.moreWaysToTrain")
    }

    private var scrollableRestExpansion: (() -> Void)? {
        guard sync.restEndDate != nil else { return nil }
        return { restExpanded = true }
    }

    @ViewBuilder private var content: some View {
        if sync.finished || (reviewingEarlyFinish && sync.running) {
            FinishedView(sync: sync, stationLink: stationLink, onExpandRest: scrollableRestExpansion,
                         onKeepWorking: sync.finished ? nil : { reviewingEarlyFinish = false })
        } else if sync.running && !workoutFocused {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    daySection(sync.todayString) {
                        VStack(alignment: .leading, spacing: 0) {
                            VStack(alignment: .leading, spacing: 0) {
                                TodaySectionLabel(text: "IN PROGRESS")
                                Text("Workout in progress").font(.title3.weight(.bold))
                                    .foregroundStyle(Theme.text).padding(.top, 8)
                                if let ex = sync.currentExercise {
                                    Text("\(ex.exercise_name) · Set \(sync.currentPhysicalSetNumber)")
                                        .font(.headline.monospacedDigit()).foregroundStyle(Theme.text)
                                        .padding(.top, 6)
                                }
                                Button {
                                    isLocallyMinimized = false
                                    onResumeWorkout?()
                                } label: {
                                    Label("Resume workout", systemImage: "play.fill")
                                }
                                .buttonStyle(WorkoutPrimaryButtonStyle())
                                .accessibilityIdentifier("runner.resume")
                                .padding(.top, 16)
                            }
                            .todayActionBand()
                            VStack(alignment: .leading, spacing: 0) {
                                TodayLaterList(extras: todayExtras.filter { !plannedActivityLogged($0) },
                                               onLog: onLogPlannedActivity, minutes: todayMinutes)
                                AddAnotherWorkoutLine(sync: sync)
                            }
                            .todayFootRows()
                        }
                        .todayCardShell()
                    }
                    weekSection
                }
                .readableColumn()
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
            }
        } else if sync.running {
            RunnerView(sync: sync, auth: auth, stationLink: stationLink, onExpandRest: { restExpanded = true },
                       onStartRun: onStartRun.map { start -> (TemplateExercise) -> Void in
                           { ex in start(ex.plannedRun(in: sync.selectedDay?.name ?? "Planned run")) }
                       })
        } else if sync.plan == nil && !sync.canCreateRoutine {
            PlanLoadRecoveryView(sync: sync)
        } else if sync.canChooseStarterWorkout && sync.canOfferWeekPlanning && !sync.todayIsCompleted {
            VStack(spacing: 14) {
                Text("Plan your week")
                    .font(.title2.weight(.bold)).foregroundStyle(Theme.text)
                Text("Add the runs, lifts, rides and sports you already do. Today then shows what's next.")
                    .font(.callout).foregroundStyle(Theme.text)
                    .accessibilityIdentifier("today.empty-guidance")
                    .multilineTextAlignment(.center)
                planWeekButton.padding(.top, 6)
                Button("Create a workout") { showRoutine = true }
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityIdentifier("today.createWorkout")
                Button("Set up my coach") { auth.requestEntry(.coach) }
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityIdentifier("today.setUpCoach")
            }
            .padding(24)
        } else if let other = otherDate {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 4) {
                        TodayDayHeading(sync: sync, dateString: other)
                        TodayOtherDayCard(
                            sync: sync, dateString: other,
                            onBackToToday: { moveDay(-(TodayDays.offset(of: other, from: sync.todayString) ?? 0)) },
                            onViewDay: { otherDayAgenda = IdentifiedString(id: other) },
                            onChangeDay: { otherDayPicker = IdentifiedString(id: other) })
                            .modifier(TodayDaySwipe(state: daySwipe, canMove: canMoveDay, apply: applyDayMove, move: moveDay))
                    }
                    weekSection
                }
                .readableColumn()
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
            }
            .refreshable { await sync.load() }
        } else if usesDayList {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // The recovery card adds its own top gap, so nothing
                    // moves when WHOOP isn't connected.
                    VStack(alignment: .leading, spacing: 0) {
                        VStack(alignment: .leading, spacing: 4) {
                            TodayDayHeading(sync: sync, dateString: sync.todayString)
                            TodayDayListView(rows: dayListRows, actions: rowActions,
                                             canAdd: canOfferBuildWorkout && sync.canAddAnotherWorkout,
                                             onAdd: { showAddWorkout = true })
                                .modifier(TodayDaySwipe(state: daySwipe, canMove: canMoveDay, apply: applyDayMove, move: moveDay))
                            // A workout whose add request is still out.
                            AddAnotherWorkoutLine(sync: sync, retryOnly: true, ruled: false)
                                .padding(.horizontal, 4)
                        }
                        RecoveryCard(auth: auth)
                    }
                    weekSection
                    if let error = sync.loadError {
                        Text(error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                }
                .readableColumn()
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
            }
            .refreshable { await sync.load() }
        } else if sync.todayIsCompleted {
            // Today's session is already COMPLETED. Show a done/recap
            // state with NO start and NO override: one session per
            // (user,date) means any "start" re-opens & double-logs the
            // completed row (server getOrCreateSession is idempotent on
            // (user,date)), so we never offer an action the data model
            // can't safely honor. Saved workouts stay in the + menu.
            WorkoutDoneView(sync: sync, onOpenCalendar: { showCalendar = true }, onOpenActivity: onOpenActivity,
                            extras: todayExtras, isLogged: plannedActivityLogged,
                            onLogActivity: onLogPlannedActivity,
                            daySwipe: TodayDaySwipe(state: daySwipe, canMove: canMoveDay, apply: applyDayMove, move: moveDay)) { somethingElse }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // The recovery card adds its own top gap, so nothing
                    // moves when WHOOP isn't connected.
                    VStack(alignment: .leading, spacing: 0) {
                        daySection(sync.todayString, agendaLeads: agendaOwnsActions) {
                            todayCard
                                .modifier(TodayDaySwipe(state: daySwipe, canMove: canMoveDay, apply: applyDayMove, move: moveDay))
                        }
                        RecoveryCard(auth: auth)
                    }
                    weekSection
                    if let error = sync.loadError {
                        Text(error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                }
                .readableColumn()
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
            }
            .refreshable { await sync.load() }
        }
    }

    /// Today's first section: the date (with the goal event beside it) as
    /// its heading over the day's card, then the day's agenda once it holds
    /// more than one workout. The card leads so its action sits at the top
    /// on every day. The agenda leads only when it holds the day's actions
    /// (`agendaOwnsActions`) and the card has none of its own.
    @ViewBuilder
    private func daySection<Card: View>(_ dateString: String, agendaLeads: Bool = false,
                                        @ViewBuilder card: () -> Card) -> some View {
        if agendaLeads {
            VStack(alignment: .leading, spacing: 4) {
                TodayDayHeading(sync: sync, dateString: dateString)
                VStack(alignment: .leading, spacing: 12) {
                    dayWorkouts(underCard: false)
                    card()
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 4) {
                    TodayDayHeading(sync: sync, dateString: dateString)
                    card()
                }
                dayWorkouts(underCard: true)
            }
        }
    }

    /// The agenda holds the day's actions: an activity to log leads the
    /// day, or workouts were added to a day with nothing planned. The card
    /// then offers only other ways to train.
    private var agendaOwnsActions: Bool {
        showsDailyAgenda && !sync.isFreestyle
            && (sync.todayPreviewWorkout.map(PlannedActivity.isActivity) == true
                || (sync.todayPreviewWorkout == nil && sync.todaySession == nil))
    }

    /// Everything about today in one card: what's planned and how to start
    /// it, or that nothing is, then other ways to train.
    @ViewBuilder private var todayCard: some View {
        if agendaOwnsActions {
            // The agenda already owns the activity actions (or the extras on
            // a rest day). Don't repeat them or call the same date unplanned.
            VStack(alignment: .leading, spacing: 0) {
                if hasQuickStarts {
                    TodaySectionLabel(text: "SOMETHING ELSE").padding(.top, 16)
                    quickStartButtons.padding(.top, 8).padding(.bottom, 12)
                }
                AddAnotherWorkoutLine(sync: sync, ruled: hasQuickStarts)
            }
            .padding(.horizontal, 20).padding(.vertical, 4)
            .todayCardShell()
        } else {
            selectedWorkoutCard
        }
    }

    /// The day's card in two tones (app-design-pass P29): what to do now and
    /// its one orange action on navy, everything else on the plain card.
    /// With nothing to start or log the whole card is plain.
    @ViewBuilder private var selectedWorkoutCard: some View {
        if sync.isFreestyle {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    TodaySectionLabel(text: "FREESTYLE")
                    Text("Freestyle").font(Theme.display(30)).foregroundStyle(Theme.text).padding(.top, 8)
                    Text("Add exercises as you go. Your weekly schedule stays unchanged.")
                        .font(.subheadline).foregroundStyle(Theme.muted).padding(.top, 4)
                    if sync.hasResumableWorkout {
                        Button("Continue freestyle") { sync.resumeWorkout() }
                            .buttonStyle(WorkoutPrimaryButtonStyle()).accessibilityIdentifier("today.resumeFreestyle")
                            .padding(.top, 16)
                    }
                }
                .todayLeadBand(hasAction: sync.hasResumableWorkout)
                VStack(alignment: .leading, spacing: 0) {
                    extrasBeside
                    somethingElse
                    AddAnotherWorkoutLine(sync: sync)
                }
                .todayFootRows()
            }
            .todayCardShell()
        } else if let workout = sync.todayPreviewWorkout {
            // A planned day changes through Swap; training off the plan
            // stays in the + menu (app-design-pass P25).
            lineupCard(main: workout)
        } else if let session = sync.todaySession,
                  ["planned", "in_progress"].contains(session.status) {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Workout needs review").font(.title3.weight(.bold)).foregroundStyle(Theme.text)
                    Text("There is a workout for today, but its saved workout details are unavailable. Your recorded sets are still available.")
                        .font(.subheadline).foregroundStyle(Theme.muted).padding(.top, 4)
                    Button("View workout record") { unresolvedDate = IdentifiedString(id: session.date) }
                        .frame(minHeight: 44).accessibilityIdentifier("today.viewUnresolvedWorkout")
                    Button("Refresh workout") { Task { await sync.load() } }.frame(minHeight: 44)
                }
                .todayLeadBand(hasAction: false)
                VStack(alignment: .leading, spacing: 0) {
                    extrasBeside
                    somethingElse
                    AddAnotherWorkoutLine(sync: sync)
                }
                .todayFootRows()
            }
            .todayCardShell()
        } else if todayArrangement(main: nil).lead != nil {
            lineupCard(main: nil)
        } else {
            // Nothing to start or log: a plain card, and no navy.
            VStack(alignment: .leading, spacing: 0) {
                doneExtraLines(todayArrangement(main: nil))
                Text("Rest day").font(.title2.weight(.bold)).foregroundStyle(Theme.text)
                Text("Nothing planned. Train anyway, or take the day off.")
                    .font(.subheadline).foregroundStyle(Theme.muted).padding(.top, 4)
                    .fixedSize(horizontal: false, vertical: true)
                if sync.canOfferWeekPlanning {
                    Text("Your saved workouts are ready. Choose the days you do them to see what's next here.")
                        .font(.subheadline).foregroundStyle(Theme.muted).padding(.top, 10)
                    planWeekButton.padding(.top, 10)
                }
                if hasQuickStarts { quickStartButtons.padding(.top, 16) }
                Button { showOverridePicker = true } label: {
                    HStack(spacing: 4) {
                        Text("Do a saved workout")
                        Image(systemName: "chevron.right").font(.caption.weight(.bold))
                    }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, 6)
                .accessibilityIdentifier("today.savedWorkout")
                // Building a routine is in the + menu on a day like this;
                // one whose request is still out can be retried here.
                AddAnotherWorkoutLine(sync: sync, retryOnly: true)
            }
            .padding(.bottom, -8)
            .todayPlainCard()
        }
    }

    private var showsDailyAgenda: Bool { DailyWorkoutAgenda.showsCombinedAgenda(sync.dailyWorkoutAgenda) }

    // MARK: today's day as one list (app-design-pass P30)

    private var dayListRows: [DailyWorkoutAgenda.Item] { TodayDayList.rows(sync.dailyWorkoutAgenda) }

    /// Today shows the day as one list whenever it holds something: the
    /// main workout, add-ons or workouts added for later. A freestyle
    /// session, a workout whose details can't be read and a day with nothing
    /// planned keep their own cards, and a finished day keeps its recap once
    /// nothing is left to do.
    private var usesDayList: Bool {
        guard sync.plan != nil, !sync.isFreestyle else { return false }
        let rows = dayListRows
        guard !rows.isEmpty else { return false }
        if sync.todayPreviewWorkout == nil, let session = sync.todaySession,
           ["planned", "in_progress"].contains(session.status) { return false }
        if sync.todayIsCompleted { return TodayDayList.hasOpenRow(rows) }
        return true
    }

    /// Closes Add to today, then records a run or logs an activity.
    private func afterAddingToToday(_ action: (() -> Void)?) -> (() -> Void)? {
        guard let action else { return nil }
        return {
            afterAddToToday = action
            showAddWorkout = false
        }
    }

    /// A row's own button and its other choices.
    private func rowActions(_ item: DailyWorkoutAgenda.Item) -> TodayRowActions {
        let more = { itemChoices = item }
        guard !item.isDone, item.status != "skipped" else {
            return TodayRowActions(primary: nil, primaryIdentifier: "", more: more)
        }
        if item.isActivity, let workout = item.workout {
            // A routine-type activity with no exercises yet starts from its
            // choices: give it exercises, or do a routine today.
            if TodayDayList.homeStart(for: workout) != nil {
                return TodayRowActions(primary: more, primaryIdentifier: "today.startActivity.\(workout.id)",
                                       primaryDisabled: sync.partnerReserved, more: more)
            }
            let log: (() -> Void)? = onLogPlannedActivity.map { handler in { handler(workout.name) } }
            return TodayRowActions(primary: log,
                                   primaryIdentifier: item.source == .primary ? "today.logPlannedActivity" : "today.extra.log.\(workout.id)",
                                   primaryDisabled: sync.partnerReserved, more: more)
        }
        if let session = item.session, (session.slot ?? 0) > 0 {
            return TodayRowActions(primary: { startListed(session) },
                                   primaryIdentifier: "today.session.\(session.slot ?? 0)",
                                   primaryDisabled: !sync.canSwitchWorkout || isPreparingWorkoutStart, more: more)
        }
        if item.source == .primary, let workout = item.workout {
            let startsRun = soloPlannedRun(workout) != nil && onStartRun != nil && !sync.hasResumableWorkout
            let blocked = sync.currentWorkoutScope.slot == 0 && sync.blocksNewWorkoutStart && !sync.hasResumableWorkout
            return TodayRowActions(primary: { startPrimary(workout) },
                                   primaryIdentifier: startsRun ? "today.startRun" : "today.startWorkout",
                                   primaryDisabled: !startsRun && (workout.exercises.isEmpty || isPreparingWorkoutStart || blocked),
                                   more: more)
        }
        if let workout = item.workout {
            return TodayRowActions(primary: {
                Task {
                    await RestCue.requestNotificationPermissionIfNeeded()
                    _ = await sync.addAnotherWorkout(workout.id)
                }
            }, primaryIdentifier: "today.scheduledAdditional.\(workout.id)",
               primaryDisabled: !sync.canAddAnotherWorkout, more: more)
        }
        return TodayRowActions(primary: nil, primaryIdentifier: "", more: more)
    }

    /// What a row's choices offer.
    private func choices(for item: DailyWorkoutAgenda.Item) -> [TodayItemChoice] {
        var out: [TodayItemChoice] = []
        let open = !item.isDone && item.status != "skipped"
        if let workout = item.workout, item.isActivity {
            if open, TodayDayList.homeStart(for: workout) != nil { out += [.addExercises, .routineToday] }
            if open, onLogPlannedActivity != nil { out.append(.log) }
        } else if open, rowActions(item).primary != nil {
            out.append(.start)
        }
        if let workout = item.workout, !PlannedActivity.isActivity(workout) { out.append(.details) }
        if item.source == .primary {
            if item.status == "planned", !sync.hasResumableWorkout, !sync.blocksNewWorkoutStart {
                out += [.change, .notToday]
            }
        } else if item.status == "planned" {
            out.append(.notToday)
        }
        if item.session != nil, item.isDone { out.append(.viewRecord) }
        return out
    }

    private func perform(_ choice: TodayItemChoice, on item: DailyWorkoutAgenda.Item) {
        switch choice {
        case .start:
            rowActions(item).primary?()
        case .log:
            if let workout = item.workout { onLogPlannedActivity?(workout.name) }
        case .details, .addExercises:
            if let workout = item.workout {
                previewItem = item
                previewTarget = IdentifiedString(id: workout.id)
            }
        case .change:
            showTodayPicker = IdentifiedString(id: sync.todayString)
        case .notToday:
            if item.source == .primary { confirmSkipToday = true }
            else { Task { await sync.setAsideToday(item) } }
        case .routineToday:
            if let workout = item.workout, let start = TodayDayList.homeStart(for: workout) {
                routineInstead = TodayRoutineInstead(start: start, replacing: item)
            }
        case .viewRecord:
            unresolvedDate = IdentifiedString(id: sync.todayString)
        }
    }

    /// Start in Details. Opened from a list row, it starts that row the way
    /// its own button does (its own session, or the add-on as a new one),
    /// and a row with nothing to start offers no Start.
    private func previewStart(for workoutID: String) -> ((String) -> Void)? {
        guard let item = previewItem, item.workout?.id == workoutID else { return startChosenWorkout }
        let actions = rowActions(item)
        guard !item.isActivity, let start = actions.primary, !actions.primaryDisabled else { return nil }
        if item.source == .primary {
            // Details can change the day's own workout for today only; start
            // the workout it hands back (the day's copy), not the one the
            // row held when Details opened.
            return { id in
                previewTarget = nil
                let today = sync.todayString
                guard let workout = sync.workout(id: id, on: today) ?? sync.previewWorkout(forDateString: today)
                else { return }
                startPrimary(workout)
            }
        }
        return { _ in
            previewTarget = nil
            start()
        }
    }

    /// The day's own workout from its row: a run opens the recorder, a lift
    /// the set runner, as Today's card did.
    private func startPrimary(_ workout: Workout) {
        if sync.currentWorkoutScope.slot != 0 { guard sync.selectPrimaryWorkout() else { return } }
        if let run = soloPlannedRun(workout), let onStartRun, !sync.hasResumableWorkout {
            onStartRun(run.plannedRun(in: workout.name))
            return
        }
        guard !workout.exercises.isEmpty, !(sync.blocksNewWorkoutStart && !sync.hasResumableWorkout) else { return }
        #if DEBUG && targetEnvironment(simulator)
        UIFixtureStartTrace.record(.todayStartAction)
        #endif
        prepareNewWorkout {
            if sync.hasResumableWorkout {
                #if DEBUG && targetEnvironment(simulator)
                UIFixtureStartTrace.record(.todayResumeSelected)
                #endif
                sync.resumeWorkout()
            } else {
                #if DEBUG && targetEnvironment(simulator)
                UIFixtureStartTrace.record(.todayStartSelected)
                #endif
                sync.startToday()
            }
        }
    }

    /// A workout added to today, or one beside the day's own already begun.
    private func startListed(_ session: SessionRow) {
        prepareNewWorkout { _ = sync.startListedSession(session) }
    }

    @ViewBuilder private func dayWorkouts(underCard: Bool) -> some View {
        if sync.plan != nil, showsDailyAgenda {
            DayWorkoutsView(sync: sync, onLogPlannedActivity: onLogPlannedActivity, underCard: underCard)
        }
    }

    private var planWeekButton: some View {
        Button(action: planWeek) {
            if preparingWeek {
                ProgressView().tint(Theme.onSignal)
            } else {
                Label("Plan your week", systemImage: "calendar.badge.plus")
            }
        }
        .buttonStyle(WorkoutPrimaryButtonStyle())
        .disabled(preparingWeek || sync.isRoutineMutationInFlight)
        .accessibilityIdentifier("today.planWeek")
    }

    private func planWeek() {
        guard sync.canOfferWeekPlanning, !preparingWeek, !sync.isRoutineMutationInFlight else { return }
        if sync.plan != nil { showWeekPlanning = true; return }
        guard sync.canCreateRoutine else { return }
        preparingWeek = true
        Task {
            defer { preparingWeek = false }
            guard await sync.ensureRoutinePlan(name: "My Training") != nil,
                  sync.plan != nil, sync.canOfferWeekPlanning else { return }
            showWeekPlanning = true
        }
    }

    /// Whether today's planned item has something to start or log. A
    /// planned activity that's already logged, or one that can't be logged
    /// from here, is only something to read.
    private func plannedWorkoutHasAction(_ workout: Workout) -> Bool {
        if soloPlannedRun(workout) != nil, onStartRun != nil, !sync.hasResumableWorkout { return true }
        guard PlannedActivity.isActivity(workout) else { return true }
        return !plannedActivityLogged(workout) && onLogPlannedActivity != nil
    }

    /// Today's planned workout, run or activity: its name, one line on how
    /// much it is, and the one action that starts or logs it. Details, Swap
    /// and Skip follow on the plain card (app-design-pass P25, P29). A run's
    /// steps are behind Details.
    @ViewBuilder private func plannedWorkout(_ workout: Workout) -> some View {
        let run = soloPlannedRun(workout)
        let isActivity = PlannedActivity.isActivity(workout)
        let status = sync.hasResumableWorkout ? "In progress"
            : workout.isOneTime ? "Just for today"
            : run != nil ? "Planned run" : isActivity ? "Planned activity" : "Planned workout"
        TodaySectionLabel(text: status.uppercased())
        Text(workout.name).font(Theme.display(30)).foregroundStyle(Theme.text)
            .lineLimit(2).minimumScaleFactor(0.7)
            .padding(.top, 8)
        Group {
            if run != nil {
                PlannedRunGlance(workout: workout, oneLine: true)
            } else if isActivity {
                Text(plannedActivityLogged(workout) ? "Activity · logged" : "Activity")
                    .font(.headline).foregroundStyle(Theme.text)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(workout.exercises.count) \(workout.exercises.count == 1 ? "exercise" : "exercises")")
                        .font(.headline.monospacedDigit()).foregroundStyle(Theme.text)
                    if !workout.exercises.isEmpty {
                        Text(workout.exercises.map(\.exercise_name).joined(separator: " · "))
                            .font(.footnote).foregroundStyle(Theme.muted)
                            .lineLimit(2)
                    }
                }
            }
        }
        .padding(.top, 6)
        Group {
            if let run, let onStartRun, !sync.hasResumableWorkout {
                // A run on its own starts in the recorder, not the set runner.
                Button("Start run") { onStartRun(run.plannedRun(in: workout.name)) }
                    .buttonStyle(WorkoutPrimaryButtonStyle())
                    .accessibilityIdentifier("today.startRun")
            } else if isActivity {
                // Nothing to log set by set: log the activity itself.
                if plannedActivityLogged(workout) {
                    Label("Logged today", systemImage: "checkmark.circle.fill")
                        .font(.headline).foregroundStyle(Theme.done)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .accessibilityIdentifier("today.plannedActivityLogged")
                } else if let onLogPlannedActivity {
                    Button("Log \(workout.name)") { onLogPlannedActivity(workout.name) }
                        .buttonStyle(WorkoutPrimaryButtonStyle())
                        .accessibilityIdentifier("today.logPlannedActivity")
                }
            } else {
                Button(isPreparingWorkoutStart ? "Preparing…" : sync.hasResumableWorkout ? "Continue workout" : "Start workout") {
                    #if DEBUG && targetEnvironment(simulator)
                    UIFixtureStartTrace.record(.todayStartAction)
                    #endif
                    prepareNewWorkout {
                        if sync.hasResumableWorkout {
                            #if DEBUG && targetEnvironment(simulator)
                            UIFixtureStartTrace.record(.todayResumeSelected)
                            #endif
                            sync.resumeWorkout()
                        } else {
                            #if DEBUG && targetEnvironment(simulator)
                            UIFixtureStartTrace.record(.todayStartSelected)
                            #endif
                            sync.startToday()
                        }
                    }
                }
                .buttonStyle(WorkoutPrimaryButtonStyle())
                .accessibilityIdentifier("today.startWorkout")
                .disabled(workout.exercises.isEmpty || isPreparingWorkoutStart
                    || (sync.blocksNewWorkoutStart && !sync.hasResumableWorkout))
            }
        }
        .padding(.top, 16)
    }

    /// Details, Swap and Skip for today's planned item, the first plain row
    /// under it.
    private func plannedWorkoutChoices(_ workout: Workout) -> some View {
        DayActionsRow(
            showsChanges: !sync.hasResumableWorkout && !sync.blocksNewWorkoutStart,
            onDetails: { previewTarget = IdentifiedString(id: workout.id) },
            onSwap: { showTodayPicker = IdentifiedString(id: sync.todayString) },
            onSkip: { confirmSkipToday = true })
            .todayFootRow()
    }

    /// Choose a sport first, then explicitly plan, start or log it.
    @ViewBuilder private var somethingElse: some View {
        if hasQuickStarts {
            VStack(alignment: .leading, spacing: 8) {
                TodaySectionLabel(text: "SOMETHING ELSE")
                quickStartButtons
            }
            .padding(.top, 12).padding(.bottom, 12)
            .todayFootRow()
        }
    }

    private var quickStartButtons: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Plan for today, start now, or log completed.")
                .font(.subheadline).foregroundStyle(Theme.muted)
            let row = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
            row {
                activityButton("Lift", kind: "lift", glyph: "figure.strengthtraining.traditional")
                activityButton("Run", kind: "run", glyph: "figure.run")
            }
            row {
                activityButton("Swim", kind: "swim", glyph: "figure.pool.swim")
                activityButton("More activities", kind: "all", glyph: "sportscourt")
            }
        }
    }

    private func activityButton(_ title: String, kind: String, glyph: String) -> some View {
        quickStart(title, spokenLabel: "\(title), choose how to add it",
                   systemImage: glyph, identifier: "today.activity.\(kind)") {
            pendingActivityAction = nil
            activityChoice = IdentifiedString(id: kind)
        }
    }

    private func quickStart(_ title: String, spokenLabel: String, systemImage: String,
                            identifier: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.accent).accessibilityHidden(true)
            }
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(RaisedFill())
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(spokenLabel)
        .accessibilityIdentifier(identifier)
    }

    /// Activities today holds beside its workout (schedule extras, such as
    /// morning stretching), from the same projection rule as the server.
    private var todayExtras: [Workout] {
        guard !showsDailyAgenda else { return [] }
        return sync.plannedExtras(on: sync.todayString, today: sync.todayString).filter(PlannedActivity.isActivity)
    }

    /// Today's workout and the activities beside it, arranged for the card:
    /// what's done, what leads and what waits under Later today. The workout
    /// counts as done here only when it is an activity already logged; a
    /// completed workout has its own finished card.
    private func todayArrangement(main: Workout?) -> TodayLineup.Arrangement {
        TodayLineup.arrange(
            main: main.map { (id: $0.id, done: PlannedActivity.isActivity($0) && plannedActivityLogged($0)) },
            extras: todayExtras.map { (id: $0.id, done: plannedActivityLogged($0)) })
    }

    /// The card's plan for today: finished items as check lines, then the
    /// item that leads on navy with its one orange action, then the plain
    /// rows: its Details, Swap and Skip, Later today, and adding another.
    @ViewBuilder private func lineupCard(main: Workout?) -> some View {
        let arrangement = todayArrangement(main: main)
        let extras = todayExtras
        let mainDone = main.map { arrangement.done.contains($0.id) } ?? false
        let hasDoneExtras = extras.contains { arrangement.done.contains($0.id) }
        VStack(alignment: .leading, spacing: 0) {
            if mainDone || hasDoneExtras {
                VStack(alignment: .leading, spacing: 0) {
                    if let main, mainDone {
                        TodayDoneLine(title: main.name, detail: "Logged",
                                      actionTitle: "View details", action: { previewTarget = IdentifiedString(id: main.id) },
                                      actionIdentifier: "today.viewWorkout", dividerBelow: false)
                    }
                    doneExtraLines(arrangement, dividers: false)
                }
                .todayDoneBand()
            }
            if let main, arrangement.lead == main.id {
                VStack(alignment: .leading, spacing: 0) { plannedWorkout(main) }
                    .todayLeadBand(hasAction: plannedWorkoutHasAction(main))
            } else if let lead = extras.first(where: { $0.id == arrangement.lead }) {
                TodayNextActivity(workout: lead, onLog: onLogPlannedActivity, minutes: todayMinutes(lead))
                    .todayLeadBand(hasAction: onLogPlannedActivity != nil)
            }
            VStack(alignment: .leading, spacing: 0) {
                if let main, arrangement.lead == main.id { plannedWorkoutChoices(main) }
                TodayLaterList(extras: arrangement.later.compactMap { id in extras.first { $0.id == id } },
                               onLog: onLogPlannedActivity, minutes: todayMinutes)
                // A day with only activities keeps unplanned training here;
                // a planned workout changes through Swap (P25).
                if main == nil { somethingElse }
                AddAnotherWorkoutLine(sync: sync)
            }
            .todayFootRows()
        }
        .todayCardShell()
    }

    /// Today's activities under a workout the card can't lead with (a
    /// freestyle session, a workout needing review): logged ones as check
    /// lines, the rest under Later today with their own Log.
    @ViewBuilder private var extrasBeside: some View {
        let extras = todayExtras
        ForEach(extras.filter { plannedActivityLogged($0) }) { workout in
            TodayDoneLine(title: workout.name, detail: "Logged",
                          detailIdentifier: "today.extra.logged.\(workout.id)",
                          dividerBelow: false)
                .padding(.top, 8)
        }
        TodayLaterList(extras: extras.filter { !plannedActivityLogged($0) },
                       onLog: onLogPlannedActivity, minutes: todayMinutes)
    }

    /// Activities beside today's workout that are already logged.
    @ViewBuilder private func doneExtraLines(_ arrangement: TodayLineup.Arrangement,
                                             dividers: Bool = true) -> some View {
        ForEach(todayExtras.filter { arrangement.done.contains($0.id) }) { workout in
            TodayDoneLine(title: workout.name, detail: "Logged",
                          detailIdentifier: "today.extra.logged.\(workout.id)",
                          dividerBelow: dividers)
        }
    }

    /// The member's time for an item today, if they set one.
    private func todayMinutes(_ workout: Workout) -> Int? {
        ScheduleTimes.minutes(workout.id, onDate: sync.todayString, plan: sync.plan)
    }

    /// Today's planned activity counts as done once something logged today
    /// carries its name.
    private func plannedActivityLogged(_ workout: Workout) -> Bool {
        PlannedActivity.isLogged(workout.name,
                                 manual: sync.manualActivities(on: sync.todayString),
                                 synced: sync.activities(on: sync.todayString))
    }

    /// A workout that is one outdoor run and nothing else.
    private func soloPlannedRun(_ workout: Workout) -> TemplateExercise? {
        workout.exercises.count == 1 && workout.exercises[0].isOutdoorRun ? workout.exercises[0] : nil
    }

    private var weekSection: some View {
        TodayWeekSection(sync: sync, onOpenCalendar: { showCalendar = true }, onOpenActivity: onOpenActivity)
    }

    /// The day the card shows when it isn't today. A day left behind by
    /// midnight, or outside the window, reads as today again.
    private var otherDate: String? {
        guard let shownDate, let offset = TodayDays.offset(of: shownDate, from: sync.todayString),
              offset != 0, TodayDays.range.contains(offset) else { return nil }
        return shownDate
    }

    private var shownOffset: Int {
        otherDate.flatMap { TodayDays.offset(of: $0, from: sync.todayString) } ?? 0
    }

    private func canMoveDay(_ offset: Int) -> Bool {
        TodayDays.range.contains(shownOffset + offset)
    }

    /// Points the card `offset` days further; the swipe calls this while
    /// the card is off screen.
    private func applyDayMove(_ offset: Int) {
        let target = shownOffset + offset
        shownDate = target == 0 ? nil : TodayDays.date(target, from: sync.todayString)
    }

    /// Moves the card `offset` days, sliding it the way it goes.
    private func moveDay(_ offset: Int) {
        guard offset != 0, canMoveDay(offset) else { return }
        daySwipe.move(offset, reduceMotion: reduceMotion) { applyDayMove(offset) }
    }

    private func startChosenWorkout(_ id: String) {
        showOverridePicker = false
        showRoutine = false
        previewTarget = nil
        prepareNewWorkout {
            if sync.hasResumableWorkout && sync.resumableCheckpoint?.selectedDayID == id { sync.resumeWorkout() }
            else { sync.startOverride(dayID: id) }
        }
    }

    /// Ask at the user's explicit start action, before the runner begins. Rest
    /// scheduling itself must never surprise-interrupt the first logged set.
    private func prepareNewWorkout(_ start: @escaping @MainActor () -> Void) {
        #if DEBUG && targetEnvironment(simulator)
        UIFixtureStartTrace.record(.prepareEntered)
        #endif
        guard !isPreparingWorkoutStart else {
            #if DEBUG && targetEnvironment(simulator)
            UIFixtureStartTrace.record(.prepareAlreadyActive)
            #endif
            return
        }
        isPreparingWorkoutStart = true
        Task { @MainActor in
            #if DEBUG && targetEnvironment(simulator)
            UIFixtureStartTrace.record(.prepareTaskEntered)
            #endif
            await RestCue.requestNotificationPermissionIfNeeded()
            #if DEBUG && targetEnvironment(simulator)
            UIFixtureStartTrace.record(.permissionReturned)
            #endif
            guard !Task.isCancelled else {
                #if DEBUG && targetEnvironment(simulator)
                UIFixtureStartTrace.record(.prepareTaskCancelled)
                #endif
                isPreparingWorkoutStart = false
                return
            }
            #if DEBUG && targetEnvironment(simulator)
            UIFixtureStartTrace.record(.prepareInvokingStart)
            #endif
            start()
            isPreparingWorkoutStart = false
            #if DEBUG && targetEnvironment(simulator)
            UIFixtureStartTrace.record(.prepareReturned)
            #endif
        }
    }
}

// MARK: - Workout complete (today's session is done)

/// Shown when today's resolved session is COMPLETED. A clean recap with
/// NO primary START WORKOUT CTA and NO "Train a different day" override —
/// the single session-per-(user,date) invariant means any start would
/// re-open and double-log the completed row. The week strip and upcoming
/// days still tell you what's next; pull-to-refresh remains so a server
/// change is reflected.
private struct WorkoutDoneView<QuickStarts: View>: View {
    @ObservedObject var sync: SyncModel
    let onOpenCalendar: () -> Void
    let onOpenActivity: (() -> Void)?
    /// Activities today holds beside the finished workout, whether each is
    /// logged, and how to log one. One still to log leads the card.
    let extras: [Workout]
    let isLogged: (Workout) -> Bool
    let onLogActivity: ((String) -> Void)?
    /// Swiping the done card moves to other days, as on today's own card.
    let daySwipe: TodayDaySwipe
    /// A run or an activity can still follow a finished workout, at the
    /// foot of the done card.
    @ViewBuilder let quickStarts: QuickStarts
    /// Confirms discarding the just-completed session ("didn't really do
    /// this" — e.g. an accidental/test End workout).
    @State private var recordDate: IdentifiedString?
    @State private var showDiscardConfirm = false
    @State private var discardTarget: WorkoutTerminalActionTarget?

    private var doneWorkout: Workout? {
        sync.todaySession?.workout_id.flatMap { sync.workout(id: $0, on: sync.todayString) }
    }

    private var doneTemplateTitle: String { doneWorkout?.name ?? "Workout" }

    /// A workout that is only a planned run reads as the run, not as sets.
    private var isRunWorkout: Bool {
        guard let workout = doneWorkout else { return false }
        return !workout.exercises.isEmpty && workout.exercises.allSatisfy(\.isOutdoorRun)
    }

    private var doneRunSummary: String {
        guard let run = PlannedRunRecord.matchingRun(
            workoutName: doneWorkout?.name, among: sync.activities(on: sync.todayString)) else {
            return "Your run shows here once it syncs."
        }
        let line = PlannedRunRecord.headline(run, unit: RunDistanceUnit.preferred())
        return line.isEmpty ? "Run saved." : line
    }

    /// Logged WORKING sets for today's completed session — warmups
    /// excluded so the recap numbers match FinishedView (which uses
    /// `is_warmup == 0`) and never disagree seconds apart.
    private var todaySets: [SetLog] {
        guard let sid = sync.todaySession?.id else { return [] }
        return sync.setsForSession(sid).filter { $0.is_warmup == 0 }
    }

    /// "12 working sets · 4 exercises", or the run's distance and time.
    private var doneSummary: String {
        if isRunWorkout { return doneRunSummary }
        let sets = todaySets
        let exerciseCount = Set(sets.map(\.exercise_id)).count
        return "\(sets.count) working \(sets.count == 1 ? "set" : "sets") · \(exerciseCount) \(exerciseCount == 1 ? "exercise" : "exercises")"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                let arrangement = TodayLineup.arrange(main: (id: "workout", done: true),
                                                      extras: extras.map { (id: $0.id, done: isLogged($0)) })
                let doneExtras = extras.filter { arrangement.done.contains($0.id) }
                VStack(alignment: .leading, spacing: 4) {
                    TodayDayHeading(sync: sync, dateString: sync.todayString)
                    Group {
                        if let lead = extras.first(where: { $0.id == arrangement.lead }) {
                            // An activity still to log leads on navy; the
                            // finished workout shrinks to a check line above it.
                            VStack(alignment: .leading, spacing: 0) {
                                VStack(alignment: .leading, spacing: 0) {
                                    TodayDoneLine(title: doneTemplateTitle, detail: doneSummary,
                                                  actionTitle: isRunWorkout ? "View run" : "View workout",
                                                  action: { recordDate = IdentifiedString(id: sync.todayString) },
                                                  detailIdentifier: "today.completedSummary",
                                                  actionIdentifier: "today.viewCompletedWorkout",
                                                  dividerBelow: false)
                                    ForEach(doneExtras) { workout in
                                        TodayDoneLine(title: workout.name, detail: "Logged",
                                                      detailIdentifier: "today.extra.logged.\(workout.id)",
                                                      dividerBelow: false)
                                    }
                                }
                                .todayDoneBand()
                                TodayNextActivity(workout: lead, onLog: onLogActivity)
                                    .todayLeadBand(hasAction: onLogActivity != nil)
                                VStack(alignment: .leading, spacing: 0) {
                                    TodayLaterList(extras: arrangement.later.compactMap { id in extras.first { $0.id == id } },
                                                   onLog: onLogActivity)
                                    quickStarts
                                    AddAnotherWorkoutLine(sync: sync)
                                }
                                .todayFootRows()
                            }
                            .todayCardShell()
                        } else {
                            // Everything is done: nothing to start, so no navy.
                            VStack(alignment: .leading, spacing: 0) {
                                VStack(alignment: .leading, spacing: 0) {
                                    HStack(spacing: 6) {
                                        Image(systemName: "checkmark.seal.fill")
                                            .font(.subheadline)
                                            .foregroundStyle(Theme.done)
                                            .accessibilityHidden(true)
                                        TodaySectionLabel(text: isRunWorkout ? "RUN COMPLETE" : "WORKOUT COMPLETE", color: Theme.done)
                                    }
                                    Text(doneTemplateTitle)
                                        .font(Theme.display(30)).foregroundStyle(Theme.text)
                                        .lineLimit(2).minimumScaleFactor(0.7)
                                        .padding(.top, 8)
                                    Text(doneSummary)
                                        .font(.headline.monospacedDigit()).foregroundStyle(Theme.text)
                                        .padding(.top, 4)
                                        .accessibilityIdentifier("today.completedSummary")
                                    Button {
                                        recordDate = IdentifiedString(id: sync.todayString)
                                    } label: {
                                        HStack(spacing: 4) {
                                            Text(isRunWorkout ? "View run" : "View workout")
                                            Image(systemName: "chevron.right").font(.caption.weight(.bold))
                                        }
                                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                                        .frame(minHeight: 44).contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityIdentifier("today.viewCompletedWorkout")
                                    // Activities logged beside it, under the workout.
                                    ForEach(doneExtras) { workout in
                                        TodayDoneLine(title: workout.name, detail: "Logged",
                                                      detailIdentifier: "today.extra.logged.\(workout.id)",
                                                      dividerBelow: false)
                                    }
                                }
                                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 8)
                                VStack(alignment: .leading, spacing: 0) {
                                    quickStarts
                                    AddAnotherWorkoutLine(sync: sync)
                                }
                                .todayFootRows()
                            }
                            .todayCardShell()
                        }
                    }
                    .modifier(daySwipe)
                }
                // The day's other workouts sit under the card, as on a day
                // still to do.
                if sync.plan != nil, DailyWorkoutAgenda.showsCombinedAgenda(sync.dailyWorkoutAgenda) {
                    DayWorkoutsView(sync: sync, onLogPlannedActivity: onLogActivity)
                }

                TodayWeekSection(sync: sync, onOpenCalendar: onOpenCalendar, onOpenActivity: onOpenActivity)

                if let err = sync.loadError {
                    Text(err).font(.footnote).foregroundStyle(Theme.danger)
                }
            }
            .readableColumn()
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
        }
        .refreshable { await sync.load() }
        .sheet(item: $recordDate) { date in
            NavigationStack {
                DayAgendaView(sync: sync, dateString: date.id)
                    .navigationTitle("Workout record")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { recordDate = nil }
                        }
                        ToolbarItem(placement: .bottomBar) {
                            Button("Discard workout", role: .destructive) {
                                let target = sync.terminalActionTarget
                                discardTarget = target?.date == date.id ? target : nil
                                showDiscardConfirm = discardTarget != nil
                            }
                            .disabled(sync.hasDiscardIntentForCurrentWorkout)
                        }
                    }
                    .confirmationDialog("Discard this workout?", isPresented: $showDiscardConfirm,
                                        titleVisibility: .visible) {
                        Button("Discard — don't save", role: .destructive) {
                            guard let target = discardTarget else { return }
                            Task { await sync.discardWorkout(expected: target); recordDate = nil }
                        }
                        Button("Keep workout", role: .cancel) {}
                    } message: {
                        Text("The logged sets will be removed and this workout will no longer count.")
                    }
            }
        }
    }
}

private struct ProgressBar: View {
    let exercises: [TemplateExercise]
    let currentIndex: Int
    let sync: SyncModel

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(exercises.enumerated()), id: \.element.id) { i, ex in
                GeometryReader { geo in
                    let ratio = min(1, Double(sync.runnerSetsDone(ex)) / Double(max(1, ex.target_sets)))
                    let complete = sync.runnerSetsDone(ex) >= ex.target_sets
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 2).fill(Theme.surface2)
                        RoundedRectangle(cornerRadius: 2)
                            .fill(complete ? Theme.done : Theme.signal)
                            .frame(width: geo.size.width * (complete ? 1 : ratio))
                    }
                    .overlay(
                        RoundedRectangle(cornerRadius: 2)
                            .stroke(i == currentIndex ? Theme.signal : .clear, lineWidth: 1))
                }
                .frame(height: 4)
            }
        }
    }
}

// MARK: - Runner

private struct RunnerView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var stacksControls: Bool { dynamicTypeSize >= .xxLarge }
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var sync: SyncModel
    @ObservedObject var auth: AuthModel
    @ObservedObject var stationLink: StationLinkController
    var onExpandRest: (() -> Void)? = nil
    /// Opens the run recorder for an outdoor run slot. Nil where recording
    /// isn't supported; the slot then keeps the timed controls.
    var onStartRun: ((TemplateExercise) -> Void)? = nil

    /// Tap-to-edit on the big weight number → decimal-pad sheet. Persists
    /// the in-flight edit string (`""` while the sheet is open and the user
    /// has cleared the field — TextField needs a Binding, not a transient
    /// value) so a partially-typed entry isn't lost on a re-render.
    @State private var editingWeight = false
    @State private var weightDraft = WeightEntryDraft(weight: 0, storedUnit: .lb, unit: .lb)
    @AppStorage(WeightUnit.preferenceKey) private var weightUnitRaw = "lb"
    private var weightUnit: WeightUnit { WeightUnit(rawValue: weightUnitRaw) ?? .lb }
    /// Exercise information sheet, openable mid-workout — not just from the
    /// pre-start preview (#54).
    private struct InformationDestination: Identifiable {
        let id = UUID()
        let exercise: TemplateExercise
        var startsOnHistory = false
    }
    @State private var informationFor: InformationDestination?
    private struct SetValueDraft: Identifiable {
        let id = UUID()
        let input: RunnerInputState
        let exercise: TemplateExercise
        let setNumber: Int
    }
    @State private var valueDraft: SetValueDraft?
    @State private var weightPrescription: RunnerPrescription?
    @AppStorage(RestCue.defaultsKey) private var timerCuesEnabled = true
    @AppStorage(StationLink.enabledAccountDefaultsKey) private var stationLinkEnabledAccount = ""
    private var showsStationLink: Bool { StationLink.isAvailable && UIDevice.current.userInterfaceIdiom == .phone }
    private var stationLinkEnabled: Binding<Bool> {
        Binding(get: { StationLink.isEnabled(storedAccount: stationLinkEnabledAccount, accountID: auth.userID) },
                set: { stationLinkEnabledAccount = $0 ? (auth.userID ?? "") : "" })
    }

    @State private var showingOutline = false
    /// One tap from the exercise menu, instead of through the outline.
    @State private var swapping: WorkoutSwapTarget?
    @State private var addingExercise = false
    @State private var sessionExerciseTarget: SessionExerciseActionTarget?
    @State private var warmupDraft: SessionWarmupDraft?
    @State private var showingPlates = false
    @State private var loadRevealedFor: Set<String> = []
    @StateObject private var displayIdleTimer = StationIdleTimerOverride()

    var body: some View {
        if let ex = sync.currentExercise {
            let blocks = ExerciseGroupBlock.blocks(sync.exercises)
            let group = blocks.first { $0.isGroup && $0.members.contains { $0.id == ex.id } }
            Group {
            if UIDevice.current.userInterfaceIdiom == .pad {
                ipadRunner(ex)
            } else {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text(sync.isFreestyle ? "Freestyle" : "Exercise \(sync.exerciseIndex + 1) of \(sync.exercises.count)")
                                .font(.subheadline).foregroundStyle(Theme.muted)
                            Spacer()
                            if sync.workoutStart != nil {
                                TimelineView(.periodic(from: .now, by: 1)) { _ in
                                    Text(clock(sync.workoutElapsedSeconds))
                                        .font(.subheadline.monospacedDigit()).foregroundStyle(Theme.muted)
                                        .accessibilityLabel("Workout elapsed")
                                        .accessibilityValue(clock(sync.workoutElapsedSeconds))
                                }
                            }
                        }
                        if !sync.isFreestyle {
                            ProgressBar(exercises: sync.exercises, currentIndex: sync.exerciseIndex, sync: sync)
                        }
                        let titleLayout = stacksControls
                            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                            : AnyLayout(HStackLayout(alignment: .center, spacing: 8))
                        titleLayout {
                            Text(ex.exercise_name.uppercased())
                                .font(Theme.display(32)).foregroundStyle(Theme.text)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .accessibilityIdentifier("runner.exerciseTitle")
                            if stacksControls {
                                Button("Technique & history", systemImage: "info.circle") {
                                    informationFor = InformationDestination(exercise: ex)
                                }
                                    .font(.subheadline).frame(minHeight: 44)
                                    .accessibilityLabel("Exercise information for " + ex.exercise_name)
                                exerciseMenu(ex)
                            } else {
                                HStack(spacing: 0) {
                                    ExerciseInfoButton(exerciseName: ex.exercise_name) {
                                        informationFor = InformationDestination(exercise: ex)
                                    }
                                    exerciseMenu(ex)
                                }
                            }
                        }
                        if let group {
                            groupCard(group, current: ex)
                        } else {
                            HStack {
                                Text(sync.isFreestyle ? "Set \(sync.currentSetNumber)" : "Set \(min(sync.currentSetNumber, ex.target_sets)) of \(ex.target_sets)")
                                if ex.isWarmup { WarmupTag() }
                                Spacer()
                                Text("\(sync.runnerRestSeconds(for: ex))s rest")
                                    .accessibilityIdentifier("runner.restPrescription")
                            }
                            .font(.subheadline).foregroundStyle(Theme.muted)
                        }
                        setEntry(ex)
                        Button { showingOutline = true } label: {
                            Label("Workout outline", systemImage: "list.bullet")
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .accessibilityIdentifier("runner.outline")
                    }
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    // At XXL and above, actions share the scroll view so the
                    // footer cannot consume the input viewport on a small phone.
                    if stacksControls { runnerActions(ex) }
                }
                .contentShape(Rectangle())
                if !stacksControls { runnerActions(ex) }
            }
            }
            }
            .sheet(isPresented: $showingOutline) { workoutOutline(blocks: blocks) }
            .sheet(item: $swapping) { target in WorkoutExerciseSwapSheet(sync: sync, target: target) }
            .sheet(isPresented: $addingExercise) { FreestyleExercisePicker(sync: sync) }
            .sheet(item: $sessionExerciseTarget) { target in
                SessionExercisePicker(sync: sync, target: target.session)
            }
            .sheet(item: $warmupDraft) { draft in SessionWarmupSheet(sync: sync, draft: draft) }
            .sheet(isPresented: $showingPlates) {
                BarbellLoadingView(target: sync.weight, unit: ex.targetWeightUnit)
            }
            #if DEBUG && targetEnvironment(simulator)
            .onAppear { UIFixtureStartTrace.record(.runnerAppeared) }
            #endif
            .onChange(of: sync.timedActive) { wasActive, isActive in
                if wasActive && !isActive { showingOutline = false }
            }
            .sheet(isPresented: $editingWeight) {
                WeightEditorSheet(
                    draft: $weightDraft,
                    allowsAssistance: ex.allowsAssistance,
                    onSave: {
                        // Trim and parse — empty / non-numeric drafts cancel
                        // silently rather than zeroing the working weight.
                        if let v = weightDraft.storedWeight, sync.currentExercise.map(RunnerPrescription.init) == weightPrescription {
                            sync.setWeight(v)
                        }
                        editingWeight = false
                    },
                    onCancel: { editingWeight = false }
                )
            }
            .sheet(item: $valueDraft) { draft in
                SetValuesEditor(title: "Next set", values: SetCorrectionValues(
                    weight: draft.input.weight, reps: draft.input.reps, rpe: draft.input.rpe,
                    durationSeconds: draft.input.prescription.timed ? draft.input.durationSeconds : nil),
                    timed: draft.input.prescription.timed, allowsAssistance: draft.exercise.allowsAssistance,
                    storedUnit: draft.exercise.targetWeightUnit,
                    unilateral: draft.exercise.isUnilateral,
                    loadIsKnown: draft.input.hasKnownWeight,
                    onSave: { values in
                        sync.setRunnerValues(values, expected: draft.input.prescription, expectedSetNumber: draft.setNumber)
                    })
            }
            .sheet(item: $informationFor) { destination in
                let ex = destination.exercise
                ExerciseInformationSheet(sync: sync, information: ExerciseInformation(
                    prescription: ex, catalog: sync.catalogRow(ex.exercise_id)),
                    startsOnHistory: destination.startsOnHistory)
            }
            .onAppear {
                guard UIDevice.current.userInterfaceIdiom == .pad else { return }
                displayIdleTimer.begin()
                refreshDisplayIdleTimer()
            }
            .onChange(of: scenePhase) { _, _ in refreshDisplayIdleTimer() }
            .onDisappear { displayIdleTimer.end() }
        }
    }

    private func refreshDisplayIdleTimer() {
        displayIdleTimer.update(cameraRunning: false, partnerOpen: false,
            foreground: scenePhase == .active, workoutDisplay: true)
    }

    private func ipadRunner(_ ex: TemplateExercise) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            WorkoutDisplayView(state: WorkoutDisplayState.project(sync: sync, displayUnit: weightUnit)) {
                VStack(spacing: 12) {
                    HStack(spacing: 16) {
                        Button { openValues(ex) } label: {
                            Label("Edit set", systemImage: "slider.horizontal.3")
                                .frame(minHeight: 44)
                        }
                        .accessibilityIdentifier("runner.editValues")
                        .disabled(sync.timedActive || sync.isSetEntryBlocked(ex))
                        Button { showingOutline = true } label: {
                            Label("Workout outline", systemImage: "list.bullet")
                                .frame(minHeight: 44)
                        }
                        .accessibilityIdentifier("runner.outline")
                    }
                    .font(Theme.mono(14, .bold)).foregroundStyle(Theme.accent)
                    if hasLastSetReview { LastRunnerSetReview(sync: sync, compact: true) }
                    // Reserve a separate target for ending rest so a second tap
                    // at this position can never become a set submission.
                    if sync.restEndDate != nil {
                        Button("End rest") { sync.skipRest() }
                            .buttonStyle(WorkoutPrimaryButtonStyle())
                            .accessibilityIdentifier("rest.done")
                    } else {
                        Spacer(minLength: 0).frame(height: 44)
                    }
                    RunnerSetAction(sync: sync, ex: ex)
                        .disabled(sync.restEndDate != nil)
                }
            }
        }
    }

    private func openValues(_ ex: TemplateExercise) {
        if let input = sync.currentInputState {
            valueDraft = SetValueDraft(input: input, exercise: ex, setNumber: sync.currentPhysicalSetNumber)
        }
    }

    /// Match the correction view's visible source, including a queued set or
    /// a tombstone arriving after its shortcut was first shown.
    private var hasLastSetReview: Bool {
        guard let id = sync.lastRunnerSetID else { return false }
        return sync.sets.contains {
            $0.id == id && $0.deleted_at == nil && $0.session_id == sync.todaySession?.id
        } || sync.currentWorkoutPendingSets.contains { $0.id == id }
    }

    private func runnerActions(_ ex: TemplateExercise) -> some View {
        VStack(spacing: 4) {
            // Rest and the last-set shortcut appear only when they have
            // something to show, so the inputs keep the room otherwise. The
            // footer grows upward from the logging action, which stays put;
            // End rest is its own row and never becomes a logging button.
            if sync.restEndDate != nil {
                RestPill(sync: sync, horizontalPadding: 0, onExpand: { onExpandRest?() })
            }
            if hasLastSetReview {
                LastRunnerSetReview(sync: sync, compact: true)
                    .frame(minHeight: 44, alignment: .leading)
            }
            if showsStationLink && stationLinkEnabled.wrappedValue {
                #if APP_STORE_BUILD
                Label(stationLink.needsKey ? "Go online once to set up iPad Station" :
                      stationLink.isConnected ? "Workout shown on your iPad" :
                      stationLink.connection == .unavailable ? "Open iPad display to retry the connection" :
                      "Looking for your iPad Station", systemImage: "ipad.landscape")
                    .font(.footnote).foregroundStyle(Theme.muted)
                    .accessibilityIdentifier("runner.station.status")
                #else
                StationLinkRunnerPanel(sync: sync, link: stationLink, ex: ex)
                    .id(sync.currentWorkoutScope)
                #endif
            }
            RunnerSetAction(sync: sync, ex: ex,
                            onStartRun: ex.isOutdoorRun ? onStartRun.map { start -> () -> Void in { start(ex) } } : nil)
        }
        .padding(.horizontal, 20).padding(.vertical, 8)
        .background(Theme.bg)
    }

    @ViewBuilder private func setEntry(_ ex: TemplateExercise) -> some View {
        if ex.isOutdoorRun && onStartRun != nil {
            runEntry(ex)
        } else {
            setValuesEntry(ex)
        }
    }

    /// An outdoor run records in the run recorder, so the runner shows its
    /// plan instead of set values.
    private func runEntry(_ ex: TemplateExercise) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("PLANNED RUN").font(Theme.mono(12, .bold)).tracking(1).foregroundStyle(Theme.accent)
            PlannedRunPrescription(exercise: ex)
            Text("Start the run to record it with GPS. Saving it marks this run done.")
                .font(.caption).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .accessibilityIdentifier("runner.plannedRun")
    }

    private func setValuesEntry(_ ex: TemplateExercise) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !sync.isFreestyle {
                Text((sync.isSessionAddedExercise(ex) || sync.sessionAddedSetCount(for: ex) > 0
                      ? "This session · " : "Target · ") + ex.prescriptionLabel(in: weightUnit))
                    .font(.caption).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("runner.target")
                if sync.isSessionAddedExercise(ex) {
                    Text("Added for this workout only").font(.caption).foregroundStyle(Theme.muted)
                        .accessibilityIdentifier("runner.sessionAddition")
                } else if sync.sessionAddedSetCount(for: ex) > 0 {
                    let extraSets = sync.sessionAddedSetCount(for: ex)
                    let unit = ex.group_id != nil ? (extraSets == 1 ? "round" : "rounds") : (extraSets == 1 ? "set" : "sets")
                    Text("\(ex.target_sets - extraSets) planned + \(extraSets) extra \(unit) for this workout")
                        .font(.caption).foregroundStyle(Theme.muted)
                        .accessibilityIdentifier("runner.sessionAddition")
                }
            }
            previousPerformance(ex)
            if ex.showsLoadControl {
                if ex.isBodyweight && sync.weight == 0 && !loadRevealedFor.contains(ex.id) {
                    Button { loadRevealedFor.insert(ex.id) } label: {
                        HStack {
                            Text("Bodyweight").foregroundStyle(Theme.text)
                            Spacer()
                            Text("Add load/assistance").foregroundStyle(Theme.accent)
                        }
                        .font(.subheadline).frame(minHeight: 44)
                    }
                    .accessibilityIdentifier("runner.addBodyweightLoad")
                    .disabled(sync.timedActive)
                } else {
                    loadControl(ex: ex).disabled(sync.timedActive)
                }
            }
            if ex.isTimed {
                if sync.timedActive {
                    TimedSetView(sync: sync, ex: ex)
                } else {
                    Button { openValues(ex) } label: { TimedSetView(sync: sync, ex: ex) }
                        .buttonStyle(.plain).disabled(sync.isSetEntryBlocked(ex))
                        .accessibilityLabel("Edit duration")
                }
            } else {
                stepper(label: ex.isUnilateral ? "Reps per side" : "Reps",
                        value: "\(sync.reps)", context: ex.isUnilateral ? "reps per side" : "reps",
                        steps: [("−1", { sync.adjustReps(-1) }, false),
                                ("+1", { sync.adjustReps(1) }, false)],
                        onTapValue: { openValues(ex) })
                if ex.isUnilateral {
                    Text("Complete both sides, then log one set.")
                        .font(.caption).foregroundStyle(Theme.muted)
                }
            }
            Button { openValues(ex) } label: {
                HStack {
                    Text(sync.rpe.map { "Actual RPE \(SetValueFormatter.number($0))" } ?? "Add actual RPE")
                    Spacer()
                    Image(systemName: "slider.horizontal.3")
                }
                .font(.subheadline).frame(minHeight: 44)
            }
            .accessibilityLabel("Edit next set for \(ex.exercise_name)")
            .accessibilityIdentifier("runner.editValues")
            .disabled(sync.timedActive || sync.isSetEntryBlocked(ex))
        }
        .padding(12).background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func previousPerformance(_ ex: TemplateExercise) -> some View {
        let previous = sync.comparablePreviousSets(for: ex)
        let values = previous.prefix(3).map { set in
            SetValueFormatter.value(weight: set.weightUnit.convert(set.weight, to: weightUnit),
                reps: set.reps, durationSeconds: set.duration_s, timed: ex.isTimed,
                bodyweight: ex.isBodyweight, unit: weightUnit.rawValue,
                unilateral: ex.isUnilateral, repLoadUnit: weightUnit.rawValue)
                + (ex.isPerHand && set.weight != 0 ? " each hand" : "")
                + (set.rpe.map { " · RPE " + SetValueFormatter.number($0) } ?? "")
        }.joined(separator: "; ")
        let more = previous.count > 3 ? " · +\(previous.count - 3) more sets" : ""
        let empty = sync.isUsingCachedState || !sync.hasVerifiedPlanState || sync.loadError != nil
            ? "Previous session unavailable · History" : "No comparable previous session · History"
        return VStack(alignment: .leading, spacing: 4) {
            Button {
                informationFor = InformationDestination(exercise: ex, startsOnHistory: true)
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(previous.isEmpty ? empty : "Last session · " + values + more)
                        .font(.caption).multilineTextAlignment(.leading)
                        .lineLimit(stacksControls ? nil : 2)
                    Image(systemName: "chevron.right").font(.caption2).accessibilityHidden(true)
                }
                .foregroundStyle(Theme.muted).frame(minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("runner.previousSession")
            .accessibilityHint("Opens exercise history")
            if let cues = ex.cues?.trimmingCharacters(in: .whitespacesAndNewlines), !cues.isEmpty {
                Text("Cue · " + cues).font(.caption).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("runner.cue")
            }
        }
    }

    private func groupCard(_ block: ExerciseGroupBlock, current: TemplateExercise) -> some View {
        let next = sync.nextGroupExercise(afterLogging: current)
        return VStack(alignment: .leading, spacing: 5) {
            Text((block.isWarmup ? "Warm-up · " : "") + "\(block.title) · Round \(min(sync.currentSetNumber, block.rounds)) of \(block.rounds)")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                .accessibilityIdentifier("runner.group")
            Text("\(sync.runnerGroupRestSeconds(for: current, kind: .round))s round rest · \(sync.runnerGroupRestSeconds(for: current, kind: .transition))s between exercises")
                .font(.caption).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("runner.group.restPrescription")
            ForEach(Array(block.members.enumerated()), id: \.element.id) { index, member in
                let active = member.id == current.id
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: active ? "arrow.right.circle.fill" : "circle")
                        .accessibilityHidden(true)
                    Text(block.memberLabel(at: index) + " · " + member.exercise_name)
                        .fontWeight(active ? .semibold : .regular)
                    Spacer(minLength: 0)
                    if sync.isSkipped(member) { Text("Skipped") }
                    else if active { Text("Now") }
                    else { Text("\(sync.runnerSetsDone(member))/\(member.target_sets)").monospacedDigit() }
                }
                .font(.caption).foregroundStyle(active ? Theme.accent : Theme.muted)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("runner.group.member.\(member.id)")
            }
            if let next {
                Text(next.id == current.id ? "Next · Continue \(next.exercise_name)"
                     : "Next · \(next.exercise_name): \(next.prescriptionLabel(in: weightUnit))")
                    .font(.caption).foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("runner.group.next")
            }
        }
    }

    private func workoutOutline(blocks: [ExerciseGroupBlock]) -> some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if sync.timedActive {
                        Text("Timer running · Browse freely. Return to the timer to log this set.")
                            .font(.subheadline).foregroundStyle(Theme.accent)
                            .accessibilityIdentifier("runner.preview.timer")
                    }
                    if let ex = sync.currentExercise {
                        DisclosureGroup { outlineOptions(ex) } label: {
                            Text("Current exercise options").frame(minHeight: 44)
                        }
                        .font(.subheadline)
                    }
                    ForEach(blocks) { block in
                        VStack(alignment: .leading, spacing: 12) {
                            if block.isGroup {
                                Text(block.title).font(.headline).foregroundStyle(Theme.accent)
                                Text("\(block.rounds) rounds · \(sync.runnerGroupRestSeconds(for: block.members[0], kind: .round))s round rest · \(sync.runnerGroupRestSeconds(for: block.members[0], kind: .transition))s between exercises")
                                    .font(.caption).foregroundStyle(Theme.muted)
                            }
                            ForEach(block.members) { member in
                                VStack(alignment: .leading, spacing: 8) {
                                    Button {
                                        guard !sync.timedActive else { return }
                                        if let index = sync.exercises.firstIndex(where: { $0.id == member.id }) { navigate(to: index) }
                                        showingOutline = false
                                    } label: {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(member.exercise_name).font(.headline)
                                            Text(member.id == sync.currentExercise?.id ? "Current exercise" : sync.isSkipped(member) ? "Skipped" : "\(sync.runnerSetsDone(member)) of \(member.target_sets) sets")
                                                .font(.caption).foregroundStyle(Theme.muted)
                                        }
                                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(sync.timedActive)
                                    .accessibilityLabel(member.exercise_name)
                                    .accessibilityIdentifier("runner.outline.exercise.\(member.id)")
                                    prescriptionContext(ex: member, isPreview: true)
                                    SetReviewList(sync: sync, sets: sync.todaySlotSets(member), pending: sync.pendingSetIntents(for: member))
                                    if !member.isWarmup {
                                        let warmup = RunnerSessionAdjustments.warmup(member)
                                        let warmupSets = sync.todaySlotSets(warmup)
                                        let pendingWarmups = sync.pendingSetIntents(for: warmup)
                                        if !warmupSets.isEmpty || !pendingWarmups.isEmpty {
                                            Text("Warm-ups").font(.subheadline.weight(.semibold))
                                                .accessibilityIdentifier("runner.outline.warmups.\(member.id)")
                                            SetReviewList(sync: sync, sets: warmupSets, pending: pendingWarmups)
                                        }
                                    }
                                }
                                if member.id != block.members.last?.id { Divider() }
                            }
                        }
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.surface).clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                }.padding(20)
            }
            .background(Theme.bg)
            .navigationTitle("Workout outline").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button(sync.timedActive ? "Return to timer" : "Done") { showingOutline = false }
                    .accessibilityIdentifier("runner.outline.done")
            } }
        }
    }

    /// The current exercise's actions, one tap from its name. The outline
    /// keeps the same actions for browsing other exercises.
    private func exerciseMenu(_ ex: TemplateExercise) -> some View {
        Menu {
            if sync.isFreestyle {
                Button("Add an exercise", systemImage: "plus") { addingExercise = true }
                    .disabled(sync.timedActive)
                    .accessibilityIdentifier("runner.menu.addExercise")
            } else {
                let setNumber = sync.sessionNextSetNumber(for: ex)
                let sessionTarget = sync.terminalActionTarget
                if ex.group_id != nil {
                    let roundTarget = sync.sessionRoundTarget(for: ex)
                    Button("Add a round (all group movements)", systemImage: "plus.circle") {
                        guard let roundTarget else { return }
                        _ = sync.addSessionRound(expected: roundTarget)
                    }
                    .disabled(roundTarget == nil)
                    .accessibilityIdentifier("runner.menu.addRound")
                } else {
                    Button("Add a set for this workout", systemImage: "plus.circle") {
                        guard let sessionTarget else { return }
                        _ = sync.addSessionSet(expected: ex, expectedSetNumber: setNumber, expectedSession: sessionTarget)
                    }
                    .disabled(sessionTarget == nil || !sync.canAddSessionSet(for: ex))
                    .accessibilityIdentifier("runner.menu.addSet")
                }
                if !ex.isTimed && !ex.isWarmup && ex.exercise_modality != "cardio" {
                    Button("Log a warm-up", systemImage: "figure.strengthtraining.traditional") {
                        guard let target = sessionTarget else { return }
                        warmupDraft = SessionWarmupDraft(session: target, exercise: ex)
                    }
                    .disabled(sessionTarget == nil || !sync.canLogWarmup(for: ex))
                    .accessibilityIdentifier("runner.menu.logWarmup")
                }
                Button("Add an exercise", systemImage: "plus") {
                    guard let target = sessionTarget else { return }
                    sessionExerciseTarget = SessionExerciseActionTarget(session: target)
                }
                .disabled(sessionTarget == nil || !sync.canAddSessionExercise)
                .accessibilityIdentifier("runner.menu.addExercise")
                if let target = sync.workoutSwapTarget {
                    Button("Swap exercise", systemImage: "arrow.triangle.swap") { swapping = target }
                        .accessibilityIdentifier("runner.menu.swap")
                }
            }
            if ex.exercise_modality == "barbell" {
                Button("Plates & warm-up guide", systemImage: "scalemass") { showingPlates = true }
                    .disabled(sync.runnerNeedsWeight)
                    .accessibilityIdentifier("runner.menu.plates")
            }
            Button("Skip this exercise", systemImage: "forward.end") { sync.skip() }
                .disabled(sync.timedActive)
                .accessibilityIdentifier("runner.menu.skip")
        } label: {
            if stacksControls {
                Label("Exercise options", systemImage: "ellipsis.circle")
                    .font(.subheadline).frame(minHeight: 44)
            } else {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
        }
        .accessibilityLabel("Options for " + ex.exercise_name)
        .accessibilityIdentifier("runner.exerciseMenu")
    }

    private func outlineOptions(_ ex: TemplateExercise) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Current exercise").font(.headline)
            NavigationLink("Technique & history") {
                ExerciseInformationSheet(sync: sync, information: ExerciseInformation(
                    prescription: ex, catalog: sync.catalogRow(ex.exercise_id)))
            }.frame(minHeight: 44)
            if sync.isFreestyle {
                NavigationLink("Add an exercise") { FreestyleExercisePicker(sync: sync) }
                    .frame(minHeight: 44).disabled(sync.timedActive)
                    .accessibilityIdentifier("runner.addFreestyleExercise")
            } else {
                let setNumber = sync.sessionNextSetNumber(for: ex)
                let sessionTarget = sync.terminalActionTarget
                if ex.group_id != nil {
                    let roundTarget = sync.sessionRoundTarget(for: ex)
                    Button {
                        guard let roundTarget else { return }
                        if sync.addSessionRound(expected: roundTarget) { showingOutline = false }
                    } label: {
                        Label("Add a round for this workout", systemImage: "plus.circle")
                            .frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .disabled(roundTarget == nil)
                    .accessibilityIdentifier("runner.outline.addRound")
                    Text("Includes every group movement, including skipped ones. This session only.")
                        .font(.caption).foregroundStyle(Theme.muted)
                } else {
                    Button {
                        guard let sessionTarget else { return }
                        if sync.addSessionSet(expected: ex, expectedSetNumber: setNumber, expectedSession: sessionTarget) {
                            showingOutline = false
                        }
                    } label: {
                        Label("Add a set for this workout", systemImage: "plus.circle")
                            .frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .disabled(sessionTarget == nil || !sync.canAddSessionSet(for: ex))
                    .accessibilityIdentifier("runner.outline.addSet")
                }
                if let target = sync.terminalActionTarget {
                    NavigationLink {
                        SessionExercisePicker(sync: sync, target: target, onAdded: { showingOutline = false })
                    } label: {
                        Text("Add an exercise").frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .disabled(!sync.canAddSessionExercise)
                    .accessibilityIdentifier("runner.outline.addExercise")
                    if sync.canLogWarmup(for: ex) {
                        NavigationLink {
                            SessionWarmupSheet(sync: sync,
                                draft: SessionWarmupDraft(session: target, exercise: ex),
                                onLogged: { showingOutline = false })
                        } label: {
                            Text("Log a warm-up").frame(minHeight: 44).contentShape(Rectangle())
                        }
                        .accessibilityIdentifier("runner.outline.logWarmup")
                    }
                }
                if let target = sync.workoutSwapTarget {
                    NavigationLink {
                        WorkoutExerciseSwapSheet(sync: sync, target: target)
                    } label: { Label("Swap exercise", systemImage: "arrow.triangle.swap") }
                        .frame(minHeight: 44).accessibilityIdentifier("runner.swap-exercise")
                }
            }
            Button { sync.skip(); showingOutline = false } label: {
                Text("Skip this exercise").frame(minHeight: 44)
            }
            .disabled(sync.timedActive)
            .accessibilityLabel("Skip \(ex.exercise_name)")
            Divider()
            WeightUnitPicker(selection: Binding(get: { weightUnit }, set: { weightUnitRaw = $0.rawValue }), identifier: "runner.weight.unit")
            Toggle("Timer sounds", isOn: $timerCuesEnabled)
                .tint(Theme.accent).frame(minHeight: 44)
                .onChange(of: timerCuesEnabled) { sync.refreshTimerCues() }
            if ex.exercise_modality == "barbell" {
                NavigationLink("Plates & warm-up guide") {
                    BarbellLoadingView(target: sync.weight, unit: ex.targetWeightUnit)
                }.frame(minHeight: 44)
            }
        }
        .font(.subheadline)
    }

    /// Outline browsing during a hold must never reseed inputs or change the
    /// executing slot. Full prescriptions stay readable in the outline.
    private func navigate(to index: Int) {
        guard !sync.timedActive, sync.exercises.indices.contains(index) else { return }
        sync.jump(to: index)
    }

    private func loadControl(ex: TemplateExercise) -> some View {
        let storedUnit = ex.targetWeightUnit
        let unit = weightUnit.rawValue
        let displayedWeight = storedUnit.convert(sync.weight, to: weightUnit)
        let label = ex.allowsAssistance ? "Load / assistance (\(unit))"
            : "Weight (\(unit))" + (ex.isPerHand ? " · each hand" : "")
        let sign = ex.allowsAssistance && displayedWeight > 0 ? "+" : ""
        let value = sign + WeightUnit.text(displayedWeight)
        // Converted loads (18 lb → 8.165 kg) truncate at the display size;
        // show one decimal and keep the exact value for editing/VoiceOver.
        let display = sign + SetValueFormatter.number(displayedWeight)
        let small = weightUnit == .kg ? 2.5 : 5.0
        let large = weightUnit == .kg ? 5.0 : 10.0
        return VStack(spacing: 8) {
            if sync.runnerNeedsWeight {
                Button {
                    openWeight(ex, blank: true)
                } label: {
                    HStack {
                        Text("Choose weight")
                        Spacer()
                        Text(unit + (ex.isPerHand ? " each hand" : ""))
                    }
                    .font(.headline).frame(minHeight: 44)
                    .padding(.horizontal, 12)
                    .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
                }
                .accessibilityIdentifier("runner.chooseWeight")
                Text("Enter the weight you will lift before logging.")
                    .font(.caption).foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                stepper(
                    label: label,
                    value: value,
                    display: display,
                    context: "weight in \(unit)" + (ex.isPerHand ? " per hand" : ""),
                    steps: [
                        ("−" + WeightUnit.text(large), { sync.adjustWeight(weightUnit.convert(-large, to: storedUnit)) }, true),
                        ("−" + WeightUnit.text(small), { sync.adjustWeight(weightUnit.convert(-small, to: storedUnit)) }, false),
                        ("+" + WeightUnit.text(small), { sync.adjustWeight(weightUnit.convert(small, to: storedUnit)) }, false),
                        ("+" + WeightUnit.text(large), { sync.adjustWeight(weightUnit.convert(large, to: storedUnit)) }, true),
                    ],
                    onTapValue: { openWeight(ex) })
                if !sync.isFreestyle {
                    Text(sync.runnerWeightSource == .target ? "From target"
                         : sync.runnerWeightSource == .previousSet ? "From last session" : "Your load")
                        .font(.caption).foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("runner.weightSource")
                }
            }
        }
    }

    private func openWeight(_ ex: TemplateExercise, blank: Bool = false) {
        weightDraft = WeightEntryDraft(weight: sync.weight, storedUnit: ex.targetWeightUnit, unit: weightUnit)
        if blank { weightDraft.text = "" }
        weightPrescription = RunnerPrescription(ex)
        editingWeight = true
    }

    private func stepper(label: String, value: String, display: String? = nil, context: String,
                         steps: [(String, () -> Void, Bool)],
                         onTapValue: (() -> Void)? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption).foregroundStyle(Theme.muted)
            if stacksControls {
                stepperValue(value, display: display, context: context, onTap: onTapValue)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(steps, id: \.0) { s in
                        stepBtn(s.0, s.2, context: context, value: value, s.1)
                    }
                }
            } else {
                HStack(spacing: 8) {
                    ForEach(Array(steps.prefix(steps.count / 2)), id: \.0) { s in
                        stepBtn(s.0, s.2, context: context, value: value, s.1)
                    }
                    stepperValue(value, display: display, context: context, onTap: onTapValue)
                    ForEach(Array(steps.suffix(steps.count - steps.count / 2)), id: \.0) { s in
                        stepBtn(s.0, s.2, context: context, value: value, s.1)
                    }
                }
            }
        }
    }

    @ViewBuilder private func stepperValue(_ value: String, display: String? = nil, context: String,
                                          onTap: (() -> Void)?) -> some View {
        let number = Text(display ?? value).font(Theme.number(32)).foregroundStyle(Theme.text)
            .lineLimit(1).minimumScaleFactor(0.5)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 44)
        if let onTap {
            Button(action: onTap) {
                number.overlay(alignment: .bottom) {
                    Rectangle().fill(Theme.muted.opacity(0.35))
                        .frame(height: 1).padding(.horizontal, 8)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Edit " + context)
            .accessibilityValue(value)
            .accessibilityIdentifier(context.hasPrefix("weight") ? "runner.weight" : "runner.reps")
        } else {
            number.accessibilityLabel(context).accessibilityValue(value)
        }
    }

    private func stepBtn(_ t: String, _ lg: Bool, context: String, value: String,
                         _ a: @escaping () -> Void) -> some View {
        Button(action: a) {
            Text(t).font(Theme.mono(15, .bold))
                .frame(maxWidth: stacksControls ? .infinity : nil)
                .frame(width: stacksControls ? nil : 44)
                .frame(minHeight: 44)
                .background(Theme.surface2).foregroundStyle(Theme.text)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .accessibilityLabel("\(t.hasPrefix("−") ? "Decrease" : "Increase") \(context) by \(t.dropFirst())")
        .accessibilityValue(value)
    }

    private func prescriptionContext(ex: TemplateExercise, isPreview: Bool = false) -> some View {
        let target = (isPreview ? "" : "PRESCRIBED · ") + ex.prescriptionLabel(in: weightUnit)
        let previous = sync.comparablePreviousSets(for: ex)
        let previousLabel = previous.map { set in
            let value = SetValueFormatter.value(weight: set.weightUnit.convert(set.weight, to: weightUnit),
                reps: set.reps, durationSeconds: set.duration_s, timed: ex.isTimed,
                bodyweight: ex.isBodyweight, unit: weightUnit.rawValue, unilateral: ex.isUnilateral)
            let effort = set.rpe.map { " RPE " + SetValueFormatter.number($0) } ?? ""
            return value + effort
        }.joined(separator: " · ")
        return VStack(alignment: .leading, spacing: isPreview ? 6 : 8) {
            Text(target).font(Theme.mono(isPreview ? 18 : 11, .bold)).foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            if let cues = ex.cues, !cues.isEmpty {
                Text(cues).font(.subheadline).foregroundStyle(Theme.muted)
            }
            if !previous.isEmpty {
                Text("LAST TIME (\(weightUnit.rawValue)) · " + previousLabel).font(Theme.mono(11)).foregroundStyle(Theme.muted)
            } else if !isPreview {
                Text("No comparable previous session").font(.caption).foregroundStyle(Theme.muted)
            }
        }.padding(.top, isPreview ? 0 : 16)
    }

}

// MARK: - Weight editor sheet

/// Decimal-pad sheet for direct weight entry — handles weird-increment
/// machines (14.3 lb plate stack) the ±5/±10 stepper can't reach without
/// adding more buttons. Parent holds the draft string so an in-flight edit
/// survives a re-render. Auto-focus + select-all so the typical flow is
/// tap → keypad up → type → Save.
private struct WeightEditorSheet: View {
    @Binding var draft: WeightEntryDraft
    @AppStorage(WeightUnit.preferenceKey) private var weightUnitRaw = "lb"
    private var unit: String { draft.unit.rawValue }
    let allowsAssistance: Bool
    let onSave: () -> Void
    let onCancel: () -> Void

    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    WeightUnitPicker(selection: Binding(get: { draft.unit }, set: {
                        draft.select($0)
                        weightUnitRaw = $0.rawValue
                    }))
                    Text("WEIGHT (\(unit))")
                        .font(Theme.mono(11, .bold)).tracking(2)
                        .foregroundStyle(Theme.muted)
                        .padding(.top, 8)
                    TextField("0", text: $draft.text)
                        .keyboardType(allowsAssistance ? .numbersAndPunctuation : .decimalPad)
                        .multilineTextAlignment(.center)
                        .font(Theme.number(56))
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, 20).padding(.vertical, 14)
                        .background(Theme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .focused($focused)
                        .accessibilityLabel("Weight in \(unit)")
                        .accessibilityIdentifier("weight.entry")
                    Text(allowsAssistance
                         ? "Positive adds load · negative records assistance"
                         : "Any value — \(unit) (e.g. 14.3)")
                        .font(Theme.mono(11)).foregroundStyle(Theme.muted)
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.bg.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel", action: onCancel)
                        .foregroundStyle(Theme.muted)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save", action: onSave)
                        .disabled(draft.storedWeight == nil || (!allowsAssistance && (draft.storedWeight ?? -1) < 0))
                        .font(Theme.mono(14, .bold))
                        .foregroundStyle(Theme.accent)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear { focused = true }
    }
}

private struct TimedSetView: View {
    @ObservedObject var sync: SyncModel
    let ex: TemplateExercise

    var body: some View {
        VStack(spacing: 16) {
            Text(sync.timedActive ? "HOLD" : "DURATION")
                .font(Theme.mono(10, .bold)).tracking(2).foregroundStyle(Theme.muted)

            if sync.timedActive, let end = sync.timedEndDate {
                TimelineView(.periodic(from: .now, by: 0.2)) { ctx in
                    let remaining = max(0, Int(ceil(end.timeIntervalSince(ctx.date))))
                    Text("\(remaining)s")
                        .font(Theme.number(64))
                        .foregroundStyle(remaining <= 0 ? Theme.done : Theme.accent)
                        .accessibilityIdentifier("runner.timer.remaining")
                }
            } else {
                Text("\(sync.holdDurationSeconds)s")
                    .font(Theme.number(64))
                    .foregroundStyle(Theme.text)
            }

        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(Theme.surface).clipShape(RoundedRectangle(cornerRadius: 14))
        .padding(.top, 16)
    }
}

/// The current set action stays in the reserved footer while inputs scroll.
/// Keep the rendered slot and physical set number bound to the logging intent.
private struct RunnerSetAction: View {
    @ObservedObject var sync: SyncModel
    let ex: TemplateExercise
    /// Set for an outdoor run on a phone that can record it.
    var onStartRun: (() -> Void)? = nil
    var body: some View {
        let displayedSetNumber = sync.currentPhysicalSetNumber
        let physicalSetNumber = sync.currentPhysicalSetNumber
        let resting = sync.restEndDate != nil
        VStack(spacing: 6) {
            if let onStartRun, !sync.timedActive {
                Button("START RUN", action: onStartRun)
                    .buttonStyle(WorkoutPrimaryButtonStyle(size: .large))
                    .accessibilityIdentifier("runner.startRun")
            } else if ex.isTimed && sync.timedActive {
                TimelineView(.periodic(from: .now, by: 0.2)) { _ in
                    let canStop = sync.timedElapsed >= 2
                    let controlID = sync.timedControlID
                    VStack(spacing: 6) {
                        Button("STOP & LOG") {
                            Task { await sync.stopTimedSet() }
                        }
                        .buttonStyle(WorkoutPrimaryButtonStyle(size: .large, quiet: true))
                        .accessibilityIdentifier("runner.stopTimedSet")
                        .disabled(!canStop || sync.isTerminalMutationInFlight
                            || sync.hasPendingTerminalIntentForCurrentWorkout)
                        if !canStop {
                            Text("Stop & log is available after 2 seconds.")
                                .font(.caption).foregroundStyle(Theme.muted)
                                .accessibilityIdentifier("runner.timer.startGuard")
                        }
                        Button {
                            if let controlID { _ = sync.cancelTimedSet(controlID: controlID) }
                        } label: {
                            Text("Cancel timer without logging")
                                .frame(minHeight: 44).contentShape(Rectangle())
                        }
                        .font(.subheadline).foregroundStyle(Theme.muted)
                        .accessibilityIdentifier("runner.cancelTimedSet")
                        .disabled(sync.isTerminalMutationInFlight || sync.hasPendingTerminalIntentForCurrentWorkout)
                    }
                }
            } else if !sync.isFreestyle && sync.runnerSetsDone(ex) >= ex.target_sets {
                Text("EXERCISE COMPLETE")
                    .font(.title3.weight(.bold))
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .foregroundStyle(Theme.done)
                    .accessibilityIdentifier("runner.exerciseComplete")
                if sync.canAddSessionSet(for: ex), let sessionTarget = sync.terminalActionTarget {
                    let nextSet = sync.sessionNextSetNumber(for: ex)
                    Button {
                        _ = sync.addSessionSet(expected: ex, expectedSetNumber: nextSet, expectedSession: sessionTarget)
                    } label: {
                        Text("Add a set for this workout")
                            .frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .font(.subheadline)
                    .accessibilityIdentifier("runner.addSet")
                } else if let roundTarget = sync.sessionRoundTarget(for: ex) {
                    Button {
                        _ = sync.addSessionRound(expected: roundTarget)
                    } label: {
                        Text("Add a round (all group movements)")
                            .frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .font(.subheadline)
                    .accessibilityIdentifier("runner.addRound")
                }
            } else if ex.isTimed {
                Button("START SET \(displayedSetNumber)") {
                    sync.startTimedSet(
                        expected: ex,
                        expectedSetNumber: physicalSetNumber)
                }
                .buttonStyle(WorkoutPrimaryButtonStyle(size: .large))
                .accessibilityIdentifier("runner.startSet")
                .disabled(sync.isSetEntryBlocked(ex) || sync.runnerNeedsWeight)
            } else {
                Button("LOG SET \(displayedSetNumber)") {
                    Task { await sync.logCurrentSet(expected: ex, expectedSetNumber: physicalSetNumber) }
                }
                // Logging during rest stays available, but a quieter button
                // keeps the rest card the loudest thing on screen.
                .buttonStyle(WorkoutPrimaryButtonStyle(size: .large, quiet: resting))
                .accessibilityIdentifier("runner.logSet")
                .disabled(sync.isSetEntryBlocked(ex) || sync.runnerNeedsWeight)
            }
        }
        .frame(maxWidth: .infinity)
        .background(Theme.bg)
        .buttonStyle(.plain)
    }
}

// MARK: - Rest overlay (full screen)

private struct RestOverlay: View {
    @ReduceMotion private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject var sync: SyncModel
    /// Collapse the overlay to in-flow controls (timer keeps running). The
    /// pill caller restores it; this view never ends rest on its own —
    /// only DONE / +15 / −15 mutate the timer.
    let onMinimize: () -> Void
    @State private var editingRest: RestEditTarget?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.2)) { ctx in
            // restEndDate can flip to nil mid-render when DONE is tapped —
            // never force-unwrap it.
            let remaining = sync.restEndDate
                .map { Int(ceil($0.timeIntervalSince(ctx.date))) } ?? 0
            let frac: Double = {
                guard let end = sync.restEndDate, sync.restTotal > 0 else { return 0 }
                return max(0, min(1, end.timeIntervalSince(ctx.date) / Double(sync.restTotal)))
            }()
            ZStack {
                Theme.bg.ignoresSafeArea()
                GeometryReader { geometry in
                    ScrollView {
                        VStack(spacing: 0) {
                            Text("REST").font(Theme.mono(11, .bold)).tracking(4)
                                .foregroundStyle(Theme.muted).padding(.bottom, 8)
                            Text(clock(remaining))
                                .font(Theme.display(140))
                                // Already a large, full-width readout. Bounding
                                // its growth leaves the timer actions reachable.
                                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                                .lineLimit(1).minimumScaleFactor(0.2)
                                .frame(maxWidth: .infinity)
                                .accessibilityLabel(remaining <= 0 ? "Rest complete" : "Rest remaining")
                                .accessibilityValue(remaining <= 0 ? "" : "\(remaining) seconds")
                                .accessibilityIdentifier("rest.status")
                                .foregroundStyle(remaining <= 0 ? Theme.done : Theme.accent)
                                .shadow(color: (remaining <= 0 ? Theme.done : Theme.accent).opacity(0.4),
                                        radius: 30)
                                .opacity(remaining <= 0 && !reduceMotion ? (Int(ctx.date.timeIntervalSince1970 * 2) % 2 == 0 ? 1 : 0.4) : 1)

                            RoundedRectangle(cornerRadius: 3).fill(Theme.surface)
                                .frame(width: 240, height: 6)
                                .overlay(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 3).fill(Theme.signal)
                                        .frame(width: 240 * frac, height: 6)
                                }
                                .padding(.top, 24)

                            let buttonsLayout = dynamicTypeSize.isAccessibilitySize
                                ? AnyLayout(VStackLayout(spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
                            buttonsLayout {
                                restBtn("−15s") { sync.addRest(-15) }
                                    .accessibilityLabel("Shorten rest by 15 seconds")
                                restBtn("+15s") { sync.addRest(15) }
                                    .accessibilityLabel("Extend rest by 15 seconds")
                                restBtn("DONE", primary: true) { sync.skipRest() }
                                    .accessibilityLabel("End rest").accessibilityIdentifier("rest.done")
                            }
                            .padding(.top, 36)

                            Button {
                                editingRest = sync.restEditTarget
                            } label: {
                                Label("Change rest duration", systemImage: "slider.horizontal.3")
                                    .frame(minHeight: 44).contentShape(Rectangle())
                            }
                            .font(.subheadline).foregroundStyle(Theme.text)
                            .padding(.top, 12)
                            .disabled(sync.restEditTarget == nil)
                            .accessibilityIdentifier("rest.changeDuration")

                            VStack(spacing: 4) {
                                Text("UP NEXT").font(Theme.mono(11, .bold)).tracking(2)
                                    .foregroundStyle(Theme.muted)
                                Text(sync.finished ? "DONE" : sync.currentExercise?.exercise_name.uppercased() ?? "DONE")
                                    .font(Theme.display(22)).foregroundStyle(Theme.text)
                                    .accessibilityIdentifier("rest.upNext")
                            }
                            .padding(.top, 28)
                            RestNextSetValues(sync: sync).padding(.top, 6)
                            LastRunnerSetReview(sync: sync).padding(.top, 16)

                            // Peek-through: collapse to in-flow controls so the runner
                            // (current exercise, jump strip, completed sets) is
                            // visible/scrollable without ending the timer. Discoverable
                            // tap target; swipe-down on the overlay also minimizes.
                            Button(action: onMinimize) {
                                HStack(spacing: 6) {
                                    Image(systemName: "chevron.down")
                                        .font(.system(size: 11, weight: .bold))
                                    Text("PREVIEW WORKOUT")
                                        .font(Theme.mono(11, .bold)).tracking(2)
                                }
                                .foregroundStyle(Theme.muted)
                                .padding(.horizontal, 16).padding(.vertical, 12)
                                .frame(minHeight: 44)
                                .background(Capsule().fill(Theme.surface))
                            }
                            .padding(.top, 36)
                            .accessibilityIdentifier("rest.minimize")
                        }
                        .padding(20)
                        .frame(maxWidth: .infinity, minHeight: geometry.size.height)
                    }
                }
            }
            // Swipe-down anywhere on the overlay minimizes (matches the
            // sheet-dismissal idiom). Threshold high enough not to fight the
            // button taps above.
            .contentShape(Rectangle())
            .simultaneousGesture(
                DragGesture(minimumDistance: 30)
                    .onEnded { v in
                        if !dynamicTypeSize.isAccessibilitySize, v.translation.height > 60 {
                            onMinimize()
                        }
                    }
            )
        }
        .sheet(item: $editingRest) { target in SessionRestEditor(sync: sync, target: target) }
    }

    private func restBtn(_ t: String, primary: Bool = false,
                         _ a: @escaping () -> Void) -> some View {
        Button(action: a) {
            Text(t).font(Theme.mono(13, .bold))
                .padding(.horizontal, 18).padding(.vertical, 14)
                .background(primary ? Theme.accent : Theme.surface)
                .foregroundStyle(primary ? Theme.onAccent : Theme.text)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
}

// MARK: - Compact rest controls

/// Rest owns a separate row while it runs. Its End rest target remains an End
/// rest action after the deadline; logging is always a different button below it.
private struct RestPill: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject var sync: SyncModel
    var horizontalPadding: CGFloat = 20
    let onExpand: () -> Void

    var body: some View {
        Group {
            if let end = sync.restEndDate {
                TimelineView(.periodic(from: .now, by: 0.25)) { ctx in
                    let remaining = max(0, Int(ceil(end.timeIntervalSince(ctx.date))))
                    HStack(spacing: 10) {
                        Button(action: onExpand) {
                            Label(remaining == 0 ? "Rest complete" : "Rest · " + clock(remaining), systemImage: "timer")
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(remaining == 0 ? Theme.done : Theme.accent)
                                .frame(minHeight: 44).contentShape(Rectangle())
                        }
                        .accessibilityLabel("Expand rest timer")
                        .accessibilityValue("\(remaining) seconds remaining")
                        Spacer(minLength: 4)
                        Button { sync.skipRest() } label: {
                            Text("End rest").font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 12).frame(minHeight: 44)
                                .background(Theme.accent).foregroundStyle(Theme.onAccent)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .accessibilityIdentifier("rest.done")
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, horizontalPadding)
    }
}

private struct RestNextSetValues: View {
    @ObservedObject var sync: SyncModel
    @AppStorage(WeightUnit.preferenceKey) private var weightUnitRaw = "lb"

    var body: some View {
        if !sync.finished, let exercise = sync.currentExercise {
            let unit = WeightUnit(rawValue: weightUnitRaw) ?? .lb
            let storedUnit = exercise.targetWeightUnit
            let values = SetValueFormatter.value(
                weight: storedUnit.convert(sync.weight, to: unit), reps: sync.reps,
                durationSeconds: exercise.isTimed ? sync.holdDurationSeconds : nil,
                timed: exercise.isTimed, bodyweight: exercise.isBodyweight,
                unit: unit.rawValue, unilateral: exercise.isUnilateral)
            Text("Set \(sync.currentPhysicalSetNumber)" + (sync.isFreestyle ? " · " : " of \(exercise.target_sets) · ") + values
                 + (sync.weight != 0 && !exercise.isTimed ? " · \(unit.rawValue)" : "")
                 + (exercise.isPerHand ? " each hand" : ""))
                .font(.caption).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("rest.nextValues")
        }
    }
}

// MARK: - Finished

/// The one finish screen. The last set leads here, and so does Finish
/// workout in the workout menu while exercises remain (`onKeepWorking` set).
private struct FinishedView: View {
    @ObservedObject var sync: SyncModel
    @ObservedObject var stationLink: StationLinkController
    var onExpandRest: (() -> Void)? = nil
    /// Set when the member chose to finish before the runner did. Returns to
    /// the exercises without changing anything.
    var onKeepWorking: (() -> Void)? = nil
    @State private var addSetTarget: SessionExerciseActionTarget?
    @State private var sessionExerciseTarget: SessionExerciseActionTarget?

    /// All live WORKING sets in today's session (warm-ups excluded), taken
    /// straight from the session rather than per-slot so the same movement in
    /// two slots can't double-count the summary.
    private var todaysSets: [SetLog] {
        guard let sid = sync.todaySession?.id else { return [] }
        return sync.sets.filter {
            $0.session_id == sid && $0.deleted_at == nil && $0.is_warmup == 0
        }
    }

    /// Sets the plan asks for that aren't logged or skipped. They don't count
    /// once the workout is finished.
    private var hasUnloggedSets: Bool {
        !sync.isFreestyle && sync.exercises.contains {
            !sync.isSkipped($0) && sync.runnerSetsDone($0) < $0.target_sets
        }
    }

    var body: some View {
        let finishPending = sync.currentTerminalIntent?.action == .finish
            && sync.currentTerminalIntent?.deliveryState != .acknowledged
        let earlyFinish = onKeepWorking != nil
        // Finishing early is always allowed. Otherwise a correction that
        // reopens work sends the member back to it first.
        let readyToFinish = earlyFinish || sync.canFinishResolvedWorkout
        let finishingEarly = earlyFinish && hasUnloggedSets
        ScrollView {
            VStack(spacing: 16) {
                if let onExpandRest {
                    RestPill(sync: sync, horizontalPadding: 0, onExpand: onExpandRest)
                }
                if let logged = stationLink.lastLogged {
                    StationLinkUndoRow(sync: sync, link: stationLink, logged: logged)
                }
                Text(finishPending ? "Waiting" : finishingEarly ? "Finish early"
                     : readyToFinish ? "Sets done" : "Review sets")
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(finishingEarly && !finishPending ? Theme.accent : Theme.done)
                    .multilineTextAlignment(.center)
                if finishingEarly && !finishPending {
                    Text("Unlogged sets won't count")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("feedback.earlyFinishNote")
                } else {
                    Text(finishPending
                        ? "Finish saved on this device"
                        : readyToFinish ? "Ready to finish" : "Exercises to complete")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                }

                if !sync.isFreestyle && !finishPending, let target = sync.terminalActionTarget {
                    VStack(spacing: 8) {
                        if sync.exercises.contains(where: { sync.canAddSessionSet(for: $0) || sync.sessionRoundTarget(for: $0) != nil }) {
                            Button {
                                addSetTarget = SessionExerciseActionTarget(session: target)
                            } label: {
                                Label("Add sets or a round", systemImage: "plus.circle")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .contentShape(Rectangle())
                            }
                            .accessibilityIdentifier("finished.addSet")
                        }
                        if sync.canAddSessionExercise {
                            Button {
                                sessionExerciseTarget = SessionExerciseActionTarget(session: target)
                            } label: {
                                Label("Add an exercise", systemImage: "plus")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .contentShape(Rectangle())
                            }
                            .accessibilityIdentifier("finished.addExercise")
                            Text("More work in this session only. Your saved workout stays unchanged.")
                                .font(.caption).foregroundStyle(Theme.muted)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .font(.subheadline)
                }

                let sets = todaysSets
                // Match the WorkoutDoneView rollup: reps count both sides;
                // volume also counts both implements for per-hand loads.
                let reps = sync.totalReps(for: sets)
                // The queued count and review list belong to this workout,
                // including when another workout on the date is still queued.
                let pendingWorkout = sync.currentWorkoutPendingSets
                VStack(spacing: 0) {
                    sumRow("Sets saved", "\(sets.count)")
                    let queued = pendingWorkout.count
                    if queued > 0 { sumRow("Sets queued on this device", "\(queued)") }
                    if reps > 0 {
                        sumRow("Total reps", "\(reps)")
                    }
                    // Each unit keeps its own total; lb and kg never sum.
                    let tonnage = sync.tonnageByUnit(for: sets)
                    if !tonnage.isEmpty {
                        sumRow("Volume", WeightUnit.totals(tonnage) { "\(Int($0))" })
                    }
                }
                .padding(.top, 20)
                Text("Your workout summary and any records appear after you finish.")
                    .font(.caption).foregroundStyle(Theme.muted)
                ForEach(sync.metricCohorts(for: sets)) { cohort in
                    sumRow(sync.exerciseName(cohort.key.exerciseID), cohort.valueLabel)
                }

                SetReviewList(sync: sync, sets: sync.sets.filter {
                    $0.session_id == sync.todaySession?.id && $0.deleted_at == nil
                }, pending: pendingWorkout)
                WorkoutFeedbackEntry(sync: sync)
                if let onKeepWorking {
                    Button(action: onKeepWorking) {
                        Text("Keep working").frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .disabled(sync.hasPendingTerminalIntentForCurrentWorkout)
                } else if readyToFinish {
                    Button { sync.jump(to: sync.exerciseIndex) } label: {
                        Text("Return to exercises").frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .disabled(sync.hasPendingTerminalIntentForCurrentWorkout)
                }

            }
            .padding(28)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Button {
                guard readyToFinish else { sync.reviewIncompleteExercises(); return }
                guard let target = sync.terminalActionTarget else { return }
                if earlyFinish {
                    Task { await sync.finishWorkout(expected: target) }
                } else {
                    Task { await sync.finishResolvedWorkout(expected: target) }
                }
            } label: {
                Text(finishPending ? "WAITING TO SYNC" : readyToFinish ? "FINISH WORKOUT" : "REVIEW EXERCISES")
            }
            .buttonStyle(WorkoutPrimaryButtonStyle(size: .large))
            .accessibilityIdentifier(readyToFinish || finishPending ? "FINISH" : "finished.reviewExercises")
            .disabled(
                sync.hasPendingTerminalIntentForCurrentWorkout)
            .padding(.horizontal, 20).padding(.vertical, 10)
            .background(Theme.background)
        }
        .sheet(item: $addSetTarget) { target in
            SessionAddSetSheet(sync: sync, target: target.session, onAdded: onKeepWorking)
        }
        .sheet(item: $sessionExerciseTarget) { target in
            SessionExercisePicker(sync: sync, target: target.session, onAdded: onKeepWorking)
        }
    }

    private func sumRow(_ a: String, _ b: String) -> some View {
        HStack {
            Text(a).font(Theme.mono(13)).foregroundStyle(Theme.text)
            Spacer()
            Text(b).font(Theme.mono(13)).foregroundStyle(Theme.muted)
                .accessibilityIdentifier("summary.value." + a)
        }
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Divider().overlay(Theme.surface2) }
    }
}

/// Today's card answers a sideways swipe by moving a day (P20), and VoiceOver
/// gets the same moves as actions.
struct TodayDaySwipe: ViewModifier {
    @ObservedObject var state: DaySwipeState
    let canMove: (Int) -> Bool
    /// Changes the day without animating; the swipe animates around it.
    let apply: (Int) -> Void
    /// Changes the day with the slide, for the actions.
    let move: (Int) -> Void

    func body(content: Content) -> some View {
        content
            .daySwipe(state, canMove: canMove) { offset in apply(offset) }
            .accessibilityElement(children: .contain)
            .accessibilityAction(named: "Next day") { move(1) }
            .accessibilityAction(named: "Previous day") { move(-1) }
    }
}
