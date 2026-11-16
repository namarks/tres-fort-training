# Plan on the web

Slug: web-app · Status: active · Updated: 2026-11-16 · Theme: platform

## Goal

A member signs in at `app.tresfort.app` on a laptop or desktop browser with
the same account as the iOS app and uses the extra screen space, mouse and
keyboard for two jobs. **Planning:** see lifting, runs, rides and other
sessions on one calendar, build and edit workouts and planned runs, set the
weekly schedule, and move, skip and assign dates. **Analysis:** look at trends
and progress across weeks and months in more depth than a phone allows. The
owner's reason (2026-11-01): planning and reviewing progress are easier with
more screen and a mouse. Every web feature works without AI and writes
through the same REST endpoints, versioned writers and audit trail as the app.

The web is not for training (owner, 2026-11-01). The iPhone stays the place
to train: the set-by-set runner, run recorder, Apple Health, iPad Station and
partner training are not web features.

## Phases

- [x] **P0 — Scope and owner setup**
  - Decided by the owner on 2026-11-01: the app stays iOS-only for now, and
    the first web version serves existing members signing in with Apple.
    Android may come later, so sign-in must stay replaceable (see notes).
    People may also sign up on the web first.
  - Done 2026-11-01: the owner created the Sign in with Apple Services ID
    `com.nmarkspdx.tresfort.web`, grouped with the app's primary App ID
    (`com.nmarkspdx.tresfort`), so the web and the app receive the same
    Apple `sub` and therefore the same account. Its domain is
    `app.tresfort.app` and its return URL is
    `https://app.tresfort.app/auth/apple/callback`.
  - The `tres-fort-web` Worker and its `app.tresfort.app` custom domain are
    created by its first deploy, which needs the owner's written go-ahead.
- [ ] **P1 — Sign in and see the plan**
  - Built first (gateway, sign-in and the read-only month calendar):
    - New `web/` package: a static single-page app (TypeScript, React,
      Vite) served by the `tres-fort-web` Worker's static assets
      (`web/wrangler.jsonc`). The same Worker is a thin same-origin gateway
      (`web/worker/gateway.ts`). It runs Sign in with Apple as a redirect
      with `form_post`, with a fresh state and nonce held in a 10-minute
      `__Host-` cookie. It keeps the app JWT in an `HttpOnly`, `Secure`,
      `SameSite=Lax` `__Host-tf_session` cookie that page scripts cannot
      read, for the JWT's own 60 days. `Lax` rather than `Strict`, because
      Apple's callback is a cross-site POST and the redirect into the app
      after it would not carry a `Strict` cookie. The gateway forwards
      `/api/*` to the API Worker over a service binding with the bearer
      added, only for requests carrying the page's own header from the same
      origin, and passes through only safe headers. It forwards reads only
      for now and never forwards the iPad Station link key. No CORS is
      opened on the API Worker. The gateway and cookie handling do not depend
      on the sign-in provider, so another provider later only adds a
      sign-in route.
    - API Worker: `/auth/apple` also accepts tokens for the non-secret
      `APPLE_WEB_SERVICES_ID` audience, requires the nonce the gateway sends
      to match the token's nonce, and refuses an authorization code with a
      web token. Native sign-in is unchanged.
    - Read-only screens: month calendar of planned and completed lifting
      and endurance sessions with away dates, the weekly routine, and a day
      panel with exercises, targets, supersets and planned run steps. The
      calendar runs `projectCalendarWindow` from `src/calendarProjection.ts`,
      and run steps use `src/runSteps.ts`, so the web runs the same code as
      the Worker rather than a third copy of those rules. Sign out works.
      A finished run workout shows as its run alone, as in the app
      (`finishedRunOf` and `matchingRun` in `web/src/model.ts`, mirroring
      iOS `PlannedRunRecord.matchingRun`), not as the workout and its run
      under the same name.
  - Still to do in P1:
    - A week view, and a link to delete the account (the existing
      `DELETE /api/me`). Plan version history is not shown to members
      (owner, 2026-11-03); see P2.
    - Preserve group invite codes through web sign-in as in the app.
  - The owner-directed 2026-11-12 follow-up adds web-first Run, At home
    (core, stretching or bodyweight circuit) and Custom creation, editable
    prescriptions, a repeating mixed week, and an iPhone handoff. Committed
    `npm run test:web-onboarding` journeys use the real local gateway and D1
    at 1280 and 800 px, including keyboard operation, failed reads, lost
    replies, schedule conflicts and cross-tab account changes.
  - Writes from the gateway are audited as `actor='web'`, not `'ios'`
    (built with the first P2 write, below).
  - Released 2026-11-02 with the owner's written go-ahead: migrations 0059
    and 0060 were applied in production, then the API Worker and `tres-fort-web` on
    `app.tresfort.app` were deployed.
    The owner signed in with Apple there and saw their plan, which checks
    the shared Apple `sub` end to end.
