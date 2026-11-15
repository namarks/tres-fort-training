import { env, applyD1Migrations, createExecutionContext, SELF, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import worker from '../src/index';

// OpenAI's plugin portal verifies the MCP host by fetching the token it
// issued from the host root (plugins/tres-fort/submission.md).
const BASE = 'https://tres-fort.test';
const PATH = '/.well-known/openai-apps-challenge';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function fetchWith(token: string | undefined) {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(`${BASE}${PATH}`), { ...env, OPENAI_APPS_CHALLENGE: token }, context);
  await waitOnExecutionContext(context);
  return response;
}

describe('OpenAI domain verification challenge', () => {
  it('is not found while no token is configured', async () => {
    expect(env.OPENAI_APPS_CHALLENGE).toBeUndefined();
    const res = await SELF.fetch(`${BASE}${PATH}`);
    expect(res.status).toBe(404);
    expect((await fetchWith('   ')).status).toBe(404);
  });

  it('serves the configured token as plain text, unchanged and uncached', async () => {
    const res = await fetchWith('  openai-token-123\n');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('openai-token-123');
  });
});
