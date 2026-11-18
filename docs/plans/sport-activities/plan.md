# Capture every sport properly

Slug: sport-activities · Status: active · Updated: 2026-11-18 · Theme: connected-training

## Goal

Every session a member does, not only lifts, runs and rides, lands in Tres
Fort as the sport it was, with the details that matter for that sport and a
load the member can trust, whether it came from Apple Health, intervals.icu,
a `.fit` file or the member's own hand entry, and without an AI coach. Done
means:

- a soccer match, tennis set, climbing session or swim shows as that sport
  (name and icon) in Today, the Activity tab, the day view and the group feed,
  never as "Workout" or "Other";
- a planned activity on the week ("Soccer every Monday") is marked done when
  the watch recorded that sport that day, whatever the watch called it;
- any sport with heart rate gets a heart-rate load, and any sport without
  data can get a clearly labeled effort estimate from one tap or from Apple
  Watch's effort score;
- a member can log a sport by hand with the fields that sport needs, and it
  is kept in Tres Fort whether or not intervals.icu is connected; and
- a swim keeps its pool, length count, distance, pace per 100, strokes per
  length and stroke types when the source has them, and can be entered by hand
  as pool length plus lengths.

## Phases

- [x] **P0 — Name every sport**
  - `src/sports.ts` holds the sport list (id and label) and the maps from
    Apple Health activity types, intervals.icu `type` and FIT sport and
    sub-sport. `ios/TresFort/Sports.swift` mirrors it with icons; both are
    pinned to `ios/TresFortTests/Fixtures/Sports.json`
    (`test/sports.test.ts`, `SportsTests.swift`).
  - Migration `0064` adds `external_activities.sport` beside `kind`, which
    stays coarse so dedup and older app builds are unchanged. The
    intervals.icu sync, Apple Health push, `.fit` import and run recorder set
    it. The Worker derives an Apple Health workout's sport from the activity
    type the app keeps in `raw`, so older builds get named sports too, and an
    Apple Health workout an older app called "Workout" takes its sport's
    name. The migration backfills existing rows the same way (its lookup
    tables are tested against `src/sports.ts`) and moves live rows' cursor so
    installed apps receive the sport.
  - The app names and draws each activity by its sport in the Activity tab,
    day view, Today and the group feed; the log sheet offers every sport
    (local `activities.type` uses the same ids); a planned activity named for
    a sport ("Soccer") counts as done when a workout of that sport was
    recorded that day, whatever the watch called it.
  - `get_recent_activities`, the coach brief, the group feed and the web
    calendar report or show the sport.
- [x] **P1 — Heart-rate load for any sport**
  - `HEART_RATE_THRESHOLDS` in `src/sports.ts` (pinned to `Sports.json`,
    mirrored as `Sports.heartRateScored`) names whose threshold heart rate
    scores each sport: on-foot and court, field, racquet, snow and combat
    sports use the run one, rides the ride one. Swims, strength, mind-body,
    rowing, paddling, golf and other sports get none.
  - `refreshActivityLoads` (`thresholdSetFor`) gives those sports only the
    threshold heart rate, never pace or power, so a match's distance or a
    hike's pace never decides its load. Heart-rate samples win over the
    average; sparse samples still store nothing, as in
    endurance-training-load P3. The compare-and-swap also checks `sport`.
  - The Apple Health import reads heart-rate samples for those sports, and a
    second one-time pass pushes the last 365 days of them again with
    samples (`healthSportStreamsBackfillKey`). Heart rate is already an
    allowed Apple Health read, so no new permission is asked. Existing rows
    from other sources are rescored on their next sync or threshold change.
