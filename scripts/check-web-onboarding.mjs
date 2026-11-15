// Local browser journeys against the real web gateway, Worker and a disposable
// D1. Uses synthetic users/keys only; no provider sign-in or production binding.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { get as httpsGet } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { decode, sign } from 'hono/jwt';
import { accountSwitchJourney, creationConflictJourney, liftingCreationJourney, mixedWeekJourney, signedOutJourney } from './web-onboarding-journey.mjs';
import { oneDateAccountJourney, oneDateEditJourney, oneDateRemovedJourney } from './web-date-edit-journey.mjs';
import { liftingPrescriptionJourney } from './web-lifting-prescription-journey.mjs';
import { workoutFeedbackJourney } from './web-workout-feedback-journey.mjs';
import { strengthReviewJourney } from './web-strength-review-journey.mjs';
import { groupMaintenanceJourney } from './web-group-maintenance-journey.mjs';

// Optional exact journey names keep a diagnosed failure's rerun focused.
// With no arguments the standard command still runs every journey.
const journeyNames = [1280, 800, 'account-switch', 'conflict-refresh', 'one-date-edit', 'one-date-account', 'one-date-removed', 'lifting-prescriptions', 'lifting-creation', 'lifting-creation-mobile', 'workout-feedback', 'workout-feedback-mobile', 'strength-review', 'strength-review-mobile', 'group-maintenance', 'group-maintenance-mobile'];
const requested = new Set(process.argv.slice(2));
const known = new Set([...journeyNames.map(String), 'signed-out-1280', 'signed-out-390']);
assert([...requested].every(name => known.has(name)), 'Unknown browser journey name.');
const selected = name => requested.size === 0 || requested.has(String(name));

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), 'tres-fort-web-onboarding-'));
// Use the web package's pinned runtime: its compatibility date is newer than
// the backend's, so an older root Wrangler may not be able to serve it.
const wrangler = path.join(root, 'web/node_modules/wrangler/bin/wrangler.js');
const syntheticSecret = 'local-browser-onboarding-only';
const signingSecret = 'local-browser-onboarding-signing-only';
const children = [];
let browser;
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  CI: '1', CLOUDFLARE_SEND_METRICS: 'false' };
const testFetch = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) });

