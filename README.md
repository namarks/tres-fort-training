# Très Fort Training

**Everything you train. One plan.** Très Fort is a training platform for people
who lift *and* run, ride, swim or do anything else. Strength workouts, endurance
sessions and imported activities share one plan and one calendar; a **native iOS
app** guides every set and every planned run; private groups and the iPad
Station let you train with other people. A **Cloudflare Worker + D1** is the
single source of truth.

Every feature works in the app on its own. AI is optional: connect Claude,
Codex or another MCP app and it reads and edits the same plan through the same
versioned writers, with every change recorded and reversible.

- **Lifting:** reusable workouts, a guided set-by-set runner, rest timers on the
  Lock Screen, supersets and circuits, timed holds, warm-ups, history and charts.
- **Endurance:** an iPhone run recorder with planned pace and heart-rate steps
  (beta), runs, rides and swims typed in by hand, and activities imported from
  Apple Health (which Garmin Connect, Strava and others write to) or
  intervals.icu.
- **Planning:** a weekly schedule, one-off swaps and skips, trips, races and
  phases, with full plan version history and restore.
- **Together:** private groups with a shared feed, and the iPad Station where
  two people train one workout, each logging to their own phone.

```
   Your AI app (optional)    iOS app (SwiftUI)
        │  MCP                      │  REST + Sign in with Apple
        ▼                           ▼
        └────────► Cloudflare Worker + D1 ◄────────┘
                   (single source of truth)
```

> Full design rationale, schema, and API/MCP surface: [`docs/DESIGN.md`](docs/DESIGN.md).

## Contributing locally

Start with the [contributor setup guide](CONTRIBUTING.md). You can contribute
without running every component:

| Work | Local setup |
| --- | --- |
| Backend, REST API, or MCP | Node.js and the local Workers/D1 tests |
| iOS screens and interactions | macOS and Xcode; use fixtures or the local backend |
| Web app | Node.js; see the [web guide](web/README.md) |
| Documentation and reviews | Git and an editor |

The backend tests and iOS fixtures use synthetic data and need no production
credentials. The guide includes a local API server, simulator fixtures,
Debug simulator test login against that local server, focused checks, and the
pull request workflow.

## Core architecture

### 1. Backend — Cloudflare Worker + D1
One Worker (Hono) over a D1 (SQLite) database. Tables: users, exercises,
plans, workouts, template_exercises, sessions, set_logs, notes,
audit_log, oauth_*, intervals_oauth_states, groups, group_members,
group_invites, external_activities, activities, external_events,
session_load_exports. Plan tree is a **versioned document** (optimistic
concurrency); sets/notes are an **append-only event log** (client-UUID
idempotent, offline-safe). Corrections and session attempts have explicit
concurrency guards; sync merges deltas and tombstones by stable ID.

- REST API for the iOS app (`/api/*`), authenticated with a Worker-issued
  app JWT.
- `GET /api/state` is the single sync pull (versioned plan + session/set
  deltas).

### 2. MCP server — how AI apps read/write
A Streamable-HTTP MCP server at `/mcp` exposing the same service layer:

- **Read:** `get_coach_brief`, `get_current_plan`, `get_today_workout`, `get_current_session`,
  `get_session_log`, `get_history`, `get_volume_trend`, `list_exercises`,
  `get_upcoming_rides`, `get_recent_activities`, `get_group_feed`
