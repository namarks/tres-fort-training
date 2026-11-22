import SwiftUI

// Très Fort on Apple Watch (docs/plans/apple-watch P4). The Watch app is
// the iPhone app's companion: it shows the day the iPhone sends over
// WatchConnectivity and never signs in or calls the Worker.
@main
struct TresFortWatchApp: App {
    @StateObject private var model = WatchDayModel.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            content
                .onChange(of: scenePhase) { _, phase in
                    // The civil day can turn over while the app is asleep.
                    if phase == .active { model.refreshToday() }
                }
        }
        // The iPhone sent a day while the app was not in front: take it, so
        // the complication is current before the app is opened.
        .backgroundTask(.watchConnectivity) {
            await WatchDayModel.shared.receivePending()
        }
    }

    @ViewBuilder private var content: some View {
        #if DEBUG
        if WatchComplicationGallery.isRequested() {
            WatchComplicationGallery(complication: WatchComplication(model.screen))
        } else {
            WatchTodayView(model: model)
        }
        #else
        WatchTodayView(model: model)
        #endif
    }
}
