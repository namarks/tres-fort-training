# WHOOP data in Tres Fort

Slug: whoop · Status: active · Updated: 2026-11-09 · Theme: connected-training

## Goal

A member who wears a WHOOP sees their WHOOP-tracked workouts in Tres Fort
as the sport they were, once, with a load, and (if the owner chooses) their
daily recovery, heart-rate variability, resting heart rate and sleep beside
the plan, all in the app without an AI coach. Done means:

- a workout WHOOP tracked lands in Tres Fort once, even when a watch or the
  run recorder also recorded it, and gets a heart-rate load from the
  member's thresholds;
- WHOOP's own Strain is shown as WHOOP's figure, never treated as a Tres
  Fort load (it is a 0 to 21 scale, not one hour at threshold = 100); and
- recovery and sleep, if built, are private to the member, never in a group
  view, and missing days stay unknown.

## Phases

- [ ] **P0 — Check what a WHOOP wearer's data looks like**
  - With a member who wears a WHOOP (and has allowed it to write to Apple
    Health), look at their Apple Health export and at the Tres Fort rows it
    produced: which WHOOP workouts arrive, with what activity type, heart
    rate and energy, and how they line up with a watch or recorder copy of
    the same session (WHOOP's auto-detected start and end usually differ by
    minutes).
  - Record the findings here and decide whether P1 is enough or P2 is
    needed. No code.
- [ ] **P1 — WHOOP workouts through Apple Health**
  - Name WHOOP as the source of these rows, name the sport (from
    sport-activities P0), and read heart-rate
    samples for WHOOP workouts so they get a load.
  - Dedup a WHOOP workout against a watch, recorder, `.fit` or
    intervals.icu copy of the same session by overlapping time, not only
    the two-minute start match, keeping the richer copy.
  - Tests cover the overlap rule and the source naming.
- [ ] **P2 — Direct WHOOP connection for workouts**
  - Profile → Connections → WHOOP connects and disconnects in the app.
    Credentials live in their own table (not more `users` columns), the
    rotating refresh token is claimed with a compare-and-swap so concurrent
    refreshes cannot drop the connection, and disconnecting removes the
    stored WHOOP rows.
  - A signed webhook route (verify signature and timestamp, then fetch the
    record) plus the existing hourly cron as a backstop write workouts to
    `external_activities` with `source='whoop'`: sport, times, average and
    max heart rate, energy, distance when measured, heart-rate zone times
    and WHOOP's Strain kept as WHOOP's figure. Load comes from the engine's
    average-heart-rate method; nothing is invented when heart rate is
    missing.
  - Dedup ranks a WHOOP workout below intervals.icu, `.fit` and the
    recorder, and above or level with Apple Health, using P1's overlap rule.
  - Up to 10 members can connect before WHOOP approves the app.
  - **Built (2026-11-08), in review:** migration `0070_whoop.sql` adds a
    provider-neutral `provider_connections` table (sealed tokens,
    `token_version` CAS with a 30-second refresh lease, a fresh
    `connection_id` per connect so a sync racing a disconnect writes
    nothing), session-bound `provider_oauth_states` and
    `provider_oauth_completions` (the intervals.icu connect shape), and
    `external_activities.strain`. `src/whoop.ts` is the pure adapter;
    `src/services/whoop.ts` owns the SQL; `/auth/whoop` connects;
    `POST /webhooks/whoop` checks WHOOP's signature and then re-reads a
    window reaching back past the record it names (at least 14 days, at
    most 400; first sync 90 days), which also catches deletions; the
    hourly cron re-syncs anyone not synced in 50 minutes. A WHOOP workout
    yields to a completed Tres Fort session, intervals.icu, `.fit` or a
    recording that covers half of the shorter span, and wins over an Apple
    Health copy. Overlap dedup applies only to WHOOP rows; P1's general
    overlap rule is still open. Not-training WHOOP activities (sauna,
    meditation and the like) are skipped.
  - **Shipped (2026-11-08):** PR #377; migration 0070 applied, Worker, website with the WHOOP privacy text, and
    TestFlight beta 1.1 (72) (release 72).
    Left: a real WHOOP wearer's test.
  - **Heart-rate charts (2026-11-09):** a WHOOP workout's card asks for
    charts like an Apple Health one (`ExternalActivity.mayHaveStreams`).
    The server already serves the readings of the Apple Health copy that
    dedup keeps behind the WHOOP row, in either arrival order; with no
    such copy the card shows no chart. See "Detailed workout data" below.
- [ ] **P3 — Recovery and sleep**
  - A new private daily record per member (migration): recovery score, HRV
    (rMSSD), resting heart rate, sleep duration and performance, from the
    WHOOP connection (and Apple Health sleep and resting heart rate for
    members without one, if the owner wants that floor).
  - Today shows the morning's recovery; Activity → Progress shows the
    trends. Never shown to the group; unknown days stay blank.
  - Reaches the coach brief only after WHOOP confirms the AI question in
    the notes.
  - **Owner decision (2026-11-08):** build workouts plus recovery, HRV,
    resting heart rate and sleep from the direct connection, private to
    the member and shown on Today.
  - **Built (2026-11-08), in review:** `daily_recovery` (migration 0070),
    one row per WHOOP cycle dated by the morning the member woke (sleep end
    in WHOOP's local offset; with no sleep, the cycle start, moved to the
    next day from local noon), with SpO2, skin temperature, respiratory
    rate, in-bed time and the day's strain kept too. `GET /api/me/recovery`
    is the only reader. Today shows that morning's recovery, HRV, resting
    heart rate and sleep under the workout card, and nothing when WHOOP is
    not connected or has not scored today. Shipped 2026-11-08 with P2.
    Left: the Activity → Progress trends, and the Apple Health floor if the
    owner wants it.
