# Run recorder on iPhone

Slug: run-recorder · Status: active · Updated: 2026-11-18 · Theme: connected-training

## Goal

Let a member record an outdoor run in the Tres Fort iPhone app instead of
Strava. The run gets live time, distance and pace and a GPS route, is saved
to Apple Health, and is kept by Tres Fort itself, route included, so the app
and web can show it without any other service. When the member has
intervals.icu, it also reaches intervals.icu as a full activity file, so the
coach sees it in the same place as Garmin runs.

## Phases

- [x] **P0 — Upload a recorded run to intervals.icu**
  - `POST /api/activities/recordings` (app JWT, multipart `id`, `date`,
    optional `name`, `file`) uploads one recorded run to the member's
    intervals.icu account through `uploadActivityFile` in `src/intervals.ts`
    with external_id `tresfort:recording:<uuid>`.
  - Retries are idempotent on that external_id: a retry that finds the
    activity a day either side of the run date returns it instead of
    uploading again, and a file intervals.icu already had answers 200.
  - Only `.fit`, `.gpx` and `.tcx` files up to 10 MB whose first bytes match
    the extension are accepted. The file passes through and is never stored
    in D1; the existing activity sync brings the run into
    `external_activities`. (P5 changes this: Tres Fort keeps the run itself
    and accepts only the recorder's TCX.)
  - Provider failure is an error with no local fallback. A write 401/403
    never disconnects the read credential, the same as `log_activity`.
- [x] **P1 — Record a run on iPhone**
  - [x] **(a) Keep and upload recorded runs on the device**
    - `RecordedRun` holds the route, heart-rate samples, pauses, the workout
      builder's distance and moving time, and the device-local civil date.
    - `RecordedRunTCX` encodes it as TCX, not GPX, so the upload keeps the
      builder's totals: the lap carries moving time and distance, and each
      track point a cumulative distance scaled to that total. Each pause
      starts a new track and paused distance never counts. Heart rate is
      attached only within 5 seconds of a point.
    - `RunRecordingStore` keeps one file per run in an account-scoped,
      backup-excluded directory until the server acknowledges the upload.
      Files use `completeUntilFirstUserAuthentication` so checkpoints still
      save with the phone locked mid-run. Account deletion removes them.
    - `RunRecordingUploader` sends finished runs to P0's endpoint as
      multipart TCX, removes each only after a 200/201, keeps failures for
      the next attempt and stops on a rejected bearer.
  - [x] **(b) Record with a workout session**
    - "Record a run" in Today's "+" menu opens a full-screen recorder on
      iOS 26 or later on iPhone, which supports `HKWorkoutSession`,
      `HKLiveWorkoutBuilder` and `HKWorkoutRouteBuilder`. On older iOS, on
      iPad and in the App Store build the entry stays hidden. The app's iOS 17
      minimum doesn't change.
    - Start, pause, resume and end (save or discard) an outdoor run. The
      screen shows time, miles, current pace over the last 30 seconds,
      average pace, heart rate when Health has a recent sample, and the route
      on a map. Distance comes from the workout builder (Apple's own fusion),
      never from summing raw GPS points.
    - `RunRecorderModel` owns the run; `HealthRunWorkoutEngine` and
      `CoreLocationRunSource` sit behind protocols so the logic is tested
      without HealthKit or GPS. Fixes less precise than 50 m, older than the
      start, or implying more than 12 m/s are dropped.
    - It asks for When In Use location (precise) and permission to write
      workouts and routes to Apple Health. Updates continue with the phone
      locked through the `location` background mode and a background
      activity session. The beta's Health update string now says runs are
      saved; the App Store build keeps its read-only string and removes the
      location keys from its processed Info.plist, checked by
      `test/app-store-packaging.test.py` and a runtime test in both App Store
      shards.
    - The finished run is saved to Apple Health as an `HKWorkout` with its
      route and the recording's external_id. The existing Apple Health sync
      pushes its summary, and the server retires that copy once the
      intervals.icu upload arrives (intervals wins the start-time match).
    - The run is checkpointed into (a)'s store at the start, on every pause
      or resume and every 10 seconds of route. On launch, a run whose Health
      session survived is reattached with its route refilled; otherwise it
      finishes at its last point or pause and uploads. Finished runs upload
      on finish, launch and foreground. If the Health session fails mid-run,
      or Health doesn't save the workout, the run still uploads.
- [x] **P2 — Run from the Lock Screen**
  - Show a Live Activity with time, distance and pace, plus pause and end
    controls, from the existing widget extension.
  - Give optional spoken split announcements per kilometre or mile.
  - Delivered: the widget extension's `RunActivityWidget` shows the moving
    time (a system timer from the start shifted by pauses, frozen while
    paused), distance and current pace on the Lock Screen and in the Dynamic
    Island. Distance and pace update at most every 5 seconds; pause and
    resume update at once. Its buttons run `RunRecorderControlIntent` in the
    app: Pause while running, Resume and Finish while paused, so finishing
    takes two taps and a pocket tap can't end the run. Only the run being
    recorded answers. The activity ends when the run is saved, discarded or
    lost, and a relaunch picks a recovered run's activity back up.
  - The recorder offers miles or kilometers for its screen, Lock Screen and
    splits, and an optional announcement of each whole unit (split time and
    average pace), off by default and mutable from the header mid-run. Both
    choices stay on the device. Speech ducks other audio, which needs the
    `audio` background mode; the App Store build removes it with the other
    background modes.
  - Music that stayed paused (2026-11-13): on the owner's run on 2026-11-12,
    music sometimes paused for an announcement and didn't come back. The
    speaker gave the audio session back the moment the synthesizer reported
    the end of an utterance, with every error ignored. At that moment the
    speech output can still be running, so the release answers busy (or the
    synthesizer still says it is speaking and the release was skipped), and
    the paused or ducked app is never told it may resume.
    `RunAnnouncementAudio` now waits 0.3 seconds, then retries the release
    with a growing delay for about 8 seconds until the session lets go; a
    new announcement takes the session over and cancels a waiting release.
    Not yet heard on a device: next, a run with music on a TestFlight build
    that carries it.
- [ ] **P3 — Verify accuracy and reliability on a real device**
  - Record at least three outdoor runs on the owner's iPhone (open sky,
    trees or buildings, and a run with pauses), and check that distance,
    moving time and pace look right to the owner. The owner dropped the
    side-by-side comparison with the Garmin Forerunner 945 on 2026-10-31,
    so there is no measured tolerance.
  - Verify a locked phone for the whole run, a force-quit mid-run, no network
    at the end, and that the upload and Health save each land once.
  - Confirm against the live intervals.icu API that the first real upload
    creates one activity carrying the recording external_id and name, and
    that a retry returns it. P0's request shape (query-string `name` and
    `external_id`, multipart `file`, 201 created or 200 duplicate) comes
    from intervals.icu's API conventions and has only been tested against
    mocks.
