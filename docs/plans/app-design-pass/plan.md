# App design pass

Slug: app-design-pass · Status: active · Updated: 2026-11-14 · Theme: member-experience

## Goal

Make the iOS app feel less clunky in everyday use. Common actions take fewer
taps and fewer stacked screens, unplanned training is as easy to start as
planned training, every feature works without an AI coach, and screens share
one visual system. The owner asked for the whole ranked list from the
2026-11-01 design review to be built, plus easier unplanned activities.
On 2026-11-02 the owner found the Plan tab unclear on landing, above all its
Active/Archived toggle, which P6 addresses.
On 2026-11-03 the owner found changing a day of the week unintuitive: tapping
a day didn't let them change it, and a day couldn't become something that
isn't a workout yet (soccer every Monday). P7 addresses that.
Later that day the owner asked to rename the Progress tab Activity and make
it the place to look at past workouts and runs, which P8 addresses.
On 2026-11-07 the owner found the Today screen messy and spread out: the
"Nothing scheduled" section took much of the screen, the sections weren't
clearly separated, and it was unclear what the Workouts row did, which
didn't need to be on Today. P11 addresses that.
On 2026-11-07 the owner asked for the color design to use more of the
icon's blue and orange, which P9 addresses.
The same day the owner asked to bury the Profile tab, give Activity an icon
that says progress, and lead Activity with a more compelling summary of
recent training, which P10 addresses.
That evening the owner asked whether these design updates also reached the
iPad, which ships in the same app. They do, since the iPad runs the same
screens, but a code check found four gaps, and the owner asked for all four
to be fixed, which P12 addresses.
On 2026-11-08 the owner found real planning on the Plan tab still slow:
the choices for a day didn't say what each one was, and something simple,
such as a 3-mile run every Wednesday, took many taps. P13 addresses that.
Later on 2026-11-08 the owner asked that tapping Today's This week chart
show more about the week, such as the Activity tab, and that the Calendar
link sit with Coming up rather than This week. P15 addresses that. The same
message asked how Today shows several planned things on one day, such as a
morning run and an evening core workout. Mocks of two layouts were shown
(project files today-multi) and the owner chose B, next up then later today,
which P16 builds.
On 2026-11-10 the owner found four problems on the Activity tab: route
previews were a bare line that looked broken, All history fell back to
plain rows, the Last 8 weeks dates ran into each other, and runs showed no
lap times. P23 addresses those.
Later on 2026-11-10 the owner found four problems adding to the week:
there was no clear way to add a bike ride or a swim; core was an activity
with no room for its exercises or time, and putting a nightly core routine
under Lift wasn't intuitive; a reminder time could only be set after the
item was made; and the type tiles on the Add sheet were cut off at the
edges. P24 addresses those.
On 2026-11-13 the owner found changing a planned day still off: changing
today's tempo run only offered other saved workouts, when members think of
the kind of thing first (a run, a lift, a swim) and only then its details.
The likely changes are a different run, a different activity, or no
activity. The owner also found that a run's Details showed nothing Today
didn't, and worse, and that a workout's details had two ways in. The owner
chose a summary on Today with Details, Swap and Skip from mocks in project
files day-change, which P25 builds.
On 2026-11-14 a TestFlight tester who imported years of Apple Health
history found the list under the calendar unordered and thin: it listed
every date ever trained whatever month the calendar showed, with no years,
so December 2026 showed rides from older Decembers, each only "Ride · 28m".
The owner chose to keep importing all Health history. P26 addresses that.

## Phases

- [x] **P0 — Quick wins and exercise targets**
  - Readable dates, a Units and sounds section in Profile, body weight that
    follows the lb/kg choice, the weekly schedule reachable from the library
    and clearer finish copy. The exercise editor sets target weight, its unit
    and RPE, which before only the coach could change.
  - Merged in PR #287 with model tests and CI.
- [x] **P1 — Today and the set runner**
  - Today shows unplanned training directly: a freestyle lift, a run to record
    and an activity to log, on idle, rest and completed days. The + menu keeps
    the same choices and the occasional ones.
  - The iPad display button leaves the toolbar until this phone turns the
    display on. Before that it sits in the + menu, or the workout menu during
    a workout.
  - A menu beside the exercise name swaps or adds an exercise, opens the
    plates guide and skips, in one tap instead of three.
  - The runner footer shows the rest row and the last-set row only when they
    have something to show, so the inputs keep that room.
  - Finish workout before the last set lands on the same finish screen as the
    last set, with the same summary, feedback and Finish action.
  - Merged in PR #288 with UI journeys for the Today shortcuts, the iPad
    display entry, the exercise menu, the footer and both finish routes.
