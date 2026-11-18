# Member Activation and Adherence

Slug: member-activation-and-adherence · Status: paused · Updated: 2026-11-18 · Theme: gym-floor

## Goal

Help a newly signed-in or invited member reach a real first workout and return
for the next one without requiring Claude. Done means entry intent survives
authentication, the no-plan state offers honest manual and coach-assisted
paths, and lightweight schedule-based reminders bring the member back to the
correct workout. A member can also see the next few sessions and understand
how to populate an empty progress view without needing another setup flow.

## Phases

- [x] **P0 — Reach the first workout**
  - Preserve invite and Coach Connect intent through sign-in, then return the
    member to the intended group or setup action instead of a generic home
    screen.
  - Keep the shipped manual-builder CTA and add a direct coach setup choice.
    Explain both paths and allow either one to be completed later. Reconcile
    signed-out/onboarding/Profile copy: independent and invited members already
    have personal Coach Connect; do not say it is coming soon or that a group
    owner's coach controls another member's plan.
  - Distinguish a verified empty account from initial read failure and cached
    stale state. A cold offline/500 response must offer retry without claiming
    that the member has no plan or encouraging a duplicate replacement.
  - Keep pending invite/coach intent across sign-in and onboarding. Bind async
    step completions to the step that started them so a delayed result after
    Skip cannot advance a different step. Verify owner, invited, independent,
    manual-only and coach-connected entry with the shared synthetic fixtures.
  - Verify the invite, manual, and coach-connected paths through focused
    end-to-end walkthroughs from entry to first completed workout; fix concrete
    breaks without adding an activation analytics system.
  - Owner direction (2026-11-09): Nick wants to walk through new-member setup
    on his own iPhone, where Sign in with Apple always returns his own
    account. TestFlight builds give the owner (only) "Try setup as a new
    member" in Profile > Account: the Worker creates a fresh, empty test
    account (`POST /api/me/test-member`, 404 for anyone but the owner, at most
    one at a time), the app parks the owner's session in the Keychain and
    shows real setup, and "Back to my account" (a banner on every screen)
    deletes the test account (`DELETE /api/me/test-member`, test members only)
    and restores the owner. No schema change. This is a verification tool for
    the walkthroughs above; it does not reactivate the paused plan.
- [x] **P1 — Return for the next workout**
  - Offer opt-in local reminders derived from the existing recurring schedule
    and deep-link each reminder to the correct Today workout.
  - Add a compact Today widget using the same projection and refresh it after
    schedule, skip, completion, or sign-out changes.
  - Keep notification timing and copy editable in app settings; do not require
    a new server notification system for the initial adherence loop.
  - Owner activation (2026-10-11): Nick chose this slice first from the
    smoothness recommendation thread.
  - Delivered on iPhone and iPad with no backend change. The app builds a
    14-day display snapshot from the shared projection (`SyncModel`
    `trainingAgendaSnapshot`), so scheduled, dated, skipped, trip, started and
    completed days match Today and the calendar. It is written to the
    `group.com.nmarkspdx.tresfort` App Group for the widget and drives local
    reminders; both refresh after each published plan/session change, a new
    civil day, a time-zone change and a settings change, and are cleared at
    every account boundary (sign-out, expiry, deletion).
  - The widget (small, medium, Lock Screen rectangular and inline) shows
    today's workout, or for a rest/skip/trip day the next workout, with one
    timeline entry per civil day; a tap opens Today through the navigation-only
    `tresfort://today` link. Profile > Reminders turns reminders on (asking for
    notification permission once) and sets one local time. A reminder fires
    only on a day whose workout has not started; rest, skipped, trip, started
    and finished days stay quiet, and tapping it opens Today. Copy is fixed
    rather than member-editable; the editable setting is the time.
  - Verification: unit tests for the snapshot, reminder plan (including
    daylight saving), notification replacement and sign-out ordering, widget
    timeline, storage and link parsing; the packaging test requires the App
    Group on both shipping variants. Exact-head CI on the delivering PR is the
    merge gate. Seeing the widget and a delivered reminder on a physical
    device is part of the next owner TestFlight check; the first signed
    archive registers the new App Group through automatic signing.
