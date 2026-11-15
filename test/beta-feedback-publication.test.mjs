import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mirrorFeedback } from '../scripts/beta-feedback-to-issues.mjs';

const repo = 'example/private-feedback';
const privateMetadata = { full_name: repo, visibility: 'private', private: true };
const enabled = { FEEDBACK_FILE_ISSUES: '1', REPO: repo };
const root = fileURLToPath(new URL('../', import.meta.url));
const feedback = [{
  kind: 'screenshot',
  sub: { id: 'synthetic-submission', attributes: {
    comment: 'Synthetic private health detail', email: 'tester@example.invalid',
    screenshots: [{ url: 'https://example.invalid/private-screenshot' }],
  } },
  build: '1', tester: 'Synthetic Tester',
  summary: { id: 'synthetic-submission', kind: 'screenshot', createdDate: '2026-11-14T00:00:00Z' },
}];

function fixture({ metadata = privateMetadata, ghResult, collect } = {}) {
  const calls = [], logs = [], payloads = [];
  const deps = {
    env: enabled,
    log: line => logs.push(line),
    tokenForAsc: () => { calls.push(['provider-token']); return 'synthetic-token'; },
    find: async () => { calls.push(['provider-app']); return { id: 'synthetic-app' }; },
    collect: async () => { calls.push(['provider-feedback']); return collect ? collect() : feedback; },
    runGh(args) {
      calls.push(args);
      if (ghResult) {
        const result = ghResult(args);
        if (result !== undefined) return result;
      }
      if (args[0] === 'api' && args[1] === `repos/${repo}`) return JSON.stringify(metadata);
      if (args.includes('--paginate')) return '';
      if (args[0] === 'issue') {
        const path = args[args.indexOf('--body-file') + 1];
        payloads.push({ path, body: readFileSync(path, 'utf8'), mode: statSync(path).mode & 0o777 });
        return 'https://github.com/example/private-feedback/issues/1';
      }
      return '';
    },
  };
  return { deps, calls, logs, payloads };
}

const mutations = calls => calls.filter(c => c[0] === 'issue' || c[0] === 'label');
const providerCalls = calls => calls.filter(c => c[0].startsWith('provider-'));

test('mirroring requires explicit opt-in and an explicit owner/repository', async () => {
  for (const env of [{}, { REPO: repo }, { FEEDBACK_FILE_ISSUES: 'true', REPO: repo },
    { FEEDBACK_FILE_ISSUES: '1' }, { ...enabled, REPO: 'owner/repo?visibility=private' }]) {
    const f = fixture();
    await assert.rejects(mirrorFeedback({ ...f.deps, env }), /disabled|explicitly/);
    assert.deepEqual(f.calls, []);
  }
});

test('public, internal, missing, inconsistent and redirected destinations refuse before ASC access, also for dry-run', async () => {
  for (const metadata of [
    { ...privateMetadata, visibility: 'public', private: false },
    { ...privateMetadata, visibility: 'internal' },
    { ...privateMetadata, private: false },
    { ...privateMetadata, private: 'true' },
    { ...privateMetadata, full_name: 'example/different-repository' },
    {}, null,
  ]) {
    for (const dryRun of [false, true]) {
      const f = fixture({ metadata });
      await assert.rejects(mirrorFeedback({ ...f.deps, dryRun }), /verified private repository/);
      assert.equal(f.calls.length, 1);
      assert.deepEqual(providerCalls(f.calls), []);
      assert.deepEqual(mutations(f.calls), []);
      assert.deepEqual(f.logs, []);
    }
  }
});

test('unreadable visibility fails closed without echoing response/error contents', async () => {
  for (const ghResult of [() => '{private feedback garbage', () => { throw Error('private feedback failure'); }]) {
    const f = fixture({ ghResult });
    await assert.rejects(mirrorFeedback(f.deps), error => {
      assert.match(error.message, /Cannot verify/);
      assert.doesNotMatch(error.message, /private feedback/);
      return true;
    });
    assert.deepEqual(providerCalls(f.calls), []);
    assert.deepEqual(mutations(f.calls), []);
  }
});

test('an explicitly verified private destination retains issue content and cleans protected temporary payloads', async () => {
  const f = fixture();
  await mirrorFeedback(f.deps);
  assert.equal(f.calls[0][1], `repos/${repo}`);
  assert.equal(mutations(f.calls).filter(c => c[0] === 'issue').length, 1);
  assert.equal(f.payloads.length, 1);
  assert.match(f.payloads[0].body, /Synthetic private health detail/);
  assert.match(f.payloads[0].body, /Synthetic Tester/);
  assert.match(f.payloads[0].body, /private-screenshot/);
  assert.equal(f.payloads[0].mode, 0o600);
  assert.equal(existsSync(dirname(f.payloads[0].path)), false);
  assert.doesNotMatch(f.logs.join('\n'), /Synthetic|example\.invalid|private-screenshot/);
});

test('a private dry-run emits counts, never raw feedback or writes', async () => {
  const f = fixture();
  await mirrorFeedback({ ...f.deps, dryRun: true });
  assert.deepEqual(mutations(f.calls), []);
  assert.match(f.logs.join('\n'), /\[dry-run\] 1 new/);
  assert.doesNotMatch(f.logs.join('\n'), /Synthetic|example\.invalid|private-screenshot/);
});

