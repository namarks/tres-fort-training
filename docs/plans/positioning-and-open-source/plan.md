# Positioning (open source deferred)

Slug: positioning-and-open-source · Status: gated · Updated: 2026-11-18 · Theme: platform

## Goal

Present Très Fort as one plan for everything a member trains (lifting, runs,
rides, swims and other activities) with AI as an optional add-on. The owner
chose the positioning on 2026-11-01: "Everything you train. One plan." Done
means the repository, website, in-app copy and App Store listing all lead with
that. Open-sourcing was assessed in the same thread and deferred by the owner
on 2026-11-02 (see Notes).

## Phases

- [x] **P0 — Repository and website copy**
  - README, website home page, AGENTS.md and the DESIGN.md summary lead with one
    plan across disciplines, list Apple Health ahead of intervals.icu, and
    describe AI as optional. The website hero is checked at phone, tablet and
    desktop widths with no horizontal scroll.
  - Website changes go live only with a separate website deploy.
  - Merged in PR #296, with the hero checked at 390, 800 and
    1280 px. The owner approved the website deploy on 2026-11-01: the new website serves tresfort.app with the new title and hero;
    the homepage, /privacy and assets return 200 and the email DNS records are
    unchanged.
- [x] **P1 — In-app copy**
  - Onboarding and Profile → Coach wording treats AI as an add-on, without
    changing behavior.
  - Checked in public main on 2026-11-18: onboarding opens with "Everything
    you train. One plan." and its two optional steps are the member's usual
    week and the apps they already use, with no AI step (member-activation
    P5's shorter setup). Profile keeps the AI coach behind "Set up your AI
    coach", and the coach screens say the plan and history stay in Très
    Fort. Both are in TestFlight 1.2 (83).
- [ ] **P2 — App Store listing**
  - Subtitle "One plan for all your training", a new description and keywords,
    for the first App Store version that ships the run recorder. Version 1.0
    (build 55) keeps its current listing, because it has no run recorder and is
    already in review.
  - The owner approved a new subtitle and keywords for 1.1 (70), live since
    2026-11-09 ([App Store plan](../app-store-submission/plan.md)). The
    description and a recorder screenshot come with 1.2.

- [x] **P3 — Website after the App Store release** (live 2026-11-08)
  - The home page links the live App Store listing and the web app (a Log in
    button and "Plan on the web" to `app.tresfort.app`), uses the app's navy
    and orange, shows 1.1 screenshots with sample data, and covers the Plan
    tab, the workout screen, imported runs, rides and swims, Activity, groups
    and iPad Station, and the web app. It drops the "Coming soon" status and
    the hidden plan-change history. Beta-only features (run recorder, WHOOP)
    and Garmin stay off the site until they ship.
  - The owner reviewed the proposed page on 2026-11-08 and gave the written
    go-ahead to deploy it with the Garmin release. The website was deployed on 2026-11-08.

## Execution frontier

- P2

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P2 | gated_by | external:owner-app-store-next-version | The listing changes with the first App Store version that includes the run recorder (1.2). |

## Next step

**Now (@owner):** P2 with App Store 1.2: a description that leads with one
plan across sports and AI as optional, plus a recorder screenshot, once the
run recorder is ready (see the [App Store plan](../app-store-submission/plan.md)).
P1's in-app copy is done.

## Notes / open questions

- Apple Health as the default activity source (so members need no intervals.icu
  account) is app work outside this plan: typed-in runs, rides and swims
  currently require intervals.icu, and duplicate merging when both sources are
  connected needs checking with real data.
- Open source: the owner first deferred it on 2026-11-02, then published a
  cleaned source snapshot as this repository (`namarks/tres-fort-training`) on
  2026-11-15 under the root source license and contributor terms. See
  [public-repository](../public-repository/plan.md).
