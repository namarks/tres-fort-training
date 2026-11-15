# Owner diagnostics

A fixed list of read-only lookups of the owner's own production data, so a
problem can be diagnosed without querying D1 by hand from the Mac mini.
Added 2026-11-11 at the owner's request, after diagnosing an auto-pause
report took several production queries through Remote Control.

No plan covers this; it is operational tooling, and the recorder data it
reads is run-recorder P5(e) (historical maintainer record).

## Two doors, the same lookups

| Door | Who | Auth |
|---|---|---|
| `GET /diagnostics/<lookup>` on the API Worker | the owner's Claude threads | `Authorization: Bearer $DIAGNOSTICS_TOKEN` |
| **Diagnostics** tab of the web app (`#diagnostics`), reading `GET /api/me/diagnostics/<lookup>` | the owner, signed in | the owner's own app session |

- `DIAGNOSTICS_TOKEN` is a Worker secret of at least 32 characters
  (`openssl rand -base64 33`, then `wrangler secret put DIAGNOSTICS_TOKEN`).
  Unset or shorter, `/diagnostics/*` answers 404. It never opens `/api` or
  `/mcp`, and the app and MCP bearers never open `/diagnostics`.
- Both doors resolve to the distinguished owner (`findOwnerRow`) and read
  only the owner's rows, except [problem reports](#problem-reports), which
  are every member's. Any other member's session gets the 404 an unknown
  route returns, and so does an App Review session.
- Every lookup writes an `audit_log` row (`tool = 'diagnostics_read'`,
  `actor` `diagnostics`, `web` or `ios`, `args` naming the lookup). The
  audit lookup leaves those rows out of its own answer.
- Responses are `Cache-Control: no-store`. Nothing writes training data.

## What stays out

These lookups exclude activities with source `garmin` or `whoop`, Garmin
activity files, and WHOOP recovery. Lists skip those activities;
`activities/:id` returns 403 `restricted_source`; copies lists skip them too.
Other members' data is reachable only when a member sends it in a problem report.

## Lookups

Day windows count back from today in UTC with one day of slack, so `days=1`
always covers the owner's local today.

| Lookup | Returns |
|---|---|
| `/` | this list |
| `/recordings?days=1..90` (14) | runs recorded in the app, newest first, with route, lap, heart-rate, pause and GPS-fix counts and `state` |
| `/activities?days=1..90` (14) | every other source's activities (not Garmin or WHOOP), with `state`, plus activities logged by hand |
| `/activities/:id` | one activity in full (all columns, provider `raw` parsed), the copies dedup linked to it either way, and for each recorded or Apple Health run among them: route segments (a pause starts a new one), laps, heart rate on moving time, and the recorder's pauses (`tapped` or automatic, with durations), "Pause when I stop" and every GPS fix's speed and accuracy, and its motion level (`motion_g`) from builds that send one |
| `/sessions?days=1..90` (14) | workout sessions by date and slot, each with every set, soft-deleted sets included (`deleted: true`) |
| `/audit?days=1..30` (7) | audit records newest first: plan changes, coach writes and other recorded actions |
| `/sync` | intervals.icu connection and sync timestamps and attempts, and per-source counts for the last 30 days |
| `/reports?days=1..90` (30) | problems every member reported from the app, newest first: kind, message, reply address, app version, build, OS and device, whether a screenshot came with it, and the attached activity's access (`open` until a time, or `expired`) |
| `/reports/:id` | one report, and its attached activity in full (as `/activities/:id`) while the member's 14 days last; otherwise `activity.available: false` with `consent_expired`, `deleted_by_member` or `restricted_source` |
| `/reports/:id/screenshot` | the report's screenshot (JPEG or PNG) |

### `state`, and the trap it removes

Dedup hides a row by setting `deleted_at` AND `duplicate_of` (the copy it
was merged into); a member's own delete sets only `deleted_at`. Filtering
on `deleted_at IS NULL` therefore hides a recorded run whose intervals.icu
copy won. Every row says which it is:

- `shown`: `deleted_at IS NULL`
- `merged_into_copy`: `deleted_at` and `duplicate_of` set; open the copy
  (`duplicate_of`) to see both
- `deleted_by_member`: only `deleted_at` set