- [x] **P2 — Effort when there is no data**
  - Delivers endurance-training-load P6 for every sport. Migration `0066`
    adds `external_activities.effort`, the member's own 1 to 10 "How hard was
    it?", and widens `load_method` to include `effort` (SQLite can't change
    a CHECK in place, so the column is replaced; values and `synced_at` are
    unchanged).
  - The scale is fixed in `src/trainingLoad.ts` (`EFFORT_SCALE`,
    `effortLoad`): session effort, minutes × rating, scaled so one hour at
    effort 7 ("very hard", about an hour at threshold) is 100; intensity
    stays unknown. `selectLoad` uses it last, so a provider, power,
    heart-rate or pace load always wins, and moving time falls back to
    elapsed time. Covered by `test/training_load.test.ts`.
  - `PUT /api/activities/:id/effort` (`setActivityEffort`) rates a live
    workout or clears it with null, writing the row and the copies hidden as
    its duplicates, then rescores the day. Importers never send or
    overwrite the rating. A shown copy without a rating takes a hidden
    copy's, and a hidden copy without one takes the shown copy's, so a
    rating survives whichever source delivers the same workout later and
    a restore when the shown copy goes away. Covered by
    `test/activity_load.test.ts` ("effort rating").
  - The day view shows ten one-tap buttons on any workout without a measured
    load, a planned run's record included (and keeps them once the rating
    scores it, to change or clear); the
    load is labeled "effort estimate" in the app and "estimated from your
    effort rating" on the web (`EffortRating.swift`,
    `EffortRatingTests.swift`).
  - The coach's `rate_activity` records a rating the member gives, and
    `get_recent_activities` reports `effort`, so app and coach stay at
    parity.
- [ ] **P3 — Log any sport by hand, kept in Tres Fort**
  - The log sheet gets a searchable sport list (the member's recent and
    planned sports first) and shows each sport's fields: time and effort
    always; distance for distance sports; pool or open water, pool length and
    lengths for swims; optional average heart rate.
  - Hand-entered sessions are stored in Tres Fort (proposed: an
    `external_activities` row with `source='manual'`, so load, dedup, the
    Activity tab and the group feed treat them like any workout). When
    intervals.icu is connected, runs, rides, swims and walks are also copied
    there under the existing `tresfort:activity:` marker and the copy is
    hidden as a duplicate. The owner chose this on 2026-11-03 ("In Tres
    Fort, copy to intervals"), replacing today's intervals.icu-only route for
    hand-entered endurance.
  - The coach's `log_activity` takes the same fields, so app and coach stay at
    parity.
- [ ] **P4 — Swimming detail**
  - First slice, done (2026-11-09, no migration and no new permission): the
    day view shows a workout's distance in the member's units (yards or
    meters for a swim) and its pace or speed; swims show pace per 100
    (`EnduranceProgress.pace`, web `formatPace`); and the Activity week card,
    the web Activity summary and the web Analysis distance tile include
    swims, showing the distance of the kind with the most time
    (`ActivitySummary`, web `summarize` and `distanceKind`).
  - Second slice, done (2026-11-09, migration `0072`, owner's choice of
    "Swim detail + new permission" that day): Apple Health swim detail. The
    app reads pool or open water (`HKMetadataKeySwimmingLocationType`), the
    pool's length and the unit it was set in (`HKMetadataKeyLapLength`;
    yards when it is a whole number of yards and not of meters), one lap
    event per length and one segment event per set with its stroke style,
    and the workout's own swim distance and stroke count samples
    (`HealthSwimDetail.swift`), and sends them as `swim` with the workout.
    Nothing is estimated: a length without a matching sample has no
    distance or stroke count. A fourth one-time pass pushes the last 365
    days of swims again with the detail (`healthSwimBackfillKey`), and an
    open-water swim's route is sent like a run's.
  - The Worker checks the detail against `src/swimDetail.ts` (the format's
    owner, with `SWIM_LIMITS`) and keeps one `activity_swims` row per swim,
    its lengths and sets as JSON; a push with `swim: null` clears it, and it
    is deleted with the account and exported under `training`.
    `GET /api/activities/:id/swim` serves it with a summary (lengths,
    strokes, strokes per length, SWOLF, lengths by stroke), also for
    another source's copy an Apple Health swim was matched to. The day view
    (`SwimDetailView.swift`) and the web Activity page
    (`web/src/swimDetail.ts`) show the pool, those figures and one line per
    set in the pool's own unit with pace per 100; swims draw no pace or
    elevation chart. Covered by `test/swim_detail.test.ts`,
    `web/test/swimDetail.test.ts` and `SwimDetailTests.swift`.
  - Left: the same detail from `.fit` files and intervals.icu (checked
    against real rows first); a swim threshold (critical swim speed, per
    100 m or 100 yd) in Training thresholds and a pace load from it. Hand
    entry as pool length plus lengths comes with P3.