- [x] **P2 — Workout navigation**
  - Library, workout details, editing and adding an exercise use one
    navigation stack with Back, and Edit is a mode of the details screen.
  - A Plan tab holds the library, the calendar and the weekly schedule.
    Groups appear only in the Group tab. Start on the Plan tab continues a
    workout already on the runner and never replaces it.
  - Adding an exercise sets its target weight too.
  - Merged in PR #289.
- [x] **P3 — Endurance without AI**
  - Log a run, ride or swim in the app with distance and time. It goes to
    intervals.icu through the same provider write the coach uses, and other
    activities stay local.
  - Progress shows an Endurance card with weekly distance and time and recent
    runs.
  - Merged in PR #290. `POST /api/activities/endurance` needs no migration.
- [x] **P4 — One visual system**
  - Display type only for big numbers and exercise names, mono type only for
    numbers, and one primary button style across the app.
  - Merged in PR #291.
- [ ] **P5 — Release and device check**
  - Deploy the Worker so the app can reach `POST /api/activities/endurance`,
    then distribute a TestFlight build from main.
  - On the owner's iPhone, check the Today shortcuts, the exercise menu, the
    finish screen, the Plan tab, logging a run with distance and time, the
    Endurance card and the new type and buttons.

- [ ] **P6 — A Plan tab with a clear first action**
  - The owner found the tab unclear on landing, then found that it mixed
    planning the week with making workouts. After three rounds of mocks on
    2026-11-02, the tab has two sides behind a Schedule | Workouts switch.
  - Schedule (the default) is when you train: "Your week" lists each weekday
    with its workout or Rest, a day with a workout opens it, and one primary
    button, Edit weekly schedule (Choose your training days when nothing is
    scheduled), sits under it. Calendar and Away dates follow as rows. With
    no workouts it points to the Workouts side instead.
  - Workouts is what you do: the saved workouts, Add workout, the tag filter
    and reordering. Plan changes move to a toolbar button.
  - The Active/Archived toggle is gone. An Archived workouts row with a
    count, shown only when something is archived, opens its own screen to
    restore or delete them. The tag filter lists tags of active workouts.
  - Unit test for the week rows; UI journeys for both sides and the archive
    screen. Needs the owner's look on a TestFlight build like P5.

- [ ] **P7 — Change a day from Your week**
  - Every weekday in Your week, rest days too, opens that day: pick Rest or a
    saved workout and only that weekday changes, carrying the plan version on
    screen. "Edit all days" keeps the seven-picker editor.
  - From the same day, New activity names something without sets (Soccer,
    a class, a hike), saves it as a workout with no exercises and puts it on
    that weekday. A name that matches an existing workout reuses it. New
    workout opens the exercise picker and puts the result on that day once
    its editor closes.
  - On its day Today shows an activity with "Log <name>", which opens Log
    activity on that name (its type when the app knows one, else Other), and
    shows it as logged once an activity with that name is logged that day.
    The library, calendar and date picker call it an activity.
  - The owner asked (2026-11-03) to stop showing the plan change log: the
    Plan changes button and the library's recent-changes card are gone and
    the history screen with them. History stays on the server, and the coach
    still reads and restores it over MCP.
  - No backend change: `POST /api/workouts` already takes a workout without
    exercises, and `PUT /api/plan/schedule` takes the whole week.
  - Unit tests for one-day week changes, activity naming, kind and logged
    checks; a UI journey adds Soccer to Monday from the Plan tab and sets it
    back to rest. Needs the owner's look on a TestFlight build like P5.

- [ ] **P8 — An Activity tab for past workouts and runs**
  - The Progress tab becomes Activity, with a History | Progress switch.
    History (the default) lists everything the member has done, newest first
    and by month: workouts finished in the app, runs, rides and swims from the
    recorder, Apple Health, intervals.icu and.fit files, and activities
    logged by hand, such as soccer. A finished run workout shows once, as its
    run. Filter chips (All, Workouts, Runs, Rides, Swims, Walks, Other) list
    only the kinds the member has done.
  - Tapping a workout opens that date's record, the same one the calendar
    opens, with the logged sets. Tapping a run, ride or logged activity opens
    that activity on its own: its stats, route map, charts and delete, or its
    notes. Each row pushes its own navigation value; rows on one date used to
    share one, so on the owner's iPhone (build 66) a tap highlighted and
    opened the entry above the one tapped.
  - Progress keeps the consistency, strength, endurance and weight cards
    unchanged. Copy that pointed to Progress → Weight now says Activity →
    Progress → Weight, the privacy page included.
  - No backend change: `/api/state` already carries the full history.
  - Unit tests for the history rules (order, statuses, the run workout,
    deleted and trip-hidden rows, filters and months); UI journeys for
    History, its filters and records, and a run logged on Today appearing in
    History. Needs the owner's look on a TestFlight build like P5.

