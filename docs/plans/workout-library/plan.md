# Workout Library

Slug: workout-library · Status: active · Updated: 2026-11-15 · Theme: gym-floor

## Goal

Let a member keep a library of reusable workouts that exist independently of
any weekly routine, drop one onto any date (today or future) in one gesture,
and run a genuinely unplanned session when life or travel breaks the pattern.
The recurring weekly schedule becomes one optional way to use the library, not
the frame every workout must fit into. Exercise guidance, history and replacement
discovery should remain close to the workout without interrupting set entry.

## Library model

The shared versioned plan tree supplies the library. The coordinated rename
changes its vocabulary without creating a second workout store:

- `workouts` are reusable workouts. Nothing about a row ties it to a
  weekday; `plans.meta.schedule` is a separate weekday → `workout_id`
  map, and a day with no schedule entry is already valid and runnable
  (manual-workout-authoring P0 verified "an unscheduled day remains available
  in the routine but does not appear in Today by itself").
- One-date assignment already exists: `PUT /api/calendar/{date}` /
  `set_planned_session` binds any day template to a concrete date without
  touching the schedule or the plan version. Today's rest-day "Start a
  workout" CTA and the "train a different day" override reuse the same path.
- `projectCalendar` already prefers a real session over the schedule, so a
  library workout dropped on a scheduled day simply wins for that date.

The original gaps were product framing and three capabilities it exposes:

1. **The UI named everything "Routine."** The prior `RoutineView` add flow says
   "adds a reusable workout to your routine", deletion says "recurring
   weekdays using this workout become rest days", and a workout with no
   weekday has no visible identity of its own. A member reads this as "every
   workout must be a routine day."
2. **No library metadata.** A member with a hotel workout, a 20-minute
   bodyweight session, and three gym days has no way to tag, group, or retire
   workouts. The only exit is delete, which is framed around the schedule.
3. **No true one-off session.** A session with `workout_id = NULL` today
   is not "freestyle": `deleteWorkout`'s scope predicate and the runner
   both resolve a null-template session through the weekly schedule. There is
   no way to walk into a gym, log whatever the equipment allows, and
   optionally save what you did as a new library workout.

The design stays on the versioned plan tree and the append-only session log.
No second editor, no per-session template copies, no weeks table.

## Phases

- [x] **P0 — Present the library as the primary object**
  - Rename the routine surface to **Workouts**. Each workout card shows its
    own identity plus a schedule badge ("Mon · Thu" or "On demand"). The
    schedule becomes a section of that screen, not its frame.
  - Split the destructive action: **Unschedule** clears weekday entries only
    (existing `PUT /api/plan/schedule`); **Delete workout** keeps the current
    `DELETE /api/workouts/{id}` semantics and copy. The add flow stops implying
    that a new workout must be scheduled.
  - Make "put this workout on a date" a first-class calendar gesture for any
    today-or-future date that is not inside a `can_train_light=false` trip,
    reusing the existing `PUT /api/calendar/{date}` attempt-CAS path and the
    agenda picker. Hard-blackout dates keep their current behavior: the iOS
    guard rejects the assignment and the projection suppresses a planned
    session there. Lifting that is a projection-parity change and is out of
    P0. Verify a library workout dropped on a scheduled weekday shows as that
    date's workout in Today, the calendar, and `get_today_workout`, and that
    the recurring schedule is unchanged.
  - No schema or Worker change. Update `docs/DESIGN.md` §4 and §9 wording so
    "day template" is described as a library workout that the schedule may
    reference.
- [x] **P0.1 — Today and Calendar navigation**
  - Owner-approved design: Today has a compact scheduled/completed workout
    card, explicit View workout, Start/Continue workout, Choose a workout,
    Create a workout, and Log an activity actions. Remove the duplicate
    top-right Workouts entry and the idle plus/overflow menus.
  - The library opens a named workout before starting or editing it. Editors
    name their exact saved workout and distinguish saved prescriptions from
    completed records. Plan changes lives in the library; Training overview
    lives in Profile's Coach section. Keep runner recovery, feedback, timers,
    terminal actions, and the full completed record reachable.
  - Rename History to Calendar, retain exercise progress, and make date
    assignment/replacement/removal explicit. Keep weekly scheduling separate;
    moving a workout must preserve both dates under concurrent writes.
  - Create-from-Today opens a named saved-workout creator and editor, explicitly
    described as a library write. The preview's one-off creation and optional
    saving require a separate product decision and P2 compatibility work; the
    implementation question remains open in the design task.
  - Verify synthetic iOS journeys for every new route, ambiguous/null workout
    identity, compact completion, date scope, and preservation of recorded sets.
  - Delivered a receipt-backed atomic move endpoint without a migration. Both
    date attempts advance together; concurrent changes reject the whole move.
    Date notes/fatigue, weekly scheduling, and completed records are preserved.
    Acknowledged writes retain success when refresh fails; creation recovers
    through a read-only refresh and failed finishes retain the discard path.
  - Local evidence: the iOS smoke suite completed 499 unit tests (one skipped)
    and 28 UI journeys without failures. Focused navigation journeys additionally
    cover removal without a saved-workout identity, unresolved real-session
    records, first-workout creation recovery, and both terminal recovery paths.
    All 70 backend test files passed; the final calendar/dual-schema subset
    passed 112 tests. Typecheck, plan graph and verification-script checks passed.
    Final independent local review found no actionable regressions.
  - Follow-up browsing repair (2026-09-10): the workout label, blank space,
    padding and disclosure chevron open named details; secondary actions have
    a 44-point target. Swipe left reveals Delete with full-swipe execution
    disabled, then a named Delete/Cancel alert confirms removal. The shared
    mutation and active-workout guards remain in place. Library UI journeys
    originally ran in PR smoke coverage; detailed row/cancellation variants now
    run in the periodic full suite under the [verification policy](../../IOS-VERIFICATION.md). This
    follow-up shipped in the owner-authorized TestFlight 1.0 (38) distribution.
  - Owner-approved action cleanup (2026-09-11): Profile keeps name editing and
    one Account route; export, sign-out and account deletion live inside Account.
    The runner keeps the current set action and values above the tab bar while
    inputs scroll. Workout editing separates normal rows from explicit reorder
    and grouping modes. Exercise removal and set deletion require named alerts
    with Cancel. Early finish distinguishes Keep working, Save feedback & finish,
    and finishing without new feedback. Removing a required set replaces the
    unavailable final Finish action with Review exercises; returning selects
    unresolved work and checkpoints the runner. Completed slots show their
    completion state instead of an extra Log action. Regression journeys exercise
    actual taps through rest, reordering, deletion, and both finish choices.
    These client changes shipped in TestFlight 1.0 (38),
    verified VALID and available to internal Testers. Physical-device follow-up
    remains unverified.
- [ ] **P0.2 — Substitute unavailable equipment during a workout**
  - [x] **(a) Session-scoped swap implementation**
    - Add an in-runner, searchable Swap exercise picker for the current workout.
      Retain completed-set identities, set progress and superset membership;
      show replacement-specific load and demo information. An active timed set
      must finish or stop first. Keep the reusable workout unchanged.
    - Store original/replacement slot snapshots and a swap revision on the
      existing session, scoped to its attempt. Use plan-version and session CAS,
      protected atomic audit, ordinary session deltas and account persistence.
      Reopening before the first set must preserve the choice; stale pickers and
      later attempts cannot inherit an old change. Same rep/timed measure only.
    - Verified real-D1 writes, restart/isolation/conflicts, iOS recovery,
      replacement logging, and the visible picker journey. Local verification:
      1,020 backend tests; 520 iOS unit tests (one existing skip, no failures);
      swap, timer-navigation and superset UI journeys. The owner authorized
      publication, independent review and merge after passing CI on 2026-09-12.
      The pull request from `feat/in-workout-exercise-swap` carries exact-head
      review and CI evidence. Production migration, deployment and app release
      remain outside this repository delivery.
  - [ ] **(b) Authorized Worker release and verification**
    - Migration 0050 was applied once with explicit owner approval on 2026-09-12;
      ledger and nullable `sessions.exercise_swaps` TEXT-column readback passed.
      The separately approved pinned Worker was deployed on 2026-09-12 Pacific
      time; provider source attribution and public checks passed. Authenticated
      session-swap and workout-name compatibility checks remain unperformed;
      neither public health nor Apple processing proves those behaviors.
  - [x] **(c) Authorized client distribution**
    - The owner separately approved signing, validation and upload of build 40.
      Xcode uploaded the pinned archive; Apple verified VALID processing and
      internal Testers availability. The existing App Manager credential now
      permits selecting build 40 for App Review. P0.2(b) live verification remains
      open. Follow the coordinated App Store release record for submission;
      public release remains manual.

- [x] **P0.3(a) — Exercise-first creation and lookup (repository)**
  - Owner priority on 2026-09-13: improve creation and exercise discovery before
    library tags/archive. Today, Calendar, onboarding, and Add workout open exercise
    selection immediately. Keep selection local until Save; naming is optional
    on the following review screen with an unused `Workout N` default.
  - Reuse one picker for creation, Add exercise, and Add warm-up. Keep search
    visible, match names, catalog aliases, muscle and equipment, and compose it
    with All / Upper body / Lower body / Core filters derived from the catalog's
    primary muscle. These are exercise filters, separate from P1 workout tags.
  - Preserve selection order across queries and filters. Preview initial targets;
    continue into the existing prescription editor after creation. Rep exercises
    start at 3 × 8, holds at 3 × 45 seconds, cardio at five minutes, with zero
    load pending member selection and manual progression.
  - Extend `POST /api/workouts` with optional
    `exercise_ids` (1–50 unique catalog IDs). Require observed plan ID/version
    for this path. Validate the complete list before one atomic workout/slot/
    version/audit/snapshot write; an uncertain retry keeps its captured request.
    Existing name-only clients remain compatible. No schema migration.
  - Verify search/filter composition, cancellation without writes, unnamed
    creation, slot order, rejected/concurrent requests, lost responses and
    acknowledged-save/failed-refresh recovery on the real model and D1.
- [x] **P0.3(b) — Release exercise-first creation**
  - After repository review and CI pass, obtain owner release authority for the
    compatible Worker, then an iOS build containing P0.3(a). No migration is
    introduced here. The server must accept `exercise_ids` before distributing
    this client; do not fall back to sequential or empty-workout writes.
  - Retain exact deployed source and client distribution evidence separately.
    The later owner-authorized build 42 release
    includes PR #198 in both Worker and client source. The September 18
    readback confirms that same Worker at 100% traffic and build 42 VALID in
    internal Testers. This reconciles the stale release checkbox; it does not
    establish physical-device acceptance or new App Review authority.
- [x] **P0.4 — Streamline observed iOS workflows**
  - [x] **(a) Implement and verify the observed usability fixes**
    - Owner-approved after a hands-on simulator audit of : put load
      and reps ahead of secondary controls, retain visible circuit membership,
      remember compact rest, and correct the exact last logged set from rest.
    - Use one Workouts entry for browsing and creation on scheduled/completed
      Today; retain direct creation for an empty library. Keep date-specific
      selection explicit and Start/Schedule pinned in workout details. Place
      date actions beside the date heading with a verified 44-point touch target.
    - Weekly scheduling uses explicit Cancel/Save, protects dirty drafts,
      submits the loaded plan identity/version, and retains failed/conflicted
      drafts for member-reviewed retry. Early finish starts with a summary;
      voice, notes and fatigue appear on request. Existing saved feedback and
      recorded sets keep their existing write and recovery paths.
    - Connections lists available sources, moves device-routing help into a
      disclosure, and distinguishes Apple Health opt-in from Intervals status.
      RPE semantics, new onboarding behavior and additional providers remain
      outside this observed-fix slice.
    - Local verification: 610 iOS unit tests completed with one existing skip
      and no failures. All 43 distinct targeted UI journeys passed after fixes,
      covering timer/navigation, circuit/load and kg entry, exact last-set
      correction, accessibility-size rest/logging, schedule conflicts/retry,
      calendar moves/removal and the 44-point menu edge, finish feedback and
      Intervals connections. Runner, pinned workout actions, early finish and
      calendar screenshots were inspected. Independent local review found no
      remaining blocking issue. PR #209
      merged on 2026-09-17 after current-head hosted review and required CI.
      PR #210 followed with
      stacked Today actions, full-width exercise names and a compact rest that
      keeps next-set values and exact last-set correction at accessibility text
      sizes. Manual physical-device and VoiceOver behavior remain unverified.
  - [x] **(b) Distribute the verified client changes**
    - The September 18 follow-up authorizes internal TestFlight distribution
      after P0.5(b) merges, including the recent UI fixes and P0.5(a) sheet.
      Carry the exact reviewed source and Apple processing/beta evidence into
      the App Store release record. Worker deployment and App Review/public
      release remain separately authorized.
    - Distribution: TestFlight 1.0 (43) shipped from
      reviewed merged source containing PRs #209, #210, #213 and #214.
      Apple confirmed VALID, IN_BETA_TESTING and internal Testers assignment on
      September 18 Pacific. No backend deployment was needed; App Review still
      selects build 40. Physical-device and VoiceOver acceptance remain open.

- [x] **P0.5 — Connect exercise guidance and discovery**
  - Planning approved after the September 18 SensAI inspection.
    The owner activated (a) on 2026-09-18, ahead of P1 tags/archive.
    P0.5(a) merged in PR #213.
    The owner activated (b) on 2026-09-18, then authorized a combined internal
    TestFlight build with (a) and the recent UI fixes after review and merge.
    The October 6 request to finish this plan activates slice (c), with a
    comparison of replacement visual libraries. App Review and public release
    remain outside this approval.
  - [x] **(a) One exercise sheet for technique and history**
    - Reuse the existing demo and exercise-history data in a shared Technique /
      History sheet opened from workout preview, runner and catalog pickers.
      History starts with the last comparable performance and offers the full
      history; empty, unavailable and loading states stay distinct.
    - Preserve per-hand/per-side explanations, signed assistance and rep/timed
      semantics. Opening/dismissing the sheet must retain the current exercise,
      set, unsaved input, rest deadline and active timed-set state. Picker info
      must not accidentally select or swap an exercise.
    - Verify unfamiliar and familiar exercises from all entry points, a swapped
      exercise's own history, normal/large text and return during rest or a timed
      set. Reuse existing data paths; no new analytics store or mandatory runner
      animation is needed.
    - Repository implementation reuses the demo, cached history cohorts and full
      exercise-history view. Comparable summaries use completed sessions with
      the same rep/hold mode and prescribed load; current, discarded, deleted
      and warm-up records cannot become a prior comparable performance.
    - Local verification passed six focused unit tests and ten UI journeys,
      covering preview, runner, create, add, warm-up and swap entry points,
      preserved selection/query/filter state, draft values, rest and active
      timers. Existing creation and swap smoke journeys also passed. Largest
      system-text journeys cover the sheet and return to selection; search
      submission dismisses the keyboard so information remains reachable. The
      pull request from `codex/exercise-guidance-history` carries the independent
      current-head review and required CI evidence. Client distribution remains
      separate from this repository slice.
  - [x] **(b) Consistent search and filters for creation, addition and swaps**
    - Share alias-aware search and All / Upper body / Lower body / Core filters
      across create, add, warm-up and session-swap pickers. Retain search/filter
      state when opening details or returning from a selection review.
    - Keep matching-muscle ordering and the swap path's rep/timed compatibility
      restriction. Offer equipment filtering only after checking catalog
      coverage and defining unknown/mixed-equipment behavior; never silently
      hide unknown entries. Force/difficulty filters require a separate trusted
      metadata contract and are outside this slice.
    - Verify finding an unavailable-machine replacement without its exact name,
      composing alias search with filters, clearing an empty result and canceling
      without writes. Confirmation names the affected exercise and says this
      session only; the library editor separately names its reusable-workout scope.
      Completed sets, group membership, replacement load, attempt/version checks
      and swap recovery retain the delivered P0.2(a) contract.
    - The session picker now uses the same search/filter component as create,
      add and warm-up. Selected replacement and information-sheet state survive
      filtering; confirmation names both exercises and states the session scope.
      Add/warm-up configuration names the saved workout. The catalog has names,
      aliases, muscle and modality but no separate equipment taxonomy; equipment
      remains searchable through those fields without an inferred exclusion filter.
    - Seven search-policy tests and nine targeted UI journeys passed, including
      alias/filter composition, empty-result reset, info and review returns,
      cancellation without writes, and logging after a swap with prior sets and
      plan version preserved. The four new journeys passed a repeat at normal
      text size. Largest-system-text creation/review and complete swap journeys
      also passed; normal and largest-text swap screenshots were inspected.
      Local independent review found no actionable issue.
      PR #214 merged after
      current-head review and all eight CI checks passed, including 625 iOS unit
      tests (one existing skip) and all 12 smoke journeys. P0.4(b) records its
      completed internal TestFlight distribution.
  - [x] **(c) Small exercise visuals in workout previews**
    - Reuse the app's existing demonstration assets as lightweight thumbnails in
      the shared workout preview. Keep exercise names, targets and circuit or
      superset membership readable; missing art gets a stable fallback.
    - Verify recognition and equipment discovery with unfamiliar movements,
      long names, large text, Reduce Motion and a long grouped workout. Keep
      scrolling responsive and preserve text accessibility; visuals must not
      push the prescription or primary workout action out of reach.
    - The visual comparison finds existing assets are free-exercise-db
      photographs, with uneven framing and incomplete catalog coverage.
      Workout Guide is the preferred no-fee illustration trial; WorkoutLabs
      is the commercial alternative. No replacement assets or paid provider
      are adopted by this preview slice.
    - Implemented static, uncropped thumbnails with a fixed fallback and a
      full-width prescription layout at accessibility text sizes. The shared
      loader prefers either bundled frame, fetches only the first available
      remote still, downsamples thumbnails and rejects superseded responses.
      Its bounded cache is shared with the full technique sheet.
    - Five loader unit tests and three native UI journeys passed on iPhone 16e /
      iOS 26.2. They cover missing/malformed art, stale responses, offline
      loading, a twelve-exercise grouped preview, Reduce Motion, and return
      from technique/history. The grouped journey also passed at the largest
      system text size. Native screenshots were inspected; the pinned primary
      action and information buttons remain reachable. These are simulator
      results, not physical-device or manual VoiceOver acceptance.
    - The preview PR #244 merged after
      exact-head review and CI. The owner authorized the matching backend and
      internal TestFlight release on October 7; build 49's receipt
      records its upload and Apple availability separately.
  - [x] **(d) Drawn exercise illustrations**
    - On October 11 the owner reviewed a six-movement trial
      and chose Workout Guide's line drawings over the free-exercise-db photos.
    - `scripts/exercise_drawings.json` maps 169 of 280 catalog exercises to a
      pinned Workout Guide commit after a frame-by-frame review. Name matches
      with different equipment or variations stay unmapped, and three matches
      were rejected: Romanian deadlift, skater squat and toe-touch crunch. Each
      entry names the shipped frames; holds and some single-pose movements ship
      one static frame.
    - `scripts/bundle_exercise_drawings.py` crops each exercise's frames to one
      shared box and bundles them (about 5 MB). The loader prefers a drawing by
      exercise ID, offline and without a demo slug, before bundled or remote
      photos. Drawn exercises no longer bundle duplicate photos, leaving three
      photo pairs; unmapped exercises keep the existing photo or placeholder.
    - The technique sheet credits Bryl Lim and Everkinetic, notes the crop and
      links the Workout Guide source and CC BY-SA 4.0 whenever it shows a
      drawing. Thumbnails stay decorative.
    - Loader unit tests cover drawing precedence without a slug or network,
      single-frame holds, thumbnail lookups and credit state, plus bundled-asset
      presence. No Worker, schema or R2 change. App Store candidate build 50
      keeps photos; drawings need a later client build.

- [x] **P0.6 — Focus the gym workflow**
  - The October 3 design audit and owner approval activate this implementation.
    Use the Focus direction: keep the current exercise, combined load/reps
    entry and logging action central; retain the dark/amber visual language.
  - [x] **(a) Implementation and local verification**
    - Reserve compact rest and correction space beside the logging action.
      Keep End rest separate when the timer expires; offer the large clock
      explicitly. Collapse unloaded bodyweight input behind Add load/assistance.
    - Show the current circuit round, every member and the next member's target
      compactly. Name the single-set mutation Log set, including circuits.
    - Consolidate exercise navigation, set review/corrections, swap, skip and
      options into Workout outline. Browsing during an active timed set must
      preserve its executing slot and deadline. Keep model-owned drafts,
      signed assistance, load units and per-side/per-hand semantics intact.
    - Hide tabs in the focused workout; offer Minimize and a clear Resume
      workout route. Preserve timers and entries across tab navigation.
    - Separate date selection from library management, start/continue today's
      workout directly from Calendar, and collapse completed sets beneath
      exercise summaries. Finish feedback remains optional.
    - Verify compact-phone and accessibility layouts with synthetic native
      journeys, exercise groups, timers, recovery and correction flows. Require
      independent review and all applicable CI checks on the final PR head.
    - Implemented in PR #229.
      Compact rest keeps separate End rest and logging controls; Workout outline
      holds secondary actions. Minimize/Resume also retains a Review workout
      route when the final timed set completes on another tab. Calendar starts
      prepare rest notifications and revalidate the selected session afterward.
    - Local verification executed 679 existing unit tests with zero failures
      and one simulator-only file-protection skip. All eight group-presentation
      tests passed, including six new next-member regressions. Fifty-one distinct
      native UI journeys passed across the final targeted runs and repaired-case
      repeats on iPhone 16e / iOS 26.2. Coverage includes accessible rest/logging,
      exact correction, per-side and signed load entry, timed browsing/recovery,
      date selection, unresolved-record expansion/correction, schedule
      conflict/retry and optional finish feedback. The compact rest row only
      creates its periodic timeline while a rest deadline exists.
      Native screenshots were inspected. The empty correction reservation uses
      a layout spacer so it does not expose an unnamed accessibility element.
      PR #229 merged after independent review
      and all eight required checks passed. The merged tree equals the reviewed
      tree. Final CI executed 685 unit tests (684 passed, one simulator skip)
      and passed 12 UI smoke journeys. Physical-device and manual VoiceOver
      acceptance remain unverified.
  - [x] **(b) Client distribution**
    - The owner requested TestFlight distribution on October 3. Build 47's
      receipt records successful upload,
      Apple VALID / IN_BETA_TESTING and internal Testers assignment.
      The owner separately approved the matching Worker deployment to repair
      pre-existing slot-edit version handling; no migration was needed.
      Previously deferred physical-device and live-account checks remain open.
      App Review still selects build 40; no public release occurred.

- [ ] **P0.7 — Prescription accuracy and draft preservation**
  - [x] **(a) Implement and verify the first lifting UX audit slice**
    - Keep prescribed RPE separate from the member's assessment. Actual effort
      belongs to one physical set, including linked-device advances, recovery,
      corrections and queued writes. Unknown loaded-exercise weight requires an
      explicit entry; identify prescribed and previous-set prefills.
    - Review saved-workout replacements before saving. Clear weight when its
      meaning changes and review reps/time, effort and rest together. Commit
      exercise and reviewed targets atomically; reset incompatible week-specific
      exercise targets while preserving grouped rounds and historical logs.
    - Retain web target/replacement and existing-block drafts through navigation,
      refresh and version conflicts. Compare current and proposed values before
      reapplying, reject changed identity, and preserve incomplete cell text.
      Native target/replacement sheets confirm discard and retain conflict drafts.
      A successful write followed by a failed read must not invite a duplicate save.
    - Verify real-D1 contracts, web browser journeys, native units and focused UI
      journeys. Complete exact-head review and required CI before handing to Nick.
    - Repository delivery: Nick merged PR #456
      on 2026-11-13; verified on main.
      Required PR checks passed on its head; hosted Codex review was unavailable
      due to its usage limit. The clean independent fallback was advisory, not a
      replacement approval. The PR retains detailed test and full-run evidence.
  - [ ] **(b) Separately authorized release and physical acceptance**
    - No migration. Deploy the compatible Worker before distributing clients that
      send reviewed replacement targets. Older Workers reject the new target
      object before mutation; do not retry with a legacy unreviewed swap.
    - Production, TestFlight and physical-device/VoiceOver acceptance remain
      separate from repository verification. Preserve P0.2(b)'s existing gate.

- [x] **P0.8 — Reach week-specific targets from the phone**
  - Close lifting audit L04 with accurate native guidance and a direct link to
    the existing web Block editor from setup, the block and the day chooser.
    Explain selecting a workout, exercise and week, and distinguish block-week
    overrides from saved-workout targets. Native target authoring is outside
    this slice; the web remains the detailed block designer chosen in
    [progressive plans](../progressive-plans/plan.md).
  - Preserve the Block destination through Apple sign-in and recoverable sign-in
    errors using a narrow return-path allowlist. Opening the link must not write
    training data or transfer native credentials to the browser.
  - Verify native reachability and browser sign-in/target editing, then complete
    exact-head review and required CI. Web deployment and client distribution
    remain separately authorized release steps.
  - Nick merged PR #457, verified
    on main at (2026-11-13).
    Required checks and independent local review passed on its head; hosted
    review was usage-limited. The PR retains browser and native verification.

- [x] **P0.9 — Adapt a planned lift during the session**
  - Add a working set to an ordinary exercise, log a reviewed warm-up, or add a
    different movement to the current solo workout. Preserve the original
    prescription for comparison, saved workouts, sibling sessions and immutable
    pending log UUIDs. Persist session additions through recovery and reject
    stale account, attempt, selection and prescription contexts.
  - Show comparable previous-session performance and the current cue beside
    runner inputs, with direct access to history (L07).
  - Enter an exact rest duration for this countdown or remaining sets of its
    originating ordinary exercise (L13). Keep grouped transition/round rest
    semantics separate; group timers support current-countdown editing only.
  - Cancel an accidental timed-set start without logging, and make the brief
    Stop & log guard visible (L14). Keep automatic completion intact.
  - This is the ordinary solo-runner slice of L05/L07/L13/L14. Extra grouped
    rounds and shared/partner structural edits remain outside it; those require
    group-wide progress and device coordination rather than a single-slot edit.
  - Verify real-D1 immutable-baseline behavior, native recovery/ordering and
    focused UI journeys. Nick explicitly authorized independent local review
    instead of hosted Codex review in this chat on 2026-11-13 because hosted
    usage is exhausted. Bind that review and all required CI to the exact head;
    Nick still merges. No production or client-distribution authority is added.
  - Implemented in PR #458:
    session-only choices retain the starting prescription and survive recovery,
    refresh and acknowledgement. Local verification covers real-D1 summaries,
    the full native unit suite, lifting interactions, completion accessibility
    and feedback. Nick merged the reviewed head; required CI passed. The merge
    cancelled the unfinished full device check. That release verification
    remains incomplete and must pass on the source selected for distribution.

- [x] **P0.10 — Review individual lifting targets before creating a workout**
  - Close audit L08 on web and iOS: select movements, edit ordered individual
    sets, reps or durations, optional loads and effort, and exact rests before
    the first save. Display per-hand and per-side semantics and preserve
    unspecified loads instead of inventing a starting weight.
  - Reuse the existing atomic prescribed-workout endpoint. Freeze workout and
    slot UUIDs, reviewed authority and targets after an uncertain response;
    preserve successful acknowledgements if the follow-up refresh fails.
    Definitive conflicts retain proposed targets for explicit re-review.
  - Preserve individual draft targets through selection and order changes.
    Protect dirty dismissal on iOS and retain account- and plan-scoped web
    drafts through navigation/reload. Pending recovery must restore every
    exercise's targets rather than flattening them to one common prescription.
  - Keep run and timed-home creation behavior intact. Group authoring, native
    block-target editing and shared workout structure remain separate slices.
  - Verify six-exercise creation with real D1, browser and native journeys,
    including no partial workout before Save, unknown loads, target order,
    conflict review, uncertain retries and account isolation. Continue the
    owner-authorized independent local review and exact-head required CI;
    Nick merges. No migration, deployment or client release is included.
  - Implemented with native per-exercise draft editors and compact web target
    cards. The existing atomic endpoint saves the complete prescription, and
    creation opens details or returns to scheduling after acknowledgement.
    Web search cannot submit the draft, narrow navigation wraps, and transient
    native storage failure keeps the mounted draft while write guards remain.
    Regression coverage includes six heterogeneous targets, no partial writes,
    back/reorder/reload retention, frozen retries and explicit conflict review.
  - The feature merged in PR #462:
    reviewed head became
, with independent local review
    and required CI green. A small qualification follow-up makes native UI
    checks respect the pinned Save button and keyboard, records requests for
    the lifting fixture to verify zero draft writes and one save, and uses
    neutral refresh wording for validation refusals as well as version conflicts.
    The qualification follow-up merged in
    PR #463, reviewed head. Independent local review,
    focused native journeys and required CI passed; physical-device and
    release gates remain separate.

- [x] **P0.11 — Add or correct feedback after completing a workout**
  - Close audit L09 on web and iOS: open the exact completed session and add,
    edit or clear optional notes and perceived fatigue with an explicit Save.
    Preserve completion, timestamps, set logs and sibling sessions.
  - Expose a narrow feedback-only endpoint through the web gateway. Require
    the observed attempt and original feedback, reuse the shared service's
    comparison and retry rules, and enforce completed status at write time.
    Keep unapproved text in memory and audio on-device; saved feedback stays
    available to the member's coach and outside group feeds.
  - Preserve both proposals on a competing edit and require an explicit choice.
    Freeze an uncertain submitted request for an exact retry; keep a successful
    acknowledgement even when refreshing fails. Fence responses against account,
    session and attempt changes. This slice saves online, without a new durable
    feedback outbox or reopening the runner.
  - Verify add/edit/clear after finish, additional-session isolation, cancel,
    conflicting edits, ambiguous retries, acknowledgement/refresh separation,
    stale attempts and account changes. Use independent local review and all
    required CI on the final head; Nick merges. No migration is required.
  - Implemented a completed-only feedback endpoint and editors on web Activity
    records and native primary/additional workout records. Saves return the
    committed session directly; they preserve sets, completion timestamps and
    sibling records. Conflicts retain both versions, ambiguous retries freeze
    the request, and account/attempt guards keep responses on the reviewed
    record. Legacy ratings require an explicit valid choice before saving.
    Web reads cannot overwrite a newer acknowledgement; native additional
    cards contain their accessibility children so each action retains its own
    identifier. The native opening presentation retains the editor through
    sheet remounts, preserving typed notes and pending requests. Completed
    records use direct optional fatigue choices instead of a nested popup.
    Unapproved edits remain memory-only, without a new outbox.
  - Local qualification passed 1,795 D1 tests, 335 web tests and desktop/mobile
    browser feedback journeys, plus 1,648 native unit tests with two expected
    device-only skips. The implementation PR carries the focused native UI,
    independent local review and exact-head required-CI evidence. All five
    focused native feedback journeys passed. Nick merged
    PR #465 at its reviewed head; required CI and local review
    passed, as did the repository-triggered hosted review. Physical and release
    checks remain separate from this slice.

- [x] **P0.12 — Connect strength progress to exact workout records**
  - Close audit L10–L11 and L15–L17: distinguish same-day sessions in native
    exercise history, use stable chronological ordering, and reach the exact
    completed workout and existing set-correction surface without searching
    the calendar. A missing or changed record must never select a sibling.
  - Make native strength history searchable by exercise name or alias, with
    logged current-plan exercises grouped ahead of other history. Keep cached
    read models separate from correction authority and preserve the runner.
  - Retain the source session and set for each daily-best chart point. Explain
    estimated 1RM and daily aggregation, show the actual logged evidence, and
    open that exact workout. Preserve units, per-hand/per-side conventions,
    separate load/mode cohorts and the existing estimate policy.
  - Add web Analysis → Strength with comparable exercise progress, search,
    source-set evidence and exact record links. Prioritize it for lifting-only
    history without inventing an endurance-style lifting load. Load catalog
    context explicitly and distinguish loading, unavailable and empty results.
  - Hand web corrections to the native record with a navigation-only link
    bound to the browser's account, session and reviewed attempt, optionally
    its source set. Require a fresh read in the app; retain sign-in navigation
    without transferring credentials or widening web gateway write access.
  - Verify shuffled same-day history, source selection after correction or
    deletion, unit/cohort boundaries, aliases, missing records and account/
    attempt changes. Complete desktop/narrow browser and native correction
    journeys, independent local review and required CI on the exact head.
    Nick merges; no migration, deployment or distribution is included.
  - Implemented searchable native and web strength review with stable
    completed-session chronology, daily-best source sets and explicit original
    units. Native chart and history links open the exact completed record and
    reuse the existing set-correction flow. Web records hand corrections to
    that native record through the account/session/attempt-bound link; missing
    records, stale attempts and foreign sets fail closed without opening a
    sibling or the runner. Narrow-screen links bring the record into view.
  - Local qualification passed all 1,795 D1 tests, 348 web tests,
    desktop/narrow browser journeys, the full native unit suite (1,664 passed
    and two expected device-only skips) and 32 focused native unit tests after
    review fixes. Native correction, exact account/attempt/set handoff,
    cached-history and chart-mode journeys passed. Nick merged
    PR #466 at its reviewed head, with independent local review
    and all required CI green. The application changes have landed. The
    qualification follow-up retains the largest-text
    journey's numeric-selection helper: iOS's expanded menu shows Select
    before Select All, while the test still requires full clearing, the exact
    saved value, the updated chart and the unchanged sibling set. The journey
    passed at the largest accessibility text size. Nick merged
    PR #467 at its reviewed head, with independent local review
    and required CI green. Local review is used under the owner's standing
    review-usage override; release and physical-device acceptance are separate.

- [x] **P0.13 — Maintain superset and circuit membership**
  - Close audit L12 on native and web: add existing ungrouped workout slots,
    remove members from a group and reorder its members without ungrouping or
    recreating the workout. Require at least two members; retain the existing
    Ungroup action for making every member independent. Group labels remain
    derived from their position and member count. Distinguish repeated
    exercises by workout position and prescription context when choosing or
    reviewing their slots.
  - Keep removed members in the workout with their prescriptions and ordinary
    rests intact. Pack the selected members in the requested order at the
    group's original position, discounting added slots that preceded it.
    Place omitted members immediately after the updated group and preserve
    the relative order of other slots and groups. Do not take another group's
    members or silently drop unavailable selections.
  - Save membership, ordering, rounds and exact rests through the existing
    atomic group writer and reviewed plan version. Keep the group UUID and
    existing retry, acknowledgement and account boundaries. No migration or
    new backend write path is needed.
  - Preserve the group draft through plan refresh and save conflict. Require
    explicit review of the latest workout before resubmitting, explain missing
    or newly grouped selections, and protect dirty close/switch actions.
  - Verify order and prescription preservation in real D1, platform draft and
    version tests, desktop/narrow browser journeys and native membership and
    conflict journeys. Independent local review and all required CI must pass
    on the exact head. Nick merges; release and physical-device acceptance
    remain separate.
  - Implemented ordered membership editing on both platforms with retained
    proposals, explicit conflict review, same-name exercise context, dirty
    close protection and unchanged group UUIDs. Web keeps keyboard focus after
    removing a selection. Native preserves an exact uncertain request for
    retry and keeps supported round counts reachable after a decrement. Group
    rest labels stack above their inputs at accessibility text sizes.
    Real-D1 coverage pins interior removal, nonadjacent additions, neighboring
    group preservation and replay; platform tests and browser/native journeys
    cover the editing and recovery paths. Final qualification and independent
    local exact-head review evidence travel with the implementation PR.
  - PR #468 merged 2026-11-14.
    Required CI and independent local review passed on its head; desktop
    and narrow browser journeys and both standard-text native membership/
    conflict journeys passed. Largest-text evidence remains partial; release
    and physical-device acceptance are separate.

- [ ] **P0.14 — Adapt grouped work during a solo session**
  - Add an extra superset or circuit round from the active group or finish
    review. Increase every member together; explain that the added round
    includes every movement. Preserve original starting targets and the saved
    workout. Shared/partner structural changes remain separate work.
  - Edit the current countdown or the remaining round rests / transitions,
    with those two group durations kept independent. Accept exact seconds,
    including zero, with no change to reusable group rests.
  - Persist under the existing account/session/attempt checkpoint authority.
    Reject stale actions and invalidate group adjustments when membership,
    order or the source prescription changes. Old checkpoints still decode.
  - Verify queued-set and cold recovery, skipped members, completed groups,
    additional-session isolation, failed persistence rollback and timer/partner
    guards. Qualify native code and the actual runner controls before delivery.

- [ ] **P0.15 — Preserve unfinished block setup and workout details**
  - Retain web new-block name, start, week count and repetition, plus the
    reviewed source week/version, across navigation and reload. A conflicting
    new block is not permission to overwrite it.
  - Retain workout name, tags and notes per account/plan/workout. Plan refresh
    or a failed save keeps the proposed values; a stale version requires an
    explicit current-versus-proposed review. Clear only the acknowledged draft
    revision, preserving edits made while a request was in flight.
  - Native block setup and tag editing protect dirty dismissal and preserve
    proposed input through conflict. A newly arrived block must not silently
    dismiss an unfinished setup sheet.
  - Verify navigation/reload, conflict review, account isolation, cancel,
    competing block creation and acknowledged saves with failed refresh.
    Other forms (event/away dates, new group and run-step authoring) are not
    covered by this bounded slice and must not be described as draft-safe.

- [x] **P1 — Library metadata: tags and archive**
  - Reuse prescription-integrity's validated atomic writer contract for every
    new metadata mutation, including conflicts and audit. P0 presentation work
    remains independent of this backend prerequisite.
  - Add `workouts.tags` (JSON array of short strings such as `travel`,
    `quick`, `bodyweight`, `hotel`) and `workouts.archived_at`
    (nullable epoch-ms) in one migration. Both are plan-tree fields: every
    write goes through the existing atomic plan-version writer, bumps
    `plans.version`, and audits as the calling actor.
  - Archiving hides a workout from pickers and Today while preserving every
    completed or in-progress `sessions.workout_id` and
    `set_logs.template_exercise_id` reference. In the same write it clears
    the workout's weekday entries and resolves its future dated assignments
    the way `deleteWorkout` already does: a `planned` session pointing
    at the workout becomes explicit rest with its attempt advanced, because
    `projectCalendar` gives a real session precedence over the schedule and
    would otherwise keep showing the archived workout. Archiving is rejected
    while the workout has an in-progress session, matching delete.
  - Every assignment resolver rejects an archived workout, not only the
    updated pickers: `setPlanSchedule`, `setPlannedSession`,
    `getWorkoutInPlan` as used by `POST /api/sessions` and
    `PUT /api/calendar/{date}`, and the MCP day-ref lookup all treat
    `archived_at IS NOT NULL` as unknown. Otherwise an older iOS build that
    ignores the field, or any caller still holding the id, can reassign it
    and the resulting real session wins projection and restores it in
    Today. Add a test that each path returns the same not-found result for
    an archived id.
    `update_plan`'s rebuild must carry both fields through the day remap.
  - Expose both fields through `get_current_plan`, `add_workout`, `update_workout`,
    and `PATCH /api/workouts/{id}`; `/api/state` carries them in the plan tree.
  - When a date falls inside a `plans.meta.trips` range, the calendar and
    Today pickers surface `travel`-tagged workouts first. This is ordering,
    not a rule engine.
  - Released-client compatibility (shared rule in
    `workouts-and-multi-session`): archived workouts stay in the plan tree
    for every client so completed history still renders its workout name;
    a client without the `archive` capability simply sees them in its
    pickers, and the resolver rule above turns any attempt to assign one
    into `unknown_day`, which the released app already handles as a
    permanent client error.
  - Extend `test/calendar.test.ts` so an archived workout referenced by the
    schedule projects as rest on both backend and iOS
    (`CalendarProjection.swift` already treats a dangling id as rest; make
    the archived case explicit and keep the two in parity).
- [x] **P2 — Freestyle session and "save as workout"**
  - [x] **(a) Implement and verify repository delivery**
    - Migration 0054, durable freestyle starts, slotless set logging, account-
      scoped runner recovery and reviewed atomic save are implemented. The
      save receipt, plan/source CAS and attempt advance make retries safe;
      new workouts remain unscheduled. REST and iOS use one current freestyle
      contract; MCP logging on unscheduled or explicitly skipped dates creates
      freestyle sessions.
    - Verification: 1,178 backend tests across three shards, including 25
      freestyle cases; 636 iOS unit tests with one existing skip; rep and timed
      start/add/finish/save UI journeys, including largest system text. Query
      plans, TypeScript, plan graph and same-Worker rename/rollback rehearsal
      pass. PR review and CI retain exact-head delivery evidence.
  - [x] **(b) Release migration, Worker and matching client**
    - The owner approved the P1/P2 production release on September 19.
      Migrations 0053/0054 are applied, and the reviewed canonical Worker is
      serving at 100% traffic. Build 44's receipt
      records exact source, integrity checks and the successful client release.
      Apple reports build 44 VALID / IN_BETA_TESTING in internal Testers.
      The owner explicitly deferred authenticated live workout checks to device
      testing for this beta; they remain unperformed, not passed. Physical
      acceptance and public-readiness gates remain separate.
  - Add an explicit `sessions.kind` (`'planned' | 'freestyle'`, default
    `'planned'`) so a freestyle session with `workout_id = NULL` never
    resolves through the weekly schedule. Update the scope predicate in
    `deleteWorkout`, the runner's template inference, and
    `projectCalendar` (a freestyle session is a real session and wins for its
    date; it renders with its logged exercises rather than a template name).
    Owner decision (September 19, 2026): there are no legacy clients to
    support for this feature. Use one current client/server contract, without
    capability negotiation, hidden-session projections or upgrade-only cache
    reloads. All authenticated clients receive actual session kinds and ordinary
    set deltas, including tombstones. Attempt guards still prevent stale writes
    and live freestyle sessions cannot be pinned to scheduled workouts.
  - The runner starts a freestyle session from the rest-day CTA and from the
    calendar for today. Exercises are added from the catalog as you go; the
    prescription shown is the member's last comparable actuals for that
    exercise (existing history query), not a stored target. Sets log through
    the same idempotent `POST /api/sessions/{id}/sets` with
    `template_exercise_id = NULL`.
  - **Save as workout** converts a completed freestyle session into a library
    workout: one atomic `POST /api/sessions/{id}/save-workout` call through
    the shared versioned plan writer, with member-reviewed slots derived from
    compatible exercise, execution-mode and external-load cohorts in
    first-logged order. `target_sets` is the cohort's working-set count.
    A timed cohort defaults duration to its median observed duration, rounded
    to a valid positive integer number of seconds and shown for review, with no
    rep target; a rep cohort defaults reps to its median observed reps, rounded
    to a valid integer and shown for review. Load comes from that same cohort,
    never the maximum from incompatible sets. Cardio follows the timed branch.
    Separate mixed cohorts into slots or require an explicit member target
    selection before saving; do not merge them by exercise identity alone.
    Warm-up sets are excluded from the derivation. The
    new workout is unscheduled and, on the same write, the session is
    re-pointed at it so history attaches to the library entry. The re-point
    is an assignment change, so the same write advances `sessions.attempt`
    under the existing rule that every changed workout choice advances the
    generation; a delayed set intent carrying the old attempt is rejected
    instead of landing on the saved workout's history. The client supplies
    the new workout's id, so a retry after a lost response returns the same
    workout and the already-advanced attempt instead of creating a second
    workout or bumping again. This is a plan-tree write and audits normally.
  - Before saving, show an editable derived prescription with its provenance.
    Do not silently combine median reps from one load/assistance condition with
    the highest weight from a different set and present that pair as performed
    or recommended. Mixed timed/rep, assistance/strict/added-load and variation
    cases must remain separate or require an explicit target selection. Pass
    the chosen prescription through the same runtime validator as other writes.
  - MCP: `log_set` on a date with no session creates a freestyle session
    when the date has no scheduled workout, instead of a null-template
    planned session, and the coach brief names it as such.

- [x] **P3 — One-time workouts for one date**
  - Owner observation (2026-11-11): making today's run harder after a missed
    day meant changing the reusable workout for every later date too,
    because every planned date has to point at a library workout. The owner
    asked for a workout that belongs to one day instead.
  - [x] **(a) Implement and verify repository delivery**
    - Migration 0075 adds `workouts.one_time_date` (a real civil date or
      null). A one-time workout lives in the versioned plan tree like any
      other, so snapshots, audit, restore and history keep working, but it
      stays out of the library, the weekly schedule, blocks of weeks, the
      `update_plan` rebuild, `adjust_today` and name lookups (a name or
      label always means the library workout; a one-time workout is
      reached only by its id). It stays on its own date:
      assigning, adding, starting or moving it on another date is refused.
    - REST: `POST /api/workouts` takes `one_time_date`, a client `id` and an
      optional `copy_from`. The copy carries the source's slots, groups and
      run steps with that date's block-week targets applied. The client id
      is a receipt: a retry returns the same workout (201) and a different
      workout under that id is a 409.
    - MCP: `add_one_time_workout` copies the date's workout (or a named one,
      or a list of exercises) and puts it on that date's primary session; the
      coach then edits the copy's slots, or adds to it by its id. It refuses
      a date whose workout has started; an optional caller id makes a retry
      return the same workout, and once the copy is committed a failed
      placement or read comes back as an outcome with its id, never an error. The server instructions and every slot-editing tool say that
      a one-date change goes in a one-time workout. `get_current_plan`,
      `get_today_workout` and the coach brief list one-time workouts from
      the last week onward apart from the library.
    - iOS: "Change for today only" on a planned workout's details and
      "Change X for this day only" in Today's Change today picker copy the
      workout, put it on the date and open the normal editor, which says the
      edits apply to that date only. Every library, week, block and picker
      list leaves one-time workouts out. Web lists leave them out too.
    - Verification: `test/one_time_workouts.test.ts` covers the copy with
      block targets and groups, coach edits that leave the source alone, the
      REST receipt, retry and conflict, exclusion from the schedule, blocks,
      name lookups and `adjust_today` (named or not), refusing another date
      (assignment, additional session, start and move), reaching a copy only
      by its id, a retried caller id, surviving an
      `update_plan` rebuild, the snapshot field and a started date's refusal. All four backend
      shards passed (1,908 tests); the web check passed.
      `WorkoutMetadataTests` covers decoding, the library filter and the
      calendar on a one-time date; CI builds and runs iOS.
  - [x] **(b) Release migration, Worker, web and app**
    - Migration 0075 first (additive), then the API Worker, the web app and
      a TestFlight build, each on the owner's written go-ahead. App Store
      builds 55 and 70 keep working: they list a one-time workout as an
      ordinary workout.
    - Released 2026-11-11 on the owner's written
      go-ahead: migrations 0074 and 0075, API Worker, web and website. The live coach lists
      `add_one_time_workout`.
    - The release check failed three Add to your
      week UI journeys (the Add button had moved below the fold,
      app-design-pass P24, not this phase). With that fixed, release check
      run passed in full, and TestFlight 1.2
      (79) was uploaded on 2026-11-11 on the owner's written
      go-ahead. That build adds only iOS changes to the released backend.

