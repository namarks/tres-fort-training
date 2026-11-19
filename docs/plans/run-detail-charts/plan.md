# Run detail charts

Slug: run-detail-charts · Status: gated · Updated: 2026-11-19 · Theme: connected-training

## Goal

A member opening one of their runs (or rides) in the app or on the web sees
how it went over time: pace, heart rate and elevation charts beside the map,
with the value at any point a tap or drag away, and the climb in meters or
feet. It works without AI and without intervals.icu: a run recorded in the
app or saved to Apple Health by another app has all three charts from data
Tres Fort keeps, and an intervals.icu activity is charted from intervals.icu,
with a ride's own streams kept so its charts survive intervals.icu (P8). A
series the activity has no data for is left out, never made up. Charts are
private to the member, like routes: never in group views or coach tools.

## Phases

- [x] **P0 — Chart series endpoint**
  - `GET /api/activities/:id/streams` (app JWT) returns
    `{ activity_id, source, streams }`, the shape in
    `src/activityStreams.ts`: moving seconds, cumulative meters, speed
    (pace is its inverse), heart rate and smoothed elevation, at most 500
    evenly spaced points of at least five seconds, plus moving time, total
    distance and elevation gain (rises under 3 m ignored).
  - Pauses are cut out of the clock: a route segment break, or a recording
    gap over 30 seconds, adds no time, so the pace either side is true.
  - An intervals.icu activity is read from intervals.icu (heart rate
    included) and not stored. When intervals.icu can't give one, or for a
    recorded or Apple Health run, the stored route gives pace and
    elevation. 404 when there is nothing to chart; 502 when intervals.icu is
    unavailable and there is no stored route.
- [x] **P1 — Charts in the app**
  - Every activity card with series (any intervals.icu activity, every run
    with a route) and a planned run's record show pace, heart rate and
    elevation charts (Swift Charts) below the map, on one axis: distance in
    the member's miles or kilometers, else moving minutes. Touching a chart
    reads its value at that point and marks the same point on the others.
    Pace in min/mi or min/km (faster is up), speed for a ride, elevation in
    feet with miles; standing still or missing data breaks the line, and
    one GPS hiccup is held to the 2nd to 98th percentile.
  - Series load when the card appears and are kept in memory per account
    (`ActivityStreamsStore`); "nothing to chart" is remembered for ten
    minutes and a failed read is tried again. A chart with no data is left
    out.
  - Fix (2026-11-07): on device no card ever showed charts. The read was a
    `.task` on the charts view, which is empty until series arrive, and
    SwiftUI never runs a task on an empty view. `WithActivityStreams` now
    reads them from the whole card, like `WithActivityRoute`.
- [x] **P2 — Charts on the web**
  - The same charts under each completed activity in the web day panel
    (`web/src/ActivityChartsView.tsx`, pure series and paths in
    `web/src/activityCharts.ts`), as inline SVG in the Ink palette for light
    and dark. Pointing at or touching any chart reads all of them at that
    point; with no pointer each shows its average.
