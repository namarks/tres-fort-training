import assert from 'node:assert/strict';

export async function liftingPrescriptionJourney({ page, origin, apiCall }) {
  const first = await apiCall('PUT', '/api/plan/active', { name: 'Reviewed lifting' });
  const workout = await apiCall('POST', '/api/workouts', { name: 'Upper body', exercise_ids: ['ex_bench', 'ex_back_squat'],
    expected_plan_id: first.plan.id, expected_version: first.plan.version });
  let state = await apiCall('GET', '/api/state');
  const slotID = state.plan.workouts[0].exercises[0].id;
  const slotURL = `/api/workouts/${workout.id}/exercises/${slotID}`;
  await apiCall('PATCH', slotURL, { target_weight: 135, target_sets: 3, target_reps: 5,
    target_rpe: 7, rest_seconds: 120, expected_version: state.plan.version });
  state = await apiCall('GET', '/api/state');
  await apiCall('PUT', '/api/plan/program', { program: { name: 'Strength block', start: '2026-11-16', repeat: false,
    weeks: [{ week: { mon: workout.id } }, { week: { mon: workout.id }, targets: { [slotID]: { target_weight: 165 } } }] },
    expected_version: state.plan.version });
  await page.goto(`${origin}/#workouts/${workout.id}`);
  const draft = page.getByRole('region', { name: 'Retained target draft' });
  await page.getByRole('button', { name: 'Edit Bench Press', exact: true }).click();
  await draft.locator('input:focus').waitFor();
  await page.getByRole('button', { name: 'Edit Back Squat', exact: true }).click();
  await draft.getByRole('heading', { name: 'Edit Back Squat', exact: true }).waitFor();
  await draft.locator('input:focus').waitFor();
  await page.getByRole('button', { name: 'Replace Bench Press', exact: true }).click();
  await draft.getByRole('searchbox', { name: 'Search exercises', exact: true }).fill('dumbbell bench');
  await draft.getByRole('button', { name: 'Dumbbell Bench Press chest · dumbbell', exact: true }).click();
  const weight = draft.getByRole('textbox', { name: /Weight/, exact: false });
  assert.equal(await weight.inputValue(), '', 'Changing total load to each hand clears the proposed weight.');
  assert.equal((await apiCall('GET', '/api/state')).plan.workouts[0].exercises[0].exercise_id, 'ex_bench', 'Picking alone never writes.');
  await weight.fill('45');
  await draft.getByRole('button', { name: 'Save replacement', exact: true }).click();
  await draft.waitFor({ state: 'hidden' });
  state = await apiCall('GET', '/api/state');
  assert.equal(state.plan.workouts[0].exercises[0].exercise_id, 'ex_db_press');
  assert.equal(state.plan.workouts[0].exercises[0].target_weight, 45);
  const meta = typeof state.plan.meta === 'string' ? JSON.parse(state.plan.meta) : state.plan.meta;
  assert.equal(meta.program.weeks[1].targets?.[slotID], undefined, 'Old week-specific weight cannot return after replacement.');

  await page.getByRole('button', { name: 'Edit Dumbbell Bench Press', exact: true }).click();
  await weight.fill('50');
  const openBlock = async () => {
    await page.getByRole('link', { name: 'Plan', exact: true }).click();
    await page.getByRole('navigation', { name: 'Plan sections', exact: true }).getByRole('link', { name: 'Block', exact: true }).click();
    await page.getByRole('heading', { name: 'Week by week', exact: true }).waitFor();
  };
  await openBlock();
  await page.getByRole('button', { name: 'Name and start', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Reviewed strength block');
  const weeklyLoad = page.getByRole('textbox', { name: 'Week 1 Load', exact: true });
  await weeklyLoad.fill('145.');
  const weeklySets = page.getByRole('textbox', { name: 'Week 1 Sets', exact: true });
  await weeklySets.fill('4');
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  assert.equal(await weeklyLoad.inputValue(), '145.', 'Focused, unfinished cell text survives reload without a blur.');
  assert.equal(await weeklySets.inputValue(), '4', 'Editing sets after load remains a readable retained draft.');
  await weeklyLoad.fill('-');
  assert(await page.getByRole('button', { name: 'Save changes', exact: true }).first().isDisabled());
  await weeklyLoad.fill('50');
  await page.getByRole('link', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: /Upper body/, exact: false }).first().click();
  assert.equal(await weight.inputValue(), '50', 'Navigation retains the target proposal.');
  state = await apiCall('GET', '/api/state');
  await apiCall('PATCH', slotURL, { target_weight: 55, expected_version: state.plan.version });
  await draft.getByRole('button', { name: 'Save targets', exact: true }).click();
  const review = draft.getByRole('button', { name: 'Use draft with latest targets', exact: true });
  await review.waitFor();
  assert.equal(await weight.inputValue(), '50', 'A conflict retains typed targets.');
  assert(await draft.getByRole('button', { name: 'Save targets', exact: true }).isDisabled());
  assert.match(await draft.innerText(), /55/);
  await review.click();
  await draft.getByRole('button', { name: 'Save targets', exact: true }).click();
  await draft.waitFor({ state: 'hidden' });
  assert.equal((await apiCall('GET', '/api/state')).plan.workouts[0].exercises[0].target_weight, 50);

  await openBlock();
  await page.getByRole('button', { name: 'Name and start', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Reviewed strength block');
  assert(await page.getByRole('button', { name: 'Save changes', exact: true }).first().isDisabled());
  await page.getByRole('button', { name: 'Use draft with latest block', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await page.getByText('Unsaved changes to your block.', { exact: true }).waitFor({ state: 'hidden' });
  state = await apiCall('GET', '/api/state');
  assert.equal(JSON.parse(state.plan.meta).program.name, 'Reviewed strength block');

  // A typed value equal to the old baseline remains an explicit proposal
  // when another client raises that baseline before this draft is saved.
  await weeklyLoad.fill('51');
  await weeklyLoad.fill('50');
  await apiCall('PATCH', slotURL, { target_weight: 55, expected_version: state.plan.version });
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  const blockReview = page.getByRole('button', { name: 'Use draft with latest block', exact: true });
  await blockReview.waitFor();
  assert.equal(await weeklyLoad.inputValue(), '50');
  await blockReview.click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await page.getByText('Unsaved changes to your block.', { exact: true }).waitFor({ state: 'hidden' });
  state = await apiCall('GET', '/api/state');
  assert.equal(JSON.parse(state.plan.meta).program.weeks[0].targets[slotID].target_weight, 50,
    'The reviewed typed value becomes an override when the saved-workout baseline changes.');
  assert.equal(state.plan.workouts[0].exercises[0].target_weight, 55);

  await page.getByRole('link', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: /Upper body/, exact: false }).first().click();
  await page.getByRole('button', { name: 'Edit Dumbbell Bench Press', exact: true }).click();
  await weight.fill('60');
  let writes = 0;
  page.on('request', request => { if (request.method() === 'PATCH' && new URL(request.url()).pathname === slotURL) writes++; });
  let releaseSave;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  await page.route(`**${slotURL}`, async route => {
    if (route.request().method() === 'PATCH') await saveGate;
    await route.continue();
  });
  await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_refresh_failure"}' }));
  await draft.getByRole('button', { name: 'Save targets', exact: true }).click();
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await page.getByRole('link', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: /Upper body/, exact: false }).first().click();
  assert.equal(await weight.inputValue(), '60', 'Remount before acknowledgement retains the pending draft.');
  releaseSave();
  await page.getByText('Saved. Refresh your plan to see the change.', { exact: true }).waitFor();
  await draft.waitFor({ state: 'hidden' });
  assert.equal((await apiCall('GET', '/api/state')).plan.workouts[0].exercises[0].target_weight, 60);
  await page.unroute('**/api/state');
  await page.getByRole('button', { name: 'Refresh plan', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Dumbbell Bench Press', exact: true }).click();
  assert.equal(await weight.inputValue(), '60');
  assert.equal(writes, 1, 'Acknowledged save must never be repeated to recover a failed read.');
}
