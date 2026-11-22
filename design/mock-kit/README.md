# Mock kit

Quick HTML mocks of real Tres Fort screens, for trying a palette or a layout
idea before touching SwiftUI. They use the app's own color tokens, read from
`ios/Shared/BrandPalette.swift` on every run, and copy the layouts of the
current screens:

| Screen | Copies |
|---|---|
| `screens/today.html` | Today with a workout planned: the date and goal event over the two-tone card, the light week chart and Coming up (`TodayView.lineupCard`, `TodayDayHeading`, `TodayWeekSection`, `WeekFortView`) |
| `screens/today-run.html` | Today with a planned run: one line of figures and Start on navy, then Details, Swap and Skip as links (`PlannedRunGlance`, `DayActionsRow`) |
| `screens/today-list.html` | Today as one list (app-design-pass P30): the next item on navy with Up next, its time, figures, Start and •••, finished rows shrunk, Add to today last (`TodayDayListView`, `TodayDayList`) |
| `screens/today-agenda.html` | Today with several workouts: the card leads, then the day's agenda as one list with one-word actions (`TodayView.daySection`, `DayWorkoutsView`) |
| `screens/today-rest.html` | Today on a rest day: a plain card with no navy (`TodayView.selectedWorkoutCard`, `todayPlainCard`) |
| `screens/day-details.html` | Details for a planned run, with Edit (`WorkoutDetailsView`) |
| `screens/day-edit-run.html` | Edit a run for one day: one kind of run and one amount (`DayRunChangeView`) |
| `screens/day-swap.html` | Swap: tiles by kind (`WorkoutDatePickerView`, `DayKindGrid`) |
| `screens/day-skip.html` | Skip's confirmation (`dayRestConfirmation`) |
| `screens/plan-week.html` | The Plan tab's Schedule side (`WorkoutsView.planHome`, `PlanWeekSummary`, `PlanItemLabel`) |
| `screens/plan-weekday.html` | A weekday opened from Your week (`WeekdayPlanSheet`) |
| `screens/plan-add.html` | Add to your week (`PlanComposerView`) |
| `screens/plan-add-ride.html` | Add to your week with Ride chosen (`PlanComposerView.enduranceSections`) |
| `screens/plan-add-home.html` | A weekday after tapping At home: the composer in place, the tile folded into one line (`WeekdayPlanSheet`, `PlanComposerView.DayContext`, `HomeRoutineSteppers`) |
| `screens/plan-block-a.html` | Option A for a block's own workouts: every-week entries shown in the block's days with an Every week tag, "In this block" under them (`ProgramWeekCard`, `BlockWorkoutRows`) |
| `screens/plan-block-b.html` | Option B: the block card switched to By workout (proposal, not built) |
| `screens/plan-block-c.html`, `plan-block-c-page.html` | Option C: Your week with block tags and the block on its own page (proposal, not built) |
| `screens/plan-block-setup.html` | Plan a block: what the block plans week by week (`ProgramSetupSheet`) |
| `screens/plan-block-workout.html` | One of the block's workouts: its days and Remove from block (`BlockWorkoutSheet`) |
| `screens/plan-event.html` | The Plan tab with a goal event leading the Schedule side (`EventPlanCard`) |
| `screens/plan-event-edit.html` | Set or edit the goal event (`EventGoalEditor`) |
| `screens/activity.html` | Activity, History side (`ActivityTabView`, `ActivityHistoryView`) |
| `screens/run-detail.html` | A run opened from History (`DayAgendaView` focused on one activity, `ActivityChartsView`) |
| `screens/coach-connect.html` | Connect your coach before sharing is allowed (`CoachConnectView.consentSection`) |
| `screens/coach-connected.html` | Connect your coach after Claude connected with the one-time connect link (`CoachConnectView.connectedSection`) |
| `screens/coach-approval.html` | Review AI access when an AI app sends the member back (`CoachApprovalView`) |
| `screens/run-recorder.html` | The run recorder's Step page during a planned run (`RunRecorderView.recordingPages`, `RunStepPage`) |
| `screens/run-recorder-map.html` | Its Map page, with the lap strip on top (`RunLapStrip`) |
| `screens/run-lock.html` | The Lock Screen during a planned run (`RunActivityWidget.lockScreenLayout`) |

```bash
node design/mock-kit/render.mjs                    # this checkout's palette, light and dark
node design/mock-kit/render.mjs --palette design/mock-kit/palettes/ink.json \
  --palette design/mock-kit/palettes/option-a-orange-accent.json   # compare palettes
node design/mock-kit/render.mjs --screens today --modes light --out /tmp/mocks
```

It writes one PNG per palette, screen and mode (402 x 874 points at 2x, an
iPhone 17 Pro) and `board.png` with them side by side, into `out/` unless
`--out` says otherwise. It needs Node 20+ and Playwright with Chromium
(`npm i -g playwright && npx playwright install chromium`, or any
`require('playwright')` that resolves).

## Apple Watch screens

`node design/mock-kit/watch.mjs` draws the Watch app's screens at 208 x 248
points (Apple Watch Series 10, 46 mm) with the same tokens, dark values only
because watchOS has one appearance: Today on the wrist, lifting from the
wrist and runs. It writes `watch-options.png` and one PNG per group into
`out/`. These are the three scopes put to the owner on 2026-11-22
([apple-watch plan](../../docs/plans/apple-watch/plan.md)); the owner chose
the whole day, lifting first. Today is built (`WatchTodayView`), without the
Start button, which arrives with lifting. Lifting and runs are proposals,
not built.

## Trying a palette

A palette file overrides any `BrandPalette` token per mode, by its Swift
name. Tokens it leaves out keep the shipped values.

```json
{
  "name": "A · Orange accent",
  "tabTint": "signal",
  "heroCard": false,
  "light": { "accent": "#c22d0c" },
  "dark":  { "accent": "#ee694f" },
  "css": "body .tabbar { background: var(--fort-navy); }"
}
```

- `tabTint` is the token the selected tab uses (read from `MainTabView.swift`
  when left out).
- `heroCard: false` draws `heroCard()` cards as plain cards, as the app did
  before the navy hero card existed.
- `css` adds rules for ideas that are more than a color swap, such as a navy
  title bar. Keep these small; if an idea needs real layout work, add a
  screen instead.

`palettes/` keeps the shipped and proposed palettes from earlier rounds:
`ink.json` is the palette on TestFlight 67 and before.

## Keeping it honest

- Mocks are for early options. Before shipping a visual change, capture the
  real screens with `scripts/capture-app-store-screenshots.sh` on a Mac and
  compare them with the mock.
- `reference/` holds real captures (iPhone 17 Pro, iOS 26.2, fictional data)
  of Today, the runner and the calendar for the Ink and navy palettes, to
  check the kit against. Today was calibrated against them; the Activity
  and run detail screens follow the SwiftUI code and have no capture yet.
- When a copied screen changes in SwiftUI, update its HTML here in the same
  PR, or note that the mock is out of date.
- A flow mock can mark the order of taps with `<span class="tap">1</span>`
  (yellow, not part of the app); the shipped screens here don't.
- SF Symbols and SF Pro are approximated with line icons and Inter where SF
  Pro isn't installed; Bebas Neue and JetBrains Mono come from
  `ios/TresFort/Fonts`.
