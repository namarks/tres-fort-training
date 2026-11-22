# Tres Fort

Durable repository guidance for coding agents working in this repository.

## What this is

A multi-discipline training platform: lifting, runs, rides, swims and other
activities on one plan, executed in the native iOS app (set-by-set runner, run
recorder, iPad Station) and shared in private groups. Members author workouts,
schedules and dates in the app; every feature must work without AI. Optionally,
an external AI app (Codex, Claude, or another compatible MCP client) reads and
adapts the same plan. A single Cloudflare Worker + D1 database is the source of
truth both sides read/write.
The backend contains **no AI** — it is pure data. Full rationale, schema, and
the API/MCP surface live in `docs/DESIGN.md` (read it before non-trivial
backend work).

## Repository planning

Engineering workstream plans are distinct from the workout plan stored in D1.
Current workstreams live at `docs/plans/<slug>/plan.md`; cross-plan initiatives
live at `docs/initiatives/<slug>.md`; and `.agents/resume.yaml` configures the
shared planning workflows. Only `plan.md` carries live phase status,
dependencies, execution frontier, and next step. Run the shared
`planning-conventions` compiler's `check` command after changing a plan,
initiative, index, or adapter.

## Pull requests

Repository skills live in `.agents/skills` (`.claude/skills` links there), as
plain Markdown any agent can read. Drive a PR by following
`.agents/skills/codex-gate/SKILL.md`: Codex must review the exact head commit,
after every fix push too, and `plan graph`, `typecheck + tests`,
`iOS build + tests` and `contributor rights` must be green on that commit. Agents stop at ready to
merge; Nick merges.
PRs run one iPhone smoke job; the full UI suite and the iPad Station and App
Store jobs run as the nightly release check on `main`. Confirm the release
check passed on the exact commit before a TestFlight or App Store upload (see
`docs/IOS-VERIFICATION.md`).

## Commands

Backend (repo root):

```bash
npm test                       # prerequisites + all three real-D1 Vitest shards
npm run test:watch
npx vitest run test/mcp.test.ts            # single file
npx vitest run -t "logs a set"             # single test by name
npm run typecheck              # tsc --noEmit
npm run dev                    # wrangler dev (local Worker + local D1)
npm run db:migrate:local       # apply migrations/ to local D1
npm run db:migrate:remote      # guarded; use the authorized migration runbook
npm run deploy                 # deploy only, separate production authority required
npm run release                # guarded; deployment needs separate authority
npm run test:workout-rollout    # migration integrity and canonical contract tests
npm run ios:verify-watch       # unsigned build of the Apple Watch app and its complication
npm run ios:testflight         # build, upload, then give the build to external testers
npm run testflight:external    # give a build to external TestFlight groups (--list-groups is read-only)
npm run beta:feedback:list     # read-only: recent TestFlight feedback (--save keeps screenshots)
npm run beta:feedback          # mirror TestFlight beta feedback into GitHub issues
```

iOS (`ios/`):

```bash
cd ios && xcodegen generate    # regenerate TresFort.xcodeproj from project.yml — run after any project.yml change
open ios/TresFort.xcodeproj
```

Build/run with the **TresFort** scheme, never the widget-extension scheme.
The `.xcodeproj` is generated; treat `project.yml` as the source of truth.
The Apple Watch app (`ios/TresFortWatch`) is only in `project-watch.yml`,
which includes `project.yml`: generate with
`xcodegen generate --spec project-watch.yml` and run the **TresFortWatch**
scheme on a Watch simulator (`-watch-day-fixture today` shows a fictional
day, `-watch-workout-fixture ready` a fictional workout). A TestFlight
build carries it only when asked (`TESTFLIGHT_WATCH=1 npm run
ios:testflight` archives `project-watch.yml`); a default TestFlight build
(`project.yml`) and App Store builds never do, and the upload script
refuses an archive that holds a Watch app nobody asked for.

## Workout contract

Storage, REST, MCP and iOS writes use `workouts` / `workout_id` exclusively.
Old `/api/days` routes and `add_day` / `update_day` MCP names are removed;
retired request fields are rejected before mutation. Migration 0045 must already
be applied before this Worker serves traffic. Keep historical audit names,
immutable v1 snapshot restore, and old persisted cache/outbox readers intact.
See the release boundary (historical maintainer record).
Repository delivery does not authorize production migration, deployment or
client distribution. No released-client compatibility cycle is required.

