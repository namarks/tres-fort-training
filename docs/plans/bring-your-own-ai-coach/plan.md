# Bring Your Own AI Coach

Slug: bring-your-own-ai-coach · Status: gated · Updated: 2026-11-22 · Theme: coaching

## Goal

Members can coach in their chosen external AI app, starting with Codex and
preserving Claude, while Très Fort remains the source of truth for training.
The free offering uses members' own supported AI accounts or subscriptions.
Repository delivery and actual provider connection/release evidence remain distinct.

## Phases

- [x] **P0 — Make the external coaching contract portable**
  - Neutral setup, consent, profile and new-note attribution; preserve historical
    notes, legacy API compatibility, account isolation and existing OAuth grants.
  - Expose the coaching brief as a tool alongside its resource and prompt.
  - Guide Codex, Claude and generic compatible apps without promising universal
    model/client support or accepting provider API keys.
- [x] **P1 — Verify the coaching and compatibility behavior**
  - Exercise synthetic OAuth client flows, coaching reads/writes, stale-version
    conflicts, refresh/disconnect, API rollout compatibility, and iOS setup.
  - Local Codex review completed after the callback and disclosure fixes.
    Repository delivery is complete; the merged PR and release evidence are below.
- [ ] **P2 — Release and verify a real Codex connection**
  - Worker and iOS 1.0 (42) released under explicit owner authority on
    2026-09-14 Pacific; the private release receipt
    records exact source, production traffic and internal TestFlight availability.
  - Owner completes Codex sign-in using their own code, verifies a read and one
    reversible plan change in iOS, then disconnects/reconnects.
- [x] **P3 — Prepare mobile account approval and the plugin**
  - Approved 2026-09-12: implement the iPhone connection direction. Desktop
    manual configuration remains an advanced fallback; the product-choice hold
    is resolved.
  - Prepare the remote MCP package, listing assets, annotations and five
    positive/three negative review cases in `plugins/tres-fort/`.
  - Implement explicit signed-in app approval via a verified website Universal
    Link, with expiring one-use requests, PKCE-bound callbacks and account fences.
  - Local checks: 1,057 backend tests; 551 iOS unit tests passed and one
    existing skip; mobile consent UI journey; Chrome 152 form redirect/PKCE
    round trip (IPv4/IPv6, initial consent and retry, JavaScript disabled);
    eight focused iOS session/approval tests after the renewal fix; plugin,
    site, TypeScript and plan validation. Local review found
    a Chromium CSP redirect regression and an understated legacy logging hint;
    both are fixed with behavioral regression coverage. Unfinished approvals
    remain cancellable from Profile even before a token exists.
    PR #191 retains the completed foundation delivery checks.
  - CI scope correction: the former smoke list had expanded to 56 of 77 UI
    methods; one shard spent 18 minutes on UI tests and another hit the job
    timeout. Following the owner's cost/latency concern, PRs keep all unit tests
    plus twelve explicit core journeys on two runners. Nightly/manual runs
    retain the full suite on three runners. Active logs survive forced
    cancellation; assertions and the 30-minute limit remain unchanged.
    [Verification policy](../../IOS-VERIFICATION.md) records the selection.
  - Integrated current App Store attribution/reviewer changes: dedicated plugin
    review uses an ordinary synthetic member, not the retired shared sample
    identity. Focused verification passed 111 backend tests, 14 iOS unit tests
    and two approval/sign-in UI journeys, plus the verifier/scope and plan checks.
