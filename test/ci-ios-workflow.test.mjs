import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parseDocument } from 'yaml';

// Workflow and selection-policy edits use targeted coverage contracts plus
// smoke. Intentional contract changes also require independent review.
const source = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
function parseWorkflow(text) {
  const document = parseDocument(text, { uniqueKeys: true });
  assert.deepEqual(document.errors, [], 'workflow must parse without ambiguous keys');
  return document.toJS();
}
const workflow = parseWorkflow(source);
const packageScripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
const verify = 'npm run ios:verify -- --runtime com.apple.CoreSimulator.SimRuntime.iOS-26-2';
const nativeSteps = {
  'Unsigned simulator build and tests': {
    if: "matrix.shard != 'station' && matrix.shard != 'app-store-iphone' && matrix.shard != 'app-store-ipad'",
    run: verify + ' --device com.apple.CoreSimulator.SimDeviceType.iPhone-17 --ui-suite "$IOS_UI_SUITE" --ci-shard ${{ matrix.shard }}',
  },
  'iPhone App Store build and tests': {
    if: "matrix.shard == 'app-store-iphone'",
    env: { APP_STORE_BUILD: '1' },
    run: verify + ' --device com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro --only-testing-file .github/ios-tests/app-store-iphone.txt',
  },
  'iPad App Store build and tests': {
    if: "matrix.shard == 'app-store-ipad'",
    env: { APP_STORE_BUILD: '1' },
    run: verify + ' --device com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M4-8GB --only-testing-file .github/ios-tests/app-store-ipad.txt',
  },
  'iPad Station build and tests': {
    if: "matrix.shard == 'station'",
    run: verify + ' --device com.apple.CoreSimulator.SimDeviceType.iPad-A16 --only-testing-file .github/ios-tests/station.txt',
  },
  // The Watch targets are in no other build: the unit-test job builds them.
  'Apple Watch app build': {
    if: 'matrix.shard == 1',
    run: 'npm run ios:verify-watch',
  },
  'Verify App Store packaging without downloads': {
    if: "matrix.shard == 'app-store-iphone'",
    run: 'python3 test/app-store-packaging.test.py',
  },
};
const runnerScript = `runner=none
if [ "$PRIVATE" = false ]; then
  runner='"macos-15"'
fi
echo "runner=$runner" >> "$GITHUB_OUTPUT"
echo "iOS runner: $runner"`;
const iosGateScript = `test "$SCOPE_RESULT" = success
case "$SUITE" in
  skip) test "$RESULT" = skipped ;;
  smoke|full)
    if [ "$RUNNER" = none ]; then
      echo '::error::Required iOS coverage is unavailable while the repository is private. This workflow never uses self-hosted runners or starts private hosted macOS jobs.'
      exit 1
    fi
    test "$RESULT" = success ;;
  *) exit 1 ;;
esac`;
const backendGateScript = `test "$SCOPE_RESULT" = success
case "$BACKEND" in
  skip) test "$RESULT" = skipped ;;
  run) test "$RESULT" = success ;;
  *) exit 1 ;;
esac`;

function step(job, name) {
  const found = job.steps.filter(value => value.name === name);
  assert.equal(found.length, 1, `exactly one ${name} step must exist`);
  return found[0];
}

function blocking(value) {
  assert.ok(value['continue-on-error'] === undefined || value['continue-on-error'] === false,
    'verification must fail its job');
  assert.ok(value.shell === undefined || value.shell === 'bash', 'verification uses a fail-fast Bash shell');
  assert.equal(value['working-directory'], undefined, 'verification runs from the checkout root');
  assert.equal(value.uses, undefined, 'verification executes the inspected run command');
}

function command(job, name, expected) {
  const actual = step(job, name);
  blocking(actual);
  assert.equal(actual.if, expected.if, `${name}: execution condition`);
  assert.deepEqual(actual.env, expected.env, `${name}: environment`);
  assert.equal(actual.run.trim(), expected.run, `${name}: complete command`);
  return actual;
}

function shell(script, env = {}) {
  const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', script], {
    encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...env },
  });
  assert.equal(result.error, undefined);
  return result;
}

