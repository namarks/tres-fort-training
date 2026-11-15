import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const protocol = { 'X-TresFort-Write-Protocol': 'attempt-v1' };
const recordURL = (origin, id) => `${origin}/#activity/${encodeURIComponent(`workout:${id}`)}`;

async function seed(page, apiCall) {
  const dates = await page.evaluate(() => [0, -7, -1, -14, -21, -28, -35, -42, -49, -56, -63].map(offset => {
    const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }));
  const { plan } = await apiCall('PUT', '/api/plan/active', { name: 'Strength review fixture' });
  const workout = await apiCall('POST', '/api/workouts', { name: 'Press day', exercise_ids: ['ex_bench'],
    expected_plan_id: plan.id, expected_version: plan.version });
  async function makeSession(date, additional = false) {
    return apiCall('POST', '/api/sessions', { date, workout_id: workout.id, expected_attempt: 0,
      ...(additional ? { additional: true, id: crypto.randomUUID() } : {}) }, protocol);
  }
  async function log(session, fields = {}) {
    const id = crypto.randomUUID();
    await apiCall('POST', `/api/sessions/${session.id}/sets`, { id, exercise_id: 'ex_bench', set_index: 1,
      weight: 100, weight_unit: 'lb', reps: 6, expected_attempt: session.attempt, ...fields }, protocol);
    return id;
  }
  const finish = session => apiCall('PATCH', `/api/sessions/${session.id}?expected_attempt=${session.attempt}`, { status: 'completed' }, protocol);
  const previous = await makeSession(dates[1]);
  await log(previous, { weight: 50, weight_unit: 'kg', reps: 8 });
  await log(previous, { exercise_id: 'ex_incline_db_curl', weight: 15, reps: 8 });
  await finish(previous);
  const primary = await makeSession(dates[0]);
  const primarySet = await log(primary);
  await log(primary, { weight: 1000, reps: 100, is_warmup: true, set_index: 2 });
  await log(primary, { exercise_id: 'ex_pullup', weight: -10, reps: 8 });
  await log(primary, { exercise_id: 'ex_plank', weight: 0, reps: 45, duration_s: 45, is_timed: true });
  await finish(primary);
  const additional = await makeSession(dates[0], true);
  const sourceSet = await log(additional, { reps: 10, set_index: 3 });
  await finish(additional);
  const active = await makeSession(dates[2]);
  await log(active, { weight: 2000, reps: 100 });
  // A narrow record is below a long history list: a DOM-visible target alone
  // does not prove a source link actually brought its detail into view.
  for (const date of dates.slice(3)) {
    const older = await makeSession(date);
    await log(older, { exercise_id: 'ex_incline_db_curl', weight: 15, reps: 8 });
    await finish(older);
  }
  const me = await apiCall('GET', '/api/me');
  return { primary, primarySet, additional, sourceSet, active, accountId: me.id, before: await apiCall('GET', '/api/state') };
}

