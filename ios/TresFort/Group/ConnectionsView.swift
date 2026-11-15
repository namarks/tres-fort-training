import SwiftUI

/// Available activity sources, with device-routing guidance on demand.
struct ConnectionsView: View {
    @ObservedObject var groupModel: GroupModel
    @ObservedObject var health: HealthKitSyncModel
    /// Opens WHOOP's and Garmin's own settings; nil leaves those rows out.
    var auth: AuthModel? = nil

    var body: some View {
        Form {
            Section("Activity sources") {
                ConnectionSourceRows(groupModel: groupModel, health: health, auth: auth)
            }

            Section {
                ConnectionDeviceGuidance()
            }
        }
        .navigationTitle("Connections")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Device names help members find the service that can bring in their workouts.
/// Shared with setup so discovery does not require a trip back to Profile.
struct ConnectionDeviceGuidance: View {
    var body: some View {
        DisclosureGroup("Apple Watch or another device?") {
            Group {
                Text("For Apple Watch workouts, connect Apple Health on your iPhone.")
                    .accessibilityIdentifier("connections.appleWatchGuidance")
                Text("Connect Zwift, Polar, Wahoo or COROS to intervals.icu, then connect intervals.icu here. Garmin also connects directly.")
                    .accessibilityIdentifier("connections.otherDevicesGuidance")
                Text("Strava-synced activities arrive without details. Connect your device to intervals.icu directly.")
            }
            .font(.footnote)
            .foregroundStyle(Theme.muted)
        }
    }
}

/// One row per activity source, each opening its own settings. Connections
/// and first-run setup share them, so a source reads and connects the same in
/// both places.
struct ConnectionSourceRows: View {
    enum Source: CaseIterable { case intervals, appleHealth, garmin, whoop }

    @ObservedObject var groupModel: GroupModel
    @ObservedObject var health: HealthKitSyncModel
    /// Opens WHOOP's and Garmin's own settings; nil leaves those rows out.
    var auth: AuthModel? = nil
    var order: [Source] = Source.allCases

    /// Setup lists the sources that bring in runs and rides first for a
    /// member whose week has them, and Apple Health first otherwise.
    static func setupOrder(endurance: Bool) -> [Source] {
        endurance ? [.garmin, .intervals, .appleHealth, .whoop] : [.appleHealth, .garmin, .intervals, .whoop]
    }

    private var intervalsConnected: Bool {
        groupModel.intervalsStatus?.connected == true
    }
    private var intervalsNeedsReauth: Bool {
        groupModel.intervalsStatus?.needs_reauth == true
    }

    var body: some View {
        ForEach(order, id: \.self) { source in
            switch source {
            case .intervals: intervalsRow
            case .appleHealth: appleHealthRow
            case .garmin: if let auth { GarminConnectionRow(auth: auth) }
            case .whoop: if let auth { WhoopConnectionRow(auth: auth) }
            }
        }
    }

    private var intervalsRow: some View {
        NavigationLink {
            IntervalsSettingsView(groupModel: groupModel)
        } label: {
            HStack(spacing: 12) {
                // intervals.icu grants no use of its logo.
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.title3)
                    .foregroundStyle(Theme.accent)
                    .frame(width: ConnectionLogo.column)
                VStack(alignment: .leading, spacing: 3) {
                    Text("intervals.icu").font(.headline)
                    if groupModel.intervalsStatusUnavailable || groupModel.intervalsStatus == nil {
                        Text("Check connection status").font(.footnote).foregroundStyle(.secondary)
                    } else if intervalsNeedsReauth {
                        Label("Reconnect needed", systemImage: "exclamationmark.circle")
                            .font(.footnote).foregroundStyle(.orange)
                    } else if intervalsConnected && groupModel.intervalsStatus?.sync_pending == true {
                        Label("Connected · Sync pending", systemImage: "arrow.clockwise")
                            .font(.footnote).foregroundStyle(.orange)
                    } else if intervalsConnected {
                        Label("Connected", systemImage: "checkmark.circle.fill")
                            .font(.footnote).foregroundStyle(.green)
                    } else {
                        Text("Workouts and planned rides")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .accessibilityIdentifier("connections.intervals")
    }

    /// Apple Health: a live connector when HealthKit is available, otherwise a
    /// disabled "not available" row (e.g. iPad). Status mirrors the local intent
    /// flag (Apple hides read-auth, so there's no server truth to read).
    @ViewBuilder
    private var appleHealthRow: some View {
        if health.isAvailable {
            NavigationLink {
                AppleHealthSettingsView(health: health, groupModel: groupModel)
            } label: {
                AppleHealthConnectionLabel(health: health, weight: health.weight)
            }
            .accessibilityIdentifier("connections.appleHealth")
        } else {
            HStack(spacing: 12) {
                // Apple's icon is never dimmed, so only the words fade.
                ConnectionLogo(brand: .appleHealth)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Apple Health")
                    Text("Not available on this device")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .opacity(0.6)
                Spacer()
            }
        }
    }
}

/// Observe both permissions so changing weight updates the single source row.
private struct AppleHealthConnectionLabel: View {
    @ObservedObject var health: HealthKitSyncModel
    @ObservedObject var weight: BodyWeightModel

    var body: some View {
        HStack(spacing: 12) {
            ConnectionLogo(brand: .appleHealth)
            VStack(alignment: .leading, spacing: 2) {
                Text("Apple Health").font(.headline)
                if health.enabled || weight.enabled {
                    Label(health.enabled && weight.enabled ? "Workouts and weight enabled"
                          : weight.enabled ? "Weight enabled" : "Workouts enabled",
                          systemImage: "checkmark.circle.fill")
                        .font(.footnote).foregroundStyle(.green)
                } else {
                    Text("Workouts and body weight")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
}
