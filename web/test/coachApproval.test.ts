import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coachRequestId, httpsReturn, recipientFor, SHARED_DATA, signInHref } from '../src/coachApproval';

const ID = 'ab'.repeat(32);

describe('approving an AI app on the web', () => {
  it('opens only a well-formed request on its own path', () => {
    expect(coachRequestId('/coach/authorize', `?request=${ID}`)).toBe(ID);
    expect(coachRequestId('/coach/authorize', `?request=${ID}&signin=failed`)).toBe(ID);
    expect(coachRequestId('/coach/authorize', '?request=nope')).toBeNull();
    expect(coachRequestId('/coach/authorize', '')).toBeNull();
    expect(coachRequestId('/', `?request=${ID}`)).toBeNull();
  });

  it('signs in and comes back to the same request', () => {
    const href = new URL(signInHref(ID), 'https://app.tresfort.app');
    expect(href.pathname).toBe('/auth/apple/start');
    expect(href.searchParams.get('return')).toBe(`/coach/authorize?request=${ID}`);
  });

  it('names the recipient from the return address, never the app’s own name', () => {
    expect(recipientFor('https://chatgpt.com/connector/oauth/abc')).toBe('ChatGPT, operated by OpenAI');
    expect(recipientFor('https://claude.ai/api/mcp/auth_callback')).toBe('Claude, operated by Anthropic');
    expect(recipientFor('https://chatgpt.com.evil.example/cb')).toBe('The app at chatgpt.com.evil.example and its configured model provider');
    expect(recipientFor('http://chatgpt.com/cb')).toBe('The connecting app and its configured model provider');
  });

  it('returns only to a plain HTTPS address', () => {
    expect(httpsReturn('https://chatgpt.com/cb?code=1')?.hostname).toBe('chatgpt.com');
    for (const bad of ['http://chatgpt.com/cb', 'javascript:alert(1)', 'https://u:p@chatgpt.com/', 'https://chatgpt.com/#x', 'not a url']) {
      expect(httpsReturn(bad), bad).toBeNull();
    }
  });

  it('lists the same shared data as the iPhone app', () => {
    const swift = readFileSync(new URL('../../ios/TresFort/Profile/CoachConnectView.swift', import.meta.url), 'utf8');
    const appList = swift.match(/static let sharedData = \[([\s\S]*?)\]/)![1]!;
    expect([...appList.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual(SHARED_DATA);
  });
});
