# iOS verification

Run from the repository root with Xcode 26.3, XcodeGen 2.45.3, Python 3,
and the iOS 26.2 simulator runtime installed:

```bash
npm run ios:verify -- --runtime com.apple.CoreSimulator.SimRuntime.iOS-26-2 --device com.apple.CoreSimulator.SimDeviceType.iPhone-17
```

The command copies iOS sources to a disposable directory, generates the project
there, creates a new simulator, and runs unsigned `xcodebuild build-for-testing`
followed by `xcodebuild test-without-building` using the
**TresFort** scheme. It includes the widget build, existing unit tests, shared
numerical/calendar contracts, and all UI journeys. Simulator boot overlaps the
build; boot readiness is required before tests start. Both actions use the same
copied sources, project, destination, and disposable DerivedData. It neither
needs nor uses signing credentials. It does not migrate D1, deploy a Worker, or upload an
app. Existing simulator data, generated projects, and build directories are not
reused, unless `TRESFORT_IOS_BUILD_ROOT` names a directory that keeps one source
copy and DerivedData per project spec between runs (hosted CI restores it from
a cache, below). Parallel test cloning is disabled so the command owns every simulator
it creates. Its exit status fails if building/testing or simulator deletion fails.

Select an installed runtime/device explicitly; list choices with
`xcrun simctl list runtimes` and `xcrun simctl list devicetypes`. Missing choices
fail before creating a device. Runtime installation and upgrading Xcode are
separate machine setup actions. On macOS, the simulator service must be accessible;
a sandbox that denies CoreSimulator or its caches cannot run this command.

For a focused check, append `--only-testing TresFortTests/CalendarProjectionTests`
or `--only-testing TresFortUITests/TrainingJourneyTests`. A focused result does
not substitute for the required CI unit and smoke coverage before merging an
iOS change.

CI uses `--ui-suite smoke` for ordinary iOS changes on pull requests and pushes
to main: one iPhone job. Routine workflow download, caching and timeout edits,
scope-selector changes and their contract tests also use smoke, together with
the affected deterministic setup, scope, workflow and verifier checks.
Changes to the native verifier, its tests, device lists in `.github/ios-tests/`,
or the packaging inputs below select `full` on the PR and push.
Those packaging inputs are both XcodeGen project specs, source-copy and plist
preparation scripts, the App Store project guard and its packaging tests, and
app/widget Info.plist and entitlement files.

`test/ci-ios-workflow.test.mjs` parses the workflow and pins the full matrix,
suite wiring, device commands and conditions, and blocking aggregate checks.
It exercises the verification step with synthetic commands to check required
invocations and failure handling. The scope test also invokes the contract, so
removing either invocation alone is detected. Changes limited to selection or
these contracts are checked directly and use the iPhone smoke job to exercise
the workflow. Routine setup tests live separately in `test/ci-ios-setup.test.py`.
If a workflow edit changes native commands, devices, matrix coverage or test
filters, the reviewer must require a manual full run on that branch before
merge. Passing the contracts alone does not qualify those native changes.
These regression checks supplement the required independent review of the exact commit.
The smoke job builds the app and both test bundles, then runs every
`TresFortTests` unit test and no UI journeys. On November 7, 2026 Nick chose to
keep PRs to build plus unit tests: the six smoke journeys took about 5 of the
job's 18 to 21 minutes (cold build about 7.5, unit tests about 2), and every UI
journey still runs in the release check below. Building the UI test bundle on
PRs keeps a compile break in UI test code from first surfacing at night. A
script check enforces that smoke selects exactly the unit target.

## Release check

The full run is the release check. It runs the six full UI shards plus the
iPad Station, iPhone App Store and iPad App Store device jobs. Public-repository
runs use GitHub-hosted macOS runners. The temporary private-repository routing
is described below. Ordinary pull requests do not run the full suite, so a
regression that only those jobs catch can surface in the release check. It runs:

