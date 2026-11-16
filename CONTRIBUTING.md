# Contributing to Tres Fort

You only need to run the components your change touches. Backend work can be
tested without Xcode; iOS screens can run with synthetic data or connect to
your local backend. Documentation and code review need neither.

## Get the code

Read the [source license](LICENSE) and [contributor terms](CONTRIBUTOR-TERMS.md)
before contributing. The source license permits technical evaluation and
contribution work, including local builds and tests. It does not grant general
reuse or production hosting permission. Third-party licenses still apply.
Contributor access does not include production accounts or signing credentials.

Fork `namarks/tres-fort-training` into your GitHub account, then clone your fork:

```bash
git clone https://github.com/YOUR-USERNAME/tres-fort-training.git
cd tres-fort-training
git remote add upstream https://github.com/namarks/tres-fort-training.git
git switch -c yourname/short-description
```

Replace `YOUR-USERNAME` with your GitHub username. Target
`namarks/tres-fort-training:main` with your pull request. You do not need write
access to the official repository to propose a change.

Commands below run from the repository root unless stated otherwise. Read
[AGENTS.md](AGENTS.md) for repository conventions and
[docs/DESIGN.md](docs/DESIGN.md) before non-trivial backend work. Visual changes
follow [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md).

Before your first contribution can merge, accept the terms by commenting
"I accept the Très Fort Contributor Terms version 1.1." on your pull request
(see [contributor acceptance](docs/CONTRIBUTOR-ACCEPTANCE.md)). You comment once,
not on every pull request. You keep your copyright; accepted contributions grant Nicholas Marks the
commercialization, sublicensing and transfer rights described in the terms.
Do not post signatures, employer authorizations or identity documents in a PR.

### Keep support data private

Use local synthetic accounts and the simulator fixtures below. Do not copy
production databases, user workouts, health measurements, routes, support
emails, TestFlight feedback, or provider payloads into code, tests, issues,
PRs, screenshots, logs, or CI artifacts. Reproduce bugs with test data and
capture a new screenshot. Removing an email address from a real screenshot
does not necessarily remove the private information in it.

Raw reports stay in App Store Connect, the app's private support system, or
private operator storage. Use [SECURITY.md](SECURITY.md) for private contact;
there is no private ordinary-issue channel inside a public repository.

## Backend: install and test

Install Node.js and npm, Bash, and `sqlite3`. CI uses Node 20; use that version
when reproducing CI. Check that the tools are on your PATH:

```bash
node --version
npm --version
bash --version
sqlite3 --version
```

Install the locked dependencies and run the checks:

```bash
npm ci
npm run typecheck
npm test
```

`npm test` runs the shared prerequisite checks, the website and web checks, and
all three backend test shards. It installs the web app's dependencies as part
of that run. The backend tests apply the repository migrations to isolated
local D1 databases in the Workers runtime and supply their own test bindings
and credentials through [vitest.config.ts](vitest.config.ts). They do not need
`.env`, `.dev.vars`, a running dev server, or access to a Cloudflare account.

For a shorter feedback loop:

```bash
npm test -- test/mcp.test.ts       # prerequisites + one backend test file
npm test -- --shard=2/3           # prerequisites + one backend shard
npm run test:watch               # Workers/Vitest watch mode
```

Keep data behavior in the shared service layer: REST and MCP must behave the
same way. New schema changes use a numbered migration, and behavior changes
should have appropriate regression coverage.

### Optional: run the API server locally

This is useful for trying REST or MCP requests manually. It is separate from
the test databases and from the iOS fixture mode below.

Create `.dev.vars` in the repository root with these **local-only sample
values** (the file is ignored by Git):

```dotenv
APP_JWT_SECRET=local-only-jwt-secret-do-not-deploy
DEV_AUTH_SECRET=local-only-dev-secret
MCP_STATIC_TOKEN=local-only-mcp-token
```

Do not copy production credentials. `.env.example` is for Cloudflare operator
authentication and is not needed here. Leave optional provider credentials
unset; real Apple/provider authorization is not part of this setup.

Prepare the local database, then start the Worker:

```bash
npm run db:setup:local
npm run dev -- --port 8787
```

`db:setup:local` applies migrations and activates the workout-write protocol
required by the iOS app. Both commands inside it explicitly use `--local`; it
is safe to repeat after pulling new migrations. Migrations alone leave that
protocol disabled and workout session/set writes would return
`write_protocol_not_active`.

Wrangler runs the Worker and emulates its D1/R2 bindings locally. The committed
resource IDs can stay as they are; no remote database creation or deployment is
needed. Local database state persists under ignored `.wrangler/` storage.

In a second terminal, create/sign in as the synthetic local owner:

```bash
curl --fail-with-body http://localhost:8787/auth/dev \
  -H 'Content-Type: application/json' \
  --data '{"secret":"local-only-dev-secret"}'
```

