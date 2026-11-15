# Plan over blocks and cycles, not just one week

Slug: progressive-plans · Status: active · Updated: 2026-11-10 · Theme: gym-floor

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
- [ ] **P3 — Weeks laid out by rules**
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
- [ ] **P4 — The web planner and the coach**
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

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P2 | coordinates_with | plan:app-design-pass#P13 | Both change the Plan tab's Schedule side. |
| P3 | coordinates_with | plan:coach-free-planning#P1 | The goal date for a taper is the race goal the member will set in the app. |
| P4 | coordinates_with | plan:web-app | The web planner edits the same plan document. |

## Next step

**Now (@agent):** One "Plan a block" entry on the Plan tab (P4), then the
web Block page (spec).

**Next (@owner):** Release #422 and P3 with a Worker deploy and a
TestFlight build, then check a block on the iPhone (P5).

## Notes / open questions

- Weight suggestions after each workout (a canonical `progression` rule read
  by the app) were built and then set aside on the owner's word
  (2026-11-08). The patch is kept in the project files at
  `plan-progression/lift-suggestions-p0.patch` if it is wanted later.
- The App Store build 55 does not read `program`, so it keeps showing the
  repeating week. Until P2 ships, only the coach (`set_program`) can make a
  block, so a member on an older build could see the coach's block in chat
  but not in the app; P5 releases P0 to P2 together.
