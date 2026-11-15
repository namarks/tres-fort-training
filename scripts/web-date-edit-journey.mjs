import assert from 'node:assert/strict';

async function seed({ page, apiCall }) {
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const first = await apiCall('PUT', '/api/plan/active', { name: 'Date edit journey' });
  const run = await apiCall('POST', '/api/workouts', { name: 'Morning run', exercise_ids: ['ex_outdoor_run'],
    expected_plan_id: first.plan.id, expected_version: first.plan.version });
  let state = await apiCall('GET', '/api/state');
  const slot = state.plan.workouts.find(workout => workout.id === run.id).exercises[0];
  await apiCall('PATCH', `/api/workouts/${run.id}/exercises/${slot.id}`, {
    run_steps: [{ kind: 'work', duration_s: 600 }], expected_version: state.plan.version });
  state = await apiCall('GET', '/api/state');
  const core = await apiCall('POST', '/api/workouts', { name: 'Evening core', exercise_ids: ['ex_plank'],
    expected_plan_id: state.plan.id, expected_version: state.plan.version });
  state = await apiCall('GET', '/api/state');
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const week = Object.fromEntries(days.map(day => [day, run.id]));
  const extras = Object.fromEntries(days.map(day => [day, [core.id]]));
  const times = Object.fromEntries(days.map(day => [day, { [run.id]: '07:00', [core.id]: '18:00' }]));
  await apiCall('PUT', '/api/plan/schedule', { week, extras, times, expected_plan_id: state.plan.id, expected_version: state.plan.version });
  state = await apiCall('GET', '/api/state');
  const monday = new Date(`${today}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  await apiCall('PUT', '/api/plan/program', { program: { start: monday.toISOString().slice(0, 10),
    weeks: [{ week, extras, targets: { [slot.id]: { run_steps: [{ kind: 'work', duration_s: 900 }] } } }], repeat: false },
    expected_version: state.plan.version });
  return { today, run, core, before: await apiCall('GET', '/api/state') };
}

const recovery = page => page.getByRole('region', { name: 'Date edit recovery', exact: true });
async function assertFocusedHeading(panel) {
  const heading = panel.getByRole('heading', { level: 3 });
  await heading.waitFor();
  assert(await heading.evaluate(element => element === document.activeElement), 'Entering an edit scope or recovery moves keyboard focus to its heading.');
  assert(await heading.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  }), 'The newly focused heading must be in the viewport without clicking a control inside the panel.');
}
async function scope(page, name) {
  const edit = page.getByRole('button', { name: `Edit ${name}`, exact: true });
  // Put the invoking button near the viewport edge, as after scrolling a long
  // detail. No click or locator-scroll is allowed to bring the NEW panel in.
  await edit.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await edit.focus(); await page.keyboard.press('Enter');
  const panel = page.getByRole('region', { name: `Edit scope for ${name}`, exact: true });
  await assertFocusedHeading(panel);
  await page.keyboard.press('Tab');
  assert(await panel.locator('button:enabled').first().evaluate(element => element === document.activeElement),
    'Tab from the scope heading reaches its first available action.');
  return panel;
}

// addWorkoutAtVersion densifies ordering and updates every workout row's
// updated_at (src/db.ts), even when its order is unchanged. Compare every
// persisted content field and each complete exercise row, excluding only that
// document-bookkeeping timestamp on the containing workout.
const workoutContent = ({ updated_at, ...content }) => content;
// GET /api/state includes the response's current clock reading. It is not a
// persisted mutation; every plan, session, set and activity field stays compared.
const persistedState = ({ server_time, ...state }) => state;

export async function oneDateEditJourney({ page, origin, apiCall }) {
  const { today, run, core, before } = await seed({ page, apiCall });
  const copies = [], placements = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'POST' && pathname === '/api/workouts') copies.push(request.postDataJSON());
    if (request.method() === 'PUT' && pathname === `/api/calendar/${today}`) placements.push(request.postDataJSON());
  });
  let lostCopy = false, lostPlacement = false, failedRead = false;
  await page.route('**/api/workouts', async route => {
    if (route.request().method() === 'POST' && !lostCopy) {
      lostCopy = true; const response = await route.fetch(); assert.equal(response.status(), 201); await route.abort('failed');
    } else await route.continue();
  });
  await page.route(`**/api/calendar/${today}`, async route => {
    if (route.request().method() === 'PUT' && !lostPlacement) {
      lostPlacement = true; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed');
    } else await route.continue();
  });
  await page.goto(`${origin}/#calendar`);
  await (await scope(page, 'Morning run')).getByRole('button', { name: 'This date only', exact: true }).click();
  await recovery(page).getByRole('button', { name: 'Retry same date edit', exact: true }).waitFor();
  await assertFocusedHeading(recovery(page));
  assert.equal((await apiCall('GET', '/api/state')).plan.workouts.length, 3, 'Lost copy ACK creates exactly one date copy.');
  await page.reload();
  await recovery(page).getByRole('button', { name: 'Retry same date edit', exact: true }).click();
  await recovery(page).getByText('The copy is saved, but its placement could not be confirmed. Retry places the same copy on the same date.', { exact: true }).waitFor();
  await page.reload();
  await recovery(page).getByRole('button', { name: 'Retry same date edit', exact: true }).waitFor();
  // Both writes are acknowledged next time; only their subsequent read fails.
  await page.route('**/api/state', async route => {
    if (!failedRead) { failedRead = true; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_refresh_failure"}' }); }
    else await route.continue();
  });
  await recovery(page).getByRole('button', { name: 'Retry same date edit', exact: true }).click();
  await recovery(page).getByText('Saved for this date. Refresh the plan to open its editor; no need to save again.', { exact: true }).waitFor();
  assert.equal(await recovery(page).getByRole('button', { name: 'Retry same date edit', exact: true }).count(), 0);
  await recovery(page).getByRole('button', { name: 'Refresh plan', exact: true }).click();
  await recovery(page).getByRole('button', { name: 'Edit this date’s workout', exact: true }).click();
  await page.locator('.workout-editor').getByText(`Edits apply only to ${today}. Your saved workout and other dates stay unchanged.`, { exact: true }).waitFor();
  assert.equal(copies.length, 2); assert.deepEqual(copies[0], copies[1], 'Copy retries preserve every field and UUID across reload.');
  assert.equal(placements.length, 2); assert.deepEqual(placements[0], placements[1], 'Placement retries preserve the attempt token and copy identity.');
  const copyId = copies[0].id;
  const copied = (await apiCall('GET', '/api/state')).plan.workouts.find(workout => workout.id === copyId);
  assert.deepEqual(JSON.parse(copied.exercises[0].run_steps), [{ kind: 'work', duration_s: 900 }], 'Copy includes this block week’s targets.');
  await page.getByRole('button', { name: 'Plan Outdoor Run', exact: true }).click();
  await page.getByLabel('Step 1: time', { exact: true }).fill('5:00');
  await page.getByRole('button', { name: 'Save steps', exact: true }).click();
  await page.getByRole('form', { name: 'Plan Outdoor Run', exact: true }).waitFor({ state: 'detached' });
  const after = await apiCall('GET', '/api/state');
  assert.deepEqual(JSON.parse(after.plan.workouts.find(workout => workout.id === copyId).exercises[0].run_steps), [{ kind: 'work', duration_s: 300 }]);
  assert.deepEqual(workoutContent(after.plan.workouts.find(workout => workout.id === run.id)), workoutContent(before.plan.workouts.find(workout => workout.id === run.id)));
  assert.deepEqual(workoutContent(after.plan.workouts.find(workout => workout.id === core.id)), workoutContent(before.plan.workouts.find(workout => workout.id === core.id)));
  assert.deepEqual(after.plan.schedule, before.plan.schedule);
  assert.deepEqual(JSON.parse(after.plan.meta).program, JSON.parse(before.plan.meta).program);
  assert.equal(after.sessions.length, 1); assert.equal(after.sessions[0].workout_id, copyId); assert.equal(after.sessions[0].status, 'planned');
  assert.equal(after.sessions[0].date, today);
  await page.goto(`${origin}/#calendar`);
  const extraScope = await scope(page, 'Evening core');
  assert.match(await extraScope.innerText(), /A separate workout can currently be edited only as a saved workout/);
  assert.equal(await extraScope.getByRole('button', { name: 'This date only', exact: true }).count(), 0);
  await extraScope.getByRole('button', { name: 'Cancel', exact: true }).click();
  const existingCopy = await scope(page, 'Morning run');
  assert.equal(await existingCopy.getByRole('button', { name: 'This date only', exact: true }).count(), 0, 'Editing an existing date copy cannot create another copy.');
  await existingCopy.getByRole('button', { name: 'Edit this date’s workout', exact: true }).click();
  assert.equal(copies.length, 2);
}

export async function oneDateAccountJourney({ page, origin, apiCall, switchAccount, otherState }) {
  const { today, run, before } = await seed({ page, apiCall });
  const otherBefore = await otherState();
  await page.goto(`${origin}/#calendar`);
  const edit = await scope(page, 'Morning run');
  await switchAccount('other');
  await edit.getByRole('button', { name: 'This date only', exact: true }).click();
  await page.getByRole('heading', { name: 'Your account changed in another tab', exact: true }).waitFor();
  assert.deepEqual(persistedState(await apiCall('GET', '/api/state')), persistedState(before), 'A stale account cannot copy or assign workouts.');
  assert.deepEqual(persistedState(await otherState()), persistedState(otherBefore));
  await page.getByRole('button', { name: 'Load current account', exact: true }).click();
  await page.getByRole('heading', { name: 'Plan your week', exact: true }).waitFor();
  assert.equal(await recovery(page).count(), 0);
  await switchAccount('original'); await page.reload();
  await recovery(page).getByRole('button', { name: 'Retry same date edit', exact: true }).click();
  await recovery(page).getByRole('button', { name: 'Edit this date’s workout', exact: true }).click();
  await page.getByRole('button', { name: 'Plan Outdoor Run', exact: true }).click();
  await page.getByLabel('Step 1: time', { exact: true }).fill('5:00');
  await switchAccount('other');
  await page.getByRole('button', { name: 'Save steps', exact: true }).click();
  await page.getByRole('heading', { name: 'Your account changed in another tab', exact: true }).waitFor();
  const current = await apiCall('GET', '/api/state');
  const copy = current.plan.workouts.find(workout => workout.one_time_date === today);
  assert.deepEqual(JSON.parse(copy.exercises[0].run_steps), [{ kind: 'work', duration_s: 900 }], 'The follow-on editor is account bound too.');
  assert.deepEqual(workoutContent(current.plan.workouts.find(workout => workout.id === run.id)), workoutContent(before.plan.workouts.find(workout => workout.id === run.id)));
  assert.deepEqual(persistedState(await otherState()), persistedState(otherBefore));
}

export async function oneDateRemovedJourney({ page, origin, apiCall }) {
  const { today } = await seed({ page, apiCall });
  await page.goto(`${origin}/#calendar`);
  const edit = await scope(page, 'Morning run');
  let failedRead = false;
  await page.route('**/api/state', async route => {
    if (!failedRead) { failedRead = true; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_refresh_failure"}' }); }
    else await route.continue();
  });
  await edit.getByRole('button', { name: 'This date only', exact: true }).click();
  await recovery(page).getByText('Saved for this date. Refresh the plan to open its editor; no need to save again.', { exact: true }).waitFor();
  const current = await apiCall('GET', '/api/state');
  const copy = current.plan.workouts.find(workout => workout.one_time_date === today);
  assert(copy, 'The acknowledged copy exists before the other client removes it.');
  await apiCall('DELETE', `/api/workouts/${copy.id}?expected_version=${current.plan.version}`);
  await recovery(page).getByRole('button', { name: 'Refresh plan', exact: true }).click();
  await recovery(page).getByText('The saved copy is no longer in the current plan. Close this request and review the calendar again.', { exact: true }).waitFor();
  await recovery(page).getByRole('button', { name: 'Close and review the date again', exact: true }).click();
  await recovery(page).waitFor({ state: 'detached' });
  await page.reload();
  await page.getByRole('region', { name: 'Weekly routine', exact: true }).waitFor();
  assert.equal(await recovery(page).count(), 0, 'A terminal missing copy must not trap the calendar after reload.');
  assert.equal((await apiCall('GET', '/api/state')).plan.workouts.filter(workout => workout.one_time_date).length, 0,
    'Closing a confirmed deleted copy never retries its creation.');
}