Expect JSON containing `jwt` and `user`. Use the returned JWT as
`Authorization: Bearer <jwt>` for `/api/*` requests. For `/mcp`, use the local
`MCP_STATIC_TOKEN` as the bearer instead. `/auth/dev` is available only while
`DEV_AUTH_SECRET` is configured; never configure it in production. Restart
the dev server after editing local bindings. Stop it with Ctrl-C when done.

The exercise catalog is seeded by migrations; your local account starts
without a training plan. For a browser interface to this local API, follow
the [web app's local setup](web/README.md#running-it-locally).

## iOS: run in the simulator

### Tools

Use a Mac with full Xcode, an installed iOS simulator runtime, XcodeGen, and
Python 3. Node/npm is only needed for the verification command below, not for
opening the app in Xcode. The pinned CI toolchain is Xcode 26.3, XcodeGen
2.45.3, and the iOS 26.2 simulator runtime; see
[iOS verification](docs/IOS-VERIFICATION.md) for the maintained baseline.

After opening Xcode and completing its first-launch setup, verify:

```bash
xcodebuild -version
xcodegen --version
python3 --version
xcrun simctl list runtimes
```

If `xcodebuild` reports only Command Line Tools, select the full Xcode
installation in **Xcode → Settings → Locations → Command Line Tools**.
Install a missing iOS runtime through Xcode's Components settings.

### Generate the project and choose synthetic data

From the repository root:

```bash
cd ios
xcodegen generate
open TresFort.xcodeproj
```

The first generation downloads and verifies the pinned public MediaPipe
dependencies into ignored `ios/.dependencies/`; it needs internet access but
no account credentials. Details and the public App Store build variant are in
[ios/Dependencies/README.md](ios/Dependencies/README.md).

In Xcode:

1. Select the **TresFort** scheme, not the widget extension, and an iPhone
   simulator destination. Prefer a fresh simulator for contributor walkthroughs.
2. Open **Product → Scheme → Edit Scheme → Run** and use the **Debug** build
   configuration.
3. Under **Arguments → Environment Variables**, add and enable
   `TRESFORT_UI_FIXTURE` with value `ordinary`.
4. Run with **Product → Run** (Command-R). You should see the synthetic fixture
   banner and a populated workout, without an Apple sign-in prompt.

`ordinary` exercises the workout flow. Change the value to `empty`,
`onboarding`, or `pending` to inspect those states; `app-store` offers a
broader populated tabbed demo. Stop and relaunch to change scenarios. Most
fixture launches reset their synthetic data, so do not expect edits to survive
a relaunch.

These fixtures use real views and `SyncModel` over a bounded in-memory API
stub. They do not start a Worker, contact the live API, or use your Keychain
credentials. Unsupported fixture requests fail rather than reaching a real
server. See the [fixture contract](docs/IOS-VERIFICATION.md#synthetic-ui-fixtures).

**Keep the fixture variable enabled for the synthetic walkthrough.** To test
the actual backend, switch to the local mode below. With neither mode enabled,
[Config.swift](ios/TresFort/Config.swift) points at the live Worker. Both
development modes are compiled only into Debug simulator builds; they are
unavailable on a physical iPhone or in Release builds. Real Apple sign-in,
provider integrations, and hardware behavior need separate validation.

The project is generated from `ios/project.yml`. Regenerate after changing that
file; do not commit `TresFort.xcodeproj` or personal scheme settings. Simulator
verification supports unsigned builds and needs no Apple Developer team access.
If Xcode requests provisioning, first confirm that the destination is a
simulator; the verification command below explicitly disables signing. Physical
device signing and distribution are separate setup work.

### Connect the simulator to your local backend

Use this mode when testing a change across the iOS app and the real REST/D1
backend. It uses the normal app, sync, persistence, and onboarding paths with
your local database, rather than synthetic fixture responses.

1. Complete [the local API setup](#optional-run-the-api-server-locally), including
   `.dev.vars` and `npm run db:setup:local`. Leave
   `npm run dev -- --port 8787` running in a terminal on the same Mac as Xcode.
2. Run `xcodegen generate` in `ios/` and open `TresFort.xcodeproj`. Select the
   **TresFort** scheme, **Debug**, and an iPhone simulator. The generated Debug
   simulator configuration allows local HTTP; Release and device builds keep
   their existing network policy.
3. In **Edit Scheme → Run → Arguments → Environment Variables**, disable or
   remove `TRESFORT_UI_FIXTURE`, then add and enable:

   | Name | Value |
   | --- | --- |
   | `TRESFORT_LOCAL_API_URL` | `http://127.0.0.1:8787` |
   | `TRESFORT_DEV_AUTH_SECRET` | `local-only-dev-secret` (must match `.dev.vars`'s `DEV_AUTH_SECRET`) |

4. Run the app. Check that the **Local server** banner shows the expected URL,
   then tap **Sign in to local server**. The app calls `/auth/dev`; no Apple
   account, production token, or copied JWT is needed. The secret stays in the
   launch environment, not saved app settings.
5. A new database opens normal first-run setup. Create a workout, start it,
   and log a set, then relaunch the app: the saved local session, workout,
   and logged set should still be there. The
   Worker's terminal shows the requests. This confirms that changes reach your
   local D1 instead of an in-memory fixture.

The URL accepts only HTTP loopback origins (`127.0.0.1`, `localhost`, or `[::1]`),
with an optional port and no additional path, query, fragment, or credentials.
Use the same port as Wrangler. The simulator's loopback address reaches the
Mac; LAN addresses and remote staging/production servers are not supported by
this test-login mode. Redirects are refused, so they cannot forward the local
secret or bearer to another server.

Local training state and Keychain sessions are separated from normal mode and
scoped to the configured server origin. Changing the URL uses a different local
namespace; changing only the secret keeps it. Local sign-in always represents
the local database's owner, not a choice of real member accounts. The backend
still needs `DEV_AUTH_SECRET` only in `.dev.vars`, never in production.

Troubleshooting:

- **Launch stops with a configuration error:** set both variables and disable
  `TRESFORT_UI_FIXTURE`. Invalid or incomplete settings stop launch instead of
  falling back to the live backend. Relaunch after changing scheme variables.
- **Couldn’t reach the local server:** start Wrangler and check the port. If a
  curl request works but iOS reports an HTTP transport restriction, regenerate
  the project and confirm a Debug simulator destination.
- **Local login rejected:** match the two secret values, restart Wrangler after
  changing `.dev.vars`, and relaunch the app after changing its environment.
- **Local login disabled:** verify that `DEV_AUTH_SECRET` is present in the
  repository root's `.dev.vars`, then restart Wrangler.
- **Missing tables or server errors:** apply the local migrations and read the
  Wrangler terminal. Provider integrations remain optional and need their own
  separate test configuration.
- **Workout writes return `write_protocol_not_active`:** run
  `npm run db:setup:local`; this activates the protocol in local D1.

To return to fixtures, stop the app, disable both local variables, and enable
`TRESFORT_UI_FIXTURE` again. Disabling all three returns to normal live-server
mode. Keep scheme secrets and generated project files out of commits.

### Run simulator checks

From the repository root, list installed choices:

```bash
xcrun simctl list runtimes
xcrun simctl list devicetypes
```

For the documented CI runtime/device, run the PR-sized build and unit checks:

```bash
npm run ios:verify -- \
  --runtime com.apple.CoreSimulator.SimRuntime.iOS-26-2 \
  --device com.apple.CoreSimulator.SimDeviceType.iPhone-17 \
  --ui-suite smoke
```

Use identifiers from your installed inventory if they differ. `smoke` builds
the app and test bundles and runs all unit tests; it does **not** run UI
journeys. For a changed workout interaction, run its relevant journey too,
for example:

```bash
npm run ios:verify -- \
  --runtime com.apple.CoreSimulator.SimRuntime.iOS-26-2 \
  --device com.apple.CoreSimulator.SimDeviceType.iPhone-17 \
  --only-testing TresFortUITests/TrainingJourneyTests
```

Do not combine `--ui-suite smoke` with `--only-testing`. Omitting both runs the
full suite. The script builds an unsigned disposable source copy, creates its
own simulator, and cleans up both afterward. Failures retain evidence under
`.artifacts/ios/`; use the logs to diagnose failures before retrying. This
script needs Node/npm to invoke it, but not `npm ci` or backend credentials.

## Submit a contribution

Keep the change focused and describe the problem, resulting behavior, and
verification in a pull request targeting `main`. Include screenshots for
visible changes and identify anything you could not validate locally.
Use synthetic screenshots and check that logs and attachments contain no
private information. Identify third-party material and its license, and
confirm that you have permission from any employer or other rights holder.

The required `contributor rights` check passes once every author and co-author
of the pull request has posted the acceptance comment for the current terms
version. Checking boxes in the PR template does not pass it. The maintainer
still reviews third-party material and provenance before merging. See
[contributor acceptance](docs/CONTRIBUTOR-ACCEPTANCE.md).

- Backend changes: run `npm run typecheck` and `npm test`.
- iOS changes: run the simulator checks and relevant UI journeys above.
- Engineering plan changes: run `npm run plans:check`.
- Documentation-only changes: check links, commands, and `git diff --check`.

Commit only intended files and push your branch. Open the PR ready for review.
On your first pull request, GitHub holds its CI until Nick approves the run;
after that, CI starts on every push.

A pull request can merge when the
[Codex gate](.agents/skills/codex-gate/SKILL.md) passes on its exact current
head commit:

- Four required checks are green: `plan graph`, `typecheck + tests`,
  `iOS build + tests` and `contributor rights`.
- Codex has reviewed that head with no open findings. On a pull request from a
  fork, Nick (or an agent working for him) requests the review by commenting
  `@codex review`. Fix what it finds and push; each new push gets a fresh
  review, which Nick requests again.

Documentation-only PRs may skip backend/iOS jobs while their aggregate checks
pass; that is not evidence that those tests ran. Nick merges after the gate
passes.

Production migrations, deployment, and TestFlight/App Store distribution each
need separate owner authorization. None is part of contributor setup.
