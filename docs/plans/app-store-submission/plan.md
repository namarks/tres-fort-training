# First App Store Submission

Slug: app-store-submission · Status: active · Updated: 2026-11-18 · Theme: release

## Goal

Prepare a verified Très Fort 1.0 build and complete App Store review package
for a free, United States-only first release. Completion requires an exact
candidate, compatible production backend, documented verification and owner
exceptions, accurate privacy disclosures, listing and reviewer access. The owner
requested expedited shipment on 2026-09-10. Complete the prepared App Store
package and submission requirements while retaining the existing submission.
Build 40, rejected and incompatible with the serving canonical Worker, was
replaced on version 1.0 by compatible candidate build 53 on October 11, and
then by build 55 on October 30, each with owner approval. Apple approved 1.0
(55), and on 2026-11-08 the owner released it publicly (free, United States),
explicitly waiving the device smoke test (release 55).
The live 1.0 client now constrains backend deploys until users update.
Owner decision, 2026-10-08: version 1.0 includes **iPhone and native iPad**,
including manual partner training through iPad Station. This supersedes the
October 5 iPhone-only decision. The public candidate excludes experimental
movement-camera counting, recordings, MediaPipe and its model. The separate beta
project retains those experiments. Native iPad and three-device acceptance must
be demonstrated on the public candidate before submission; existing beta
distribution is not that evidence.

## Phases

- [x] **P0 — Submission foundations and release defects**
  - Add privacy/support links before sign-in and in Profile, and bundle a
    required-reason manifest for actual API use.
  - Explain optional Claude/Anthropic and Apple Health data sharing at the
    authorization controls; preserve manual use without integrations.
  - Diagnose feedback replacement failure without weakening saved-text
    assertions; pass focused behavioral and required full checks.
  - Align marketing version with the App Store 1.0 record; choose the build
    number only after a fresh App Store Connect read.
- [ ] **P1 — Privacy and public-user review readiness**
  - [x] Refresh the source/provider audit and prepare the privacy/rating worksheet;
    October 7 evidence records implemented controls,
    policy-host drift, retained Intervals metadata and unresolved attestations.
  - Trace deletion/export, HealthKit cache/backup behavior, coach access and
    withdrawal, and private-group content through the actual paths.
  - Resolve essential reporting/blocking/filtering requirements for group
    content with a bounded design before changing member/data policy.
  - Prepare accurate App Privacy and age-rating answers against final source
    and provider behavior. Confirm public policy/support URLs work.
- [ ] **P2 — Review package**
  - [x] Refresh listing/reviewer text and prepare a conditional rejection reply
    in review-package.md; verify free US configuration.
  - Prepare copy, category, synthetic-data screenshots from the actual candidate
    UI, and reviewer instructions for manual onboarding, logging, optional
    integrations, export and deletion.
  - Confirm viable reviewer access without personal training data; any reviewer
    credentials remain owner-managed.
  - Verify free pricing, US-only availability and applicable agreements; request
    owner confirmation for fields inaccessible to existing tools.