- [x] **P3.1 — Simplify linking for Claude and Codex**
  - Approved 2026-09-14: present both provider choices with setup actions before
    optional code generation. Default to Claude's available mobile web flow.
  - Claude uses its documented prefilled install link; native account approval
    remains explicit and the connect-code form remains a fallback. Successful
    browser handoff dismisses setup so returned approval can present immediately.
    Press and hold the connect button to copy the prefilled link for Safari.
    Incoming approval also replaces open or restored setup after a copied link.
    Profile, Today and onboarding share the same setup presentation.
  - Codex receives a credential-free setup request with manual desktop/CLI
    fallbacks. Explain its computer requirement and Remote support. A hosted
    mobile install still requires the P4 provider-issued listing URL.
  - Verification covers 26 backend protocol/approval tests, 14 iOS unit tests,
    five focused UI journeys (provider handoff, open/restored setup return,
    code fallback, approval and connected-member continuation), TypeScript and
    plan validation.
    Inspected synthetic Claude/Codex screenshots. Review follow-ups cover the
    browser-return presentation, connected-status journey and family quickstart.
    PR #207 merged after exact-head independent
    review and all eight checks passed. The merged-source CI also passed.
    Real-device provider handoff remains P2/P4.
- [ ] **P4 — List Très Fort in ChatGPT's app directory and verify the Connect button**
  - The owner asked on 2026-11-08 to set up ChatGPT next to the Claude listing
    (P6). OpenAI now lists MCP apps for ChatGPT and Codex in one plugin
    directory; the portal answers, test cases, demo video script and domain
    challenge steps are in the
    submission worksheet.
  - [x] Serve OpenAI's domain challenge at `/.well-known/openai-apps-challenge`
    from the Worker secret `OPENAI_APPS_CHALLENGE` (404 while unset), with
    `test/openai_apps_challenge.test.ts`.
  - [x] Publish the reviewed terms draft at `tresfort.app/terms`
    (`website/terms.mjs`), link it from the home page, the guide and the
    plugin manifest, and add ChatGPT steps (custom MCP server) to `/connect`.
  - [x] Reuse the standing review code and synthetic review account from P6
    for OpenAI's reviewers.
  - [x] Owner-authorized release of the Worker and website from the Mac
    (2026-11-08).
  - [x] Owner-approved setup consolidation (2026-11-22): one ChatGPT choice
    explains the shared plugin for supported ChatGPT/Codex experiences. Direct
    computer setup moves to **ChatGPT → Advanced → Connect Codex directly**
    with its own recipient consent. The app, public guide and README match;
    the existing setup journey covers the hidden advanced route and consent
    after switching from ChatGPT. This repository slice does not publish the
    plugin or distribute an iOS build. OpenAI documents shared supported
    plugins for Dots; Très Fort's full Dots flow remains unverified and is not
    advertised as certified. Sources and limits are in the connection guide.
  - [ ] Owner adds Très Fort in ChatGPT as a custom MCP server, checks a read and
    a write, and records the demo video. The owner added it on 2026-11-08;
    the demo video is still to record.
  - [ ] Owner verifies an identity on the OpenAI Platform, verifies the domain
    with the issued token, scans tools and submits.
  - [ ] After approval and publication produce a real listing URL, add ChatGPT
    to Coach Connect, then verify install, approval, coaching read/write, iOS
    sync and disconnect on iPhone. No placeholder install URL is shipped.

