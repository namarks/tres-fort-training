# docs/plans — Engineering Workstream Plans

This directory is the repository-local source of truth for the current state of
multi-phase engineering work. These plans are distinct from the workout plans
stored in D1 and edited through the product API.

The shared `/resume`, `/backlog`, and `planning-conventions` workflows read this
directory using [`.agents/resume.yaml`](../../.agents/resume.yaml). One current
workstream has exactly one bundle here, and only its `plan.md` owns live phase
state, dependencies, execution frontier, and next step.

This repository started on 2026-11-15 as a cleaned snapshot of the original,
private repository. Current plans were carried over without release receipts,
production identifiers, tester details or confidential provider material;
completed plans, release records and reviews stay in the maintainer's private
records. PR and commit references dated before 2026-11-15 refer to the original
repository. Record only information suitable for publication, and use
synthetic data for evidence.

## The contract

- Current work lives at `docs/plans/<slug>/plan.md`.
- Optional implementation material lives beside it as `spec.md`,
  `decisions.md`, `runbook.md`, `research/`, or `archive/`. Supporting files do
  not carry parallel live checklists.
- Update phase checkboxes, `Updated:`, and `## Next step` when verified evidence
  changes the workstream state. A merge alone is not deployment, observation,
  or external-closeout evidence.
- Move verified finished bundles to `docs/plans/completed/<slug>/` with
  `Status: done` and `Archived: completed`.
- Move deliberately discontinued bundles to `docs/plans/abandoned/<slug>/`
  with `Status: abandoned`, `Archived: abandoned`, the reason, and any
  successor.
- Completed and abandoned histories never enter the current backlog or an
  active initiative.

## Plan shape

Create `docs/plans/<slug>/plan.md` with this structure:

```markdown
# <Workstream title>

Slug: <slug> · Status: <status> · Updated: <YYYY-MM-DD> · Theme: <theme>

## Goal

<The observable completion outcome.>

## Phases

- [ ] **P0 — <First verifiable slice>**
- [ ] **P1 — <Later slice>**

## Execution frontier

- P0

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P1 | blocked_by | plan:<other-slug>#P0 | <Why the prerequisite is hard.> |

## Next step

**Now (@agent):** Complete P0 and record its verification evidence.

## Notes / open questions

- <Material ambiguity, boundary, or evidence requirement.>
```

Use `active`, `gated`, `paused`, or `planned` for current plans. `active` is
eligible when its dependencies are ready; `gated` names unresolved evidence or
authority; `paused` is deliberately inactive; `planned` requires explicit
activation. `done` is only a closeout transition before moving the bundle to
`completed/`.

Every top-level phase is a bold checkbox with a stable ID. Without an
`## Execution frontier`, the first incomplete top-level phase is current. Add a
frontier only when exact nested phases or multiple independent phases are
simultaneously runnable.

Dependency targets are `plan:<slug>`, `plan:<slug>#<phase>`,
`candidate:<slug>`, `candidate:<slug>#<milestone>`, or
`external:<stable-id>`. Use `blocked_by` and `gated_by` for hard readiness
edges, `coordinates_with` for shared surfaces that must not run concurrently,
and `feeds` for informational direction.

## The roadmap — current plans by theme

Plans marked **active** are current execution frontiers. Other current plans
show their exact **gated**, **paused**, or **planned** state and are not eligible
until their named authority, evidence, or activation condition is satisfied.

### Release (`release`)

- [Public contribution preparation](public-repository/plan.md) — **active**;
  make this public repository the single development repository, qualify
  hosted CI on published `main`, then archive the original only with the
  owner's authorization.
- [First App Store submission](app-store-submission/plan.md) — **active**;
  Très Fort 1.1 (70) is live on the App Store (free, US-only) as of 2026-11-09.
  1.2 with the run recorder follows its device checks. The waived device checks
  and the backend-compatibility obligation for live clients remain open.

### Coaching (`coaching`)

Close the feedback loop between what an athlete experiences and what the coach
can understand and safely change.

Completed coaching feedback loop
provides private feedback, visible/correctable plan changes and accurate training
context. Physical iPhone feedback verification
remains a separately authorized release follow-up.