- [ ] **P4 — WHOOP app approval past 10 members**
  - The owner submits the app for approval in WHOOP's developer dashboard
    with the privacy policy updated for WHOOP data.

## Execution frontier

- P2
- P3

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P0 | gated_by | external:owner-whoop-wearer | Needs a member who wears a WHOOP to share an export or try the import. |
| P1 | coordinates_with | plan:activity-integration-integrity | Changes cross-source dedup, which that plan owns. |
| P1 | coordinates_with | plan:sport-activities#P1 | Reuses that plan's sport names and heart-rate load for every sport. |
| P2 | gated_by | external:owner-whoop-developer-app | The app is registered under a WHOOP membership in WHOOP's developer dashboard, with its secret set by `wrangler secret put`. |
| P2 | coordinates_with | plan:endurance-training-load | WHOOP workouts are scored by the same load engine. |
| P3 | gated_by | external:owner-whoop-developer-app | Recovery comes from the same WHOOP connection, so it needs the registered app and its secrets. |
| P4 | gated_by | external:owner-whoop-developer-app | Approval is requested from the same developer app. |

## Next step

**Now (@owner):** a member who wears a WHOOP installs the latest TestFlight
beta, connects WHOOP under Profile → Connections, and checks a workout, a
day's recovery and a disconnect. They also turn on Apple Health in Tres Fort
with WHOOP allowed to write workouts to Health, to check that a WHOOP
workout shows a heart-rate chart and how dense its readings are, and record
one run with WHOOP's Heart Rate Broadcast on. The WHOOP developer app is registered
(name Tres Fort, privacy policy `https://tresfort.app/privacy`, redirect
`https://tres-fort.nmarkspdx.workers.dev/auth/whoop/callback`, webhook v2
`https://tres-fort.nmarkspdx.workers.dev/webhooks/whoop`, every read scope
plus `offline`) and its secrets are set.

**Shipped (2026-11-08):** with the owner's go-ahead, migration 0070, Worker, the website's WHOOP privacy text and beta
1.1 (72) (release 72).

**Unparked (owner, 2026-11-08):** the owner asked to set up WHOOP and
chose workouts plus recovery from a direct connection, so P2 and P3 were
built ahead of P0 and P1.

## Detailed workout data (2026-11-09)

The owner's main reason for the integration is capturing the workouts of
members who record with a WHOOP, so how much heart-rate detail reaches
Tres Fort matters more than recovery trends.

- **WHOOP's API:** summaries only, for every app and at every approval
  level: average and max heart rate, time in six zones, energy, distance
  and strain. No reading-by-reading heart rate and no GPS route.
- **Apple Health:** WHOOP's help page lists workouts and "heart rate during
  activities" (not all-day heart rate, not HRV) among what it writes. The
  app's Apple Health import keeps every heart-rate reading in a workout's
  window, so the Health copy of a WHOOP workout carries WHOOP's readings.
  Dedup (same kind, starts within two minutes) keeps that copy behind the
  WHOOP row, and the streams endpoint reads a hidden copy's series. How
  often WHOOP writes a reading is unconfirmed; a wearer's phone answers it.
- **Heart Rate Broadcast:** WHOOP straps broadcast the standard Bluetooth
  heart-rate service, which the run recorder's strap search uses, so a
  WHOOP appears as a strap. A run recorded that way has reading-by-reading
  heart rate, the route and laps, and the WHOOP copy of it yields to the
  recording. Runs recorded in the app only; the recorder is beta-only until
  its device checks pass.

## Notes / open questions

- AI use: WHOOP's terms forbid training models on WHOOP data. Tres Fort
  trains nothing, but its coach tools pass a member's data to the member's
  own AI app. Until WHOOP says that is allowed, WHOOP-sourced fields stay out
  of MCP tools and the coach brief, the same stance as the Garmin request.
  Every WHOOP feature works in the app without AI, so this costs no member
  feature.
- Group feed: WHOOP-sourced workouts follow the member's existing activity
  sharing choice only after the terms are checked for showing one member's
  data to others; until then they are private.
- WHOOP's heart-rate zones are its own (percent of max heart rate), not the
  member's threshold zones, so they are shown as WHOOP's zones and not used
  for load.
- Related plans: the sport-activities plan names sports and scores heart
  rate for every sport, which P1 reuses; Garmin's
  Starter request (endurance-training-load P5) would be a second direct
  connector, so P2's credentials table should not be WHOOP-specific.
- Without both WHOOP secrets the connection is dormant: `/auth/whoop/start`
  answers 503, the webhook answers 401 and the cron skips WHOOP.
- Production migration, Worker deployment, new secrets, new Apple Health
  permissions and client distribution each need the owner's separate
  go-ahead; a new data source changes the App Store privacy answers.
