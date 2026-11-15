# Plan without an AI coach

Slug: coach-free-planning · Status: active · Updated: 2026-11-09 · Theme: gym-floor

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
  - Still to do: the iOS editor for the event, and training phases in the
    app and on the web.
- [ ] **P2 — Deload or lighten a week**
  - The member can make the change `adjust_today` makes: scale target
    weights or sets for one workout or the whole plan.
- [ ] **P3 — Smaller coach-only edits**
  - Exercise cues and the progression rule on a slot, notes on a workout,
    and deleting an intervals.icu activity that Tres Fort created.

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P0 | coordinates_with | plan:app-design-pass#P5 | Both change the Plan tab and ship in the same TestFlight build. |

## Next step

**Now (@owner):** P0 merged in PR #295 (2026-11-01). Its new REST routes
need a Worker deploy, with the owner's go-ahead, before any TestFlight build
that shows the Away dates row reaches members. An older Worker answers the
row's writes with 404, which the app shows as an error.

**Next (@agent):** P1's race goal REST and web editor are in review (owner,
2026-11-09); the iOS event editor follows, then training phases. The new
routes need a Worker deploy, with the owner's go-ahead, before the web
Event page can save.

## Notes / open questions

- The app needs no migration for P0: trips already live in `plans.meta`.
- Adding away dates doesn't delete anything already on those dates. The
  calendar's existing rules decide what each day shows: a workout started
  or done still shows, and a no-training range hides a workout only
  planned for that day.
