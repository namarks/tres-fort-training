import SwiftUI

/// Profile → Connections → WHOOP: connect, reconnect, sync now, disconnect.
struct WhoopSettingsView: View {
    @StateObject private var model: WhoopModel
    @State private var confirmingDisconnect = false
    @Environment(\.scenePhase) private var scenePhase

    init(auth: AuthModel) {
        _model = StateObject(wrappedValue: WhoopModel(auth: auth))
    }

    init(model: WhoopModel) {
        _model = StateObject(wrappedValue: model)
    }

    var body: some View {
        Form {
            Section {
                Text("Your WHOOP workouts arrive with your other activities, scored by heart rate, with WHOOP strain beside them. Each morning’s recovery, HRV, resting heart rate and sleep show on Today.")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
            Section {
                statusRow
                if let status = model.status, status.configured {
                    if !status.connected || status.needs_reauth {
                        Button(status.needs_reauth ? "Reconnect WHOOP" : "Connect WHOOP") {
                            Task { await model.connect() }
                        }
                        .disabled(model.isWorking)
                        .accessibilityIdentifier("whoop.connect")
                    } else {
                        Button("Sync now") { Task { await model.syncNow() } }
                            .disabled(model.isWorking)
                            .accessibilityIdentifier("whoop.sync")
                    }
                    // Disconnecting never needs WHOOP's permission again.
                    if status.connected {
                        Button("Disconnect WHOOP", role: .destructive) { confirmingDisconnect = true }
                            .disabled(model.isWorking)
                            .accessibilityIdentifier("whoop.disconnect")
                    }
                }
                if model.statusUnavailable {
                    Button("Try again") { Task { await model.loadStatus() } }
                        .accessibilityIdentifier("whoop.retryStatus")
                }
                if model.isWorking { ProgressView().frame(maxWidth: .infinity) }
            } footer: {
                Text("Only you see your WHOOP data. It isn’t shared with your groups or with AI apps you connect.")
            }
            if let message = model.message {
                Section { Text(message).foregroundStyle(Theme.text) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("WHOOP")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.loadStatus() }
        .refreshable { await model.loadStatus() }
        // Connecting finishes in a browser sheet; read the server again
        // whenever the app comes back, so the screen never shows a stale state.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.loadStatus() } }
        }
        .alert("Disconnect WHOOP?", isPresented: $confirmingDisconnect) {
            Button("Disconnect", role: .destructive) { Task { await model.disconnect() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your WHOOP workouts and recovery are removed from Très Fort. You can connect again anytime.")
        }
    }

    @ViewBuilder private var statusRow: some View {
        if model.statusUnavailable {
            Text("WHOOP status couldn’t be loaded.").foregroundStyle(Theme.muted)
        } else if let status = model.status {
            if !status.configured {
                Text("WHOOP isn’t available yet.").foregroundStyle(Theme.muted)
            } else if status.needs_reauth {
                CautionText("WHOOP needs you to sign in again.")
            } else if status.connected {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Connected", systemImage: "checkmark.circle.fill").foregroundStyle(Theme.done)
                    if let synced = status.last_synced_at {
                        Text("Last synced \(Date(timeIntervalSince1970: Double(synced) / 1000), style: .relative) ago")
                            .font(.footnote).foregroundStyle(Theme.muted)
                    }
                }
            } else {
                Text("Not connected").foregroundStyle(Theme.muted)
            }
        } else {
            ProgressView()
        }
    }
}

/// The WHOOP row under Connections → Activity sources. It shares its model
/// with the settings screen, so connecting or disconnecting there updates the
/// row's status when the member comes back.
struct WhoopConnectionRow: View {
    @StateObject private var model: WhoopModel

    init(auth: AuthModel) {
        _model = StateObject(wrappedValue: WhoopModel(auth: auth))
    }

    private var rowStatus: ConnectionRowStatus {
        .from(configured: model.status?.configured, connected: model.status?.connected == true,
              needsReauth: model.status?.needs_reauth == true,
              statusUnavailable: model.statusUnavailable)
    }

    var body: some View {
        NavigationLink {
            WhoopSettingsView(model: model)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "waveform.path.ecg")
                    .font(.title3)
                    .foregroundStyle(Theme.accent)
                    .frame(width: 30)
                VStack(alignment: .leading, spacing: 3) {
                    Text("WHOOP").font(.headline)
                    ConnectionRowSubtitle(status: rowStatus,
                                          description: "Workouts, recovery and sleep")
                }
            }
        }
        .accessibilityIdentifier("connections.whoop")
        .task { await model.loadStatus() }
    }
}

/// Today's recovery from WHOOP, under today's workout. Shows nothing unless
/// WHOOP is connected and has scored this morning.
struct RecoveryCard: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model: WhoopModel

    init(auth: AuthModel) {
        _model = StateObject(wrappedValue: WhoopModel(auth: auth))
    }

    var body: some View {
        // A VStack, not a Group: with no card it is still one empty view,
        // so its tasks run, and it takes no height in Today's column.
        VStack(spacing: 0) {
            if let day = model.today { card(day).padding(.top, 24) }
        }
        .task { await model.loadToday() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.loadToday() } }
        }
    }

    private func card(_ day: RecoveryDay) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            TodaySectionLabel(text: "RECOVERY · WHOOP")
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(WhoopFormat.percent(day.recovery_score) ?? "–")
                    .font(Theme.display(30)).foregroundStyle(Theme.text)
                if day.calibrating == true {
                    Text("Calibrating").font(.footnote).foregroundStyle(Theme.muted)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Recovery \(WhoopFormat.percent(day.recovery_score) ?? "not scored")")
            HStack(alignment: .top, spacing: 16) {
                metric("HRV", WhoopFormat.whole(day.hrv_rmssd_ms, unit: "ms"))
                metric("Resting HR", WhoopFormat.whole(day.resting_hr, unit: "bpm"))
                metric("Sleep", WhoopFormat.duration(day.sleep_ms),
                       detail: WhoopFormat.percent(day.sleep_performance_pct).map { "\($0) of need" })
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityIdentifier("today.recovery")
    }

    private func metric(_ title: String, _ value: String?, detail: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(Theme.muted)
            Text(value ?? "–").font(.headline.monospacedDigit()).foregroundStyle(Theme.text)
            if let detail { Text(detail).font(.caption2).foregroundStyle(Theme.muted) }
        }
        .accessibilityElement(children: .combine)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