- [x] **P2 — Deliver a useful starting point**
  - [x] **(a) Training profile and starter workout**
    - Brief, optional setup captures overall goals; all intended activities
      (weightlifting, running, swimming, cycling, walking, yoga and other);
      optional weekly activity context; lifting experience; realistic strength
      time/frequency; equipment; and movements to avoid.
    - Optional recent working sets retain exercise, weight/unit, reps, effort,
      and date. These are user reports, not verified strength or prescriptions.
      Beginners never need a maximum test or a weight estimate.
    - Preview a small curated starter collection filtered by equipment and
      excluded movements. Acceptance creates an editable library workout through
      the shared versioned plan path, never replaces an existing library, and
      is safe to retry after an uncertain response.
    - Keep the account-owned profile independent of plan replacement. Expose it
      in the coach brief/current-plan response and portable export, exclude it
      from group views, and remove it with permanent account deletion.
    - Offer the questionnaire before generic group/integration setup and from
      verified-empty Today. Profile remains editable; interrupted drafts stay
      in the existing protected account-scoped local store.
    - Verify mixed-sport and skip paths, first-workout completion, account
      boundaries, stale saves, transactional rollback, retries and readable
      layouts. Consistency is the guiding message; starters do not prescribe or
      schedule endurance sessions from activity selections alone.

- [x] **P3 — See the next few sessions in context**
  - Planning approved from the SensAI inspection;
    this paused plan is not reactivated. Prototype a compact next-few-sessions
    section in Today with a route to Calendar, preserving Start/Continue as the
    primary action. Adopt it only if task walkthroughs show easier orientation
    without obscuring today's workout or duplicating the full calendar.
  - Reuse the existing calendar projection and available planned endurance
    context. Distinguish strength, endurance and rest, as well as scheduled
    versus completed/imported activity. Missing endurance data stays unknown;
    past imported activity must not be invented as a future ride/run.
  - Preserve local civil dates, dated overrides, skips, trips and completed or
    in-progress sessions. Use one projection, not a new schedule store. Reminders
    and widgets (P1) are independent; multiple sessions per day are not required.
  - Verify a member can identify the next strength session and its relationship
    to a known ride/run from this view. Cover no schedule, stale/offline data,
    mixed activity, date boundaries and large text; open the intended date and
    session. If multi-session P1 lands first, show all relevant slots using its
    contract rather than silently displaying only the primary session.
  - Owner direction (2026-10-04): Today hosts this week's Monday–Sunday strip,
    in the calendar's own day cells, and up to three upcoming days with a
    workout or planned ride/run. Any day opens the existing date sheet. The
    separate Calendar tab is removed; the full month grid and past records are
    pushed from Today's "Calendar" link and no longer condense on scroll.
    Progress keeps its Strength, Consistency chart and Weight cards unchanged.
  - Delivered with one forward scan (`upcomingDays`) over the shared
    projection: hard blackouts suppress planned endurance, skipped/completed
    dates are not upcoming, and a missing cached template still shows its
    date. Multi-session P1 has not landed, so one session per date applies.
    Verification: a model test for the scan, and calendar, weekly-schedule,
    progress, Intervals and screenshot journeys rerouted through Today;
    exact-head CI on the delivering PR is the merge gate.
  - Owner direction (2026-10-11): Today keeps today's workout, Workouts and
    the week in front. Start freestyle, Log an activity and Train together
    are rarely used, so they move into a "+" menu in Today's navigation bar;
    an unfinished partner lane keeps its visible "Partner workout setup" row.
    The week strip pages sideways through this week and the next seven,
    opening on this week; its header names the week shown and offers a way
    back. Verification: unit tests for the week pages and titles, and the
    freestyle, activity and partner journeys opened through the menu.
- [ ] **P4 — Make empty progress views actionable**
  - Keep first-use copy compact: explain what strength/consistency data will
    appear and offer a relevant route to the scheduled workout, existing library
    or starter entry. Navigating there must not start or log a workout itself.
  - Distinguish verified empty history from loading, failure and stale data.
    Imported endurance activity remains separate from completed Très Fort
    strength sessions; optional Health weight has its own permission/availability
    state and must not suggest lifting will populate weight measurements.
  - Verify new, imported-activity-only and returning members understand why the
    view is empty and how to populate it. Cover retry and account changes with
    the existing progress/read models. Avoid new streak infrastructure, analytics
    storage or large motivational cards.