- [ ] **P4 — Auto-pause and a running display**
  - Auto-pause, on by default and switchable before the run: pause when GPS
    speed stays under a walking threshold for a few seconds, and resume
    when it rises again, using the same pause records as a manual pause so
    the builder, splits and Lock Screen agree. A manual pause stays paused
    until the member resumes it. The resume and pause are spoken when
    announcements are on.
  - A glanceable running layout: a few large numbers chosen by the member
    (time, distance, current pace, average pace, heart rate), in place of
    the map. Keep the screen awake while it shows.
  - Don't upload a run too short to analyze (under a minute or 100 m): ask to
    discard it instead. The first P3 session left a zero-length run on
    intervals.icu.
  - Delivered in the repository: "Pause when I stop" (on by default) pauses
    once GPS speed is under 0.8 m/s (see the 2026-11-10 change below) and
    resumes after 2 seconds over 1.4 m/s, saying "Run paused." and "Run resumed." when announcements
    are on; the title reads "Auto-paused". A header button swaps the map for
    four large numbers (pace, distance, time and heart rate by default); a
    tap on a number picks what it shows, and the choices stay on the
    device. The screen stays on while that layout shows during a run. End
    on a run under a minute or 100 m offers only Discard, and a Lock Screen
    Finish on one discards it without a Health workout or upload. In
    TestFlight build 59 (2026-10-31).
  - Auto-pause, tuned after the owner's planned run on 2026-11-10 (build
    78): the pause took 6 to 7 seconds at a crossing during the warm-up and
    never came at a light mid-interval. Every fix had to carry a speed
    reading under 0.8 m/s for 5 seconds, counted only after the reading had
    wound down from running pace; one noisy reading restarted the count,
    and fixes without a reading were ignored. The stored route (read with
    the owner's OK) shows the light: 27 seconds with the fixes moving about
    0.1 m/s, and no pause. `RunAutoPause` now looks at the fixes of the last
    3 seconds (at least three over 2 seconds or more): it pauses when their
    median speed reading is under 0.8 m/s and their positions moved under
    1.4 m/s, or, with fewer than three readings, when the positions moved
    under 0.8 m/s, and never while the latest reading is over 1.4 m/s.
    Replayed on that route by position alone, it pauses a second after the
    light's stop and resumes two seconds after the start, with no pause
    while running. The pause is still timed at the fix that showed it, so
    the clock matches the Health workout, whose session can't be paused in
    the past. A resume needs every fix over 1.4 m/s for 2 seconds, by its
    reading or else by its distance from the fix before. TestFlight 1.2
    (79), uploaded 2026-11-11 after a full release
    check, carries it. Next: the owner's next run with stops on build 79.
  - Auto-pause, told walking from standing by the phone's motion, after the
    owner's intervals on 2026-11-12 (TestFlight 1.2 build 81 or earlier, read
    from the diagnostics lookups): the two real stops paused about two
    seconds after GPS read zero, but the run paused twice mid-walk, on a
    walked recovery and on the cool-down, with speed readings of 0.4 to
    0.7 m/s, and the owner resumed both by hand. He paused once by hand on a
    gradual slowdown. He asked whether the phone's motion sensors could tell
    a real stop. GPS alone can't: a very slow walk and standing read alike.
    `AccelerometerRunMotion` (`RunMotion.swift`) sums CoreMotion's user
    acceleration (gravity removed, no permission needed, keeps running with
    the phone locked during the workout session) into one RMS level a
    second, and `RunAutoPause` reads the levels from the two seconds before
    each fix:
    - every level at or over 0.12 g (steps): the run never pauses, and
      while auto-paused one fix over 1.4 m/s resumes it;
    - every level at or under 0.05 g (still): the run pauses once the fixes
      of the last 2 seconds (at least two, a second apart) read under
      0.8 m/s, and GPS alone never resumes it;
    - otherwise, or with fewer than two levels (no accelerometer): the
      GPS-only rules above, with the pause line lowered to 0.4 m/s, under
      every walking reading on that run. Replayed on that run, the GPS-only
      rule pauses neither walk and pauses the real stops up to four seconds
      later; the still rule is meant to win that back.
    Each fix keeps the motion level with its speed, and the diagnostics send
    it as `speeds.motion_mg` (thousandths of g, null without a reading),
    which an older Worker ignores while keeping the run, so the API goes out
    before a TestFlight build that sends it. The two levels are first
    guesses from typical phone accelerometer readings; the owner's next run
    with stops and walks, read from the diagnostics, sets them.
  - Auto-pause, quicker once the phone is still, after the owner's Easy Run
    + Strides on 2026-11-17 (TestFlight 1.2 build 83, read from the
    diagnostics lookups): he felt the pause take about 5 seconds at each
    stop, while the resume was quick. Both stops paused four seconds after
    the phone first read still. The still line of 0.05 g missed most
    standing seconds (standing read 0.03 to 0.17 g, mostly under 0.1, more
    while he handled the phone), so the GPS-only rule decided, and the
    speed reading took three to four seconds to wind down from running pace
    or went missing. The run gave the first real levels: walking a
    recovery with the phone in hand read 0.18 to 0.3 g, a freer walk about
    0.5 g, running 1.5 to 3.5 g, and the steps rule kept that walk from
    pausing. Now:
    - still is every level at or under 0.1 g, steps every level at or over
      0.15 g;
    - once still, the run pauses at the first fix whose speed reading is
      missing or under 0.8 m/s, unless the fixes of the last two seconds
      moved 1.4 m/s or more. The earlier still rule waited for two speed
      readings under 0.8 m/s, which lag the stop.
    Replayed on that run's fixes, both stops pause three seconds sooner, at
    the first still second, about a second and a half after the runner
    stood still; nothing else pauses and the resumes don't change. Next:
    the owner's next run with stops on a build that carries it.

