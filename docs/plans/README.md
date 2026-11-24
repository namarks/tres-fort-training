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
plans completed before then, release records and reviews stay in the
maintainer's private records. Plans finished here move to
[`completed/`](completed/). PR and commit references dated before 2026-11-15 refer to the original
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

- [Public contribution preparation](public-repository/plan.md) — **gated**;
  this repository is the single development repository, published `main`
  passed the full hosted release check, and the owner archived the original
  on 2026-11-16. Left: the first outside fork PR and confirming an official
  build carries the licensed artwork.
- [First App Store submission](app-store-submission/plan.md) — **active**;
  Très Fort 1.1 (70) is live on the App Store (free, US-only) as of 2026-11-09.
  1.2 waits for the run recorder (owner, 2026-11-16); TestFlight 1.2 (83) is
  with testers. The waived device checks and the backend-compatibility
  obligation for live clients remain open.

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
  P6 lists Très Fort in Claude's Connectors Directory (submitted 2026-11-08).
  P4 lists it in ChatGPT's directory (demo video and submission left). P8
  shortens phone setup: one screen and one tap to open Claude, and approval
  returns to Claude itself (device check on TestFlight 83).
  P9 (done) found why Claude asked before every read: a connector added before
  the read-only labels; re-adding it fixes that. P10 connects Claude with one
  approval: Allow in the app hands Claude a one-time connect link, so Claude
  comes back connected with no Très Fort page (Worker release and iPhone check left).

### Gym floor (`gym-floor`)

Let a person create and execute a workout confidently, whether or not they use
AI coaching.

- [iPad workout station](ipad-workout-station/plan.md) — **gated**; camera
  trial and large workout display; an opt-in iPhone link lets the iPad's
  count log the current set instantly, with Undo, and a linked iPad can move
  the iPhone's workout. The owner's paired-device trial and measured accuracy
  come before relying on it beyond an opt-in trial.

The selected [core lifting pass](../initiatives/gym-floor-experience.md) ordered
session flexibility, unfinished programming and manual week progression; public
PR #9 delivered it on 2026-11-16 and the 2026-11-17 releases carry it. Each
linked plan owns its phase status and acceptance evidence.

- [Workout library](workout-library/plan.md) — **gated**; P0.14 (extra
  grouped rounds and rest changes during solo sessions) and P0.15 (new-block
  and workout-detail drafts) are delivered and released. Creation,
  history/correction, saved-group editing and one-time workouts are
  foundations. The owner's device acceptance (P0.2(b), P0.7(b)) remains.
- [Plan over blocks and cycles](progressive-plans/plan.md) — **gated**;
  blocks, per-week targets, native scheduling, run builders, the web designer
  and P6's week targets from the phone are delivered and released. P5 is the
  owner's check on the phone, web, Today and calendar. P7 (in review) lets
  the iPhone keep a block's own workouts beside Your week, as the web does.
- [Plan without an AI coach](coach-free-planning/plan.md) — **active**;
  away dates, P2's reviewed lighter week and P1's iPhone event editor are
  built. Next, P1's training phases, then P3's remaining coach-only edits.
- [Partner training on one iPad](partner-training/plan.md) — **active**;
  manual two-person training and accurate exercise instructions exist. The
  physical trial remains open; P0.2, shared ending and invitation recovery, is
  the next lifting candidate now that the core lifting pass has landed.
  Camera counting stays separate.
- [Member activation and adherence](member-activation-and-adherence/plan.md) —
  **paused**; bounded onboarding, mixed-week setup, reminders and widget
  implementation is delivered. P4 progress empty states needs activation;
  date-only replacement of a scheduled extra remains a documented gap.
- [Workouts and multi-session days](workouts-and-multi-session/plan.md) —
  **gated**; the owner retired legacy-client support. P0(c) removed old wire
  contracts and physical-schema adaptation, preserving historical data.
  Ordered sessions per date (P1) are live on the server and web (migration
  0073, 2026-11-09) and in TestFlight 1.2 (83); the test-member check remains.
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
  keep them in Tres Fort with their route, with intervals.icu an optional
  copy. P0 to P2 (upload, recorder, Lock Screen and spoken splits), P5's
  kept runs and routes, P6's maps for other runs, P7's summary and heart
  rate recovery and P8's time left in the step are in TestFlight 1.2 (83).
  P4's quicker auto-pause and P9's 3-2-1 beeps and short step cues merged on
  2026-11-18 and need the next TestFlight build and one interval run with
  stops and music. App Store 1.2 waits for this.
- [Run detail charts](run-detail-charts/plan.md) — **gated**; pace, heart
  rate and elevation charts for a run in the app and on the web, the map
  following the chart, and a ride's power, cadence, best efforts and time in
  zones, kept for `.fit`, Garmin and Apple Health rides. P0 to P3 and P5 to
  P7 are released and in TestFlight 1.2 (83). P8 (keep intervals.icu rides'
  streams, so Zwift rides keep their charts) is released (2026-11-19); P4's
  device checks remain, then this plan is archived.
