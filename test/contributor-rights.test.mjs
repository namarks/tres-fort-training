import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { authorInventoryDigest, CONTEXT, digest, execute, githubAPI, REPOSITORY } from '../scripts/contributor-rights.mjs';

const MAIN = 'a'.repeat(40), HEAD = 'b'.repeat(40), OTHER = 'c'.repeat(40);
const TERMS = 'Synthetic operative contributor agreement version 1.\n';
const ENV = {
  GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main', GITHUB_SHA: MAIN,
  GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/contributor-rights.yml@refs/heads/main`,
  GITHUB_ACTOR: 'namarks', GITHUB_TRIGGERING_ACTOR: 'namarks', GITHUB_ACTOR_ID: '5323089',
  GITHUB_RUN_ID: '123', INPUT_PR_NUMBER: '7', INPUT_HEAD_SHA: HEAD,
  INPUT_TERMS_SHA256: digest(TERMS), INPUT_RECEIPT_SHA256: 'd'.repeat(64),
  INPUT_DECISION: 'approve', INPUT_CONFIRMATION: 'true',
};
const EVENT = {repository: {full_name: REPOSITORY, default_branch: 'main', private: false}};
const PR = {number: 7, state: 'open', merged: false, title: 'Synthetic change', body: 'Synthetic disclosures',
  commits: 1, head: {sha: HEAD, repo: {full_name: 'contributor/example'}},
  base: {ref: 'main', repo: {full_name: REPOSITORY}}};
const COMMITS = [{sha: HEAD, author: null, committer: {id: 22, login: 'synthetic'},
  commit: {author: {name: 'Synthetic author', email: 'author@example.test'},
    committer: {name: 'Synthetic committer', email: 'committer@example.test'},
    message: 'Synthetic commit\n\nCo-authored-by: Synthetic coauthor <coauthor@example.test>'}}];

function fixture(options = {}) {
  const writes = [], reads = [];
  let prRead = 0, mainRead = 0;
  const pr = {...PR, ...options.pr};
  const prs = options.prs ?? [pr];
  const commits = options.commits ?? COMMITS;
  const api = async (method, path, body) => {
    if (method === 'POST') { writes.push({path, body}); return {}; }
    reads.push(path);
    if (path === '/branches/main') return {commit: {sha: options.main?.(++mainRead) ?? MAIN}};
    if (path === '/pulls/7') return options.readPR?.(++prRead) ?? pr;
    if (path === `/contents/CONTRIBUTOR-TERMS.md?ref=${MAIN}`) return {
      type: 'file', encoding: 'base64', size: TERMS.length,
      content: Buffer.from(options.terms ?? TERMS).toString('base64'),
    };
    let match = path.match(/^\/pulls\?state=open&base=main&per_page=100&page=(\d+)$/);
    if (match) return prs.slice((Number(match[1])-1)*100, Number(match[1])*100);
    match = path.match(/^\/pulls\/7\/commits\?per_page=100&page=(\d+)$/);
    if (match) return commits.slice((Number(match[1])-1)*100, Number(match[1])*100);
    throw new Error(`Unexpected API request ${method} ${path}`);
  };
  const run = (env = {}, event = {}) => execute({env: {...ENV, ...env}, event: {...EVENT, ...event}, api});
  return {run, writes, reads};
}

test('owner attestation records only exact-head status and non-identifying digests', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.head, HEAD);
  assert.equal(result.termsHash, digest(TERMS));
  assert.equal(result.inventoryHash, authorInventoryDigest(COMMITS));
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[0].body.state, 'pending');
  assert.equal(f.writes[1].path, `/statuses/${HEAD}`);
  assert.equal(f.writes[1].body.context, CONTEXT);
  assert.equal(f.writes[1].body.state, 'success');
  assert.equal(f.writes[1].body.target_url, `https://github.com/${REPOSITORY}/actions/runs/123`);
  assert.doesNotMatch(JSON.stringify({result,writes:f.writes}), /example\.test|Synthetic author|Synthetic coauthor/);
  // Only main's agreement is loaded. A fork is metadata, never executable code.
  assert.deepEqual(f.reads.filter(p => p.includes('/contents/')), [`/contents/CONTRIBUTOR-TERMS.md?ref=${MAIN}`]);
});

test('unlinked GitHub authors and new coauthor trailers remain distinct evidence', () => {
  assert.notEqual(authorInventoryDigest(COMMITS), authorInventoryDigest([{...COMMITS[0], author: {login: 'namarks'}}]));
  const changed = structuredClone(COMMITS);
  changed[0].commit.message += '\nCo-authored-by: Another Person <another@example.test>';
  assert.notEqual(authorInventoryDigest(COMMITS), authorInventoryDigest(changed));
});