## Architecture

**One Worker, route groups, one service layer.** `src/index.ts` mounts
`/auth`, `/auth/intervals` (intervals.icu OAuth connect), `/api` (iOS REST,
app-JWT), `/mcp` (external AI apps), OAuth discovery, `/webhooks` (intervals.icu push
receiver, `src/routes/webhooks.ts` — public, authenticated by a body
`secret` rather than app-JWT/MCP bearer), `/privacy` (App Store Connect
compliance page), `/join/:code` + AASA (`src/routes/invites.ts` —
Universal Link group invites), and `/diagnostics` (the owner's read-only
diagnostics lookups behind `DIAGNOSTICS_TOKEN`, also at
`/api/me/diagnostics` for the web page; owner's data only, plus the
problem reports members send from the app (`POST /api/me/problem-reports`,
migration 0077, an attached activity readable for 14 days), no Garmin or
WHOOP data; see `docs/DIAGNOSTICS.md`, and use them before asking for a
production query; the owner's web Members page, `/api/me/diagnostics/members`
only, summarizes every member's app build, active days and feature counts
from migration 0078's `member_app_use`/`member_active_days`, written by
`recordAppUse` and never opened to the token) under one Hono app. **All D1 access goes
through the public `src/db.ts` service facade** — REST routes (`src/routes/`) and MCP tools
(`src/mcp/server.ts`) are thin wrappers over the same functions, so behavior
stays identical across clients. Cohesive internal services live in `src/services/`:
OAuth grant transitions and Intervals reconciliation own their SQL and receive
identity helpers through typed dependency injection. They must not import the
facade at runtime. Keep data logic in these services or `db.ts`, and keep
route/tool handlers thin. intervals.icu I/O is isolated in `src/intervals.ts` (injectable
fetcher, dormant when no credentials are set); an hourly cron
(`wrangler.jsonc` `triggers.crons`) re-syncs as a backstop for any
undelivered webhook — the webhook is the primary sync path, not the cron.
Apple Health (HealthKit) is a second, iOS-only activity source: the Worker
can never read HealthKit directly, so the app pushes idempotent workouts to
`POST /api/activities/healthkit` (`upsertHealthKitActivity` in `db.ts`),
landing in `external_activities` with `source='healthkit'`. A per-user
opt-in (`users.share_health_activities`, migration `0028`, flipped via
`PATCH /api/me/health-sharing`) gates whether a member's HealthKit rows are
visible to other group members in `get_group_feed`/group stats —
intervals-sourced rows are unaffected. See `docs/DESIGN.md` for source handling.
WHOOP is a third, direct source (`/auth/whoop`, `src/whoop.ts`,
`src/services/whoop.ts`, migration 0070): tokens in the provider-neutral
`provider_connections` table, workouts as `source='whoop'` rows with WHOOP's
`strain` (never a load), and daily recovery and sleep in `daily_recovery`,
read only by `GET /api/me/recovery`. WHOOP data stays out of group views and
every MCP tool until WHOOP's terms allow it. See the private maintainer records.
Garmin is a fourth, direct source (`/auth/garmin` with PKCE, `src/garmin.ts`,
`src/services/garmin.ts`, migration 0071): Garmin pushes a one-time FIT link
per new workout to `POST /webhooks/garmin/:secret` (path secret, client id
header and Garmin's source addresses), the file is queued sealed in
`garmin_activity_files`, then imported through the `.fit` pipeline as
`source='garmin'`. Garmin data stays out of group views and every MCP tool,
and every view of it carries "Garmin <device>" attribution. Keep confidential
provider documents, credentials and private data out of the repository. Review
actual proposed content for publication rights; using a provider does not by
itself establish that separate publication approval is required.
See the private maintainer records.

**Two data classes, two consistency strategies** — this split is the core
design and dictates how you mutate things:

- *Versioned document* — the plan tree (`plans` / `workouts` /
  `template_exercises`). One monotonic `plans.version`, bumped on any plan
  mutation. The MCP `update_plan` tool takes an expected version and on
  mismatch returns a structured `{ conflict: true, current_version }` result
  inside a normal HTTP 200 `tools/call` response — **not** a 409 (the caller
  refetches and reapplies); `PATCH /api/workouts/:id`, `POST
  /api/workouts/:id/exercises` (add), `PATCH /api/workouts/:id/exercises/:teId`
  (edit), and `DELETE /api/workouts/:id/exercises/:teId` (remove, detaching
  historical `set_logs.template_exercise_id`) each patch a single-field
  allowlist or one slot through a write-time version claim. Slot add/update/delete and MCP swap accept optional `expected_version`; the
  current iOS editor sends the reviewed version. Stale or exhausted writes return
  `{conflict:true,current_version}` (HTTP 409 on REST). Tokenless coaching calls
  retain their existing inputs without requiring an expected version;
  bounded retries re-read and validate fresh state before applying only
  supplied fields. These give the iOS app direct, non-Claude
  write access to a day's exercises (audited as `actor='ios'`, or `'web'` for
  a web sign-in, whose app JWT carries `client: 'web'`), reusing the
  same `db.ts` functions MCP's `update_exercise` / `delete_exercise` call.
  `template_exercises.is_warmup` (migration `0026`) marks a slot a
  prescribed warm-up, excluded from working-set rollups; `cardio` is a
  `modality` for erg/treadmill/bike slots logged by duration via the same
  timed-set runner. `template_exercises.run_steps` (migration `0058`) holds
  a planned run's steps and pace or heart rate targets as canonical JSON
  text, only on the `ex_outdoor_run` slot; `src/runSteps.ts` owns the format
  and both snapshot serializers carry it. Never mutate the plan tree without going through one of
  these paths. Migration `0040` adds full-document `plan_snapshots`. Shared
  writers commit mutation/order, version, audit, required MCP note and snapshot
  in one D1 batch using `preparePlanWriteStart` / `preparePlanWriteFinish`.
  Keep the SQL/TypeScript writable-document serializers in parity. Return a
  committed-version result; post-commit read failures must retain the successful
  acknowledgement. Restore requires the reviewed plan ID/version, validates
  prescriptions, rejects active workouts and creates a new version.