- [ ] **P5 — Keep recorded runs in Tres Fort**
  - The owner decided on 2026-11-02 that the recorder saves runs straight to
    Tres Fort, GPS route included, so the app and web can show maps. This
    reverses the earlier rule that Tres Fort keeps no GPS streams and leaves
    recorded runs to intervals.icu
    (MULTISPORT.md §11 records the exception).
    intervals.icu becomes an optional copy.
  - [x] **(a) Keep the run and its route** (PR #322)
    - `POST /api/activities/recordings` reads the recorder's TCX
      (`src/tcxFile.ts`) and keeps the run as an `external_activities` row
      with `source='recording'`, id `recording:activity:<user>:<recording
      id>`. Moving time, distance, elapsed time, average and maximum heart
      rate come from the file. Heart rate on moving time gives the same
      stream summary a.fit import keeps, so the run's load is scored from
      the member's thresholds.
    - The GPS route goes to `activity_routes` (migration 0063), one row per
      recording, in `src/activityRoute.ts`'s encoding: delta-coded
      milliseconds, micro-degrees and decimeter altitudes, one segment per
      track between pauses. Every fix is kept up to 12 hours at one a
      second; a longer route keeps each segment's ends and an even share of
      the points between them.
    - Then the file goes to intervals.icu as before when the member has a
      connection. Without one the answer is 201 with
      `intervals.status = "not_connected"`. A provider failure keeps its
      error status and adds `stored: true`, so the app keeps the file and
      retries only the intervals.icu copy; the retry finds the run already
      kept. A recording the member deleted is never kept or sent again.
    - Dedup: an intervals.icu copy of the run wins over the recording, as
      it does over a.fit import, and the recording wins over Apple
      Health's copy. `GET /api/activities/:id/route` serves the route for
      the recording or for the activity it is hidden behind, only to its
      member. `DELETE /api/activities/recordings/:id` deletes the run with
      every copy the app made (P5(d)).
    - Routes are private: group views and the coach never read them. The
      account export includes them and account deletion removes them. The
      privacy policy says the app records location during a run, writes the
      workout to Apple Health and keeps the route in Tres Fort.
    - The recorder says where the run went: "Saved in Tres Fort and sent to
      intervals.icu.", "Saved in Tres Fort with its route." without a
      connection, or that only the intervals.icu copy retries later.
  - [x] **(b) Show the route in the app** (PR #323)
    - A run's card in the day view, and a planned run's record, show its
      route on a map when the run was recorded in the app, either as the
      recording itself or as the intervals.icu copy it was matched to.
      Each segment between pauses is its own line, framed to fit. Tapping
      the map opens it full screen to move and zoom.
    - The app reads `GET /api/activities/:id/route` only for runs from the
      recorder or intervals.icu, once per route and account in memory; "no
      route" is remembered for ten minutes, and a failed read is retried.
  - [x] **(c) Show the route on the web**
    - The owner chose Apple Maps on 2026-11-02, as in the app. The web day
      panel shows a recorded run's route under the run, each segment its
      own line in the accent color, framed to fit, for the same activities
      as the app.
    - The page loads MapKit JS 6 (map and overlay libraries only) when a day
      with a route is opened, with the site's domain-restricted MapKit JS
      token from the gateway's `/maps/token` (pages of this site whose
      session the API accepts; the `MAPKIT_TOKEN` secret of
      `tres-fort-web`). Without a token
      it asks Apple for nothing; then, or when MapKit fails to load or
      refuses the token, it draws the route's shape without a map.
  - [x] **(d) Delete a recorded run in the app**
    - The owner chose on 2026-11-02 that deleting removes every copy the
      app made: the run and its route in Tres Fort, its intervals.icu
      upload and the Apple Health workout the recorder saved.
    - A run recorded in the app shows "Delete run" on its card in the day
      view and on a planned run's record, for the recording itself or the
      intervals.icu copy it was matched to (known from the route answer's
      `recording_id`, which `GET /api/activities/:id/route` gives with
      `route: null` for a run recorded without GPS). It asks first; the answer says where the run was
      deleted from, or why nothing was.
    - The app finds the recorder's Health workouts by their
      `tresfort:recording:<id>` external UUID (deleting nothing when Health
      can't be searched) and names them in
      `DELETE /api/activities/recordings/:id?health_workout_id=`. The
      server deletes the intervals.icu upload first (external_id
      `tresfort:recording:<id>`, from the activity cache or a day either
      side of the run on intervals.icu). When intervals.icu can't delete it
      the answer is its error with `deleted: false` (502, 409 for a missing
      write scope, 422) and nothing changes. Then one batch tombstones the
      recording, deletes its route, and tombstones the cached intervals.icu
      copy and the named Health copies of this run (matched to the run, or
      starting within two minutes of it), so dedup never brings them back.
      A named workout Apple Health hasn't synced yet gets a tombstone too,
      and a Health push never revives a workout the member deleted, so a
      late or revised push doesn't bring the run back. A Health copy the app
      doesn't name, such as another app's, comes back as the run, the way
      deleting a.fit import brings one back.
    - The app deletes the Health workouts, with the route and strap heart
      rate it saved, only after the server succeeded, or when the server
      says the run is already deleted (a retry after a lost answer). A
      workout whose route or heart rate Health won't delete is kept, so
      trying again finds it. When Health keeps one, the answer says so. A run with no connection or
      never uploaded answers `intervals.status` `not_connected` or
      `not_found`.
  - [ ] **(e) Keep how the recording went**
    - On 2026-11-11, after diagnosing the owner's auto-pause report took
      several production queries, the owner chose to keep, with each
      recorded run, what the recorder saw: every pause with whether the
      member tapped Pause or auto-pause started it, whether "Pause when I
      stop" was on, and each GPS fix's speed reading and horizontal
      accuracy, running or paused (what `RunAutoPause` decides from), and
      since 2026-11-13 the phone's motion level (P4). The
      phone deleted all of this after the upload, so a tapped pause looked
      the same as an automatic one.
    - The app sends it as the optional multipart `diagnostics` field of
      `POST /api/activities/recordings` (`RecordingDiagnostics.swift`; the
      shape, limits and validation are `src/recordingDiagnostics.ts`), and
      the Worker keeps it in `recording_diagnostics` (migration 0076). Like
      laps, the first copy kept stays and a retry from a build that didn't
      send it fills it in. They are best effort: malformed ones never block
      keeping the run, which is kept without them and answered with
      `diagnostics_ignored: true`, and the app sends at most a day of fixes. Deleting the run or
      the account removes it, and the account export includes it.
    - Private like the route: never in group views, coach tools or
      intervals.icu. Only the owner's diagnostics lookups read it, for the
      owner's own runs (docs/DIAGNOSTICS.md). The privacy policy says so.
    - Done once a run recorded on a TestFlight build with it shows its
      pauses, tapped and automatic, in the owner's diagnostics.

- [ ] **P6 — Maps for runs the app didn't record**
  - The owner chose on 2026-11-04 that runs from intervals.icu and from
    Apple Health get maps too, in the app and on the web, so Garmin runs,
    runs recorded before P5 and runs another app such as Strava saved to
    Health show their route like a recorded run.
  - [x] **(a) intervals.icu runs**
    - `GET /api/activities/:id/route` still answers with the run recorded in
      the app behind an activity first (`source: 'recording'`). For an
      intervals.icu activity with no recording behind it, it reads the
      activity's `time`, `latlng` and `altitude` streams from intervals.icu
      (`fetchActivityRouteStreams`; `data` is latitude and `data2`
      longitude) and answers `source: 'intervals'`, `recording_id: null`.
      `routeFromSamples` builds the segments: a missing position, the 0,0
      placeholder or a gap over a minute ends one.
    - The track is not stored: it stays with intervals.icu, so a run
      deleted there or a connection removed takes its map with it. No
      connection, no track (an indoor run, a manual entry) or a refusal
      answers 404; a timeout, 429 or 5xx answers 502, which the app and web
      read as "try again later". Only the member's own shown activities are
      read.
    - The app and web already asked for the routes of intervals.icu runs.
      They now take a route with no recording behind it, which offers no
      "Delete run". Builds before this one read that answer as a failed
      read and show no map.
    - The privacy policy says the app and web read a run's track from
      Intervals.icu to show its map, only to the member, without keeping it.
  - [x] **(b) Apple Health runs**
    - The app asks Apple Health for workout routes too (once, like any read
      type added later), and the Health permission text names run routes.
      After each sync it reads the route Health saved
      with each run of the last year that another app recorded, such as
      Strava; the recorder's own workouts are skipped, since their recording
      carries the route. Each Health route object, and each stretch between
      gaps over a minute, is its own line; fixes Health marks invalid are
      left out.
    - `PUT /api/activities/healthkit/:id/route` (the Health workout id) takes
      the route in `src/activityRoute.ts`'s encoding, re-encodes it (invalid
      points dropped, a very long route thinned) and keeps it in
      `activity_routes` for that Health run; a later send replaces it. 404
      until the run itself is stored or for a run the member deleted, 422
      for a workout that isn't a run.
    - The app remembers each run whose route was sent, or that still has
      none a day after it ended, saving after each run, so it reads each
      route once; a failed read or a run not stored yet is tried on a later
      sync. Disconnecting Apple
      Health forgets them, so reconnecting looks again (for example after
      route access was granted in the Health app).
    - `GET /api/activities/:id/route` serves the stored Health route (`source:
      'healthkit'`) after a recording and before reading intervals.icu, for
      the Health run or the intervals.icu copy it is hidden behind. The app
      and web now ask for Health runs' routes too.
    - Private like a recorded route: group views and the coach never read
      it; the account export includes it and account deletion removes it.
      The privacy policy says the app uploads the route of a run another app
      saved to Apple Health.

- [ ] **P7 — Run summary and heart rate recovery**
  - From the owner's tempo run on 2026-11-05: the "Run saved" screen showed
    heart rate as "–" the moment the run stopped, although the strap stayed
    connected and the saved run had its heart rate, and its pace tile showed
    the pace of the last 30 seconds before the stop, which means nothing
    after the run. The owner asked to keep heart rate live after the stop
    and to record how fast it falls.
  - Heart rate sources: a Bluetooth strap the app connects itself (live),
    and whatever Apple Health's workout builder collects on the iPhone. An
    Apple Watch never streams live to the iPhone recorder; heart rate after
    the stop on a Watch belongs to the Watch recorder
    ([apple-watch](../apple-watch/plan.md) P2).
  - [x] **(a) The summary after the stop** (live since the 2026-11-06
    release, TestFlight build 66)
    - Time, distance and average pace stay frozen at the stop. The pace tile
      gives way to the run's average heart rate. The strap's reading shows
      live, marked LIVE, until Done, the strap drops or five minutes pass.
      Since (c) the tiles are average pace, load, climb and heart rate: live
      while the strap streams, then the run's average. Without a strap it
      comes from the run's own readings.
    - Readings after the stop never join the run, so moving time, distance,
      average and maximum heart rate, load and the Apple Health workout are
      the same as before.
  - [x] **(b) Heart rate recovery** (live since the 2026-11-06 release)
    - When the strap is connected and read the heart rate within 5 seconds
      of the stop, a "Cooling down" card counts two minutes and asks the
      member to stand or walk easy, so runs compare. The reading nearest one
      and two minutes after the stop (within 5 seconds) is kept; the screen
      stays on while it counts.
    - The run uploads once the cool-down ends: after two minutes, at Done,
      on closing the recorder or when the strap drops, with whatever was
      measured. A foreground upload doesn't send it early.
    - `POST /api/activities/recordings` takes optional
      `recovery_hr_at_stop`, `recovery_hr_after_60s` and
      `recovery_hr_after_120s` (whole bpm, 20 to 250; the later ones need
      the first) into `external_activities` (migration 0067), on the
      recording's row only. A retry fills them when the earlier attempt had
      none and never replaces them. `GET /api/activities/:id/route` returns
      them as `heart_rate_recovery` with the recording behind an activity,
      and the app's run card and planned-run record and the web day panel
      show "28 bpm in 1 min · 44 in 2 min".
    - Apple Health's Cardio Recovery (`heartRateRecoveryOneMinute`) is
      written by the Apple Watch only after workouts recorded in Apple's
      Workout app, so it never exists for a recorder run and isn't read.
  - [x] **(c) Training load on the summary** (live, build 67; the
    owner chose it for the summary on 2026-11-07)
    - The summary shows the run's load the moment it stops, scored on the
      iPhone the way the Worker scores a recording (`RunLoad`, mirroring
      `src/trainingLoad.ts`) on the heart rate the uploaded TCX carries
      (each track point's reading, as `parseTcx` reads it back): heart rate
      over moving time against the run threshold heart rate in effect on
      the run's date, then average pace against threshold pace, then
      average heart rate. The recorder reads
      `GET /api/me/thresholds` when it opens and keeps the rows on the
      iPhone, so a run recorded offline still shows its load. The tile
      names the method ("Load · HR", "pace" or "avg HR"). Without a run
      threshold the tile shows "–" and says where to add one. The Worker
      still scores the uploaded run itself, and an intervals.icu copy can
      later win with intervals.icu's own load.
  - [x] **(d) Climb from the barometer** (live, build 67)
    - The iPhone's barometer (`CMAltimeter` relative altitude, Motion &
      Fitness permission asked as the run starts) is read while the run
      records and kept in the checkpoint. A recovered run carries on from
      its last reading.
    - Climb counts a rise once it clears 3 m above the last low point, as
      the Worker counts a chart's elevation gain, per stretch between
      pauses, so a hill walked up while paused never counts. The summary
      shows it in feet with miles and meters with kilometers.
    - The uploaded TCX's altitude follows the barometer, set at the level
      GPS measured (the median difference), so intervals.icu, the map's
      elevation chart and the stored route lose GPS altitude noise.
      `POST /api/activities/recordings` takes an optional `elevation_gain_m`
      (0 to 10,000, tenths) into the recording's `elevation_gain_m`; a
      retry fills it when missing and never replaces it. The Apple Health
      workout carries it as its elevation gain.
    - The App Store build strips `NSMotionUsageDescription` with the other
      recorder keys.
  - [x] **(e) Name the heart rate's source** (live, build 67)
    - Apple Health's live workout feed also carries heart rate from
      headphones that measure it (AirPods Pro 3, Powerbeats Pro 2) or a
      watch; the owner saw it on 2026-11-07 with no strap on. A connected
      strap that read in the last 15 seconds wins, and Health's readings
      count only while it is quiet, so the two never mix in one run.
    - The running screens label the heart rate with its source while it
      is fresh: "HR · AirPods Pro" (the device Health names on its
      readings, else "Apple Health") or "HR · " and the strap's name.
  - [ ] **(f) Confirm on the device**
    - On a TestFlight build with the owner's strap: heart rate stays live
      after the stop, the cool-down keeps two readings, and the run's card
      shows them after the upload (build 66). With the next build: the
      load matches the run's load in Activity, the Motion & Fitness prompt
      appears once, the climb looks right on a hilly route, and AirPods
      heart rate shows its source and gives way to the strap.

- [ ] **P8 — Time left in the lap, where a runner looks**
  - From the owner's interval run on 2026-11-12: time left in the step, or
    to the next lap, was hard to see. The recorder showed it as one small
    line above the map, and the Lock Screen showed only the run's time,
    distance and pace. The owner asked for a bigger Lock Screen card with
    the step on it, the step more prominent in the app, and the map out of
    the way on a swipe, with pages to swipe through.
  - Two mock kit options: A, the step as the main page, or B, a pinned step
    card over pages. The owner picked A on 2026-11-13; the kit keeps it
    (`design/mock-kit/screens/run-*.html`).
  - `RunLapStatus` is the lap: a planned run's current step (its time or
    distance left, how far through, its target, the step after), or,
    without a plan or once it's done, the next whole mile or kilometer. It
    judges the step's target like the spoken cues (`RunTargetCoach.reading`).
  - The Lock Screen card (`RunActivityAttributes.Lap`) grows to about 150
    points: a planned step's time left leads, counting down on its own from
    the run's clock with a bar that fills itself, beside the pace (or heart
    rate for a heart-rate target) and an on-target check; then what's next
    and the run's time and distance. Without a step the run's time leads and
    the bar counts to the next mile. A step's end or a skip updates it at
    once. The Dynamic Island and the Watch Smart Stack show the step's time
    left too.
  - While recording, the recorder's pages swipe sideways or open by name: a
    planned run opens on Step (the time left as the biggest number, the
    pace or heart rate against the target, what's next, Skip, then time,
    distance and heart rate), then Numbers (the four large numbers), Map
    and Plan (every step, the done ones checked). A run without a plan has
    Numbers and Map and opens on the one last used. Every page but Step
    keeps the lap in a strip on top. The map follows the runner and doesn't
    pan, so a sideways drag turns the page; it pans again after the run.
    The screen stays on except on the map, as before.
  - Done once the owner has run a planned run with the phone locked and in
    hand on a TestFlight build with it.