- nightly on main at 11:17 UTC (early morning Pacific time);
- on demand with the CI workflow's **Run workflow** action, on main or on a
  risky PR's branch (for example a Station or App Store packaging change);
- on a PR that changes the native verifier, its tests, device lists or packaging
  inputs, as above; changes to native workflow execution require a manual full run.

Before a TestFlight or App Store upload, confirm the release check passed on
the exact main commit being built: use that night's run if main has not moved,
otherwise run it on main and wait for it. A failure is fixed on main before the
upload. Nothing enforces this automatically; uploads run by hand from the Mac
mini. Worker deploys need no extra check because backend tests run on every PR.
Full runs include history measurements, accessibility audits and the broader UI
journeys. Schedules run only after the workflow lands on main and may be
delayed by GitHub; inspect the Actions result for actual evidence.

Full runs use six standard runners for the UI shards, partitioned using the
hosted runner timings (including cold build time):

| Shard | Coverage |
| --- | --- |
| 1 | All unit tests and remaining UI classes |
| 2 | Training, workout feedback and Intervals connection |
| 3 | Today navigation |
| 4 | Member activation, planless accounts, mixed-week setup and freestyle workouts |
| 5 | UI actions, history, exercise groups, exercise information and exercise discovery |
| 6 | Workout library, weekly schedule and runner controls |

The partitions are disjoint and cover every suite; newly added classes remain
in shard 1 automatically. The partition contract rejects missing or overlapping
selectors. Monitor full-run duration as journeys grow, and rebalance or add a
shard before a shard's typical run approaches 30 minutes. The September 24
baseline had 124 UI methods: two of the previous three partitions still had
unrun tests at timeout.
An October 3 audit of the three largest suites folded five duplicated methods
into the tests that already covered their assertions.
The smoke job keeps a 30-minute limit. Full jobs allow 90 minutes. The
November 15 public-repository run exhausted the previous 40-minute limit
while shards 4 and 5 were still progressing: shard 4 had passed 25 of 28 cases,
while shard 5 had passed 9 of 26, with several group journeys taking four to
five minutes each. The larger bounded allowance lets the complete suite finish
on hosted runners; use the completed timings to reassess partition balance.
Test selection, assertions, element waits and retry settings are unchanged.
On November 1 shard 3 passed all 26 of its tests but reached the 40-minute
limit (10.8 minutes of build and boot, 28.9 of tests), while shards 2 and 5
finished in about 17. Intervals connection moved to shard 2 and exercise
discovery to shard 5, leaving Today navigation (about 19 minutes of tests)
alone in shard 3.
On November 14 shard 1 reached the 40-minute job limit after 37 minutes and
44 seconds of test execution, including two failed attempts that passed on retry.
The mixed-week setup class accounted for about 16 minutes including its retry;
it moved to shard 4, whose prior passing test time was about 13 minutes, to reduce
the first shard's load. The affected history and
setup interactions received synchronization fixes. All suites remain covered
exactly once, and the job time limits are unchanged.
Sharding or smoke mode cannot be combined with `--only-testing`. Without these
arguments the command still runs the full suite locally.
The iPad Station and App Store device jobs read their selectors from
`.github/ios-tests/*.txt` through `--only-testing-file` (one selector per line,
`#` comments allowed). They run only in the release check, so editing those
lists selects full; `test/ci-ios-scope.test.py` checks each selector names a
real test.

CI prioritizes the current iPhone 17 layout and normal text sizes. The optional
`--content-size` argument can set a simulator system preference for a focused
investigation; it is not a required older-device or extreme-text matrix.
It applies only to the newly created simulator and records `ui-settings.log`.
A rejected setting fails the command and still cleans up.

## Evidence and cleanup