- [ ] **P5 — Request a coaching change from its workout context**
  - [ ] **(a) Prototype the request, proposal and return journey**
    - Planning approved after the SensAI inspection.
      Prototype Adjust today from the workout and a coach request from a specific
      exercise; keep the deterministic Swap exercise path directly available.
      Use a few concrete jobs: 20 minutes available, equipment busy, explain this
      exercise, and an easier session before a ride. Preserve the selected
      workout/exercise identity so the member need not re-explain it.
    - Start with a synthetic prototype and the supported external-coach handoff
      where available. Measure navigation steps, re-entry of context, mistakes
      and lost context on the same tasks; report unsupported handoff or return
      behavior honestly. Do not imply external coaching is equivalent to an
      embedded assistant or that a mobile Codex install URL already exists.
    - Show request → concrete proposed exercises/sets/loads with reasons →
      explicit Apply/Cancel and return. Clearly distinguish today's session from
      the saved workout/recurring routine before any mutation. A proposal is not
      a write, and the prototype must not send a live write request.
  - [ ] **(b) Deliver the selected contextual coaching path**
    - After prototype evaluation and an explicit delivery decision, implement
      only the selected path. Before writes, define the proposal payload, scope,
      account, plan ID/version, session ID/attempt and relevant swap revision.
      Read-only explanations can use the current coach brief without new AI
      execution in the Worker.
    - Resolve the one-session adjustment contract before labeling an action
      Adjust today: the existing MCP `adjust_today` changes reusable template
      targets (and without a workout selector may affect the whole plan).
      It must not masquerade as a session-only change. Reuse the delivered
      session-swap contract for supported swaps; broader one-session set/target
      changes require an explicit shared REST/MCP service contract, not a
      client-only workout copy or a silently edited recurring prescription.
    - Require reviewed proposal identity/version at Apply, atomic writes and
      audit, completed-set preservation, compatible group/rep/timed semantics,
      uncertain-response recovery and safe stale-proposal rejection. Cancel or
      rejected requests make no change; a deliberate recurring edit uses the
      existing plan-version/snapshot path. Session edits retain attempt-scoped
      recovery and never rewrite historical sets.
    - Verify a shorter-session request through proposal, explicit application
      and return to the intended workout, plus equipment replacement and an
      explanation requiring no write. Cover completed work, concurrent plan or
      swap changes, account switches, retries and cancellation. Real-provider
      and physical-device handoff evidence stays separate from synthetic tests.
      If a supported provider cannot honor review-before-write, keep that action
      read-only until a suitable delivery path exists.
    - Embedded coaching remains a separate owner decision covering provider,
      model, health-data disclosure/retention, per-user usage limits, measured
      cost and any paid entitlement. This plan adds no API key storage, token
      spend, background inference, model selection or billing authorization.

