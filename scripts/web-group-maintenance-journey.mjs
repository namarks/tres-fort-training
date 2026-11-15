import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const exerciseIDs = ['ex_bench', 'ex_rdl', 'ex_ohp', 'ex_barbell_row', 'ex_lat_pulldown', 'ex_db_press', 'ex_leg_press', 'ex_back_squat'];
const keys = ['pre', 'early', 'a', 'b', 'c', 'x', 'y', 'late'];
const ordered = workout => [...workout.exercises].sort((a, b) => a.order_index - b.order_index);

async function seed(apiCall) {
  const { plan } = await apiCall('PUT', '/api/plan/active', { name: 'Group maintenance fixture' });
  const created = await apiCall('POST', '/api/workouts', { name: 'Group maintenance workout', exercise_ids: exerciseIDs,
    expected_plan_id: plan.id, expected_version: plan.version });
  let state = await apiCall('GET', '/api/state');
  const workout = () => state.plan.workouts.find(workout => workout.id === created.id);
  const slots = Object.fromEntries(keys.map((key, index) => [key, ordered(workout())[index]]));
  // Creation starts with distinct choices; an exact slot replacement can create a repeated movement.
  await apiCall('POST', `/api/workouts/${created.id}/exercises/${slots.early.id}/swap`, {
    to_exercise: 'ex_bench', expected_version: state.plan.version });
  state = await apiCall('GET', '/api/state');
  slots.early = workout().exercises.find(slot => slot.id === slots.early.id);
  for (const [index, key] of keys.entries()) {
    await apiCall('PATCH', `/api/workouts/${created.id}/exercises/${slots[key].id}`, { rest_seconds: 101 + index,
      is_warmup: key === 'pre', target_weight: key === 'pre' ? 45 : 135, expected_version: state.plan.version });
    state = await apiCall('GET', '/api/state');
  }
  const group = crypto.randomUUID(), otherGroup = crypto.randomUUID();
  for (const [id, members, round_rest, transition_rest] of [[group, ['a', 'b', 'c'], 73, 0], [otherGroup, ['x', 'y'], 91, 7]]) {
    await apiCall('PUT', `/api/workouts/${created.id}/groups`, { group_id: id, exercises: members.map(key => slots[key].id),
      target_sets: 3, round_rest, transition_rest, expected_version: state.plan.version });
    state = await apiCall('GET', '/api/state');
  }
  return { workoutID: created.id, group, otherGroup, slots, before: workout() };
}

