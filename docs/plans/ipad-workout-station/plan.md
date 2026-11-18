# iPad Workout Station

Slug: ipad-workout-station · Status: gated · Updated: 2026-11-18 · Theme: gym-floor

## Goal

Let a member read their workout from across the room on a stationary iPad,
either running the workout on the iPad or following their iPhone. Movement
tracking builds on that display: establish camera placement and counting
quality in observation-only trials before validated later slices turn
detections into durable workout actions.

## Phases

- [ ] **P0 — Deliver the observation-only Station Mode comparison**
  - Enable native iPad support and a responsive landscape/portrait display.
  - Enter from Today on iPad; request camera access only on explicit action.
  - Process the front camera locally with MediaPipe Full and an experimental
    angle-cycle counter for squat, curl and bench press. Live capture remains
    transient unless the member explicitly starts a bounded local test recording.
  - Show the MediaPipe live count without an Apple temporal-window warm-up.
    Retain Apple Vision in saved-video comparison on identical frames.
  - Bound queued work, fence late results by trial and account session, and make
    incomplete coverage or inference failure visible.
  - Count curls independently for body-left and body-right arms in live mode
    and saved replay. Save actual counts per arm; never double bilateral reps
    into one displayed total or assign an old unspecified label to an arm.
  - Keep trials isolated from SyncModel writes, outboxes, rest and progression.
  - Audit every catalog ID into a reusable rep/hold candidate profile or an
    explicit manual fallback. Selecting a workout/catalog exercise resolves its
    profile; only explicitly implemented experiments can start tracking.
  - Add observation-only forearm-plank and wall-sit countdown experiments:
    stable pose acquisition, observed-time accumulation, pause/reacquisition,
    terminal interruption and no automatic set completion. See the
    catalog audit and hold contract.
  - Reset movement history after missing joints or a pose gap. For curls only,
    allow one low-confidence observation between reliable measurements no more
    than 0.15 seconds apart; discard its angle and restart endpoint dwell.
    Sustained loss still resets the cycle. Always mark coverage incomplete;
    reacquire a stable view and keep the whole trial visibly partial. Additional
    people, camera interruption, rotation, backgrounding and view exit require
    an explicit restart. Never infer completion from target reps or lost tracking.
  - Add explicit silent local test recording (five-second countdown, at most
    45 seconds, no automatic upload/backup), aligned per-frame measurements,
    count labels, selected sharing and deletion. Replay the same decoded frames
    through Apple Vision and MediaPipe Full with synchronized frame inspection.
  - Verify deterministic counting/loss scenarios, iPad navigation/layout and
    iPhone regressions; complete exact-head review and repository checks.
