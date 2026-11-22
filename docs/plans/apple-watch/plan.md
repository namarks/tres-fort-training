# Tres Fort on Apple Watch

Slug: apple-watch · Status: active · Updated: 2026-11-22 · Theme: connected-training

## Goal

A member with an Apple Watch sees their day on the wrist and trains from it.
A Tres Fort Watch app shows today's list as the iPhone does, with a watch
face complication for what is next. During a lifting workout it shows the
set the iPhone runner is on, logs it with one tap, changes the load or reps
with the crown, and counts the rest down with a tap on the wrist. The iPhone
keeps the workout and stays in a pocket or bag.

The member can also follow and record a run from the wrist. The
rest timer and the run recorder's stats show on the Watch laid out for it. A
planned run can be sent to Apple's Workout app with its steps and pace or
heart rate alerts, and the finished run comes back to Tres Fort with its
route and marks the planned run done. A Tres Fort Watch app then records the
run itself, with GPS, wrist heart rate and the planned steps as haptic and
spoken cues, while the iPhone shows the same run live. Every part works
without AI, and the run reaches Tres Fort through the same paths as a run
recorded on the iPhone.

## Phases

- [x] **P0 — Rest timer and run stats laid out for the Watch**
  - The rest timer and run recorder Live Activities already appeared in the
    Watch's Smart Stack (watchOS 11 with iOS 18 and later), shrunk from the
    Dynamic Island's compact views. Both now declare the small supplemental
    family on iOS 18 and later (`TresFortWidgets/WatchActivityLayout.swift`)
    and draw a wrist layout for it: the rest or timed-set countdown, what's
    next and End rest (Stop & log for a timed set), and the run's time,
    distance and pace with Pause, or Resume and Finish while paused.
    Buttons run the existing intents on the iPhone.
  - No Watch app, no new permission, no server change. iOS 17, the Lock
    Screen and the Dynamic Island are unchanged.
- [ ] **P1 — Planned runs in Apple's Workout app**
  - A planned run's details offer "Send to Apple Watch" when a Watch is
    paired. The app turns the slot's `run_steps` into a WorkoutKit custom
    workout: warm-up and cool-down steps, work and recovery steps, repeat
    groups as interval blocks with their count, each step's duration or
    distance as its goal, and its pace range or heart rate range as an
    alert. It schedules the workout for the slot's date through
    `WorkoutScheduler`, after the member allows it. Steps the format can
    hold but WorkoutKit can't are reported before sending, never dropped
    silently.
  - When the member finishes that run in the Workout app, Apple Health holds
    it. The app matches it to the sent plan (by the workout plan's id where
    Health records it, else the slot's date and an outdoor run started after
    sending) and turns it into a recorded run: route, heart rate, moving time
    and distance from Health. It then saves it through the recorder's
    existing path (`RunRecordingStore`, the recordings upload with its route,
    and `SyncModel.logRecordedRun`), so the planned run is marked done and the
    record shows it against the plan. The Health import's copy of the same
    workout yields to the recording, as dedup already ranks recordings above
    Apple Health.
  - Unplanned Workout-app runs keep arriving through the existing Apple
    Health import, unchanged.