- [x] **P5 — A short setup that ends on your week**
  - Owner direction (2026-11-10): the questionnaire felt tedious, most of its
    answers changed nothing without a coach, and a new member does not want to
    start a workout right after downloading the app, nor a generic ready-made
    one. Nick picked option B from the mock kit, then dropped starters and the
    equipment question. This is an owner-directed slice; it does not reactivate
    the paused plan or P4.
  - Onboarding is now the welcome only. "Get started" queues an in-app setup
    entry (`MemberEntryIntent` `.setup`), behind any pending invite or coach
    link, and lands in the app. Setup is two optional steps: "Your usual
    week" (the Plan tab's own week rows, Add to your week composer and weekday
    sheet; a lift picks its own exercises) and "Connect your apps" (the
    Connections rows: Apple Health, intervals.icu, Garmin, WHOOP, plus an
    optional AI coach row). It ends on Today and never opens a workout. The
    empty plan is made only when the member first adds something; skipping
    creates nothing.
  - What the member plans changes the product: a plan with runs, rides or
    swims lists Garmin and intervals.icu first, otherwise Apple Health; Today's
    Run quick start shows only when the plan has a run or no workouts yet.
    Empty Today offers "Plan your week", "Create a workout"
    and "Set up my coach", and no starter workout.
  - The P2(a) questionnaire moves out of onboarding into Profile > Training
    profile, where it informs the coach; it no longer previews starters. The
    starter API and the app's acceptance recovery stay for earlier builds. No
    server change, migration or deploy; delivery is an app build.
  - Verification: unit tests for setup ordering, relaunch and the entry queue,
    and for the plan reads that reorder sources; UI journeys for setup through
    Today, invite and coach ordering, reopening from empty Today and skipping
    without writes run in the nightly release check. Exact-head CI on the
    delivering PR is the merge gate.

- [x] **P6 — Plan a run with separate timed core**
  - Owner direction (2026-11-12): fix the web calendar and first-run workout
    navigation first, then simplify setup for a run plus separate timed core.
    This bounded follow-up does not reactivate P4 or the paused workstream.
  - First-run weekday View opens that workout on the setup navigation stack;
    Back returns to the week. Extras have their own View action. Viewing or
    finishing setup never starts a workout.
  - Add something alongside opens At home. The member reviews sets or rounds,
    work/hold durations, reps and rests before saving, with explicit choices
    for circuits and timing every exercise. Core or Stretching entered under
    Other offers guided timers or an explicit log-only choice.
  - A complete routine saves atomically through `POST /api/workouts/prescribed`,
    sharing the existing partner prescription writer but using its own audit
    and retry namespace. Frozen workout/slot IDs make uncertain replies safe
    to retry. Scheduling retains the saved ID and retries independently, so a
    schedule failure cannot create another workout. Run and core retain their
    own scheduled times, targets and completion records.
  - Verification covers program weeks and primary/extra calendar rows on web;
    prescription validation, atomicity and retry on real D1; iOS request/ACK
    and account boundaries; and setup journeys through a timed mixed week,
    extra preview, schedule retry and Today. Exact-head review and CI remain
    required before repository delivery.
  - Release order: deploy the API Worker before distributing the updated iOS
    client; deploy the web bundle for calendar fixes. No migration is added.
    Production deployment and client distribution need separate authorization.
  - PR #444 merged on 2026-11-12. The next authorized audit slice
    continues in [web app P2](../web-app/plan.md): guided run/home creation,
    separate workouts and times in the ordinary week editor, and a concrete
    iPhone handoff. The new web bundle also needs the updated API account
    identity response and account-bound read/write guard before deployment.
  - PR #445 merged on 2026-11-12, completing that web slice.
    The next explicitly authorized mobile follow-up keeps planning reachable
    from empty Plan > Schedule and from Today with saved but unscheduled
    workouts. Opening the week is read-only; only an explicit Add/day tap
    bootstraps a missing plan. Today opens the composer directly, with Saved
    selected when the member already has reusable workouts.
  - Saving a time is now separate from enabling notifications. The composer
    and weekday time sheet show current permission, explicit Enable reminders,
    denied-permission Settings recovery, and retryable request failure.
    Permission changes reapply unchanged timed schedules without changing
    account reminder preferences. Regular exercise, round and transition rest
    editors accept exact integer seconds from 0 to 3,600 and preserve an
    unchanged larger saved rest; invalid input blocks Save, Cancel preserves
    the saved value, and grouped edits preserve inactive
    individual rests. No API change, migration, deployment or distribution is
    part of this mobile follow-up.
  - PR #446 merged on 2026-11-12, completing mobile setup
    reachability, reminder permission feedback and exact rest editing.
  - Owner direction (2026-11-12): continue with connection discovery during
    setup, then the signed-out experience. The apps step explains that all
    connections are optional, shares device-to-source guidance with Profile,
    and keeps a visible way to finish without connecting. Provider rows
    distinguish checking, unavailable configuration and failed status reads;
    existing authorization, permission, retry and source-ordering flows remain.
  - Native and web entry explain week-first planning, including a run with
    separate timed core. Native Apple sign-in precedes optional coach setup;
    pending invites are described in their actual entry order. Web explains
    account creation and continuity, with execution and timers in the iPhone
    app. No new onboarding step, provider integration or release authority is
    introduced.
  - PR #452 merged on 2026-11-13, completing connection
    discovery and signed-out entry. This is repository delivery, not a release.

