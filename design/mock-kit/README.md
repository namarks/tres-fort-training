# Mock kit

Quick HTML mocks of real Tres Fort screens, for trying a palette or a layout
idea before touching SwiftUI. They use the app's own color tokens, read from
`ios/Shared/BrandPalette.swift` on every run, and copy the layouts of the
current screens:

| Screen | Copies |
|---|---|
| `screens/today.html` | Today with a workout scheduled (`TodayView`, `TodayWeekSection`, `WeekFortView`) |
| `screens/today-run.html` | Today with a planned run: its figures, then Details, Swap and Skip (`PlannedRunGlance`, `DayActionsRow`) |
| `screens/day-details.html` | Details for a planned run, with Edit (`WorkoutDetailsView`) |
| `screens/day-edit-run.html` | Edit a run for one day: one kind of run and one amount (`DayRunChangeView`) |
| `screens/day-swap.html` | Swap: tiles by kind (`WorkoutDatePickerView`, `DayKindGrid`) |
| `screens/day-skip.html` | Skip's confirmation (`dayRestConfirmation`) |
| `screens/plan-week.html` | The Plan tab's Schedule side (`WorkoutsView.planHome`, `PlanWeekSummary`, `PlanItemLabel`) |
| `screens/plan-weekday.html` | A weekday opened from Your week (`WeekdayPlanSheet`) |
| `screens/plan-add.html` | Add to your week (`PlanComposerView`) |
| `screens/activity.html` | Activity, History side (`ActivityTabView`, `ActivityHistoryView`) |
| `screens/run-detail.html` | A run opened from History (`DayAgendaView` focused on one activity, `ActivityChartsView`) |
| `screens/coach-connect.html` | Connect your coach before sharing is allowed (`CoachConnectView.consentSection`) |
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