- [x] **P3 — Heart rate kept for the member's own workouts**
  - Migration 0068 adds `activity_heart_rates`, one private row per
    workout in the encoding of `src/heartRateSeries.ts`: one whole-bpm
    reading per second of moving time, delta-coded, with the epoch time
    its clock starts at. It is filled from the recorder's TCX upload and
    `.fit` imports (a retry or re-upload can add it to a workout stored
    without one, never replace it) and from an Apple Health workout's
    heart-rate stream push (a later push replaces it, streams with no
    heart rate clear it, a push without streams keeps it). The owner first
    approved runs, then on 2026-11-06 chose every workout with heart rate.
    Account export includes it; account deletion, deleting a recorded run
    (with its Apple Health copies) or a `.fit` import remove it.
  - The endpoint charts it with the stored route, or alone over moving
    time for a workout with no route. Both sources already take pauses
    out of its clock, so it is laid on the route's moving time, shifted
    by the time between the series' start and the route's first GPS fix.
    The app and the web ask for charts on any Apple Health, `.fit` or
    recorded workout with an average heart rate.
  - The app now reads heart rate for every Apple Health workout (only
    runs, rides and heart-rate-scored sports get load from it; others
    keep their load) and re-sends the last year's workouts once (a third
    one-time streams pass), so past workouts get the chart. Runs recorded
    in the app before this release keep no series: the app deleted their
    files once the upload was acknowledged.
  - Privacy policy (website and the Worker's `/privacy`) and the app's
    Apple Health settings text say workouts' heart-rate readings are kept,
    private, and how they are deleted. The App Privacy label already
    declares Health and Fitness data linked to the member for app
    functionality, so its answers don't change.
- [x] **P5 — The map follows the charts, and opens full screen**
  - The owner asked on 2026-11-07 (thread "Link run charts to an
    expandable map") for a map that expands and a dot that moves along the
    route while a chart is dragged.
  - The streams endpoint adds `lat` and `lon`, one position per point: the
    GPS fix nearest the point's middle, from within the point's own time,
    to five decimal places, null where the point has no fix and both null
    for an activity with no positions. They come from the same intervals.icu
    `latlng` stream or stored route the charts already read, served to the
    member only, so nothing new is stored or shared.
  - In the app the map and charts are one section (`ActivityChartsSection`)
    sharing the touched point: touching any chart puts a dot on the route
    thumbnail at that point. The thumbnail has an expand button and opens
    full screen (`ActivityRouteDetailView`): the map, moved and zoomed by
    hand, with a map or satellite switch, and the charts under it, which
    move the dot the same way. Series from an older server have no
    positions, so the charts work as before with no dot.
  - Apple Maps (MapKit) stays the map: it is built into iOS with no key,
    tile bill or extra SDK, and SwiftUI's `Map` draws the route and the dot
    natively. OpenStreetMap would need a third-party SDK (MapLibre) and a
    paid tile host, as OpenStreetMap's own tile servers don't allow app
    traffic; its edge is footpath and trail detail, which satellite view
    covers for now.
  - The web day panel keeps its separate map and charts; a dot there is a
    later idea.
- [x] **P6 — Power and cadence for rides**
  - The owner asked on 2026-11-10 for more cycling stats on activities,
    like power. The streams endpoint now also reads intervals.icu's
    `watts` and `cadence` streams (still read live, nothing stored) and
    serves `power_w` and `cadence_rpm` series beside the others, plus
    `power` and `cadence` figures worked out by `src/ridePower.ts` from the
    full-rate readings on moving time: average (coasting included),
    normalized and maximum power, work in kJ, best average power for 5 s,
    30 s, 1, 5, 20 and 60 minutes, and time in seven power zones of the
    member's cycling FTP on the ride's date (`athlete_thresholds`), with
    intensity (NP over FTP); cadence averages pedalling only. Without an
    FTP the zones are left out and the app says where to set one. Power
    covering under half the moving time, or all zeros (a meter not
    measuring), gives no power. A run's power (a foot pod) is shown without
    cycling zones, and only a ride gets cadence.
  - The app and the web day panel draw power and cadence charts with the
    others (power in the categorical violet, cadence in teal) and show a
    power section under them: the figures above, variability (NP over
    average), best efforts and a bar per zone. Older servers send none of
    the new fields, so the charts work as before.
  - Rides from Apple Health and `.fit` imports kept only a normalized
    power summary (migration 0061); P7 keeps their power series.
- [x] **P7 — Keep ride power without intervals.icu**
  - Migration 0074 adds `activity_power_series`: one row per workout with
    its power and cadence readings, one per whole second of moving time,
    delta-coded JSON text owned by `src/powerSeries.ts` (like
    `activity_heart_rates`). All-zero power (a meter paired but not
    measuring) is not kept.
  - Kept for a `.fit` import and a Garmin workout (power, and cadence for a
    ride, from the file's records; `src/fitFile.ts` now reads cadence) and
    for an Apple Health ride whose push carries power `streams`. A Health
    push that sends streams without power clears a kept series; one with
    no streams keeps it. Re-uploading a `.fit` file adds a series to a
    workout imported before P7. Apple Health cadence is not read yet.
  - The app runs a one-time pass (`healthPowerBackfillKey`) that re-pushes
    Apple Health rides with power so rides synced before P7 get a chart.
  - `GET /api/activities/:id/streams` charts a kept series on the moving
    clock, with best efforts and zones from the member's ride FTP, for the
    workout or the duplicate it was merged into (an intervals.icu copy
    still reads intervals.icu live). The app and web ask for charts for
    every Apple Health, `.fit` and Garmin ride (Apple Health sends no
    average power to gate on); a ride with nothing kept gets no charts.
  - Private like heart rate: never in group views or coach tools; removed
    with the workout, on Garmin disconnect and on account deletion; in the
    account export. The privacy policy and the Apple Health settings text
    say so.
- [ ] **P8 — Keep intervals.icu rides' streams**
  - The owner asked on 2026-11-19 (thread "Get full Zwift ride data into
    Tres Fort"), before a Zwift ride, whether its full data reaches Tres
    Fort, then to keep it, elevation and the other stats included. Zwift
    rides arrive through intervals.icu's own Zwift connection (not Strava,
    whose activities intervals.icu withholds), but their streams were only
    read live, so a ride gone from intervals.icu, or intervals.icu down,
    lost its charts.
  - After each successful activity sync, `keepIntervalsRideSeries`
    (`src/db.ts`) reads the streams of intervals.icu rides in the synced
    window that have none kept yet and whose `stream_types` name heart
    rate, power, cadence, distance or altitude: newest first, at most three
    a sync (one request each), so a backlog clears over a few hourly
    syncs. A refusal skips the ride this time; a 429, timeout or 5xx ends
    the run; nothing fails the sync. Rides older than the window keep
    reading intervals.icu live.
  - `src/intervalsRideSeries.ts` (pure) puts the streams on moving time
    (a gap over 30 seconds adds no time, as the live charts count it):
    heart rate in `activity_heart_rates`, and power, cadence, distance
    and altitude in `activity_power_series`, whose JSON gains optional
    `distance` and `altitude` in decimeters (no migration; older rows have
    neither). A trainer ride whose distance never moves keeps none. GPS
    positions are not kept: an outdoor ride's map still comes from
    intervals.icu. The first series kept stays.
  - `GET /api/activities/:id/streams` still reads intervals.icu first;
    when it can't answer, the kept series draw the same charts (speed,
    elevation, heart rate, power, cadence, best efforts and zones), the
    timeline built from the kept distance and altitude
    (`trackFromPowerSeries`). A `.fit` or Garmin copy's series is still
    preferred to the ride's own.
  - Private like the others: never in group views or coach tools; in the
    account export; removed with the account, and when a ride in the sync
    window leaves intervals.icu (the sync tombstones it and the series are
    forgotten). The privacy policy says intervals.icu rides' readings are
    kept.
- [ ] **P4 — Release and check on device**
  - On the owner's written go-ahead for each: apply migration 0068 and
    deploy the API, deploy `tres-fort-web` and the website (privacy
    policy), and upload a TestFlight build after the release check passes
    on its commit.
  - On device: an intervals.icu run, a run recorded in the app and an
    Apple Health run each show their charts, heart rate included, and an
    Apple Health sport (soccer) shows its heart-rate chart; then
    archive this plan. TestFlight 66 and 67 show no charts at all (see the
    P1 fix), so this check needs a build with that fix.
  - P6 and P7 go out together: migration 0074, then the API, the web app
    and the website (privacy policy), and a TestFlight build, each on the
    owner's written go-ahead. On device, a Zwift ride from intervals.icu
    shows power and cadence charts, best efforts and time in zones from
    the FTP set in Training thresholds, and so does a `.fit` ride with
    power imported in the app or on the web.
  - P6 and P7 released 2026-11-11 with workout-library
    P3 on the owner's written go-ahead: migrations 0074 and 0075, API
    Worker, web and website. The release check failed three Add
    to your week UI journeys (fixed under app-design-pass P24); run then passed in full, and TestFlight 1.2
    (79) was uploaded on the owner's written go-ahead.
  - P8 goes out on the owner's written go-ahead: the API Worker and the
    website (privacy policy); no migration and no app build. Then a new
    Zwift ride shows rows in `activity_heart_rates` and
    `activity_power_series` (diagnostics `/activities/:id` and `/sync`).
  - P5 shipped with the 2026-11-08 release (API, web and TestFlight 69, no
    migration; 2026-11-08). On device: dragging a chart moves the dot on a
    recorded run's, an intervals.icu run's and an Apple Health run's map,
    and the expand button opens the map full screen with the charts.

## Execution frontier

- P8
- P4

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P3 | coordinates_with | plan:run-recorder | The recorder's upload and summary screen changed in the same release window; P3 took migration 0068, after their 0067. |
| P4 | gated_by | external:owner-release-approval | Production migration, deploys and client distribution each need the owner's written go-ahead. |
| P3 | coordinates_with | plan:app-store-submission | Storing a heart-rate series changes the App Privacy answers. |
| P7 | coordinates_with | plan:garmin | Garmin workouts keep their power series through the `.fit` pipeline and lose it on disconnect. |

P1 and P2 draw the series P0 serves; P3 adds heart rate to the same
series, so it can follow P1 or run beside it.

## Next step

**Now (@agent):** P8 in review (keep intervals.icu rides' streams). Once
merged, the owner's written go-ahead deploys the API Worker and the website
(privacy policy); then check a new Zwift ride kept its series.

**Then (@owner):** The P4 device checks, on TestFlight 1.2 (83) or later,
which carries P0 to P7 (the owner already saw charts on build 68): drag a
chart and watch the dot move on a recorded run's, an intervals.icu run's and
an Apple Health run's map, open the map full screen (P5); then a Zwift ride
from intervals.icu and a `.fit` ride with power show power and cadence
charts, best efforts and time in zones (P6, P7). Everything is released on
the server and web (P6 and P7 since 2026-11-11). Archive this plan once
those look right.

## Notes / open questions

- Grade-adjusted pace, splits on the chart and heart-rate zones bands are
  later ideas, not in this plan.
- Opening an intervals.icu run asks intervals.icu twice (route and
  streams); fine at a member's pace of use, revisit if it rate-limits.
- P8 keeps rides only. Keeping intervals.icu runs' heart rate the same way,
  and backfilling rides older than the sync window, are later ideas.
- P8 can't mark a ride whose streams never encode (every reading invalid),
  so it is asked again each sync until it leaves the 90-day window; with
  three a sync, a few such rides only slow the backlog.