- [ ] **P9 — The icon's navy and orange through the app**
  - Three palettes were mocked on 2026-11-07 (round 4, beside the earlier
    rounds in the project files): orange as the accent, navy and orange,
    and a bone page in a navy frame. The owner chose navy and orange.
  - Light mode keeps a cool paper white but text and the accent become the
    icon's navy; dark mode becomes navy instead of near-black. Orange is the
    signal: one fill for primary actions (navy labels, the same in both
    modes), and orange marks for the selected tab, set progress, the rest
    timer bar and route lines.
  - `heroCard` makes a screen's key card solid navy with dark-mode content,
    for the Activity redesign and others to adopt. The web app takes the
    same values; the website keeps Ink for now.
  - Today's card (`todayCardSurface`, P11) uses `heroCard` in every state.
  - `ThemeAccessibilityTests` covers the new surfaces, the orange fill and
    the hero card in both modes. Needs the owner's look on a TestFlight build
    like P5.
  - `docs/DESIGN-SYSTEM.md` records the color roles, type, layout and
    components, and `design/mock-kit/` renders HTML copies of Today, Activity
    and a run's detail with the real tokens, so early options no longer need
    a simulator run.
- [ ] **P10 — Activity leads with your week; Profile leaves the tab bar**
  - The owner picked "Build as shown" on 2026-11-07 from mocks in the
    project files (activity-tab/). Four tabs remain: Today, Plan, Activity
    and Group. Profile opens as a sheet from an avatar at the top right of
    every tab, with the member's initials and an orange dot when a connection
    needs them, such as an intervals.icu reconnect. Coach setup, invites and
    approvals that arrive while Profile is open close it first, then show.
  - Activity gets a trend-line icon and becomes one scrolling page, without
    the History | Progress switch. A navy This week card counts every kind
    of training (workouts, runs, rides, soccer and other logged activities):
    time trained, sessions, distance, strength time and known load, a bar per
    day split by kind, a week streak and the change from this time last
    week. The old streak counted only workouts finished in the app.
  - Highlights from the last 30 days: the fastest run of at least a mile, the
    longest run, and a working set heavier than every earlier set of its
    exercise (physical load, so lb and kg compare). Recent shows the latest
    three sessions as cards, with the route's outline on runs, rides and
    walks; All history opens the P8 list with its filters.
  - Last 8 weeks charts training time per week by strength, endurance and
    sports. Progress rows open Strength, Endurance, Workout consistency and
    Weight; Weight copy now says Activity → Weight, the privacy page
    included.
  - No backend change: everything reads the History entries from
    `/api/state`, and route outlines use the existing route endpoint.
  - Unit tests for the summary, streak, change, highlights and initials; UI
    journeys for the page, All history, the progress links, Profile from the
    avatar and coach setup from Profile. Needs the owner's look on a
    TestFlight build like P5.

- [ ] **P11 — A tidier Today screen**
  - Today reads as three sections, each one card under one small heading:
    today, this week, coming up. Mocks were shared on 2026-11-07
    (project file home-screen/home-screen-mock-v1.png).
  - Today's card holds everything about the day. A planned workout, run or
    activity shows its name, what it is and one orange action, with View
    details and Change today under it. A rest day says "Nothing planned
    today" in one line, with Lift, Run and Log buttons and Do a saved
    workout. On other days Lift, Run and Log sit at the foot of the card
    under Something else. A finished day shows the result and View workout
    or View run.
  - The Workouts row is gone from Today: the library lives in the Plan tab,
    and Saved workouts sits in Today's + menu.
  - The week shows once: the fort carries each day's letter and date and
    each tower opens its day, still paging into the next weeks. The separate
    row of day cells is gone. Coming up is one list.
  - No backend change. Unit tests for the short date, the card's first line
    and each tower's label; UI journeys reach the library through the +
    menu. Needs the owner's look on a TestFlight build like P5.

