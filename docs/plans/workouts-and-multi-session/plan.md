# Workouts and Multi-Session Days

Slug: workouts-and-multi-session · Status: active · Updated: 2026-11-09 · Theme: gym-floor

## Goal

Two model corrections that the workout library exposed:

1. The reusable workout is stored as `day_templates` and referenced as
   `day_template_id`, a name from the original weekly-split design where a
   template was "a training day". Storage, service layer, REST, MCP, and iOS
   should all call it a **workout**. On 2026-09-19 the owner confirmed that
   legacy clients have no users and approved removing compatibility support
   without a released-client waiting period.
2. `ux_session_user_date` (migration `0029`) makes one strength session per
   member per civil date a hard invariant. A member who lifts in the morning
   and does a second workout in the evening cannot record both. Done means a
   date can hold an ordered list of sessions, every existing single-session
   behavior is unchanged for the first one, and the calendar, Today, MCP, and
   group feed present the extra sessions without a second projection engine.

## Phases

- [x] **P0 — Rename `day_templates` to `workouts` end to end**
  - [x] **(a) Repository implementation and rollout verification**
    - Migration 0045 renames the table and both referencing columns while
      preserving workout, slot, session and set identities. The original
      adaptive Worker and dual wire contract enabled the 2026-09-09 A/B
      rollout. That completed rollout is historical evidence below.
  - [x] **(b) Authorized canonical Worker and client release**
    - [x] Release A deployed and migration 0045 applied on 2026-09-09;
      completed and deferred checks are recorded below.
    - [x] Release the reviewed canonical Worker and canonical-writing iOS app
      under separate authority. Verify current schema, pending migration
      requirements and canonical route behavior using the release runbook.
      No compatibility cycle or legacy-client support is required.
      September 19: the owner approved production and TestFlight release.
      Migrations 0053/0054 and the canonical Worker are live; build 44 is VALID,
      IN_BETA_TESTING and assigned to internal Testers. The owner explicitly
      deferred authenticated live workout checks to device testing for this
      beta. Those checks remain unperformed, not passed. See the release receipt.
  - [x] **(c) Remove obsolete client and physical-schema compatibility**
    - Owner approved this repository slice on 2026-09-19: remove SQL probing,
      rewriting and schema-change retries, old REST routes, duplicate response
      keys, MCP aliases and outbound legacy iOS fields. Retired inputs must
      fail before mutation; canonical inputs retain the existing write rules.
    - Preserve historical audit names, immutable v1 snapshot restore and old
      persisted cache/outbox decoding. New plan/session caches are canonical;
      durable queued intent keys and attempt tokens retain their storage contract.
    - Export schema v3 exposes `training.workouts` without the retired duplicate
      collection; historical JSON remains verbatim. Keep migration integrity,
      current contract and iOS request tests. The production release guard stays
      in place; removing client support does not authorize migration or deployment.