test('approval identity, ref and input checks never grant clearance', async () => {
  for (const env of [
    {GITHUB_ACTOR: 'contributor'}, {GITHUB_TRIGGERING_ACTOR: 'contributor'},
    {GITHUB_ACTOR_ID: '123'}, {GITHUB_REPOSITORY: 'someone/example'},
    {GITHUB_REF: 'refs/heads/untrusted'}, {GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/contributor-rights.yml@refs/heads/untrusted`},
    {GITHUB_EVENT_NAME: 'pull_request'}, {GITHUB_SHA: 'main'},
    {INPUT_PR_NUMBER: '7; echo bad'}, {INPUT_PR_NUMBER: '0'},
    {INPUT_HEAD_SHA: 'main'}, {INPUT_TERMS_SHA256: 'draft'},
    {INPUT_RECEIPT_SHA256: ''}, {INPUT_DECISION: 'pass'}, {INPUT_CONFIRMATION: 'false'},
  ]) {
    const f = fixture();
    await assert.rejects(f.run(env));
    assert.ok(f.writes.every(w=>w.body.state==='pending'), JSON.stringify(env));
    if (!Object.keys(env).some(k=>k.startsWith('INPUT_'))) assert.equal(f.writes.length,0);
  }
});

test('another repository or default branch cannot reuse the workflow', async () => {
  for (const repository of [{full_name: 'someone/example', default_branch:'main'},
    {full_name:REPOSITORY,default_branch:'other'}]) {
    const f = fixture();
    await assert.rejects(f.run({}, {repository}));
    assert.ok(f.writes.every(w=>w.body.state==='pending'));
  }
});

test('changed head, non-main base and closed PR cannot receive approval', async () => {
  for (const pr of [{head:{sha:OTHER}}, {base:{ref:'other',repo:{full_name:REPOSITORY}}},
    {base:{ref:'main',repo:{full_name:'someone/example'}}}, {state:'closed'}, {merged:true}]) {
    const f = fixture({pr});
    await assert.rejects(f.run());
    assert.ok(f.writes.every(w=>w.body.state==='pending'));
  }
});

test('an old workflow or changed operative agreement cannot receive approval', async () => {
  for (const options of [{main:()=>OTHER},{terms:'Changed terms'}]) {
    const f=fixture(options);
    await assert.rejects(f.run());
    assert.ok(f.writes.every(w=>w.body.state==='pending'));
  }
});

test('duplicate open PRs cannot share a rights clearance', async () => {
  const f=fixture({prs:[PR,{...PR,number:8}]});
  await assert.rejects(f.run(), /Duplicate PR heads/);
  assert.ok(f.writes.every(w=>w.body.state==='pending'));
});

test('missing, oversized and inconsistent commit inventories block approval', async () => {
  for (const options of [{commits:[]}, {pr:{commits:251}}, {pr:{commits:0}},
    {commits:[{...COMMITS[0],sha:OTHER}]}, {pr:{commits:2}}]) {
    const f=fixture(options);
    await assert.rejects(f.run());
    assert.ok(f.writes.every(w=>w.body.state==='pending'));
  }
});

test('commit inventory is paginated before owner attestation is recorded', async () => {
  const commits=Array.from({length:101},(_,i)=>({...COMMITS[0],sha:i===100?HEAD:i.toString(16).padStart(40,'0')}));
  const f=fixture({pr:{commits:101},commits});
  assert.equal((await f.run()).commits,101);
  assert.ok(f.reads.includes('/pulls/7/commits?per_page=100&page=2'));
});

test('changed disclosures or main during recording block the final status', async () => {
  for (const options of [{readPR:n=>n===1?PR:{...PR,body:'New disclosure'}},
    {main:n=>n===1?MAIN:OTHER}]) {
    const f=fixture(options);
    await assert.rejects(f.run());
    assert.ok(f.writes.every(w=>w.body.state==='pending'));
  }
});

test('owner may revoke an exact-head clearance with a private receipt', async () => {
  const f=fixture();
  const result=await f.run({INPUT_DECISION:'revoke'});
  assert.equal(result.mode,'revoke');
  assert.equal(f.writes.at(-1).body.state,'failure');
});

test('PR metadata events invalidate clearance and never approve or read PR files', async () => {
  for (const action of ['opened','reopened','synchronize','edited']) {
    const f=fixture({main:()=>OTHER}); // stale invalidation can only remove clearance
    const result=await f.run({GITHUB_EVENT_NAME:'pull_request_target',GITHUB_ACTOR:'contributor',
      GITHUB_ACTOR_ID:'999',GITHUB_TRIGGERING_ACTOR:'contributor'}, {action,number:7});
    assert.equal(result.mode,'invalidate');
    assert.equal(f.writes[0].body.state,'pending');
    assert.deepEqual(f.reads,['/pulls?state=open&base=main&per_page=100&page=1']);
  }
});

test('main terms changes invalidate every open PR across API pages', async () => {
  const prs=Array.from({length:101},(_,i)=>({...PR,number:i+1,head:{sha:i.toString(16).padStart(40,'0')}}));
  const f=fixture({prs});
  const result=await f.run({GITHUB_EVENT_NAME:'push'},{ref:'refs/heads/main'});
  assert.equal(result.count,101);
  assert.equal(f.writes.length,101);
  assert.ok(f.writes.every(w=>w.body.state==='pending'));
  assert.ok(f.reads.some(p=>p.endsWith('page=2')));
});

test('a surviving queued PR event reconciles other PRs whose events were replaced', async () => {
  const other={...PR,number:8,head:{sha:OTHER}};
  const f=fixture({prs:[PR,other]});
  await f.run({GITHUB_EVENT_NAME:'pull_request_target'}, {action:'edited',number:7});
  assert.deepEqual(f.writes.map(w=>[w.path,w.body.state]),[
    [`/statuses/${HEAD}`,'pending'],[`/statuses/${OTHER}`,'pending'],
  ]);
});

test('a surviving owner dispatch also reconciles every PR before approving one', async () => {
  const other={...PR,number:8,head:{sha:OTHER}};
  const f=fixture({prs:[PR,other]});
  const result=await f.run();
  assert.equal(result.invalidatedCount,2);
  assert.deepEqual(f.writes.map(w=>[w.path,w.body.state]),[
    [`/statuses/${HEAD}`,'pending'],[`/statuses/${OTHER}`,'pending'],[`/statuses/${HEAD}`,'success'],
  ]);
});

test('bad dispatch inputs or a stale main still invalidate all prior clearances', async () => {
  const other={...PR,number:8,head:{sha:OTHER}};
  for (const [options,env] of [[{}, {INPUT_CONFIRMATION:'false'}],
    [{main:()=>OTHER},{}]]) {
    const f=fixture({prs:[PR,other],...options});
    await assert.rejects(f.run(env));
    assert.deepEqual(f.writes.map(w=>[w.path,w.body.state]),[
      [`/statuses/${HEAD}`,'pending'],[`/statuses/${OTHER}`,'pending'],
    ]);
  }
});

test('a change or read failure during the success POST immediately withdraws clearance', async () => {
  for (const options of [
    {readPR:n=>n<=2?PR:{...PR,body:'Disclosure arrived during POST'}},
    {main:n=>n<=2?MAIN:OTHER},
    {readPR:n=>{if(n===3)throw new Error('Synthetic read failure');return PR;}},
  ]) {
    const f=fixture(options);
    await assert.rejects(f.run());
    assert.deepEqual(f.writes.map(w=>w.body.state),['pending','success','pending']);
  }
});

test('API token never follows redirects or appears in request URLs/errors', async () => {
  const requests=[];
  const api=githubAPI('synthetic-token',async(url,options)=>{
    requests.push({url,options});return {ok:false,status:403,json:()=>({})};
  });
  await assert.rejects(api('GET','/branches/main'),/GitHub metadata request failed \(403\)/);
  assert.equal(requests[0].options.redirect,'error');
  assert.equal(requests[0].options.headers.Authorization,'Bearer synthetic-token');
  assert.equal(requests[0].url,`https://api.github.com/repos/${REPOSITORY}/branches/main`);
});

test('privileged workflow only checks out trusted main and never executes PR content', () => {
  const workflow=readFileSync(new URL('../.github/workflows/contributor-rights.yml',import.meta.url),'utf8');
  assert.match(workflow,/pull_request_target:/);
  assert.match(workflow,/ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/!github\.event\.repository\.private/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/\n  group: contributor-rights\n  cancel-in-progress: false\n/);
  assert.match(workflow,/statuses: write/);
  assert.doesNotMatch(workflow,/pull_request\.head|inputs\.head_sha\s*\}\}\s*\n\s*persist|npm (ci|install|test)|secrets\./);
  assert.equal((workflow.match(/run:/g)||[]).length,1);
  assert.match(workflow,/run: node scripts\/contributor-rights\.mjs/);
  for (const [,action] of workflow.matchAll(/^\s*- uses: (\S+)/gm)) assert.match(action,/^actions\/[a-z-]+@[a-f0-9]{40}$/);
});
