#!/usr/bin/env node
// Trusted-main metadata only. Never loads or executes a pull request's files.
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'namarks/tres-fort-training';
export const CONTEXT = 'contributor rights';
const OWNER = 'namarks';
const OWNER_ID = '5323089';
const WORKFLOW = `${REPOSITORY}/.github/workflows/contributor-rights.yml@refs/heads/main`;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
export const digest = value => createHash('sha256').update(value).digest('hex');

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateContext(env, event) {
  requireThat(env.GITHUB_REPOSITORY === REPOSITORY && event.repository?.full_name === REPOSITORY,
    'This workflow only administers the official repository.');
  requireThat(event.repository?.default_branch === 'main' && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_WORKFLOW_REF === WORKFLOW && SHA.test(env.GITHUB_SHA ?? ''),
  'Only the trusted main-branch workflow may administer rights status.');
  const name = env.GITHUB_EVENT_NAME;
  requireThat(['workflow_dispatch', 'pull_request_target', 'push'].includes(name), 'Unsupported event.');
  if (name === 'workflow_dispatch') {
    requireThat(env.GITHUB_ACTOR === OWNER && env.GITHUB_TRIGGERING_ACTOR === OWNER
      && env.GITHUB_ACTOR_ID === OWNER_ID, 'Only the owner may record or revoke a review.');
  }
}

function validateReviewInputs(env) {
  requireThat(/^[1-9][0-9]*$/.test(env.INPUT_PR_NUMBER ?? ''), 'A pull-request number is required.');
  requireThat(SHA.test(env.INPUT_HEAD_SHA ?? ''), 'An exact pull-request head SHA is required.');
  requireThat(DIGEST.test(env.INPUT_TERMS_SHA256 ?? ''), 'An exact terms SHA-256 is required.');
  requireThat(DIGEST.test(env.INPUT_RECEIPT_SHA256 ?? ''), 'A private review receipt SHA-256 is required.');
  requireThat(['approve', 'revoke'].includes(env.INPUT_DECISION), 'Select approve or revoke.');
  requireThat(env.INPUT_CONFIRMATION === 'true', 'Affirmative owner verification is required.');
}

function validatePR(pr, number) {
  requireThat(pr.number === number && pr.state === 'open' && !pr.merged,
    'The pull request must still be open.');
  requireThat(pr.base?.repo?.full_name === REPOSITORY && pr.base?.ref === 'main',
    'The pull request must target official main.');
  requireThat(SHA.test(pr.head?.sha ?? ''), 'The pull request has no valid head SHA.');
}

function disclosureDigest(pr) {
  return digest(JSON.stringify({number: pr.number, head: pr.head.sha,
    title: pr.title ?? '', body: pr.body ?? '', base: pr.base.ref}));
}

export function authorInventoryDigest(commits) {
  // Hash every commit's native and GitHub identity evidence, including its full
  // message (and therefore coauthor trailers). Never infer that these identities
  // are authenticated signers or that a null GitHub identity belongs to the owner.
  return digest(JSON.stringify(commits.map(c => ({sha: c.sha, author: c.author,
    committer: c.committer, git_author: c.commit?.author,
    git_committer: c.commit?.committer, message: c.commit?.message}))));
}

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
  return digest(Buffer.from(file.content, 'base64'));
}