/** Real gateway/D1. Browsing and handoff links never mutate the logged sets. */
export async function strengthReviewJourney({ page, origin, apiCall, width }) {
  const fixture = await seed(page, apiCall);
  const writes = [];
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/')) writes.push(request.url());
  });
  await page.goto(`${origin}/#analysis`);
  await page.getByRole('link', { name: 'Explore strength progress', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Fitness, fatigue and form', exact: true }).count(), 0,
    'Lifting-only overview leads to Strength without an empty endurance card.');
  let catalogAttempts = 0;
  await page.route('**/api/exercises', async route => {
    if (++catalogAttempts === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_catalog_failure"}' });
    else await route.continue();
  });
  try {
    await page.getByRole('link', { name: 'Explore strength progress', exact: true }).click();
    await page.getByRole('heading', { name: 'Exercises could not load', exact: true }).waitFor();
    assert.equal(await page.locator('.strength-progress').count(), 0, 'An unavailable catalog never invents metric metadata.');
    await page.getByRole('button', { name: 'Retry exercises', exact: true }).click();
    await page.getByRole('region', { name: 'Bench Press progress', exact: true }).waitFor();
    assert.equal(catalogAttempts, 2, 'Retry makes one new catalog request.');
  } finally { await page.unroute('**/api/exercises'); }
  await page.getByRole('heading', { name: 'Strength', exact: true }).waitFor();
  const progress = page.getByRole('region', { name: 'Bench Press progress', exact: true });
  await progress.waitFor();
  await page.getByRole('heading', { name: 'Current plan', exact: true }).waitFor();
  const source = progress.locator('.strength-source');
  await source.waitFor();
  assert.equal(await source.getAttribute('data-source-session'), fixture.additional.id);
  assert.equal(await source.getAttribute('data-source-set'), fixture.sourceSet);
  assert.match(await source.innerText(), /100 lb × 10 reps/);
  assert.match(await source.innerText(), /Press day · Workout 2 · Set 3/);
  assert.match(await progress.innerText(), /Epley formula/);
  await progress.getByText('Show all source sets', { exact: true }).click();
  assert.equal(await progress.locator('tbody tr').count(), 2, 'Same-date sessions contribute one daily best.');
  assert.equal(await source.getByRole('link', { name: 'Open this workout record', exact: true }).getAttribute('href'),
    `#activity/${encodeURIComponent(`workout:${fixture.additional.id}`)}`);
  await progress.getByRole('button', { name: 'Previous date', exact: true }).click();
  assert.match(await source.innerText(), /50 kg × 8 reps/);
  await progress.getByRole('button', { name: 'Next date', exact: true }).click();
  await progress.getByLabel('Compare strength metric', { exact: true }).selectOption({ label: '100 lb · Best reps' });
  await source.getByText('100 lb × 10 reps', { exact: true }).waitFor();
  assert.match(await progress.innerText(), /One recorded date/);

  if (process.env.WEB_ONBOARDING_ARTIFACTS) {
    await mkdir(process.env.WEB_ONBOARDING_ARTIFACTS, { recursive: true });
    await page.locator('.analysis-main').screenshot({ path: path.join(process.env.WEB_ONBOARDING_ARTIFACTS, `strength-review-${width}.png`) });
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px Strength must not overflow.`);
  await source.getByRole('link', { name: 'Open this workout record', exact: true }).click();
  const record = page.locator('.activity-detail');
  await record.locator(`[data-record-set="${fixture.sourceSet}"]`).waitFor();
  const revealRecord = async () => {
    if (width > 1000) return;
    await page.waitForFunction(() => {
      const heading = document.querySelector('.activity-detail #record-title');
      if (!heading) return false;
      const bounds = heading.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= innerHeight;
    });
  };
  await revealRecord();
  assert.equal(await record.locator(`[data-record-set="${fixture.primarySet}"]`).count(), 0, 'The primary workout is not substituted for its sibling.');
  const correction = new URL(await record.getByRole('link', { name: 'Correct sets in iPhone app', exact: true }).getAttribute('href'));
  assert.deepEqual(Object.fromEntries(correction.searchParams), { account: fixture.accountId, session: fixture.additional.id, attempt: String(fixture.additional.attempt) });
  const setCorrection = new URL(await record.getByRole('link', { name: 'Correct set 3 in iPhone app', exact: true }).getAttribute('href'));
  assert.equal(setCorrection.searchParams.get('set'), fixture.sourceSet);
  assert.equal(setCorrection.searchParams.get('session'), fixture.additional.id);
  await record.getByRole('link', { name: 'Get the iPhone app', exact: true }).waitFor();
  assert.match(await record.innerText(), /On a computer, open this page on your iPhone/);

  await page.goto(`${origin}/#analysis/strength`);
  const search = page.getByLabel('Find an exercise', { exact: true });
  await search.fill('incline db curl');
  await page.getByRole('region', { name: 'Incline Dumbbell Curl progress', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Past exercises', exact: true }).waitFor();
  await search.fill('chin up');
  const pullup = page.getByRole('region', { name: 'Pull-Up progress', exact: true });
  await pullup.waitFor();
  assert.equal(await pullup.getByRole('option', { name: /Estimated 1RM/ }).count(), 0);
  assert.match(await pullup.innerText(), /10 lb assistance/);
  await search.fill('rkc plank');
  const plank = page.getByRole('region', { name: 'Plank progress', exact: true });
  await plank.waitFor(); assert.match(await plank.innerText(), /Bodyweight × 45s/);
  assert.equal(await plank.getByRole('option', { name: /Estimated 1RM/ }).count(), 0);
  await search.fill('does not exist');
  await page.getByText('No exercises match that name or alias.', { exact: true }).waitFor();
  assert.equal(await page.locator('.strength-progress').count(), 0);

  await page.goto(recordURL(origin, 'missing-session'));
  await record.getByRole('heading', { name: 'Record unavailable', exact: true }).waitFor();
  await revealRecord();
  assert.equal(await record.locator('[data-record-set]').count(), 0);
  assert.equal(await record.getByRole('link', { name: 'Correct sets in iPhone app', exact: true }).count(), 0);
  await page.goto(recordURL(origin, fixture.active.id));
  await record.getByText('In progress', { exact: true }).waitFor();
  assert.equal(await record.getByRole('link', { name: 'Correct sets in iPhone app', exact: true }).count(), 0);
  assert.equal(writes.length, 0, 'Strength and correction handoff never send browser mutations.');
  const { server_time: _beforeTime, ...before } = fixture.before;
  const { server_time: _afterTime, ...after } = await apiCall('GET', '/api/state');
  assert.deepEqual(after, before, 'Review leaves every saved set, session and plan unchanged.');
}