- [Bring your own AI coach](bring-your-own-ai-coach/plan.md) — **gated**;
  complete real-provider verification and consumer linking. P5 plans contextual
  workout/exercise requests, with delivery chosen after a measured prototype.
  P6 lists Très Fort in Claude's Connectors Directory. P8 shortens phone setup:
  one screen and one tap to open Claude, and approval returns to Claude itself.
  P9 (done) found why Claude asked before every read: a connector added before
  the read-only labels; re-adding it fixes that.

### Gym floor (`gym-floor`)

Let a person create and execute a workout confidently, whether or not they use
AI coaching.

- [iPad workout station](ipad-workout-station/plan.md) — camera trial and large
  workout display; an opt-in iPhone link now lets the iPad's count log the
  current set instantly, with Undo. Paired-device validation and measured
  accuracy come before relying on it beyond an opt-in trial.

The selected [core lifting pass](../initiatives/gym-floor-experience.md) orders
session flexibility, unfinished programming and manual week progression. Each
linked plan owns its phase status and acceptance evidence.

- [Workout library](workout-library/plan.md) — **active**; P0.14 adds grouped
  rounds/rest changes during solo sessions; P0.15 protects new-block and
  workout-details drafts. Existing creation, history/correction, saved-group
  editing and one-time primary workouts are foundations. Live/device gates
  remain separate from repository delivery.
- [Plan over blocks and cycles](progressive-plans/plan.md) — **active**;
  blocks, per-week targets, native scheduling, run builders and the web designer
  exist. P6 brings manual week/future-target editing to the phone; P5 retains
  release and device acceptance.
- [Plan without an AI coach](coach-free-planning/plan.md) — **active**;
  P2 adds a reviewed lighter week using block targets, with explicit cycle
  scope. Standalone native event editing, training phases and remaining
  coach-only metadata edits follow.
- [Partner training on one iPad](partner-training/plan.md) — **active**;
  manual two-person training and accurate exercise instructions exist. The
  physical trial remains open; shared ending/invitation recovery follows the
  selected ordinary lifting pass. Camera counting stays separate.
- [Member activation and adherence](member-activation-and-adherence/plan.md) —
  **paused**; bounded onboarding, mixed-week setup, reminders and widget
  implementation is delivered. P4 progress empty states needs activation;
  date-only replacement of a scheduled extra remains a documented gap.
- [Workouts and multi-session days](workouts-and-multi-session/plan.md) —
  **active**; the owner retired legacy-client support. P0(c) removed old wire
  contracts and physical-schema adaptation, preserving historical data. The
  canonical Worker and internal client are released through
  build 49; authenticated workout checks
  remain gated. Ordered sessions per date (P1, #413) are merged and their
  server and web release (migration 0073) is live as of 2026-11-09; the
  test-member check and TestFlight remain.
Supersets and circuits are retained
as completed repository history: shared coach/member authoring, alternating
round execution and recovery, separate transition/round rests, and compatible
client-cache refresh are delivered. Backend migration and app/Worker releases
require separate authority.

Bodyweight training support is
retained as completed repository history: holds/catalog, signed load,
variation replacement and comparable metrics are delivered. Worker/app release
requires separate owner authority.

Gym runner depth is retained as completed
repository history: prescription fidelity, durable set corrections, loading
and timing aids, and persisted completion feedback are delivered. Migration,
Worker deployment and iOS distribution require separate owner authority.

### Connected training (`connected-training`)

Keep imported activity and private-group behavior correct before adding more
integration or social breadth.

- [Activity integration integrity](activity-integration-integrity/plan.md) —
  **paused** after P0 and P1 repository delivery: source identity/date integrity
  and immediate connect/reconnect activity sync with recovery actions. P2
  corrections/deletions is the next candidate; rollout remains deferred.
- [Group experience and governance](group-experience-and-governance/plan.md) —
  **planned**; deliver a correct feed, durable invites, lightweight reactions
  and notifications, and essential group controls.
- [Run recorder on iPhone](run-recorder/plan.md) — **active**; record
  outdoor runs in the app instead of Strava, save them to Apple Health and
  upload them to intervals.icu as files. P0's upload endpoint, P1's
  iOS 26 recorder (beta build only) and P2's Lock Screen controls and
  spoken splits are in the repository. Real runs are
  checked on the owner's iPhone. P4 adds auto-pause and a glanceable
  running display. P5 has Tres Fort keep each recorded run and its GPS
  route itself, with intervals.icu an optional copy. P6 maps runs the app
  didn't record. P7 keeps a strap's heart rate live on the run summary,
  records how far it falls one and two minutes after the stop, and shows
  the run's training load and its climb from the iPhone's barometer. P8
  puts a step's time left first on the Lock Screen and on swipeable pages
  in the recorder, with the map a swipe away P9 beeps 3-2-1 before a timed
  step ends and opens each step's cue with what to do, short for a short
  step.
- [Run detail charts](run-detail-charts/plan.md) — **active**; pace, heart
  rate and elevation charts for a run in the app and on the web, from
  intervals.icu streams read live or the route Tres Fort keeps, with a
  private heart-rate series kept for recorded runs and Apple Health and
.fit workouts. P0 to P3 (endpoint, app and web charts, kept heart rate)
  are in the repository, and P5 moves a dot along the app's route map as a
  chart is touched and opens the map full screen; P6 adds a ride's power
  and cadence charts, best efforts and time in power zones, and P7 keeps
  a ride's power series from `.fit`, Garmin and Apple Health (migration
  0074) so those rides chart power without intervals.icu. P6 and P7 are
  live on the server and web and in TestFlight 79 since 2026-11-11; P4's
  device checks remain.