const requiredChecks = [
  'python3 test/verify-ios.test.py',
  'python3 -B test/verify-watch.test.py',
  'python3 -B test/ci-ios-scope.test.py',
  'python3 -B test/ci-ios-setup.test.py',
  'node --test test/ci-ios-workflow.test.mjs',
];

function verificationCommands(script) {
  // Exercise the actual shell program with synthetic commands: a commented,
  // conditional or ignored contract invocation must not satisfy this guard.
  const folder = mkdtempSync(join(tmpdir(), 'tres-fort-ci-contract-'));
  try {
    const calls = join(folder, 'calls');
    for (const executable of ['python3', 'node', 'ruby']) {
      writeFileSync(join(folder, executable), '#!/bin/bash\n' +
        `invocation='${executable}'\n` +
        'for argument in "$@"; do invocation="$invocation $argument"; done\n' +
        'printf "%s\\n" "$invocation" >> "$CALLS"\n' +
        'if [ "$invocation" = "$FAIL_COMMAND" ]; then exit 7; fi\n', { mode: 0o755 });
    }
    for (const failCommand of ['', ...requiredChecks]) {
      writeFileSync(calls, '');
      const result = shell(script, {
        PATH: `${folder}:/usr/bin:/bin`, CALLS: calls, FAIL_COMMAND: failCommand,
      });
      if (failCommand) {
        assert.notEqual(result.status, 0, `${failCommand} failure must fail the verification step`);
      } else {
        assert.equal(result.status, 0, result.stderr);
        const invoked = readFileSync(calls, 'utf8').trim().split('\n');
        for (const check of requiredChecks) assert.equal(invoked.filter(value => value === check).length, 1, check);
      }
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function validateCoverage(value, scripts = packageScripts) {
  assert.equal(scripts['ios:verify'], 'bash scripts/verify-ios.sh', 'native commands use the inspected verifier');
  assert.equal(scripts['ios:verify-watch'], 'bash scripts/verify-watch.sh', 'the Watch build uses the inspected script');
  // Global/job defaults must not silently change critical steps' shell or cwd.
  for (const defaults of [value.defaults, ...Object.values(value.jobs).map(job => job.defaults)]) {
    assert.ok(defaults === undefined ||
      (Object.keys(defaults).length === 1 && defaults.run?.shell === 'bash' &&
       Object.keys(defaults.run).length === 1), 'only a standard Bash default is supported');
  }
  assert.equal(value.env?.APP_STORE_BUILD, undefined);
  assert.ok(Object.hasOwn(value.on, 'workflow_dispatch'));
  assert.ok(value.on.schedule.length > 0);
  for (const schedule of value.on.schedule) assert.match(schedule.cron, /^\S+ \S+ \* \* \*$/);
  assert.deepEqual(value.on.pull_request.branches, ['main']);
  assert.deepEqual(value.on.push.branches, ['main']);

  for (const job of Object.values(value.jobs)) {
    const names = job.steps.filter(value => value.name).map(value => value.name);
    assert.equal(new Set(names).size, names.length, 'step names must be unique within a job');
  }

  const { plans, 'ios-tests': iosTests, ios, 'backend-tests': backendTests, backend } = value.jobs;
  for (const job of [plans, iosTests, ios, backendTests, backend]) blocking(job);
  for (const job of [plans, iosTests, backendTests]) {
    const checkouts = job.steps.filter(value => value.uses?.startsWith('actions/checkout@'));
    assert.equal(checkouts.length, 1, 'one checkout supplies the tested commit');
    const checkout = checkouts[0];
    assert.equal(checkout.if, undefined);
    assert.ok(checkout['continue-on-error'] === undefined || checkout['continue-on-error'] === false);
    for (const input of ['ref', 'repository', 'path']) assert.equal(checkout.with[input], undefined,
      `checkout ${input} must use the triggering commit at the checkout root`);
    if (job === plans) assert.equal(checkout.with['fetch-depth'], 0, 'scope needs complete Git evidence');
    const commands = job === plans ? ['Select iOS coverage', 'Select iOS runner', 'Select backend tests'] :
      job === iosTests ? ['Select Xcode', ...Object.keys(nativeSteps)] :
        ['Verification command failure and cleanup checks', 'Typecheck', 'Test'];
    for (const name of commands) assert.ok(job.steps.indexOf(checkout) < job.steps.indexOf(step(job, name)),
      `checkout precedes ${name}`);
  }
  assert.equal(plans.if, "github.event.action != 'closed'");
  assert.deepEqual(plans.outputs, {
    'ios-suite': '${{ steps.ios-scope.outputs.suite }}',
    'ios-runner': '${{ steps.ios-runner.outputs.runner }}',
    backend: '${{ steps.backend-scope.outputs.backend }}',
  });
  assert.equal(command(plans, 'Select iOS coverage', {
    env: { EVENT: '${{ github.event_name }}', BEFORE: '${{ github.event.before }}' },
    run: 'suite="$(python3 scripts/ci-ios-scope.py --event "$EVENT" --before "$BEFORE")"\n' +
      'echo "suite=$suite" >> "$GITHUB_OUTPUT"\necho "iOS coverage: $suite"',
  }).id, 'ios-scope');
  assert.equal(command(plans, 'Select backend tests', {
    env: { EVENT: '${{ github.event_name }}', BEFORE: '${{ github.event.before }}' },
    run: 'backend="$(python3 scripts/ci-ios-scope.py --target backend --event "$EVENT" --before "$BEFORE")"\n' +
      'echo "backend=$backend" >> "$GITHUB_OUTPUT"\necho "Backend tests: $backend"',
  }).id, 'backend-scope');
  const runner = step(plans, 'Select iOS runner');
  blocking(runner);
  assert.equal(runner.id, 'ios-runner');
  assert.equal(runner.if, undefined);
  assert.deepEqual(runner.env, { PRIVATE: '${{ github.event.repository.private }}' });
  assert.equal(runner.run.trim(), runnerScript);

  assert.equal(iosTests.name, 'iOS');
  assert.equal(iosTests.needs, 'plans');
  assert.equal(iosTests.if, "needs.plans.outputs.ios-runner != 'none' && needs.plans.outputs.ios-suite != 'skip'");
  assert.equal(iosTests['runs-on'], '${{ fromJSON(needs.plans.outputs.ios-runner) }}');
  assert.equal(iosTests.strategy['fail-fast'], false);
  const matrix = /^\$\{\{ fromJSON\(needs\.plans\.outputs\.ios-suite == 'full' && '([^']+)' \|\| '([^']+)'\) \}\}$/.exec(iosTests.strategy.matrix);
  assert.ok(matrix, 'matrix must select full or smoke from the scope result');
  assert.deepEqual(JSON.parse(matrix[1]), { suite: ['full'], shard: [1, 2, 3, 4, 5, 6, 'station', 'app-store-iphone', 'app-store-ipad'] });
  assert.deepEqual(JSON.parse(matrix[2]), { suite: ['smoke'], shard: [1] });
  assert.equal(iosTests.env.IOS_UI_SUITE, '${{ needs.plans.outputs.ios-suite }}');
  assert.equal(iosTests.env.APP_STORE_BUILD, undefined);
  command(iosTests, 'Select Xcode', {
    run: 'echo "DEVELOPER_DIR=/Applications/Xcode_26.3.app/Contents/Developer" >> "$GITHUB_ENV"',
  });
  for (const [name, expected] of Object.entries(nativeSteps)) {
    command(iosTests, name, expected);
    assert.ok(iosTests.steps.indexOf(step(iosTests, 'Select Xcode')) < iosTests.steps.indexOf(step(iosTests, name)),
      `Select Xcode precedes ${name}`);
  }

  assert.equal(ios.name, 'iOS build + tests');
  assert.deepEqual(ios.needs, ['plans', 'ios-tests']);
  assert.equal(ios.if, "always() && github.event.action != 'closed'");
  const iosGate = step(ios, 'Require every iOS shard');
  blocking(iosGate);
  assert.equal(iosGate.if, undefined);
  assert.deepEqual(iosGate.env, {
    RESULT: '${{ needs.ios-tests.result }}', SCOPE_RESULT: '${{ needs.plans.result }}',
    SUITE: '${{ needs.plans.outputs.ios-suite }}', RUNNER: '${{ needs.plans.outputs.ios-runner }}',
  });
  assert.equal(iosGate.run.trim(), iosGateScript);

  assert.equal(backendTests.needs, 'plans');
  assert.equal(backendTests.if, "needs.plans.outputs.backend == 'run'");
  assert.deepEqual(backendTests.strategy.matrix, { shard: [1, 2, 3] });
  const checks = step(backendTests, 'Verification command failure and cleanup checks');
  blocking(checks);
  assert.equal(checks.if, undefined);
  assert.equal(checks.env, undefined);
  verificationCommands(checks.run);
  assert.equal(backend.name, 'typecheck + tests');
  assert.deepEqual(backend.needs, ['plans', 'backend-tests']);
  assert.equal(backend.if, "always() && github.event.action != 'closed'");
  const backendGate = step(backend, 'Require every backend shard');
  blocking(backendGate);
  assert.equal(backendGate.if, undefined);
  assert.deepEqual(backendGate.env, {
    RESULT: '${{ needs.backend-tests.result }}', SCOPE_RESULT: '${{ needs.plans.result }}',
    BACKEND: '${{ needs.plans.outputs.backend }}',
  });
  assert.equal(backendGate.run.trim(), backendGateScript);
}

test('workflow keeps full coverage and blocking contract checks while routine edits use smoke', () => {
  validateCoverage(workflow);
});

test('timeout, download and cache setup edits retain the coverage contract', () => {
  const changed = structuredClone(workflow);
  changed.jobs['ios-tests']['timeout-minutes'] = 100;
  step(changed.jobs['ios-tests'], 'Install pinned XcodeGen').run += '\necho "setup changed"\n';
  changed.jobs['ios-tests'].steps.find(value => value.uses?.startsWith('actions/cache@')).with.key = 'another-cache-key';
  validateCoverage(changed);
});

const brokenCoverage = [
  ['missing full shard', value => { value.jobs['ios-tests'].strategy.matrix = value.jobs['ios-tests'].strategy.matrix.replace('1, 2, 3, 4, 5, 6,', '1, 2, 3, 4, 5,'); }],
  ['skipped iPad job', value => { step(value.jobs['ios-tests'], 'iPad App Store build and tests').if = false; }],
  ['missing App Store flag', value => { delete step(value.jobs['ios-tests'], 'iPhone App Store build and tests').env; }],
  ['wrong Station device', value => { const target = step(value.jobs['ios-tests'], 'iPad Station build and tests'); target.run = target.run.replace('iPad-A16', 'iPhone-17'); }],
  ['wrong device list', value => { const target = step(value.jobs['ios-tests'], 'iPad App Store build and tests'); target.run = target.run.replace('app-store-ipad.txt', 'station.txt'); }],
  ['skipped Watch build', value => { step(value.jobs['ios-tests'], 'Apple Watch app build').if = "matrix.shard == 'watch'"; }],
  ['Watch build failure ignored', value => { step(value.jobs['ios-tests'], 'Apple Watch app build')['continue-on-error'] = true; }],
  ['narrowed native tests', value => { step(value.jobs['ios-tests'], 'Unsigned simulator build and tests').run += ' --only-testing TresFortTests/OneTest'; }],
  ['full suite forced to smoke', value => { value.jobs['ios-tests'].env.IOS_UI_SUITE = 'smoke'; }],
  ['native failure ignored', value => { step(value.jobs['ios-tests'], 'iPad Station build and tests')['continue-on-error'] = true; }],
  ['duplicate named step', value => { value.jobs['ios-tests'].steps.push(structuredClone(step(value.jobs['ios-tests'], 'iPad Station build and tests'))); }],
  ['aggregate drops native jobs', value => { value.jobs.ios.needs = ['plans']; }],
  ['checkout tests main instead of the PR', value => { value.jobs['ios-tests'].steps.find(value => value.uses?.startsWith('actions/checkout@')).with.ref = 'main'; }],
  ['checkout runs after native verification', value => { value.jobs['ios-tests'].steps.push(value.jobs['ios-tests'].steps.shift()); }],
  ['nightly-only aggregate bypass', value => { step(value.jobs.ios, 'Require every iOS shard').run = 'if [ "$GITHUB_EVENT_NAME" = schedule ]; then exit 0; fi\n' + iosGateScript; }],
  ['contract only appears in a comment', value => { const target = step(value.jobs['backend-tests'], 'Verification command failure and cleanup checks'); target.run = target.run.replace('node --test test/ci-ios-workflow.test.mjs', '# node --test test/ci-ios-workflow.test.mjs'); }],
  ['contract failure ignored', value => { const target = step(value.jobs['backend-tests'], 'Verification command failure and cleanup checks'); target.run = target.run.replace('node --test test/ci-ios-workflow.test.mjs', 'node --test test/ci-ios-workflow.test.mjs || true'); }],
];
for (const [name, mutate] of brokenCoverage) {
  test(`coverage contract rejects ${name}`, () => {
    const changed = structuredClone(workflow);
    mutate(changed);
    assert.throws(() => validateCoverage(changed));
  });
}

test('duplicate YAML keys cannot hide a second job definition', () => {
  assert.throws(() => parseWorkflow('jobs:\n  ios: {}\n  ios: {}\n'));
});

test('a package-script alias cannot replace native verification', () => {
  assert.throws(() => validateCoverage(workflow, { ...packageScripts, 'ios:verify': 'echo skipped' }));
  assert.throws(() => validateCoverage(workflow, { ...packageScripts, 'ios:verify-watch': 'echo skipped' }));
});

test('only public visibility selects the standard hosted Mac', () => {
  const folder = mkdtempSync(join(tmpdir(), 'tres-fort-ci-runner-'));
  try {
    const output = join(folder, 'output');
    for (const [privateValue, expected] of [['false', '"macos-15"'], ['true', 'none'], ['', 'none'], ['unknown', 'none']]) {
      writeFileSync(output, '');
      const result = shell(step(workflow.jobs.plans, 'Select iOS runner').run, {
        PRIVATE: privateValue, GITHUB_OUTPUT: output, PREFERENCE: 'self-hosted', ACTOR: 'namarks',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, 'utf8'), `runner=${expected}\n`);
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('aggregate commands reject failed, canceled or missing coverage', () => {
  const iosScript = step(workflow.jobs.ios, 'Require every iOS shard').run;
  for (const scope of ['success', 'failure']) {
    for (const suite of ['skip', 'smoke', 'full', 'unknown']) {
      for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
        for (const runner of ['none', '"macos-15"']) {
          const expected = scope === 'success' && (suite === 'skip' ? result === 'skipped' :
            ['smoke', 'full'].includes(suite) && runner !== 'none' && result === 'success');
          assert.equal(shell(iosScript, { SCOPE_RESULT: scope, SUITE: suite, RESULT: result, RUNNER: runner }).status === 0,
            expected, JSON.stringify({ scope, suite, result, runner }));
        }
      }
    }
  }
  const backendScript = step(workflow.jobs.backend, 'Require every backend shard').run;
  for (const scope of ['success', 'failure']) {
    for (const backend of ['skip', 'run', 'unknown']) {
      for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
        const expected = scope === 'success' && ((backend === 'skip' && result === 'skipped') ||
          (backend === 'run' && result === 'success'));
        assert.equal(shell(backendScript, { SCOPE_RESULT: scope, BACKEND: backend, RESULT: result }).status === 0,
          expected, JSON.stringify({ scope, backend, result }));
      }
    }
  }
});

test('actions are immutable and checkouts do not retain credentials', () => {
  let checkouts = 0;
  for (const job of Object.values(workflow.jobs)) {
    for (const value of job.steps) {
      if (!value.uses) continue;
      assert.match(value.uses, /^actions\/[a-z-]+@[0-9a-f]{40}$/);
      if (value.uses.startsWith('actions/checkout@')) {
        checkouts++;
        assert.equal(value.with['persist-credentials'], false);
      }
    }
  }
  assert.equal(checkouts, 3);
});
