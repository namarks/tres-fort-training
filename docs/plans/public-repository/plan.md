# Prepare Tres Fort Training for public contributions

Slug: public-repository · Status: gated · Updated: 2026-11-15 · Theme: release

## Goal

Make `namarks/tres-fort-training` the single active development repository,
using a reviewed current-source snapshot with fresh Git history. Keep the
original repository private as historical evidence and archive it after the
transition is verified. Nicholas Marks controls official releases and grants
bounded contribution rights under the root source license and contributor terms.
Public code does not grant access to production or private support data.

The owner authorized private preparation, including the new repository and its
configuration. Publication, production changes, distribution, and paid private
macOS CI remain separate decisions. The earlier old-history cleanup proposal
was superseded; no further historical deletion or rewriting is required by this
route.

## Phases

- [x] **P0 — Establish private staging**
  - Export current reviewed main without Git history; keep historical planning,
    release records, tester imports and audit evidence in the private original.
  - Create the new repository privately with Actions disabled, read-only workflow
    defaults, no self-hosted runners, and no additional collaborators.
- [ ] **P1 — Qualify the publication candidate**
  - [x] **(a) Prepare and locally verify the candidate**
  - Scrub current private contact/account literals. Preserve runtime code,
    migrations and synthetic tests. Supply neutral connection symbols when
    separately licensed artwork is absent; check private artwork before release.
  - Prepare the source license, contributor terms, third-party notices, local
    setup, hosted-only CI and owner-attested contributor-rights gate.
  - Run proportional deterministic checks and independent security review;
    preserve the exact source/candidate comparison privately.
  - [ ] **(b) Resolve publication rights**
  - Confirm existing code and asset provenance, plus permission to publish
    provider-specific implementation details. A private candidate is not rights
    clearance, and technical tests cannot establish publication permission.
- [ ] **P2 — Publish under explicit owner authority**
  - Review the exact candidate and remaining provider/legal decisions.
  - With Actions still disabled and owner-only write access, publish, apply and
    verify protected-main rules and private reporting, then enable pinned
    GitHub-hosted Actions with approval required for outside contributors.
  - Require four checks: plan graph, typecheck + tests, iOS build + tests,
    contributor rights. Bind them to GitHub Actions and require current main.
  - Run required hosted CI and the full iOS release check on the exact candidate.
    No official app release follows from publication or a passing smoke run.
- [ ] **P3 — Complete the development transition**
  - Verify contributor backend and simulator instructions and an ordinary fork PR.
  - Verify owner release and private feedback destinations independently.
  - Move active development to this repository, then archive the original after
    confirming no active release, automation or contributor work depends on writes.

## Execution frontier

- P1(b)

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P1(b) | gated_by | external:provider-publication-rights | Confirm permission for implementation details learned under provider agreements. |
| P2 | gated_by | external:owner-repository-publication | The owner approves the exact prepared public surface. |

## Next step

**Now (@owner):** resolve provider-source publication permission and review the
prepared source and contributor terms. The private candidate has passed typecheck,
plan and workflow validation, 19 contributor-rights tests, 17 CI-policy tests,
12 artwork checks and 34 upload-script cases, with independent security review.
Native compilation and UI verification wait for authorized hosted CI in P2.
Private review evidence and the proposed provider question stay with the maintainer.

## Notes / open questions

- Contributor acceptance records contain identity and signature evidence and stay
  private. The rights check records only hashes and repository metadata; it is
  a maintainer attestation, not automatic legal verification.
- Public contributors use forks. Keep repository write access owner-only: a
  GitHub Actions source-pinned status does not distinguish privileged workflows
  created by another same-repository writer.
- Raw provider logos stay outside public Git history. Official releases supply
  licensed artwork through the ignored paths in `docs/RELEASE-ASSETS.md`.
- Branch protection and private-reporting settings may be unavailable while a
  personal repository is private. Treat unavailable settings as pending, never
  configured. The publication sequence keeps Actions disabled and other writers
  absent until the controls are verified.