## Core lifting follow-through

The November 15 owner direction activates the remaining ordinary lifting UX
work. The original audit's numbered findings and the boundaries of earlier PRs
are not a declaration that the whole experience is complete. Manual week-target
editing belongs to [progressive plans P6](../progressive-plans/plan.md), and a
reviewed lighter week belongs to [coach-free planning P2](../coach-free-planning/plan.md).

## Execution frontier

- P0.2(b)
- P0.7(b)
- P0.14
- P0.15

## Dependencies

Completed Gym Runner Depth supplies
the shared prescription controls, durable corrections and runner presentation.
Reuse that delivered path when changing the runner.

P1 metadata and P2 save-as-workout reuse the completed validated atomic writer, including prescription creation and session reassignment. P1 extended canonical snapshots to retain `tags` and `archived_at`, including legacy snapshot reads and full-plan rebuilds.

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P0 | blocked_by | plan:workouts-and-multi-session#P0(a) | The selected goal establishes canonical workout terminology and compatible clients before the library UI. Production rollout and compatibility cleanup do not block this repository slice. |
| P0 | coordinates_with | plan:member-activation-and-adherence#P0 | Both edit the no-plan and Today entry surfaces; do not run concurrently on the same iOS files. |
| P0.3(a) | coordinates_with | plan:member-activation-and-adherence#P0 | Both use first-workout entry and the shared exercise catalog. |
| P0.5 | coordinates_with | plan:member-activation-and-adherence#P3 | Preview and upcoming-session entry share Today and workout detail routes. |
| P0.8 | coordinates_with | plan:progressive-plans#P4 | Native guidance hands detailed week-target authoring to the existing web Block editor. |
| P0.14 | coordinates_with | plan:progressive-plans#P6 | Active-session changes and future week targets must explain their different scopes and preserve the starting prescription. |
| P0.15 | coordinates_with | plan:progressive-plans#P6 | Block setup, week editing and retained web drafts share the same versioned plan. |
| P0.7(b) | gated_by | external:owner-lifting-release-and-device-acceptance | Repository and simulator evidence do not establish distribution or physical accessibility acceptance. |
| P0.2(b) | gated_by | external:owner-live-workout-verification | Authenticated session-swap and workout behavior still need a connected client/device; the build-44 internal-release exception does not claim these checks passed. |
| P1 | coordinates_with | plan:workouts-and-multi-session#P0 | Both touch `workouts` columns and serializers; whichever lands second rebases onto the other's migration. |
| P3 | coordinates_with | plan:progressive-plans#P4 | Both change the coach's planning tools; a one-time copy takes its date's block-week targets. |