- [ ] **P12 — The design pass on iPad**
  - The iPad shows the same tabs and screens as the iPhone (no separate
    iPad layouts), so P9 to P11 and the run map reach it. A code check on
    2026-11-07 found four gaps, all fixed here.
  - Today and Activity stop stretching across an iPad: their column is at
    most 700 pt wide and centered (`readableColumn`). iPhones are narrower,
    so they don't change.
  - The iPad workout screen (the iPad runner and the Station display) marks
    the current exercise in the outline and the rest countdown in orange,
    as the iPhone runner marks set progress and the rest bar.
  - Camera Station screens (beta builds only) no longer warn in system
    orange and red: cautions use `CautionText`, errors `danger`, and the
    pose overlay `done` and `muted`.
  - The full-screen route map puts the charts beside the map when the
    screen is wider than tall, an iPad or a phone in landscape.
  - No backend change. Needs the owner's look on an iPad, in the simulator
    on the Mac mini or a TestFlight build, each with the owner's go-ahead.

- [ ] **P13 — Plan a week in a few taps**
  - Three directions were mocked with the mock kit on 2026-11-08 (project
    files plan-tab/round-3): a clearer day sheet, a week that says what's on
    it with one Add sheet, and typing a line. Before, a 3-mile run every
    Wednesday took about 11 taps and typing: New run, a name, then the step
    planner for one distance.
  - Your week shows each day's kind as an icon (run, lift, or the sport's
    own figure) and what's in it: the first exercises, a run's steps or
    distance. Rest days read Rest with Add. VoiceOver reads the kind too.
  - Add to your week opens one sheet: Run, Lift, Sport or Saved, then the
    days (several at once), then Add. A run is a distance or a time with
    shortcuts, saved as one step, so 3 mi every Wednesday is four taps;
    Steps opens the step planner as before. A lift opens the exercise
    picker, a sport takes a name, and Saved lists every saved workout. The
    sheet says which days it replaces, writes the whole week once at the
    plan version on screen and keeps the first create on a retry.
  - Tapping a day opens it with Run, Lift and Sport on top, which open the
    same sheet with that day chosen, and below them rest and every saved
    workout grouped by kind, with its contents and the days that use it.
    Edit all days moves to a row beside Calendar and Away dates.
  - No backend change: the existing workout create, slot and schedule
    routes do the work with their audit and version checks.
  - Unit tests for the summaries, the one-step run, the name, the week
    write, the replace note and the button title; UI journeys add a 3-mile
    run on Wednesday from Add, and Soccer and a stepped run from a day. The
    mock kit gains the Plan tab screens. Needs a real simulator check on the
    Mac mini and the owner's look on a TestFlight build like P5.

- [ ] **P14 — Several things on one day**
  - The owner asked on 2026-11-08 for more than one thing on a day, such as
    morning stretching and core before bed beside a kettlebell day, and chose
    two steps: activities first, two set-by-set workouts on one date later
    (workouts-and-multi-session P1).
  - A weekday keeps its one workout and can hold up to four activities
    (workouts with no exercises) beside it, saved as `extras` in
    `plans.meta.schedule`. `set_schedule` and `PUT /api/plan/schedule` take
    them with the same version check, audit and snapshot; a week-only write
    keeps the saved ones, so older apps and the web planner leave them be.
    A workout with exercises is refused, deleting or archiving an activity
    clears it, and an `update_plan` rebuild carries it over. No migration.
  - The calendar projects a weekday's extras on today and later dates
    outside trips, in TypeScript and Swift from one shared fixture; a logged
    workout on the date does not hide them. Coach reads name them
    (`schedule_extras`, `weekly_schedule_extras`), and a plan comparison
    lists an extras change under its weekday.
  - Your week shows a day's extras under its workout. A day's sheet lists
    them under Also on, each with a remove button, and Add an activity
    alongside opens the composer on Sport. When a picked day already holds
    something, a sport or saved activity keeps it by default and goes
    alongside (a switch swaps it in instead); a rest day takes it as its
    workout. Today lists today's extras under Also today, each with Log,
    or a check once something logged today has its name.
  - Backend tests cover the write, keep-on-omit, the refusals, delete and
    rebuild, the calendar and the comparison; unit tests cover the week and
    extras writes; a UI journey adds Stretching beside Strength B and takes
    it off again. Needs the same simulator check and TestFlight look as P13.