- *Append-only log* — `set_logs` / `notes` / `sessions`. The row `id` is a
  **client-generated UUID = idempotency key**; writes dedup on it and are
  safe to retry. Logged data is **soft-deleted** (`deleted_at`), never hard
  deleted.

`GET /api/state?since=&sets_since=` is the single sync pull: full plan tree
only when its version moved, sessions/sets as deltas.

**Client state.** `SyncModel` publishes in-memory arrays. Account-scoped JSON
snapshots, outboxes and runner checkpoints live in UserDefaults, with no
SwiftData or `@Query` path. `StateSnapshotStore` owns revision/ACK/tombstone
ordering; its live envelope checks current persisted bytes before reuse. Large
envelopes are losslessly compressed. If packing exceeds the platform limit,
every writer can advance a small durable ordering/invalidation marker while
retaining one process-local live envelope. A cold process must fetch fully;
explicit invalidation or external replacement also discards that live value.
`TrainingHistoryIndex` and requested summaries are disposable read models,
invalidated on every published session/set/catalog mutation. Keep these caches
out of write-authority decisions and preserve the calendar parity contract.
`RunnerRecovery` owns pure checkpoint decisions and normalization; `SyncModel`
applies effects through account/epoch ownership and persistence CAS. Offline
start/resume requires a complete, intact, previously live-certified plan and
known matching session attempt (or no observed session). Pending UUIDs and
prescriptions stay fixed; cached rows never acknowledge them. Missing, legacy,
invalidated or competing-attempt caches require live validation.

**Apple Watch.** The Watch app only shows what the iPhone sends: it never
signs in or calls the Worker. `TrainingAgendaPublisher` hands Today's own
rows (`WatchDayBuilder`, worded by `TodayDayList`) to `WatchDaySender`, which
sends them as WatchConnectivity's application context and clears them at
every account boundary, like the Today widget. `ios/Shared/WatchDay.swift`
holds the format and what the Watch shows for a day; keep day rules on the
iPhone. The complication (`ios/TresFortWatchWidgets`) reads the Watch app's
stored copy of that day from the Watch's App Group. During a lifting
workout the same context carries the set the runner is on
(`WatchWorkoutPublisher`, `ios/Shared/WatchWorkout.swift`), and a tap on the
Watch is a request: `WatchWorkoutCommandRunner` applies it through the
Station link's guarded commands, so the iPhone logs every set and the Watch
keeps no workout state. Start on the wrist's leading row is such a request
too: `SyncModel.watchStart` decides it by the rules of Today's own row
button (`TodayView.rowActions`), so change the two together. See
`docs/plans/apple-watch/plan.md`.

