# Establish Tres Fort Training as the public development repository

Slug: public-repository · Status: active · Updated: 2026-11-15 · Theme: release

## Goal

Make `namarks/tres-fort-training` the single active development repository,
using a reviewed current-source snapshot with fresh Git history. Keep the
original repository private as historical evidence and archive it only after
the transition is verified and the owner authorizes archival. Nicholas Marks
controls official releases under the root source license and contributor terms.
Public code does not grant access to production or private support data.

The owner approved publication with the Garmin integration retained after the
bounded content review. That decision records publication authority, not a new
provider permission or a finding that every contractual uncertainty is resolved.
Detailed review evidence stays private. Production changes and app distribution
remain separate decisions.

## Phases

- [x] **P0 — Establish private staging**
  - Export original main without Git history; preserve historical planning,
    release records, tester imports and audit evidence in the private original.
  - Create the new repository with owner-only write access and no self-hosted
    runners or production secrets.
- [x] **P1 — Review the publication candidate**
  - [x] **(a) Prepare and locally verify the candidate**
  - Sanitize private contact/account literals; retain runtime code, migrations
    and synthetic tests. Use neutral symbols without separately licensed artwork;
    the standard release upload requires complete private artwork.
  - Prepare source/contributor terms, notices, setup, hosted-only CI and the
    owner-attested contributor-rights check. Local checks and independent review
    passed; preserve the exact source/candidate comparison privately.
  - [x] **(b) Review provenance and record the owner decision**
  - The bounded provider review found no live credentials or identifiable user
    records in its Garmin slice and matched much of the connection flow to
    official public documentation. Remaining protocol-provenance uncertainty was
    disclosed privately. The owner explicitly chose publication with Garmin retained.
- [ ] **P2 — Publish and qualify hosted verification**
  - [x] **(a) Publish and establish repository controls**
  - Published `main` at `659c045e03512b46c6534df8cf8b2ead276d5549` on
    2026-11-15. Original source main was `bded5f82d0b96e30fec979cca902e20ac9c14ea6`.
  - Protected main requires plan graph, typecheck + tests, iOS build + tests and
    contributor rights from GitHub Actions, with current-main freshness and
    administrator enforcement. Conversation resolution is required; force pushes
    and branch deletion are disabled.
  - Verified private vulnerability reporting, secret scanning, push protection,
    dependency alerts, approval for all outside-contributor workflow runs,
    read-only default tokens, enforced action SHA pinning and an exact four-action
    allowlist. Only the owner has write access; no self-hosted runners or secrets.
  - [ ] **(b) Verify the published candidate on hosted CI**
  - Hosted CI fixes landed in [PR #1](https://github.com/namarks/tres-fort-training/pull/1):
    authenticated XcodeGen downloads and full-job limits raised from 40 to 90 minutes, retaining
    the 30-minute smoke limit. Its [full CI run](https://github.com/namarks/tres-fort-training/actions/runs/43755367763)
    passed all nine iOS jobs and backend checks on `90d66ece`; three UI cases
    passed on their configured retries. It merged as `825487fc`, whose tree
    exactly matches the reviewed and tested head.
  - The duplicate [post-merge full run](https://github.com/namarks/tres-fort-training/actions/runs/43767779475)
    was stopped to prioritize the targeted policy follow-up. Full release
    qualification of published main remains pending: require every UI, Station
    and App Store simulator job on the exact release commit through nightly or
    manual CI. Publication or a passing smoke job does not authorize release.
  - Qualify the narrower CI policy with affected deterministic checks and one
    iPhone build/unit-test job. Workflow setup, selector and contract-test edits
    use that path; native verifier, device-list and packaging changes retain
    full verification. Changes to native workflow execution require a manual full run.
  - Hosted iOS jobs restore main's last build from a GitHub cache, so a PR
    recompiles only what it changed. Only main saves builds; PRs, forks included,
    only restore, and the nightly release check still builds from scratch. See
    `docs/IOS-VERIFICATION.md`. No self-hosted runners.
- [ ] **P3 — Complete the development transition**
  - Verify clean-clone backend and simulator onboarding and an ordinary fork PR.
  - Verify owner release automation, licensed artwork supply and private feedback
    destinations independently. No production credentials belong in public CI.
  - Move active development after verification. Archive the original only with
    owner authorization and after confirming no active automation needs writes.

## Execution frontier

- P2(b)

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P3 | gated_by | external:owner-development-transition | Verify release/support destinations before moving active development and separately authorize archival. |

## Next step

**Now (@agent):** finish the narrower verification policy through its targeted
checks and normal exact-head PR gates. Then qualify published main with the
nightly or manual full run and verify contributor onboarding and owner automation
for P3. Do not bypass protected main or treat smoke coverage as release qualification.

## Notes / open questions

- The original repository remains private, active and unarchived. No further old
  history rewrite or deletion is needed for this clean-snapshot route.
- Contributor terms 1.1 (2026-11-15, owner's choice): outside contributors
  accept once with a pull-request comment; branches in this repository pass as
  the owner's own work; the owner can still approve or revoke one PR head by
  hand. The check records acceptance, not legal verification of authority.
- Contributors use forks. Keep repository write access owner-only: an Actions
  source-pinned status does not distinguish privileged workflows created by
  another same-repository writer.
- Raw provider logos stay outside public Git history. Official releases supply
  licensed artwork through ignored paths in `docs/RELEASE-ASSETS.md`.
- The protection API accepts `required_status_checks.checks` or legacy `contexts`
  for input, not both together. The committed payload uses app-bound `checks`.
- Optional automatic dependency-update PRs and extended secret-scanning settings
  remain disabled; the enabled vulnerability alerts and secret protections are
  distinct controls.
