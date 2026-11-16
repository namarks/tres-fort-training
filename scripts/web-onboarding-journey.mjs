import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

async function screenshot(locator, name, options = {}) {
  const directory = process.env.WEB_ONBOARDING_ARTIFACTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await locator.screenshot({ ...options, path: path.join(directory, name) });
}

/** Signed-out entry uses the real gateway without creating an account or
 * visiting Apple's provider. Query errors must leave a usable sign-in path. */
export async function signedOutJourney({ page, origin, width }) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  assert.equal((await page.context().cookies()).length, 0);
  for (const [problem, message] of [
    ['', null],
    ['cancelled', 'Sign in was cancelled.'],
    ['failed', 'Sign in didn’t work. Please try again.'],
    ['unavailable', 'This account can’t be used right now.'],
    ['unrecognized-provider-message', null],
  ]) {
    await page.goto(`${origin}/${problem ? `?signin=${problem}` : ''}`);
    const signIn = page.getByRole('link', { name: 'Sign in with Apple', exact: true });
    await signIn.waitFor();
    assert.equal(await signIn.getAttribute('href'), '/auth/apple/start');
    await signIn.click({ trial: true });
    await signIn.focus();
    assert(await signIn.evaluate(element => element === document.activeElement), 'Apple sign-in remains keyboard reachable.');
    const card = page.locator('.signin-card');
    assert.match(await card.innerText(), /Schedule core separately from a run/);
    assert.match(await card.innerText(), /Sign in to create your account/);
    assert.match(await card.innerText(), /same Apple account/);
    assert.match(await card.innerText(), /timers, and record runs in the iPhone app/);
    const alert = page.getByRole('alert');
    if (message) assert.equal(await alert.innerText(), message);
    else assert.equal(await alert.count(), 0, 'Unknown provider errors are not displayed as arbitrary text.');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px sign-in must not scroll horizontally.`);
    const bounds = await card.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `${width}px sign-in card stays within the viewport.`);
    if (!problem) await screenshot(card, `signed-out-${width}.png`);
    if (problem === 'failed') await screenshot(card, `signed-out-retry-${width}.png`);
  }
  for (const problem of ['', 'cancelled', 'failed', 'unavailable']) {
    await page.goto(`${origin}/${problem ? `?signin=${problem}` : ''}#block`);
    const signIn = page.getByRole('link', { name: 'Sign in with Apple', exact: true });
    await signIn.waitFor();
    assert.equal(await signIn.getAttribute('href'), '/auth/apple/start?return=%2F%23block');
    await signIn.click({ trial: true });
    assert.match(await page.locator('.signin-card').innerText(), /Your training block will open after sign-in\. You can start one there if you do not have one yet\./);
    assert.match(await page.locator('.signin-card').innerText(), /same Apple account/);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px block handoff sign-in stays within the viewport.`);
  }
  assert.deepEqual(errors, []);
}

export async function accountSwitchJourney({ page, origin, switchAccount, originalState, otherState }) {
  await page.goto(`${origin}/#workouts`);
  await page.getByRole('button', { name: /^Run Start with an open run/ }).click();
  await page.getByLabel('Workout name', { exact: true }).fill('Original account run');
  await switchAccount('other');
  await page.getByRole('button', { name: 'Save reviewed workout', exact: true }).click();
  await page.getByRole('heading', { name: 'Your account changed in another tab', exact: true }).waitFor();
  assert.equal((await otherState()).plan, null, 'A stale tab cannot create its draft in another account.');
  assert.equal((await originalState()).plan, null);
  await page.getByRole('button', { name: 'Load current account', exact: true }).click();
  await page.getByRole('heading', { name: 'Create a workout', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Retry same save', exact: true }).count(), 0, 'Other account cannot resume the original account’s request.');
  await switchAccount('original');
  await page.reload();
  await page.getByRole('button', { name: 'Retry same save', exact: true }).click();
  await page.getByRole('button', { name: 'Add to your week', exact: true }).waitFor();
  assert.deepEqual((await originalState()).plan.workouts.map(workout => workout.name), ['Original account run']);
  assert.equal((await otherState()).plan, null);
}

export async function creationConflictJourney({ page, origin, apiCall }) {
  await page.goto(`${origin}/#workouts`);
  await page.getByRole('button', { name: /^At home Core, stretching/ }).click();
  await page.getByLabel('Workout name', { exact: true }).fill('Reviewed core');
  await page.getByLabel('Hold / work (seconds)', { exact: true }).fill('35');
  // Another client creates a plan after this planless draft was reviewed.
  await apiCall('PUT', '/api/plan/active', { name: 'Plan from another client' });
  let refusedRead = false;
  await page.route('**/api/state', async route => {
    if (!refusedRead) { refusedRead = true; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_refresh_failure"}' }); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Save reviewed workout', exact: true }).click();
  const refresh = page.getByRole('button', { name: 'Refresh plan', exact: true });
  await refresh.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save reviewed workout', exact: true }).isEnabled(), false);
  assert.equal(await page.getByLabel('Hold / work (seconds)', { exact: true }).inputValue(), '35');
  await refresh.click();
  await page.getByRole('button', { name: 'Review with latest plan', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save reviewed workout', exact: true }).isEnabled(), false);
  await page.getByRole('button', { name: 'Review with latest plan', exact: true }).click();
  await page.getByRole('button', { name: 'Save reviewed workout', exact: true }).click();
  await page.getByRole('button', { name: 'Add to your week', exact: true }).waitFor();
  const state = await apiCall('GET', '/api/state');
  assert.equal(state.plan.workouts.length, 1);
  assert.equal(state.plan.workouts[0].name, 'Reviewed core');
  assert.equal(state.plan.workouts[0].exercises.find(slot => slot.exercise_id === 'ex_plank').target_duration_s, 35);
}

/** Lifting starts with a complete local draft; selection never creates empty
 * workouts or writes default targets. Faults retain the real server receipt. */
export async function liftingCreationJourney({ page, origin, width, apiCall }) {
  const creations = [], writes = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(pathname);
    if (pathname === '/api/workouts/prescribed' && request.method() === 'POST') creations.push(request.postDataJSON());
  });
  const save = page.getByRole('button', { name: 'Save reviewed workout', exact: true });
  const search = page.getByRole('searchbox', { name: 'Find a lifting exercise', exact: true });
  const panel = name => page.locator('.lifting-targets').filter({ has: page.locator('summary strong', { hasText: new RegExp(`^\\d+\\. ${name}$`) }) });
  const edit = async (name, action) => {
    const row = panel(name), summary = row.locator('summary');
    await summary.click();
    await action(row.getByRole('group', { name, exact: true }));
    await summary.click();
  };
  const add = async name => {
    await search.fill(name);
    await page.getByRole('region', { name: 'Choose lifting exercises', exact: true }).getByRole('button', { name: new RegExp(`^${name}\\s*Add$`) }).click();
  };
  await page.goto(`${origin}/#workouts`);
  await page.getByRole('button', { name: /^Lifting Choose exercises/ }).click();
  await page.getByLabel('Workout name', { exact: true }).fill('Reviewed six movements');
  await add('Bench Press');
  await search.fill('Back Squat'); await search.press('Enter');
  assert.equal(writes.length, 0, 'Pressing Enter while searching must not save a partial workout.');
  for (const name of ['Back Squat', 'Dumbbell Bench Press', 'Pull-Up', 'Plank', 'Bike Erg']) await add(name);
  await search.fill('Outdoor Run');
  assert.equal(await page.getByRole('region', { name: 'Choose lifting exercises', exact: true }).getByRole('button').count(), 0);
  await search.fill('');
  assert.equal(await page.locator('.lifting-targets').count(), 6);
  await edit('Bench Press', async fields => {
    await fields.getByLabel(/^Warm-up/).check();
    await fields.getByLabel('Sets', { exact: true }).fill('2');
    await fields.getByRole('textbox', { name: 'Reps', exact: true }).fill('10');
    await fields.getByLabel('Weight unit', { exact: true }).selectOption('kg');
    await fields.getByLabel('Weight', { exact: true }).fill('20');
    await fields.getByLabel('Rest between sets, seconds', { exact: true }).fill('45');
  });
  await edit('Back Squat', async fields => {
    await fields.getByLabel('Sets', { exact: true }).fill('5');
    await fields.getByRole('textbox', { name: 'Reps', exact: true }).fill('5');
    await fields.getByLabel('Weight unit', { exact: true }).selectOption('lb');
    await fields.getByLabel('Weight', { exact: true }).fill('135.');
    await fields.getByLabel('Target RPE', { exact: true }).fill('8');
    await fields.getByLabel('Rest between sets, seconds', { exact: true }).fill('150');
  });
  await edit('Dumbbell Bench Press', async fields => {
    assert.equal(await fields.getByLabel('Weight, each hand', { exact: true }).inputValue(), '');
    await fields.getByLabel('Weight unit', { exact: true }).selectOption('kg');
    await fields.getByLabel('Rep range', { exact: true }).check();
    await fields.getByLabel('Up to', { exact: true }).fill('4');
    assert(await save.isDisabled(), 'Invalid individual targets must block the first save.');
    await fields.getByLabel('Up to', { exact: true }).fill('12');
    await fields.getByLabel('Rest between sets, seconds', { exact: true }).fill('75');
    await fields.getByRole('button', { name: 'Move Dumbbell Bench Press up', exact: true }).click();
  });
  await edit('Pull-Up', async fields => {
    assert.match(await fields.innerText(), /assistance as a negative one/);
    await fields.getByLabel('Sets', { exact: true }).fill('4');
    await fields.getByRole('textbox', { name: 'Reps', exact: true }).fill('6');
    await fields.getByLabel('Weight unit', { exact: true }).selectOption('kg');
    await fields.getByLabel('Weight', { exact: true }).fill('-10');
    await fields.getByLabel('Rest between sets, seconds', { exact: true }).fill('90');
  });
  await edit('Plank', async fields => {
    await fields.getByLabel('Sets', { exact: true }).fill('2');
    await fields.getByLabel('Seconds each', { exact: true }).fill('35');
    await fields.getByLabel('Rest between sets, seconds', { exact: true }).fill('30');
  });
  await edit('Bike Erg', async fields => {
    await fields.getByLabel('Minutes', { exact: true }).fill('5.25');
    await fields.getByLabel('Rest between sets, seconds', { exact: true }).fill('0');
  });
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await page.getByRole('link', { name: 'Workouts', exact: true }).click();
  assert.equal(await page.getByLabel('Workout name', { exact: true }).inputValue(), 'Reviewed six movements');
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await edit('Back Squat', async fields => assert.equal(await fields.getByLabel('Weight', { exact: true }).inputValue(), '135.'));
  assert.deepEqual(await page.locator('.lifting-targets summary strong').allTextContents(), ['1. Bench Press', '2. Dumbbell Bench Press', '3. Back Squat', '4. Pull-Up', '5. Plank', '6. Bike Erg']);
  assert.equal(writes.length, 0, 'Selection, target edits, reordering and restoring must perform no server writes.');
  assert.equal((await apiCall('GET', '/api/state')).plan, null);
  await screenshot(page.locator('.guided-workout'), `web-lifting-review-${width}.png`);
  await screenshot(page, `web-lifting-page-${width}.png`, { fullPage: true });
  const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].flatMap(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && (bounds.right > window.innerWidth + 1 || bounds.left < -1)
      ? [{ tag: element.tagName, className: element.className, text: element.textContent?.trim().slice(0, 80), left: bounds.left, right: bounds.right, width: bounds.width }] : [];
  }));
  if (overflow.length) console.error('Lifting overflow bounds:', JSON.stringify(overflow.slice(0, 30)));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px lifting draft must not overflow.`);
  for (const link of await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('link').all()) {
    const bounds = await link.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
      `${width}px navigation link ${await link.innerText()} stays inside the viewport.`);
  }

  let lostReply = false;
  await page.route('**/api/workouts/prescribed', async route => {
    if (lostReply) return route.continue();
    lostReply = true;
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_lost_receipt"}' });
  });
  await save.click();
  await page.getByRole('button', { name: 'Retry same save', exact: true }).waitFor();
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await edit('Back Squat', async fields => {
    assert.equal(await fields.getByLabel('Weight', { exact: true }).inputValue(), '135');
    assert(await fields.getByLabel('Weight', { exact: true }).isDisabled());
  });
  await page.getByRole('button', { name: 'Retry same save', exact: true }).click();
  await page.getByRole('button', { name: 'Add to your week', exact: true }).waitFor();
  assert.deepEqual(creations[1], creations[0], 'All UUIDs, authority and targets stay fixed across an uncertain reload/retry.');
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('tresfort.editorDraft.')).length), 0,
    'Acknowledgement retires the original planless creation draft even after the new plan loads.');
  let state = await apiCall('GET', '/api/state');
  assert.equal(state.plan.workouts.length, 1);
  const selected = ['exercise_id', 'order_index', 'target_sets', 'target_reps', 'target_reps_max', 'target_rpe', 'rest_seconds', 'target_weight', 'target_weight_unit', 'target_duration_s', 'is_warmup'];
  const targets = slot => Object.fromEntries(selected.map(key => [key, slot[key]]));
  assert.deepEqual(state.plan.workouts[0].exercises.map(targets), creations[0].slots.map(targets));

  // A changed version of the same plan keeps the new proposal until explicit review.
  await page.getByRole('button', { name: 'New workout', exact: true }).click();
  await page.getByRole('button', { name: /^Lifting Choose exercises/ }).click();
  await page.getByLabel('Workout name', { exact: true }).fill('Conflict reviewed lift');
  await add('Bench Press');
  await edit('Bench Press', async fields => {
    await fields.getByRole('textbox', { name: 'Reps', exact: true }).fill('7');
    await fields.getByLabel('Rest between sets, seconds', { exact: true }).fill('135');
  });
  await apiCall('PATCH', `/api/workouts/${state.plan.workouts[0].id}`, { name: 'Renamed on another client', expected_version: state.plan.version });
  await save.click();
  const review = page.getByRole('button', { name: 'Review with latest plan', exact: true });
  await review.waitFor();
  assert(await save.isDisabled());
  assert.match(await panel('Bench Press').innerText(), /3 × 7 reps.*Rest 135s/);
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await review.click();
  await save.click();
  await page.getByRole('button', { name: 'Add to your week', exact: true }).waitFor();
  state = await apiCall('GET', '/api/state');
  assert.equal(state.plan.workouts.length, 2);
  assert.equal(state.plan.workouts.find(workout => workout.name === 'Conflict reviewed lift').exercises[0].target_reps, 7);
  assert.notEqual(creations[3].workout_id, creations[2].workout_id, 'A definite refusal releases the old request only after review.');
  assert.deepEqual(errors, []);
}

/** Real local gateway + D1 journey. Faults below alter only the browser's
 * acknowledgement/read, leaving the actual server receipt available to retry. */
export async function mixedWeekJourney({ page, origin, width, apiCall }) {
  const creations = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/workouts/prescribed') creations.push(request.postDataJSON());
  });
  const click = async locator => {
    if (width === 800) {
      // Wait for asynchronous catalog/plan work to enable the control without
      // activating it with a pointer. The actual activation stays keyboard-only.
      await locator.click({ trial: true });
      await locator.focus(); await page.keyboard.press('Enter');
    }
    else await locator.click();
  };
  const chooseDay = async (form, name) => {
    const checkbox = form.getByRole('checkbox', { name: new RegExp(`^${name}`) });
    if (width === 800) { await checkbox.focus(); await page.keyboard.press('Space'); }
    else await checkbox.check();
  };
  const schedule = async (name, time) => {
    await click(page.getByRole('button', { name: 'Add to your week', exact: true }));
    const form = page.getByRole('form', { name: `Add ${name} to your week`, exact: true });
    await chooseDay(form, 'Tuesday'); await chooseDay(form, 'Thursday');
    await form.getByLabel(`Time for ${name} · optional`, { exact: true }).fill(time);
    return form;
  };
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Plan your week', exact: true }).waitFor();
  await click(page.getByRole('button', { name: 'Create your first workout', exact: true }));
  await click(page.getByRole('button', { name: /^Run Start with an open run/ }));
  await page.getByLabel('Workout name', { exact: true }).fill('Morning run');
  await click(page.getByRole('button', { name: 'Save reviewed workout', exact: true }));
  await page.getByRole('button', { name: 'Add to your week', exact: true }).waitFor();
  const runForm = await schedule('Morning run', '07:00');
  await click(runForm.getByRole('button', { name: 'Add to selected days', exact: true }));
  await runForm.waitFor({ state: 'detached' });

  await click(page.getByRole('link', { name: 'Workouts', exact: true }));
  await click(page.getByRole('button', { name: /^At home Core, stretching/ }));
  await page.getByLabel('Workout name', { exact: true }).fill('Evening core');
  await page.getByRole('checkbox', { name: 'Do one set of each exercise per round', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Time every exercise', exact: true }).check();
  await page.getByLabel('Rounds', { exact: true }).fill('2');
  await page.getByLabel('Hold / work (seconds)', { exact: true }).fill('40');
  await page.getByLabel('Between exercises (seconds)', { exact: true }).fill('20');
  await page.getByLabel('After each round (seconds)', { exact: true }).fill('60');
  assert.match(await page.getByRole('heading', { name: 'How the timers work on iPhone' }).locator('..').innerText(), /logs automatically/);
  const preview = page.getByRole('region', { name: 'Time and timer preview', exact: true });
  assert.match(await preview.innerText(), /10 min 20 sec of planned timers/);
  const previewStep = preview.locator('.routine-preview-step');
  assert.match(await previewStep.innerText(), /Step 1 of 19 · Round 1 of 2/);
  assert.match(await previewStep.innerText(), /Plank/);
  assert.match(await previewStep.innerText(), /40 sec timer/);
  await click(preview.getByRole('button', { name: 'Next step', exact: true }));
  assert.match(await previewStep.innerText(), /Between exercises/);
  assert.match(await previewStep.innerText(), /20 sec rest/);
  for (let step = 2; step < 10; step++) await click(preview.getByRole('button', { name: 'Next step', exact: true }));
  assert.match(await previewStep.innerText(), /Between rounds/);
  assert.match(await previewStep.innerText(), /1 min rest/);
  for (let step = 10; step < 19; step++) await click(preview.getByRole('button', { name: 'Next step', exact: true }));
  assert.match(await previewStep.innerText(), /Step 19 of 19 · Round 2 of 2/);
  assert.match(await previewStep.innerText(), /40 sec timer/);
  assert.equal(await preview.getByRole('button', { name: 'Next step', exact: true }).isEnabled(), false);
  assert.equal(creations.length, 1, 'Stepping through the preview must not save or start the core routine.');
  await page.getByLabel('Hold / work (seconds)', { exact: true }).fill('30');
  assert.match(await preview.innerText(), /8 min 40 sec of planned timers/);
  assert.match(await previewStep.innerText(), /Step 1 of 19 · Round 1 of 2/);
  await page.getByLabel('Hold / work (seconds)', { exact: true }).fill('40');
  await screenshot(page.locator('.guided-workout'), `web-core-review-${width}.png`);

  let failedState = false;
  if (width === 1280) {
    // Acknowledged creation followed by failed refresh: only retry the read.
    await page.route('**/api/state', async route => {
      if (!failedState) { failedState = true; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_refresh_failure"}' }); }
      else await route.continue();
    });
    await click(page.getByRole('button', { name: 'Save reviewed workout', exact: true }));
    await page.getByRole('button', { name: 'Reload saved workout', exact: true }).waitFor();
    assert.equal(creations.length, 2);
    await click(page.getByRole('button', { name: 'Reload saved workout', exact: true }));
  } else {
    let lostReply = false;
    await page.route('**/api/workouts/prescribed', async route => {
      if (!lostReply) {
        lostReply = true;
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        await route.abort('failed');
      } else await route.continue();
    });
    await click(page.getByRole('button', { name: 'Save reviewed workout', exact: true }));
    await page.getByRole('button', { name: 'Retry same save', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Retry same save', exact: true }).waitFor();
    await click(page.getByRole('button', { name: 'Retry same save', exact: true }));
    await page.getByRole('button', { name: 'Add to your week', exact: true }).waitFor();
    assert.equal(creations.length, 3);
    assert.deepEqual(creations[1], creations[2], 'A reload and ambiguous retry must keep every request field and UUID.');
  }
  await page.getByRole('button', { name: 'Add to your week', exact: true }).waitFor();
  await page.getByText('2 rounds · round rest 1:00 · 0:20 between exercises', { exact: true }).waitFor();
  const coreForm = await schedule('Evening core', '18:00');
  assert.match(await coreForm.innerText(), /Alongside Morning run/);
  if (width === 1280) {
    let failedSchedule = false;
    await page.route('**/api/plan/schedule', async route => {
      if (!failedSchedule) { failedSchedule = true; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_schedule_failure"}' }); }
      else await route.continue();
    });
    await click(coreForm.getByRole('button', { name: 'Add to selected days', exact: true }));
    await page.getByRole('alert').waitFor();
    assert.equal((await apiCall('GET', '/api/state')).plan.workouts.length, 2);
    await click(coreForm.getByRole('button', { name: 'Add to selected days', exact: true }));
  } else {
    // Another client's edit invalidates this reviewed full-week draft.
    const before = await apiCall('GET', '/api/state');
    const run = before.plan.workouts.find(workout => workout.name === 'Morning run');
    await apiCall('PATCH', `/api/workouts/${run.id}`, { notes: 'Edited on another client', expected_version: before.plan.version });
    const previousForm = await coreForm.elementHandle();
    assert(previousForm);
    await click(coreForm.getByRole('button', { name: 'Add to selected days', exact: true }));
    await page.getByRole('alert').filter({ hasText: 'Your plan changed' }).waitFor();
    // The alert is published before reload finishes. A refreshed plan version
    // remounts this form; observe that boundary before inspecting its new draft.
    await page.waitForFunction(form => !form.isConnected, previousForm);
    await previousForm.dispose();
    const refreshed = page.getByRole('form', { name: 'Add Evening core to your week', exact: true });
    await refreshed.getByRole('checkbox', { name: /^Tuesday/ }).click({ trial: true });
    assert.equal(await refreshed.getByRole('checkbox', { name: /^Tuesday/ }).isChecked(), false);
    await chooseDay(refreshed, 'Tuesday'); await chooseDay(refreshed, 'Thursday');
    await refreshed.getByLabel('Time for Evening core · optional', { exact: true }).fill('18:00');
    await click(refreshed.getByRole('button', { name: 'Add to selected days', exact: true }));
  }
  await page.getByRole('form', { name: 'Add Evening core to your week', exact: true }).waitFor({ state: 'detached' });
  await page.reload();
  const state = await apiCall('GET', '/api/state');
  assert.equal(state.plan.workouts.length, 2);
  assert.equal(state.sessions.length, 0, 'Planning never starts a workout.');
  const run = state.plan.workouts.find(workout => workout.name === 'Morning run');
  const core = state.plan.workouts.find(workout => workout.name === 'Evening core');
  assert.equal(run.exercises[0].exercise_id, 'ex_outdoor_run');
  assert.equal(run.exercises[0].target_duration_s, null);
  assert.equal(core.exercises.length, 5);
  assert.equal(new Set(core.exercises.map(slot => slot.group_id)).size, 1);
  assert(core.exercises.every(slot => slot.group_id && slot.target_sets === 2 && slot.target_duration_s === 40
    && slot.group_transition_seconds === 20 && slot.group_rest_seconds === 60));
  for (const day of ['tue', 'thu']) {
    assert.equal(state.plan.schedule.week[day], run.id);
    assert.deepEqual(state.plan.schedule.extras[day], [core.id]);
    assert.deepEqual(state.plan.schedule.times[day], { [run.id]: '07:00', [core.id]: '18:00' });
  }
  const routine = page.getByRole('row', { name: 'Every week', exact: true });
  await routine.waitFor();
  assert.match(await routine.innerText(), /Evening core/);
  await click(routine.getByRole('gridcell', { name: 'Edit Tuesday', exact: true }));
  let edit = page.getByRole('form', { name: 'Edit Tuesday', exact: true });
  await edit.getByLabel('Time for Evening core · optional', { exact: true }).fill('18:30');
  await click(edit.getByRole('button', { name: 'Cancel', exact: true }));
  assert.equal((await apiCall('GET', '/api/state')).plan.version, state.plan.version, 'Cancelling a day edit writes nothing.');
  await click(routine.getByRole('gridcell', { name: 'Edit Tuesday', exact: true }));
  edit = page.getByRole('form', { name: 'Edit Tuesday', exact: true });
  assert.equal(await edit.getByLabel('Time for Evening core · optional', { exact: true }).inputValue(), '18:00');
  await screenshot(page, `web-plan-every-tuesday-${width}.png`);
  await edit.getByLabel('Time for Evening core · optional', { exact: true }).fill('18:30');
  // Choosing another weekday or a date asks before an unsaved day is replaced; declining keeps it.
  for (const other of [routine.getByRole('gridcell', { name: 'Edit Wednesday', exact: true }), page.locator('.week-row .day').first()]) {
    const asked = new Promise(resolve => page.once('dialog', async dialog => { const text = dialog.message(); await dialog.dismiss(); resolve(text); }));
    await other.click();
    assert.match(await asked, /Discard your unsaved changes to Tuesday\?/);
    assert.equal(await edit.getByLabel('Time for Evening core · optional', { exact: true }).inputValue(), '18:30');
  }
  await click(edit.getByRole('button', { name: 'Save Tuesday', exact: true }));
  await edit.waitFor({ state: 'detached' });
  const edited = await apiCall('GET', '/api/state');
  assert.deepEqual(edited.plan.schedule.times.tue, { [run.id]: '07:00', [core.id]: '18:30' });
  assert.deepEqual(edited.plan.schedule.times.thu, { [run.id]: '07:00', [core.id]: '18:00' });
  await screenshot(routine, `web-mixed-week-${width}.png`);
  await screenshot(page, `web-plan-page-${width}.png`, { fullPage: true });
  // The Plan page ends with the week and away dates: no iPhone handoff and
  // no guidance sections under them (owner, 2026-11-16).
  assert.equal(await page.getByRole('heading', { name: 'Take your week to iPhone' }).count(), 0);
  assert.equal(await page.getByRole('region', { name: 'Build on your week', exact: true }).count(), 0);
  const beforeGuidance = (await apiCall('GET', '/api/state')).plan.version;
  const sections = page.getByRole('navigation', { name: 'Plan sections', exact: true });
  // Blocks have their own tab: the Schedule tab only links there.
  await click(page.getByRole('link', { name: 'Training block', exact: true }));
  await page.getByRole('heading', { name: 'No training block', exact: true }).waitFor();
  assert.equal(await sections.getByRole('link', { name: 'Block', exact: true }).getAttribute('aria-current'), 'page');
  await click(page.getByRole('button', { name: 'Start a block', exact: true }));
  await page.getByRole('heading', { name: 'Start a training block', exact: true }).waitFor();
  await screenshot(page.locator('.block-intro'), `web-training-block-${width}.png`);
  await page.getByRole('button', { name: 'Start block', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'The block form fits the viewport.');
  assert.equal((await apiCall('GET', '/api/state')).plan.version, beforeGuidance,
    'Opening the block form must not create one or alter the established week.');
  await page.goto(`${origin}/#calendar`);
  assert.equal(await sections.getByRole('link', { name: 'Schedule', exact: true }).getAttribute('aria-current'), 'page');
  await click(sections.getByRole('link', { name: 'Workouts', exact: true }));
  await page.getByRole('heading', { name: 'Workouts', exact: true }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('link', { name: 'Plan', exact: true }).getAttribute('aria-current'), 'page',
    'Workouts is a tab of Plan.');
  await screenshot(page, `web-plan-workouts-tab-${width}.png`);
  assert.equal((await apiCall('GET', '/api/state')).plan.version, beforeGuidance);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'No horizontal page overflow.');
  assert.deepEqual(errors, []);
}