- [Planned runs with pace and heart rate targets](planned-runs/plan.md) —
  **active**; the coach or the member plans runs with steps and pace or
  heart rate targets in the Tres Fort plan, and the recorder follows them
  with spoken on/off-target cues. P0 to P3 and P5 to P9 (format, app
  display, guidance, cues, step editor, watch-style layout, finished run,
  "New run" from a weekday, laps per step) are released and in TestFlight
  1.2 (83). P10, changing a day's run from its details, merged on
  2026-11-18 and needs the next TestFlight build; P4 is the owner's
  interval runs.
- [Tres Fort on Apple Watch](apple-watch/plan.md) — **active**; a Watch
  app with Today and a complication (P4), then lifting from the wrist: the
  Watch drives the iPhone's runner the way a linked iPad does (P5). Runs on
  the wrist follow: planned runs sent to Apple's Workout app, then a Watch
  recorder with GPS, wrist heart rate and haptic step cues (P1 to P3),
  gated on a member who runs with an Apple Watch. P0's wrist layouts are in
  the repository, and so is P4: the Watch app with Today on the wrist, the
  complication and its build in CI, and P5: the set on the wrist with Log,
  the crown and the rest, and Start from the wrist. TestFlight build 1.2
  (87), uploaded 2026-11-24, is the first that carries the Watch app. A
  lifting workout on a real Watch (P6) waits for a member with one. The
  Watch app has its own project spec: a TestFlight build carries it only
  when asked, and App Store builds never do.
- [Capture every sport properly](sport-activities/plan.md) — **active**;
  soccer, tennis, climbing, swims and every other sport land as that sport
  from Apple Health, intervals.icu, `.fit` files or hand entry, with
  heart-rate or effort load and swim detail (pool, lengths, strokes). Hand
  entries live in Tres Fort with intervals.icu as an optional copy (owner,
  2026-11-03). P0, naming every sport (migration 0064), P1, heart-rate
  load for any sport, and P2, a one-tap effort rating when there is no data
  (migration 0066), are live, and so are P4's Apple Health swim detail and
  P5, Apple Watch's effort score (migration 0072, released 2026-11-09, in
  TestFlight 76 and later; the App Store privacy label already covers them);
  P3, logging any sport by hand, is next.
- [WHOOP data in Tres Fort](whoop/plan.md) — **active**; a direct WHOOP
  connection brings WHOOP workouts in once with a heart-rate load and
  WHOOP's strain, and each morning's recovery, HRV, resting heart rate and
  sleep onto Today, private to the member (owner, 2026-11-08). P2 and P3
  (migration 0070) shipped on 2026-11-08; connect was fixed on 2026-11-14
  and works end to end. Next, an active WHOOP wearer checks a workout,
  recovery and disconnect.
- [Garmin data in Tres Fort](garmin/plan.md) — **active**; a direct Garmin
  connection on the approved Starter app brings each new Garmin workout in
  once with its activity file's detail and a load, private and out of the
  coach until Garmin's terms are read (owner, 2026-11-08). P1 and P2
  (migration 0071) shipped on 2026-11-08 and the launch notice was sent;
  members get Garmin no earlier than 2026-12-08. Next, the owner tests a
  run, a ride and a disconnect.

### Platform (`platform`)

- [Positioning](positioning-and-open-source/plan.md) — **gated**; lead every
  surface with "Everything you train. One plan." and AI as optional.
  Repository, website and in-app copy are done, and 1.1 shipped the new
  subtitle and keywords; the App Store description comes with 1.2. The
  source was published as this repository on 2026-11-15.
- [Plan on the web](web-app/plan.md) — **active**; sign in at
  `app.tresfort.app` with the same Apple account to plan training and analyze
  trends with a big screen and a mouse. The calendar, plan editing, the
  Activity page and the Analysis Overview, Event and Strength pages are live.
  The Plan page's tabs, the repeating week as its first row and a training
  block beside it with its own Block tab were released on 2026-11-17, and the
  guided block start and adding to a day by type (public PR #13) on
  2026-11-19. A three-step first-run setup and a Settings page that connects
  intervals.icu and WHOOP and manages AI coach access are in review.
  Running, Recovery and Records pages follow. Training stays on the iPhone.

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
  read as one unordered list. P27 makes Add to your week read top down,
  and P28 changes the weekday sheet in place instead of opening a new page.
  TestFlight 1.2 (83) carries everything through P27; P28 merged on
  2026-11-18 and needs the next build.
- [Progress and Apple Health weight](apple-health-weight/plan.md) — **gated**;
  the private weight view and Progress tab are in TestFlight (build 42 and
  later, 83 current). Owner verification on a real iPhone with Health
  readings remains. P5 makes Progress lead with a consistency streak and day grid.

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

[Real training load for endurance workouts](completed/endurance-training-load/plan.md)
gives every run, ride and swim a labeled power, heart-rate, pace or effort
load from one Worker engine and the member's thresholds, across Apple Health,
the recorder, `.fit` files and Garmin (completed 2026-11-18).

[Reliability and service boundaries](completed/reliability-and-service-boundaries/plan.md)
delivered the follow-up to original PR #201: consistent workout edits,
cohesive service and runner-recovery boundaries, certified offline start and
the canonical cutover (completed 2026-11-18).

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