- [ ] **P9 — Interval countdown and short step cues**
  - From the owner's Easy Run + Strides on 2026-11-17 (25 minutes at 135 to
    148 bpm, then 4 × 20 seconds with a minute's recovery): he wanted a
    short countdown of beeps for the last three seconds of an interval, and
    some steps were announced with what to do while others, like the
    strides, said nothing useful. A short step's cue should be quick, not
    half the interval.
  - Steps were announced as "Step 2 of 10. Rep 1 of 4. 20 seconds.": a
    work step without a target never said what to do, and the whole cue
    took about four seconds of a 20-second stride. Every step now opens
    with what to do (`RunPlanFormat.kindTitle`: Warm up, Run, Recover, Cool
    down): "Run 800 meters at 6 34 to 6 50 a mile. Rep 1 of 4.",
    "Warm up 10 minutes.". A step under a minute or 300 m hears only what
    to do and for how long, "Run 20 seconds.", about a second.
    "Step N of M" is gone; the Plan page lists the steps.
  - A step's announcement, and "Plan complete", cut off anything still
    being said (a split or a target cue), so it comes as the step starts
    instead of queuing behind it. Other cues still wait their turn.
  - A timed step of 10 seconds or more beeps once at 3, 2 and 1 seconds
    left, with the lift runner's timed-set tick, and the next step's
    announcement marks the end (`RunStepCountdown`). The plan ticker wakes
    just past each of those seconds and the step's end, not once a second,
    so the beeps and the announcement land on time. A late check beeps only
    for the second it's in, never a burst. Paused, the clock and the
    countdown stop. Distance steps get no beeps, since GPS decides when
    they end.
  - Beeps follow the announcements toggle and use the same audio session
    as the speech (`RunAnnouncementAudio`): music ducks for the countdown
    and stays ducked between beeps, held for 1.2 seconds after each, then
    the session is given back with the same retries as P2's fix, so music
    resumes.
  - iOS only, no server change. Not covered: a countdown for distance
    steps, a separate switch for beeps and speech.
  - Done once the owner has run intervals on a TestFlight build with it and
    heard the beeps and every step's cue, with music resuming after.