- [x] **P7 — Review and use the mixed week**
  - Owner direction (2026-11-13): finish the remaining audit recommendations.
    This bounded slice preserves the separate P4 gate.
  - Today combines the primary workout, separate runnable workouts and
    log-only activities in one time-ordered agenda. Each row retains its
    own action and completion; the selected workout's runner stays below it.
  - Native and web routine review show the actual set/round and rest sequence.
    Duration counts configured countdowns and rests, omits the final rest,
    and explicitly leaves rep pace and manual pauses unknown. Previewing
    neither starts a session nor logs sets.
  - Once a recurring week exists, optional guidance leads to the existing
    block planner and saved workout targets. Exploring either is read-only;
    setup gains no additional required step or automatic progression policy.
  - Web date-only editing follows the existing primary-workout copy contract,
    preserving block-week targets and a frozen retry ID before assignment.
    The scope chooser distinguishes that date from the saved workout. A
    scheduled extra cannot yet be replaced for one date: that requires a
    shared replacement/lineage contract so the original extra does not
    reappear. Extras explicitly retain saved-workout edit scope.
  - No migration, production deploy or client distribution is part of this
    slice. Physical-device reminder/widget checks and new-user observation
    remain release/acceptance work.
  - PR #453 merged on 2026-11-13. Backend/web suites, native
    unit tests, real-D1 browser journeys and all six targeted native UI
    journeys passed. The PR records exact-head independent review and CI.

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P4 | gated_by | external:owner-sensai-followup-implementation | Planning approval does not reactivate implementation in this paused workstream. |
| P3 | coordinates_with | plan:workouts-and-multi-session#P1 | Whichever lands second must consume the same date/session projection contract. |

## Next step

**Now (@owner):** On TestFlight 1.2 (83) or later, try new-member setup from Profile > Account: Get started; plan a mixed week,
connect an optional app, reach Today and return with “Back to my account”.
Verify reminder permissions and the Today widget on a real device. The bounded
onboarding implementations P0–P3 and P5–P7 are in the public source; no old
private-branch merge request remains. Source and synthetic checks are not
new-user observation or physical acceptance.

P4 actionable progress empty states remains paused pending owner activation.
The selected core lifting work is tracked in
[Gym-Floor Experience](../../initiatives/gym-floor-experience.md), rather than
reactivating this entire workstream. Replacing a scheduled extra for only one
date remains the explicit P7 follow-up requiring a shared lineage contract.
Migration, production deployment and client distribution need separate authority.

## Notes / open questions

- The September 18 usability follow-up routes an acknowledged starter directly
  to that saved workout's details, with an explicit Start action. It applies to
  first-run setup and starter selection from empty Today. Existing invite and
  coach destinations retain their order; optional group, integration and coach
  setup remain available in Group/Profile. The route stays account-bound,
  refreshes before enabling Start, and never chooses a different workout when
  the saved identity is unavailable. Setup copy is shorter while equipment,
  exclusions, optional baselines and privacy information remain available.
  This refines P2(a); it does not activate P1 or authorize distribution.
  PR #210 merged on 2026-09-18
  with the focused verification and exact-head review.
- On 2026-09-12 Nick approved the questionnaire plus editable starter approach
  and explicitly requested an overall-fitness activity question. This resolves
  `external:starter-plan-policy` for P2(a). The initial scope emphasizes new and
  returning lifters, includes optional experienced-lifter inputs, and uses
  curated deterministic starters with future connected-coach personalization.
