# Plan over blocks and cycles, not just one week

Slug: progressive-plans · Status: gated · Updated: 2026-11-18 · Theme: gym-floor

## Goal

A member can plan training over a longer period than one repeating week, in
the app and without AI. A member training for a date, such as a marathon,
lays out a block of weeks where each week can differ: distances and paces
grow, an easier week comes every few weeks and a taper leads into race day.
A member who rotates a cycle (an A week and a B week, or a four-week block
that starts over) sets that up once. A member who only wants consistency
keeps the repeating week ("Your week") exactly as it is today.

The owner chose this direction on 2026-11-08 in the thread "Plan workouts
that progress over time" (option C): different members have different needs,
so the repeating week stays the default and a block of weeks is something a
member turns on. The owner then said (19:12Z) that automatic weight
suggestions after every workout are not needed: the point is planning over
periods and cycles. The mocks are in the project files at
`plan-progression/` (mock-kit HTML in its `source/` folder).

What exists before this plan:

- The plan is one repeating week (`plans.meta.schedule`, with `extras`) plus
  per-date pins (`set_planned_session`). Every slot has one fixed target.
- The race goal and training phases (`set_race`, `set_periodization`) are
  stored in `plans.meta` but are coach-only
  ([coach-free planning](../coach-free-planning/plan.md) P1) and change no
  workout.

spec.md holds the data format, the date rule and the limits.

## Phases

- [x] **P0 — Weeks that differ**
  - `plans.meta.program`: a start Monday, an ordered list of weeks, each
    with its own weekday pattern and extras and a short label (Base, Build,
    Easy week, Taper), and whether the weeks repeat as a cycle. After a
    one-off block ends, the repeating week takes over again.
  - One pure date rule, `weekPatternOn`, decides which weekday pattern a
    date uses. The calendar projection, Today, the coach's day reads and
    workout archiving all use it. Kept byte-for-byte in parity in
    `calendarProjection.ts` and `CalendarProjection.swift` with a shared
    fixture.
  - `PUT /api/plan/program` and `DELETE /api/plan/program` (reviewed plan
    version, `actor='ios'`/`'web'`) and the MCP tool `set_program` write it
    through one versioned, audited `db.ts` service. Deleting or archiving a
    workout clears it from every week, as it does from the repeating week.
- [x] **P1 — Targets that change from week to week**
  - A week can override a slot's sets, reps, load, duration or run steps,
    so one "Long run" grows from 8 to 20 miles without a workout per week.
  - Today, the runner, the run recorder's steps and the runner's starting
    targets snapshot use the week's targets, so the completion summary
    compares against that week.
