# Design system

How Tres Fort looks and why, for anyone changing a screen in the iOS app or
the web app. The code is the source of truth for values:

| What | Where |
|---|---|
| Color tokens | `ios/Shared/BrandPalette.swift` (app and widgets), `web/src/styles.css` (web app) |
| Type, cards and shared styles | `ios/TresFort/Theme.swift` |
| Primary button | `WorkoutPrimaryButtonStyle` in `ios/TresFort/WorkoutDetailsView.swift` |
| Contrast rules | `ios/TresFortTests/ThemeAccessibilityTests.swift` |
| Icon and brand colors | `docs/brand/README.md`, `docs/brand/app-icon.svg` |

Use `Theme` (or `BrandPalette` for colors `Theme` doesn't expose) in views.
Never write a hex value, `Color.blue`, `.orange` or another system color in a
view. If a screen needs a color that isn't a token, add the token, its
reason, and a contrast check.

## Principles

- **The icon is the system.** An orange fort on navy. The app uses those two
  colors and neutrals tinted toward the navy, nothing else for emphasis.
- **60 / 30 / 10.** About 60% neutral surfaces, 30% navy (text, controls, key
  cards) and 10% orange (what to do next). If orange is everywhere, it no
  longer tells the member what to tap.
- **One loud thing per screen.** At most one orange primary action per screen.
  Everything else is navy, muted or plain.
- **No per-sport rainbow.** Sports, members and activity kinds are told apart
  by label and icon first. The categorical colors exist only where a chart
  or list needs to separate series, and are equally quiet.
- **Light and dark both first-class.** Every token resolves for the system
  appearance. Dark mode is navy, not black.
- **Works without AI.** Coach-written content uses the same components as
  member-written content; nothing is styled as "AI".

## Color roles

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` / `bgTop` | `#F2F6FB` / `#FDFDFE` | `#0D1826` / `#111F30` | Page; `Theme.background` blends the two |
| `surface` | `#FDFDFE` | `#142234` | Cards, rows, sheets |
| `surface2` | `#E2E9F1` | `#1F3045` | Steppers, tracks, chips, secondary fills |
| `text` | `#0F1D2F` | `#F2F5F9` | Body text and headings |
| `muted` | `#525F6F` | `#A8B6C8` | Secondary text, captions, section labels |
| `dim` | `#989FA8` | `#505C6C` | Decorative only (grid lines, disabled); never for text that matters |
| `accent` | `#23436C` | `#97BAE7` | Navy: links, tints, toggles, selection, chart lines |
| `onAccent` | white | `#091628` | Labels on an accent fill |
| `signal` | `#C22D0C` | `#EC7859` | Orange as text or thin marks: selected tab, set progress, rest bar, routes |
| `signalFill` / `onSignal` | `#EE694F` / `#091628` | same | The primary action's fill and its label |
| `done` | `#31693F` | `#82C38F` | Logged, complete, saved |
| `danger` | `#AF3C3A` | `#EB827B` | Destructive actions and errors |
| `hero` / `heroEdge` | `#15273E` | `#1A314E` / `#314968` | A screen's key card (`heroCard()`) |
| `heroRaised` | `#2A4466` | same | Tiles and rules inside a hero card (`RaisedFill`) |
| `weekPlanned` | `#798EA8` | `#556E8E` | A planned day's tower in Today's week chart, 3:1 on the page |
| `fort*` | fixed | fixed | The icon's fort: Activity's navy week card, and the orange towers of Today's week chart |
| `categorical` | six hues | six hues | Telling series apart, never emphasis |

Rules:

- Text tokens (`text`, `muted`, `accent`, `signal`, `done`, `danger`,
  `categorical`) keep **4.5:1** on `bg`, `bgTop`, `surface` and `surface2` in
  both modes. Fills keep 4.5:1 with their label. The tests enforce this; run
  them after any token change.
- Orange is for **what to do next or where you are**: the primary action,
  today, current progress, the selected tab. Not for headings, decoration or
  warnings.
- `danger` is reserved for destructive and error states. Don't use orange to
  warn: a caution (check this count before logging) is `CautionText`, a
  warning icon beside ordinary text.
- Charts: pace or speed in `accent`, heart rate in `danger`, elevation in
  `done`, the scrub point in the series color.

## Type

- **SF Pro** (system text styles) for all labels, body and headings, so
  Dynamic Type applies. `Theme.mono(size, weight)` is SF Pro at the nearest
  text style with tabular digits, for small labels that hold numbers.
- **Section labels**: `Theme.mono(11, .bold)`, uppercase, `.tracking(2)`, in
  `muted`.
- **Bebas Neue** (`Theme.display`) only for workout and exercise names and
  big numbers (timers, weights, stats). Common sizes: 30 for a name on Today,
  20 to 26 in lists, 40+ for a runner or detail title.
- **JetBrains Mono** (`Theme.number`) only for big stepper and countdown
  numbers.
- No other fonts.

## Layout

- Spacing steps: 4, 8, 12, 16, 20, 24. Screen edges use 16 or 20; stacks use
  8 or 12 between related items and 20 or 24 between sections.
- Corner radii: 14 for cards and rows, 12 for buttons and inputs, 10 for
  small tiles, 16 to 20 for hero cards and sheets.
- Tap targets are at least 44 pt high (`.frame(minHeight: 44)`).
- One screen, one job. Group related rows in one card instead of stacking
  many small cards.
- iPad runs the same screens as iPhone. A one-column screen such as Today
  or Activity wraps its content in `.readableColumn()` (at most
  `Theme.readableWidth`, 700 pt, centered) so cards don't stretch across
  an iPad; every iPhone is narrower, so nothing changes there. A screen
  with a map and charts puts them side by side when it is wider than tall.

## Components

- **Primary button**: `WorkoutPrimaryButtonStyle()` (orange fill, navy
  label, 48 pt; `.large` is 58 pt). `quiet: true` gives an orange outline for
  an action that is available but not the main one right now. One per screen.
- **Secondary actions**: plain text buttons in `accent`, or `.bordered`.
  System `.borderedProminent` takes the navy accent through `tint`.
- **Hero card**: `.heroCard()` makes a screen's key card solid navy, the
  icon in miniature. Its content resolves the dark-mode colors in both
  modes, so use ordinary `Theme` tokens inside it. Tiles and thin rules
  use `RaisedFill()`, which turns `surface2` into `heroRaised` inside the
  card. At most one per screen.
- **Card**: `surface` background, radius 14, optional 1 pt `surface2` edge.
- **Today's list**: a day that holds anything to do is one list card,
  `TodayDayListView`, in time order. The next item is the one navy row (the
  hero recipe): Up next and its time, the name, one line on how much it is
  (a run's time, kind and target; a lift's exercises) and the orange Start,
  with ••• beside the kicker. Other rows are plain with a one-word action
  (Start, Log, Continue) and •••; finished rows shrink to a check and what
  was done; Add to today is the last row. A row or its ••• opens its
  choices (Details, Change for today, Not today, Log it).
- **Today's card**: on the days the list doesn't cover (freestyle, a day
  with nothing planned, a finished day), two tones. `todayActionBand()` puts what to do now and
  its one orange action on navy (the hero recipe, so ordinary `Theme`
  tokens inside it); everything else about the day sits on the plain card
  as `todayFootRow()` rows under thin rules, inside `todayCardShell()`. A
  day with nothing to start or log is a `todayPlainCard()` with no navy, so
  navy on Today always means "do this".
- **Today's agenda**: on a finished day, `DayWorkoutsView` lists the day's
  workouts under the recap card.
- **Section heading**: `TodaySectionLabel` with its link beside it, 28 pt
  tall; the link reaches 44 pt through a taller hit shape. Today's sections
  (the day, Today's agenda, This week, Coming up) all use it, 24 pt apart.
- **Week chart**: `WeekFortView` on Today, on the page with no card. Every
  trained day is an orange tower (the only orange in it), a planned day a
  quiet blue one (`weekPlanned`), a rest day stays low, and today's date
  is ringed in `signal`. Activity's week card keeps the navy fort.
- **Tab bar**: tinted `signal` (the selected tab is orange); each tab's
  content is re-tinted `accent`.
- **iPad workout screen**: `WorkoutDisplayView` (the iPad runner and the
  Station display) marks where you are in orange like the iPhone runner:
  the NOW row of the outline and the rest countdown.

## Brand logos

Another company's logo appears only where a member connects Tres Fort to it,
beside its name in Profile → Connections (`ConnectionLogo` in
`ios/TresFort/Group/ConnectionLogo.swift`), and only when that brand's terms
allow it. A logo is never a button on its own, never replaces the brand's
name, and never sits beside the brand's data: activity rows and cards keep
text attribution such as "Garmin Forerunner 945" or "RECOVERY · WHOOP". Each
logo is the brand's own file, unaltered: no tint, mask, crop, shadow,
dimming or recolor. All logos share one size, 30 pt in a 36 pt column, so
none shows smaller than another and Garmin's tile meets its 88 px minimum on
a 3x screen. The color-token rule doesn't reach inside a logo.

Public source checkouts use neutral capability symbols for Apple Health and
Garmin Connect. Official release checkouts supply licensed, ignored image
sets; `ConnectionLogo` uses them unaltered when present. See
[release artwork](RELEASE-ASSETS.md). WHOOP and intervals.icu use symbols.
AI coach tiles use names unless the relevant brand permissions are established.
No provider artwork is covered by the project's source license.

AI coach setup shows Très Fort and the chosen AI app side by side, the app as
a tile with its name. If permission arrives, the app's own logo replaces the
name on that tile, unaltered, under the same rules as above. Setup also says
Très Fort isn't affiliated with or endorsed by Anthropic or OpenAI.

The website and web app use names, not logos, until a brand's marketing rules
are checked separately.

## Accessibility

- Dynamic Type: use text styles or `Theme.mono`, never fixed sizes for body
  text. Dense Today, Plan, Activity and runner rows switch to vertical
  stacks from XXL (`dynamicTypeSize >= .xxLarge`); do not wait for the
  accessibility range when the largest standard sizes already crowd a row.
  Let names, details and button labels wrap, and give multiline buttons
  vertical padding. Keep navigation and actions reachable by scrolling.
- Coach setup uses three, two or one app-choice columns as text grows.
  From XXXL, consent actions follow the disclosure in the same Form instead
  of reserving the bottom of a small screen. Recipient, sharing details,
  setup instructions and actions follow the member's full text setting.
- Scaling exceptions belong to a specific element, never an entire screen:
  the decorative coach-connection tiles use the default size and disappear
  at accessibility sizes (the heading repeats both names). The already-large
  140 pt rest countdown and 58 pt weekly training total grow through XXXL;
  their surrounding labels and controls still scale fully. Keep native tab
  and navigation controls on the system's sizing and large-content behavior.
- Seven-column calendar and week-chart labels also stop at XXXL, so adjacent
  dates remain distinct. Selectable dates support the system large-content
  viewer on press-and-hold; opening a date shows its agenda at the full text
  size. Month headings and navigation actions continue to reflow and scale.
- Check real simulator content sizes, including system controls and sheets:
  `LargeTextJourneyTests` with `scripts/verify-ios.sh --content-size large`,
  `extra-extra-extra-large`, and `accessibility-extra-extra-extra-large` on
  an iPhone SE (3rd generation). Inspect screenshots as well as reachability;
  an accessible label alone does not prove its visible text fits.
- Honor Reduce Motion (`ReduceMotion.swift`): no pulsing or sliding when it
  is on.
- Every icon-only button has an accessibility label.
- Color is never the only signal: pair it with text or an icon (a check for
  done, a label for an error).

## Mocking and checking a visual change

- For early options, use the mock kit (`design/mock-kit/`): HTML copies of
  Today, Activity and a run's detail that read this file's tokens from
  `BrandPalette.swift`. A palette file there can override any token to try a
  palette without touching Swift. Don't draw new mockups from scratch; they
  drift from the real layouts.
- Run `ThemeAccessibilityTests` for any token change.
- Once an option is chosen, capture the real screens with
  `scripts/capture-app-store-screenshots.sh` (production views, fictional
  data, simulator on a Mac with Xcode) before and after, and compare.
- The web app mirrors the color tokens in `web/src/styles.css`; change both
  together. The website still uses the earlier Ink palette.