Build copies, DerivedData, and the created simulator are deleted on success,
failure, and interrupt. Failure retains `build.log`, `boot.log`, `xcodebuild.log`,
environment/toolchain identity, copied-source SHA-256 manifest, runtime inventories, cleanup diagnostics,
and any available `Build.xcresult` / `Tests.xcresult` under
`.artifacts/ios/<unique-run>/`. Set `IOS_KEEP_RESULTS=1` to retain successful results
and their synthetic screenshot attachments too. With that setting, logs and
results are written directly into the evidence directory while the run is active,
so a forced cancellation need not finish the cleanup trap to retain diagnostics.
An uncatchable process kill cannot guarantee local simulator/scratch cleanup;
CI's disposable runner owns that final cleanup. `IOS_EVIDENCE_DIR` may select a
different durable output directory. On a test failure, assertion lines are also
printed before the log tail, so an accessibility hierarchy dump cannot hide the
error in Actions. These artifacts are ignored by Git. The log records the Git
revision and local overlay; tests run on the copied working
files, including any uncommitted changes.

Open a result bundle in Xcode or export its UI attachments:

```bash
xcrun xcresulttool export attachments --path .artifacts/ios/<run>/Tests.xcresult --test-id TrainingJourneyTests --output-path .artifacts/ios/<run>/screenshots
```

Delete retained local evidence when it is no longer needed. An uncatchable kill
or host crash can leave the named `TresFort verification` simulator and
`tres-fort-ios.*` scratch directory; remove only those belonging to that run.

## Flaky tests

`ios:verify` runs each failed test once more in place
(`-retry-tests-on-failure -test-iterations 2`). A real regression fails both
times and fails the job as before. A test that passes only on its second run
passes the job, but the log lists it under "Passed only when run again", and on
GitHub it appears as a "Flaky iOS test" warning on the run and in the job
summary. The log also retains the failed attempt's last 80 activity/error lines,
even when the job succeeds and its raw results are not uploaded.
Fix a listed test rather than accepting it: the usual causes are a
wait shorter than `UITestWait.screen` (15 seconds), a tap before the control
can be tapped (use `tapWhenReady` or `tap(until:)` from `UITestTapping.swift`),
a `swipeUp()` loop that flings a row past the screen between two checks (use
`app.scroll(toReveal:)`, which scrolls in short slow drags), or a step that
drives another app such as Settings.

## Synthetic UI fixtures

The Debug simulator build accepts `TRESFORT_UI_FIXTURE` through its launch
environment. Available cases are `sign-in`, `empty`, `load-failure`, `ordinary`,
`bodyweight`, `timed`, `pending`, `correction-failure`, `ready-to-finish`, and
`onboarding`. Add `TRESFORT_UI_LARGE_TEXT=1` for the largest accessibility text
size; otherwise fixture launches inherit the simulator system setting (normally
`.large`). Add `TRESFORT_UI_REDUCE_MOTION=1` to turn on Reduce Motion for that
launch: views read `@ReduceMotion`, which combines the system setting with this
override. UI tests never toggle settings in Apple's Settings app, whose layout
and speed vary between iOS releases and loaded CI simulators. The synthetic banner stays at its
ordinary size so it does not take space from the product under test. This
root-view override alone does not prove presented-sheet scaling; use the
optional system setting for a specific investigation when needed.
An unknown value aborts before real authentication is constructed. Fixture code
is excluded from Release builds and physical-device builds.

Each launch uses a reset synthetic defaults namespace and a token store that
never reads or writes Keychain. Training dates are fixed at September 8, 2026.
The fixture mounts the real Today, routine editor, runner, correction, and
completion views over the real SyncModel. It avoids MainTabView's HealthKit,
group, credential-renewal, and connectivity lifecycle. APIClient switches to
`ui-fixture.invalid` and an ephemeral URLSession whose protocol answers only
bounded in-memory routes. Unknown routes fail; nothing forwards to the network.
No real user's health data is loaded or persisted. Use a disposable simulator
for walkthroughs too; the verification command already provides this isolation.