Freestyle sessions and save-as-workout will supply more logged evidence to the
completed coaching context.

## Next step

**Now (@agent):** Qualify `codex/lifting-core-ux` in the public repository and
hand its PR to the owner for merge. It implements P0.14 (extra grouped rounds
and scoped rest changes) and P0.15 (unfinished block setup and workout details).
These phases remain open until exact-head qualification and repository delivery.
Coordinate
with [progressive plans P6](../progressive-plans/plan.md) and
[coach-free planning P2](../coach-free-planning/plan.md). These are the owner's
selected core UX priorities, ahead of shared ending/invitation recovery.

P0.7(a) and P0.8–P0.13 are delivered in the source inherited by the public
repository. Accurate shared exercise instructions are also delivered; their
remaining physical trial belongs to [partner training](../partner-training/plan.md).
Earlier exclusions for grouped rounds, new-block drafts and native week targets
now have explicit phases; they are no longer an untracked “later” bucket.

**Next (@owner):** P0.2(b), P0.7(b) and the one-date P3 device check remain
acceptance work on a matching, separately authorized release. Repository tests,
synthetic screenshots and beta availability do not establish physical or
VoiceOver acceptance. Historical live-verification exceptions permitted the
recorded distributions; they neither claim those checks passed nor create a new
release gate or release authorization. Reconcile the actual candidate with the
[App Store plan](../app-store-submission/plan.md) and
[multi-session rollout](../workouts-and-multi-session/plan.md).

