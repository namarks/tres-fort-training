#if DEBUG
import SwiftUI
import WidgetKit

/// The complication's sizes on one screen, for simulator screenshots: a
/// watch face can't be set up from the command line. Launch the Watch app
/// with `-watch-complication-gallery` and a fictional day
/// (`-watch-day-fixture today`). A real face tints and places these itself,
/// so this shows the words and layout, not the face. Debug builds only.
struct WatchComplicationGallery: View {
    static let argument = "-watch-complication-gallery"

    static func isRequested(in arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        arguments.contains(argument)
    }

    let complication: WatchComplication

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                WatchLabel(text: "Smart Stack")
                WatchComplicationView(family: .accessoryRectangular, complication: complication)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(WatchTheme.hero, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                WatchLabel(text: "Watch face")
                WatchComplicationView(family: .accessoryRectangular, complication: complication)
                HStack(spacing: 10) {
                    WatchComplicationView(family: .accessoryCircular, complication: complication)
                        .frame(width: 44, height: 44)
                        .background(WatchTheme.surface, in: Circle())
                    WatchComplicationView(family: .accessoryInline, complication: complication)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(WatchTheme.text)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
        .background(Color.black)
    }
}
#endif
