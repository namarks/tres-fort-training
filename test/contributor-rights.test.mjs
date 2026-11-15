import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { acceptanceLine, CONTEXT, contributors, execute, githubAPI, REPOSITORY, termsVersion }
  from '../scripts/contributor-rights.mjs';

const MAIN = 'a'.repeat(40), HEAD = 'b'.repeat(40), OTHER = 'c'.repeat(40);
const TERMS = '# Synthetic terms\n\nVersion 1.1 · 2026-11-15\n\nSynthetic text.\n';
const ENV = {
  GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_NAME: 'pull_request_target',
  GITHUB_REF: 'refs/heads/main', GITHUB_SHA: MAIN,
  GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/contributor-rights.yml@refs/heads/main`,
  GITHUB_ACTOR: 'contributor', GITHUB_TRIGGERING_ACTOR: 'contributor', GITHUB_ACTOR_ID: '901',
  GITHUB_RUN_ID: '123',
};
const DISPATCH = {GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_ACTOR: 'namarks',
  GITHUB_TRIGGERING_ACTOR: 'namarks', GITHUB_ACTOR_ID: '5323089',
  INPUT_PR_NUMBER: '7', INPUT_HEAD_SHA: HEAD, INPUT_DECISION: 'approve', INPUT_CONFIRMATION: 'true'};
const EVENT = {repository: {full_name: REPOSITORY, default_branch: 'main', private: false},
  action: 'opened', number: 7};
const SAM = {id: 901, login: 'sam-example', type: 'User'};
const FORK_PR = {number: 7, state: 'open', merged: false, user: SAM, commits: 1,
  head: {sha: HEAD, repo: {full_name: 'sam-example/tres-fort-training'}},
  base: {ref: 'main', repo: {full_name: REPOSITORY}}};
const OWNER_PR = {...FORK_PR, number: 8, user: {id: 5323089, login: 'namarks', type: 'User'},
  head: {sha: OTHER, repo: {full_name: REPOSITORY}}};
const commit = (author, message = 'Synthetic commit') => ({sha: HEAD, author,
  commit: {author: {name: 'Synthetic', email: 'synthetic@example.test'}, message}});
const ACCEPT = {user: SAM, body: `Thanks!\n\n${acceptanceLine('1.1')}`,
  html_url: `https://github.com/${REPOSITORY}/pull/3#issuecomment-1`};

function fixture(options = {}) {
  const writes = [], reads = [];
  const prs = options.prs ?? [FORK_PR];
  const commits = options.commits ?? [commit(SAM)];
  // Comments sit on a pull request unless a test says otherwise.
  const comments = (options.comments ?? [])
    .map(c => ({html_url: `https://github.com/${REPOSITORY}/pull/3#issuecomment-1`, ...c}));
  const api = async (method, path, body) => {
    if (method === 'POST') { writes.push({path, body}); return {}; }
    reads.push(path);
    if (options.failComments && path.startsWith('/issues/comments')) throw new Error('GitHub unavailable');
    if (path === '/branches/main') return {commit: {sha: options.main ?? MAIN}};
    if (path === `/contents/CONTRIBUTOR-TERMS.md?ref=${options.main ?? MAIN}`) return {
      type: 'file', encoding: 'base64', size: TERMS.length,
      content: Buffer.from(options.terms ?? TERMS).toString('base64'),
    };
    let match = path.match(/^\/pulls\?state=open&base=main&per_page=100&page=(\d+)$/);
    // Like GitHub, the list response has no commit count; the detail does.
    if (match) return prs.slice((Number(match[1])-1)*100, Number(match[1])*100)
      .map(({commits: _count, ...listed}) => listed);
    match = path.match(/^\/pulls\/(\d+)$/);
    if (match) return prs.find(p => p.number === Number(match[1]));
    match = path.match(/^\/pulls\/\d+\/commits\?per_page=100&page=(\d+)$/);
    if (match) return commits.slice((Number(match[1])-1)*100, Number(match[1])*100);
    match = path.match(/^\/issues\/comments\?sort=created&direction=asc&per_page=100&page=(\d+)$/);
    if (match) return comments.slice((Number(match[1])-1)*100, Number(match[1])*100);
    match = path.match(/^\/commits\/([a-f0-9]{40})\/statuses\?per_page=100&page=(\d+)$/);
    if (match) {
      if (options.failStatuses?.has(match[1])) throw new Error('GitHub unavailable');
      return (options.statuses?.[match[1]] ?? []).slice((Number(match[2])-1)*100, Number(match[2])*100);
    }
    throw new Error(`Unexpected API request ${method} ${path}`);
  };
  const run = (env = {}, event = {}) => execute({env: {...ENV, ...env}, event: {...EVENT, ...event}, api});
  const states = () => writes.map(w => [w.path.slice('/statuses/'.length), w.body.state]);
  return {run, writes, reads, states};
}

test('the terms version comes from the version line', () => {
  assert.equal(termsVersion(TERMS), '1.1');
  assert.throws(() => termsVersion('No version here'));
});

test('a PR from a branch in this repository passes without any acceptance', async () => {
  const f = fixture({prs: [OWNER_PR]});
  await f.run({}, {number: 8});
  assert.deepEqual(f.states(), [[OTHER, 'success']]);
  assert.equal(f.writes[0].body.context, CONTEXT);
  assert.ok(!f.reads.some(p => p.includes('/commits?') || p.includes('/issues/comments')));
});

test('a fork PR waits until its author comments the acceptance line', async () => {
  const waiting = fixture();
  await waiting.run();
  assert.deepEqual(waiting.states(), [[HEAD, 'pending']]);
  assert.match(waiting.writes[0].body.description, /@sam-example/);
  assert.match(waiting.writes[0].body.target_url, /CONTRIBUTOR-ACCEPTANCE\.md$/);
  assert.ok(waiting.writes[0].body.description.length <= 140);

  const accepted = fixture({comments: [ACCEPT]});
  await accepted.run({GITHUB_EVENT_NAME: 'issue_comment'},
    {action: 'created', issue: {number: 7, pull_request: {}}});
  assert.deepEqual(accepted.states(), [[HEAD, 'success']]);
});

test('acceptance matches with or without the accent and ignores case and spacing', async () => {
  const body = 'i accept the  TRES FORT contributor terms\nversion 1.1.';
  const f = fixture({comments: [{user: SAM, body}]});
  await f.run();
  assert.deepEqual(f.states(), [[HEAD, 'success']]);
});

test('an acceptance of an older version or by someone else does not count', async () => {
  for (const comments of [
    [{user: SAM, body: acceptanceLine('1.0')}],
    [{user: {id: 77, login: 'someone-else', type: 'User'}, body: acceptanceLine('1.1')}],
    [{user: {...SAM, type: 'Bot'}, body: acceptanceLine('1.1')}],
  ]) {
    const f = fixture({comments});
    await f.run();
    assert.deepEqual(f.states(), [[HEAD, 'pending']]);
  }
});

test('every commit author and GitHub co-author must accept too', async () => {
  const alex = {id: 902, login: 'alex-example', type: 'User'};
  const coauthor = 'Synthetic\n\nCo-authored-by: Kim <903+kim-example@users.noreply.github.com>';
  const f = fixture({commits: [commit(alex, coauthor)], comments: [ACCEPT,
    {user: alex, body: acceptanceLine('1.1')}]});
  await f.run();
  assert.deepEqual(f.states(), [[HEAD, 'pending']]);
  assert.match(f.writes[0].body.description, /@kim-example/);
  assert.doesNotMatch(f.writes[0].body.description, /alex-example|sam-example/);

  const all = fixture({commits: [commit(alex, coauthor)], comments: [ACCEPT,
    {user: alex, body: acceptanceLine('1.1')},
    {user: {id: 903, login: 'kim-example', type: 'User'}, body: acceptanceLine('1.1')}]});
  await all.run();
  assert.deepEqual(all.states(), [[HEAD, 'success']]);
});

test('unlinked authors, bots and plain-email co-authors need the owner', async () => {
  for (const commits of [
    [commit(null)],
    [commit({id: 49699333, login: 'dependabot[bot]', type: 'Bot'})],
    [commit(SAM, 'Synthetic\n\nCo-authored-by: Kim <kim@example.test>')],
  ]) {
    const f = fixture({commits, comments: [ACCEPT]});
    await f.run();
    assert.deepEqual(f.states(), [[HEAD, 'pending']]);
    assert.match(f.writes[0].body.description, /^Owner review needed/);
    assert.doesNotMatch(f.writes[0].body.description, /example\.test/);
  }
});

test('missing or oversized commit lists need the owner', async () => {
  for (const options of [{commits: []}, {prs: [{...FORK_PR, commits: 251}]},
    {commits: [{...commit(SAM), sha: OTHER}]}]) {
    const f = fixture({comments: [ACCEPT], ...options});
    await f.run();
    assert.deepEqual(f.states(), [[HEAD, 'pending']]);
  }
});

test('every run re-checks all open PRs across pages', async () => {
  const prs = Array.from({length: 101}, (_, i) => ({...OWNER_PR, number: i + 1,
    head: {sha: i.toString(16).padStart(40, '0'), repo: {full_name: REPOSITORY}}}));
  const f = fixture({prs});
  const result = await f.run({GITHUB_EVENT_NAME: 'push'}, {ref: 'refs/heads/main'});
  assert.equal(result.results.length, 101);
  assert.ok(f.writes.every(w => w.body.state === 'success'));
  assert.ok(f.reads.some(p => p.endsWith('page=2')));
});

test('PRs sharing one head pass only if every one of them passes', async () => {
  const twin = {...FORK_PR, number: 9, user: {id: 77, login: 'someone-else', type: 'User'}};
  const f = fixture({prs: [FORK_PR, twin], comments: [ACCEPT]});
  await f.run();
  assert.deepEqual(f.states(), [[HEAD, 'pending']]);
  assert.match(f.writes[0].body.description, /@someone-else/);
});

test('the owner can approve or revoke one exact head, and it sticks for that terms version', async () => {
  const f = fixture({commits: [commit(null)]});
  const result = await f.run(DISPATCH);
  assert.equal(result.mode, 'approve');
  assert.deepEqual(f.states(), [[HEAD, 'success']]);
  const approved = f.writes[0].body;

  const later = fixture({commits: [commit(null)], statuses: {[HEAD]: [{context: CONTEXT, ...approved}]}});
  await later.run();
  assert.deepEqual(later.states(), [[HEAD, 'success']]);

  const newTerms = fixture({commits: [commit(null)], terms: TERMS.replace('1.1', '1.2'),
    statuses: {[HEAD]: [{context: CONTEXT, ...approved}]}});
  await newTerms.run();
  assert.deepEqual(newTerms.states(), [[HEAD, 'pending']]);

  const revoke = fixture({comments: [ACCEPT]});
  await revoke.run({...DISPATCH, INPUT_DECISION: 'revoke'});
  const revoked = revoke.writes[0].body;
  assert.equal(revoked.state, 'failure');
  const after = fixture({comments: [ACCEPT], statuses: {[HEAD]: [{context: CONTEXT, ...revoked}]}});
  await after.run();
  assert.deepEqual(after.states(), [[HEAD, 'failure']]);
});

test('a re-run from an older main decides under the current terms', async () => {
  const f = fixture({comments: [ACCEPT], terms: TERMS.replace('1.1', '1.2')});
  await f.run({GITHUB_SHA: 'd'.repeat(40)});
  assert.deepEqual(f.states(), [[HEAD, 'pending']]);
  assert.ok(f.reads.includes(`/contents/CONTRIBUTOR-TERMS.md?ref=${MAIN}`));
});

test('the sentence must stand on its own line', async () => {
  for (const body of [`I refuse to say "${acceptanceLine('1.1')}"`, `> ${acceptanceLine('1.1')}`,
    `Do I post ${acceptanceLine('1.1')}?`]) {
    const f = fixture({comments: [{...ACCEPT, body}]});
    await f.run();
    assert.deepEqual(f.states(), [[HEAD, 'pending']], body);
  }
  const entity = fixture({comments: [{...ACCEPT, body: `${acceptanceLine('1.1')}\nOn behalf of Example Co.`}]});
  await entity.run();
  assert.deepEqual(entity.states(), [[HEAD, 'success']]);
});

test('an owner decision is found past a full page of other contexts', async () => {
  const others = Array.from({length: 100}, (_, i) => ({context: `ci ${i}`, state: 'success'}));
  const revoked = {context: CONTEXT, state: 'failure', description: 'Owner revoked this head under terms 1.1. PR #7.'};
  const f = fixture({comments: [ACCEPT], statuses: {[HEAD]: [...others, revoked]}});
  await f.run();
  assert.deepEqual(f.states(), [[HEAD, 'failure']]);
});

test('an owner block survives an interrupted check and later automatic runs', async () => {
  const revoked = {context: CONTEXT, state: 'failure', description: 'Owner revoked this head under terms 1.1. PR #7.'};
  const interrupted = fixture({comments: [ACCEPT], failStatuses: new Set([HEAD])});
  await assert.rejects(interrupted.run());
  const pending = {context: CONTEXT, ...interrupted.writes[0].body};
  const auto = {context: CONTEXT, state: 'pending', description: 'Waiting for @sam-example.'};
  const later = fixture({comments: [ACCEPT], statuses: {[HEAD]: [pending, auto, revoked]}});
  await later.run();
  assert.deepEqual(later.states(), [[HEAD, 'failure']]);
});

test('a check that cannot finish withdraws an earlier pass', async () => {
  const passed = {context: CONTEXT, state: 'success', description: 'All contributors accepted terms 1.0.'};
  const f = fixture({failComments: true, statuses: {[HEAD]: [passed]}});
  await assert.rejects(f.run(), /GitHub unavailable/);
  assert.deepEqual(f.states(), [[HEAD, 'pending']]);
});

test('an acceptance posted on an ordinary issue does not count', async () => {
  const f = fixture({comments: [{...ACCEPT, html_url: `https://github.com/${REPOSITORY}/issues/4#issuecomment-2`}]});
  await f.run();
  assert.deepEqual(f.states(), [[HEAD, 'pending']]);
});

test('a manual decision also re-checks the other open heads', async () => {
  const f = fixture({prs: [FORK_PR, OWNER_PR], commits: [commit(null)]});
  const result = await f.run(DISPATCH);
  assert.equal(result.mode, 'approve');
  assert.deepEqual(f.states(), [[HEAD, 'success'], [OTHER, 'success']]);
  assert.match(f.writes[1].body.description, /^Owner branch/);
});

test('only the owner on current main can dispatch, with exact inputs', async () => {
  for (const env of [
    {GITHUB_ACTOR: 'contributor'}, {GITHUB_TRIGGERING_ACTOR: 'contributor'}, {GITHUB_ACTOR_ID: '123'},
    {INPUT_PR_NUMBER: '7; echo bad'}, {INPUT_PR_NUMBER: '0'}, {INPUT_HEAD_SHA: 'main'},
    {INPUT_HEAD_SHA: OTHER}, {INPUT_DECISION: 'pass'}, {INPUT_CONFIRMATION: 'false'},
  ]) {
    const f = fixture();
    await assert.rejects(f.run({...DISPATCH, ...env}));
    assert.equal(f.writes.length, 0, JSON.stringify(env));
  }
  const stale = fixture({main: OTHER});
  await assert.rejects(stale.run(DISPATCH), /Main changed/);
  assert.equal(stale.writes.length, 0);
});

test('another repository, branch, workflow or event cannot use the script', async () => {
  for (const [env, event] of [
    [{GITHUB_REPOSITORY: 'someone/example'}, {}],
    [{GITHUB_REF: 'refs/heads/untrusted'}, {}],
    [{GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/contributor-rights.yml@refs/heads/untrusted`}, {}],
    [{GITHUB_EVENT_NAME: 'pull_request'}, {}],
    [{GITHUB_SHA: 'main'}, {}],
    [{}, {repository: {full_name: 'someone/example', default_branch: 'main'}}],
    [{}, {repository: {full_name: REPOSITORY, default_branch: 'other'}}],
    [{GITHUB_EVENT_NAME: 'issue_comment'}, {action: 'created', issue: {number: 7}}],
  ]) {
    const f = fixture();
    await assert.rejects(f.run(env, event));
    assert.equal(f.writes.length, 0, JSON.stringify(env));
  }
});

test('contributors reads ids from GitHub accounts and noreply addresses only', () => {
  const found = contributors(FORK_PR, [commit(SAM,
    'x\n\nCo-authored-by: A <12+a-user@users.noreply.github.com>\nCo-authored-by: B <b@example.test>')]);
  assert.deepEqual([...found.people], [[901, 'sam-example'], [12, 'a-user']]);
  assert.equal(found.unresolved.length, 1);
});

test('API token never follows redirects or appears in request URLs/errors', async () => {
  const requests = [];
  const api = githubAPI('synthetic-token', async (url, options) => {
    requests.push({url, options}); return {ok: false, status: 403, json: () => ({})};
  });
  await assert.rejects(api('GET', '/branches/main'), /GitHub metadata request failed \(403\)/);
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic-token');
  assert.equal(requests[0].url, `https://api.github.com/repos/${REPOSITORY}/branches/main`);
});

test('privileged workflow only checks out trusted main and never executes PR content', () => {
  const workflow = readFileSync(new URL('../.github/workflows/contributor-rights.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /contains\(github\.event\.comment\.body, 'Contributor'\)\s+&& contains\(github\.event\.comment\.body, 'Terms'\)/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /!github\.event\.repository\.private/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /\n  group: contributor-rights\n  cancel-in-progress: false\n/);
  assert.match(workflow, /statuses: write/);
  assert.doesNotMatch(workflow, /pull_request\.head|comment\.body \}\}|npm (ci|install|test)|secrets\.|write-all|issues: write|pull-requests: write|contents: write/);
  assert.equal((workflow.match(/run:/g) || []).length, 1);
  assert.match(workflow, /run: node scripts\/contributor-rights\.mjs/);
  for (const [, action] of workflow.matchAll(/^\s*- uses: (\S+)/gm)) assert.match(action, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
});