Release constraints remain: the compatible API must precede clients that send
reviewed replacement targets; do not retry an older Worker's rejection with an
unreviewed legacy swap. Metadata and freestyle migrations were previously
released; do not repeat them or roll back to a pre-metadata writer that omits
those fields. Retained historical PR references document source delivery, not
the current production version. Nick merges; the standing local-review override
applies to this work, with all required checks tied to the exact head.

## Notes / open questions

- Exact-record handoff previously showed an intermittent “Couldn’t load this
  workout record” failure during qualification. The final earlier run passed,
  but the proposed concurrent-refresh explanation was not established. Keep
  account/session/attempt/set checks fail-closed; reproduce and diagnose any
  recurrence before claiming a fix.

- The September 18 follow-up selects P0.5(a)/(b) as the first SensAI-inspired
  implementation candidates, followed by P0.5(c). The owner subsequently
  activated P0.5(a), then P0.5(b), ahead of P1, and authorized their combined
  internal TestFlight distribution with the recent UI fixes. The October 6 request
  activated P0.5(c); the owner chose to retain existing images and receive separate
  replacement recommendations. On October 11 the owner approved Workout Guide
  drawings after a side-by-side trial, activating P0.5(d). Client distribution, production deployment and
  App Review/public-release authority remain separate decisions. The evidence
  note distinguishes observed competitor behavior from untested coaching quality.