**Ordered workouts on a date (migration 0073).** Sessions are unique by
`(user_id, date, slot)`. Slot 0 is the primary workout; additional workouts
allocate `MAX(slot)+1` with a durable client UUID and immutable creation receipt.
Never reuse a discarded slot or allocate a fresh id after an ambiguous response.
Date-based writes default to slot 0; exact positive slots must already exist.
ACK/alias merges, outboxes, discard barriers and recovery checkpoints use
`(date, slot)` within the account and preserve sibling sessions and sets.
Calendar coarse status comes from slot 0; visible additional sessions are listed
independently. Group consistency counts dates once. The index replacement needs
the two-stage Worker release in
the private maintainer records.

**One-time workouts (migration 0075).** A workout with `one_time_date` belongs
to that one date: a change "for today only" copies the date's workout (with
its block-week targets) and pins the copy to the date's slot-0 session, so
the reusable workout never changes. One-time workouts stay in the versioned
tree (snapshots, audit, restore) but out of the library, schedule, blocks,
the `update_plan` rebuild, `adjust_today` and name lookups, and never
moves to, or is assigned or started on, another date. REST
`POST /api/workouts` with `one_time_date`, a client `id` (retry receipt) and
`copy_from`; MCP `add_one_time_workout`. See
workout library P3 (historical maintainer record).

**Weekly schedule & calendar projection.** The recurring weekly pattern
(weekday → `workout_id`, `null` = rest) lives in `plans.meta.schedule`
JSON — *not* a table (consistent with the "no weeks tables" design). It is
part of the versioned document: `set_schedule` bumps `plans.version`, uses
optimistic concurrency, and writes audit+note like any plan mutation; it
rides `/api/state` inside the plan payload. `schedule.extras` (weekday →
up to four workout ids) holds workouts and activities beside a day's primary
workout; a write that omits it keeps the saved ones. Full workouts start their
own additional session. `schedule.times` (weekday →
workout id it holds → "HH:MM") is an optional time of day the app
reminds at, kept the same way (omitted keeps, `{}` clears). `plans.meta.program` is an
optional block of weeks (a start Monday, 1 to 52 weekday patterns with
extras, one-off or repeating) written by `setProgram` (`PUT/DELETE
/api/plan/program`, MCP `set_program`); `weekPatternOn` picks the pattern a
date uses, mirrored by `PlanTree.schedule(on:)` in Swift with
`ios/TresFortTests/Fixtures/ProgramWeeks.json` as the contract. A block that
lists its own workouts (`program.workout_ids`) sits beside the repeating
week: its stored weeks still hold the whole day, and `layerProgram`
(`src/programLayers.ts`, pure) rewrites them at `serializePlanMeta` on every
meta write, so never write `plans.meta` around it. `PUT /api/plan/program`
may carry the `schedule` to save in the same version, and `DELETE
…?keep_week=` ends a block with one week carried on. A week's
`targets` (slot id → sets, reps, load, duration or run steps) override the
slot on dates it covers (`src/programTargets.ts`, `PlanTree.workout(_:on:)`,
`ProgramTargets.json`): the runner, Today and the starting-targets snapshot
read them; editors keep the slot's own
(spec (historical maintainer record)). `POST /api/plan/program/build`
("Train for an event", MCP `build_program`) lays out a block to `meta.race`
by fixed rules (`src/programBuilder.ts`, pure; request parsing shared in
`src/eventBuildRequest.ts`): a preview, or with `save` the event and the
block in one write; `open: {weeks}` instead of `race` builds to a ceiling
with no event ("Keep building"). The coach's default start never reads WHOOP or Garmin runs. One-off changes ("skip Thursday
this week") are concrete `sessions` rows via `set_planned_session` /
`skip_planned_session` — append-only, **no** version bump. The future
calendar is *computed, not stored*: `projectCalendar` in `calendarProjection.ts` is the
authoritative projection (past = real sessions only; today+ = real session
wins, else schedule lookup, else rest). **iOS re-implements the identical
algorithm in `CalendarProjection.swift`** — the weekday rule (tz-free civil
date) and the truth table must stay byte-for-byte in parity across both;
`test/calendar.test.ts` is the contract. Database selection stays in `db.ts`;
calendar rules and conflict detection are pure functions in
`calendarProjection.ts`. `update_plan` rebuilds day UUIDs
and remaps the schedule by day name/label; days removed in the rebuild have
their schedule entry cleared. For a date assignment, `expected_attempt=0`
means no row was observed; the first assignment and every changed workout/rest
choice advance `sessions.attempt`, while an identical retry is idempotent.