The sign-in fixture substitutes only the provider button to record a synthetic
intent; even a manual tap cannot launch AuthenticationServices. The behavioral
smoke exercises that intent, creates a
routine and first workout, logs a set and acknowledges completion, retains an
offline write, and checks that a rejected correction preserves its original
values. It also distinguishes verified empty state from initial-load failure.
Representative screenshots are XCTest attachments, not fragile pixel baselines.
The fixture server is a transport stub, not proof of backend validation or an
Apple authorization exchange. Unit/integration tests verify those separate
contracts. Native Apple authorization and its provider UI remain a separate walkthrough.

The onboarding fixture exercises all optional steps and the safe non-owner
fallback when `/api/me` is unavailable. Open-URL actions are discarded in every
fixture; provider connection routes fail closed. UI tests additionally cover
onboarding, exact decimal entry with the keyboard, rest completion,
correction recovery, and reachability of the remaining fixtures. XCTest audits
check hit regions and descriptions in the visible
entry/runner viewports. Resolved palette colors have deterministic AA contrast
checks. The native iOS 26.2 contrast heuristic produced false positives over the
dark gradient; measured evidence (historical maintainer record)
records its limits and why it is not a CI assertion. These audits do not exercise VoiceOver focus or speech.

`ios/TresFortTests/Fixtures/CalendarProjection.json` supplies the same civil-date,
DST, leap-day, real-session, dangling schedule, and blackout expectations to
Swift and TypeScript. `BodyweightProgress.json` continues sharing numerical
expectations for reps, timed holds, assistance, unilateral, and loaded metrics.

## CI and merge evidence

CI retains the `plan graph`, `iOS build + tests`, and `typecheck + tests` check
names. The latter two aggregate every required shard and fail for failed,
cancelled, or unexpectedly skipped jobs. Both matrices use `fail-fast: false`
so a failure in one shard does not cancel coverage in another.

When the repository is **public**, every iOS job runs on the standard
`macos-15` GitHub-hosted runner with Xcode 26.3, iOS 26.2 and checksum-pinned
XcodeGen 2.45.3. This applies to owner work, same-repository PRs, fork PRs,
schedules and manual runs. There is no self-hosted runner selection. Full-suite jobs run on separate machines, up to nine at a time subject to the
account's GitHub-hosted concurrency limits.
Actions are pinned to full commit SHAs, and checkouts do not retain GitHub
credentials in Git configuration. CI has no production or signing credentials.

During private preparation, Actions is disabled. The workflow also refuses
hosted macOS jobs while the repository is private; required iOS coverage then
fails with an explanation rather than passing through skipped tests. This
repository has no self-hosted runner route and must have no Mac mini runner
registration. Public fork work runs on GitHub-hosted machines without signing,
deployment or provider credentials.

The required `contributor rights` status is separate from technical CI. It
passes automatically for branches in this repository and, for forks, once every
author has posted the acceptance comment for the current terms; see
[contributor acceptance](CONTRIBUTOR-ACCEPTANCE.md). Keep contributors fork-only
and repository write access owner-only, because any branch in this repository
counts as the owner's own work. Revisit the trust model before adding
another writer because source-pinning a status to GitHub Actions does not pin
it to one particular workflow.

Changes confined to backend source, migrations, backend TypeScript tests, the
web app (`web/`), the marketing site (`website/`), the Claude plugin
(`plugins/`), or documentation skip iOS jobs; the iOS build copies only `ios/`.
Ordinary app changes, shared fixtures under `ios/`, routine workflow/setup
changes, package configuration and unknown paths trigger smoke coverage.
The native-verification and packaging inputs listed above take precedence and run full.
`scripts/ci-ios-scope.py` compares the tested PR merge with its base or the entire
push range, including deletions and both sides of renames. A missing Git base or
failed scope job fails the aggregate; only an explicit `skip` decision permits
skipped iOS jobs. Scheduled and manual runs always request full coverage regardless
of changed paths. Full runs have separate concurrency groups from push/PR runs.

Every hosted iOS job restores the pinned MediaPipe downloads from a GitHub
cache keyed by `ios/Dependencies/mediapipe.lock.json`; `setup_mediapipe.py` still checks
each file's SHA-256 before use, and `TRESFORT_MEDIAPIPE_CACHE` can point a
runner at a persistent directory instead.

