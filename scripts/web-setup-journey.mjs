import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

async function screenshot(locator, name, options = {}) {
  const directory = process.env.WEB_ONBOARDING_ARTIFACTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await locator.screenshot({ ...options, path: path.join(directory, name) });
}

// First-run setup and Settings (docs/plans/web-app P1 and P4): a new web
// member lands in three optional steps (usual week, goal event, connections)
// instead of an empty workout form; each change saves as it is made, a
// provider's return comes back to the step, and Settings holds Connections
// and AI coach. No provider is contacted: the disposable Worker has no
// intervals.icu or WHOOP credentials.
export async function setupJourney({ page, origin, apiCall, width = 1280 }) {
  await page.setViewportSize({ width, height: 1000 });
  const fits = async what => assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${what} fits the ${width}px viewport.`);
  const shot = name => screenshot(page, `${name}-${width}.png`, { fullPage: true });

  // A new account opens setup at the front door.
  await page.goto(origin);
  await page.getByRole('heading', { name: 'What does your usual week look like?', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '#setup');
  assert.equal((await apiCall('GET', '/api/state')).plan, null, 'Opening setup writes nothing.');
  await fits('Setup step 1');
  await shot('web-setup-week-empty');

  // Step 1: a run on every Tuesday, saved as it is added.
  await page.getByRole('button', { name: 'Add to Tuesday', exact: true }).click();
  const box = page.locator('.first-run-adder .add-box');
  await box.getByRole('heading', { name: 'Add to every Tuesday', exact: true }).waitFor();
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await box.getByRole('button', { name: 'Add to every Tuesday', exact: true }).click();
  await box.waitFor({ state: 'detached' });
  let state = await apiCall('GET', '/api/state');
  const run = state.plan.workouts.find(workout => workout.id === state.plan.schedule.week.tue);
  assert(run, 'The run is saved and repeats every Tuesday.');
  const tuesday = page.getByRole('listitem', { name: 'Tuesday', exact: true });
  assert.match(await tuesday.innerText(), new RegExp(run.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await page.getByRole('button', { name: 'Next', exact: true }).waitFor();
  await fits('Setup step 1 with a run');
  await shot('web-setup-week');

  // Leaving part way keeps the step in this tab.
  await page.reload();
  await page.getByRole('heading', { name: 'What does your usual week look like?', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 2: a goal event, with "build a block" for after setup.
  await page.getByRole('heading', { name: 'Working toward something?', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Yes, add an event', exact: true }).click();
  const eventDate = await page.evaluate(() => {
    const day = new Date(); day.setDate(day.getDate() + 70);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  });
  await page.getByLabel('Name', { exact: true }).fill('Turkey Trot 5k');
  await page.getByLabel('Date', { exact: true }).fill(eventDate);
  assert.equal(await page.getByRole('checkbox', { name: /^Build up to it with a training block/ }).isChecked(), true);
  await fits('Setup step 2');
  await shot('web-setup-goal');
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();

  // Step 3: where workouts come from. Apple Health points to the iPhone.
  await page.getByRole('heading', { name: 'Bring in your workouts', exact: true }).waitFor();
  state = await apiCall('GET', '/api/state');
  assert.equal(state.plan.race?.name, 'Turkey Trot 5k');
  assert.equal(state.plan.race?.date, eventDate);
  const intervals = page.getByRole('group', { name: 'intervals.icu', exact: true });
  await intervals.getByRole('button', { name: 'Connect intervals.icu', exact: true }).waitFor();
  assert.match(await page.getByRole('group', { name: 'Apple Health', exact: true }).innerText(), /iPhone only/);
  assert.match(await page.getByRole('group', { name: 'WHOOP', exact: true }).innerText(), /Not available right now/);
  assert.equal(await page.getByText(/Garmin/).count(), 0, 'Garmin stays hidden until it opens to members.');
  await fits('Setup step 3');
  await shot('web-setup-connect');
  // Without provider credentials, connecting says so and stays on the step.
  await intervals.getByRole('button', { name: 'Connect intervals.icu', exact: true }).click();
  await page.getByText('intervals.icu can’t be connected from the web right now.', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '#setup');

  // A provider's return lands back on the step, with its reason.
  await page.goto('about:blank');
  await page.goto(`${origin}/#settings/connections?provider=intervals&error=access_denied`);
  await page.getByText('You didn’t allow intervals.icu, so nothing was connected.', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Bring in your workouts', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '#setup', 'The provider’s answer leaves the address.');

  // Finish opens block setup for the event, with one line about the iPhone app.
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('heading', { name: 'What is this block for?', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '#block/start');
  const done = page.getByRole('status').filter({ hasText: 'You’re set up.' });
  await done.waitFor();
  assert.equal(await done.getByRole('link', { name: 'Get the iPhone app', exact: true }).getAttribute('href'), 'https://apps.apple.com/us/app/id6772375823');

  // Setup is done in this browser; the front door now opens the plan.
  await page.goto('about:blank');
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Your plan', exact: true }).waitFor();

  // Settings: Connections and AI coach.
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Connections', exact: true }).waitFor();
  await page.getByRole('group', { name: 'intervals.icu', exact: true }).getByRole('button', { name: 'Connect intervals.icu', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Show my Apple Health workouts to my group', exact: true }).waitFor();
  await fits('Settings → Connections');
  await shot('web-settings-connections');
  await page.getByRole('link', { name: 'AI coach', exact: true }).click();
  await page.getByRole('heading', { name: 'AI coach', exact: true }).waitFor();
  await page.getByText('No AI app has access.', { exact: true }).waitFor();
  const claude = await page.getByRole('link', { name: 'Connect Claude', exact: true }).getAttribute('href');
  assert.match(claude, /^https:\/\/claude\.ai\/customize\/connectors\?/);
  assert.equal(new URL(claude).searchParams.get('connectorUrl'), 'https://tres-fort.nmarkspdx.workers.dev/mcp');
  await fits('Settings → AI coach');
  await shot('web-settings-coach');

  // "Set up my week" brings setup back from the empty Plan page on request.
  await page.goto(`${origin}/#setup`);
  await page.getByRole('heading', { name: 'What does your usual week look like?', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Skip setup', exact: true }).click();
  await page.getByRole('heading', { name: 'Your plan', exact: true }).waitFor();
}