**Owner anchor + multi-tenant MCP.** There is always a distinguished **owner**:
the bootstrap row (`ensureOwnerUser`), which Sign in with Apple later *claims*
(`claimOrCreateOwner`) so MCP-seeded data and iOS share one `user_id`;
`OWNER_APPLE_SUB`, when set, pins the owner bootstrap identity and prevents
other identities from claiming the owner row. Sign-in remains open: other new
Apple identities receive ordinary accounts with no group memberships. Other
users exist too (group members), so "exactly one user row"
is **no longer** true. As of M3 (migration `0025`) the `/mcp` bearer resolves
to a *specific* user: the static token (`MCP_STATIC_TOKEN`) always maps to the
owner; an OAuth access token maps to the user it was bound to at
`/oauth/authorize` (pre-M3 tokens carry no `user_id` → owner, for back-compat).

**Auth.**
- `/api/*` — app JWT (HS256, `APP_JWT_SECRET`), issued by `/auth/apple` after
  verifying Apple's identity token against Apple JWKS. A stable `sid` survives
  renewal; `POST /auth/logout` revokes that session family in D1. Legacy JWT
  families derive from signed user/auth-time/client claims. Middleware
  `requireAppJwt` checks revocation and sets `userId` on the Hono context.
- `/mcp` — dual: static bearer (`MCP_STATIC_TOKEN`, for Claude Code/curl)
  **and** OAuth 2.1 (claude.ai/desktop connectors). Both flow through
  `validateBearer` in `src/oauth.ts`. Static bearer → owner; OAuth token → the
  user bound at `/oauth/authorize` through authenticated mobile approval or a
  server-generated 256-bit, ten-minute, single-use code from
  `POST /api/me/mcp-passphrase` with `{}`. Reusable member/owner passphrases
  no longer authorize public consent. OAuth bearer/refresh values are stored
  as SHA-256 digests; pre-M3 tokens still resolve to owner. The 401 always
  advertises RFC 9728 metadata so the OAuth path is non-breaking.
- `/auth/intervals` — OAuth 2.0 authorization-code connect flow for
  intervals.icu (`src/routes/intervalsAuth.ts`). CSRF is a single-use,
  expiring `state` param (server-minted, resolved back to the connecting
  user on callback); the code is exchanged server-side with the
  `client_secret` — **not** PKCE (no `code_challenge`/`code_verifier`).
  Callback credentials stay encrypted and pending until `/finish` receives a
  fresh browser-returned completion secret from the same app session that
  started the flow. Per-user credentials use AES-GCM in `users`, with
  member/purpose-bound additional data and `CREDENTIAL_ENCRYPTION_KEY` held
  outside D1. Migration 0065 and its explicit backfill/enforcement procedure
  are required; see the private maintainer records. `src/intervals.ts` is
  dormant (returns `{ok:false, reason:'disabled'}`) when no credentials are
  set.
- `POST /auth/dev` exists **only** when `DEV_AUTH_SECRET` is set (local + the
  vitest config) — never enabled in production.

**Every accepted MCP mutation** records an `audit_log` row and (for plan changes) a
provider-neutral `notes` row (`author='coach'`; historical `claude` rows remain).
This visible/reversible trail is the
substitute for per-tool scopes (now recorded per user) — preserve it when
adding write tools. Plan tools use `atomicWrite` so dispatcher attribution is
not repeated after the service transaction. A no-op adjustment does not create
a version or snapshot. `adjust_today` changes recurring template targets;
omitting a day affects the whole plan.

