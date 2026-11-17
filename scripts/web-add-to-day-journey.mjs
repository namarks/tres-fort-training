import assert from 'node:assert/strict';

// Adding to a day by type, and a block that ends at an event
// (docs/plans/web-app P2): an empty date opens its Add box, a run is shaped
// and saved as a workout in the same go, a double click opens the box on any
// date, the choice can repeat every week, and an event is part of starting a
// block without leaving the Block tab.
export async function addToDayJourney({ page, origin, apiCall, width = 1280 }) {
  await page.setViewportSize({ width, height: 1000 });
  const meta = state => (typeof state.plan.meta === 'string' ? JSON.parse(state.plan.meta) : state.plan.meta);
  let state = await apiCall('PUT', '/api/plan/active', { name: 'Add to a day' });
  const made = await apiCall('POST', '/api/workouts', { name: 'Strength A', exercise_ids: ['ex_bench'], expected_plan_id: state.plan.id, expected_version: state.plan.version });
  state = await apiCall('GET', '/api/state');
  await apiCall('PUT', '/api/plan/schedule', { week: { mon: made.id }, extras: {}, times: {}, expected_plan_id: state.plan.id, expected_version: state.plan.version });
  const fits = async what => assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${what} fits the ${width}px viewport.`);

  await page.goto(`${origin}/#plan`);
  await page.getByRole('heading', { name: 'Your plan', exact: true }).waitFor();
  // Next week's dates, as the page names them.
  const days = await page.evaluate(() => {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + 7);
    return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((key, index) => {
      const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
      return { key, ymd: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
        label: day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) };
    });
  });
  const day = key => days.find(entry => entry.key === key);
  const cell = key => page.getByRole('gridcell', { name: new RegExp(`^${day(key).label}`) });
  const detail = page.locator('aside.detail');
  const box = detail.locator('.add-box');
  const onDate = async key => (await apiCall('GET', '/api/state')).sessions.find(session => session.date === day(key).ymd && (session.slot ?? 0) === 0);

  // An empty date opens with its Add box: pick a type first, then its details.
  await cell('sat').click();
  await box.getByRole('group', { name: 'What to add', exact: true }).waitFor();
  assert.deepEqual(await box.getByRole('group', { name: 'What to add', exact: true }).getByRole('button').allInnerTexts(),
    ['Run', 'Ride', 'Swim', 'Lift', 'At home', 'Other', 'Saved']);
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await box.getByRole('button', { name: 'Tempo', exact: true }).click();
  await box.getByRole('combobox', { name: 'Keep it at (optional)', exact: true }).selectOption('heart_rate');
  await box.getByRole('textbox', { name: 'Lowest heart rate', exact: true }).fill('155');
  await box.getByRole('textbox', { name: 'Highest heart rate', exact: true }).fill('165');
  assert.match(await box.innerText(), /Saved to Workouts as “Tempo run · 20 min”/);
  assert.equal((await apiCall('GET', '/api/state')).plan.workouts.length, 1, 'Shaping a run saves nothing.');
  await fits('The Add box');
  await box.getByRole('button', { name: /^Add to Sat, / }).click();
  await detail.getByRole('button', { name: 'Change workout', exact: true }).waitFor();
  state = await apiCall('GET', '/api/state');
  const tempo = state.plan.workouts.find(workout => workout.name === 'Tempo run · 20 min');
  assert(tempo, 'The run is saved as a workout.');
  assert.deepEqual(JSON.parse(tempo.exercises[0].run_steps), [
    { kind: 'warmup', duration_s: 600 },
    { kind: 'work', duration_s: 1200, target: { type: 'heart_rate', min_bpm: 155, max_bpm: 165 } },
    { kind: 'cooldown', duration_s: 600 },
  ]);
  assert.equal((await onDate('sat'))?.workout_id, tempo.id, 'It is on the date chosen.');
  assert.equal(state.plan.schedule.week.sat ?? null, null, 'One date does not change the repeating week.');
  assert.match(await cell('sat').innerText(), /Tempo run/);

  // The same run on another date uses the saved workout instead of a copy.
  await cell('fri').click();
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await box.getByRole('button', { name: 'Tempo', exact: true }).click();
  await box.getByRole('combobox', { name: 'Keep it at (optional)', exact: true }).selectOption('heart_rate');
  await box.getByRole('textbox', { name: 'Lowest heart rate', exact: true }).fill('155');
  await box.getByRole('textbox', { name: 'Highest heart rate', exact: true }).fill('165');
  await box.getByText(/You already have Tempo run · 20 min, so this uses it/).waitFor();
  await box.getByRole('button', { name: /^Add to Fri, / }).click();
  await detail.getByRole('button', { name: 'Change workout', exact: true }).waitFor();
  state = await apiCall('GET', '/api/state');
  assert.equal(state.plan.workouts.filter(workout => /^Tempo run/.test(workout.name)).length, 1);
  assert.equal((await onDate('fri'))?.workout_id, tempo.id);

  // A double click opens the box on a date that already has a workout, and
  // a choice can repeat every week instead.
  await cell('mon').dblclick();
  await box.getByRole('heading', { name: /^Change Mon, / }).waitFor();
  await box.getByRole('button', { name: 'Other', exact: true }).click();
  await box.getByRole('button', { name: 'Soccer', exact: true }).click();
  await box.getByRole('radio', { name: /^Every Monday/ }).check();
  await box.getByLabel('Time · optional').fill('19:00');
  await box.getByRole('button', { name: 'Add to every Monday', exact: true }).click();
  await page.getByRole('row', { name: 'Every week', exact: true }).getByText('Soccer', { exact: true }).waitFor();
  state = await apiCall('GET', '/api/state');
  const soccer = state.plan.workouts.find(workout => workout.name === 'Soccer');
  assert(soccer && soccer.exercises.length === 0, 'An activity is a workout with no exercises.');
  assert.equal(state.plan.schedule.week.mon, made.id, 'What was on the weekday stays its main workout.');
  assert.deepEqual(state.plan.schedule.extras.mon, [soccer.id]);
  assert.equal(state.plan.schedule.times.mon[soccer.id], '19:00');
  assert.equal(await onDate('mon'), undefined, 'A weekly choice sets no single date.');

  // A ride is planned by time, and named so a synced ride counts as it.
  await cell('thu').click();
  await box.getByRole('button', { name: 'Ride', exact: true }).click();
  await box.getByRole('textbox', { name: 'How long', exact: true }).fill('45');
  await box.getByRole('button', { name: /^Add to Thu, / }).click();
  await detail.getByRole('button', { name: 'Change workout', exact: true }).waitFor();
  state = await apiCall('GET', '/api/state');
  const ride = state.plan.workouts.find(workout => workout.name === '45 min ride');
  assert(ride && ride.exercises.length === 0);
  assert.equal((await onDate('thu'))?.workout_id, ride.id);

  // Saved workouts are one of the types.
  await cell('wed').click();
  await box.getByRole('button', { name: 'Saved', exact: true }).click();
  await box.getByRole('button', { name: /^Add to Wed, .*: Strength A$/ }).click();
  await detail.getByRole('button', { name: 'Change workout', exact: true }).waitFor();
  assert.equal((await onDate('wed'))?.workout_id, made.id);
  await fits('The Schedule tab');

  // An event is the first step of a block, and nothing leaves the Block tab.
  await page.goto(`${origin}/#block`);
  await page.getByRole('button', { name: 'Start a block', exact: true }).click();
  const setup = page.locator('.block-setup');
  await setup.getByRole('radio', { name: /^An event or a date/ }).check();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByText('Name the event.', { exact: true }).waitFor();
  await setup.getByRole('textbox', { name: 'What', exact: true }).fill('Spring 10k');
  await setup.getByRole('combobox', { name: 'Distance (optional)', exact: true }).selectOption('10k');
  // Four Mondays on from this week's, so the block has five weeks.
  const eventDay = await page.evaluate(() => {
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + 28 + 5);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  });
  await setup.getByLabel('When', { exact: true }).fill(eventDay);
  await setup.getByText(/^That is 5 weeks from /).waitFor();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('heading', { name: 'What does one week of it look like?', exact: true }).waitFor();
  assert.match(await setup.locator('.setup-lane.own').innerText(), /Strength A/);
  assert.match(await setup.locator('.setup-lane.beside').innerText(), /Soccer/);
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  // Five weeks have an easier fourth week by default.
  await setup.getByRole('columnheader', { name: /Week 4.*Easier week/s }).waitFor();
  const writes = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && pathname.startsWith('/api/plan/')) writes.push(`${request.method()} ${pathname}`);
  });
  const before = (await apiCall('GET', '/api/state')).plan.version;
  await setup.getByRole('button', { name: 'Start block', exact: true }).click();
  await page.getByRole('heading', { name: 'Week by week', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '#block', 'Starting for an event stays on the Block tab.');
  assert.deepEqual(writes, ['PUT /api/plan/race', 'PUT /api/plan/program'], 'The event, then the block.');
  state = await apiCall('GET', '/api/state');
  assert.equal(state.plan.version, before + 2);
  assert.deepEqual(meta(state).race, { name: 'Spring 10k', date: eventDay, discipline: 'running', distance: '10k', distance_m: 10000 });
  const program = meta(state).program;
  assert.equal(program.name, 'Spring 10k');
  assert.equal(program.weeks.length, 5);
  assert.deepEqual(program.workout_ids, [made.id]);
  assert.equal(program.weeks[3].label, 'Easier week');
  const bench = state.plan.workouts.find(workout => workout.id === made.id).exercises[0];
  assert.deepEqual(program.weeks.map(week => week.targets?.[bench.id]?.target_reps ?? bench.target_reps),
    [0, 1, 2, 0, 3].map(more => bench.target_reps + more).map((reps, index) => index === 3 ? Math.round((bench.target_reps + 2) * 0.8) : reps));
  assert.match(await page.locator('.block-head').innerText(), /for Spring 10k on/);
  assert.equal(await page.getByRole('combobox', { name: 'Easier week', exact: true }).inputValue(), '4');

  // A rule changed on the running block fills the weeks from this one on, and waits for Save changes.
  await page.getByRole('textbox', { name: /^Strength A: reps added each week/ }).fill('2');
  await page.getByText('Unsaved changes to your block.', { exact: true }).waitFor();
  assert.equal((await apiCall('GET', '/api/state')).plan.version, state.plan.version);
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await page.getByText('Unsaved changes to your block.', { exact: true }).waitFor({ state: 'hidden' });
  const changed = meta(await apiCall('GET', '/api/state')).program;
  assert.equal(changed.weeks[1].targets[bench.id].target_reps, bench.target_reps + 2);
  assert.equal(changed.weeks[4].targets[bench.id].target_reps, bench.target_reps + 6);
  await fits('The Block tab');
}