- [Planned runs with pace and heart rate targets](planned-runs/plan.md) —
  **active**; the coach or the member plans runs with steps and pace or
  heart rate targets in the Tres Fort plan, and the recorder follows them
  with spoken on/off-target cues. Completed runs upload to intervals.icu
  when it is connected. P0's step format, migration 0058 and MCP tools,
  P1's display in the app with a Start run button, P2's step-by-step
  guidance while recording, P3's spoken step and target cues, P5's in-app
  step editor, P6's watch-style step layout, P7's finished run (marked
  done, a run-aware record, intervals.icu optional), P8's "New run" from
  a weekday and P9's laps for each step on the run's detail are in the
  repository; P4 is the owner's real runs.
- [Runs on Apple Watch](apple-watch/plan.md) — **paused**; the rest timer
  and run stats laid out for the Watch, planned runs sent to Apple's Workout
  app and brought back as recorded runs, then a Tres Fort Watch app that
  records runs with GPS, wrist heart rate and haptic step cues and saves them
  through the iPhone. P0's wrist layouts are in the repository. Paused
  until a member who runs with an Apple Watch can test P1 onward.
- [Real training load for endurance workouts](endurance-training-load/plan.md) —
  **active**; members set FTP, threshold heart rate and threshold pace in the
  app, and one Worker load engine gives every run, ride and swim a labeled
  power, heart-rate or pace load from Apple Health, the recorder, `.fit`
  uploads and later Garmin, keeping intervals.icu's figure when it has one.
  P0's thresholds store and engine, P1's loads on imported workouts, P2's
  thresholds screen and load display, P3's Apple Health heart-rate and
  power streams, P4's `.fit` file import, P6's effort estimate (built as
  sport-activities P2) and P7's suggestions from intervals.icu are in the
  repository; P5 is built by the Garmin plan.
- [Capture every sport properly](sport-activities/plan.md) — **active**;
  soccer, tennis, climbing, swims and every other sport land as that sport
  from Apple Health, intervals.icu, `.fit` files or hand entry, with
  heart-rate or effort load and swim detail (pool, lengths, strokes). Hand
  entries live in Tres Fort with intervals.icu as an optional copy (owner,
  2026-11-03). P0, naming every sport (migration 0064), P1, heart-rate
  load for any sport, and P2, a one-tap effort rating when there is no data
  (migration 0066), are live, and so are P4's Apple Health swim detail and
  P5, Apple Watch's effort score (migration 0072, released 2026-11-09, in
  TestFlight 76; the App Store privacy label already covers them); P3,
  logging any sport by hand, is next.
