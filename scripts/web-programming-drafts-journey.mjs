import assert from 'node:assert/strict';

export async function programmingDraftJourney({ page, origin, apiCall, width = 1280 }) {
  await page.setViewportSize({ width, height: 1000 });
  const initial = await apiCall('PUT', '/api/plan/active', { name: 'Draft training' });
  const workout = await apiCall('POST', '/api/workouts', { name: 'Strength draft', exercise_ids: ['ex_bench', 'ex_back_squat'],
    expected_plan_id: initial.plan.id, expected_version: initial.plan.version });
  let state = await apiCall('GET', '/api/state');
  const setWeek = async week => {
    const latest = await apiCall('GET', '/api/state');
    return apiCall('PUT', '/api/plan/schedule', { week, extras: {}, times: {}, expected_plan_id: latest.plan.id, expected_version: latest.plan.version });
  };
  await setWeek({ mon: workout.id });
  await page.goto(`${origin}/#block`);
  await page.getByRole('heading', { name: 'No training block', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Start a block', exact: true }).click();
  const creation = page.locator('.block-setup');
  const block = page.getByRole('navigation', { name: 'Plan sections', exact: true }).getByRole('link', { name: 'Block', exact: true });
  const name = creation.getByRole('textbox', { name: 'Name (optional)', exact: true });
  const weeks = creation.getByRole('spinbutton', { name: 'Weeks', exact: true });
  const next = creation.getByRole('button', { name: 'Continue', exact: true });
  const start = creation.getByRole('button', { name: 'Start block', exact: true });
  await name.fill('My retained block'); await weeks.fill('');
  await page.getByRole('link', { name: 'Workouts', exact: true }).click();
  // An unfinished block opens again from the Block tab.
  await block.click();
  assert.equal(await name.inputValue(), 'My retained block');
  assert.equal(await weeks.inputValue(), '', 'Incomplete counts survive navigation without being clamped.');
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  assert.equal(await name.inputValue(), 'My retained block');
  assert.equal(await weeks.inputValue(), '');
  // An unfinished step says what it needs and goes no further.
  await next.click();
  await creation.getByText('Enter between 1 and 52 whole weeks.', { exact: true }).waitFor();
  await weeks.fill('3');
  await next.click();
  assert.match(await creation.locator('.setup-lane.own').innerText(), /Strength draft/, 'A weekday’s main workout starts in the block.');
  await next.click();
  await start.waitFor();
  // The step reached is kept with the draft.
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  await start.waitFor();
  await setWeek({ tue: workout.id });
  await start.click();
  const review = creation.getByRole('button', { name: 'Use the week as it is now', exact: true });
  await review.waitFor();
  assert(await start.isDisabled());
  assert.match(await creation.innerText(), /Your every-week row changed since you began/);
  await review.click();

  // A block created elsewhere is never replaced by this retained new-block draft.
  state = await apiCall('GET', '/api/state');
  await apiCall('PUT', '/api/plan/program', { program: { name: 'Other device block', start: '2026-11-16', repeat: false, weeks: [{ week: { wed: workout.id } }] }, expected_version: state.plan.version });
  await start.click();
  await creation.getByText(/A block has been saved since you started/).waitFor();
  assert(await start.isDisabled());
  assert.equal(JSON.parse((await apiCall('GET', '/api/state')).plan.meta).program.name, 'Other device block');
  page.once('dialog', dialog => dialog.accept());
  await creation.getByRole('button', { name: 'Discard this block', exact: true }).click();
  await creation.waitFor({ state: 'hidden' });

  state = await apiCall('GET', '/api/state');
  await apiCall('DELETE', `/api/plan/program?expected_version=${state.plan.version}`);
  await page.reload();
  await page.getByRole('button', { name: 'Start a block', exact: true }).click();
  await name.fill('Acknowledged block'); await weeks.fill('2');
  await next.click(); await next.click();
  let programWrites = 0;
  page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/plan/program') programWrites++; });
  await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_refresh_failure"}' }));
  await start.click();
  await page.getByText('Saved. Refresh your plan to see the change.', { exact: true }).waitFor();
  await creation.waitFor({ state: 'hidden' });
  assert.equal(programWrites, 1);
  const created = JSON.parse((await apiCall('GET', '/api/state')).plan.meta).program;
  assert.equal(created.name, 'Acknowledged block'); assert.equal(created.weeks.length, 2);
  assert.equal(created.weeks[0].week.tue, workout.id);
  assert.equal(created.weeks[0].week.mon, null);
  // The block keeps its workout as its own, and the same write took it out
  // of what repeats every week.
  assert.deepEqual(created.workout_ids, [workout.id]);
  assert.equal(created.repeat, false);
  assert.equal((await apiCall('GET', '/api/state')).plan.schedule.week.tue, null);
  await page.unroute('**/api/state');
  await page.getByRole('button', { name: 'Refresh plan', exact: true }).click();

  await page.getByRole('link', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: /Strength draft/ }).first().click();
  await page.getByRole('button', { name: 'Rename and tags', exact: true }).click();
  const details = page.getByRole('region', { name: 'Retained workout-details draft', exact: true });
  await details.getByRole('textbox', { name: 'Name', exact: true }).fill('My proposed strength');
  await details.getByRole('textbox', { name: 'Tags', exact: true }).fill('travel, quick');
  await details.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep each controlled rep');
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await page.getByRole('link', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: /Strength draft/ }).first().click();
  assert.equal(await details.getByRole('textbox', { name: 'Notes', exact: true }).inputValue(), 'Keep each controlled rep');
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  assert.equal(await details.getByRole('textbox', { name: 'Tags', exact: true }).inputValue(), 'travel, quick');
  state = await apiCall('GET', '/api/state');
  await apiCall('PATCH', `/api/workouts/${workout.id}`, { notes: 'Other device note', expected_version: state.plan.version });
  await details.getByRole('button', { name: 'Save', exact: true }).click();
  const detailsReview = details.getByRole('button', { name: 'Use draft with latest workout', exact: true });
  await detailsReview.waitFor();
  assert(await details.getByRole('button', { name: 'Save', exact: true }).isDisabled());
  assert.match(await details.innerText(), /Other device note/);
  assert.equal(await details.getByRole('textbox', { name: 'Notes', exact: true }).inputValue(), 'Keep each controlled rep');
  await detailsReview.click();
  await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_refresh_failure"}' }));
  await details.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved. Refresh your plan to see the change.', { exact: true }).waitFor();
  await details.waitFor({ state: 'hidden' });
  state = await apiCall('GET', '/api/state');
  assert.equal(state.plan.workouts[0].name, 'My proposed strength');
  assert.equal(state.plan.workouts[0].notes, 'Keep each controlled rep');
  assert.deepEqual(JSON.parse(state.plan.workouts[0].tags), ['travel', 'quick']);
  assert.equal(state.plan.workouts[0].exercises.length, 2);
  await page.unroute('**/api/state');
  await page.getByRole('button', { name: 'Refresh plan', exact: true }).click();
  await page.getByRole('button', { name: 'Rename and tags', exact: true }).click();
  await details.getByRole('textbox', { name: 'Notes', exact: true }).fill('Discard this text');
  page.once('dialog', dialog => dialog.dismiss());
  await details.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await details.getByRole('textbox', { name: 'Notes', exact: true }).inputValue(), 'Discard this text');
  page.once('dialog', dialog => dialog.accept());
  await details.getByRole('button', { name: 'Cancel', exact: true }).click();
  await details.waitFor({ state: 'hidden' });
  assert.equal((await apiCall('GET', '/api/state')).plan.version, state.plan.version, 'Cancelling does not write.');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Draft and comparison controls fit the viewport.');
}