- **Write:** `log_set`, `correct_set`, `delete_set`, `log_activity` (endurance types go to
  intervals.icu, the rest to the local log), `delete_activity`, `rate_activity` (the member's 1–10 effort),
  `log_workout_complete`,
  `discard_workout` (explicit session ID and expected attempt; soft-deletes its sets),
  `add_note`, `update_plan` (transactional, `expected_version` → structured
  `{conflict, current_version}` result on mismatch), `update_exercise`,
  `swap_exercise`, `add_exercise`, `add_workout`, `add_one_time_workout` (a copy for one date),
  `update_workout`, `delete_workout`, `delete_exercise`, `adjust_today`, `set_schedule`,
  `set_planned_session`, `skip_planned_session`, `set_race`,
  `set_periodization`, `add_trip`, `update_trip`, `remove_trip`,
  `set_stress_model`, `refresh_rides`
- **Resource:** `coach://state/current` — a compact brief clients can read at
  chat start. Plus a `coach_brief` prompt.

Writes record an `audit_log` trail; plan changes also record a coaching note.
`discard_workout` uses the shared discard audit and an identical retry adds no
second entry. These records preserve per-user attribution across clients.

**Auth (dual):**
- **Static bearer** — operator-only access; never distributed to members.
- **OAuth 2.1** (RFC 9728 / 8414 / 7591, PKCE, refresh, per-user
  connect-code or mobile approval) — for Codex, Claude, and other compatible remote MCP clients.

### 3. iOS app — the gym executor
SwiftUI, iOS 17+, XcodeGen-managed. A guided **workout runner**:

- Sign in with Apple → app JWT.
- Overview → **START** → one exercise at a time: progress bar, jump pills
  (reorder on the fly when a rack's taken), inline steppers, auto-advance.
- Full-screen rest overlay; **Live Activity** rest timer on the Lock Screen
  / Dynamic Island (local, no push); a chime + haptic + spoken cue when rest
  ends (headphones-friendly, default on).
- **Edit workout** sheet (from Today or the runner's overflow menu): add /
  remove / reorder exercises and warm-ups in place — writes straight to the
  same versioned plan tree your coach edits.
- Whole-workout stopwatch + per-set duration; **timed exercises** (planks/
  holds) become a START SET countdown that auto-logs.
- Account-scoped JSON snapshots and durable outboxes in UserDefaults provide
  cached browsing and safe retries. SyncModel publishes in-memory state; it
  does not use SwiftData. Disposable indexes accelerate history queries.
- History tab with Swift Charts (estimated-1RM and set-duration trends).
- Type set in Bebas Neue + JetBrains Mono.

## Layout

```
src/                TypeScript Worker (Hono): REST + MCP + OAuth
migrations/          D1 schema + seed
test/                vitest integration tests (real D1 in Workers runtime)
ios/                 XcodeGen project (app + Live Activity widget extension)
web/                 signed-in React web app + Worker gateway
website/             public website
CONTRIBUTING.md       backend and iOS simulator setup, checks, PR workflow
docs/DESIGN.md       system design doc
THIRD_PARTY_NOTICES.md third-party artwork, font and dependency notices
```

## Connect an AI app (optional)

Open the iOS app → **Profile → Coach → Set up your AI coach**. Choose Codex,
Claude, or Other compatible app, review the data-sharing disclosure, and generate
a personal connect code. Enter that code only on the Très Fort consent page.
Every member uses their own account; no operator secret or group membership is needed.

For Codex, add the server through the desktop app's **Settings → Plugins → Add →
Add MCP server** form (older versions use **Settings → MCP servers**). Choose
**Streamable HTTP**, enter the URL shown in setup, save and authenticate.
Terminal commands are optional under **Advanced**. This desktop connection does
not install a hosted plugin for ChatGPT on iPhone or the web; a full mobile
install-and-authorize button requires publishing the integration in the provider's
directory. See the connection guide for that delivery path.

Claude setup uses its custom-connector settings. Other apps must support remote
Streamable HTTP MCP, OAuth discovery, Dynamic Client Registration, PKCE S256,
and refresh tokens. A model name or API key alone is not a connection.
[Connection guide and compatibility checks](docs/COACH-CONNECTIONS.md).

Start a conversation with “Use Très Fort to load my coaching brief.” The coach
reads the same plan and history as the app. Ask explicitly for changes; logging
sets in iOS does not authorize the coach to duplicate those logs.

### Product and usage model

The free product lets members bring their own supported AI accounts or subscriptions.
Conversations and model execution stay in their chosen app, under that app's
availability, billing and usage limits. Très Fort supplies authenticated data tools
and pays its own infrastructure costs; it does not supply model API credits.
A future paid package could include in-app coaching and API usage if economics
support it. No in-app model runner, provider key storage, pricing, or billing is
implemented or enabled by this version.

### Connection lifecycle

Multiple AI apps can connect to one member's plan. Profile reports aggregate coach
access. **Disconnect all AI apps** revokes that member's OAuth connections,
while preserving training records and other members' connections. Rotating the
connect code does not revoke existing grants. Removing the connection cannot
remove information already retrieved into an AI conversation.

## Deployment and distribution

Backend tests, a local API server, and synthetic simulator fixtures do not
require a Cloudflare account, production secrets, Apple signing credentials,
or a TestFlight upload. `.env.example` describes operator authentication for
Cloudflare; it is not a contributor setup template.

Production migrations, Worker deployments, and client distribution each require
separate owner authorization and the maintainer's reviewed release procedure.
Production credentials and private operational records are not contributor
setup inputs.
Before a TestFlight or App Store upload, the
[iOS release check](docs/IOS-VERIFICATION.md#release-check) must pass on the
exact source commit. A green contributor simulator check is not a release receipt.

## Further reading

- [System design](docs/DESIGN.md) — data model, authentication, and API/MCP contracts.
- [iOS verification](docs/IOS-VERIFICATION.md) — fixtures, retained evidence, and CI coverage.
- [Third-party notices](THIRD_PARTY_NOTICES.md) — artwork, fonts and other separately licensed material.

## License

This repository is **source-available**, under the [Très Fort Source-Available
License](LICENSE). You may inspect, modify, build, run and test it for technical
evaluation, bug reproduction and contributions to this project, using local or
hosted development systems. Broader reuse, redistribution, production hosting,
and routine personal training with a self-built installation require separate
written permission from **nick@tresfort.app**. This is not an open-source license.
GitHub's independent platform rights and applicable statutory rights remain
unchanged.

Contributors retain their copyright and grant Nicholas Marks rights to use,
commercialize and relicense accepted work under the [contributor
terms](CONTRIBUTOR-TERMS.md), including transfer of those rights to a future
company. Follow the [private acceptance process](docs/CONTRIBUTOR-ACCEPTANCE.md)
before the first contribution is merged. A pull-request checkbox is not an
agreement.

Third-party components retain their own licenses. The [third-party
notices](THIRD_PARTY_NOTICES.md) identify the CC BY-SA exercise drawings,
Unlicense exercise material, and OFL fonts; the source license does not add
restrictions to those separately licensed materials.

Use the private channels in [SECURITY.md](SECURITY.md) for personal information,
raw feedback, or vulnerability reports. GitHub discussions and screenshots
must be suitable for public viewing.
