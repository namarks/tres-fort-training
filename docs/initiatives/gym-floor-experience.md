# Gym-Floor Experience

Slug: gym-floor-experience · Status: active · Updated: 2026-11-18

## Objective

Let a member get from sign-in to a well-executed workout with or without AI,
whether they train with a barbell or their own body: reach the manual routine
builder that now exists, run the routine efficiently in the gym, and return for
the next scheduled session.

## Scope

- plan:workout-library#P0.14
- plan:workout-library#P0.15
- plan:progressive-plans#P6
- plan:coach-free-planning#P2

## Priority policy

Completed supersets and circuits
provide shared group authoring, alternating execution and recovery. Future
routine/runner changes reuse that foundation; production/app release remains
separate from repository completion.

Completed app quality and maintainability
provides current-iPhone CI, basic usability and measured history performance.
Its app release remains separate from repository completion.

Completed Gym Runner Depth
provides prescription fidelity, durable corrections, bounded loading/timing
aids and the persisted completion summary. Its production/app release remains
separate from repository delivery.

Completed bodyweight support
provides the comparable-metrics repository foundation. Its Worker/app release
remains separate from repository completion.

The owner activated this core lifting pass on November 15. Child plans own
status and acceptance; this initiative only orders their work:

1. Adapt a solo workout in progress: extra circuit/superset rounds and rest
   changes for the remaining group rounds or transitions.
2. Protect unfinished programming: new-block setup and workout metadata,
   including explicit review after concurrent changes.
3. Make manual progression reachable: edit one or later block weeks from the
   phone and preview a lighter week on phone/web. Distinguish active session,
   indexed block week (including repeated cycles) and reusable workout.

Public PR #9 (merged 2026-11-16) delivered all four selected nodes, and the
2026-11-17 API, web and TestFlight 1.2 (83) releases carry them. The child
plans record the owner's device acceptance that remains. Selecting the next
lifting slice (for example partner training's shared ending and invitation
recovery) is the owner's call; until then no node in this pass is runnable.

Use the shared plan tree, versioned writers and runner checkpoint contract.
Independent surfaces may proceed in parallel; shared editor changes coordinate
through the child plans. Existing history/correction and shared exercise
instructions are foundations, not work to rebuild. Qualify actual user journeys
alongside deterministic rules; backend checks alone do not qualify native UI.

## Completion condition

A new member can preserve invite or coach intent, manually create and schedule
a workout when desired, complete and correct that workout in the runner, and
receive a useful reminder for the next session. A bodyweight-first member gets
the same path: holds and rep ranges are prescribable, added load and assistance
are loggable, and history reports numbers that mean something for zero-load
work. Claude can read and edit the same plan, but no step requires AI.
The same journey distinguishes empty/loading/failure/pending/saved states,
honors new targets, permits correction at the finish boundary, and passes the
documented current-iPhone, normal-text behavioral suite. Basic contrast, control
labels/targets and Reduce Motion improvements remain; older-device/extreme-font
matrices and physical accessibility walkthroughs are not delivery gates. Representative history
size has measured client performance and reproducible iOS verification.

## Stop rules

- This selection does not activate paused member-activation P4, partner camera
  counting, automatic weight suggestions, or a separate web workout runner.
- Shared ending/invitation recovery and date-only replacement of scheduled
  extras remain follow-ups in their owning plans. They do not block this pass.
- Production deployment, migration, client distribution and physical acceptance
  retain their separate authority and evidence requirements.