- [WHOOP data in Tres Fort](whoop/plan.md) — **active**; a direct WHOOP
  connection brings WHOOP workouts in once with a heart-rate load and
  WHOOP's strain, and each morning's recovery, HRV, resting heart rate and
  sleep onto Today, private to the member (owner, 2026-11-08). P2 and P3
  (migration 0070) shipped on 2026-11-08 with beta 1.1 (72); next, a
  WHOOP wearer tests connect, a workout, recovery and disconnect.
- [Garmin data in Tres Fort](garmin/plan.md) — **active**; a direct Garmin
  connection on the approved Starter app brings each new Garmin workout in
  once with its activity file's detail and a load, private and out of the
  coach until Garmin's terms are read (owner, 2026-11-08). P1 and P2
  (migration 0071) shipped on 2026-11-08 with beta 1.1 (73); next, the
  owner sends Garmin's launch notice and tests a run, a ride and a disconnect.

### Platform (`platform`)

- [Positioning](positioning-and-open-source/plan.md) — **active**; lead every
  surface with "Everything you train. One plan." and AI as optional.
  Repository and website copy are live (PR #296); a website refresh with App
  Store and web app links is in review; in-app copy is next and the
  App Store listing waits for the version after 1.0. The source was
  published as this repository on 2026-11-15.
- [Plan on the web](web-app/plan.md) — **active**; sign in at
  `app.tresfort.app` with the same Apple account to plan training and analyze
  trends with a big screen and a mouse. The calendar and plan editing are
  live, as is the Activity page (this week, highlights, eight weeks and the
  whole history). An Analysis section for going deep on training data is
  starting with its Overview (fitness, fatigue and form, time by week and by
  sport, against the period before) and an Event page (a goal event with a
  finish estimate and the weeks heading in); Strength, Running, Recovery and
  Records pages and settings follow. Training stays on the iPhone.
- [Reliability and service boundaries](reliability-and-service-boundaries/plan.md) —
  **active**; complete the owner-approved performance/quality follow-up to #201,
  including canonical-only clients, durable offline recovery and reproducible checks.
### Member experience (`member-experience`)

Give a member honest, private views of their own body and training trends
without adding provider accounts, server collection or new data stores.

- [App design pass](app-design-pass/plan.md) — **active**; make everyday use
  less clunky: unplanned training one tap from Today, one-tap exercise actions,
  one finish screen, fewer stacked sheets, a Plan tab, endurance logging
  without AI and one visual system. P0 to P4 are merged (PRs #287 to #291).
  P6 splits the Plan tab into Schedule (when you train) and Workouts (what
  you do) and replaces the Active/Archived toggle. P7 lets a tapped weekday
  change or become an activity. P8 renames Progress to Activity, with a
  History of past workouts, runs and logged activities beside the Progress
  cards. P11 tidies Today into three cards: today, this week, coming up.
  P12 fixes the iPad gaps: Today and Activity no longer stretch, the iPad
  workout screen marks where you are in orange, and the route map sits
  beside its charts in landscape. P13 makes planning on the Plan tab quick:
  the week says what each day holds, and one Add sheet puts a run, lift or
  sport on any days, so a 3-mile run every Wednesday is four taps. P14
  lets a day hold activities beside its workout, such as morning
  stretching, shown on the week, the day and Today. P15 makes Today's This
  week fort open the Activity tab and moves the Calendar link to Coming up.
  P16 lists several things on Today in order: what's next leads the card,
  the rest wait under Later today, and finished items shrink to a check.
  P17 shows a brand's own logo in Connections where its terms allow,
  starting with the Garmin Connect tile and the Apple Health icon.
  P21 makes a tapped date list its activities too, such as core beside
  soccer, with any time set for them. P22 sets a time on every day an
  item is on at once and adds an evening Still to do nudge for untimed
  plans not yet done, which a member can turn off. P23 puts route
  previews on a small map, keeps those cards in All history, stops the
  Last 8 weeks dates and hour marks from colliding, and adds mile or
  kilometer splits to every run with a distance track. P24 adds Ride,
  Swim and At home (core, stretching or bodyweight routines with
  exercises) to the Add sheet, a time while adding, and tiles that are no
  longer cut off, renames Activity to Other, and puts the member's most
  frequent kinds first, with the Add button pinned in view. It is in
  TestFlight 79; an owner device check remains. P26 makes the list under
  the calendar follow the month it shows, in the order each day happened,
  with distance and pace, after a tester's years of Apple Health rides
  read as one unordered list.
- [Progress and Apple Health weight](apple-health-weight/plan.md) — **gated**;
  the private weight view and Progress tab are merged and included in internal
  TestFlight build 42. Owner verification on a real iPhone with Health readings
  remains. P5 makes Progress lead with a consistency streak and day grid.

### Review-driven ordering

The September app review recommends
coach-access and prescription integrity, runner prescription fidelity, and
feedback before more authoring depth. Comparable metrics, accessible journeys
and repeatable iOS checks complete that foundation. Library P0 remains a small
independent presentation improvement; storage/wire rename, multiple sessions
and engagement features follow their existing decisions and demonstrated need.
This order does not activate planned work or replace canonical phase readiness.

### SensAI follow-up ordering

The September 18 hands-on comparison
selects six improvements within existing plans. Start with library P0.5(a)/(b):
shared exercise technique/history and consistent exercise/swap filtering. Next
consider P0.5(c) preview thumbnails and member-activation P3 upcoming sessions,
then P4 progress empty states. Evaluate BYO-coach P5(a)'s contextual request
prototype separately before choosing P5(b)'s delivery architecture.

The owner subsequently activated library P0.5(a), the shared Technique / History
sheet, ahead of tags/archive, and then P0.5(b) shared search/filter behavior.
P0.5(a)/(b) are merged and shipped in internal TestFlight 1.0 (43), with exact
source and Apple evidence in the release record. The other new slices remain planning
approval only; canonical frontiers and release gates remain authoritative. Already
delivered runner, swap, catalog, starter and progress capabilities are reused.

## Completed foundations

App quality and maintainability
provides reproducible current-iPhone CI, basic usability improvements, measured
history indexes and lossless large-cache persistence. Repository completion is
separate from production or app distribution.


Training Data Trust is
complete after reviewed service/TestFlight delivery and the coordinated live
canary. Its retained prescription integrity,
reversible plan management, and
coach access integrity contracts
support the current plans. The evidence distinguishes deterministic tests,
production activation, observed client paths and bounded legacy assessment.

## Adding a workstream

Create a plan only when a multi-step workstream has a real owner, observable
completion evidence, and a safe next action. Keep unselected ideas in their
existing design or issue system rather than seeding dormant plans that will
rot. After creating or changing a plan or initiative, run the shared
`planning-conventions` compiler's `check` command from the repository root.

Cross-plan missions live in [`docs/initiatives`](../initiatives/README.md).
An initiative selects and orders canonical plan nodes; it never copies their
status or phase checkboxes.

The following remain candidates or design references, not current plans:

- **Lifting on Apple Watch** — logging sets from the wrist and a Today
  complication, after [runs on Apple Watch](apple-watch/plan.md). Promote
  when a member trains with an Apple Watch and wants it.
- **Custom exercises** — promote when catalog gaps create observed workout
  failures that aliases or the existing catalog cannot solve. The
  gymnastic-strength seed in `bodyweight-training-support#P0` is the first
  answer to catalog gaps; promote only for movements a seed cannot anticipate.
- **Bodyweight tracking** — promote with a specific coaching or progression
  decision that needs the data, not as an isolated metric store. The one
  identified need is true tonnage for weighted or assisted bodyweight work;
  the rep-based metrics in `bodyweight-training-support#P1` cover the coaching
  decision without it, so it stays deferred.
- **M5 endurance write bridge** — retain the conditional design in
  `MULTISPORT.md` and its
  M0 spike; do not activate planned-endurance
  writes until the existing provider and product-value gates are satisfied.
