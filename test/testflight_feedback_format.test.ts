import { describe, expect, it } from 'vitest';
import {
  feedbackMarkdown,
  isOnOrAfter,
  screenshotFileName,
  screenshotUrl,
  submissionFolderName,
  summarizeSubmission,
  summaryLine,
} from '../scripts/testflight-feedback-format.mjs';

// scripts/testflight-feedback.mjs saves each TestFlight submission under the
// folder these helpers name, and scripts/beta-feedback-to-issues.mjs points a
// GitHub issue at that same folder, so the naming must stay stable.
const sub = {
  id: '1a2b3c4d-5e6f-7a8b',
  attributes: {
    createdDate: '2026-11-13T22:41:05.123Z',
    comment: '  Activities list is out of order\nafter the Health import  ',
    deviceModel: 'iPhone16,2',
    osVersion: '26.1',
    locale: 'en-US',
    timeZone: 'America/Los_Angeles',
    batteryPercentage: 81,
    appUptimeInMilliseconds: 42_400,
    connectionType: 'WIFI',
    email: 'tester@example.com',
    screenshots: [
      { url: 'https://cdn.example/a.jpeg?sig=1', expirationDate: '2026-11-20T00:00:00Z' },
      { templateUrl: 'https://cdn.example/b/{w}x{h}.{f}', width: 1179, height: 2556 },
      { expirationDate: '2026-11-20T00:00:00Z' },
    ],
  },
  relationships: {
    build: { data: { type: 'builds', id: 'b1' } },
    tester: { data: { type: 'betaTesters', id: 't1' } },
  },
};
const builds = new Map([['b1', { version: '82' }]]);
const testers = new Map([['t1', { firstName: 'Geoff', lastName: 'Tester' }]]);

describe('TestFlight feedback formatting', () => {
  it('flattens a submission with its build and tester', () => {
    const s = summarizeSubmission('screenshot', sub, builds, testers);
    expect(s).toMatchObject({
      id: '1a2b3c4d-5e6f-7a8b',
      kind: 'screenshot',
      build: '82',
      tester: 'Geoff Tester',
      deviceModel: 'iPhone16,2',
      osVersion: '26.1',
      comment: 'Activities list is out of order\nafter the Health import',
    });
    expect(s.screenshots.map((x) => x.url)).toEqual([
      'https://cdn.example/a.jpeg?sig=1',
      'https://cdn.example/b/1179x2556.png',
    ]);
  });

  it('falls back to the tester email, then the submission email', () => {
    const t = new Map([['t1', { email: 'geoff@example.com' }]]);
    expect(summarizeSubmission('crash', sub, builds, t).tester).toBe('geoff@example.com');
    expect(summarizeSubmission('crash', sub, new Map(), new Map()).tester).toBe('tester@example.com');
    expect(summarizeSubmission('crash', { id: 'x' }, new Map(), new Map())).toMatchObject({
      tester: null,
      build: null,
      comment: '',
      screenshots: [],
    });
  });

  it('names the local folder by date, kind and id prefix', () => {
    const s = summarizeSubmission('screenshot', sub, builds, testers);
    expect(submissionFolderName(s)).toBe('2026-11-13-screenshot-1a2b3c4d');
    expect(submissionFolderName({ id: '../../x', kind: 'crash', createdDate: null })).toBe('undated-crash-x');
  });

  it('keeps a known screenshot extension and defaults to png', () => {
    expect(screenshotFileName(0, 'https://cdn.example/a.jpeg?sig=1')).toBe('screenshot-1.jpg');
    expect(screenshotFileName(1, 'https://cdn.example/b.PNG')).toBe('screenshot-2.png');
    expect(screenshotFileName(2, 'https://cdn.example/opaque')).toBe('screenshot-3.png');
    expect(screenshotUrl(null)).toBeNull();
  });

  it('filters by creation time', () => {
    const cutoff = Date.parse('2026-11-13T00:00:00Z');
    expect(isOnOrAfter('2026-11-13T00:00:00Z', cutoff)).toBe(true);
    expect(isOnOrAfter('2026-11-12T23:59:59Z', cutoff)).toBe(false);
    expect(isOnOrAfter(undefined, cutoff)).toBe(false);
  });

  it('renders a terminal line and a markdown file', () => {
    const s = summarizeSubmission('screenshot', sub, builds, testers);
    expect(summaryLine(s)).toBe(
      '2026-11-13 22:41  [screenshot] Geoff Tester — build 82 · iPhone16,2 · iOS 26.1 · 2 screenshot(s)\n' +
        '    Activities list is out of order after the Health import',
    );
    const md = feedbackMarkdown(s, ['screenshot-1.jpg']);
    expect(md).toContain('> Activities list is out of order\n> after the Health import');
    expect(md).toContain('| Tester | Geoff Tester |');
    expect(md).toContain('| State | 81% battery · 42s uptime · WIFI |');
    expect(md).toContain('- [screenshot-1.jpg](screenshot-1.jpg)');
  });
});