- [ ] **P15 — This week opens Activity; Calendar joins Coming up**
  - This week's fort on Today is one button that opens the Activity tab at
    its top, where the week card, highlights and recent sessions tell the
    week in full. A chevron beside the fort's summary says it opens. Later
    weeks keep a tower per day that opens the day for planning, since they
    have nothing done yet. Upcoming days and the calendar still open any
    date.
  - The Calendar link moves from the This week heading to the Coming up
    heading. Coming up now always shows its heading, so the calendar stays
    one tap away, with one line when nothing is planned in the next two
    weeks.
  - No backend change. A UI journey opens Activity from the fort and the
    calendar from Coming up. Needs the owner's look on a TestFlight build
    like P5.

- [ ] **P16 — Several things on Today**
  - Today's card follows the day's plan in order: the workout first, then
    the activities beside it (P14). The first thing not yet done leads the
    card with its name and one orange action; the rest wait under Later
    today, each with its own Log. A finished item shrinks to a check line
    at the top of the card, with View workout or View run for a finished
    workout, and the next one moves up. When everything is done the
    workout keeps its own finished card, with the logged activities under
    it.
  - Before, today's activities sat in a separate Also today card that
    disappeared once the workout was finished. They now stay on the card
    after the workout, while it is minimized, beside a freestyle session or
    a workout needing review, and on a day that holds only activities.
  - Coming up lists a day's activities under its workout, and a day that
    holds only activities is coming up too.
  - Two workouts logged set by set on one date still wait for
    workouts-and-multi-session P1; until then the things beside a workout
    are activities that are logged by name. There is no time of day: the
    order is the plan's, and each item can be done in any order.
  - No backend change. Unit tests for the order (`TodayLineup`) and for
    Coming up's activities. Needs the owner's look on a TestFlight build
    like P5.

- [ ] **P17 — Official logos for app connections**
  - Profile → Connections shows a brand's own logo beside its name where
    that brand's terms allow it, under the rules in the design system's
    Brand logos section. Garmin's row shows the Garmin Connect tile and
    the full name "Garmin Connect", as Garmin's brand guidelines ask.
  - Apple Health's row shows Apple's icon under Apple's HealthKit artwork
    license, which the owner accepted and which covers iOS app screens
    only. WHOOP needs WHOOP's written permission under its API terms, and
    intervals.icu publishes no permission, so both keep a symbol. Activity
    rows and cards keep text attribution; no logo sits beside a brand's
    data.
  - The web app gains logos only with its own Connections page (web-app
    P4), and the website only after each brand's marketing rules are
    checked. No backend change. Needs the owner's look on a TestFlight
    build like P5.

- [ ] **P18 — A day's plan within reach**
  - On a phone, the owner had to scroll a weekday's sheet to find how to add
    something beside its workout, and the composer called stretching or core
    a "Sport". The sheet now opens on what the day holds: its workout, one
    tap from its details, the activities beside it, and "Add something
    alongside". Making something new and picking a saved one follow.
  - The composer's third kind reads "Activity" (core, yoga, soccer),
    everywhere it shows.
  - Arrows beside the title, or a sideways swipe, move the sheet to the
    previous or next weekday, wrapping Sunday to Monday. Saving still
    changes only the day shown.
  - No backend change. A unit test for the day order and the UI journey for
    adding alongside cover it. Needs the owner's look on a TestFlight build
    like P5.

- [ ] **P19 — An optional time for what a day holds**
  - The owner asked to see times he planned, such as a morning run and
    core in the evening, without making a time required, and to be
    reminded at a time he set.
  - `plans.meta.schedule.times` maps a weekday to the workout ids it holds
    (its workout or an extra) and a 24-hour local "HH:MM". A schedule write
    that omits `times` keeps those still on their day, `{}` clears them,
    and a time for something not on that weekday is refused
    (`time_not_on_day`). An `update_plan` rebuild carries them to the
    rebuilt ids, and deleting a workout drops its times. The coach reads
    `schedule_times` by name and can set them with `set_schedule`. A block
    week uses the time set for the same workout on the same weekday.
  - On a weekday's sheet, each item has a quiet Time button that opens a
    time picker, with "No set time" to clear it. A set time shows on the
    Plan week rows and on Today's Next up and Later today.
  - Setting a time asks once for notification permission. The app then
    reminds the member at each set time on the next 14 days for anything
    still to do, without the daily reminder switch. The daily reminder
    stays quiet on a day whose workout has its own time. The calendar
    projection is unchanged.
  - Release order: deploy the Worker before an app build that sets times,
    because an older Worker refuses the new field. No migration.