- [x] **P1 — Ordered sessions per date**
  - Delivered by PR #413, merged to `main` on 2026-11-09. The
    scope audit classifies the date-based assumptions
    and records their verification coverage. The staged release procedure
    separates repository delivery from production authority.
  - Context (2026-11-08): app-design-pass P14 lets a weekday hold
    activities beside its one workout (`plans.meta.schedule.extras`), which
    need no session. This phase widens extras to workouts with exercises, each
    starting in its own later slot on the date. Existing activities remain valid.
  - Migration: add `sessions.slot INTEGER NOT NULL DEFAULT 0`; drop
    `ux_session_user_date`; create `UNIQUE (user_id, date, slot)`. Every
    existing row is slot 0. This ships as two releases because the deployed
    Worker inserts sessions with `ON CONFLICT(user_id, date) DO NOTHING`
    (including freestyle, calendar move and partner start) and
    SQLite rejects that clause once the named index is gone: release A
    deploys a compatibility Worker whose inserts use targetless
    `ON CONFLICT DO NOTHING` or receipt-fenced `ON CONFLICT(id) DO UPDATE`,
    valid under either index; release B runs the
    migration and deploys the slot-aware Worker. A test asserts no
    `ON CONFLICT(user_id, date)` remains in `src/db.ts` before release B. Slot 0 is the **primary** session and keeps
    every current rule unchanged: the attempt CAS, discard revival, the
    `legacy`/`attempt-v1` write protocol, the `0032` trigger (per row, so it
    needs no change). Recovery checkpoints and write outboxes use
    `(user, date, slot)` while decoding historical nil slots as 0.
  - Service layer: every `(user_id, date)` session lookup in `src/db.ts`
    (about eleven) takes an explicit slot and defaults to 0, so existing
    callers see no behavior change. All supported clients use the canonical
    multi-session contract; do not add a `slots` capability or old-client
    filtering. The owner retired legacy-client support on 2026-09-19. `getOrCreateSession`
    gains an `additionalID` mode that inserts at `MAX(slot)+1` for the date,
    keyed by a client-generated session `id` that is the idempotency key:
    a retry with the same `id` returns the committed row and its slot
    instead of allocating again, so a lost response cannot create a
    duplicate workout. Slots are assigned once and never reused. A slot
    above 0 can be
    discarded or skipped like the primary; there is no rule that slot 1
    requires slot 0 to be complete.
  - REST: `POST /api/sessions` accepts `slot` (an exact retry of a known
    slot) or `additional: true` with a required client-generated `id`
    (allocate the next slot, idempotent on that id); `PUT /api/calendar/{date}`
    keeps its current meaning for slot 0 and gains `PUT
    /api/calendar/{date}/{slot}`. Set writes are unchanged because they
    already address a session id.
  - Projection: `projectCalendar` groups real sessions per date instead of
    keeping the first, but `CalendarCell.status` is derived from slot 0
    alone by today's rule (a real non-discarded slot-0 session wins, else
    the weekly schedule, else rest), so the primary-session projection stays stable and
    a discarded slot 0 falls through to the schedule even while slot 1
    survives. A new `sessions[]` array on the cell lists the slots above 0
    that pass the same per-session eligibility predicate slot 0 uses today:
    discarded rows vanish, a `planned` row on a past date vanishes, and
    inside a `can_train_light=false` trip only `in_progress` and
    `completed` rows survive. The predicate is one function applied per
    session, so the two views cannot drift; the earlier idea of a
    cross-slot status precedence is dropped because it would hide the
    fall-through. `CalendarProjection.swift` mirrors the slot-0 rule, the
    shared predicate, and the list, and
    `test/calendar.test.ts` plus `CalendarProjectionTests.swift` add the
    two-session truth table so parity stays byte-for-byte.
  - MCP: `get_today_workout` and `get_session_log` return every session for
    the date, and `get_current_session` returns every in-progress session
    (its `getInProgressSession` query is `LIMIT 1` today) with an optional
    `slot` selector, so Claude can see both active workouts and their sets; `log_set`, `log_workout_complete`, `set_planned_session`, and
    `skip_planned_session` accept an optional `slot` (default 0) and, for
    `log_set`, resolve an omitted slot to the single in-progress session
    when exactly one exists, otherwise to slot 0. The coach brief names
    additional sessions explicitly.
  - iOS: Today lists the date's sessions in slot order with one runner per
    session and an "Add another workout" action (library picker or
    freestyle) that allocates the next slot. The calendar cell shows the
    coarse status with a count badge when more than one session exists; the
    agenda lists each. `WorkoutRecoveryStore` keys its checkpoint by
    `(date, slot)`.
  - Retire the one-session-per-date assumption systematically rather than
    helper by helper. Acceptance for this phase is an audit with zero
    unreviewed hits, recorded in the plan: backend, every
    `WHERE user_id = ?1 AND date = ?2` and every `LIMIT 1` over `sessions`
    in `src/db.ts` (`getSessionByDate`, `getOwnedSessionByDate`,
    `getInProgressSession`, `getLastCompletedSession`, `getRecentSessions`,
    the calendar `byDate` map, group feed and stats, `exportUserData`,
    account deletion, and the sync delta) plus their nineteen call sites in
    the routes and MCP tools; iOS, every `sessionsByDate`, `sessionByDate`,
    `todaySession`, and `.date ==` session comparison in `SyncModel.swift`
    (forty-seven references today), the outboxes, recovery store, and
    projection. Each hit is classified as slot-0-only, all-slots, or
    session-id, and the classification is what the tests assert.
  - Every local session merge becomes session-scoped.
    `SyncModel.mergingSetAcknowledgement`, `mergingTerminalAcknowledgement`,
    `mergingSessionResolution`, `applyTerminalAcknowledgementLocally`, and
    `adoptSessionAliasLocally` today collect every cached session on the
    acknowledged date, drop them all, and re-point their sets at the
    acknowledged session id; with two sessions on a date that collapses the
    other workout and misattributes its sets, and creating slot 1 goes
    through the resolution path, so it would erase slot 0 locally. Match on
    session id (or `(date, slot)` when the server reassigns an id), leave
    sibling slots untouched, audit `SyncModel` for any other same-date
    collection before closing the phase, and cover additional-session
    creation plus the two-session case in `SetOutboxTests` and
    `WorkoutTerminalOutboxTests`.
  - The durable write machinery is also date-scoped today and must move to
    session scope in the same slice: `WorkoutTerminalOutbox` allows one
    intent per date, `SetOutboxStore.remove(date:)` drops every same-date
    set, and `supersedeSetIntentsForDiscardBarriers` treats a discard as a
    date-wide barrier. With two sessions on a date, finishing or discarding
    one would suppress the sibling's terminal action or delete its queued
    sets. Intent envelopes, discard barriers, drain predicates, and
    reconciliation all key on session id (or `(date, slot)`), and the
    two-session tests above cover finish and discard of one slot while the
    other has queued sets.
  - Group feed and stats: each session is one feed item; the daily
    consistency count still counts a date once.
  - Sync: `/api/state` session deltas already carry whole rows, so `slot`
    rides along. The completed
    data-storage-scalability
    cursor contract preserves that whole-row shape without a new cursor.