Hosted iOS jobs also restore main's last build into `TRESFORT_IOS_BUILD_ROOT`
from a GitHub cache, so Xcode recompiles only the files a change touched instead
of building from scratch (about 12 minutes of the smoke job on November 15, 2026).
`scripts/verify-ios.sh` rewrites only changed source files, and the workflow tells
Xcode to ignore the new inodes a restored file gets. Builds are keyed by project
spec (`project` or `project-app-store`), Xcode version and build, and a hash of
the tracked iOS sources and verification scripts. Only main saves a build: the
first shard and the iPhone App Store job, after they pass, and only when the
sources changed. Pull requests, fork PRs included, restore main's build and
never save their own; every job that must not save empties the folder first,
and its throwaway key can never match a restore prefix. The nightly release
check skips the restore, so it proves a clean build, then refreshes the cache.
Build logs are left out of the cache. To discard every cached build, bump the
`ios-build-v1` prefix in `ci.yml`; deleting the entries in the repository's
Actions caches page works too.

Merging or closing a PR cancels its unfinished CI runs: the `closed` event
joins the PR's concurrency group (keyed by PR number, since a merged PR's
closed event runs on the base ref), and for a branch in this repository a
small job cancels any other queued or running CI run on that branch, such as
a manual full check.

CI uploads an iOS job's results (`ios-smoke-1`, `ios-full-1` through
`ios-full-6`, `ios-full-station`, `ios-full-app-store-iphone` or
`ios-full-app-store-ipad`) only when that job fails or is cancelled, and keeps
them for three days. A passing full run would otherwise store about 1 GB, and
the private repository's free Actions storage is 0.5 GB. A refused upload
does not fail the job. No production credentials or account data are
supplied to these jobs. Dependency installation
and GitHub action permissions follow the existing repository workflow.

Backend CI runs three Vitest file shards with `npm test -- --shard=N/3`.
Every shard also runs typechecking, verification-command regressions, upload
script checks, and query-plan checks. `singleWorker: true` and
`isolatedStorage: true` remain in force within each shard: suite seeds and
per-test rollback retain the same semantics. Plain `npm test` still runs all
backend tests locally. CI sharding increases concurrent standard runner use
and duplicates iOS compilation; it reduces elapsed wait rather than total
build work. Existing test assertions, timeouts, and production behavior are
unchanged; broader UI regression detection moves to the periodic full runs.

The workflow does not configure GitHub branch protection. Before publication,
configure the repository rules to require all three aggregate/check names and
the current-head independent review policy. Verify the live rules separately;
workflow success is not evidence that GitHub enforces them. CI uses unsigned
simulator builds. Release signing and distribution require a separately
controlled owner workflow and their own credentials; they are not granted to
public contributor jobs.

A compile, screenshot, or automated smoke test does not establish VoiceOver
usability, physical-device keyboard reachability, audio/lock-screen cues, or
interruption behavior. P1 records simulator evidence separately from the
optional physical-device observations. Per the September 8 owner steering,
those observations are not a delivery gate.

## History measurements

`HistoryPerformanceTests` records five raw samples per component for 12-session
and five-year synthetic histories; `HistoryJourneyTests` exercises two cached
process launches per dataset, calendar scrolling and exercise detail. Both use
the current iPhone at normal text sizes. `history-small` and `history-large` are
simulator-only fixtures; their transport rejects every request. A seed launch
resets the synthetic namespace; `TRESFORT_UI_REUSE_HISTORY=1` retains that seed
for measured cached launches only. Tests explicitly select the seeding mode
for each dataset and assert the row count before and after relaunch.

The measurement record (historical maintainer record)
separates main-actor component costs from XCTest/animation wall times, and records
first reads, cache reuse, snapshot size, investigation budgets and limitations.
Performance times are reported rather than asserted on shared CI hardware;
behavioral correctness remains required.