/** Real Worker and D1 exercise the one atomic membership/order write. */
export async function groupMaintenanceJourney({ page, origin, apiCall, width }) {
  const fixture = await seed(apiCall), { workoutID, group, otherGroup, slots } = fixture;
  const pathName = `/api/workouts/${workoutID}/groups`;
  const read = async () => { const state = await apiCall('GET', '/api/state'); return { state, workout: state.plan.workouts.find(workout => workout.id === workoutID) }; };
  const writes = [];
  page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === pathName) writes.push(request.postDataJSON()); });
  await page.goto(`${origin}/#workouts/${workoutID}`);
  const editor = page.getByRole('region', { name: 'Retained group draft', exact: true });
  let labels;
  const open = async () => {
    const current = ordered((await read()).workout);
    labels = Object.fromEntries(keys.map(key => {
      const slot = current.find(slot => slot.id === slots[key].id);
      if (!slot) return [key, slots[key].exercise_name];
      const duplicate = current.filter(other => other.exercise_name === slot.exercise_name).length > 1;
      return [key, duplicate ? `${slot.exercise_name} · workout exercise ${current.indexOf(slot) + 1} · ${slot.is_warmup ? 'warm-up' : 'working'}` : slot.exercise_name];
    }));
    await page.locator('.group-block').first().locator('.group-head').getByRole('button', { name: /^Edit / }).click();
    await editor.waitFor();
  };
  const memberIDs = () => editor.locator('[data-group-member]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-group-member')));
  const add = key => editor.getByLabel('Add a workout exercise', { exact: true }).selectOption(slots[key].id);
  const remove = async key => {
    const before = await memberIDs(), index = before.indexOf(slots[key].id);
    await editor.getByRole('button', { name: `Remove ${labels[key]} from group`, exact: true }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-group-member]')?.getAttribute('data-group-member')),
      before[index + 1] ?? before[index - 1], 'Removing a member keeps keyboard focus on a neighboring selected member.');
  };
  const up = key => editor.getByRole('button', { name: `Move ${labels[key]} up in draft`, exact: true }).click();
  const save = async () => {
    await editor.getByRole('button', { name: 'Save group', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
  };
  const cancel = async () => { page.once('dialog', dialog => dialog.accept()); await editor.getByRole('button', { name: 'Cancel', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); };
  const assertRests = current => {
    for (const before of fixture.before.exercises) assert.equal(current.exercises.find(slot => slot.id === before.id)?.rest_seconds, before.rest_seconds);
  };

  await open();
  assert.equal(await editor.getByRole('option', { name: slots.x.exercise_name, exact: true }).count(), 0, 'Members of another group cannot be added.');
  assert.equal(await editor.getByRole('option', { name: 'Bench Press · workout exercise 1 · warm-up', exact: true }).getAttribute('value'), slots.pre.id);
  assert.equal(await editor.getByRole('option', { name: 'Bench Press · workout exercise 2 · working', exact: true }).getAttribute('value'), slots.early.id);
  await add('late');
  page.once('dialog', dialog => dialog.dismiss());
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert(await editor.isVisible());
  // Switching groups also requires an explicit decision to discard local work.
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.group-block').last().locator('.group-head').getByRole('button', { name: /^Edit / }).click();
  assert.deepEqual(await memberIDs(), ['a', 'b', 'c', 'late'].map(key => slots[key].id));
  await cancel(); assert.equal(writes.length, 0);
  assert.deepEqual((await read()).workout, fixture.before, 'Local membership edits and Cancel never write.');

  await open();
  await add('early'); await add('late'); await remove('b'); await up('c'); await up('early');
  assert.deepEqual(await memberIDs(), ['c', 'early', 'a', 'late'].map(key => slots[key].id));
  assert.match(await editor.innerText(), /Removed members follow it as standalone/);
  if (process.env.WEB_ONBOARDING_ARTIFACTS) {
    await mkdir(process.env.WEB_ONBOARDING_ARTIFACTS, { recursive: true });
    await editor.screenshot({ path: path.join(process.env.WEB_ONBOARDING_ARTIFACTS, `group-maintenance-${width}.png`) });
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px group editor must not overflow.`);
  await save();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].exercises, ['c', 'early', 'a', 'late'].map(key => slots[key].id));
  assert.equal(writes[0].group_id, group); assert.equal(writes[0].order_index, 1);
  assert.equal(writes[0].round_rest, 73); assert.equal(writes[0].transition_rest, 0);
  let { workout } = await read();
  assert.deepEqual(ordered(workout).map(slot => slot.id), ['pre', 'c', 'early', 'a', 'late', 'b', 'x', 'y'].map(key => slots[key].id));
  assert.equal(workout.exercises.find(slot => slot.id === slots.b.id).group_id, null);
  assertRests(workout);
  for (const key of ['x', 'y']) {
    const current = workout.exercises.find(slot => slot.id === slots[key].id);
    assert.equal(current.group_id, otherGroup); assert.equal(current.group_rest_seconds, 91); assert.equal(current.group_transition_seconds, 7); assert.equal(current.target_sets, 3);
  }

  // A stale save keeps membership order and all typed timing for explicit review.
  await open(); await up('late');
  await editor.getByRole('textbox', { name: 'Rounds', exact: true }).fill('5');
  await editor.getByRole('textbox', { name: 'Rest after each round, seconds', exact: true }).fill('87');
  await editor.getByRole('textbox', { name: 'Rest between exercises, seconds', exact: true }).fill('2');
  let latest = await read();
  await apiCall('PUT', pathName, { group_id: group, exercises: ['c', 'early', 'a', 'late'].map(key => slots[key].id),
    target_sets: 8, round_rest: 94, transition_rest: 3, expected_version: latest.state.plan.version, order_index: 1 });
  await editor.getByRole('button', { name: 'Save group', exact: true }).click();
  const review = editor.getByRole('button', { name: 'Review draft with latest group', exact: true });
  await review.waitFor();
  assert.deepEqual(await memberIDs(), ['c', 'early', 'late', 'a'].map(key => slots[key].id));
  assert.equal(await editor.getByRole('textbox', { name: 'Rounds', exact: true }).inputValue(), '5');
  assert.equal(await editor.getByRole('textbox', { name: 'Rest after each round, seconds', exact: true }).inputValue(), '87');
  assert.equal(await editor.getByRole('textbox', { name: 'Rest between exercises, seconds', exact: true }).inputValue(), '2');
  assert.match(await editor.innerText(), /8 rounds · 3s between exercises · 94s after each round/);
  assert(await editor.getByRole('button', { name: 'Save group', exact: true }).isDisabled());
  await review.click(); await save();
  workout = (await read()).workout; assertRests(workout);
  assert.deepEqual(ordered(workout).filter(slot => slot.group_id === group).map(slot => slot.id), ['c', 'early', 'late', 'a'].map(key => slots[key].id));
  assert(workout.exercises.filter(slot => slot.group_id === group).every(slot => slot.target_sets === 5 && slot.group_rest_seconds === 87 && slot.group_transition_seconds === 2));

  // The draft retires on ACK even if the later state refresh is unavailable.
  await open(); await editor.getByRole('textbox', { name: 'Rounds', exact: true }).fill('6');
  await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_refresh_failure"}' }));
  const beforeAck = writes.length; await save();
  await page.getByText('Saved. Refresh your plan to see the change.', { exact: true }).waitFor();
  assert.equal(writes.length, beforeAck + 1);
  assert((await read()).workout.exercises.filter(slot => slot.group_id === group).every(slot => slot.target_sets === 6));
  await page.unroute('**/api/state');
  await page.getByRole('button', { name: 'Refresh plan', exact: true }).click();
  await page.getByText('Saved. Refresh your plan to see the change.', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await editor.count(), 0);

  // A selected standalone moved into another group must remain visible and blocked.
  await open(); await add('pre'); latest = await read();
  await apiCall('PUT', pathName, { group_id: otherGroup, exercises: ['x', 'y', 'pre'].map(key => slots[key].id),
    target_sets: 3, round_rest: 91, transition_rest: 7, expected_version: latest.state.plan.version, order_index: 5 });
  await editor.getByRole('button', { name: 'Save group', exact: true }).click();
  await editor.getByText(`${labels.pre} was removed, replaced, or moved to another group. Your selected members have not been changed.`, { exact: true }).waitFor();
  assert((await memberIDs()).includes(slots.pre.id)); assert(await review.isDisabled()); await cancel();

  // An unavailable selection stays until explicitly removed; the remaining draft can be reviewed and saved.
  await open(); await add('b');
  await editor.getByRole('textbox', { name: 'Rounds', exact: true }).fill('7');
  latest = await read();
  await apiCall('DELETE', `/api/workouts/${workoutID}/exercises/${slots.b.id}?expected_version=${latest.state.plan.version}`);
  await editor.getByRole('button', { name: 'Save group', exact: true }).click();
  await editor.getByText(`${slots.b.exercise_name} was removed, replaced, or moved to another group. Your selected members have not been changed.`, { exact: true }).waitFor();
  assert((await memberIDs()).includes(slots.b.id)); assert(await review.isDisabled());
  await remove('b'); assert(await review.isEnabled()); await review.click();
  assert.equal(await editor.getByRole('textbox', { name: 'Rounds', exact: true }).inputValue(), '7');
  await save();
  assert((await read()).workout.exercises.filter(slot => slot.group_id === group).every(slot => slot.target_sets === 7));
}