export async function execute({env, event, api}) {
  validateContext(env, event);
  const currentMain = async () => {
    const branch = await api('GET', '/branches/main');
    requireThat(SHA.test(branch.commit?.sha ?? ''), 'Main has no valid commit SHA.');
    return branch.commit.sha;
  };
  const status = (sha, state, description) => api('POST', `/statuses/${sha}`, {
    state, context: CONTEXT, description,
    target_url: `https://github.com/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
  });

  if (env.GITHUB_EVENT_NAME === 'pull_request_target') {
    requireThat(['opened', 'reopened', 'synchronize', 'edited'].includes(event.action)
      && Number.isSafeInteger(event.number) && event.number > 0, 'Unsupported pull-request event.');
  } else if (env.GITHUB_EVENT_NAME === 'push') {
    requireThat(event.ref === 'refs/heads/main', 'Only main changes invalidate all reviews.');
  }
  // All runs share one workflow concurrency group. GitHub may replace pending
  // runs, so every surviving run reconciles ALL current PRs, including dispatches
  // whose approval inputs later fail validation. No event-specific invalidation
  // can be lost merely because another event replaced it in the queue.
  const pending = await openPRs(api);
  for (const pr of pending) {
    validatePR(pr, pr.number);
    await status(pr.head.sha, 'pending', 'Owner must verify private rights records for this PR head.');
  }
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    return {mode: 'invalidate', count: pending.length};
  }

  validateReviewInputs(env);
  // Invalidation may run from an older trusted main revision: it can only
  // remove clearance. Approval must use the currently operative workflow.
  requireThat(await currentMain() === env.GITHUB_SHA, 'Main changed; start a fresh trusted workflow run.');
  const number = Number(env.INPUT_PR_NUMBER);
  requireThat(Number.isSafeInteger(number), 'Invalid pull-request number.');
  const pr = await api('GET', `/pulls/${number}`);
  validatePR(pr, number);
  requireThat(pr.head.sha === env.INPUT_HEAD_SHA, 'The reviewed head is no longer current.');
  const termsHash = await readTerms(api, env.GITHUB_SHA);
  requireThat(termsHash === env.INPUT_TERMS_SHA256, 'The operative terms do not match the reviewed text.');
  if (env.INPUT_DECISION === 'revoke') {
    await status(pr.head.sha, 'failure', `Owner revoked rights clearance for PR #${number}.`);
    return {mode: 'revoke', number, head: pr.head.sha, termsHash,
      receiptHash: env.INPUT_RECEIPT_SHA256};
  }

  // A commit status belongs to a SHA, not a PR. Do not bless two simultaneous
  // PRs with different disclosures using one status. Opening/reopening/editing
  // a PR also invalidates its status through the metadata-only event path.
  const duplicates = (await openPRs(api)).filter(p => p.head?.sha === pr.head.sha);
  requireThat(duplicates.length === 1 && duplicates[0].number === number,
    'Duplicate PR heads need owner resolution before rights clearance.');
  requireThat(Number.isInteger(pr.commits) && pr.commits > 0 && pr.commits <= 250,
    'The complete commit inventory must fit the GitHub pull-request API limit.');
  const commits = [];
  for (let page = 1; commits.length < pr.commits; page++) {
    const batch = await api('GET', `/pulls/${number}/commits?per_page=100&page=${page}`);
    requireThat(Array.isArray(batch) && batch.length > 0, 'The commit inventory is incomplete.');
    commits.push(...batch);
  }
  requireThat(commits.length === pr.commits && commits.every(c => SHA.test(c.sha ?? ''))
    && commits.at(-1).sha === pr.head.sha, 'The commit inventory does not match the reviewed head.');
  const inventoryHash = authorInventoryDigest(commits);
  const disclosuresHash = disclosureDigest(pr);
  const freshPR = await api('GET', `/pulls/${number}`);
  validatePR(freshPR, number);
  requireThat(disclosureDigest(freshPR) === disclosuresHash && freshPR.commits === pr.commits,
    'The pull request changed during review recording.');
  requireThat(await currentMain() === env.GITHUB_SHA, 'Main changed during review recording.');
  await status(pr.head.sha, 'success', `Owner reviewed PR #${number}; terms ${termsHash.slice(0,12)}.`);
  try {
    const recordedPR = await api('GET', `/pulls/${number}`);
    validatePR(recordedPR, number);
    requireThat(disclosureDigest(recordedPR) === disclosuresHash && recordedPR.commits === pr.commits
      && await currentMain() === env.GITHUB_SHA, 'Review inputs changed while the status was being recorded.');
  } catch (error) {
    // Defense in depth while a newer serialized invalidation waits to run.
    // Errors reading freshness also withdraw the provisional success.
    await status(pr.head.sha, 'pending', 'Review inputs changed or could not be rechecked; owner review required.');
    throw error;
  }
  return {mode: 'approve', number, head: pr.head.sha, termsHash,
    receiptHash: env.INPUT_RECEIPT_SHA256, inventoryHash, disclosuresHash, commits: commits.length,
    invalidatedCount: pending.length};
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
        `Metadata verification and owner attestation; not automated legal acceptance.\n\n\`\`\`json\n${output}\`\`\`\n`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
