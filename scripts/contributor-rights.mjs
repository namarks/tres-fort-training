#!/usr/bin/env node
// Sets the required `contributor rights` status on every open pull request.
//
// - A PR from a branch in this repository is the owner's own work (only the
//   owner can push here; coding agents push with the owner's access): success.
// - A PR from a fork passes once its author and every commit author and
//   co-author have accepted the current contributor terms by commenting the
//   acceptance line on any pull request in this repository. One acceptance
//   covers all of that person's later PRs under the same terms version.
// - Anything the rules cannot settle (an unlinked author, a bot, a co-author
//   without a GitHub address) stays pending until the owner approves that
//   exact head with the workflow's manual run.
//
// Trusted-main metadata only. Never loads or executes a pull request's files.
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'namarks/tres-fort-training';
export const CONTEXT = 'contributor rights';
const OWNER = 'namarks';
const OWNER_ID = '5323089';
const WORKFLOW = `${REPOSITORY}/.github/workflows/contributor-rights.yml@refs/heads/main`;
const SHA = /^[a-f0-9]{40}$/;
const MAX_COMMITS = 250;
const MAX_COMMENT_PAGES = 100;
const HOW_TO = `https://github.com/${REPOSITORY}/blob/main/docs/CONTRIBUTOR-ACCEPTANCE.md`;
const OWNER_APPROVED = 'Owner approved this head under terms';
const OWNER_REVOKED = 'Owner revoked this head under terms';

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

// "Très" and "Tres" both match; case and spacing do not matter.
const normalize = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

export const acceptanceLine = version =>
  `I accept the Très Fort Contributor Terms version ${version}.`;

export function termsVersion(text) {
  const match = text.match(/^Version (\d+\.\d+) · \d{4}-\d{2}-\d{2}$/m);
  requireThat(match, 'The operative contributor terms have no version line.');
  return match[1];
}

export function validateContext(env, event) {
  requireThat(env.GITHUB_REPOSITORY === REPOSITORY && event.repository?.full_name === REPOSITORY,
    'This workflow only administers the official repository.');
  requireThat(event.repository?.default_branch === 'main' && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_WORKFLOW_REF === WORKFLOW && SHA.test(env.GITHUB_SHA ?? ''),
  'Only the trusted main-branch workflow may administer rights status.');
  const name = env.GITHUB_EVENT_NAME;
  requireThat(['workflow_dispatch', 'pull_request_target', 'push', 'issue_comment'].includes(name),
    'Unsupported event.');
  if (name === 'workflow_dispatch') {
    requireThat(env.GITHUB_ACTOR === OWNER && env.GITHUB_TRIGGERING_ACTOR === OWNER
      && env.GITHUB_ACTOR_ID === OWNER_ID, 'Only the owner may record or revoke a review.');
  }
}

function validatePR(pr, number) {
  requireThat(pr.number === number && pr.state === 'open' && !pr.merged,
    'The pull request must still be open.');
  requireThat(pr.base?.repo?.full_name === REPOSITORY && pr.base?.ref === 'main',
    'The pull request must target official main.');
  requireThat(SHA.test(pr.head?.sha ?? ''), 'The pull request has no valid head SHA.');
}

const isOwnerBranch = pr => pr.head?.repo?.full_name === REPOSITORY;

async function openPRs(api) {
  const result = [];
  for (let page = 1; page <= 1000; page++) {
    const batch = await api('GET', `/pulls?state=open&base=main&per_page=100&page=${page}`);
    requireThat(Array.isArray(batch), 'Invalid pull-request inventory.');
    result.push(...batch);
    if (batch.length < 100) return result;
  }
  throw new Error('Pull-request inventory exceeded its safety limit.');
}

async function readTerms(api, mainSHA) {
  const file = await api('GET', `/contents/CONTRIBUTOR-TERMS.md?ref=${mainSHA}`);
  requireThat(file.type === 'file' && file.encoding === 'base64'
    && typeof file.content === 'string' && file.size > 0 && file.size < 262144,
  'The operative contributor terms could not be read.');
  return termsVersion(Buffer.from(file.content, 'base64').toString('utf8'));
}