test('visibility changing during the provider request aborts before any GitHub mutation', async () => {
  let metadata = privateMetadata;
  const f = fixture({
    ghResult: args => args[1] === `repos/${repo}` ? JSON.stringify(metadata) : undefined,
    collect: () => { metadata = { ...privateMetadata, private: false, visibility: 'public' }; return feedback; },
  });
  await assert.rejects(mirrorFeedback(f.deps), /verified private repository/);
  assert.deepEqual(mutations(f.calls), []);
  assert.deepEqual(f.logs, []);
});

test('visibility is rechecked immediately before an issue write', async () => {
  let metadata = privateMetadata;
  const f = fixture({ ghResult: args => {
    if (args[1] === `repos/${repo}`) return JSON.stringify(metadata);
    if (args[0] === 'label' && args[2] === 'crash') metadata = { ...privateMetadata, visibility: 'public', private: false };
  } });
  await assert.rejects(mirrorFeedback(f.deps), /verified private repository/);
  assert.equal(f.calls.filter(c => c[0] === 'issue').length, 0);
  assert.deepEqual(f.logs, []);
});

test('failed issue creation still removes its temporary payload', async () => {
  let payloadPath;
  const f = fixture({ ghResult: args => {
    if (args[0] === 'issue') {
      payloadPath = args[args.indexOf('--body-file') + 1];
      assert.equal(existsSync(payloadPath), true);
      throw Error('synthetic issue write failure');
    }
  } });
  await assert.rejects(mirrorFeedback(f.deps), /synthetic issue write failure/);
  assert.equal(existsSync(dirname(payloadPath)), false);
});

test('scheduled sync saves privately by default and invokes the mirror only on explicit opt-in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-sync-test-'));
  try {
    const callsPath = join(dir, 'calls');
    writeFileSync(join(dir, 'node'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FEEDBACK_TEST_CALLS"\nprintf "synthetic raw report\\n"\n', { mode: 0o700 });
    for (const optedIn of [false, true]) {
      const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, FEEDBACK_TEST_CALLS: callsPath };
      delete env.FEEDBACK_FILE_ISSUES;
      delete env.REPO;
      if (optedIn) Object.assign(env, enabled);
      writeFileSync(callsPath, '');
      const result = spawnSync('bash', ['scripts/testflight-feedback-sync.sh'], { cwd: root, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const calls = readFileSync(callsPath, 'utf8').trim().split('\n');
      assert.equal(calls[0], 'scripts/testflight-feedback.mjs --days 30 --save');
      assert.equal(calls.length, optedIn ? 2 : 1);
      if (optedIn) assert.equal(calls[1], 'scripts/beta-feedback-to-issues.mjs');
      else assert.doesNotMatch(result.stdout, /synthetic raw report/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the real CLI refuses a public dry-run before attempting Apple authentication', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-cli-test-'));
  try {
    writeFileSync(join(dir, 'gh'), '#!/bin/sh\nprintf \'{"full_name":"example/private-feedback","visibility":"public","private":false}\\n\'\n', { mode: 0o700 });
    const result = spawnSync(process.execPath, ['scripts/beta-feedback-to-issues.mjs', '--dry-run'], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, ...enabled, PATH: `${dir}:${process.env.PATH}`, ASC_PRIVATE_KEY: 'invalid synthetic key' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /verified private repository/);
    assert.doesNotMatch(result.stderr, /ASC API key|DECODER|synthetic key/);
    assert.equal(result.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI help and unknown arguments cannot contact providers or publish even with mirroring enabled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-arguments-test-'));
  try {
    const marker = join(dir, 'gh-was-called');
    writeFileSync(join(dir, 'gh'), '#!/bin/sh\nprintf "called" > "$FEEDBACK_TEST_CALLS"\nexit 1\n', { mode: 0o700 });
    const cases = [
      { args: ['--help'], status: 0 },
      { args: ['--help', '--dry-run'], status: 0 },
      { args: ['--dryrun'], status: 1 },
      { args: ['--help', '--force'], status: 1 },
      { args: ['--dry-run', 'unexpected-positional-argument'], status: 1 },
      { args: ['--dry-run=true'], status: 1 },
    ];
    for (const { args, status } of cases) {
      const result = spawnSync(process.execPath, ['scripts/beta-feedback-to-issues.mjs', ...args], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, ...enabled, PATH: `${dir}:${process.env.PATH}`,
          ASC_PRIVATE_KEY: 'invalid synthetic key', FEEDBACK_TEST_CALLS: marker },
      });
      assert.equal(result.status, status, `${args}: ${result.stderr}`);
      assert.equal(existsSync(marker), false, `${args} contacted GitHub`);
      assert.doesNotMatch(result.stderr, /ASC API key|DECODER|synthetic key/);
      if (status === 0) {
        assert.match(result.stdout, /Usage: FEEDBACK_FILE_ISSUES=1 REPO=owner\/private-repo/);
        assert.equal(result.stderr, '');
      } else {
        assert.match(result.stderr, /Unknown argument/);
        assert.equal(result.stdout, '');
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