**Coach grant lineage (migration `0041`).** Validated code exchange and refresh
rotation commit with one successor. Hashed consumed-refresh lineage detects
bound-client replay and revokes only that grant family. Profile disconnect
revokes caller-owned OAuth grants; changing a connect code does not. New grant
timestamps are epoch-ms, while legacy OAuth token expiry remains epoch-seconds.
Migration `0042` adds the approved 90-day refresh inactivity and 365-day absolute
lifetime policy, initially disabled. An explicit atomic activation starts both
clocks for existing authorized grants; successful refresh moves only inactivity.
Bearer validation and refresh enforce both deadlines. Activation retries cannot
restart clocks, and revoked/expired grants require new authorization. Static MCP
bearers and Apple/app sessions keep their separate lifecycles. See the
coach contract (historical maintainer record) and
release procedure (historical maintainer record).

**MCP transport** (`src/mcp/server.ts`): stateless JSON-RPC 2.0 over
Streamable HTTP, single `application/json` responses (no server-initiated
streams). Natural-language exercise arguments are run through an alias
resolver (`resolveExercise`) before hitting the catalog.
`log_activity` routes endurance types (run, ride, swim, walk and aliases such
as treadmill or spin; `src/enduranceActivity.ts`) to a manual activity on the
member's intervals.icu account (`src/services/intervalsActivityWrite.ts`),
never the local `activities` table, and refreshes the activity sync. Provider
failure is an error, never a local fallback, and a write 401/403 never
disconnects the read credential. The app's `POST /api/activities/endurance`
uses the same write for a run, ride, swim or walk typed in by hand, with
distance and time. Other types stay local (migration `0057`
adds `duration_s`, `avg_hr`, `calories`). `delete_activity` deletes only
intervals.icu activities whose `external_id` Tres Fort set. Current tools:
`get_coach_brief`, `get_current_plan`, `get_plan_history`, `compare_plan_versions`, `restore_plan`,
`get_today_workout`, `get_current_session`,
`get_session_log`, `get_history`, `get_volume_trend`, `list_exercises`,
`get_upcoming_rides`, `get_recent_activities`, `get_group_feed`, `log_set`,
`correct_set`, `delete_set`, `log_activity`, `delete_activity`, `rate_activity`, `log_workout_complete`,
`discard_workout`, `add_note`,
`update_plan`, `update_exercise`, `swap_exercise`, `add_exercise`, `add_workout`,
`add_one_time_workout`, `update_workout`, `delete_workout`, `delete_exercise`, `adjust_today`, `set_schedule`, `set_program`, `build_program`,
`set_planned_session`, `skip_planned_session`, `set_race`,
`set_periodization`, `add_trip`, `update_trip`, `remove_trip`,
`set_stress_model`, `refresh_rides`. Also exposes a
**resource** (`coach://state/current` — compact coaching brief readable at
chat start) and a **prompt** (`coach_brief`).

## Conventions

- Visual changes follow `docs/DESIGN-SYSTEM.md`: color tokens from
  `BrandPalette`/`Theme` (never hex or system colors in views), orange only
  for the next action and where you are, and `ThemeAccessibilityTests` after
  any token change.

- Timestamps are **epoch-ms integers**; `sessions.date` is a device-local
  `YYYY-MM-DD` string (client owns the "today" boundary — do not convert to
  UTC).
- IDs are UUID strings (`crypto.randomUUID()`).
- Loads carry their own unit (`lb` | `kg`, migration 0055): a slot's
  `target_weight` is in `template_exercises.target_weight_unit` and a logged
  set's `weight` is in `set_logs.weight_unit`. Omitted REST units mean `lb`;
  an MCP `log_set` without one inherits its slot's unit. Never derive a load
  unit from the catalog `exercises.unit`, and never sum lb with kg. Previous
  bests match the same physical load across units (`sameLoad`). See the
  weight unit release (historical maintainer record).