- Source: owner observation (2026-09-05) that everything in the app is framed
  around the routine or block day, which is too rigid for travel and ad-hoc
  adjustment. The backend already treats days as reusable and the schedule as
  optional; the gap is presentation plus tags, archive, and freestyle.
- Rejected: a second workout table beside the old `day_templates` store. It would fork
  the versioned tree, force every editor and MCP tool to handle two shapes,
  and break `set_logs.template_exercise_id` history for one of them.
  The renamed `workouts` table is the same library.
- P3 updates the one-off-edit note below: a change to one date made before
  the workout starts now creates a dated copy that never joins the library.
  The in-runner swap (P0.2) stays session-scoped. Rejected for P3: per-date
  target overrides on the reusable workout (they can't add, remove or
  reorder exercises, and they add a second place targets come from) and
  copying into the library (the library fills with one-day clutter).
- Open (P3): one-time workouts stay in the plan tree after their date. The
  coach and the app show only the last week onward; a cleanup that removes
  old ones with no logged sets can follow if the tree grows.
- P0.2 updates the earlier one-off-edit decision in response to the owner's
  2026-09-12 unavailable-machine request: the active runner substitutes a single
  slot for that session attempt. It stores slot snapshots on the session,
  without creating library workout copies. The library editor still edits the
  reusable prescription; freestyle (P2) remains separate.