## Problem reports

Members send a report from the app (migration 0077): **Profile > Help >
Report a problem**, or **Something wrong?** on an activity, which attaches
that activity. `POST /api/me/problem-reports` (multipart; fields in
`src/problemReports.ts`) keeps:

- the kind (`bug`, `activity`, `feedback`), the member's message (up to
  4,000 characters) and an optional reply address;
- an optional screenshot, a JPEG or PNG of at most 1 MB, kept in its own
  table so listing never reads it;
- the app version, build, OS version, device model (such as `iPhone14,2`,
  never the device's name) and the screen the report started from;
- an optional activity. Sending it is the member's consent for support
  (Nick and the AI tools he uses) to read that activity's details for 14
  days: `activity_access_until`. After that, or once the member deletes the
  activity, only the report stays readable. Garmin and WHOOP activities can't
  be attached: the app doesn't offer them, and the server keeps the report
  without one (`activity_ignored: restricted_source`).

The client id makes a retry the same report. A member can send 20 a day.
Reports are exported with the member's account and deleted with it. Every
read of a report writes an `audit_log` row naming the report and the member.
There is no alert yet: check the reports lookup, or the Diagnostics tab.

## Members

The owner's **Members** tab of the web app (`#members`), added 2026-11-13
when the owner asked which version beta testers run and how they use the
app. It reads `GET /api/me/diagnostics/members?days=1..365` (30) with the
owner's own app session only: the diagnostics token gets a 404, so other
members' usage never reaches the owner's Claude threads. Every read writes a
`diagnostics_read` audit row (`lookup: members`).

What it shows, per member, newest use first:

- the app builds, web and AI coaching connections they used, each with when
  it was first and last seen, and the iOS version the latest build ran on;
  App Store builds (55 = 1.0, 70 = 1.1, listed in `web/src/members.ts`) are
  told apart from TestFlight ones;
- the days in the window they used any of them;
- what they did in the window, and all-time for the main actions: workouts
  finished, sets logged, runs recorded in the app, Apple Health workouts,
  `.fit` imports, intervals.icu activities, activities logged by hand, plan
  changes (app, web or AI coach), AI coach changes and problems reported;
- what they have set up now: saved workouts, a weekly routine, a block, an
  event goal, groups, and whether Apple Health, intervals.icu, WHOOP, Garmin
  and an AI coach are connected. Garmin and WHOOP appear only as connected
  or not; none of their data reaches a count.

### Where use comes from

Migration 0078 adds `member_app_use` (member, client, build: first and last
seen, iOS version) and `member_active_days` (member, UTC day, client).
`recordAppUse` (`src/services/memberUsage.ts`) writes them from
`requireAppJwt` for every signed-in `/api` request (`ios`, or `web` for a
web session) and from `/mcp` for a coaching connection (`coach`), at most
once per member, client and build every five minutes per isolate. A failed
write is logged and never fails the request, so the Worker can ship before
the migration.

The build and iOS version come from the User-Agent iOS sends by default
(`TresFort/81 CFNetwork/… Darwin/25.1.0`), so every build, including App
Store builds 55 and 70, reports it with no app update. The iOS version is
derived from Darwin's and can read a point release low. Web and coach rows
have no build. Nothing records request paths, screens or IP addresses.

Use before the release is not in these tables: the page says from when app
use is recorded. Workouts, activities and setup come from the training
tables and go back to the start. Both tables are in the member's account
export and are deleted with the account. The privacy policy's "Technical
information" item describes them.

## From a Claude thread

```bash
curl -sS -H "Authorization: Bearer $TRES_FORT_DIAGNOSTICS_TOKEN" \
  "https://tres-fort.nmarkspdx.workers.dev/diagnostics/recordings?days=3"
```

The cloud environment needs the token (under Network secrets for that host
where offered, otherwise the `TRES_FORT_DIAGNOSTICS_TOKEN` environment
variable) and `tres-fort.nmarkspdx.workers.dev` under Allowed domains.

Lookups are the only production reads a thread should need for the owner's
own data and for problem reports. Anything beyond them (another member's
data they didn't send in a report, Garmin or WHOOP rows, ad hoc SQL) still
goes through the Mac mini with the owner's written OK.