- [x] **P2 — Blocks on the Plan tab**
  - Start a block from your week: a start date, how many weeks, one-off or
    repeating. Each week starts as a copy of your week.
  - The Schedule side then leads with "Week 6 of 16 · Build", a strip of
    the weeks and a week stepper. Tapping a day changes it for this week
    only or for this week and the ones after; a week can be copied or
    relabeled, and the block ended. Without a block the Plan tab is
    unchanged ([app design pass](../app-design-pass/plan.md) P13 and P14).
  - Only one schedule is marked "In use now"; while the block covers today,
    Your week folds into one row saying when it comes back (the owner,
    2026-11-10: with both shown it wasn't clear which one applied).
- [x] **P3 — Weeks laid out by rules**
  - "Train for an event": the member names an event (date and distance),
    the long run day and the longest run lately (filled in from the last
    four weeks of runs). Fixed rules lay out every week to race day: the
    long run builds to a peak, an easier week comes every Nth week and a
    taper leads in; other runs shorten in easier weeks and lifts stay as in
    Your week. A preview chart redraws as a rule changes, and saving writes
    the event and the block together as ordinary weeks the member can still
    change by hand (spec). The owner chose
    this on 2026-11-10 after finding block planning day by day too manual.
  - Plan styles, so the weeks feel less robotic (the owner, 2026-11-10:
    "Plan styles, then AI"): "Just finish" or "Goal time". A workout day's
    run moves from strides to tempo to peak sessions and tapers; with a
    goal time a half or marathon long run finishes at goal pace and race
    day aims at it. The preview lists each week's long run and workout.
    Second PR.
  - "Keep building, no date": the same rules without an event. Cycles of
    three harder weeks and one easier week step up to a ceiling the member
    sets, then hold there until the block (8 to 24 weeks in the app) ends
    (the owner's pick, 2026-11-10). Third PR.
- [x] **P4 — The web planner and the coach**
  - The web planner shows and edits the block like the app
    ([plan on the web](../web-app/plan.md)); the coach brief describes the
    current week of the block.
  - The coach can lay out a block by the same rules (`build_program`) and
    then change it week by week, so an AI connection customizes the plan
    beyond the rules (the owner, 2026-11-10). With plan styles, second PR.
  - Every kind of block, not just runs (the owner, 2026-11-10: the run
    builders must not read as the only thing the app can plan; the web is
    the place for detailed block design, the phone stays flexible, mostly
    through the coach, and every path still works without AI). The Plan
    tab has one "Plan a block" entry: "Start from my week" (any mix of
    workouts) first, the run builders as starting points, and a coach
    prompt to copy. Then a web block designer: weeks by days, targets
    edited across weeks, a week copied down, and a ramp for any workout.
- [ ] **P5 — Release and owner check**
  - Worker deploy and a TestFlight build on the owner's go-ahead, then the
    owner sets up a block on the iPhone and checks Today and the calendar.
- [x] **P6 — Manual week targets from the phone**
  - Edit a selected workout's sets/rounds, reps or duration and load for one
    block week or that week through the end. Show the reusable target beside
    the effective week target and allow removing an override.
  - Group round edits update every member together. Preserve unrelated slot
    targets, unknown and assisted loads, units, other weeks and completed history.
  - Refuse changes to effective targets of recorded in-progress workouts in
    the shared program writer, with an atomic session-roster guard against a
    concurrent start/swap. The phone also refuses changes to its mounted
    pre-first-set runner. Another device's offline/unlogged start is not
    observable by the server; it retains the existing live-plan behavior.
    Do not promise that all remote unlogged runners have frozen targets.
  - Label repeating-cycle scope explicitly: the selected indexed week changes
    each time the block repeats. Session-only runner changes and reusable
    workout editing keep their separate entry points and descriptions.
  - Preserve dirty input and bind saves to the reviewed account, plan,
    program and version. A changed plan requires review, not silent rebasing.
  - Reuse the existing whole-program writer and web target/ramp editor. Share
    the reviewed lighter-week path with coach-free planning P2; do not add
    automatic post-workout weight suggestions.
  - Delivered with coach-free planning P2 in public PR #9, which Nick merged
    on 2026-11-16. The API with the active-workout guard was released on
    2026-11-17 before the web app and TestFlight 1.2 (83), both from the same
    commit. Device acceptance belongs to P5.

- [ ] **P7 — The block's own workouts on the phone**
  - The iPhone app reads and writes `program.workout_ids`, so phone and web
    plan the same way (the owner, 2026-11-18: close the biggest gap between
    them). Starting a block from your week asks which workouts it plans week
    by week (each weekday's main workout with exercises is switched on); the
    rest carry on every week beside it, and the picked ones leave Your week
    in the same plan version, as the web's guided start does.
  - The block's week shows what comes from Your week muted and tagged
    "Every week"; a day change touches only the block's own workouts (sent
    in own form; the server lays Your week back over it). "In this block"
    lists its workouts with their days: one opens to change its days in
    every week of the block, edit that week's targets or remove it from the
    block (with the targets the block gave it); "Add a workout to the block"
    moves one from Your week on its days or puts another on chosen days. A
    block that never listed its workouts (started on an older build, by the
    coach or by the event builder) gets "Choose the block's own workouts".
  - Your week reads "Carries on beside the block every week" while a layered
    block is in use. Whole-week edits (labels, copy, add or remove a week,
    targets) keep the list.
  - Pure rules in `ios/TresFort/BlockLayers.swift` mirror `src/programLayers.ts`
    and `web/src/blockLayers.ts`; `ios/TresFortTests/Fixtures/BlockLayers.json`
    pins layering, own form and the trimmed repeating week on both sides
    (`web/test/blockLayersFixture.test.ts`, `BlockLayersTests`). No API
    change: `PUT /api/plan/program` already takes `workout_ids` and
    `schedule`.
  - Layout: mock options A, B and C are in the project files at
    `block-on-iphone/` and in the mock kit (`plan-block-*.html`). A (list
    under the block's week) is built while the owner chooses.

## Execution frontier

- P5
- P7

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P2 | coordinates_with | plan:app-design-pass#P13 | Both change the Plan tab's Schedule side. |
| P3 | coordinates_with | plan:coach-free-planning#P1 | The goal date for a taper is the race goal the member will set in the app. |
| P4 | coordinates_with | plan:web-app | The web planner edits the same plan document. |
| P5 | gated_by | external:owner-progressive-plan-release-and-device-check | Repository implementation does not establish deployment or physical acceptance. |
| P7 | coordinates_with | plan:web-app | The phone writes the same block list and repeating week the web Block tab does. |
| P7 | gated_by | external:owner-block-layout-choice-and-device-check | The owner picks the layout from the mocks, then checks a layered block on a TestFlight build. |

## Next step

**Now (@owner):** P5 on TestFlight 1.2 (83) or later. The API, web app and
build 83 all come from main of 2026-11-17, which includes P6's week-target
sheets and the API guard that refuses target changes to a workout in
progress. Set up a block on the iPhone, change one week's target and then
that week through the end, preview a lighter week, and check the same week
on the phone, the web, Today and the calendar. A block started on the web
with its own workout list (web-app P2) also shows on those dates beside what
repeats every week.

**Then (@owner):** P7: pick the layout for the block's own workouts (A is
built), then review its pull request. After a TestFlight build with it,
start a block on the iPhone with some workouts switched off, check that they
carry on beside it on Today and the calendar, move a block workout to
another day, add one from Your week and see the same block on the web's
Block tab.

The rule-based event and open builders (`EventBuildSheet`, `programBuilder`,
`build_program`), the native block chooser and the web target and ramp
designer already exist; rebuilding them is not next work. The phone's local
check cannot protect a recorded session on another device by itself.

## Notes / open questions

- Weight suggestions after each workout (a canonical `progression` rule read
  by the app) were built and then set aside on the owner's word
  (2026-11-08). The patch is kept in the project files at
  `plan-progression/lift-suggestions-p0.patch` if it is wanted later.
- A block can list its own workouts (`program.workout_ids`, web-app P2,
  2026-11-16): the repeating week then carries on beside it. Stored weeks
  still hold the whole day, so the app's `PlanTree.schedule(on:)` and the
  parity fixture are unchanged. P7 teaches the app to write the list;
  builds before it keep a list they were given.
- Older clients that predate block support show the repeating week. Current
  source supports blocks, but source inspection does not identify the build
  installed on a member's device. P5 verifies the chosen release candidate.