- Endurance load comes from `src/trainingLoad.ts` (pure) and the member's
  `athlete_thresholds` history (migration `0059`, `/api/me/thresholds`):
  power, heart-rate or pace load, scaled so one hour at threshold is 100, with
  a provider's own load preferred and the method labeled. Activities keep the
  provider's `training_load`; the shown load is `effective_load` /
  `load_method` (migration `0060`), refreshed by `refreshActivityLoads`.
  Apple Health pushes may carry heart-rate and power `streams`; the Worker
  stores only their threshold-independent summaries (migration `0061`).
  `POST /api/activities/fit` imports a `.fit` file (`src/fitFile.ts`) as a
  `source='fit'` activity scored the same way; dedup keeps intervals.icu over
  `.fit` over Apple Health. `POST /api/activities/recordings` keeps a run
  recorded in the app (TCX, `src/tcxFile.ts`) the same way as a
  `source='recording'` activity, ranked like `.fit`, with its GPS route in
  `activity_routes` (migration 0063, `src/activityRoute.ts`). Routes are
  private to the member: never in group views or coach tools. A recording
  can carry the strap's heart rate at the stop and one and two minutes
  later (`recovery_hr_*`, migration 0067), served with its route; those
  minutes never count toward the run's time, heart rate or load. It can
  carry the climb the iPhone's barometer measured (`elevation_gain_m`),
  and a planned run's laps, one per step plus what was run after the plan
  (`activity_laps`, migration 0069, `src/runLaps.ts`), served with its
  route and private like it.
  The file then goes to intervals.icu only when the member has connected it.
  `GET /api/activities/:id/route` also serves the route the app sent for an
  Apple Health run (`PUT /api/activities/healthkit/:id/route`, kept in
  `activity_routes`) and reads an intervals.icu run's track from
  intervals.icu without storing it (`src/services/intervalsRoute.ts`).
  `GET /api/activities/:id/streams` serves pace, heart rate and elevation
  chart series (`src/activityStreams.ts`), plus power and cadence with a
  ride's best efforts and time in zones of the member's FTP
  (`src/ridePower.ts`), the same way: intervals.icu read
  live, else the stored route plus the heart-rate series kept for a
  recorded run or an Apple Health or `.fit` workout (`activity_heart_rates`,
  migration 0068, `src/heartRateSeries.ts`) and the power and cadence
  series kept for a `.fit`, Garmin or Apple Health ride
  (`activity_power_series`, migration 0074, `src/powerSeries.ts`). An
  intervals.icu ride keeps its heart rate, power, cadence, distance and
  altitude in those two tables after it syncs (`keepIntervalsRideSeries`,
  `src/intervalsRideSeries.ts`, at most three rides a sync), read when
  intervals.icu can't answer. Private like routes; see
  the plan (historical maintainer record).
  `GET /api/me/thresholds/suggestions` offers the
  thresholds intervals.icu scored the member's latest synced workouts with;
  only the member's tap saves one (`source='intervals'`).
  A member's own 1 to 10 effort rating (`external_activities.effort`,
  migration `0066`) scores a workout with no measured load as
  `load_method='effort'`, labeled an estimate; any measured load wins.
  Missing data stays unknown; never fabricate a load. See
  the plan (historical maintainer record).
- `external_activities.sport` (migration `0064`) names what a workout was
  (soccer, tennis, swim) from `src/sports.ts`, mirrored by
  `ios/TresFort/Sports.swift` and pinned to
  `ios/TresFortTests/Fixtures/Sports.json`. `kind` stays coarse because
  cross-source dedup matches on kind and start time; never make it finer.
  Sports beyond runs and rides get a heart-rate load from the run or ride
  threshold heart rate only (`HEART_RATE_THRESHOLDS`), never pace or power.
  An Apple Health swim's pool, lengths, sets and stroke counts are kept in
  `activity_swims` (migration 0072, format owned by `src/swimDetail.ts`)
  and served by `GET /api/activities/:id/swim`; Apple Watch's effort score
  is `external_activities.provider_effort`, used for the `effort` load only
  when the member hasn't rated the workout.
  See the plan (historical maintainer record).
- Periodization is **not** in the schema. Deloads/waves/blocks are Claude
  editing `target_*` / the per-exercise `progression` JSON and writing a
  note. `progression.type` (linear|double|rpe|manual) is interpreted by
  Claude, not enforced by the backend.
- Secrets are never committed — set via `wrangler secret put`.
  `wrangler.jsonc` holds only non-sensitive config (D1 id, bundle id); the
  vitest config injects test values for all secrets.
- Tests run against a real D1 in the Workers runtime via
  `@cloudflare/vitest-pool-workers`; each suite applies `migrations/` with
  `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` and authenticates through
  `/auth/dev`. The test suites cover the full surface. Schema changes mean a
  new numbered file in `migrations/`.