function child(args) {
  const proc = spawn(process.execPath, [wrangler, ...args], { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const entry = { proc, output: '', exited: false, error: null };
  for (const pipe of [proc.stdout, proc.stderr]) pipe.on('data', chunk => { entry.output = (entry.output + chunk).slice(-12000); });
  proc.on('error', error => { entry.error = error; });
  proc.on('exit', () => { entry.exited = true; });
  children.push(entry);
  return entry;
}

async function command(args) {
  const entry = child(args);
  const code = await new Promise((resolve, reject) => {
    entry.proc.once('error', reject);
    entry.proc.once('exit', resolve);
  });
  assert.equal(code, 0, entry.output);
}

async function port() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}

async function ready(url, entry) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    assert(!entry.exited && !entry.error, entry.output || String(entry.error));
    try {
      const ok = url.startsWith('https:') ? await new Promise((resolve, reject) => {
        // Only the loopback web server below uses Wrangler's self-signed cert.
        assert.equal(new URL(url).hostname, '127.0.0.1');
        const request = httpsGet(url, { rejectUnauthorized: false }, response => {
          response.resume(); resolve(response.statusCode === 200);
        });
        request.on('error', reject); request.setTimeout(1000, () => request.destroy(new Error('Starting')));
      }) : (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
      if (ok) return;
    } catch { /* server is starting */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Local Worker did not become ready: ${entry.output}`);
}

try {
  const apiPort = await port(), webPort = await port();
  const apiOrigin = `http://127.0.0.1:${apiPort}`, webOrigin = `https://127.0.0.1:${webPort}`;
  const apiName = `onboarding-api-${process.pid}`;
  const apiConfig = path.join(scratch, 'api.json'), webConfig = path.join(scratch, 'web.json');
  await writeFile(apiConfig, JSON.stringify({ name: apiName, main: path.join(root, 'src/index.ts'),
    compatibility_date: '2024-12-30', compatibility_flags: ['nodejs_compat'],
    d1_databases: [{ binding: 'DB', database_name: 'onboarding-test', database_id: '11111111-1111-4111-8111-111111111111',
      migrations_dir: path.join(root, 'migrations') }],
    r2_buckets: [{ binding: 'DEMOS', bucket_name: 'onboarding-test-demos' }],
    vars: { APP_JWT_SECRET: signingSecret, DEV_AUTH_SECRET: syntheticSecret, APPLE_BUNDLE_ID: 'synthetic.web.onboarding' },
  }));
  await writeFile(webConfig, JSON.stringify({ name: `onboarding-web-${process.pid}`, main: path.join(root, 'web/worker/index.ts'),
    compatibility_date: '2026-09-01',
    assets: { directory: path.join(root, 'web/dist'), binding: 'ASSETS', not_found_handling: 'single-page-application',
      run_worker_first: ['/api/*', '/auth/*', '/maps/*'] },
    services: [{ binding: 'API', service: apiName }],
    vars: { APPLE_WEB_SERVICES_ID: 'synthetic.web.onboarding', WEB_ORIGIN: webOrigin },
  }));
  const persistence = path.join(scratch, 'state');
  await command(['d1', 'migrations', 'apply', 'onboarding-test', '--local', '--config', apiConfig, '--persist-to', persistence]);
  await command(['d1', 'execute', 'onboarding-test', '--local', '--config', apiConfig, '--persist-to', persistence,
    '--command', 'UPDATE workout_write_fence SET enabled=1,activated_at=1 WHERE id=1']);
  const api = child(['dev', '--local', '--config', apiConfig, '--port', String(apiPort), '--inspector-port', String(await port()), '--persist-to', persistence]);
  await ready(`${apiOrigin}/health`, api);
  const web = child(['dev', '--local', '--config', webConfig, '--port', String(webPort), '--inspector-port', String(await port()),
    '--local-protocol', 'https', '--local-upstream', `127.0.0.1:${webPort}`, '--persist-to', path.join(scratch, 'web-state')]);
  await ready(webOrigin, web);
  const auth = await testFetch(`${apiOrigin}/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: syntheticSecret, client: 'web' }) });
  assert.equal(auth.status, 200);
  const owner = await auth.json();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN
    ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }) });

  for (const width of [1280, 390].filter(width => selected(`signed-out-${width}`))) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, ignoreHTTPSErrors: true });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(15000);
      await signedOutJourney({ page, origin: webOrigin, width });
      console.log(`PASS: ${width}px signed-out entry explains account creation and iPhone training, preserves the block handoff through sign-in retries, and handles errors without overflow.`);
    } finally {
      await context.close();
    }
  }

  for (const width of journeyNames.filter(selected)) {
    const created = await testFetch(`${apiOrigin}/api/me/test-member`, { method: 'POST', headers: { Authorization: `Bearer ${owner.jwt}` } });
    assert.equal(created.status, 201);
    const member = await created.json();
    // The test-member endpoint is native-only. Reissue its same synthetic
    // principal as web using this disposable Worker's known test key.
    const jwt = await sign({ ...decode(member.jwt).payload, client: 'web' }, signingSecret, 'HS256');
    const context = await browser.newContext({ viewport: { width: typeof width === 'number' ? width : width.endsWith('-mobile') ? 390 : 1280, height: 960 }, ignoreHTTPSErrors: true });
    let page;
    const failures = [];
    try {
      await context.addCookies([{ name: '__Host-tf_session', value: jwt, url: webOrigin, secure: true, httpOnly: true, sameSite: 'Lax' }]);
      page = await context.newPage();
      page.on('requestfailed', request => failures.push(`${request.failure()?.errorText} ${new URL(request.url()).pathname}`));
      page.on('response', response => {
        if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
      });
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(15000);
      const apiCall = async (method, pathname, body, extraHeaders = {}) => {
        const response = await testFetch(`${apiOrigin}${pathname}`, { method,
          headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', 'X-TresFort-Capabilities': 'groups', ...extraHeaders },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        assert(response.ok, `${method} ${pathname}: ${response.status} ${await response.clone().text()}`);
        return response.json();
      };
      if (width === 'group-maintenance' || width === 'group-maintenance-mobile') {
        await groupMaintenanceJourney({ page, origin: webOrigin, apiCall, width: width.endsWith('-mobile') ? 390 : 1280 });
        console.log('PASS: group membership/order updates preserve slot rests and other groups; cancel never writes; conflicts retain exact drafts for review; missing/moved members stay visible and blocked; ACK retires drafts despite refresh failure.');
      } else if (width === 'strength-review' || width === 'strength-review-mobile') {
        await strengthReviewJourney({ page, origin: webOrigin, apiCall, width: width.endsWith('-mobile') ? 390 : 1280 });
        console.log('PASS: strength compares daily evidence across units and exact load conditions, finds historical aliases, opens exact sibling records and offers account/session/attempt-bound iPhone correction without browser writes.');
      } else if (width === 'workout-feedback' || width === 'workout-feedback-mobile') {
        await workoutFeedbackJourney({ page, origin: webOrigin, apiCall, width: width.endsWith('-mobile') ? 390 : 1280,
          switchAccount: async choice => context.addCookies([{ name: '__Host-tf_session', value: choice === 'other' ? owner.jwt : jwt,
            url: webOrigin, secure: true, httpOnly: true, sameSite: 'Lax' }]),
          otherState: async () => (await testFetch(`${apiOrigin}/api/state`, { headers: { Authorization: `Bearer ${owner.jwt}` } })).json(),
        });
        console.log('PASS: completed feedback adds, corrects and clears the exact session; preserves sibling records; reviews conflicts; retries one frozen request and retains acknowledged saves through refresh failure.');
      } else if (width === 'lifting-creation' || width === 'lifting-creation-mobile') {
        await liftingCreationJourney({ page, origin: webOrigin, width: width === 'lifting-creation-mobile' ? 390 : 1280, apiCall });
        console.log('PASS: lifting creation reviews six individual targets without early writes, retains ordered drafts, retries frozen receipts and recovers version conflicts.');
      } else if (width === 'lifting-prescriptions') {
        await liftingPrescriptionJourney({ page, origin: webOrigin, apiCall });
        console.log('PASS: lifting replacement reviews load and week targets; target/block drafts survive navigation/conflicts and acknowledged saves retire drafts despite refresh failure.');
      } else if (width === 'account-switch') {
        await accountSwitchJourney({ page, origin: webOrigin,
          switchAccount: async choice => context.addCookies([{ name: '__Host-tf_session', value: choice === 'other' ? owner.jwt : jwt,
            url: webOrigin, secure: true, httpOnly: true, sameSite: 'Lax' }]),
          originalState: () => apiCall('GET', '/api/state'),
          otherState: async () => (await testFetch(`${apiOrigin}/api/state`, { headers: { Authorization: `Bearer ${owner.jwt}` } })).json(),
        });
        console.log('PASS: a cross-tab account switch cannot save or expose the original account’s pending planless draft.');
      } else if (width === 'one-date-edit') {
        await oneDateEditJourney({ page, origin: webOrigin, apiCall });
        console.log('PASS: date-specific edits copy block targets, survive ambiguous copy/placement and failed refresh, and preserve the recurring week.');
      } else if (width === 'one-date-removed') {
        await oneDateRemovedJourney({ page, origin: webOrigin, apiCall });
        console.log('PASS: a date copy deleted after acknowledgement can be closed after live review without recreating it.');
      } else if (width === 'one-date-account') {
        await oneDateAccountJourney({ page, origin: webOrigin, apiCall,
          switchAccount: async choice => context.addCookies([{ name: '__Host-tf_session', value: choice === 'other' ? owner.jwt : jwt,
            url: webOrigin, secure: true, httpOnly: true, sameSite: 'Lax' }]),
          otherState: async () => (await testFetch(`${apiOrigin}/api/state`, { headers: { Authorization: `Bearer ${owner.jwt}` } })).json(),
        });
        console.log('PASS: account changes cannot copy, assign or edit a date-specific workout in the wrong account.');
      } else if (width === 'conflict-refresh') {
        await creationConflictJourney({ page, origin: webOrigin, apiCall });
        console.log('PASS: a refused creation and failed refresh keep the reviewed targets until explicit refresh and review.');
      } else {
        await mixedWeekJourney({ page, origin: webOrigin, width, apiCall });
        console.log(`PASS: ${width}px new web member creates and schedules a run plus separate timed core, recovers safely, refreshes and reaches iPhone handoff.`);
      }
    } catch (error) {
      console.error(`Failed synthetic journey ${width}: ${failures.join(', ')}`);
      console.error(await page?.locator('body').innerText().catch(() => 'Page unavailable'));
      throw error;
    } finally {
      await context.close();
      await testFetch(`${apiOrigin}/api/me/test-member`, { method: 'DELETE', headers: { Authorization: `Bearer ${jwt}` } })
        .catch(error => console.error(`Synthetic member cleanup failed: ${error.message}`));
    }
  }
  console.log(`Browser: ${browser.version()}`);
} finally {
  await browser?.close();
  for (const entry of children.reverse()) {
    if (entry.exited) continue;
    entry.proc.kill('SIGTERM');
    await Promise.race([new Promise(resolve => entry.proc.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (!entry.exited) { entry.proc.kill('SIGKILL'); await new Promise(resolve => entry.proc.once('exit', resolve)); }
  }
  await rm(scratch, { recursive: true, force: true });
}