- [ ] **P2 — Record runs with the Tres Fort Watch app**
  - [ ] **(a) Recorder logic shared with the Watch app**
    - The Watch app and its build come from P4. Pure recorder logic
      (`RunPlan`, `RunPlanProgress`, `RunTargetCoach`, `RecordedRun`,
      `RecordedRunTCX`) moves to `ios/Shared` and compiles into both apps,
      once the recorder's device checks for version 1.2 are done.
    - The start screen shows today's planned run, sent from the iPhone over
      WatchConnectivity with its steps and unit preference, or Start an
      unplanned run. The Watch never signs in or calls the Worker.
  - [ ] **(b) Record on the Watch**
    - The Watch runs the `HKWorkoutSession` with GPS and wrist heart rate,
      shows time, distance, pace and heart rate, and pauses and resumes
      (including auto-pause, as on the iPhone). It mirrors the session to the
      iPhone, which shows the run in its recorder screen and Live Activity
      and can pause or end it.
    - A run interrupted by a Watch restart resumes through workout recovery,
      as the iPhone recorder does.
    - Heart rate after the stop (plan:run-recorder P7): the wrist sensor
      streams only during a workout session, so End stops the activity
      (`stopActivity`, session state `stopped`) and ends the builder's
      collection at the stop, while the session stays open for the two-minute
      cool-down and the live summary. The session ends at Done, after five
      minutes or when the run is saved, so the extra minutes never change
      duration, distance or load. The readings at one and two minutes go
      with the run exactly as a strap's do. Apple's own Cardio Recovery
      (`heartRateRecoveryOneMinute`) is written only for workouts recorded
      in Apple's Workout app, so it is never a source for these runs.
  - [ ] **(c) Planned steps on the wrist**
    - The current step, what's left of it and the target show on the Watch.
      Each new step and each off-target or back-on-target moment gets a
      haptic, with the same margins and 30-second spacing as the iPhone's
      spoken cues, which also play through the Watch speaker or connected
      headphones when the member turns them on.
  - [ ] **(d) Save the run through the iPhone**
    - The finished run (route, heart rate, pauses, moving time and distance)
      goes to the iPhone as a file transfer and is saved exactly as an
      iPhone recording: Apple Health already holds the Watch's workout, Tres
      Fort keeps the run and its route, intervals.icu gets a copy when
      connected, and a planned slot is marked done. A run stays on the Watch
      until the iPhone confirms it has it.
- [ ] **P3 — Real runs on an Apple Watch**
  - A member who runs with an Apple Watch records runs on a TestFlight build:
    the wrist layouts (P0), a planned run through the Workout app (P1), and
    planned and unplanned runs with the Watch app (P2), including a pause,
    a recovered session and a run saved while the iPhone was out of range.
- [x] **P4 — The Watch app, Today and the complication**
  - [x] **(a) The Watch app and Today on the wrist**
    - A watchOS app target (`ios/TresFortWatch`) in its own project spec,
      `ios/project-watch.yml`, which includes `project.yml` and embeds the
      Watch app in the iPhone app. The TestFlight spec (`project.yml`) and
      the App Store spec (`project-app-store.yml`) don't define it, so
      neither build carries the Watch app until the owner says so.
    - Today on the wrist: the day's list as the iPhone shows it, finished
      rows shrunk and the next item on navy, a rest day with what is coming.
      The iPhone builds the day from Today's own rows and words
      (`WatchDayBuilder`, `TodayDayList`) and sends it as WatchConnectivity's
      application context after each published change, through the same
      publisher as the Today widget, which also clears it at every account
      boundary (`TrainingAgendaPublisher`, `WatchDaySender`). The Watch
      never signs in, calls the Worker or decides what a day is. On a later
      day it shows the coarse entry the iPhone resolved for that date and
      says so; past that it asks for the iPhone (`WatchDayPresentation`).
    - The App Store build never starts the Watch session
      (`WatchDayLink`). The shared day, what the Watch shows for it and when
      the iPhone sends it are unit tested in the iOS tests; the Watch target
      itself is built and run on a Watch simulator on a Mac, with fictional
      days (`-watch-day-fixture`), until (c).
    - Black background as watchOS expects, the hero navy for the day's key
      card and orange only for what is next, from `BrandPalette`'s dark
      values. The option mocks are in the mock kit
      (`design/mock-kit/watch.mjs`). The next item's Start arrives with P5.
  - [x] **(b) The complication**
    - A watch face complication and Smart Stack widget for what is next
      today (`ios/TresFortWatchWidgets`, in `project-watch.yml` only): the
      row that leads with its time, "Done today" and the next workout once
      everything is finished, or the rest day and what is coming
      (`WatchComplication`). A tap opens the app.
    - It reads the Watch's own copy of the day, kept in the Watch's App
      Group, turns over at each midnight the copy covers and then asks for
      the iPhone (`WatchDayTimeline`). The Watch app reloads it when the
      iPhone sends a changed day, also when the system wakes the app in the
      background for it.
    - Simulator evidence is the app's debug gallery of the complication's
      sizes (`-watch-complication-gallery`): a watch face can't be set up
      from the command line. How a face tints it and the background wake
      are checked on a real Watch in P6.
  - [x] **(c) The Watch app built in CI**
    - The PR's iOS job, after its unit tests, builds the Watch app and its
      complication unsigned for a Watch simulator from `project-watch.yml`
      (`npm run ios:verify-watch`, `scripts/verify-watch.sh`) and fails if
      the Watch app doesn't contain the complication. The workflow's
      contract tests pin the step. GitHub's hosted runner built the Watch
      app with its complication on 2026-11-22, on the pull request and
      again on `main` after the merge.