- [ ] **P20 — Swiping between days you can see and feel**
  - On TestFlight 1.2 (75) the owner swiped Today expecting to move between
    days, and found that on the Plan tab's weekday sheet the swipe changed
    the screen with no sign of motion. He asked for a clearer cue and
    haptics.
  - One shared swipe (`DaySwipe.swift`): the content follows the finger,
    slides out the way it was pushed while the next day slides in from the
    other side, and the phone ticks once per day. Past the last day it only
    stretches and springs back. With Reduce Motion on, the day fades over.
  - The weekday sheet adds the week as seven letters under its title,
    marking the open day; a letter jumps to that day. The arrows slide the
    same way.
  - Today's card swipes from a week back to two weeks ahead. Another day's
    card shows what that date holds (status, name, what's in it, a set time,
    activities beside it) with View details or View day, Change this day
    for a date still to come, and a Today button back. Starting and logging
    stay on today's card. The finished card swipes too; the week chart
    keeps its own week paging. VoiceOver gets Next day and Previous day
    actions. Going to the background returns the card to today.
  - No backend change. Unit tests cover the drag rule, the day window and
    the status words; UI journeys cover Today's swipe and the week letters.
    Needs the owner's feel on a TestFlight build.
  - The first nightly UI run found that a swipe starting on one of the
    card's buttons also pressed it, because the card follows the finger:
    swiping Today from Change today moved to tomorrow and opened the workout
    picker over it (TestFlight 76 has this). The swiped content is now
    disabled while a sideways drag or slide is under way, which cancels the
    press (landed with #413), and the journey checks that neither Change
    today nor View details opens.

- [ ] **P21 — A date shows everything it holds**
  - On TestFlight 75 the owner tapped a Coming up day that read Soccer
    + Core, and the date sheet showed only Soccer. The sheet read the
    day's workout and never its activities (P14).
  - The date sheet, from Coming up, the calendar or a later week's fort,
    now lists the weekday's activities under Also on this day, from the
    same projection Coming up and Today read. Each shows its kind and the
    time set for it (P19), or Logged once something logged that date
    carries its name. A day with only activities reads "No workout
    scheduled." rather than "Rest day — nothing scheduled."
  - No backend change. Needs the owner's look on a TestFlight build like
    P5.

- [ ] **P22 — Reminders without setting each day**
  - The owner asked on 2026-11-09 for a time to apply on every day an item
    is on, instead of setting core's time on Monday, Tuesday and Wednesday
    one by one, and for a reminder about planned things not yet done that
    have no time, which a member can turn off.
  - A weekday's time picker shows an "Every day it's on" switch when the
    item is on other weekdays too. It starts on when those days already
    share a time (or none), and saving or clearing then writes every one
    of those weekdays in one schedule write.
  - A "Still to do" nudge fires once each evening, 6 PM unless changed in
    Profile → Reminders, listing what the day holds that has no time of its
    own and isn't done: a workout not started, an activity not logged.
    A day with nothing left stays quiet. It is on by default but reaches
    only a member who has allowed notifications; it never asks on its own.
    Its switch and time are per account, beside the daily reminder.
  - Reminders are local and scheduled ahead, so something logged elsewhere
    cancels the nudge only once the app sees it. No backend change, no
    migration.

- [ ] **P23 — Activity tab maps, history cards, chart axes and splits**
  - Recent cards draw the route on a small muted Apple Maps image (a
    still snapshot, made once per route, size and appearance), with the
    bare outline only while it loads or when the map can't be drawn.
  - All history lists the same cards as Recent, route maps included,
    under month headings, with the same filters.
  - Last 8 weeks dates every other week ("Oct 26", "This week"), every
    fourth at accessibility text sizes, and its time axis counts in round
    steps (0, 30m, 1h, 1h 30m) instead of whole hours that repeated.
  - A run, walk or hike whose chart series carry distance shows a split per
    mile or kilometer on its detail, with pace, heart rate and a bar for
    speed. A planned run recorded in the app shows them under its step
    laps (P9 of planned-runs), which the owner asked for on 2026-11-12
    after a tempo run showed only its three steps. The laps themselves
    read as a picture too: a chart of the session with one block per lap,
    as wide as its time and as tall as it was fast, then each lap led by
    its pace with a bar for speed in the step's color and a mark for how
    it went against its target. Delete Run on a recorded run moved behind
    a "…" menu (then the confirmation), since the owner found the plain
    button too easy to tap. The owner's runs come from Garmin through
    intervals.icu, which never had laps in Tres Fort; Garmin's own device
    laps would need a Worker read from intervals.icu, offered separately.
  - No backend change. Unit tests for the axis marks, week labels and
    splits. Needs the owner's look on a TestFlight build like P5.

- [ ] **P24 — Rides, swims, routines at home and a time while adding**
  - Add to your week has seven tiles in two rows: Run, Ride, Swim and
    Lift, then At home, Other and Saved. The weekday sheet's New tiles
    add Ride, Swim and At home the same way. Other was called Activity,
    which is also a tab's name. Both sheets put the member's most
    frequent kinds first, Saved staying last: one count for each time
    their week holds a kind and one for each done in the last eight
    weeks (finished lifts and routines at home; runs, rides, swims and
    other sports from logged or synced activities, so a recorded run
    counts once). Ties and new members keep the order above, and the
    order holds still while a sheet is open. Each tile's icon has a fixed
    height so the names line up, and the tiles sit in the section header,
    since a list row's rounded corners clipped the outer ones.
  - A ride or a swim is planned by distance or time, like a run: rides
    in miles or kilometers (60 minutes to start), swims in yards or
    meters to match (1000 to start). It is saved as an activity named for
    its amount and sport ("1 h ride", "1000 yd swim"); a typed name keeps
    the sport at its end ("Recovery ride"), so Today shows it
    with Log, the log sheet opens on that sport, and a ride or swim synced
    that day counts it done, by its sport or its coarse kind. Any activity
    name ending in ride, swim, run, walk or hike reads as that sport.
  - At home makes a routine with exercises, done with no equipment: Core,
    Stretching or Bodyweight to start from, or My own. The starter's
    exercises show with their targets; the exercise picker then opens on
    the review with them chosen and lists only bodyweight moves and
    holds, and the editor after saving sets reps or hold times. Today
    starts it set by set with a timer for holds, and beside a day's
    workout it runs as its own session.
  - Every kind can take an optional time while adding. The time goes on
    each chosen day in the same schedule write, keeping other saved
    times on their days and dropping one for something the write takes
    off its day, and the app asks for notification permission first.
  - The Other tile's hint points core and stretching with exercises to
    At home. No backend change and no migration: rides and swims are
    activities, and routines use existing catalog exercises. The catalog
    has few stretches, so adding timed stretches would need a migration,
    offered separately. Unit tests cover the tiles, amounts and names,
    the sport a name reads as, the starters, the times merge and the
    ranking. Needs
    the owner's look on a TestFlight build like P5.
  - Release check run (main, 2026-11-11) failed three
    `WeeklyScheduleJourneyTests` journeys: with seven tiles and a time,
    the Add button sat below the fold on an iPhone, out of view and out of
    the UI tests' reach, and a workout just made sat below the day sheet's
    New tiles. The Add button, its name note and any save error now stay
    pinned below the form, like Schedule workout on the date picker, and
    the journeys scroll the day sheet to a new workout. Release check run passed in full, and TestFlight 1.2 (79)
    carries P24 with this fix.

- [ ] **P25 — Details, Swap and Skip for a planned day**
  - Today's card for a planned workout is a summary: its name, and for a
    planned run three figures (time or distance in all, effort from the
    kind of run, and the main part's target, such as "HR 155–161"), then
    Start and three buttons, Details, Swap and Skip. The steps themselves
    are behind Details. On a planned day the card no longer repeats the
    quick starts for something else; they stay in the + menu and on a rest
    day's card.
  - Details is the one way to a workout's details. A run shows its
    figures and every step. Edit is in its toolbar: for a run it opens the
    run screen for that day only, with a link to edit the saved run
    instead; for anything else it asks whether the change is for that day
    only or for the saved workout. The edit buttons in the body are gone.
  - Swap opens on tiles by kind, the member's most frequent first as on
    Add to your week, with Rest at the bottom. A run is changed by one
    kind of run (Easy, Tempo, Intervals or Long, which sets both its shape
    and its effort) and one amount, in minutes or the member's distance
    unit; Edit steps is a tap away. Targets come from the member's
    threshold heart rate, else threshold pace, else the run is planned by
    feel and says so; a run's own target is kept while its kind is. A
    ride or swim is an amount, and a lift, routine at home or other
    activity is picked from the saved ones under its tile, or made new.
    Saved workouts appear only under their kind.
  - Skip asks first, then makes the date a rest day. Every change touches
    that date only: a new run, ride, swim or activity is a one-time
    workout ([workout library P3](../workout-library/plan.md)) made with
    the existing `exercise_ids` path of `POST /api/workouts`, so the saved
    workout and the week stay as they are. The calendar's day menu says
    Swap and Skip the same way.
  - No backend change and no migration. Unit tests cover the steps each
    kind and amount makes, the threshold bands, the run's own target, how
    a day's run reads back into the screen, Today's figures and what each
    Swap tile lists. Needs the owner's look on a TestFlight build like
    P5; the web app gets the same model later.

- [ ] **P26 — The calendar's list follows its month**
  - The list under the calendar shows only the month the calendar shows,
    under a heading such as "9 days trained in November 2026", and follows
    the arrows and Today. A month with nothing says so in one line. Older
    training stays, one month at a time; All history on the Activity tab
    still lists everything.
  - Its rows come from the same history as the Activity tab, so each
    workout, run or ride shows its facts there (distance, time, pace, sets)
    on a second line, not only a name and a duration.
  - Things on one date are put in the order they started: a day under the
    calendar reads earliest first, and History, newest first, lists a
    date's latest first. Workouts use their start, activities the start
    every source already sends (`start_date_local_ms`, now decoded by the
    app), and an activity logged by hand, which has no start, comes last.
  - No backend change. Unit tests cover the month's dates, the order on a
    date and decoding the start. Needs the owner's look on a TestFlight
    build like P5.

- [ ] **P27 — Add to your week reads top down**
  - The owner, adding a routine at home to a Tuesday on TestFlight, found
    the sheet hard to read: the suggested core routine looked fixed and
    "My own" was easy to miss, the second row of type tiles was wider than
    the first, the day and time sat below the fold, and the optional name
    came first. After picking this layout, the owner asked that suggested
    routines read as suggestions, that building one's own be easy, and
    that exercises can be dragged into order.
  - The type tiles are one row of one size that scrolls sideways: the kind
    the sheet opened on first, then the member's most frequent, and Saved
    last. The next tile peeks in at the edge.
  - When comes first, right under the tiles: the weekdays, "At a set time"
    with its time, and "Keep what's on those days". Then what (a run's
    distance or time, a ride, a routine), and the optional name last,
    saying it's saved to the workouts to add again from Saved or rename
    later.
  - A routine at home is built right in its list. "+ Your own" is the
    first chip and opens the no-equipment catalog; Core, Stretching and
    Bodyweight are suggestions, headed "Suggested core routine · yours to
    change". Drag to reorder, swipe to remove, Add exercise for more, and
    tap one exercise for its own sets and reps or hold (a circuit's rounds
    stay shared). Sets and rests opens the routine's shared timing, circuit
    choice and timer preview, which follows each exercise's own values.
    Add saves the list as shown through the same prescribed-workout save;
    a retry after a lost reply sends the same request, so it never makes a
    second routine. The review screen stays for lifts.
  - A second routine from the same starter is named "Core routine 2"
    instead of being refused until the member types a new name.
  - No backend change and no migration. Unit tests cover the tile order,
    the numbered name, the chip order and an exercise's own sets, reps and
    hold in the saved request and timer preview; the mixed-week journey
    sets the routine's timing from its list. The mock kit's Add to your week screens show
    the new layout. Needs the owner's look on a TestFlight build like P5.

## Execution frontier

- P5
- P6
- P7
- P8
- P9
- P10
- P11
- P12
- P13
- P14
- P15
- P16
- P17
- P18
- P19
- P20
- P21
- P22
- P23
- P24
- P25
- P26
- P27

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P5 | gated_by | external:owner-design-pass-release | A Worker deploy and a TestFlight build each need the owner's own go-ahead, and the visual check needs a real device. |

## Next step

**Now (@agent):** Land P27 (Add to your week reads top down) with green
CI and a clean Codex review, then capture the real sheet on the Mac mini
along with P25's Today card, Details and Swap.

**Then (@owner):** TestFlight builds since 66 carry P0 to P8. Try them on the
iPhone. P9 to P19 are in TestFlight 1.2 (75); P20 reaches the phone with the next TestFlight build,
which needs its own go-ahead. P24 (rides, swims, routines at home and a
time while adding) is in TestFlight 79 and needs the same
look. P25 reaches the phone with the next TestFlight build after it merges.
P26 (the calendar's list follows its month) reaches it the same way. P27 (Add to your week reads top down) does too.

## Notes / open questions

- Repository delivery does not authorize a TestFlight or App Store build. App
  Store 1.0 stays on build 55.
- The review read the code without screenshots. Visual checks need the Mac
  mini or a TestFlight build, each with the owner's go-ahead.
- P3 adds a REST route over `src/services/intervalsActivityWrite.ts`. A
  provider failure stays an error, never a local fallback, as for the coach.