- [ ] **P2 — Edit the plan**
  - Owner-directed onboarding follow-up (2026-11-12), coordinated with
    [member activation P6](../member-activation-and-adherence/plan.md#phases):
    calendar projection consumes program weeks; date cells and details show
    separate scheduled extras and their reminder times, deduplicating real
    sessions. Extra-only dates read Planned. Planned details use that week's
    target overrides; started/completed details do not acquire current reminder
    times or block overrides. Each extra opens its own workout editor. Projection and
    rendered calendar regressions cover the shared run-plus-core week.
    PR #444 merged
    on 2026-11-12; a web deploy remains separately authorized.
  - The next authorized audit slice finishes ordinary week authoring: a
    primary workout plus up to four separate workouts per weekday, independent
    optional times, explicit Save/Cancel and reviewed-version writes. A saved
    run or home routine opens its exact workout and can be added to selected
    weekdays without replacing the run already there. The iPhone handoff uses
    the shared calendar projection to show the next planned day.
    Guided creation stores account-scoped retry identities before sending;
    an acknowledgement followed by a failed read offers read-only recovery.
    A refused save requires refreshed state and explicit review of retained
    targets. `/api/me` now returns the caller's ID, and the API enforces the
    optional `X-TresFort-Account` header on saves and reads so another tab's
    account switch cannot redirect a planless draft. Deploy this API before
    the new web bundle; no migration or deployment is authorized by this work.
  - Owner-directed audit completion (2026-11-13), coordinated with member
    activation P7: Calendar offers explicit date-only versus saved-workout
    edit scope for an unstarted primary workout. The date-only path copies
    that date's effective targets and retains its account-bound retry ID
    through copy and assignment recovery. Existing one-time workouts remain
    date-bound. Scheduled extras retain explicit saved-workout scope; they
    need a cross-platform replacement contract before date-only editing can
    suppress the original extra safely. Routine review adds a step-through
    timer sequence and a duration breakdown that leaves untimed reps and
    pauses unknown. A saved repeating week introduces optional block and
    target-editing guidance without creating a block on navigation.
  - Built first (owner chose plan editing next on 2026-11-02): a Workouts
    view to create, rename, tag, add notes to, archive, restore and delete
    workouts; add exercises and warm-ups from a searchable catalog; edit a
    slot's sets, reps or rep range, hold or cardio duration, weight with its
    lb or kg unit, target RPE, rest and warm-up flag; replace, reorder and
    remove slots. Group members are editable, but their rounds and rests
    stay group-owned. The gateway forwards only those writes (an allowlist of
    method and path), each with the page's own origin and header and a JSON
    body of at most 64 KB. A web sign-in's app JWT carries `client: 'web'`,
    so the API records `actor='web'` on audit rows and plan versions; a
    session from before that claim is signed out once. Every write sends the
    version on screen; a 409 reloads the plan, closes any open form and says
    the plan changed elsewhere. Moving a slot after another was removed now
    works for the app too: a gap in stored indexes made the move a no-op.
  - Built next: supersets and circuits (tick two or more neighboring
    exercises, then set rounds, rest between exercises and rest after each
    round; edit, ungroup, move the whole group, and reorder exercises within
    it) through `PUT /api/workouts/:id/groups`, and moving workouts up and
    down the list.
  - Then the run step editor: a run's steps and repeats, each ending after a
    time or a distance with an optional pace (per mile or kilometer, by the
    browser's region) or heart rate range, checked with the Worker's own
    `parseRunSteps` and saved as the slot's `run_steps`. Stored distances and
    paces are kept exactly until their text changes; steps in a format the
    web can't read can only be removed.
  - Then the calendar: the weekly routine (a menu per weekday, or dragging a
    workout or Rest onto a weekday; each change sends the whole week with
    the plan version), single dates (choose another workout, move it to a
    later empty date, or make it a rest day, each checked against the
    date's `sessions.attempt` as the app does; past, started and
    away-without-training dates stay as they are), and away dates (add,
    edit only the changed fields, and remove, with the plan version).
  - Released 2026-11-03 with the owner's written go-ahead: the API Worker and `tres-fort-web` were deployed, which
    carries the editing above (#315, #319). No migration was needed.
  - That release also had a Plan changes view (every saved version, a
    field-by-field comparison with the plan now, and restore as a new
    version). On 2026-11-03 the owner decided the detailed change log
    confuses members and belongs in the back end, as the iPhone app had
    already done (#327), so the web view and its gateway route are removed
    (#329). Plan versions are still saved on the server, and the coach can
    still compare and restore them. Released 2026-11-03 with the owner's
    written go-ahead: `tres-fort-web`
    was deployed; the API Worker was not redeployed, since
    its code had not changed since the previous release. The live bundle no longer has
    the view, and the gateway answers the restore route with 405.
  - Create, edit and delete workouts; add, edit, reorder and remove exercise
    slots with target sets, reps, weight and lb/kg unit, RPE, warm-up flag,
    rest, and superset or circuit groups.
  - Planned run step editor with pace or heart rate targets.
  - Weekly schedule by dragging a workout onto a weekday (with a keyboard
    alternative); assign, move and skip single dates; add, edit and remove
    away dates.
  - Every write sends the reviewed plan version. A 409 conflict reloads the
    plan and tells the member it changed elsewhere (the app or the coach)
    before they reapply.
  - Race goal, training phases and deloads follow whatever REST
    [coach-free planning](../coach-free-planning/plan.md) adds; the web does
    not add its own endpoints for them. The race goal's REST landed with P3's
    Event page (2026-11-09), where the web sets it.
  - Blocks of weeks: the Block page designs one over the existing
    `PUT/DELETE /api/plan/program` (a grid of days, targets by week and a
    ramp for any workout). The owner, 2026-11-10: the web is the place for
    detailed block design ([progressive plans](../progressive-plans/plan.md) P4).
  - Then one Plan page (owner, 2026-11-15: one page instead of separate
    Calendar and Block tabs, without two calendars, and creating a plan
    should feel intuitive; the owner picked "Weeks, not months"): `#plan`
    (`web/src/PlanPage.tsx`, rules in `web/src/planWeeks.ts`) shows one
    calendar of week rows, from the block's start (at most four weeks back)
    through two usual weeks after it, with each block week labeled in its
    row. A date's panel keeps its date-only actions and changes a weekday
    in the block for this week, every week of the block, or this week and
    later; outside a block it changes the usual week's day. Block settings,
    targets by week and the retained-draft review moved into
    `web/src/BlockEditor.tsx`; date-only changes wait while the block has
    unsaved changes, since the server checks them against the saved block.
    With no block and an empty week, the page opens on "Make your plan".
    `#calendar` and `#block` still open it. No API change.
  - Then (owner, 2026-11-16: earlier weeks couldn't be put away and the
    calendar took over the page): the weeks scroll in their own box with
    the mouse wheel, under fixed weekday names; reaching its top or bottom
    adds four weeks there without moving the weeks in view, and "This week"
    goes back to the starting weeks with last week at the top.
  - Then (owner, 2026-11-16: the Plan page is busy and unclear, its bottom
    sections are text heavy, the iPhone handoff does not belong on it, and
    Workouts should be a tab of planning): Plan in the top bar holds two
    tabs, Schedule (`#plan`) and Workouts (`#workouts`,
    `web/src/PlanTabs.tsx`); the top bar no longer lists Workouts. "Plan
    week by week" and "Build up to an event" become one Training block
    button, whose form says what a block is before anything is saved. The
    "Take your week to iPhone" and "Build on your week" sections and the
    "Create another workout" button are removed, which retires the
    2026-11-12 handoff and the 2026-11-13 block guidance above. No API
    change.
  - Then (owner, 2026-11-16, picked from three mocked options: the usual
    week was shown twice, as calendar rows and as seven "Your usual week"
    cards over a row of workout chips whose purpose was unclear): the
    repeating week is the calendar's first row, "Every week", in the same
    seven columns as the dates and fixed above them while the weeks scroll
    (`web/src/EveryWeek.tsx`). Choosing a day in it opens "Every Tuesday"
    beside the calendar: the day's workouts with a time each, Remove, Make
    main, and a searchable list to add a workout, run or activity. It saves
    through the same `PUT /api/plan/schedule` write. The seven cards, the
    chip row and dragging a chip onto a day are removed; "Add to my week"
    from a workout opens its form at the top of the Schedule tab. No API
    change. Away dates open from a button beside "This week" instead of
    a section under the calendar, a date planned, emptied or skipped on
    its own is marked "This date only", a chip keeps its time on its own
    line, and the Workouts tab names the days each workout is on
    (`workoutWeekdays` in `web/src/scheduling.ts`).
  - Then (owner, 2026-11-16: the repeating week and training blocks
    "don't interact well"; editing the week must not override a running
    block, standing weekly items such as a nightly core routine or a
    weekly game sit apart from the block, and block management belongs in
    its own tab; the owner approved the mocked model): a block sits
    beside the repeating week. Plan has three tabs, Schedule, Block
    (`#block`, `web/src/BlockPage.tsx`) and Workouts.
    - A block that lists its own workouts (`program.workout_ids`) is
      layered: the top row holds what repeats every week and carries on
      during the block, and the block holds only its own workouts and
      their targets by week. Neither edit reaches the other. Stored block
      weeks still hold the whole day (the block's entries first, then the
      repeating week's), so `weekPatternOn`, the Swift mirror, the parity
      fixture and released iPhone builds read them unchanged;
      `layerProgram` (`src/programLayers.ts`) rewrites them whenever the
      plan's meta is written. A block without `workout_ids` (older ones,
      the event builder's, the iPhone app's) keeps its own weeks as before
      and the Block tab offers to sort it.
    - Starting a block: tick what it trains (each weekday's main workout
      is ticked, what sits beside it is not) and add any other workout on
      a day. `PUT /api/plan/program` takes an optional `schedule`, so the
      block and the week its workouts leave are one plan version.
    - The Block tab: the block's workouts by week, each with what its week
      asks for; a workout's days for every week; week labels, copy down
      and a lighter week; targets by week and ramps; one week of a planned
      run's steps (kept in the block's draft, the workout's own steps
      unchanged); what carries on every week beside it; start over when
      it ends. End block keeps one week going every week (`DELETE
      /api/plan/program?keep_week=`: its days go into the repeating week
      and its targets are saved to its workouts) or just ends it.
    - The Schedule tab shows a running block's name and week with a link
      to it, marks block workouts on their dates with what the week asks
      for, and a block date's panel changes that date only. The top row
      reads "Fills every week below" with no block and "Carries on beside
      your block" while a layered one runs.
    - A reminder time may belong to a workout only a block week holds on
      that weekday, and a schedule write that does not name it keeps it.
    - Known limits: a day shows at most five entries, and the repeating
      week's are the ones cut; a client that does not know the list
      cannot take a repeating-week entry off one block week (the next
      write puts it back); a block workout also placed in the repeating
      week shows only outside the block; keeping a week is refused while
      a workout it would change is in progress. It needs an API release
      before the web one.
- [ ] **P3 — Trends and progress**
  - Equal in importance to plan editing; it can run alongside P2 once P1 is
    in.
  - Built first (owner, 2026-11-08: a scrollable Activity page beside the
    calendar): an Activity page (`#activity`, `web/src/ActivityPage.tsx`)
    that follows the iPhone Activity tab's one-page redesign
    ([app-design-pass](../app-design-pass/plan.md) P10). It shows this week
    on the navy key card (time trained, sessions, distance, strength time,
    load, a bar per day split into strength, endurance and sports, the week
    streak and the change from this time last week), highlights from the last
    30 days (fastest run pace over a mile or more, longest run, a new
    heaviest working set), training time for each of the last eight weeks,
    and the whole history by month with filters for workouts, runs, rides,
    swims, walks and other. Choosing a session shows its record beside the
    list: an activity's distance, time, pace, heart rate, power, climb,
    calories, load with its method, effort and source, with its route and
    charts; a workout's sets by exercise; a hand-logged activity's time,
    heart rate, calories and notes. `web/src/activity.ts` ports the app's
    `ActivityHistory`, `ActivitySummary` and `ActivityHighlights` rules, so
    the web counts the same sessions the same way, and lists a finished run
    workout once, as its run (`matchingRun`). Everything comes from
    `GET /api/state`; no API change.
  - Then (owner, 2026-11-08: show more than the title, such as the map, and
    keep the member oriented while scrolling): each history entry is a card
    with its kind, date and source, its headline numbers (distance, time,
    pace or speed, average heart rate and load; a workout's sets and time and
    each exercise's best set; a logged activity's time, heart rate, calories
    and notes) and, for a run, ride or walk with a GPS track, the route's
    shape, fetched only as the card nears the screen and kept for the visit.
    The filters and a month jump stay pinned while scrolling, each month's
    header sticks under them with its sessions, time and run distance, a
    divider opens each week with its own totals, and a "This week" button
    returns to the top. Cards and the record panel call out records set as
    of that day (owner, 2026-11-08): the longest run, ride, walk, hike or
    swim yet, or in 90 days once there are three earlier ones to beat; the
    fastest run of a mile or more; and a lift PR, a working set heavier than
    any earlier set of that exercise as a physical load. A first-ever
    session sets none.
  - Then (owner, 2026-11-08: the web should be where members go deep on
    their data, not a side feature): an Analysis section (`#analysis`,
    `web/src/AnalysisPage.tsx`, rules in `web/src/analysis.ts`) beside the
    calendar, workouts and Activity, with its own side list of pages. The
    owner chose a direction of Overview, Strength, Running and rides,
    Recovery (WHOOP, only when connected) and Records pages sharing one date
    range and a comparison with the period before, and picked Overview
    first. Overview takes 4, 12, 26 or 52 whole weeks ending this week, or
    all time, and compares with the same days the range's length earlier.
    It shows training time, sessions, run (else ride) distance, training
    load and working sets with their change; fitness, fatigue and form from
    each session's shown load (`effective_load`; 42- and 7-day exponential
    averages, form their difference, as intervals.icu shows them), with the
    day's sessions on hover or arrow keys and links that open a session on
    the Activity page (`#activity/<key>`); training time by week (by month
    past 60 weeks) split into strength, endurance and sports; and where the
    time went (lifting, each endurance kind, each sport) against the period
    before. Lifting has no load, so the fitness lines leave it out and say
    so rather than estimate one. The chart names where its loads came from
    ("Garmin Forerunner 945"), as Garmin's terms ask, and nothing on the
    page uses AI. Each chart can be read as a table. A Methodology page in
    the Analysis side list (`#analysis/methodology[/<section>]`; owner,
    2026-11-08: one page for every derived stat and analysis figure, not
    one per page) explains how everything Très Fort works out is
    calculated: sessions, time, pace and distance, ranges and comparisons,
    working sets and loads across units, training load and its methods,
    fitness, fatigue and form, records and highlights, planned run laps and
    sources. It links the research behind the fitness model (Banister 1975;
    Morton, Fitz-Clarke and Banister 1990; Clarke and Skiba 2013) and its
    limits (Hellard and colleagues 2006). Overview, the Activity page's
    highlights and an activity's load link to their section. Each new
    Analysis page adds its figures there. Everything comes from
    `GET /api/state`; no API change.
  - Then (owner, 2026-11-09: see progress toward a specific event, chosen
    ahead of Strength): an Event page (`#analysis/event`,
    `web/src/EventPage.tsx`, rules in `web/src/event.ts`) where the member
    sets, edits and removes their goal event (name, date, type, distance and
    an optional goal time) through coach-free planning P1's race REST, with
    no AI involved. It shows the countdown, goal time and goal pace, the
    block week the plan is in today and the event's week in it, the training
    phase when one is set, and a finish estimate: each recent run or swim
    carried to the event distance with Riegel's formula (a ride at its
    average speed), the best of the last six weeks named with the session it
    came from, and each week's best over twelve weeks against the goal.
    Distance by week for the event's sport carries the week's longest
    session beside the event distance; a multisport event shows time in each
    sport instead, and a type Très Fort can't map to sessions (a biathlon)
    shows the plan and fitness only. Fitness, form, sessions a week and the
    longest recent session follow, and once the date passes the longest
    session on the day is shown against the goal. The Methodology page's
    "Your event" section explains each figure and cites Riegel (1981).
    Everything else comes from `GET /api/state`.
  - Then (owner, 2026-11-15: route previews looked broken without a map,
    use wide windows, show start and finish and replay the route): history
    cards draw their route on a muted, still Apple Maps (MapKit JS) map
    while near the screen; the record's route map marks start and finish
    and, the first time an activity is opened in a visit, a dot runs the
    route (skipped for reduced motion); at 1500 px and wider the Activity
    page shows summary, history and record in three columns. No API change.
  - Strength is implemented: searchable exercise history, comparable reps
    and holds, estimated maximum, and source-set links into exact workout
    correction. Broader volume/muscle summaries remain extensions, not a
    missing Strength page.
  - Still to do in P3: broader strength summaries, Running and rides (weekly distance, pace at a heart
    rate, best efforts, two runs side by side), Recovery and Records pages,
    a custom date range, planned against done (needs the plan as it stood on
    each past date, since the calendar keeps no past schedule), the app's
    weight detail, and typing in an activity.
  - Session history with set detail; exercise history charts (top set,
    estimated max, volume) with hover detail and a chosen date range;
    weekly training volume and time by discipline; the consistency view;
    imported and manual activities, including typing in a run, ride, swim or
    walk.
  - Comparing periods (this block against the last, planned against done)
    and filtering by discipline or exercise, using existing history and
    volume endpoints first. New read endpoints are added to the Worker only
    where the existing ones cannot answer a chart, and the iOS app can use
    them too.
- [ ] **P4 — Profile and connections**
  - Profile and units, training profile, intervals.icu connect and resync,
    AI coach connections (personal passphrase, list and revoke grants), Apple
    Health group sharing switch, data export, and account deletion.
- [ ] **P5 — Release**
  - Privacy policy names the web sign-in cookie (no analytics or tracking);
    the website links to the web app; the owner approves the `tres-fort-web`
    deploy and the API Worker deploy that accepts the web audience.

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P0 | gated_by | external:owner-apple-web-services-id | Met 2026-11-01: the owner created the Services ID with its domain and return URL in Apple's developer account. |
| P1 | gated_by | external:owner-web-deploy-approval | Met 2026-11-02: the owner approved the first deploy in writing and signed in with Apple on `app.tresfort.app`. |
| P2 | coordinates_with | plan:coach-free-planning | Both add member-facing planning over the same REST endpoints; new endpoints land once and both clients use them. |
| P5 | gated_by | external:owner-web-deploy-approval | A new public site and an API Worker change need the owner's written go-ahead. |

## Next step

**Now (@agent):** Deliver the web portions of the selected core lifting pass:
[workout-library P0.15](../workout-library/plan.md) preserves new-block and
workout-details drafts, and [coach-free planning P2](../coach-free-planning/plan.md)
adds a reviewed lighter week using the existing retained block editor. Detailed
week targets and ramps already exist; do not create a competing block editor.

The unified Plan weeks page and Activity map/wide-layout changes from public
PR #4 are merged. The source also includes mixed-week creation, connection
discovery, signed-out entry, primary date-only editing, Event analysis, Strength
charts and exact workout correction. Earlier private PR numbers are historical
source-delivery references, not pending public-repository work.

Plan page simplification (owner, 2026-11-16): the tabs, the removed
sections, the repeating week as the calendar's first row, away dates behind
a button, the "This date only" mark and the days on the Workouts tab are
built, and so is the block beside the repeating week with its own Block tab
(P2). Next for it: the owner merges, then a separately authorized API
release followed by the web release, and a check on the phone that a block
date shows the block's workout together with what repeats every week. The
iPhone app still starts and edits blocks as whole weeks; teaching it the
block's own list is later work there.

**Later (@agent):** Date-only replacement of scheduled extras still needs a
shared replacement/lineage contract, as described in member activation P7.
The remaining P3 analysis extensions and broader P4 profile/connection work
retain their own scope; this lifting pass does not activate all of them.

**Next (@owner):** Authorize and verify a release separately when ready.
Repository completion does not prove the production web bundle or API version.
Deploy a compatible API before clients that require its changed request shapes;
no deployment is authorized by this plan cleanup.

## Notes / open questions

- Not in scope: workout runner, run recorder, Apple Health import (a browser
  cannot read HealthKit), iPad Station, partner training, group feed, offline
  use, phone-sized layouts beyond "usable", and sign-in without an Apple ID.
  People without an iPhone would need another sign-in method and a way to log
  workouts; that is a separate decision.
- Adding Android or non-Apple sign-in later is contained: all data hangs off
  Tres Fort's own user ID, and Apple's `sub` is one column on `users`. A
  later migration would let one account hold several sign-in identities and
  add a "link another sign-in" screen. Sign in with Apple also works on
  Android through the same Services ID. Members who used Hide My Email cannot
  be matched by email, so linking happens while signed in.
- People without an iPhone (owner reviewed 2026-11-16, decided to leave it
  for now; no plan covers it). Today they can create an Apple Account on the
  web, sign in here, plan and analyze, but the gateway refuses set logging,
  session lifecycle, uploads and connections (intervals.icu, Garmin, WHOOP),
  so training needs the iOS app or an AI coach, which the no-AI rule does
  not accept. Options sized then, in the order recommended: (1) Google
  sign-in with an identity table that lets one account hold several
  sign-ins, about two to three PRs; `users.apple_sub` is `NOT NULL` today.
  (2) Training on the web at phone size: log a workout, enter an activity,
  upload a `.fit` file and connect sources from the web, about five to eight
  PRs; this reverses the 2026-11-01 "web is not for training" scope and is
  weaker offline than the app. (3) A native Android app (Kotlin, Health
  Connect as the Apple Health equivalent) only on demand, starting with the
  run recorder and activity import. The iOS app is roughly 74,000 lines of
  Swift with no reusable code for Android, and Android would add a third
  copy of the calendar and program parity rules.
- Size estimate: P1 about three PRs, P2 five to seven (the largest), P3 two to
  three, P4 two. The Worker change is small because the REST API already
  covers planning, history and settings.
- A cheaper stopgap exists for Mac owners: making the iPad app available on
  Apple silicon Macs in App Store Connect. It does not reach Windows or
  Chromebooks, and the layout is the iPad's, so it does not replace this plan.
- Open source: the web app lives in this repository under the same license.
  It makes self-hosting more useful, since a self-hoster cannot easily ship
  their own iOS app.
- A future paid tier would most naturally be sold on the web; this plan adds
  no payments.
- Web sign-in sends Apple no authorization code, because Apple binds the
  code exchange to the Services ID and its own client secret, and the API's
  exchange uses the app's bundle ID. A web-only account therefore has no
  stored Apple refresh token. Deleting it still works and reports
  `manual_required` for Apple's side, as the app already does when no token
  is stored. Exchanging web codes too is a possible follow-up.