## Execution frontier

- P3
- P4
- P5
- P6
- P7
- P8
- P9

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P3 | gated_by | external:owner-run-recorder-device-verification | Real GPS runs on the owner's iPhone need an authorized device build. |
| P1 | coordinates_with | plan:app-store-submission | New location and Health write permissions change the App Privacy answers and review notes. |
| P5 | coordinates_with | plan:app-store-submission | Keeping GPS routes in Tres Fort adds precise location, linked to the member, to the App Privacy answers. |
| P7 | gated_by | external:owner-run-recorder-device-verification | Heart rate after the stop needs the owner's strap on a real run. |
| P7 | coordinates_with | plan:apple-watch | Heart rate after the stop on a Watch needs the Watch recorder's own session handling. |
| P8 | gated_by | external:owner-run-recorder-device-verification | The Lock Screen card and the pages need a planned run on the owner's iPhone. |
| P9 | gated_by | external:owner-run-recorder-device-verification | The beeps and short cues need intervals on the owner's iPhone with music playing. |
| P9 | coordinates_with | plan:planned-runs#P3 | P9 changes the spoken step cues planned-runs P3 introduced. |

Phases run in order: P1 needs P0's upload path, and P2's Live Activity
mirrors P1's session.

## Next step

**Now (@owner):** Record the remaining P3 runs, now on TestFlight build 65, which also carries P5 and P6. On 2026-11-04 the API, the
`tres-fort-web` app and the website were deployed with
the owner's go-ahead, together with the November security release
(migrations 0065 and 0066); the owner set `MAPKIT_TOKEN` the same day. P5 is
done once deleting a recorded run is seen on the device. P6 is done once
maps of an intervals.icu run and of a Strava run show on the device, after
allowing Health's workout-route access on build 65.