- [ ] **P3 — Exact candidate and production verification**
  - [ ] **(a) Compatible production backend**
    - Independently review the final head and pass all required checks.
    - Read deployed source/configuration and migration ledger; prepare an exact
      migration/deployment proposal if the candidate needs a newer backend.
    - Retain the authenticated session-swap and workout-name compatibility
      verification requirements. These live checks remain unperformed after
      the owner-authorized build 40 upload; neither public health nor Apple
      processing establishes those API behaviors.
    - Retain physical-iPhone verification results and any explicit owner deferral
      without claiming unperformed checks passed. The owner deferred the live
      pre-upload workout canary and its observation on 2026-09-10. Other physical
      coverage remains unverified; reuse the device procedure
      when that follow-up resumes.
      The separate September 19 build-44 exception defers authenticated live
      workout checks to device testing for internal TestFlight only; it does
      not establish App Review or public-readiness acceptance.
  - [ ] **(b) Compatible signed iPhone/iPad candidate and Apple processing**
    - Historical build 40 processing is complete, but that rejected candidate
      is incompatible with the canonical backend. Build 49 is an internal
      iPhone/iPad beta, not the selected public candidate.
    - After exact-head review/CI, separately authorize signing/upload of the
      public project (`APP_STORE_BUILD=1`), check app/widget families 1 and 2,
      SDK exclusion and embedded privacy metadata,
      match final screenshots, and verify Apple processing. P3(a) physical and
      authenticated checks remain unperformed.
    - Selected public candidate: build 55,
      with families [1,2], no Station SDK/model, app and widget privacy
      manifests, and Apple VALID / APP_STORE_ELIGIBLE. On 2026-10-30 the owner
      approved selecting it for version 1.0, replacing build 53. The uploaded
      screenshots were compared with build 55, and the two changed iPad images
      were replaced. It supersedes the build 53 and
      build 50 candidates.
    - Separate internal trial: build 56 is the camera-enabled
      beta from the same source as build 55, for internal Testers only.
      Build 52 added easier device
      setup and remembered reconnection to the iPad workout display, retaining
      the experimental camera SDK. It is VALID / IN_BETA_TESTING for internal
      Testers; it does not replace the SDK-free public candidate or establish
      physical pairing, counting accuracy or public acceptance.
- [ ] **P4 — Submission and public-release handoff**
  - [x] Select build 40 and retain Apple's review-submission receipt. The owner
    submitted 1.0 (40) on 2026-09-14 at 01:23:28 UTC (2026-09-13 Pacific);
    API readback confirms WAITING_FOR_REVIEW and MANUAL release.
  - [x] Resubmit with a compatible candidate. On 2026-10-30 the owner approved the
    reply and resubmission of 1.0 (55). Apple shows WAITING_FOR_REVIEW, submitted
    at 18:11:27 UTC, with MANUAL release (release 55).
  - [x] Public release. Apple approved 1.0 (55) (PENDING_DEVELOPER_RELEASE,
    submission COMPLETE). On 2026-11-08 the owner said "Release now, waive the
    smoke test". The release request at 02:29 UTC returned HTTP 201, and Apple
    shows READY_FOR_SALE (release 55).
  - [x] Submit 1.1 without the run recorder. On 2026-11-08 the owner approved the
    1.1 steps and the subtitle and keywords. 1.1 (70) is WAITING_FOR_REVIEW with
    MANUAL release (release 70).
  - [x] Release 1.1. Apple approved it, and on 2026-11-09 the owner released it.
    Apple shows READY_FOR_SALE (release 70).
  - [ ] Post-release follow-up: the designated-account, native iPad and partner
    checks were waived, not performed. Run them on the live build and record the
    results. Approval and release do not establish that they pass.

## Execution frontier

- P1
- P2

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P4 | gated_by | external:app-store-owner-fields | 1.1 (70) is released. The remaining post-release device checks need the owner's devices and accounts. |

## Next step

**Now (@owner):** **Très Fort 1.1 (70) is live** as of 2026-11-09
(release 70), with Precise Location declared and the new subtitle, keywords
and redesigned screenshots. Next is **1.2 with the run recorder**; the owner
chose on 2026-11-16 to hold it until the recorder is ready. TestFlight 1.2
(83), built from public main on 2026-11-17 after a full release check,
is with internal and external testers. The recorder fixes merged on
2026-11-18 (quicker auto-pause, 3-2-1 beeps, short step cues) need one more
TestFlight build and the owner's interval run
([run recorder](../run-recorder/plan.md) P3, P4, P8, P9). Shipping 1.2 then
needs these changes in the App Store build:

- remove the recorder gate
- allow saving runs to Apple Health
- justify background location in the review notes, and finish the location
  and Bluetooth permission text