- P2(a) verification covers tenant isolation, profile version conflicts and
  retries, MCP context without a plan, export/deletion, transactional starter
  creation, historical receipt replay, both workout database layouts, and
  already accepted starters after library deletion. The iOS suite passed 548
  unit tests (one existing skip) before recovery refinements; subsequent focused
  runs passed eleven profile-model checks, three empty/session-state checks, and
  journeys covering mixed-sport entry
  through first completion, optional working sets, and skip from absent/empty
  plans. Synthetic screenshots were inspected for readable labels and reachable
  actions. Account refresh fires on acknowledgement even after sheet dismissal;
  a definite conflict retires pending intent so profile editing remains usable.
  Reopening identical server answers after a lost save reply adopts the server
  version before another edit, including normalized selection order/whitespace.
  Questionnaire pages reset their scroll position when advancing/backtracking,
  and primary actions including acknowledgement Continue stay visible at larger
  accessibility text sizes. The mixed-sport, working-set and empty-entry journeys
  passed with accessibility-large text after the navigation correction. Empty-library starter entry preserves
  recovery for a real planned/in-progress session, including a plan emptied by
  another client; recorded sets and the workout record remain accessible.
  Skip/Close remain available during unanswered reads, profile saves, preview
  reads and starter acceptance. Dismissal invalidates late UI updates while
  retaining protected drafts and recoverable starter intent. An unreadable
  protected draft exposes an explicit restore-from-server action. Today checks
  the server's durable starter capability so deleting a previously accepted
  starter does not advertise another acceptance. The final focused recovery run
  passed twelve model tests and four journeys covering these boundaries. A
  subsequent dismissal run passed all eleven profile-model tests and both UI
  tests spanning the four deliberately stalled network stages.
  Full CI and fresh independent review remain mandatory merge checks.
- Source base: verified remote main.
  Starter/profile delivery requires additive migration `0051_training_profile`
  before the compatible Worker and then the app. Existing staged migration
  instructions still apply to earlier migrations; this change does not approve
  a production release or change the workout-rename rollout order.

- P0 was activated; reconciliation preserved the
  shipped manual builder and returned-error recovery. This change closes the
  remaining entry-intent, capability-copy, initial-read and delayed-callback gaps.
- Pending invite, coach and manual setup destinations persist through failed
  sign-in/relaunch, bind to the authenticated account and are consumed once at
  sheet dismissal. Onboarding completion is account-scoped; unfinished setup
  survives relaunch. Step/feature-session checkpoints reject late completions
  after Skip, reauthentication or account changes.
- Today and direct manual setup require an accepted live read before offering
  empty-account creation. Cold offline/500 and cached-empty states offer retry;
  an existing cached plan remains available under the existing freshness rules.
- Coaching Feedback Loop P1 is integrated (PR #164), whose
  reviewed tree and main CI were verified. Its recent-change card, permanent
  history entry, account-bound dismissal and private feedback remain intact.
- Verification: 431 iOS unit tests; nine existing manual/onboarding,
  coaching-feedback and plan-change journeys; and all eight new
  `MemberActivationJourneyTests` journeys passed locally (including a focused
  rerun after correcting the combined handoff test's heading selector).
  New journeys cover owner, invited, independent/manual-only and connected-coach
  entry through first completion, sign-in/invite-preview retry, cold offline/500,
  cached empty/existing state, and sequential invite/coach handoff. Model tests
  cover interrupted onboarding relaunch and late completions after Skip/account
  boundaries. All 17 verification-command/scope tests and the plan graph passed.
  Representative activation journeys run in PR smoke coverage; all variants
  remain in the periodic full suite under the [verification policy](../../IOS-VERIFICATION.md). Exact-head
  independent review and terminal-green CI are required before this change merges.
- Repository delivery is the P0 boundary. Production deployment/migrations,
  TestFlight distribution and actual member messages remain separately
  authorized. Existing physical-device coaching feedback checks remain release
  follow-up; no new pre-merge device gate is introduced here.

- The September app review
  revalidated the working manual entry path. P0 closes remaining intent,
  capability-copy and error-state gaps rather than rebuilding manual authoring.

- P0 does not require a user to choose between AI and manual control forever.
  Both paths converge on the same active plan and can be used later.
- The initial adherence loop is local and schedule-driven. Social campaigns,
  generalized push automation, and predictive churn scoring are out of scope.
