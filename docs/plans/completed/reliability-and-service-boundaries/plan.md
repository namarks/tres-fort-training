# Reliability and Service Boundaries

Slug: reliability-and-service-boundaries · Status: done · Archived: completed · Updated: 2026-11-18 · Theme: platform

## Goal

Deliver the owner's requested follow-up to PR #201: consistent workout edits,
clear service and recovery ownership, dependable local checks, operational
performance evidence, and a safe path out of temporary workout compatibility.

## Phases

- [x] **P0 — Consistent workout edits and verification**
  - Return actionable conflicts from add, patch, swap and delete; preserve
    successful wire shapes, legacy bounded retries and atomic attribution.
  - Make the default test entry point run the supported backend shards and
    report missing prerequisites before expensive work.
- [x] **P1 — Cohesive service and recovery boundaries**
  - Extract backend OAuth grant lifecycle and provider reconciliation behind
    the public service facade, preserving ownership and transaction semantics.
  - Extract pure runner recovery decisions and account-bound artifact ownership;
    test relaunch, delayed acknowledgements and remote terminal precedence.
  - End final-set rest; support bounded offline workout recovery/start with
    durable intent, exact attempt checks and visible conflict recovery.
- [x] **P2 — Measurement and canonical cutover**
  - Extend value-free operational measurements to coaching reads and workout
    writes; preserve existing query budgets and iOS performance probes.
  - Use canonical iOS requests and remove runtime legacy routes, tools, output
    aliases and SQL adaptation; retain readers required by existing stored data.
- [x] **P3 — Verify and publish the complete change**
  - Run local backend shards, typechecking, plan validation and synthetic probes;
    obtain iOS build/unit/UI evidence from the repository CI.
  - Publish a reviewable PR, complete review, and record deployment/app-distribution follow-ups.
  - Delivered in the original repository before the public snapshot of
    2026-11-15 (its PR #202). Checked in public main on 2026-11-18: the
    OAuth grant and intervals.icu services (`src/services/oauthGrants.ts`,
    `src/services/intervalsSync.ts`) sit behind the `src/db.ts` facade,
    `RunnerRecovery.swift` owns pure recovery decisions, the final set has
    no rest, and offline start needs a previously live-certified plan
    (`StateSnapshotStore`). The full hosted release check passed on public
    main (2026-11-16 and 2026-11-17), and the API, web app and TestFlight 1.2
    (83) were released from it on 2026-11-17.

## Dependencies

No external compatibility-cycle gate remains. On 2026-09-14 the owner stated
that the old client has only one installation (their own) and explicitly directed
its support to be removed. The already-recorded migration 0045 satisfies the
physical schema prerequisite; release and app distribution remain separate work.

## Next step

**Done (2026-11-18):** the follow-up to PR #201 is delivered, released and
covered by the hosted release check (see P3). No work remains in this plan.

## Delivery record

The scope includes structured slot conflicts and reviewed-version iOS editing,
internal OAuth and Intervals services, pure runner recovery, final-set rest,
certified offline start/resume, reproducible test shards, and value-free
operational measurements. Main already owns the canonical runtime cutover.
Existing immutable snapshot and cache/outbox readers remain data-preservation
code. No production migration, deployment or TestFlight distribution is part of
this repository delivery; those releases followed separately.
