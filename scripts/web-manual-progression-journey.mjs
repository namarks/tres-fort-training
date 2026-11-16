import assert from 'node:assert/strict';

export async function manualProgressionJourney({ page, origin, apiCall, width = 1280 }) {
  const first = await apiCall('PUT', '/api/plan/active', { name: 'Manual progression' });
  const created = await apiCall('POST', '/api/workouts', { name: 'Strength A', exercise_ids: ['ex_bench'],
    expected_plan_id: first.plan.id, expected_version: first.plan.version });
  let state = await apiCall('GET', '/api/state');
  const slot = state.plan.workouts[0].exercises[0];
  await apiCall('PATCH', `/api/workouts/${created.id}/exercises/${slot.id}`, {
    target_sets: 4, target_weight: 100, expected_version: state.plan.version });
  state = await apiCall('GET', '/api/state');
  const baseWorkout = structuredClone(state.plan.workouts[0]);
  // Start on this week's Monday so the preview entry is in the initial grid.
  const now = new Date(); const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const start = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  await apiCall('PUT', '/api/plan/program', { program: { name: 'Strength cycle', start, repeat: true,
    weeks: [{ week: { mon: created.id, wed: created.id } }, { week: { mon: created.id }, targets: { [slot.id]: { target_weight: 120 } } }] }, expected_version: state.plan.version });
  state = await apiCall('GET', '/api/state');
  const beforeProgram = JSON.parse(state.plan.meta).program;
  await page.goto(`${origin}/#plan`);
  const firstWeek = page.getByRole('rowheader').filter({ has: page.getByText('Week 1', { exact: true }) }).first();
  await firstWeek.locator('summary').click();
  await firstWeek.getByRole('button', { name: 'Make week lighter', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Make week lighter', exact: true });
  await preview.waitFor();
  assert.match(await preview.innerText(), /each time the block repeats/);
  await preview.getByRole('spinbutton', { name: 'Fewer sets or rounds (%)', exact: true }).fill('50');
  await preview.getByRole('spinbutton', { name: 'Lighter load (%)', exact: true }).fill('10');
  assert.match(await preview.innerText(), /90 lb/);
  assert.equal((await apiCall('GET', '/api/state')).plan.version, state.plan.version, 'Preview never writes.');
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await firstWeek.getByRole('button', { name: 'Make week lighter', exact: true }).click();
  await preview.getByRole('spinbutton', { name: 'Fewer sets or rounds (%)', exact: true }).fill('50');
  await preview.getByRole('button', { name: 'Apply to block draft', exact: true }).click();
  assert.equal((await apiCall('GET', '/api/state')).plan.version, state.plan.version, 'Applying preview only changes retained draft.');
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await page.getByText('Unsaved changes to your block.', { exact: true }).waitFor({ state: 'hidden' });
  const after = await apiCall('GET', '/api/state');
  const afterProgram = JSON.parse(after.plan.meta).program;
  assert.equal(afterProgram.weeks[0].targets[slot.id].target_sets, 2);
  assert.equal(afterProgram.weeks[0].targets[slot.id].target_weight, 90);
  assert.deepEqual(afterProgram.weeks[1], beforeProgram.weeks[1], 'Later weeks keep their own targets.');
  assert.deepEqual(after.plan.workouts[0], baseWorkout, 'Reusable workout is unchanged.');
  // A session known to the server must not have its active targets changed.
  const session = await apiCall('POST', '/api/sessions', { date: start, workout_id: created.id, expected_attempt: 0 },
    { 'X-TresFort-Write-Protocol': 'attempt-v1' });
  assert.equal(session.status, 'planned', 'Creating the session alone does not start it.');
  await apiCall('PATCH', `/api/sessions/${session.id}?expected_attempt=${session.attempt}`, { status: 'in_progress' },
    { 'X-TresFort-Write-Protocol': 'attempt-v1' });
  const active = (await apiCall('GET', '/api/state')).sessions.find(s => s.id === session.id);
  assert.equal(active?.status, 'in_progress', 'The refusal check requires a genuinely active session.');
  await firstWeek.locator('summary').click();
  await firstWeek.getByRole('button', { name: 'Make week lighter', exact: true }).click();
  await preview.getByRole('button', { name: 'Apply to block draft', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await page.getByText('Finish or discard the in-progress workout before changing its week targets. Other weeks remain editable. Your unfinished changes are kept.', { exact: true }).waitFor();
  assert(await page.getByText('Unsaved changes to your block.', { exact: true }).isVisible(), 'A refused write retains the reviewed draft.');
  const refused = await apiCall('GET', '/api/state');
  assert.equal(refused.plan.version, after.plan.version, 'Refused target change creates no new plan version.');
  assert.deepEqual(JSON.parse(refused.plan.meta).program, afterProgram, 'Active targets remain unchanged.');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, `Plan controls fit ${width}px viewport.`);
}