- [ ] **P1 — Compare existing counters and validate the mounted iPad**
  - Evaluate broader reuse through PoseFit's exercise rules and a TransRAC
    counting benchmark before expanding custom detectors. The
    source survey
    records model availability, mobile adaptation and FLAG3D's research-only
    terms, plus native SDK comparators. Keep the mapping independent of the
    selected engine; no external SDK or dataset is imported by this slice.
  - Treat the custom angle counter as a baseline, not the selected production
    algorithm. Compare it with Apple HumanBodyActionCounter in the first
    device build. Compare Apple Vision with MediaPipe Full on identical saved
    frames. The first owner clip supports MediaPipe as the next live prototype
    default; broader accuracy remains unproven. Score detection separately from
    repetition logic and measure live performance separately from offline replay.
  - On an authorized device build, compare counts to manual ground truth for
    all three modes, including slow/paused/partial reps and obstructed views.
  - Evaluate landscape camera placement, screen readability, tracking recovery,
    a workout-length thermal/power trial and continued use of the main phone.
  - Treat front-facing squats as a primary wall-mounted use case. Evaluate
    calibrated hip movement and inferred 3D knee angles using live evidence;
    the current side-view 2D angle counter cannot establish frontal coverage.
  - Evaluate an exercise-agnostic counter as the path to broad coverage instead
    of one angle rule per exercise. The planned exercise supplies only a body
    region and per-side hint; no camera view is required. Saved replay runs it
    on MediaPipe 3D world landmarks beside the existing counters. See the
    [generic counter evidence](#generic-3d-counter).
  - Record count errors, corrections and setup/repositioning effort. Select the
    supported movements/angles from observed evidence, not assumed accuracy.
  - Validate each mapped variant before expanding experiment availability.
    For holds, measure false starts during setup/lying/rest, target timing,
    interrupted holds and reacquisition; joint geometry cannot prove contact,
    load-bearing or form quality.
- [ ] **P2 — Add assisted set completion and correction**
  - Define one authoritative workout controller, stale-event rejection and a
    stable event identity before observations can enter the existing set path.
  - Add confirmed set completion, rest and progression with easy correction;
    choose a hands-free confirmation mechanism based on the physical trial.
  - Repository slice (owner-requested 2026-10-04): the iPhone runner is the
    only controller. An opt-in (per signed-in member), encrypted local MultipeerConnectivity link pairs
    it with an iPad Station of the same account. Each device fetches a
    per-account link key once (`GET /api/me/station-link-key`, derived, not
    stored, and cached in the device Keychain); a mutual challenge-response
    proves both hold it before any message is trusted, because the discovery
    tag is public (owner chose this over code matching). Every later message is
    encrypted and authenticated with a key bound to that connection's nonces,
    with a direction and counter, so a relay cannot read, forge, replay or
    reflect one. One-side movements (per-side reps) stay manual, a rep on
    either curl arm keeps the set open, and arms that counted differently wait
    for a tap. The iPhone arms
    the current countable set once rest is over, and only while the workout is
    open rather than minimized;
    every distinct slot/set gets a fresh arm ID. The iPad counts that set and
    reports a finished count once it holds steady for four seconds outside a
    rep; target reps never end a set. The owner chose instant logging: the
    iPhone logs that count at once through the ordinary guarded LOG SET path
    for that exact slot and set, which starts rest and advances the runner.
    Undo stays available until the next count; it deletes the set through the
    correction path, ends rest and returns to the slot; the iPad counts that
    set again once the deletion is saved. Partial counts, other
    sets, duplicate events and unsupported movements never auto-log; a partial
    count offers Log, Edit (into the rep control) or Not right (re-count), and
    so does a count whose set could not be saved.
  - Remaining: verify the link, instant logging, Undo and fallback on the
    paired iPhone and iPad, and record miscounts and corrections from real sets.
- [ ] **P2.1 — Deliver the iPad workout display in both modes**
  - Use the existing dark Theme, amber actions, completion colors, Bebas Neue
    headings and JetBrains Mono values in one distance-readable presentation.
  - Support standalone iPad workouts through the existing SyncModel writer and
    guarded set, timer, edit, correction and outline actions.
  - Carry a camera-independent workout projection over the authenticated solo
    link: current prescription, set/round, next step, rest/timed deadline,
    paused state, final review and the workout outline. The iPhone remains the
    only writer. A linked iPad's controls (log a set, end rest, start or stop
    a hold, edit the next set, choose an exercise) are requests for the step,
    or between sets the exercise, that it shows; the iPhone applies each once
    through its own guarded runner action while it still shows that, or
    refuses it with a reason. Starting and finishing stay on the iPhone.
  - Clear guidance when the iPhone withdraws it or a drop outlasts two
    minutes; through a shorter drop keep the last display, marked as
    reconnecting, with its controls off. Keep an active foreground display
    awake without requiring camera access.
  - Verify iPad portrait/landscape and accessibility layouts, local
    logging/edit/rest progression, linked unsupported movements and connection
    loss, plus unchanged iPhone behavior and public-build camera exclusion.
  - Keep standalone camera logging, device takeover and broader automatic
    progression outside this display slice; P1/P2/P3 physical gates remain.
  - Implemented in PR #251: shared native Theme-backed
    presentation, draft-aware projection, compatible authenticated link updates,
    foreground screen-awake lifetime and separate fixed rest/log controls.
    Local state/link/lifetime checks and public iPad Station/linked-display
    journeys pass. Native portrait/landscape, accessibility, edited values,
    progression, repeated rest taps and iPhone regressions are verified.
    Review identified missing RPE; the projection and both target summaries
    now retain prescribed and edited effort. The focused projection/link run
    passes 45 tests, and native RPE edit/log, linked display and rest-tap
    journeys pass with screenshot verification.
    CI regression coverage now selects the complete display journey class
    in both iPad build variants. The Station camera journey respects the
    local-workout controller exclusion; first-workout creation observes
    exercise selection and enabled Review before navigation.
    Both repaired journeys and all display journeys pass on CI's iOS 26.2
    runtime: 20 focused native checks across iPhone, standard iPad and public
    iPad builds. CI selection/verification checks and plan compilation pass.
    PR #251 is merged; all 15 required CI jobs passed on its final head.
    Exact-head cloud review remained unavailable due usage limits; independent
    local review was advisory. The owner subsequently authorized internal
    build 51, now VALID and available
    to Testers with the new display and camera tracking. Physical acceptance
    remains open; TestFlight availability is not a device-trial result.
    The setup follow-up PR #253
    is merged and shipped in build 52:
    visible phone setup, iPad QR, remembered same-account connection and
    reconnect/workout-boundary protection. Exact-head cloud review is clean,
    all 15 CI jobs passed, and Apple confirms internal Testers availability.
    The owner's 2026-10-12 request for iPad controls, an outline and a clock
    is in PR #265; see
    [Next step](#next-step).
- [ ] **P3 — Enable measured automatic progression**
  - Establish explicit acceptance thresholds for premature completion, exact
    counts and required corrections; validate them before enabling auto-log.
  - Preserve manual recovery, device takeover and offline/reconnect integrity.

## Execution frontier

- P1
- P2
- P2.1

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P1 | gated_by | external:owner-ipad-station-device-build | Internal build 52 is verified available to Testers with the display, easier pairing and camera tracking; the owner must evaluate framing and counting on the actual iPad. |
| P2 | gated_by | external:owner-ipad-station-linked-device-trial | The owner requested iPhone-controlled assisted logging on 2026-10-04; the paired iPhone/iPad trial must show the link, instant logging with Undo and manual fallback work before P2 is complete. |
| P3 | gated_by | external:owner-ipad-station-automation-criteria | Automation needs explicit measured quality criteria and activation authority. |

## Next step

**Now (@owner):** The physical trial below, on TestFlight 1.2 (83) or later
on both the iPhone and the iPad. Every fix this plan describes is in that
build, including the iPad controls follow-up (original PR #265, merged
before the public snapshot of 2026-11-15; checked in public main on
2026-11-18). No implementation work is waiting for an agent.

**iPad controls (merged):** On 2026-10-12, after builds 53 and 54 shipped
the link fixes below, the owner reported that the connection is still flaky
and not intuitive: the iPad could not move the workout forward, and it
offered no workout outline or clock. Reading the code found further likely
causes, inferred rather than taken from device logs. The iPhone published
the iPad's display only while Today was on screen, so switching tabs
withdrew the workout from the iPad. A minimized workout showed as paused,
and the iPhone stayed awake only while the workout was in focus, so
auto-lock could close the connection during a rest. The iPad removed the
workout on any lost connection.

The follow-up lets a linked iPad move the iPhone's workout: log a set, end
rest, start and stop a hold, edit the next set and choose an exercise from the
outline. Each control names what the iPad showed (the step, or between sets
the exercise), and the iPhone acts on it only while it still shows that: once,
through the same guarded runner action as its own button. Otherwise it refuses
with a reason the iPad shows; the iPad waits for that answer before sending
another.
The iPhone remains the only writer. The display shows the workout outline
beside the set, with a switch back to Up next, and the time of day with the
workout's running time. The iPhone now publishes from every tab, pauses the
display only when the app leaves the foreground, and stays awake while a
workout runs with the iPad connected. Through a drop, including one only a
new connection reveals, the iPad keeps the last workout for up to two minutes,
marked as reconnecting, with its controls off.
Builds 53 and 54 keep working with it: they show the workout without the
outline or controls and are never sent a control. Unit tests cover the controls
over the fake link, on the iPhone runner and in the outline projection; iPad
journeys cover the controls, outline, clock and reconnecting with a synthetic
iPhone. Physical acceptance needs a build containing it.

**Link fixes (merged, in builds 53 and 54):** On
2026-10-11 the owner reported that pairing is still finicky and that, once
paired, the iPhone and iPad do not stay in sync. Reading the build 52 transport
found likely causes; they are inferred from code, not device logs. An iPad
that had accepted an invitation, or still listed a departed iPhone, refused
every new invitation for up to 20 seconds or until the old session timed out.
Neither side noticed a connection that died silently, so both kept showing it
as connected while nothing arrived. A sound message the receiver could not
read dropped the whole connection. The iPhone reconnected after returning to
the app only when Today was on screen, and the iPad never retried.

The correction merged in PR #259
gives every attempt its own session. A sealed heartbeat on quiet connections
drops a silent peer within eight seconds; a failed send drops it at once;
unreadable authenticated content is skipped. The iPhone invites the most
recently seen iPad and tries others before retrying one that failed. Both
devices reconnect when the app returns to the foreground, from any tab. The
iPad keeps counting the armed set through a lost connection. On a new
connection it reports where it is with that set, its live count, and a
finished count the old connection may have lost; the iPhone uses each count
once and withdraws a set it has already moved past. Build 52 peers stay
compatible: they read a heartbeat as a disarm of no set and are never dropped
for being quiet, though a build 52 iPhone does not withdraw a set it moved
past while disconnected.

The follow-up in PR #260
answers a second review of that change. In #259 any newcomer
that proved the key replaced the iPad's connection, so a second iPhone could
take over a connection in use, and two could keep taking it from each other.
Now a connection heard from within two heartbeats keeps the link. Once a
newcomer proves the key, it replaces a connection the same iPhone abandoned,
or one that stayed quiet throughout, so the display does not blank. After losing a connection the
iPhone looks again under a new identity, so its new session shares nothing
with one the iPad may still hold. It drops an invitation to an iPad that
stopped advertising, gives an attempt 20 seconds to prove the key, and lets an
attempt in progress finish when the app returns from a permission alert. A
reconnect also repeats why the iPad is not counting. Fake-session unit tests
cover reconnection, impostors, a second iPhone, silence, older peers, failed
sends, stuck or abandoned attempts, foreground recovery, and counts, states or
disarms lost with a dropped or replaced connection.
Both shipped in builds 53 and 54; physical acceptance of the link remains
open.

**QR correction (merged):** PR #255
answers the owner's report that the regular iPhone Camera shows no link for the
build 52 iPad code. The shipped rendering had only 3.45 white modules around the
symbol; the [QR standard requires at least four](https://www.qrcode.com/en/howto/code.html).
It embeds a white margin, enlarges the code at whole module sizes, exposes a
prominent manual setup route and checks decoding of the displayed code. It is
not in build 52; physical Camera acceptance needs a repeat trial with a later
build, and the larger diagnostic code's owner result is pending.

**Available build:** PR #253
is merged; TestFlight 1.0 (52)
uses the identical reviewed tree with all 15 source CI jobs passing. Apple
confirms VALID / IN_BETA_TESTING and internal Testers assignment. The direct
screenshot/crash-feedback queries at release returned no submissions; the
later owner QR report above is separate evidence. P1/P2/P2.1 physical
acceptance remains open.

The build adds a visible **iPad display** action on Today and the active iPhone
workout, a navigation-only setup QR on iPad, explicit phone confirmation and
remembered account-scoped choices. Pairing can happen before a workout. Opening
the code never grants access or starts/logs one. Reopening Station reuses only
the same account's opt-in; setup failures offer Retry and Local Network guidance.
Retries preserve pending counts, spent-event identity and Undo. Idle discovery
allows phone auto-lock; only a connected, open foreground workout holds it awake.
Ending a workout clears its armed set, count and Undo without dropping pairing.

Focused local verification covers real iOS URL handoff, explicit opt-in and
cancellation, account isolation, remembered choices, QR decoding, reconnect/Undo
integrity, workout-boundary reset, largest text and existing public Station
journeys. Synthetic screenshots match the shared Theme. These simulator results
do not establish physical pairing or camera accuracy.

Build 52 retains the experimental camera SDK omitted from public build 50.
No backend deployment or migration was needed or performed; backend source
remains identical to the release-49 source.
The catalog camera profiles, curl fix and linked
assisted logging are merged; physical trial results are not established by
their TestFlight upload. With the link on, an armed iPhone set
switches the iPad from a hold or catalog selection
to that set's rep counter; choosing any exercise by hand on the iPad abandons
the armed set, which stays manual on the iPhone.
The audit covers all 280 exercises: 193 rep candidates, 15 hold candidates and
72 manual fallbacks. Fifteen entries explicitly select a current experimental
mode; profile membership alone never enables a counter. Real accuracy remains
unvalidated. The retained device receipts below describe earlier installations.
**Next physical trial (@owner):** With build 83 or later installed on both devices,
use the same account and allow Local Network access. In iPad Station, tap
"Connect iPhone". Until the QR failure is resolved, open Très Fort on iPhone,
tap "iPad display" at the top of Today and confirm "Connect iPad" (in builds
with [app design pass](../app-design-pass/plan.md) P1 it is in Today's + menu
until the display is turned on, then an icon at the top). Fetch the
link key online once. Check that opening the phone app and iPad Station
reconnects after this first opt-in, including before and after a workout.
Repeat the QR route and the connection loss/recovery checks when a build
containing both corrections is available. With a build containing PR #265,
also move through a workout from the iPad's controls and outline, switch tabs
and lock the iPhone mid-rest, and note any time the iPad shows Reconnecting.
In "Camera & options", choose "Enable camera" to try supported counted sets
while keeping the iPhone workout open. Also check
standalone iPad manual logging/timers, across-room readability and linked
connection loss/recovery; standalone camera logging is not implemented. Note each counted versus
actual rep total, any set that logged wrongly, and whether Undo was quick
enough to fix a miscount mid-workout. No additional repetitions are needed to
reproduce the simultaneous-curl failure; actual arm totals in the latest clip
are awaiting owner clarification. Separate front-facing and side-view squat
clips remain useful for the counter. Sustained performance, other movements,
false positives and fully automatic logging remain unvalidated. No unattended
recording is requested.
**Generic counter (@owner):** The replay-only generic 3D counter merged in
PR #236; see [generic 3D counter](#generic-3d-counter). With a build that
contains it, rerun saved comparisons (including the mixed front/side squat
clip) and label actual reps; no new recording format or live change is needed.

## Generic 3D counter

- `StationGenericCounter` follows every 3D joint angle (knee, hip, elbow,
  shoulder) in the hinted region from MediaPipe world landmarks. When the first
  clear out-and-back cycle completes (at least 30 degrees, at least 0.55
  seconds), the largest cycle finished within 0.3 seconds becomes the set's
  signal. That first cycle fixes the reference amplitude, direction and resting
  angle; later cycles must reach 60 percent of it, and the reference never
  averages in later reps. The resting angle does not drift, so slow reps (up to
  12 seconds) are not absorbed. It reuses the 0.6 confidence cutoff, 0.5-second
  gap reset and one-person rule. Lost joints restart the cycle and keep earlier
  counts; counting resumes only back near the reference resting angle. Curls run one counter per arm and
  never sum them. Squat uses the lower-body hint; curl and bench use upper body.
- Saved replay records generic per-frame counts, the chosen signal, coverage
  and `genericCounterVersion` (`generic-3d-v1`) beside the existing counters.
  Older comparisons decode with the fields absent. The live screen is unchanged.
  A count is always saved with its signal, even when a clip ends while the
  signal choice is pending. Coverage is marked incomplete when the chosen
  signal's joints went missing while other joints stayed tracked, or, before
  any signal is chosen, when any candidate's joints did, so an obscured arm or
  joint is never shown as a reliable zero.
- Synthetic 3D unit tests rotate the same squats to front, diagonal, side and
  rear views and count five each, and cover noise, touch-and-go and slow reps,
  small, partial and shrinking movements, too-fast cycles, joint loss
  (including loss on the way down with a pause at the bottom), frame gaps,
  multiple people and independent arms. Rotating a skeleton cannot change 3D angles, so these
  tests prove the counter uses only view-independent geometry. They do not
  measure MediaPipe's depth error from a real camera, which remains the main
  risk for front-facing views. Physical accuracy is unvalidated until saved
  clips with actual-rep labels are rerun on device. Ankle angles (calf raises)
  and the additional 21 MediaPipe landmarks are not yet used.
- Background: the 2026-10-05 survey of datasets, research, open-source and
  commercial counters found no open per-exercise rule catalog of this size;
  research instead uses class-agnostic counting. Closest published method:
  [viewpoint-invariant skeleton repetition counting](https://arxiv.org/abs/2107.13760).

## Algorithm comparison before assisted logging

The prototype now uses MediaPipe Full for live pose estimation and its own
exercise-specific angle-cycle counter. The first matched owner clip favored
MediaPipe's joint tracking for this setup; it does not establish a universally
best detector or counter. Apple Vision remains available for saved comparison.
The following remain benchmark candidates before assisted logging:

1. **Apple HumanBodyActionCounter:** pretrained repetition counting and an
   official native sample; test its temporal-window latency and treatment of
   slow reps, pauses and partial cycles. The framework is proprietary even
   though Apple supplies reusable sample source.
2. **MediaPipe Pose Landmarker plus Google's reference pose classifier/counter:**
   the primary open-source mobile alternative. Native iOS live-stream support
   and estimated 3D landmarks are available; the pose model itself does not
   count reps. The published classifier example covers push-ups and squats and
   needs representative pose examples for other movements. The reference
   counting implementation is Android/Python; native Swift needs adaptation.
3. **RepNet:** a secondary research comparator for general video periodicity.
   Do not assume an iPad-ready implementation or that generic repetition counts
   identify valid exercise cycles and set completion.

Compare complete-set exact counts, false counts during setup/rest/partial reps,
slow and paused lifts, bench/rack occlusion, tracking loss and recovery, latency,
thermal/power cost and camera placement effort. Use permitted labeled inputs and
live manual ground truth. Only explicitly started test clips are retained locally;
automatic upload remains absent.
Evaluate pose tracking separately from repetition logic so a better detector is
not confused with a better counter. Selection must follow results on the A16
station and supported exercises, not generic pose benchmarks or demo claims.

Sources checked 2026-10-03:

- [Apple counting sample](https://developer.apple.com/documentation/createmlcomponents/counting-human-body-action-repetitions-in-a-live-video-feed)
- [MediaPipe native iOS guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/ios)
- [Google pose classification and counting reference](https://developers.google.com/ml-kit/vision/pose-detection/classifying-poses)
- [Google RepNet research](https://research.google/blog/repnet-counting-repetitions-in-videos/)

## Notes / open questions

- Owner decision, 2026-10-08 supersedes October 5: App Store version 1.0
  includes native iPad and manual partner Station. The
  [submission plan](../app-store-submission/plan.md) owns the SDK-free public
  build; movement-camera counting, recordings and assisted automatic logging
  remain beta-only. The physical camera/link trials above remain open for the
  beta; the public manual candidate requires its own native iPad and
  three-device partner acceptance.
- Approved prototype target: 11-inch iPad (A16). Use its built-in front camera
  first; external UVC input is deferred until placement evidence requires it.
- The counter and view receive no workout mutation capability. Workout/catalog
  selections carry immutable display values and an optional duration only.
  Choosing an exercise resolves a profile but does not arm the camera or trial.
- Current runner ownership protects a process/local persistence namespace.
  Distinct set UUIDs from two devices can represent one physical set twice;
  existing idempotency is not a cross-device controller lock.
- No database or provider change is part of this work; the only backend change
  is the read-only link-key route. Bounded local
  test retention is owner-approved; client distribution is limited to the internal comparison
  build. Do not store account emails, receipts or purchase identifiers in
  repository evidence.
- Sources: [Apple Vision body pose](https://developer.apple.com/documentation/vision/detecting-human-body-poses-in-images),
  [Apple repetition sample](https://developer.apple.com/documentation/CreateMLComponents/counting-human-body-action-repetitions-in-a-live-video-feed),
  [iPad A16 specifications](https://support.apple.com/en-us/122240).
