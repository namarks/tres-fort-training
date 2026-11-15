# Très Fort public website

Small, dependency-free static site for `tresfort.app` with an app landing page
and `/privacy`. The iOS API, database, and authentication stay in the existing
Worker. The website does not receive app credentials or training data.

Run `npm ci` in this directory to install the website's pinned Wrangler CLI.
Run `npm run dev`, `npm run build`, or `npm test` here as well.
The build produces only public files in `dist/`. Static builds and tests support
Node 20 or later; the pinned Cloudflare deployment CLI requires Node 22 or later.

## Cloudflare hosting

`wrangler.jsonc` configures the standalone `tres-fort-website` Worker in the
operator's Cloudflare account. It serves static files at `tresfort.app`, with
no Worker script, database, credentials, cron, or application bindings.

From this directory:

```sh
npm run build
npx wrangler deploy --config wrangler.jsonc --dry-run
npm run deploy
```

The repository-root `deploy:website` command also builds and deploys only this
website, after installing this directory's dependencies. Do not use the root
`deploy` or `release` command to publish website changes; those target the app
backend. The custom-domain route lets Cloudflare provision the website DNS
and HTTPS certificate. Preserve the existing iCloud MX, SPF, DKIM, and Apple
verification records. Check the homepage, `/privacy`, an asset, and a missing
URL after deployment; compare the email DNS records before and after.

## App download and web app links

Très Fort 1.0 went live on the US App Store on 2026-11-08, free, for iPhone and
iPad. The hero links to the App Store listing (`APP_STORE_URL` in `home.mjs`).
The header's **Log in** button and the "Plan on the web" link go to the web app
at `app.tresfort.app` (`WEB_APP_URL`), where members sign in with Apple.

Advertise only what a released App Store version does. Beta-only features
(the run recorder, WHOOP) and the direct Garmin connection stay off the site
until they ship.

## Policy source

`privacy.mjs` owns the policy. `src/routes/privacy.ts` imports that same content,
preserving the policy URL already used by the app. Editing this file changes
both builds; deployment of the website does not deploy the app Worker.

Disclosures were checked against source at `69729d6`:

- `ios/TresFort/OnDeviceFeedbackTranscriber.swift`, `WorkoutFeedback.swift`,
  and `WorkoutFeedbackView.swift`: optional on-device speech recognition,
  discarded audio, and only explicitly saved text entering training records.
- `ios/TresFort/Health/HealthKitSyncModel.swift`: permissions, on-device
  heart-rate summary, uploaded workout fields, disconnect preserving imports.
- `ios/TresFort/Health/AppleHealthSettingsView.swift` and `src/db.ts` group
  projections: Apple Health group sharing is separate and off by default.
- `src/intervals.ts`, `src/routes/intervalsAuth.ts`, and `src/db.ts`: optional
  credentials, activity/event records and raw responses, strength-load export.
- `src/mcp/server.ts`, `src/oauth.ts`, and Profile: authorized coach reads and
  writes, group access, and revocation; no claim of deleting provider copies.
- `src/db.ts` `deleteUserAccount` and Profile: account export and active-record
  deletion, retained deletion receipts, and group transfer. No invented backup
  deletion deadline or automatic history purge on disconnect.
- `src/services/memberUsage.ts`, `src/auth.ts`, `src/mcp.ts` and migration
  `0078`: app, web and coach use (client, build from the standard User-Agent,
  iOS version, first/last seen, UTC days) and the owner-only Members summary,
  which leaves Garmin and WHOOP data out and never opens to the diagnostics
  token. In the account export, deleted with the account.

Repository behavior is not proof that the newest app Worker or iPhone build
has been released. No new consent or retention policy is activated by this
website change. Direct Garmin integration is not advertised.

## Colors

The palette lives in the `:root` tokens at the top of `styles.mjs` (and the
matching tokens in `connect.mjs` and `privacy.mjs`, which the app Worker also
serves at `/privacy`). Change colors there, not in individual rules. The site
uses the app's navy and orange (`docs/DESIGN-SYSTEM.md`,
`ios/Shared/BrandPalette.swift`): navy for text, links and the in-the-gym band,
orange only for the App Store button. `assets/app-icon.png` is the app's icon.

## Assets

Fonts and icon come from the iPhone app. Both font licenses are retained in
`public/assets/`. `today.png`, `runner.png` and `workouts.png` are the 1.1 App
Store screenshots (`01-today`, `02-runner`, `03-workouts`), captured from main
`0eda542` with the app's built-in sample data (`AppStoreScreenshotData.swift`)
and scaled to 603 × 1311. No member data was used. See
`docs/plans/app-store-submission/release-70.md` for the capture.

## Publication boundary

The operator authorized moving this website to Cloudflare at `tresfort.app`
on 2026-09-10. Deployment of the existing app Worker, database migrations,
TestFlight distribution changes, and App Store publication remain separate
release actions. The earlier owner-private ChatGPT Sites preview is not the
website's hosting configuration or deployment target.
