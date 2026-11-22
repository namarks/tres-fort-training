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
- [ ] **P4 — The Watch app, Today and the complication**
  - A watchOS app target embedded in the iPhone app in `project.yml` only,
    built and unit tested on a Watch simulator in the PR's iOS job. The App
    Store project (`project-app-store.yml`) replaces the app's dependencies,
    so the Watch app stays out of App Store builds until the owner says it
    ships.
  - Today on the wrist: the day's list as the iPhone shows it, finished rows
    shrunk and the next item on navy with Start, a rest day with what is
    coming, and a watch face complication and Smart Stack widget for what is
    next. The iPhone sends the day it already resolved (the
    `TrainingAgenda` snapshot, extended with times and figures) over
    WatchConnectivity after each published change and clears it at every
    account boundary. The Watch never signs in, calls the Worker or decides
    what a day is, and says when its copy is from an earlier day.
  - Black background as watchOS expects, the hero navy for the day's key
    card and orange only for the next action and progress, from
    `BrandPalette`. The option mocks join the mock kit as Watch screens.
- [ ] **P5 — Lift from the wrist**
  - Start on a lifting workout opens it on the iPhone runner. The Watch then
    shows the set the runner is on, from the same `WorkoutDisplayState` a
    linked iPad shows: exercise, set number, load and reps, and last time.
  - Log set, a load or reps change with the crown, start and stop of a timed
    set, End rest and Finish go to the iPhone as the Station link's guarded
    commands (`StationLinkCommandRunner`), so the iPhone acts only while its
    runner still shows what the Watch showed and answers each tap with
    accepted or the reason it refused. Sets are logged by the iPhone through
    its own outbox; the Watch holds no workout state of its own.
  - The rest counts down on the wrist with a haptic at zero. With the iPhone
    out of reach, the Watch says so and logs nothing.
- [ ] **P6 — A lifting workout on a real Apple Watch**
  - P4 and P5 pass on paired iPhone and Watch simulators, and a member with
    an Apple Watch runs a lifting workout from the wrist on a TestFlight
    build: the complication, every set logged from the Watch, a changed
    load, a timed set, rests, and Finish.

## Execution frontier

- P4

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P1 | coordinates_with | plan:planned-runs | Reads the planned-run step format and marks the slot done through planned-runs P7's path. |
| P2 | coordinates_with | plan:run-recorder | Moves pure recorder logic into `ios/Shared` and saves Watch runs through the recorder's store and upload. |
| P4 | coordinates_with | plan:app-store-submission | The Watch app stays out of the App Store project until the owner says it ships; then the project file, privacy answers and review notes change. |
| P5 | coordinates_with | plan:ipad-workout-station | Reuses the Station link's display state and guarded commands over WatchConnectivity. |
| P1 | gated_by | external:apple-watch-device-verification | Runs on the wrist (P1 to P3) wait for a member who runs with an Apple Watch to test them on an authorized TestFlight build; GPS, wrist heart rate and haptics can't be trusted from the simulator. |

## Next step

**Now (@agent):** Build P4: the Watch app target, Today on the wrist and the
complication, checked on a Watch simulator in CI. Then P5, lifting from the
wrist. The owner chose "the whole day, lifting first" on 2026-11-22 from
three mocked options. Runs on the wrist (P1 to P3) stay gated on a member
who runs with an Apple Watch, and P2 starts only after the recorder's
device checks for version 1.2.

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
- Open for P5: whether the Watch also runs a strength workout session
  during lifting, which keeps the app in front on a wrist raise and records
  heart rate to Apple Health. It needs a Health permission on the Watch and
  a real Watch to check, so it is not in P5.
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
