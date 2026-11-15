import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const protocol = { 'X-TresFort-Write-Protocol': 'attempt-v1' };
const feedbackOf = session => ({ notes: session.notes, perceived_fatigue: session.perceived_fatigue });
const sessionAt = (state, id) => state.sessions.find(session => session.id === id);
const ordered = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const recordURL = (origin, session) => `${origin}/#activity/${encodeURIComponent(`workout:${session.id}`)}`;

async function seed(page, apiCall) {
  const dates = await page.evaluate(() => [0, -1, -2].map(offset => {
    const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }));
  let state = await apiCall('PUT', '/api/plan/active', { name: 'Completed lifting feedback' });
  const workout = await apiCall('POST', '/api/workouts', { name: 'Recorded strength', exercise_ids: ['ex_bench'],
    expected_plan_id: state.plan.id, expected_version: state.plan.version });
  async function session(date, additional = false, complete = true) {
    const created = await apiCall('POST', '/api/sessions', { date, workout_id: workout.id, expected_attempt: 0,
      ...(additional ? { additional: true, id: crypto.randomUUID() } : {}) }, protocol);
    await apiCall('POST', `/api/sessions/${created.id}/sets`, { id: crypto.randomUUID(), exercise_id: 'ex_bench',
      set_index: 1, weight: 45, weight_unit: 'lb', reps: 5, expected_attempt: created.attempt }, protocol);
    if (complete) await apiCall('PATCH', `/api/sessions/${created.id}?expected_attempt=${created.attempt}`, { status: 'completed' }, protocol);
    return created;
  }
  const primary = await session(dates[0]);
  const additional = await session(dates[0], true);
  const previous = await session(dates[1]);
  const running = await session(dates[2], false, false);
  state = await apiCall('GET', '/api/state');
  return { primary, additional, previous, running, state };
}

function assertStructure(before, after, editedIDs) {
  assert.deepEqual(after.plan, before.plan, 'Feedback does not mutate the training plan.');
  assert.deepEqual(ordered(after.sets), ordered(before.sets), 'Feedback preserves every logged set.');
  assert.equal(after.sessions.length, before.sessions.length, 'Feedback never creates or duplicates a session.');
  for (const original of before.sessions) {
    const current = sessionAt(after, original.id);
    assert(current, 'Every original session remains present.');
    if (editedIDs.includes(original.id)) {
      const { notes: _a, perceived_fatigue: _b, updated_at: _c, ...oldRecord } = original;
      const { notes: _d, perceived_fatigue: _e, updated_at: _f, ...newRecord } = current;
      assert.deepEqual(newRecord, oldRecord, 'Only feedback and its update timestamp change.');
    } else assert.deepEqual(current, original, 'Other sessions and attempts remain untouched.');
  }
}