- [ ] **P5 — Lift from the wrist**
  - [ ] **(a) The set on the wrist**
    - While a lifting workout is open on the iPhone, the Watch app opens on
      the set the runner is on, with Today a swipe away: the exercise, the
      set number, the load and reps, and one button for what to do next
      (Log set, Start and Stop & log for a timed set, End rest), with the
      rest counting down above the set it leads to. Tap the load, the reps
      or the time and turn the crown to change it, by the runner's own
      small step; the change stays on the Watch and travels with the tap.
      The page has about 150 points under the clock on every Watch size, so
      nothing sits under the button: the effort sits beside the set's place
      or the rest's countdown, and what stops the button (the iPhone out of
      reach, a load not chosen) is said in the button's place.
    - The iPhone words its runner's `WorkoutDisplayState`, the one a linked
      iPad shows, for the wrist (`WatchWorkoutBuilder`,
      `ios/Shared/WatchWorkout.swift`) and sends it in the application
      context beside the day (`WatchWorkoutPublisher`, `WatchDaySender`). It
      is withdrawn when the workout closes and at every account boundary,
      and the Watch shows it on the workout's own day only. A tap goes to
      the iPhone as a message naming exactly what the Watch showed: the set
      with its values, in that run of the workout, so a tap for a workout
      since discarded is refused. `WatchWorkoutCommandRunner` applies it through the
      Station link's guarded commands (`StationLinkCommandRunner`), so the
      iPhone acts only while its runner still shows that, logs the set
      through its own outbox, and answers with accepted or the reason, and
      with what its runner shows now. The Watch holds no workout state of
      its own and stores none.
    - A rest ends on the Watch's own clock, because the iPhone may be
      asleep in a pocket: the set is then offered, and its Log first ends
      the iPhone's rest. While the app is in front, a haptic marks the end
      of a rest or a timed set; otherwise the iPhone's own notification for
      that moment reaches the wrist. With the iPhone out of reach the Watch
      says so and logs nothing, and a refused tap says why.
    - Choosing another exercise, review and Finish stay on the iPhone, and
      the Watch says so at those points: the Station link has no Finish
      command. A partner workout doesn't show on the wrist. The runner's
      display holds no "last time", so the wrist doesn't show one.
    - The wording, the crown's steps, how the workout travels and every tap
      against the iPhone's real runner are unit tested in the iOS tests. A
      fictional workout that answers its own taps
      (`-watch-workout-fixture`) is the simulator evidence.
  - [ ] **(b) Start from the wrist**
    - Start on the row that leads on the wrist's Today starts or resumes
      that lifting workout on the iPhone's runner, through the same guarded
      steps as Today's own button. A run still starts on the iPhone until
      P2.
    - The iPhone says on the day's leading row whether the wrist can start
      it and what the button reads, "Start" or "Continue"
      (`WatchDayRow.start`, from `SyncModel.watchStart`, which follows
      the rules of Today's own row button). A run, an activity, a partner
      workout and a workout that can't start now carry none, and neither
      does any row while a workout is open. The tap carries the row's
      token, which names the day, the row, the workout it holds and that
      session's attempt. `WatchWorkoutCommandRunner.start` finds the row
      that still matches in today's list and takes the steps Today's button
      takes: the day's own workout starts or continues, a workout already
      on the list opens, and one planned beside the day's own starts as a
      new session. The answer brings the first set, so the Watch turns to
      it. A Start for yesterday's list, for a row that has gone or for one
      since given another workout is refused with the reason, and a second Start for a runner already open
      only shows it.
    - Starting from the wrist never asks for notification permission, since
      the iPhone may be locked in a pocket: the rest's notification reaches
      the wrist only where the member already allowed it on the iPhone.
    - Unit tested against the iPhone's real runner. In the simulator the
      fictional day's Start opens the fictional workout.
- [ ] **P6 — A lifting workout on a real Apple Watch**
  - P4 and P5 pass on paired iPhone and Watch simulators, and a member with
    an Apple Watch runs a lifting workout from the wrist on a TestFlight
    build: the complication, every set logged from the Watch, a load
    changed with the crown, a timed set, rests, and Finish on the iPhone.
    The iPhone stays locked in a pocket for it, so the check covers a tap
    that wakes the iPhone app in the background, and the rest's
    notification on the wrist.

## Execution frontier

- P5

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P1 | coordinates_with | plan:planned-runs | Reads the planned-run step format and marks the slot done through planned-runs P7's path. |
| P2 | coordinates_with | plan:run-recorder | Moves pure recorder logic into `ios/Shared` and saves Watch runs through the recorder's store and upload. |
| P4 | coordinates_with | plan:app-store-submission | The Watch app stays out of the TestFlight and App Store projects until the owner says it ships; then the project files, privacy answers and review notes change. |
| P5 | coordinates_with | plan:ipad-workout-station | Reuses the Station link's display state and guarded commands over WatchConnectivity. |
| P1 | gated_by | external:apple-watch-device-verification | Runs on the wrist (P1 to P3) wait for a member who runs with an Apple Watch to test them on an authorized TestFlight build; GPS, wrist heart rate and haptics can't be trusted from the simulator. |

## Next step

**Now (@agent):** P5(b), Start from the wrist, after P5(a) is reviewed. P4
is in the repository: the Watch app with Today, the complication, and its
build in the pull request job. P5(a), the set on the wrist, was built on a
Mac on 2026-11-22 and ran on a Watch simulator with the fictional workout;
its taps are tested against the iPhone's real runner in the iOS tests. No
real Watch has run any of it: that is P6. The owner chose "the whole day,
lifting first" on 2026-11-22 from three mocked options. Runs on the wrist
(P1 to P3) stay gated on a member who runs with an Apple Watch, and P2
starts only after the recorder's device checks for version 1.2.

## Notes / open questions

- The owner asked on 2026-11-03 whether Tres Fort could have an Apple Watch
  app, chose "Full Watch app, runs first" from a phased proposal, and
  paused after P0 with no Apple Watch to test on. On 2026-11-22 the owner
  asked for the Watch app to be designed and built, and chose the whole
  day with lifting first over lifting only and runs only: lifting can be
  checked on paired simulators, and it is the part Apple's Workout app
  can't do.
- Apple's Workout app has no sets or reps, so lifting on the wrist needs the
  Watch app; it drives the iPhone runner the way the iPad Station link
  does. A Watch that trains with no iPhone nearby (its own sign-in, outbox
  and offline rules) is not planned.
- The owner has no Apple Watch. P6 and P3 need a member who has one; until
  then the simulator is the evidence, and the plan says so.
- A TestFlight build with the Watch app needs `scripts/upload-testflight.sh`
  to take `project-watch.yml`, and signing for two new identifiers, the
  Watch app and its complication, each with the App Group. That is the
  owner's call and is not part of P4.
- Open for P6: whether the Watch also runs a strength workout session
  during lifting, which keeps the app in front on a wrist raise and records
  heart rate to Apple Health. It needs a Health permission on the Watch and
  a real Watch to check, so it is not in P5.
- Open for P6: a tap from the Watch wakes the iPhone app in the background,
  and the simulator can't show how that behaves with the iPhone locked. The
  iPhone starts its Watch session at launch so a tap is always answered,
  and it answers "open the workout on your iPhone" when no signed-in runner
  is in memory. Whether the rest's Live Activity can start from that
  background wake is part of the same check; the rest itself and its
  notification don't depend on it.
- P1 and P2 overlap for planned runs. P1 is quick and uses Apple's own
  recorder; P2 keeps the whole run in Tres Fort with its own cues. Both stay,
  since P1 also serves members who prefer the Workout app.
- WorkoutKit custom workouts and scheduling need iOS 17, which the app
  already requires. Whether Health records the workout plan's id on the
  finished workout is checked in P1; the date-and-type match is the
  fallback.
- No migration or Worker change is expected; P1 and P2 use the existing
  recordings endpoint and the Apple Health import.
- App Store 1.0 stays on build 55. Merging any phase doesn't authorize a
  TestFlight build or an App Store submission.
