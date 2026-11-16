import assert from 'node:assert/strict';

// A training block beside the repeating week (docs/plans/web-app P2): the
// Block tab starts one from ticked workouts in a single plan version, shapes
// its days and weeks without touching what repeats every week, and ends it
// with one week carried on.
export async function blockBesideWeekJourney({ page, origin, apiCall, width = 1280 }) {
  await page.setViewportSize({ width, height: 1000 });
  const meta = state => (typeof state.plan.meta === 'string' ? JSON.parse(state.plan.meta) : state.plan.meta);
  const entries = (pattern, day) => [pattern.week[day], ...(pattern.extras?.[day] ?? [])].filter(Boolean);
  let state = await apiCall('PUT', '/api/plan/active', { name: 'Block beside week' });
  const make = async (name, exercise_ids) => {
    const made = await apiCall('POST', '/api/workouts', { name, exercise_ids, expected_plan_id: state.plan.id, expected_version: state.plan.version });
    state = await apiCall('GET', '/api/state');
    return state.plan.workouts.find(workout => workout.id === made.id);
  };
  const strength = await make('Strength A', ['ex_bench']);
  const tempo = await make('Tempo run', ['ex_outdoor_run']);
  const core = await make('Evening core', ['ex_plank']);
  const tempoSlot = tempo.exercises[0].id;
  const ownSteps = [{ kind: 'warmup', duration_s: 600 }, { kind: 'work', duration_s: 1200 }];
  await apiCall('PATCH', `/api/workouts/${tempo.id}/exercises/${tempoSlot}`, { run_steps: ownSteps, expected_version: state.plan.version });
  state = await apiCall('GET', '/api/state');
  await apiCall('PUT', '/api/plan/schedule', {
    week: { mon: strength.id, wed: core.id, fri: tempo.id }, extras: { mon: [core.id], fri: [core.id] },
    times: { mon: { [strength.id]: '06:30', [core.id]: '21:00' } }, expected_plan_id: state.plan.id, expected_version: state.plan.version });
  state = await apiCall('GET', '/api/state');
  const fits = async what => assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${what} fits the ${width}px viewport.`);
  const sections = page.getByRole('navigation', { name: 'Plan sections', exact: true });

  // With no block, the repeating week says only what it does.
  await page.goto(`${origin}/#plan`);
  await page.getByText('Fills every week below', { exact: true }).waitFor();
  assert.equal(await page.getByText('Carries on beside your block', { exact: true }).count(), 0);
  await page.getByRole('link', { name: 'Training block', exact: true }).click();
  await page.getByRole('heading', { name: 'No training block', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Start a block', exact: true }).click();
  const creation = page.locator('.block-intro');
  // Main workouts are ticked; what sits beside them stays every week.
  assert(await creation.getByRole('checkbox', { name: /^Strength A/ }).isChecked());
  assert(await creation.getByRole('checkbox', { name: /^Tempo run/ }).isChecked());
  assert.equal(await creation.getByRole('checkbox', { name: /^Evening core/ }).isChecked(), false);
  assert.match(await creation.innerText(), /stays every week/);
  await creation.getByRole('textbox', { name: 'Name (optional)', exact: true }).fill('Spring build');
  await creation.getByRole('spinbutton', { name: 'Weeks', exact: true }).fill('3');
  await fits('The new block form');
  const writes = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && pathname.startsWith('/api/plan/')) writes.push(`${request.method()} ${pathname}`);
  });
  await creation.getByRole('button', { name: 'Start block', exact: true }).click();
  await page.getByRole('heading', { name: 'Week by week', exact: true }).waitFor();
  assert.deepEqual(writes, ['PUT /api/plan/program'], 'The block and the week it leaves are one write.');
  let after = await apiCall('GET', '/api/state');
  assert.equal(after.plan.version, state.plan.version + 1, 'Starting a block is one plan version.');
  let program = meta(after).program;
  assert.deepEqual(program.workout_ids, [strength.id, tempo.id]);
  assert.equal(program.weeks.length, 3);
  // Stored weeks hold the whole day, so every app shows the block and the week together.
  assert.deepEqual(entries(program.weeks[0], 'mon'), [strength.id, core.id]);
  assert.deepEqual(entries(program.weeks[2], 'fri'), [tempo.id, core.id]);
  assert.deepEqual(entries(program.weeks[0], 'wed'), [core.id]);
  for (const day of ['mon', 'fri']) assert.deepEqual(entries(after.plan.schedule, day), [core.id], 'The block’s workouts left the repeating week.');
  assert.equal(after.plan.schedule.times.mon[strength.id], '06:30', 'A block workout keeps its time of day.');

  // The Block tab: the block's own workouts by week, and what carries on beside it.
  const table = page.locator('.block-table');
  assert.equal(await table.getByRole('row').count(), 3, 'Only the block’s own workouts have rows.');
  const beside = page.getByRole('region', { name: 'Every week, beside this block', exact: true });
  assert.match(await beside.innerText(), /Evening core/);
  assert.doesNotMatch(await beside.innerText(), /Strength A/);
  await fits('The Block tab');

  // Moving a block workout changes every week of the block and nothing else.
  await page.getByRole('button', { name: /^Strength A: days, Mon\./ }).click();
  const days = page.getByRole('group', { name: 'Strength A: days in every week of the block', exact: true });
  await days.getByRole('checkbox', { name: 'Thursday', exact: true }).check();
  assert(await days.getByRole('checkbox', { name: 'Thursday', exact: true }).isChecked());
  // One week of the planned run asks for more.
  await page.getByRole('button', { name: /^Tempo run, week 2: 20 min\./ }).click();
  const run = page.getByRole('form', { name: 'Plan Outdoor Run', exact: true });
  await run.getByRole('heading', { name: 'Tempo run, week 2', exact: true }).waitFor();
  await run.getByRole('textbox', { name: 'Step 2: time', exact: true }).fill('25:00');
  await run.getByRole('button', { name: 'Use for week 2', exact: true }).click();
  await run.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Tempo run, week 2: 25 min\./ }).waitFor();
  assert.equal((await apiCall('GET', '/api/state')).plan.version, after.plan.version, 'Nothing is saved until Save changes.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await page.getByText('Unsaved changes to your block.', { exact: true }).waitFor({ state: 'hidden' });
  after = await apiCall('GET', '/api/state');
  program = meta(after).program;
  for (const week of program.weeks) {
    assert.deepEqual(entries(week, 'mon'), [strength.id, core.id]);
    assert.deepEqual(entries(week, 'thu'), [strength.id]);
  }
  assert.deepEqual(JSON.parse(program.weeks[1].targets[tempoSlot].run_steps)[1], { kind: 'work', duration_s: 1500 });
  assert.equal(program.weeks[0].targets?.[tempoSlot], undefined, 'Other weeks keep the workout’s own run.');
  assert.deepEqual(JSON.parse(after.plan.workouts.find(workout => workout.id === tempo.id).exercises[0].run_steps), ownSteps, 'The workout itself is unchanged.');
  assert.deepEqual(entries(after.plan.schedule, 'thu'), [], 'The repeating week is untouched by a block change.');

  // A change to the repeating week reaches every block week and leaves the block's own alone.
  await apiCall('PUT', '/api/plan/schedule', { week: { ...after.plan.schedule.week, tue: core.id }, extras: after.plan.schedule.extras ?? {},
    expected_plan_id: after.plan.id, expected_version: after.plan.version });
  after = await apiCall('GET', '/api/state');
  program = meta(after).program;
  for (const week of program.weeks) {
    assert.deepEqual(entries(week, 'tue'), [core.id]);
    assert.deepEqual(entries(week, 'thu'), [strength.id]);
  }
  assert.deepEqual(program.workout_ids, [strength.id, tempo.id]);
  await page.reload();
  await page.getByRole('heading', { name: 'Week by week', exact: true }).waitFor();

  // The Schedule tab draws the two apart and sends block changes to the Block tab.
  await sections.getByRole('link', { name: 'Schedule', exact: true }).click();
  await page.getByText('Carries on beside your block', { exact: true }).waitFor();
  const strip = page.locator('.block-strip');
  assert.match(await strip.innerText(), /Spring build/);
  assert.match(await strip.innerText(), /Week 1 of 3/);
  const blockDay = page.locator('.week-row.in-block').getByRole('gridcell', { name: /from your block: Strength A/ }).first();
  await blockDay.waitFor();
  if (width > 640) assert((await page.locator('.week-row.in-block .chip.own').count()) > 0, 'Block workouts are marked on their dates.');
  await fits('The Schedule tab with a block');
  await strip.getByRole('link', { name: 'Open the block', exact: true }).click();
  await page.getByRole('heading', { name: 'Week by week', exact: true }).waitFor();

  // Ending the block can keep one of its weeks going every week.
  await page.getByRole('button', { name: 'End block', exact: true }).first().click();
  const ending = page.getByRole('region', { name: 'End Spring build?', exact: true });
  await ending.getByRole('combobox', { name: 'Week to keep going', exact: true }).selectOption({ label: '2' });
  assert(await ending.getByRole('radio', { name: /^Keep week/ }).isChecked());
  await fits('The end-block choice');
  await ending.getByRole('button', { name: 'End block', exact: true }).click();
  await page.getByRole('heading', { name: 'No training block', exact: true }).waitFor();
  const ended = await apiCall('GET', '/api/state');
  assert.equal(meta(ended).program, undefined);
  assert.equal(ended.plan.version, after.plan.version + 1, 'Ending is one plan version.');
  assert.deepEqual(entries(ended.plan.schedule, 'mon'), [strength.id, core.id]);
  assert.deepEqual(entries(ended.plan.schedule, 'thu'), [strength.id]);
  assert.deepEqual(entries(ended.plan.schedule, 'fri'), [tempo.id, core.id]);
  assert.deepEqual(entries(ended.plan.schedule, 'tue'), [core.id]);
  assert.deepEqual(JSON.parse(ended.plan.workouts.find(workout => workout.id === tempo.id).exercises[0].run_steps)[1],
    { kind: 'work', duration_s: 1500 }, 'The kept week’s targets are saved to its workouts.');
  await sections.getByRole('link', { name: 'Schedule', exact: true }).click();
  await page.getByText('Fills every week below', { exact: true }).waitFor();
  assert.equal(await page.locator('.block-strip').count(), 0);
  await fits('The Schedule tab');
}