- Open: whether `archived_at` should also apply to `template_exercises`
  (retire a slot without detaching history). Defer until a member asks;
  delete-with-detach exists today.
- Open: freestyle sessions and group feeds. A freestyle session has no
  template name for `get_group_feed`; show "Freestyle · N exercises" and
  revisit with `group-experience-and-governance`.
- Naming and one-session-per-date are both real constraints this plan works
  within: `day_templates` was the historical name for a reusable workout,
  and `ux_session_user_date` (migration `0029`) forbids two strength sessions
  on one civil date. Both are addressed by
  [Workouts and multi-session days](../workouts-and-multi-session/plan.md);
  The coordinated P0 delivery uses canonical workout terms while retaining
  the released aliases for the server-first rollout and compatibility cycle.
- `sessions.kind` is fixed within an attempt. The existing one-row-per-date
  model reuses empty planned/skipped dates and discarded sessions; an explicit
  start may change kind only while advancing the observed attempt and only
  when no live sets remain. Live/completed sessions cannot change kind. This
  preserves the `(user_id, date)` rule and rejects old queued set intents.
- Saving uses a dedicated transaction endpoint because ordinary `add_workout`
  cannot atomically validate the reviewed source, repoint the session and
  advance its attempt. It reuses the same plan version claim, prescription
  validation, audit and snapshot writer. Migration 0054 retains an account-
  scoped save receipt for exact retries, export and account deletion.