/** Real gateway + D1, with only response loss and competing edits injected. */
export async function workoutFeedbackJourney({ page, origin, apiCall, width, switchAccount, otherState }) {
  const seeded = await seed(page, apiCall);
  const { primary, additional, running } = seeded;
  const feedbackPath = `/api/sessions/${primary.id}/feedback`;
  const writes = [];
  page.on('request', request => {
    if (request.method() === 'PATCH' && /\/sessions\/[^/]+\/feedback$/.test(new URL(request.url()).pathname)) {
      writes.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
    }
  });
  const region = page.getByRole('region', { name: 'Workout feedback', exact: true });
  const note = page.getByLabel('Workout note (optional)', { exact: true });
  const fatigue = page.getByLabel('Fatigue (optional)', { exact: true });
  const open = () => region.getByRole('button', { name: /^(Add|Edit) workout feedback$/ }).click();
  const saved = async () => {
    await region.getByRole('status').filter({ hasText: /^Feedback saved\./ }).waitFor();
    await note.waitFor({ state: 'hidden' });
  };
  const save = async () => {
    await region.getByRole('button', { name: 'Save feedback', exact: true }).click();
    await saved();
  };

  // A completed record starts with no feedback; opening and cancelling writes nothing.
  await page.goto(recordURL(origin, primary));
  await open();
  assert.match(await region.innerText(), /not shared with your groups/);
  await note.fill('Unsaved reflection');
  await region.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(writes.length, 0);
  await open();
  assert.equal(await note.inputValue(), '');
  await note.fill('Press felt steady.'); await fatigue.selectOption('6'); await save();
  assert.deepEqual(feedbackOf(sessionAt(await apiCall('GET', '/api/state'), primary.id)),
    { notes: 'Press felt steady.', perceived_fatigue: 6 });
  await page.reload();
  await region.getByText('Press felt steady.', { exact: true }).waitFor();
  await open(); await note.fill('Last set felt steady.'); await fatigue.selectOption('5'); await save();
  assert.deepEqual(feedbackOf(sessionAt(await apiCall('GET', '/api/state'), primary.id)),
    { notes: 'Last set felt steady.', perceived_fatigue: 5 });
  await open(); await note.fill(''); await fatigue.selectOption(''); await save();
  const cleared = feedbackOf(sessionAt(await apiCall('GET', '/api/state'), primary.id));
  assert(cleared.notes === null || cleared.notes === ''); assert.equal(cleared.perceived_fatigue, null);

  // The second workout on this date is a separate record, with a separate note.
  await page.goto(recordURL(origin, additional));
  await open(); await note.fill('Evening session only.'); await fatigue.selectOption('4'); await save();
  let state = await apiCall('GET', '/api/state');
  assert.deepEqual(feedbackOf(sessionAt(state, primary.id)), cleared);
  assert.deepEqual(feedbackOf(sessionAt(state, additional.id)), { notes: 'Evening session only.', perceived_fatigue: 4 });

  // A competing edit keeps both versions for an explicit baseline choice.
  await page.goto(recordURL(origin, primary)); await open(); await note.fill('My reviewed reflection.');
  const current = sessionAt(await apiCall('GET', '/api/state'), primary.id);
  await apiCall('PATCH', feedbackPath, { expected_attempt: primary.attempt, notes: 'Saved on another device.',
    perceived_fatigue: 8, expected_feedback: feedbackOf(current) });
  await region.getByRole('button', { name: 'Save feedback', exact: true }).click();
  const conflict = page.getByRole('group', { name: 'Workout feedback conflict', exact: true });
  await conflict.waitFor();
  assert.match(await conflict.innerText(), /My reviewed reflection/);
  assert.match(await conflict.innerText(), /Saved on another device/);
  await conflict.getByRole('button', { name: 'Use my feedback', exact: true }).click();
  assert.equal(await note.inputValue(), 'My reviewed reflection.'); await save();
  assert.deepEqual(feedbackOf(sessionAt(await apiCall('GET', '/api/state'), primary.id)),
    { notes: 'My reviewed reflection.', perceived_fatigue: null });

  // Lose a successful response. Retry must replay the frozen proposal and baseline.
  await open(); await note.fill('Approved retry reflection.'); await fatigue.selectOption('7');
  const uncertain = [];
  await page.route(`**${feedbackPath}`, async route => {
    uncertain.push(route.request().postDataJSON());
    const response = await route.fetch(); assert.equal(response.status(), 200);
    if (uncertain.length === 1) await route.abort('failed'); else await route.fulfill({ response });
  });
  await region.getByRole('button', { name: 'Save feedback', exact: true }).click();
  const retry = region.getByRole('button', { name: 'Retry same save', exact: true });
  await retry.waitFor(); assert(await note.isDisabled()); assert(await fatigue.isDisabled());
  await retry.click(); await saved();
  assert.equal(uncertain.length, 2); assert.deepEqual(uncertain[0], uncertain[1]);
  await page.unroute(`**${feedbackPath}`);

  // An acknowledged write remains visible even when its subsequent read fails.
  await open(); await note.fill('Saved despite refresh failure.');
  const beforeAcknowledged = writes.length;
  await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_refresh_failure"}' }));
  await save();
  await region.getByText('Feedback saved. The latest activity could not be refreshed; your saved feedback is shown.', { exact: true }).waitFor();
  await region.getByText('Saved despite refresh failure.', { exact: true }).waitFor();
  assert.equal(writes.length, beforeAcknowledged + 1);
  assert.equal(await region.getByRole('button', { name: 'Retry same save', exact: true }).count(), 0);
  await page.unroute('**/api/state');

  // An older read started before another save must not replace its later ACK.
  let releaseOldRead, readCaptured, finishHeldRead, heldError;
  const oldReadGate = new Promise(resolve => { releaseOldRead = resolve; });
  const captured = new Promise(resolve => { readCaptured = resolve; });
  const heldReadFinished = new Promise(resolve => { finishHeldRead = resolve; });
  let reads = 0;
  await page.route('**/api/state', async route => {
    if (++reads !== 1) { await route.continue(); return; }
    try {
      const response = await route.fetch(); assert.equal(response.status(), 200);
      readCaptured(); await oldReadGate;
      await route.fulfill({ response, headers: { ...response.headers(), 'x-tresfort-test-held-read': '1' } });
    } catch (error) { heldError = error; readCaptured(); }
    finally { finishHeldRead(); }
  });
  try {
    await region.getByRole('button', { name: 'Refresh Activity', exact: true }).click();
    let captureTimeout;
    try {
      await Promise.race([captured, new Promise((_, reject) => {
        captureTimeout = setTimeout(() => reject(new Error('Refresh Activity did not capture its state read within 30 seconds.')), 30_000);
      })]);
    } finally { clearTimeout(captureTimeout); }
    if (heldError) throw heldError;
    await page.getByRole('link', { name: 'Workouts', exact: true }).click();
    await page.getByRole('heading', { name: 'Workouts', exact: true }).waitFor();
    await page.evaluate(key => { location.hash = `#activity/${encodeURIComponent(key)}`; }, `workout:${primary.id}`);
    await open(); assert.equal(await note.inputValue(), 'Saved despite refresh failure.');
    await note.fill('Latest saved reflection.'); await save();
    // The enabled button proves the newer post-ACK refresh also finished.
    await region.getByRole('button', { name: 'Edit workout feedback', exact: true }).click({ trial: true });
    const oldResponse = page.waitForResponse(response => response.headers()['x-tresfort-test-held-read'] === '1');
    // Retain the original assertion error if cleanup aborts the held request.
    oldResponse.catch(() => {});
    releaseOldRead(); await heldReadFinished;
    if (heldError) throw heldError;
    await (await oldResponse).finished();
    // Allow the completed fetch's React state publication through two frames.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await region.getByText('Latest saved reflection.', { exact: true }).waitFor();
    assert.equal(await region.getByText('Saved despite refresh failure.', { exact: true }).count(), 0);
    assert.equal(writes.length, beforeAcknowledged + 2, 'Both approved saves occur once; refreshes never repeat them.');
  } finally {
    releaseOldRead();
    if (reads > 0) await heldReadFinished;
    await page.unroute('**/api/state');
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px feedback must not overflow.`);
  if (process.env.WEB_ONBOARDING_ARTIFACTS) {
    await mkdir(process.env.WEB_ONBOARDING_ARTIFACTS, { recursive: true });
    await region.screenshot({ path: path.join(process.env.WEB_ONBOARDING_ARTIFACTS, `completed-feedback-${width}.png`) });
  }

  // The new action is absent for an unfinished record.
  await page.goto(recordURL(origin, running));
  await page.locator('.activity-detail').getByText('In progress', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^(Add|Edit) workout feedback$/ }).count(), 0);

  // An account cookie change cannot write or reveal this member's draft to the other account.
  await page.goto(recordURL(origin, primary)); await open(); await note.fill('Original account draft.');
  const beforeSwitch = await apiCall('GET', '/api/state');
  const { server_time: _firstTime, ...otherBefore } = await otherState();
  await switchAccount('other');
  await region.getByRole('button', { name: 'Save feedback', exact: true }).click();
  await page.getByRole('heading', { name: 'Your account changed in another tab', exact: true }).waitFor();
  const { server_time: _nextTime, ...otherAfter } = await otherState();
  assert.deepEqual(otherAfter, otherBefore);
  state = await apiCall('GET', '/api/state');
  assert.deepEqual(ordered(state.sessions), ordered(beforeSwitch.sessions));
  await page.getByRole('button', { name: 'Load current account', exact: true }).click();
  await page.getByRole('heading', { name: 'Your account changed in another tab', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  assert.equal(await page.getByText('Original account draft.', { exact: true }).count(), 0);
  await switchAccount('original'); await page.goto(recordURL(origin, primary)); await page.reload();
  await open(); assert.equal(await note.inputValue(), 'Latest saved reflection.');
  await region.getByRole('button', { name: 'Cancel', exact: true }).click();
  assertStructure(seeded.state, await apiCall('GET', '/api/state'), [primary.id, additional.id]);
}