- [x] **P5 — Apple Watch's effort score**
  - Split from P2 on 2026-11-04 because it needs a new Apple Health
    permission; the owner gave the go-ahead on 2026-11-09 ("Swim detail +
    new permission").
  - On iOS 18 and later the app asks once for Apple Health's workout effort
    score and estimated effort score and sends the member's rating there,
    else the watch's estimate, as `provider_effort` (1 to 10) with each
    workout (`HealthEffortScore`); a fifth one-time pass sends it for the
    last 365 days (`healthEffortBackfillKey`), only on iOS 18 and later, so
    a member who upgrades from iOS 17 still gets it. A push that omits it
    keeps the stored score, and null clears it.
  - Migration `0072` adds `external_activities.provider_effort`.
    `refreshActivityLoads` scores the `effort` load from the member's own
    Tres Fort rating when there is one, else from Apple's score, and any
    measured load still wins. The day view labels such a load "Apple Watch
    effort" and says the member's tap replaces it; the web does the same,
    and `get_recent_activities` reports it as `watch_effort` beside
    `effort`. Covered by `test/swim_detail.test.ts` and
    `EffortRatingTests.swift`.

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P0 | coordinates_with | plan:activity-integration-integrity | Both change `external_activities` rows; dedup rules stay owned there and keep matching on `kind`. |
| P5 | gated_by | external:owner-new-health-permission | Reading Apple Watch's effort score is a new Apple Health permission (owner's go-ahead 2026-11-09). |
| P4 | gated_by | external:owner-new-health-permission | Swim stroke counts are a new Apple Health permission (owner's go-ahead 2026-11-09). |

## Next step

**Now (@agent):** P3, logging any sport by hand and keeping it in Tres Fort
(intervals.icu an optional copy, owner's choice of 2026-11-03), with the
effort rating among its fields. P0, P1, P2, P5 and P4's first two slices
are live on the API and the web app (see Release; P2 since the 2026-11-04
release, run-recorder plan), and P4's swim detail and
P5 are in TestFlight 1.2 (76). P4's `.fit`, intervals.icu and
swim-threshold work follows P3.

**Owner:** check an Apple Watch swim on build 76 or later (83 is current): the pool,
lengths, strokes and sets in the day view, an open-water swim's map, and a
load from Apple Watch's effort score. Builds 55 and 70 keep working: they
never send `swim` or `provider_effort`.

The App Store privacy answers need no change for this (checked
2026-11-09): stroke counts, lengths and the effort score are Health and
Fitness data and an open-water swim's route is Precise Location, all
already on the live label (linked, App Functionality, no tracking;
release 70), and the privacy
policy names them since the 2026-11-09 website deploy. The app's privacy
manifest now declares Precise Location too, matching that label.

## Notes / open questions

- Not in this plan: planning other sports with targets (a planned swim set
  or a 90-minute match with an effort goal), team or match stats (goals,
  scores, positions) and Garmin's direct API (endurance-training-load P5).
  Each can follow if the owner wants it.
- App Store 1.0 stays on build 55. Each phase's Worker deploy, migration and
  app build needs the owner's separate go-ahead, and the new Apple Health
  permissions change the App Store privacy answers for the next version.
- Older app builds keep sending `kind` only; the Worker derives `sport` from
  the HealthKit type in `raw`, so they still get named sports.
- Older app builds can't rate a workout, and show a rated workout's load
  without the "effort estimate" label (an intervals.icu one as
  "intervals.icu").
- Older app builds show a load scored from Apple Watch's effort score as
  "effort estimate", and show no swim detail; the web shows both.
- The rating is the member's own and stays out of the group feed, which
  lists only the provider's load.
- intervals.icu's swim and per-length fields are checked against the owner's
  own synced rows before P4 relies on them; anything missing stays unknown,
  never estimated.