- [ ] **P2 — Authorized staged production and client rollout**
  - Requires completed P1 delivery and separate owner authority for migration,
    Worker deployment, canaries and client distribution. Follow
    multi-session-release.md; source qualification
    does not establish production or physical-device acceptance.
  - [x] Release A, migration 0073, release B and the web app deployed with
    Nick's written authority on 2026-11-09 (runbook steps 1 to 3; see the
    release receipt).
  - [ ] Live test-member check (runbook step 4).
  - [ ] Full iOS release check on the exact source, then TestFlight (runbook step 5).

## Execution frontier

- P2

## Dependencies

Completed Gym Runner Depth supplies
the shared prescription controls, durable corrections and runner presentation.
Reuse that delivered path when changing the runner.

P1 additional-session authoring preserves the completed atomic prescription writer. During the owner-approved P0 rename rollout, update the released snapshot serializer consistently with the agreed `workouts`/`workout_id` names.

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P1 | feeds | plan:workout-library#P2 | A freestyle session is the most common second session of a day; P2 should allocate a slot rather than fail on the primary. |

## Next step

**Now (@owner):** Pick test-member data for runbook step 4 (primary plus
additional workout on one date, retry the same request, log into both, finish
one and discard the other, offline relaunch on the iPhone). Production serves
release B on migration 0073 as of 2026-11-09. Never roll back
past release A. Release A is a rollback target only while no
additional session (slot above 0) exists; after the first one, roll forward
with a corrected slot-aware Worker.

**Then (@agent):** Confirm the full iOS release check passed on the exact
source before a TestFlight upload of the slot-aware app, then record the build.


## Notes / open questions

- Source: owner request (2026-09-05) following the workout-library plan,
  which recorded both items as constraints it did not address.
- The prior shared released-client capability rule is superseded by the owner's
  2026-09-19 no-legacy-client decision. New slices use one supported contract;
  do not add `slots`, `freestyle` or `archive` projections solely for old clients.
  Existing unrelated group-capability behavior is outside P0(c). Backend/client
  feature availability still requires an ordered, verified release, and persisted
  history must remain readable regardless of client support policy.
- Shared rule, schema changes (generic remote release commands remain guarded): an additive nullable column with a default is safe in one
  release; anything the deployed Worker names in SQL (an index used as a
  conflict target, a table or column rename, a dropped column) needs
  expand-contract with a compatibility Worker deployed first. In these
  plans: `tags`, `archived_at`, `sessions.kind`, `sessions.slot`, and the
  three group columns are additive; the `(user_id, date)` index swap and the
  `workouts` rename are expand-contract and are written up as such above.
- Shared rule, creation under retries: every operation that creates a row
  takes a client-generated id as its idempotency key, matching `set_logs`
  and `sessions`. In these plans that is the additional-session id, the
  workout id in save-as-workout, and the group id in `setGroup`.
- Rejected for P0: a compatibility `VIEW day_templates` over `workouts`.
  Views do not accept the old Worker's writes, so it cannot close the
  release window. The schema-adaptive Worker in release A is the
  expand-contract equivalent for SQLite.
- Rejected for P1: a separate `session_groups` or "training day" table.
  Sessions already carry `date`; an ordinal column is the smallest change
  that preserves every existing single-session guarantee for slot 0.
- Rejected for P1: making `date` plus a start time the key. Civil date is
  the client-owned boundary and the attempt CAS depends on a stable key;
  a time-based key would move on edits.
- P1 uses the existing weekday extras for recurring additional workouts. The
  primary weekday id retains its meaning; no second schedule model is introduced.
- P1 preserves group consistency/streak semantics: each date counts once, while
  feed items and heatmap intensity retain each actual session.