async function prCommits(api, pr) {
  // The pull-request list omits the commit count; only the detail response has it.
  const detail = await api('GET', `/pulls/${pr.number}`);
  if (detail?.head?.sha !== pr.head.sha) return null;
  const count = detail.commits;
  if (!Number.isInteger(count) || count < 1 || count > MAX_COMMITS) return null;
  const commits = [];
  for (let page = 1; commits.length < count; page++) {
    const batch = await api('GET', `/pulls/${pr.number}/commits?per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) return null;
    commits.push(...batch);
  }
  if (commits.length !== count || commits.at(-1)?.sha !== pr.head.sha) return null;
  return commits;
}

const COAUTHOR = /^co-authored-by:\s*.*<([^>]+)>\s*$/gim;
const NOREPLY = /^(\d+)\+([A-Za-z0-9-]+)@users\.noreply\.github\.com$/i;

// The people whose acceptance a fork PR needs, as GitHub account ids, plus
// reasons the rules cannot settle on their own.
export function contributors(pr, commits) {
  const people = new Map(), unresolved = [];
  const add = user => {
    if (!user || !Number.isSafeInteger(user.id) || typeof user.login !== 'string') return false;
    if (user.type === 'Bot' || user.login.endsWith('[bot]')) return false;
    people.set(user.id, user.login);
    return true;
  };
  if (!add(pr.user)) unresolved.push('PR author is not a person account');
  for (const commit of commits) {
    if (!add(commit.author)) unresolved.push(`commit ${commit.sha.slice(0, 7)} author has no GitHub account`);
    for (const [, email] of (commit.commit?.message ?? '').matchAll(COAUTHOR)) {
      const match = email.trim().match(NOREPLY);
      if (match) people.set(Number(match[1]), match[2]);
      else unresolved.push(`a co-author of ${commit.sha.slice(0, 7)} has no GitHub address`);
    }
  }
  return {people, unresolved: [...new Set(unresolved)]};
}

const PR_COMMENT_URL = `https://github.com/${REPOSITORY}/pull/`;

// Account ids that commented the acceptance line for this terms version.
async function acceptedIds(api, version) {
  const wanted = normalize(acceptanceLine(version));
  const ids = new Set();
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const batch = await api('GET', `/issues/comments?sort=created&direction=asc&per_page=100&page=${page}`);
    requireThat(Array.isArray(batch), 'Invalid comment inventory.');
    for (const c of batch) {
      // Only comments on this repository's pull requests count, not issues.
      if (Number.isSafeInteger(c.user?.id) && c.user?.type !== 'Bot'
        && typeof c.html_url === 'string' && c.html_url.startsWith(PR_COMMENT_URL)
        && typeof c.body === 'string' && normalize(c.body).includes(wanted)) ids.add(c.user.id);
    }
    if (batch.length < 100) return ids;
  }
  throw new Error('Comment inventory exceeded its safety limit.');
}

const clip = text => text.length <= 140 ? text : `${text.slice(0, 137)}...`;

async function latestStatus(api, sha) {
  const statuses = await api('GET', `/commits/${sha}/statuses?per_page=100`);
  requireThat(Array.isArray(statuses), 'Invalid status inventory.');
  return statuses.find(s => s.context === CONTEXT) ?? null;
}

// Decide one head's status. Every PR sharing the head must pass, since a
// commit status belongs to the commit rather than to one PR.
async function decide(api, prs, version, accepted) {
  const sha = prs[0].head.sha;
  const previous = await latestStatus(api, sha);
  const marker = `${version}.`;
  if (previous?.state === 'failure' && previous.description?.startsWith(`${OWNER_REVOKED} ${marker}`)) {
    return {state: 'failure', description: previous.description};
  }
  if (previous?.state === 'success' && previous.description?.startsWith(`${OWNER_APPROVED} ${marker}`)) {
    return {state: 'success', description: previous.description};
  }
  const waiting = new Set(), unresolved = new Set();
  for (const pr of prs) {
    if (isOwnerBranch(pr)) continue;
    const commits = await prCommits(api, pr);
    if (!commits) { unresolved.add('commit list unavailable or over 250 commits'); continue; }
    const found = contributors(pr, commits);
    found.unresolved.forEach(r => unresolved.add(r));
    const ids = await accepted();
    for (const [id, login] of found.people) if (!ids.has(id)) waiting.add(login);
  }
  if (unresolved.size) {
    return {state: 'pending', description: clip(`Owner review needed: ${[...unresolved].join('; ')}.`)};
  }
  if (waiting.size) {
    const names = [...waiting].sort();
    const shown = names.slice(0, 3).map(n => `@${n}`).join(', ') + (names.length > 3 ? ' and others' : '');
    return {state: 'pending', target: HOW_TO,
      description: clip(`Waiting for ${shown} to comment the terms ${version} acceptance line (see details).`)};
  }
  return {state: 'success', description: prs.every(isOwnerBranch)
    ? 'Owner branch: the owner\'s own work.'
    : `All contributors accepted terms ${version}.`};
}

export async function execute({env, event, api}) {
  validateContext(env, event);
  const name = env.GITHUB_EVENT_NAME;
  const runURL = `https://github.com/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const status = (sha, {state, description, target}) => api('POST', `/statuses/${sha}`, {
    state, context: CONTEXT, description, target_url: target ?? runURL,
  });
  const version = await readTerms(api, env.GITHUB_SHA);

  // Every surviving run reconciles every open PR, so a run GitHub replaced in
  // the concurrency queue loses nothing. `skip` is a head just decided by hand.
  const reconcile = async skip => {
    const open = await openPRs(api);
    open.forEach(pr => validatePR(pr, pr.number));
    const byHead = new Map();
    for (const pr of open) {
      if (pr.head.sha !== skip) byHead.set(pr.head.sha, [...(byHead.get(pr.head.sha) ?? []), pr]);
    }
    let cache;
    const accepted = async () => (cache ??= await acceptedIds(api, version));
    const results = [];
    for (const [sha, prs] of byHead) {
      const decision = await decide(api, prs, version, accepted);
      await status(sha, decision);
      results.push({prs: prs.map(p => p.number), state: decision.state});
    }
    return results;
  };

  if (name === 'workflow_dispatch') {
    requireThat(/^[1-9][0-9]*$/.test(env.INPUT_PR_NUMBER ?? ''), 'A pull-request number is required.');
    requireThat(SHA.test(env.INPUT_HEAD_SHA ?? ''), 'An exact pull-request head SHA is required.');
    requireThat(['approve', 'revoke'].includes(env.INPUT_DECISION), 'Select approve or revoke.');
    requireThat(env.INPUT_CONFIRMATION === 'true', 'Affirmative owner confirmation is required.');
    const branch = await api('GET', '/branches/main');
    requireThat(branch.commit?.sha === env.GITHUB_SHA, 'Main changed; start a fresh run.');
    const number = Number(env.INPUT_PR_NUMBER);
    const pr = await api('GET', `/pulls/${number}`);
    validatePR(pr, number);
    requireThat(pr.head.sha === env.INPUT_HEAD_SHA, 'That head is no longer the PR\'s current head.');
    const approve = env.INPUT_DECISION === 'approve';
    await status(pr.head.sha, {state: approve ? 'success' : 'failure',
      description: `${approve ? OWNER_APPROVED : OWNER_REVOKED} ${version}. PR #${number}.`});
    const results = await reconcile(pr.head.sha);
    return {mode: env.INPUT_DECISION, number, head: pr.head.sha, version, results};
  }

  if (name === 'pull_request_target') {
    requireThat(['opened', 'reopened', 'synchronize', 'edited'].includes(event.action)
      && Number.isSafeInteger(event.number) && event.number > 0, 'Unsupported pull-request event.');
  } else if (name === 'push') {
    requireThat(event.ref === 'refs/heads/main', 'Only main changes re-check every PR.');
  } else {
    requireThat(['created', 'edited'].includes(event.action) && event.issue?.pull_request,
      'Only pull-request comments can carry an acceptance.');
  }

  return {mode: 'reconcile', version, results: await reconcile(null)};
}

export function githubAPI(token, fetcher = fetch) {
  requireThat(Boolean(token), 'A GitHub Actions token is required.');
  return async (method, path, body) => {
    requireThat(path.startsWith('/') && !path.includes('..'), 'Invalid repository API path.');
    const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      method, redirect: 'error',
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    requireThat(response.ok, `GitHub metadata request failed (${response.status}).`);
    return response.json();
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const result = await execute({env: process.env, event, api: githubAPI(process.env.GITHUB_TOKEN)});
    const output = `${JSON.stringify(result, null, 2)}\n`;
    console.log(output);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        `Contributor rights status, from GitHub metadata only.\n\n\`\`\`json\n${output}\`\`\`\n`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
