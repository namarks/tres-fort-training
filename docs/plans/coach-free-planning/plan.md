# Plan without an AI coach

Slug: coach-free-planning · Status: active · Updated: 2026-11-18 · Theme: gym-floor

## Goal

Every change to the training plan that the coach can make through MCP can
also be made by the member in the iOS app, with no AI involved. The owner's
rule (2026-11-01): a feature that only the coach can use is a gap. Each
in-app path writes through the same `db.ts` function the coach's tool uses,
with the reviewed plan version, and is audited as `actor='ios'`.

Already closed elsewhere: target weight, reps and RPE per slot
([app design pass](../app-design-pass/plan.md)), the weekly schedule and date
assignments, and planned run steps ([planned runs](../planned-runs/plan.md)
P5).

## Phases

- [x] **P0 — Away dates**
  - Members add, edit and remove away dates (`plans.meta.trips`): a range
    of days with a reason (travel, rest, injury, other), whether they can
    still train, and a note. These are the ranges the coach writes with
    `add_trip`, `update_trip` and `remove_trip`.
  - REST: `POST /api/plan/trips`, `PATCH /api/plan/trips/:id` and
    `DELETE /api/plan/trips/:id?expected_version=`. Each needs the reviewed
    plan version, rejects unknown or invalid fields before writing, and goes
    through `addTrip` / `updateTrip` / `removeTrip`. A stale version is a
    409 with `{conflict, current_version}`; a missing range is a 404.
  - iOS: the Plan tab's Calendar section has an "Away dates" row that shows
    the next range and opens a list of coming-up and past ranges. The editor
    picks the first and last day (the last day can't come before the
    first), the reason, "I can still train" and a note. An edit sends only
    the fields that changed. Saving and removing carry the plan version the
    editor opened with and go through the routine write queue. If the plan
    has moved on, the write is a conflict: the app reloads, closes the
    editor and asks the member to review.
  - The calendar already reads trips: a range where the member can't train
    blocks the days, and one where they can pauses the weekly schedule.
- [ ] **P1 — Race goal and training phases**
  - Set, change and clear the race goal (`set_race`) and the training phase
    blocks (`set_periodization`) in the app.
  - Race goal REST and web (owner, 2026-11-09: track progress toward a
    specific event, event first): `PUT /api/plan/race` takes
    `{race, expected_version}` with `name`, `date` (a real calendar day) and
    `discipline` required and `distance`, `distance_m`, `goal_time_s`,
    `priority` and `location` optional; it replaces the whole event through
    `setRace`. `DELETE /api/plan/race?expected_version=` clears it through
    `clearRace`, which writes nothing when no event is set. Unknown or invalid
    fields are rejected before writing, a stale version is a 409 with
    `{conflict, current_version}`, and audit rows carry `actor='ios'` or
    `'web'`. The race goal gains the optional `distance_m` and `goal_time_s`
    (the coach's `set_race` takes them too), so a client can work out goal
    pace. The web sets, edits and removes the event on its Analysis section's
    Event page ([web app](../web-app/plan.md) P3); the web gateway allows the
    two routes.
  - iOS event editor (placement is mock option B, offered to the owner on
    2026-11-18 beside a quieter row and a Today countdown):
    with an event set, a card at the top of the Plan tab's Schedule side
    shows its date and countdown, name, distance, goal time and goal pace;
    tapping it opens the editor. With none, a "Set an event" row sits beside
    Calendar. The editor sets name, date, type (the web's five plus
    "Something else"), distance (the web's presets per sport, another
    distance in its unit, or free text for multisport and other types, and a
    distance the coach saved as text is kept) and an optional goal time
    (`18:00`, `1:45:30` or minutes), with goal pace or speed worked out, and
    removes the event after a confirmation. Saves send the whole event
    through `PUT /api/plan/race`, keeping a priority and location the coach
    set; removal uses `DELETE /api/plan/race`. Both carry the plan version
    the editor opened with and go through the routine write queue; a newer
    plan is a conflict that reloads, closes the editor and asks the member to
    review. The draft rules mirror `web/src/event.ts` (`EventGoal.swift`,
    `EventGoalTests`).
  - Still to do: training phases (`set_periodization`) in the app and on the
    web.
- [x] **P2 — Deload or lighten a week**
  - Offer a reviewed lighter-week action in native and web block planning:
    one scheduled lifting workout or all lifting workouts in the selected
    week, with explicit set and/or load reduction and before/after targets.
  - Change only that block week's target overrides through `setProgram`.
    Do not use `adjust_today`: it changes reusable targets, which is a
    different scope. In a repeating block explain that the indexed week
    changes each cycle; do not imply a single calendar occurrence.
  - Start from effective week targets, include primary and extra workouts
    once each, preserve equal group rounds, and leave warm-ups and cardio
    alone. Unknown loads stay unknown; reducing assisted work increases
    assistance rather than moving the signed load toward zero. Preserve units.
  - Preview before applying; stale versions require explicit review. Keep
    reusable workouts, other weeks and history unchanged. Recorded active
    workouts are protected by the shared writer, and the same phone guards
    its pre-first-set runner; the remote offline/unlogged limitation is
    recorded in progressive-plans P6, which also owns native manual targets.
  - Delivered with progressive-plans P6 in public PR #9 (merged 2026-11-16)
    and released with the API, the web app and TestFlight 1.2 (83) from main
    on 2026-11-17. The owner's device look rides on progressive-plans P5.
- [ ] **P3 — Smaller coach-only edits**
  - Exercise cues and the progression rule on a slot, notes on a workout,
    and deleting an intervals.icu activity that Tres Fort created.

## Execution frontier

- P1

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P0 | coordinates_with | plan:app-design-pass#P5 | Both change the Plan tab and ship in the same TestFlight build. |
| P2 | coordinates_with | plan:progressive-plans#P6 | Both edit reviewed week targets through the existing program writer. |

## Next step

**Now (@agent):** P1's training phases (`set_periodization`) in the app and
on the web. The iOS event editor is built (see P1) and rides the next
TestFlight build; the owner's look on a device is part of that build's
checks. Then P3's remaining edits: editing existing slot cues and
progression, and native workout notes (creation-time lifting cues already
exist).

P2's reviewed lighter week is delivered and released (see P2). Deployments
and client distribution require separate authority.

## Notes / open questions

- The app needs no migration for P0: trips already live in `plans.meta`.
- Adding away dates doesn't delete anything already on those dates. The
  calendar's existing rules decide what each day shows: a workout started
  or done still shows, and a no-training range hides a workout only
  planned for that day.