- [ ] **P6 — List Très Fort in Claude's Connectors Directory**
  - Chosen by the owner on 2026-11-08 as the next step for members connecting
    their own AI: no official listing existed anywhere, so Claude members could
    only add a custom connector (one on Claude's Free plan). A directory listing
    is screened automatically and labeled Community by default; Anthropic may
    escalate it to Verified review on its own.
  - [x] Give every MCP tool a `title` (top level and `annotations.title`), which
    the directory requires, with test coverage in `test/coach_clients.test.ts`.
  - [x] Publish a public setup guide at `tresfort.app/connect` (`website/connect.mjs`),
    linked from the home page and checked against the app's labels and shared-data list.
  - [x] Prepare the portal answers in the
    Claude directory worksheet.
  - [x] Let a directory reviewer sign in: the owner chose (2026-11-08) a
    standing review code limited to one synthetic account (`REVIEW_CONNECT_CODE`
    + `REVIEW_USER_ID`), refused for the owner or any account with groups,
    activities or Intervals.icu; tested in `test/review_connect_code.test.ts`.
  - [x] Review member created in production D1 (no Apple sign-in), secrets set,
    API released on 2026-11-08, and the code
    verified end to end; test plan seeded through MCP.
  - [x] Owner deploys the website (`tresfort.app/connect`) and submits in the
    portal (both 2026-11-08).
  - [ ] After listing, point **Connect with Claude** at the issued directory URL,
    update the guide, and verify find → connect → approve → read → edit → app
    sync → disconnect on iPhone.

- [ ] **P7 — Approve an AI connection with Sign in with Apple**
  - The owner found the connect-code setup confusing while connecting ChatGPT
    (2026-11-08) and chose approval with Sign in with Apple instead of codes.
  - [x] The Très Fort sign-in page an AI app opens leads with **Continue with
    Apple**, which opens the web app's `/coach/authorize` for the same
    request (the one the iPhone app approves). The member signs in, reviews
    the recipient and shared data, and allows or denies; the browser returns
    to the AI app. The connect code stays as a fallback for loopback clients
    (Codex) and hosted browsers.
  - [x] The web gateway allows only `POST /api/coach-requests/<id>` beyond plan
    edits, and Sign in with Apple returns only to a `/coach/authorize` request.
  - [x] The iPhone setup screen offers ChatGPT with three steps.
  - [ ] Owner-authorized release of the Worker, web app and an iOS build, then a
    real ChatGPT or Claude connection approved with Apple on a computer. The
    Worker and web app were released on 2026-11-08 and later TestFlight builds
    carry the iPhone ChatGPT option; the real approval with Apple remains.

- [ ] **P8 — Connect Claude from the phone in fewer taps**
  - The owner found iPhone setup too long (2026-11-10): a consent screen to
    scroll, **Allow sharing with Claude**, then a second screen needing
    **Connect with Claude**, then another long list on the approval screen and
    **Continue to AI app**.
  - [x] The consent fits on one screen: the recipient, what it can do, the
    shared data as six short lines (full list under **Full details**, still
    `CoachSharing.sharedData`) and both privacy policies on one row. Nothing
    that connects is shown before the member allows sharing (App Review
    5.1.1(i)/5.1.2(i)).
  - [x] For Claude, **Allow and connect Claude** allows sharing and opens
    Claude's prefilled connector form in one tap. Press and hold offers
    **Allow and copy setup link**. ChatGPT, Codex and other apps keep
    **Allow sharing** followed by their steps.
  - [x] The approval screen uses the same short list and **Allow and return to
    Claude** (named from the registered return address) opens the AI app's
    return link itself; **Continue to AI app** stays as a fallback.
  - [x] Mock kit screens `coach-connect` and `coach-approval`; the website guide
    and connection notes follow the new labels.
  - [x] An official look without third-party logos (owner's choice, 2026-11-10):
    a "Connect Très Fort to Claude" header with the Très Fort icon and a name
    tile for the AI app, the apps as tiles instead of a menu, and the decision
    pinned to the bottom of both screens. Anthropic and OpenAI allow their
    logos only with permission (App Store 5.2.1 also rejects unlicensed
    trademarks), so the tile shows the app's name until they approve.
  - [ ] Owner asks Anthropic and OpenAI for permission to show their logos on that tile.
  - [ ] Owner tries it on a TestFlight build: Today or Profile → set up coach →
    Allow and connect Claude → confirm in Claude → Open Très Fort to review
    access → Allow and return to Claude. Claude's own confirm step can't be
    skipped from Très Fort.

- [x] **P9 — Fewer tool approval prompts in Claude**
  - The owner found Claude asking before every tool call, even reads such as
    "Get recent activities" (2026-11-11). Claude decides whether to ask and
    each member sets it in their own account; a connector cannot force
    **Always allow**.
  - [x] Every read tool is annotated `readOnlyHint: true` (since PR #373); a
    test now covers every `get_`, `list_` and `compare_` tool.
  - [x] The website guide and the connection notes give the steps: **Customize
    → Connectors → Très Fort**, then **Always allow** for all tools or only
    the read-only ones, plus a troubleshooting line for Claude's reset bug
    ([anthropics/claude-ai-mcp#493](https://github.com/anthropics/claude-ai-mcp/issues/493)).
  - [x] Website released 2026-11-11.
  - [x] Root cause found 2026-11-11: the owner's connector predated the
    annotations and Claude kept the old tool details. After removing and
    re-adding it, reads ran without asking (owner-verified). New connections
    are unaffected; changes still ask by design.
  - [x] A one-line tip on the iPhone and web approval screens (PR #436, web
    released) was removed again by the owner's choice once
    reconnecting fixed reads (2026-11-11). The website guide says to remove
    and re-add the connector if reads still ask.

- [ ] **P10 — Connect Claude with one approval**
  - The owner walked a family member through setup on their iPhone
    (2026-11-21) and found too many screens to accept. The map: about nine
    screens, four of them Très Fort's. The shared-data list appeared twice,
    the Très Fort page inside Claude offered two equal buttons (**Continue
    with Apple** added three more screens and a third list), and nothing said
    the flow would go to Claude and back. Mocks of two options:
    `/mnt/project-files/coach-setup/streamline-2026-11-21/`. The owner chose
    "approve once, up front" (about five screens, two of them Très Fort's).
  - [x] **Allow and connect Claude** makes the member's one-time connect code
    and hands Claude a connect link, `/mcp/c/<code>`, as the connector
    address. The link's metadata names it as the resource; `/oauth/authorize`
    redeems it for a Claude callback, audits `connect_link` and returns to
    Claude without a Très Fort page. A spent, expired or replaced code, another
    app, or a client that drops the link falls back to the consent page and
    phone approval. Token exchange and refresh accept the link; logs redact it.
    `test/coach_connect_link.test.ts`.
  - [x] The consent screen lists **What happens next** in two steps. Setup
    stays open while the member is in Claude, checks for the new connection
    and shows **Claude is connected** with a first question to ask. Without a
    code (offline, older server) the app opens the plain address as before.
    Mock kit `coach-connected`; website guide and connection notes updated.
  - [ ] Owner-authorized release of the Worker, then a TestFlight build.
  - [ ] Owner tries it on an iPhone with the Claude app: Set up your AI coach →
    Allow and connect Claude → Add (and Connect) in Claude → back in Claude,
    connected, with no Très Fort page → Très Fort shows Claude is connected.
    This checks what Claude's docs don't say: that Claude keeps the link as
    the connector address and signs in with it. If it does not, the fallback is
    today's flow, and Option A (one button on the Très Fort page, a one-tap
    finish without the repeated list) is the next step.

## Dependencies

| Local phase | Relationship | Target | Reason |
|---|---|---|---|
| P2 | gated_by | external:owner-byo-coach-device-verification | Production and internal TestFlight release are complete; the real-provider connection requires the owner's signed-in iPhone and AI account. |
| P4 | gated_by | external:owner-coach-plugin-publication | The Worker and website release, OpenAI identity verification, the demo video and the portal submission need the owner; approval must produce a real listing URL. |
| P5(a) | gated_by | external:owner-sensai-followup-implementation | September 18 approval adds this prototype to the plan; it does not activate implementation. |
| P5(b) | gated_by | external:owner-contextual-coach-delivery-choice | Choose the supported handoff or separately scoped embedded service after reviewing evidence, write contracts and cost/privacy implications. |
| P5 | coordinates_with | plan:workout-library#P0.5 | Exercise sheets, swap discovery and contextual coach entry share workout surfaces. |
| P6 | gated_by | external:owner-claude-directory-submission | The website release and the portal submission need the owner's accounts and authority. |
| P7 | gated_by | external:owner-coach-apple-approval-release | The Worker, web app and iOS releases and the real-provider check need the owner. |
| P8 | gated_by | external:owner-coach-setup-device-check | A TestFlight build and the check on a real iPhone with a Claude account need the owner. |
| P10 | gated_by | external:owner-coach-connect-link-release | The Worker release, a TestFlight build and the check on a real iPhone with the Claude app need the owner. |

## Next step

**Now (@owner):** P10. Release the Worker from main after the PR merges, then
a TestFlight build, and try **Allow and connect Claude** on an iPhone with the
Claude app: it should come back connected with no Très Fort page. If a Très
Fort page still appears, Claude dropped the link; the connection still works
through the page, and Option A is the next step.

**Also now (@owner):** P8 on TestFlight 1.2 (83), which carries the shorter
setup: Profile → set up coach → Allow and connect Claude → confirm in Claude
→ review access in Très Fort → Allow and return to Claude. Also send the logo
permission requests to Anthropic and OpenAI if they have not gone yet.

**Also now (@owner):** P6 was submitted in Anthropic's portal on 2026-11-08;
when the listing is issued, point **Connect with Claude** at it and verify
the round trip on the iPhone.

**Also now (@owner):** P4. The Worker (domain challenge) and website
(`/terms`, ChatGPT steps in `/connect`) are live and Très Fort is added in
the owner's ChatGPT. Left: record the demo video, verify an identity on the
OpenAI Platform, set the domain token and submit, using the ChatGPT
submission worksheet. P7's real approval with Apple can be checked during
the same ChatGPT session.

**Also now (@owner):** On TestFlight 83 or later, complete the real-provider
connection, coaching read, reversible edit, iOS sync and disconnect/reconnect
checks. Claude's install link and native approval are released, but their full
physical-iPhone round trip has not been verified. ChatGPT's custom plugin is the
shared OpenAI route; direct Codex setup is an optional advanced connection.
A one-tap directory install still requires P4 publication.

**Also now (@owner):** Muse is verified (see notes). The shared ChatGPT setup
direction is approved (2026-11-22); Très Fort's full Dots connection, coaching
read and reversible write still need verification before a support claim.
The sign-in hardening from
PR #239 (accepting
`offline_access`, path-inserted discovery, recipient naming, logging refused
OAuth requests for `wrangler tail`) is in the source and in the API released
from public main on 2026-11-17.

**Release complete (2026-09-14 Pacific):** The owner authorized the latest
production and TestFlight release. The reviewed source serves 100% of traffic;
Apple reports build 42 VALID, IN_BETA_TESTING and assigned to internal Testers.
The website already matched the release and all migrations were already applied.
The exact release receipt is kept privately. Public
checks do not prove authenticated training behavior or a physical-device handoff.

**Plugin publication remains gated:** Complete publisher identity, dedicated
synthetic reviewer access, terms approval and explicit submission/publication
authority. This release did not submit a plugin or publish the draft terms.
Claude's documented install link does not require directory review; a phone-only
Codex install still does. P3 landed in PR #191;
P3.1 landed in PR #207.

## Notes / open questions

- 2026-10-05: Meta Muse and ChatGPT Dots were requested as coaching hosts.
  Muse adds a remote MCP connector from a chat prompt and signs in from Meta's
  hosted browser, so the connect code is its approval path. Dots use apps
  enabled on the member's ChatGPT account; OpenAI does not say whether
  developer-mode apps qualify, and its developer-mode page limits Pro to
  read/fetch. If Dots need a published plugin, P4 is the route.
- 2026-10-06: Muse verified on the owner's account. It read the coaching brief
  and made a plan change that synced to iOS plan history. It is not an in-app
  setup choice: Meta uses Meta AI chats for ads, which conflicts with the
  privacy policy's equal-protection promise and App Store guidelines
  5.1.2(vi)/5.1.3(i). On 2026-10-07 the owner kept it member-connected through
  Other compatible app until 1.0 is approved; the
  [connection guide](../../COACH-CONNECTIONS.md) documents that route.
  ChatGPT developer mode and Dots remain unverified; the owner deferred trying
  them on 2026-10-07.

- P5 is a planned follow-up, separate from P2 device verification and P4 plugin
  publication. The highest-priority non-AI work is library P0.5(a)/(b); evaluate
  the contextual prototype separately before committing to an in-app AI service.
  SensAI's visible request forms do not establish its model, inference location,
  cost, response quality or approval/rollback behavior.

- Approved 2026-09-12: conversations remain in users' external AI apps. A future
  paid package may bundle in-app coaching and API usage if costs justify it.
  No provider key storage, model execution, billing, paid entitlement, pricing,
  is authorized or implemented here.
- Setup correction 2026-09-12: terminal commands are optional, collapsed under
  Advanced; the normal Codex path uses the desktop app's server form. This still
  requires entering a URL and is not an iPhone-only or one-button connection.
  P3/P4 record the requested consumer flow. Public plugin distribution is separate
  from the existing direct desktop MCP connection and from future paid API usage.
- Verification: the final backend suite passed all 1,046 tests across 74 files.
  All 60 focused OAuth and client tests, TypeScript and website tests passed. iOS unit coverage:
  545 passed and one existing test skipped. All ten activation journeys passed
  across the full run and the two corrected lazy-row navigation reruns; the
  Codex setup screenshots were inspected. Local Codex reviews, including review
  of the command-free setup, found no actionable regressions. The revised setup
  UI journey also passed. The merged PR checks carry the final independent
  review and CI evidence; no repository-delivery gate remains open.
- PR #191 carries the merged P3
  foundation. Its checks retain the final repository-delivery evidence.
- Initial source was remote main.
  Implementation used isolated worktrees and integrated the concurrent onboarding
  and App Store changes before the recorded merges.
- [Connection guide](../../COACH-CONNECTIONS.md) defines supported capabilities,
  rollout behavior and the real-account verification procedure. Synthetic protocol
  fixtures do not prove a specific installed Codex version or live model response.
