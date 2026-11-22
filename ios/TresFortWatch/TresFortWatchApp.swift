import SwiftUI

// Très Fort on Apple Watch (docs/plans/apple-watch P4). The Watch app is
// the iPhone app's companion: it shows the day the iPhone sends over
// WatchConnectivity and never signs in or calls the Worker.
@main
struct TresFortWatchApp: App {
    @StateObject private var model = WatchDayModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            WatchTodayView(model: model)
                .onChange(of: scenePhase) { _, phase in
                    // The civil day can turn over while the app is asleep.
                    if phase == .active { model.refreshToday() }
                }
        }
    }
}
