import SwiftUI

/// Moving between days with a sideways swipe (docs/plans/app-design-pass
/// P20), shared by the Plan tab's weekday sheet and Today's card. The content
/// follows the finger, slides out the way it was pushed while the next day
/// slides in from the other side, and the phone ticks once per day moved.
/// At the end of the range the content only stretches a little and springs
/// back. With Reduce Motion on, the day changes with a short fade instead.
@MainActor
final class DaySwipeState: ObservableObject {
    /// How far the content sits from its resting place, in points.
    @Published fileprivate(set) var slide: CGFloat = 0
    /// Bumps once per day moved; the haptic tick's trigger.
    @Published private(set) var moves = 0
    fileprivate var width: CGFloat = 390
    @Published fileprivate(set) var moving = false

    /// Moves `offset` days (+1 later, -1 earlier). `change` swaps the
    /// content to the new day while it is off screen.
    func move(_ offset: Int, reduceMotion: Bool, change: @escaping () -> Void) {
        guard offset != 0, !moving else { return }
        moving = true
        moves &+= 1
        if reduceMotion {
            withAnimation(.easeInOut(duration: 0.18)) {
                change()
                slide = 0
            } completion: {
                self.moving = false
            }
            return
        }
        let out: CGFloat = offset > 0 ? -width : width
        withAnimation(.easeIn(duration: 0.13)) {
            slide = out
        } completion: { [weak self] in
            guard let self else { return }
            var jump = Transaction()
            jump.disablesAnimations = true
            withTransaction(jump) {
                change()
                self.slide = -out
            }
            // One frame later, so the new day starts from the far side.
            DispatchQueue.main.async {
                withAnimation(.spring(duration: 0.3, bounce: 0.12)) {
                    self.slide = 0
                } completion: {
                    self.moving = false
                }
            }
        }
    }

    fileprivate func follow(_ dx: CGFloat, canMove: Bool) {
        guard !moving else { return }
        // Past the last day the content stretches a quarter as far.
        slide = canMove ? dx : dx / 4
    }

    fileprivate func settle() {
        guard !moving else { return }
        withAnimation(.spring(duration: 0.28, bounce: 0.2)) { slide = 0 }
    }

    /// Reads a sideways drag as a day move: far enough, or flicked, and
    /// mostly horizontal. Positive is a later day.
    static func offset(forDrag dx: CGFloat, dy: CGFloat, predictedDX: CGFloat) -> Int? {
        guard abs(dx) > abs(dy) * 1.5, abs(dx) > 80 || abs(predictedDX) > 220 else { return nil }
        return dx < 0 ? 1 : -1
    }
}

private struct DaySwipeModifier: ViewModifier {
    @ObservedObject var state: DaySwipeState
    let isEnabled: Bool
    let canMove: (Int) -> Bool
    let change: (Int) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var dragging = false

    func body(content: Content) -> some View {
        content
            // This applies to the card's controls, not the gesture below.
            // A horizontal drag cancels an armed button while vertical
            // scrolling remains available through the simultaneous gesture.
            .disabled(dragging || state.moving)
            .offset(x: state.slide)
            .opacity(1 - 0.4 * min(abs(state.slide) / max(state.width, 1), 1))
            .background(GeometryReader { geometry in
                Color.clear
                    .onAppear { state.width = geometry.size.width }
                    .onChange(of: geometry.size.width) { _, width in state.width = width }
            })
            // Global space: the content moves with the finger, so its own
            // space would halve the drag.
            .simultaneousGesture(
                DragGesture(minimumDistance: 20, coordinateSpace: .global)
                    .updating($dragging) { drag, active, _ in
                        if isEnabled, abs(drag.translation.width) > abs(drag.translation.height) * 1.5 {
                            active = true
                        }
                    }
                    .onChanged { drag in
                        guard isEnabled, !reduceMotion else { return }
                        let dx = drag.translation.width
                        guard abs(dx) > abs(drag.translation.height) * 1.5 else { return }
                        state.follow(dx, canMove: canMove(dx < 0 ? 1 : -1))
                    }
                    .onEnded { drag in
                        if isEnabled,
                           let offset = DaySwipeState.offset(forDrag: drag.translation.width,
                                                             dy: drag.translation.height,
                                                             predictedDX: drag.predictedEndTranslation.width),
                           canMove(offset) {
                            state.move(offset, reduceMotion: reduceMotion) { change(offset) }
                        } else {
                            state.settle()
                        }
                    }
            )
            .sensoryFeedback(.selection, trigger: state.moves)
    }
}

extension View {
    /// Lets a sideways swipe move this content a day at a time. `change`
    /// applies the move; `canMove` says whether a day exists that way.
    func daySwipe(_ state: DaySwipeState, isEnabled: Bool = true,
                  canMove: @escaping (Int) -> Bool = { _ in true },
                  change: @escaping (Int) -> Void) -> some View {
        modifier(DaySwipeModifier(state: state, isEnabled: isEnabled, canMove: canMove, change: change))
    }
}

/// The week as seven letters under the weekday sheet's title, showing which
/// day is open; tapping a letter goes to that day.
struct WeekdayStrip: View {
    let selected: String
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(PlanSchedule.weekdayKeys, id: \.self) { key in
                let name = WorkoutLibraryPolicy.weekdayNames[key] ?? key
                let isSelected = key == selected
                Button { onSelect(key) } label: {
                    Text(String(name.prefix(1)))
                        .font(Theme.mono(13, .bold))
                        .foregroundStyle(isSelected ? Theme.onAccent : Theme.muted)
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(isSelected ? Theme.accent : Color.clear))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(name)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
                .accessibilityIdentifier("weekday.strip.\(key)")
            }
        }
        .padding(.horizontal, 12)
        .background(Theme.background)
    }
}
