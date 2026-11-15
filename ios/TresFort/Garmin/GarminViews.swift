import SwiftUI

/// Profile → Connections → Garmin: connect, reconnect, disconnect.
struct GarminSettingsView: View {
    @StateObject private var model: GarminModel
    @State private var confirmingDisconnect = false
    @Environment(\.scenePhase) private var scenePhase

    init(auth: AuthModel) {
        _model = StateObject(wrappedValue: GarminModel(auth: auth))
    }

    init(model: GarminModel) {
        _model = StateObject(wrappedValue: model)
    }

    var body: some View {
        Form {
            Section {
                Text("Workouts you sync to Garmin Connect arrive with your other activities, with heart rate, pace and power. Garmin sends new workouts only, from the day you connect.")
                    .font(.footnote).foregroundStyle(Theme.muted)
                Text("If you also use intervals.icu, its copy of a workout is kept and the Garmin copy is hidden.")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
            Section {
                statusRow
                if let status = model.status, status.configured {
                    if !status.connected || status.needs_reauth || !status.activity_permission {
                        Button(status.connected ? "Reconnect Garmin" : "Connect Garmin") {
                            Task { await model.connect() }
                        }
                        .disabled(model.isWorking)
                        .accessibilityIdentifier("garmin.connect")
                    }
                    if status.connected {
                        Button("Disconnect Garmin", role: .destructive) { confirmingDisconnect = true }
                            .disabled(model.isWorking)
                            .accessibilityIdentifier("garmin.disconnect")
                    }
                }
                if model.statusUnavailable {
                    Button("Try again") { Task { await model.loadStatus() } }
                        .accessibilityIdentifier("garmin.retryStatus")
                }
                if model.isWorking { ProgressView().frame(maxWidth: .infinity) }
            } footer: {
                Text("Only you see your Garmin data. It isn’t shared with your groups or with AI apps you connect.")
            }
            if let message = model.message {
                Section { Text(message).foregroundStyle(Theme.text) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("Garmin Connect")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.loadStatus() }
        .refreshable { await model.loadStatus() }
        // Connecting finishes in a browser sheet; read the server again
        // whenever the app comes back, so the screen never shows a stale state.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.loadStatus() } }
        }
        .alert("Disconnect Garmin?", isPresented: $confirmingDisconnect) {
            Button("Disconnect", role: .destructive) { Task { await model.disconnect() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your Garmin workouts are removed from Très Fort and Garmin stops sending new ones. You can connect again anytime.")
        }
    }

    @ViewBuilder private var statusRow: some View {
        if model.statusUnavailable {
            Text("Garmin status couldn’t be loaded.").foregroundStyle(Theme.muted)
        } else if let status = model.status {
            if !status.configured {
                Text("Garmin isn’t available yet.").foregroundStyle(Theme.muted)
            } else if status.needs_reauth {
                CautionText("Garmin needs you to sign in again.")
            } else if status.connected && !status.activity_permission {
                CautionText("Garmin isn’t sharing your activities. Reconnect and allow Activities.")
            } else if status.connected {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Connected", systemImage: "checkmark.circle.fill").foregroundStyle(Theme.done)
                    if let synced = status.last_synced_at {
                        Text("Last workout received \(Date(timeIntervalSince1970: Double(synced) / 1000), style: .relative) ago")
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

/// The Garmin row under Connections → Activity sources. It shares its model
/// with the settings screen, so connecting or disconnecting there updates the
/// row's status when the member comes back.
struct GarminConnectionRow: View {
    @StateObject private var model: GarminModel

    init(auth: AuthModel) {
        _model = StateObject(wrappedValue: GarminModel(auth: auth))
    }

    private var rowStatus: ConnectionRowStatus {
        .from(configured: model.status?.configured, connected: model.status?.connected == true,
              needsReauth: model.status?.needs_reauth == true,
              sharing: model.status?.activity_permission == true,
              statusUnavailable: model.statusUnavailable)
    }

    var body: some View {
        NavigationLink {
            GarminSettingsView(model: model)
        } label: {
            HStack(spacing: 12) {
                // Garmin asks for the app's full name and its tile.
                ConnectionLogo(brand: .garminConnect)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Garmin Connect").font(.headline)
                    ConnectionRowSubtitle(status: rowStatus,
                                          description: "Workouts from your Garmin device")
                }
            }
        }
        .accessibilityIdentifier("connections.garmin")
        .task { await model.loadStatus() }
    }
}
