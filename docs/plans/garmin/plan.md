# Garmin data in Tres Fort

Slug: garmin · Status: active · Updated: 2026-11-18 · Theme: connected-training

## Goal

A member who records with a Garmin watch or bike computer connects Garmin
once in the app and sees each new Garmin workout in Tres Fort, once, as the
sport it was, with the same detail a `.fit` upload gives (heart rate, power,
pace, route, laps) and a load, without intervals.icu and without an AI
coach. Done means:

- Profile → Connections → Garmin connects and disconnects, and a Garmin
  disconnect made on Garmin's side is honored;
- a workout recorded on Garmin lands in Tres Fort once, even when
  intervals.icu, Apple Health or the run recorder also has it, and is
  scored by the existing load engine;
- Garmin-sourced data stays private to the member and out of MCP tools and
  the coach brief until Garmin's terms are read for that use; and
- the connection keeps working if intervals.icu stops passing Garmin data
  through its API.

## Phases

- [x] **P0 — Confirm Garmin's API contract** (2026-11-08; details stay with the owner)
  - The owner reviewed Garmin's developer documentation and agreement.
    They are confidential and stay out of this repository; only the
    resulting design decisions appear here.
- [x] **P1 — Connect and disconnect** (released 2026-11-08)
  - Extend `provider_connections` and the connect tables to `garmin` in a
    new migration. `/auth/garmin` runs the same session-bound round trip as
    WHOOP, adding the PKCE verifier to the sealed state. The callback
    stores Garmin's user id and the granted permissions.
  - Profile → Connections → Garmin shows connected, missing permission or
    disconnected. Disconnecting in the app deregisters with Garmin and
    deletes the stored Garmin rows. A `deregistrations` notification does
    the same, and a `userPermissionsChange` that removes activity access
    marks the connection.
  - Dormant without `GARMIN_CLIENT_ID` and `GARMIN_CLIENT_SECRET`, like
    WHOOP.
- [x] **P2 — Garmin workouts** (released 2026-11-08)
  - Notification endpoints are reachable only at an unguessable path secret
    the owner configures in the portal, and act only for a connected Garmin
    user id. If Garmin's calls are unsigned, data is taken from Garmin
    rather than the body wherever the contract allows: an activity file is
    fetched from its `callbackURL` only when the URL is on Garmin's API host,
    with the member's token.
  - An activity file goes through the `.fit` pipeline and lands in
    `external_activities` as `source='garmin'`, with heart rate, power
    and the sport. Load comes from the existing engine. Only activity
    files are read: a workout Garmin sends without a file (one typed into
    Garmin Connect, for example) does not arrive yet, and routes and laps
    are not stored yet.
  - Dedup: an intervals.icu copy of the same workout stays canonical while
    intervals.icu still sends it. A Garmin row ranks with `.fit` above
    Apple Health and yields to the run recorder.
  - Garmin rows stay private and out of MCP tools and the coach brief,
    whatever the member's activity sharing choice, until P0 records that
    the terms allow otherwise. Each Garmin row shows Garmin attribution and
    the device model.
  - Tests cover connect and deregistration, path-secret and user checks,
    the callback host check, idempotent re-delivery, dedup against
    intervals.icu and Apple Health copies, and exclusion from MCP and
    group views.
  - Built as: migration `0071` (provider tables accept `garmin`, the
    connect state keeps the sealed PKCE verifier, and
    `garmin_activity_files` queues each announced file with its sealed
    one-time link), `src/garmin.ts` (adapter), `src/services/garmin.ts`
    (connection, queue and import), `/auth/garmin`, `GET`/`DELETE
    /api/me/garmin`, and `POST /webhooks/garmin/:secret`, which checks the
    path secret, Garmin's client id header and Garmin's source addresses,
    queues files, answers, then imports them. The hourly cron retries a
    failed download while its link lasts. Files are imported through the
    `.fit` pipeline as `source='garmin'`; Garmin's FIT has no route stored
    yet. iOS: Profile → Connections → Garmin (`ios/TresFort/Garmin/`).
- [ ] **P3 — Release**
  - The privacy policy gains a Garmin section (use, Cloudflare hosting, no
    sale, no AI training or evaluation). Done in `website/privacy.mjs`.
  - The owner completes Garmin's launch requirements, sets the secrets,
    configures the endpoints in Garmin's portal, and gives separate
    go-aheads for the migration, Worker, website and TestFlight build. The
    owner connects a Garmin account and checks a run, a ride and a
    disconnect.
  - Released to the server on 2026-11-08 on the owner's written go-ahead
    (migration `0071`, Worker and website with the Garmin privacy section).
    An internal TestFlight beta carries the Garmin connection and the Garmin
    Connect tile; it is not an App Store build.

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P1 | coordinates_with | plan:whoop | Reuses and extends the WHOOP connection tables and connect flow. |
| P2 | coordinates_with | plan:activity-integration-integrity | Changes cross-source dedup, which that plan owns. |
| P3 | gated_by | external:owner-garmin-release | Secrets, portal endpoint setup, migration, deploys and TestFlight each need the owner. |

## Next step

**Now (@owner):** members get Garmin no earlier than 2026-12-08, after
Garmin's launch requirements are met (details stay in the private
maintainer records). The owner connected a Garmin account on the internal
beta; next, check a run, a ride and a disconnect on TestFlight 83 or later,
and update the App Store privacy answers before an App Store version ships
Garmin. App Store 1.2 must keep Garmin hidden until then.

## Notes / open questions

- A member sees Garmin workouts from the day they connect. Earlier ones
  still come from intervals.icu, a `.fit` upload or Apple Health.
- If intervals.icu keeps passing Garmin data, the same workout arrives
  twice. Keeping intervals.icu canonical changes nothing members already
  see, and the Garmin row takes over when intervals.icu stops.
- The intervals.icu copy of a Garmin workout already reaches MCP with
  Garmin attribution through intervals.icu; this plan does not change that.
- Garmin data stays out of group views and MCP. Any change to that needs
  the owner to confirm it against Garmin's terms first.
- Production migration, Worker deployment, new secrets, portal endpoint
  changes and client distribution each need the owner's separate go-ahead.
  A new data source changes the App Store privacy answers.