P7(a) and (b) are live since the 2026-11-06 release (migration 0067, API, TestFlight build 66). P7(c), (d) and (e) are live since the
2026-11-07 release with the owner's written go-ahead
(migration 0069, API, web, TestFlight build 67; the full release check passed on
that commit). (f) is a run on build 67 with the strap on a hilly route.

P4's motion-aware auto-pause is in the repository: release the API (for
the diagnostics' `motion_mg`), then a TestFlight build, then a run with
real stops and walked recoveries to tune the still and steps levels from
the owner's diagnostics.

P5(e) (recorder diagnostics, migration 0076) is in the repository; it
needs migration 0076 and the Worker released before a TestFlight build
that sends it, then one recorded run with a pause of each kind.

P8 (time left in the lap on the Lock Screen and the recorder's pages) is
in the repository, iOS only, with no server change; it reaches the phone
with the next TestFlight build, then needs one planned run.

From the owner's 2026-11-17 run on build 83: P4's quicker pause once the
phone is still and P9 (3-2-1 beeps, short step cues) are iOS only, with no
server change. They reach the phone with the next TestFlight build on the
owner's go-ahead; then one interval run with stops and music checks both.
App Store 1.2 waits for the recorder (the owner's choice, 2026-11-16).

P3 runs on the owner's iPhone. P1 and P2 are delivered in the repository;
their HealthKit, location, ActivityKit and speech calls
have only been compiled and run against fakes, so P3 is their first real
test, including the Lock Screen controls, splits heard with the phone
locked and a Bluetooth heart rate strap. Launch-time recovery runs
when the app next opens; handling the system's workout-recovery relaunch in
the scene delegate is left to P3's force-quit check.

## Notes / open questions

- First P3 run (build 58, 2026-10-30 evening, Pacific): the recorder upload
  reached intervals.icu as a run of 2.04 km in 8:32 moving, average heart
  rate 149 from the strap (max 162). A second, empty activity (no distance,
  zero moving time, heart rate 77) was uploaded from a start-and-end test.
  The Forerunner's copy never reached intervals.icu, and on 2026-10-31 the
  owner dropped the Garmin comparison altogether. The owner asked for auto-pause, a
  glanceable running display, and planned runs with pace or heart rate
  targets and spoken on/off-pace cues. P4 covers the first two; planned runs
  are [their own plan](../planned-runs/plan.md).
- First P3 feedback (build 57, 2026-10-30): finding the runner took too long
  because GPS and the location prompt only started on Start. The recorder now
  asks for location and starts foreground GPS when it opens, shows "Finding
  GPS…" or "GPS ready" (a fix within 20 m), and hands that GPS to the run;
  closing the screen without a run stops it.
- Second P3 feedback (2026-10-30): heart rate came only from whatever the
  Health workout session picked up, with no sign in the app of a strap or
  how to connect one. The recorder now connects a Bluetooth heart rate strap
  itself (the standard Heart Rate service, so Polar, Wahoo, Garmin HRM and
  similar). Its start screen shows the strap and live reading, or "No heart
  rate monitor" with Set up. The setup screen finds straps nearby, remembers
  the one picked on this iPhone and can forget it. The strap reconnects while
  the recorder is open or a run records, including after a drop. Its
  readings join the run's upload and are added to the Health workout when
  Health allows saving heart rate. Bluetooth permission is asked only on
  setup. The beta adds `NSBluetoothAlwaysUsageDescription` and the
  `bluetooth-central` background mode; the App Store build removes both. A
  watch that broadcasts heart rate only over ANT+ can't connect, because
  iPhone has no ANT+ radio.

- Nick chose on 2026-10-30 to bypass Strava for runs he records on his
  iPhone. Strava's API terms stop Strava-sourced activities from reaching Tres
  Fort through intervals.icu, and its social features aren't worth keeping to
  him. Garmin runs already reach intervals.icu directly and are unaffected.
- No machine learning is involved. Accuracy is set by the phone's GPS and
  Apple's sensor fusion, which Strava's iPhone app also relies on. Strava's
  extras (segments, social feed, heatmaps, elevation correction) are out of
  scope.
- Until P5, intervals.icu was the store of record for recorded runs and
  Tres Fort kept no GPS streams in D1. Since planned-runs P7 the connection
  was optional, with Apple Health keeping the route. P5 has Tres Fort keep
  the run and its route itself; intervals.icu stays the store of record for
  the activities it syncs.
- Heart rate on iPhone comes from a Bluetooth strap the app connects
  itself (from P3 feedback) or what Health provides during the session
  (supported headphones, for example). An Apple Watch recorder is the
  [apple-watch](../apple-watch/plan.md) plan.
- Recovering the Sep 4 to Oct 27, 2026 Strava runs is an owner task (Strava
  export uploaded to intervals.icu), not part of this plan.
- `delete_activity` deletes only `tresfort:activity:` activities, so it can't
  remove a recorded run's intervals.icu copy. Deleting a recorded run in the
  app (P5(d)) removes that copy too, since the owner chose that it removes
  every copy the app made.
- Merging any phase doesn't authorize a Worker deploy or an iOS distribution.