- keep Garmin hidden until its launch (no earlier than 2026-12-08)
- update the App Store privacy answers for what 1.2 adds (WHOOP, swim
  strokes and Apple Watch's effort score, Garmin if shown)
- add a recorder screenshot

**Also:**
- **WHOOP and Garmin betas (72, 73):** internal only, never for an App Store
  version; their backends are deployed.
- **Release check (@agent):** the 2026-11-17 nightly on main (`b17202d`,
  whose app is identical to build 83's) failed one iPhone shard on
  `MixedWeekSetupJourneyTests.testCoreScheduleFailureRetriesSavedPrescriptionWithoutCreatingAnotherWorkout`
  (`composer.home.timeEveryExercise` and `composer.home.circuit` never became
  tappable); public PR #9 also saw a mixed-week core-setup journey pass
  only on retry. The release check on `2e2fe86` (the build 84 candidate) failed
  the same journey: once the day, time and alongside rows scrolled the composer
  down, the test searched downward for the exercise list's add button, which
  sat above. The composer test fix makes it search upward; build 84 waits for a
  clean full run on the merged commit. Confirm the check on the exact commit
  before every upload.
- **Still open:** run the waived device checks on the live build.

**Backend constraint:** the live 1.1 (70) client, and 1.0 (55) until users update, must
keep working against every production Worker deploy (sign-in, state sync, logging,
export and deletion) until users move on. Check the iOS REST routes it uses before each backend release.

**In parallel (@agent):** Finish the runnable P1/P2 audit against the build-55
source. Reconcile the listing copy and reviewer instructions with the
captured screens, account export/deletion and group controls, and public
policy/support availability. Record evidence and list any owner-only App Store
fields. Make no App Store Connect, provider or production writes.

**Owner checks:** Perform the
designated-account consent/workout/export/deletion checks, native iPad layout
checks and manual partner trial with two
phones/accounts and one iPad on build 55, or record an explicit waiver. Further
screenshot or metadata changes, any further reply to Apple and eventual MANUAL
public release remain separately authorized actions. No provider write or account/training mutation is part of this
preparation.

The readiness evidence records fresh Apple, public-site,
Worker-source, logging and migration readbacks. Core consent, group safety,
account export/deletion and protected storage already exist. Do not reapply
migration 0048, recreate the retired reviewer login, or treat the old build-40
upload as a compatible candidate. The remaining logging-inventory reads returned
403; they are unknown, not proof of no collection. The current source does not
enforce new consent versions for existing coach grants; changing that behavior
remains an explicit owner decision.

## Notes / open questions

The preparation checkpoints below retain evidence from earlier source snapshots.
Their test counts and provider reads are historical; the current release source,
authorization, deployment state and remaining actions are in **Next step** above.

- Within this plan, P3 requires P0/P1, and P4 requires P2/P3. These are phase
  order requirements, not cross-plan dependency edges.
- Owner decision, 2026-09-10: **free, United States only**.
- P0 delivered in PR #171,
  reviewed head, merged. Independent Codex review completed
  without findings; no unresolved threads; all configured CI checks passed.
  The merge and reviewed head have identical trees. Build 35 is now selected and archived as recorded above;
  its completed upload and Apple processing are recorded above.
- Foundation implementation: privacy/support links, optional integration
  disclosures, UserDefaults required-reason manifest, marketing version 1.0,
  reliable transcript replacement assertions, and an explicitly selected
  version/build in the review-submission lane. That foundation checkpoint did
  not upload or submit an app.
- Local verification, 2026-09-10: TypeScript typecheck and all 967 backend tests
  passed; final OAuth checks passed (8 tests). On Xcode 26.3 / iOS 26.2 / iPhone
  17 simulator, all 448 unit tests and five feedback journeys passed; the final
  onboarding and affected feedback rerun passed all nine tests. The built app
  contained marketing version 1.0 and the UserDefaults `CA92.1` manifest.
  Release-lane boundary tests, verification-script tests, plan validation and
  whitespace checks passed. Exact-head independent review and remote CI passed
  as recorded above.
- A paired physical iPhone was unavailable on 2026-09-10; simulator evidence
  does not establish physical-device behavior. The later owner exception and
  remaining unverified coverage are recorded above.
- The review package is a draft. The owner approved group controls, the daily inbox / 24-hour response
  commitment and aggregate-only diagnostics on 2026-09-10, with an explicit
  preference against overengineering. The implementation passed exact-head
  independent review and CI and its backend is deployed, as recorded above. Persisted
  HealthKit records now use the candidate's protected, backup-excluded
  app-owned storage; physical-device verification remains in P1/P3.
- The group-safety candidate was merged in PR #175,
  using the existing Worker/D1 and Profile screens:
  mutual member blocking, reviewed email drafts with copyable references,
  conservative shared-text filtering and audited, reversible operator sharing
  restrictions. Additive migration `0048` was applied before the new Worker.
  The following local checks were preparation checkpoints before final review:
  TypeScript, plan checks and Wrangler 4.92 dry-run/type generation passed.
  Local backend verification passed 980 tests; the remaining assertion assumed
  a random group sort order. Selecting the intended group by ID corrected that
  test, and all 12 safety/export tests then passed. Export controls use the same
  D1 batch snapshot as the training projection. All 489 iOS unit tests completed
  without failures (one physical-protection test explicitly skipped), and both
  safety journeys passed on iPhone 17 / iOS 26.2. All 274 iOS input hashes matched;
  the synthetic report screen was visually inspected. Final independent review and
  remote CI subsequently passed as recorded above. The CI selection check now accounts for the added
  safety suite; all 11 verification-workflow checks, seven asset checks, six CI
  scope checks and two review-submission checks pass locally. An unsigned
  generic-iOS Release build at passed:
  version 1.0, iPhone-only, embedded widget, `CA92.1` manifest and no synthetic
  fixture markers. Its build 29 is an unreserved placeholder, not an upload
  candidate. Independent review identified cached secondary groups on foreground;
  the app now invalidates every shared projection before authentication waits and
  reloads all rosters. A stale detail task cannot supersede that reload. All
  three safety unit tests and five safety/Intervals journeys passed after the
  correction, including background/foreground use. Rejected block requests now
  revalidate membership rather than leaving a false empty-group screen; an offline
  reload exposes retry while preserving the original block error. The regression
  reproduced both failures before the fix. Blocks and operator restrictions now
  share one recovery path that clears shared projections before either write and
  reconciles uncertain responses. The lost-restriction-response regression also
  failed before this correction; all five safety unit tests and both safety
  journeys pass afterward, with all 274 input hashes matching. Foreground recovery
  also reloads mounted safety settings; failed roster/feed/statistics/series
  refreshes use the existing retry screen instead of implying an empty group.
  Both additional review regressions reproduced before correction; all seven
  safety unit tests and both safety journeys pass on the corrected source, with
  274 matching input hashes. Account downloads apply the same masking to other
  members' group names inside the existing export snapshot, preserving a creator's
  own original. The unmasked-export regression reproduced before correction;
  all 13 safety/export tests and TypeScript checks pass afterward. Shared creator
  metadata and exported names now honor either-direction blocks and restrictions;
  unavailable creators use an empty string to retain older clients' wire shape.
  The app removes unavailable report targets and uses one complete group/safety
  reload after successful or rejected safety writes and foreground return. These
  metadata and lost-settings regressions also reproduced before correction. All
  14 safety/export tests, seven safety unit tests and five safety/Intervals UI
  journeys passed afterward, with 274 matching iOS input hashes. These preparation
  checks preceded the production release recorded above; no App Store write occurred.
- P1 protected-storage repository work was delivered in
  PR #172, reviewed head, merged. Independent Codex review found no
  remaining issues, all review threads were resolved, and
  all eight configured checks passed.
  The reviewed and merged trees match;
  remote-main ancestry and tree equality were verified after merge.
  Training blobs now use protected, backup-excluded storage with account/revision
  fences, durable-write gates, inactive-account migration and explicit recovery.
  Unreadable training queues remain intact; acknowledged deletion erases only
  the relevant account. Explicit Health disconnect can rebuild an unreadable
  cursor, preserves failed reset intent, and rejects stale sync checkpoints.
  Tab models have one lazy owner; invite retry has a full 44-point touch target.
  The final Health follow-up passed 96 focused authentication/storage tests with
  one explicit simulator protection skip; all 268 tested iOS source hashes
  matched. Earlier full/focused checks and failure diagnoses are retained in the
  release audit. Physical-iPhone file protection,
  upgrade, lock/unlock and recovery verification remain P3 requirements.
  A rollback must retain the new storage reader or first reconcile pending work.
- The backend diagnostics fix was delivered in PR #173,
  reviewed head, merged. Independent Codex review completed
  without findings, all threads were resolved, and required CI passed.
  The reviewed and merged trees match.
  Local verification included TypeScript, all 972 backend tests, then 85 focused
  tests for the validation-code follow-up. It removes raw unexpected error text from application logs and HTTP/MCP
  responses. Read-only provider metadata at 17:07:31 UTC confirmed persisted
  invocation logs with 100% sampling and URL query redaction disabled. Tracing
  is disabled; no tail consumers or export destinations were returned. Logpush
  is not exposed by the download path. No request logs were opened. The
  diagnostics policy proposal is owner-approved; its production configuration is now deployed. Historical
  exports and final App Privacy declarations remain separate assessments.
- Release audit, 2026-09-10: production Worker, source annotation and
  migration ledger through `0045`; at that earlier read, source migrations
  `0046` and `0047` were unapplied. The release above supersedes this state. Normal-browser checks successfully rendered both public marketing
  and privacy pages with support links; HTTP clients still returned 403.
  Mailbox delivery is untested. No production change was made.
  A SELECT-only refresh at 17:47–17:48 UTC confirmed the same deployment and ledger
  through `0045`, with zero rows written.
- P2 screenshot workflow was delivered in PR #174,
  refreshed onto the verified storage merge. The complete workflow passed on
  clean capture source: both UI journeys
  passed, all 270 iOS source hashes matched, and five opaque RGB 1320 × 2868
  images were visually inspected. The framing follow-up also passed both
  journeys on CI's smaller iPhone 17. Build and capture now share source
  selection; added/removed/changed inputs and checkout changes abort capture.
  PNG checks cover structure, checksums, compression, pixels and transparency.
  Seven optimized-Python asset tests and 11 build-workflow tests passed; reported
  validation bypasses reproduced before the fixes. A generic-iOS unsigned
  Release build of the same iOS inputs passed with version 1.0, embedded widget,
  `CA92.1` manifest and no synthetic fixture markers. Build 29 remains an
  unreserved placeholder. The reviewed head merged with an identical tree. Independent review found no issues,
  all threads were resolved and all eight checks in run passed.
  Source ancestry and tree equality were verified after merge. Subsequent group
  changes require a fresh candidate build; the prior Release proof covers only
  its recorded source inputs.
  Final screenshots were subsequently captured and checked from reviewed head; the signed candidate is recorded above.
  Device verification was open at that capture checkpoint. The later signed
  upload and explicit test deferral are recorded above.
- Source baseline;
  main CI passed.
  The preceding run failed transcript replacement: its helper could delete
  backward from an arbitrary cursor after missing the selection menu. A later
  pass does not explain that failure.
- App Store Connect read on 2026-09-10: app, version `1.0` in
  `PREPARE_FOR_SUBMISSION`, no selected build/screenshots and empty description,
  support/privacy URLs, category, review details and age answers. Latest build
  `0.1.0 (34)` was `VALID`, `APP_STORE_ELIGIBLE`, `IN_BETA_TESTING`. Re-read before
  writes. Existing API permissions did not allow pricing/availability reads;
  agreements and App Privacy answers remain unverified.
- Owner App Store Connect readback, 2026-09-10: after a phone screenshot showed
  unset pricing/availability, the owner confirmed saving **Free / United States
  only**. This is owner-confirmed configuration; direct API readback remains
  unavailable to the existing key. The owner deferred checking App Store
  agreements; agreement readiness remains pending.
- Website hosting was delivered by PR #170;
  the matching candidate privacy publication and public-URL evidence are recorded above.
- Repository work remains authorized through required review and merge.
  Candidate production deployment and internal TestFlight distribution are
  complete. The later owner shipment request and test exception supersede the
  former pre-upload gate; App Store editing access and unsatisfied submission
  fields are the current handoff, not a request to repeat release approval.
- Apple references checked 2026-09-10: [review guidelines](https://developer.apple.com/app-store/review/guidelines/),
  [required-reason APIs](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype),
  [App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy).
