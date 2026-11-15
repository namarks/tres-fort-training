import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { PRIVACY_HTML } from '../privacy.mjs';
import { MCP_URL, SHARED_DATA } from '../connect.mjs';

const root = new URL('../', import.meta.url);
execFileSync(process.execPath, ['build.mjs'], { cwd: root });
const pages = new Map([
  ['/', await readFile(new URL('dist/index.html', root), 'utf8')],
  ['/privacy', await readFile(new URL('dist/privacy/index.html', root), 'utf8')],
  ['/connect', await readFile(new URL('dist/connect/index.html', root), 'utf8')],
  ['/terms', await readFile(new URL('dist/terms/index.html', root), 'utf8')],
]);

test('the standalone policy uses the same content as the app policy', () => {
  assert.equal(pages.get('/privacy'), PRIVACY_HTML);
});

test('every local navigation target, image, and font exists in the public build', async () => {
  for (const [pathname, html] of pages) {
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"|url\('([^']+)'\)/g)) {
      const target = match[1] ?? match[2];
      if (target.startsWith('mailto:') || target.startsWith('https://')) continue;
      const url = new URL(target, `https://tresfort.app${pathname}`);
      if (pages.has(url.pathname)) {
        if (url.hash) assert.ok(pages.get(url.pathname).includes(`id="${url.hash.slice(1)}"`), `${pathname}: missing ${target}`);
      } else {
        assert.ok((await stat(new URL(`dist${url.pathname}`, root))).isFile(), `${pathname}: missing ${target}`);
      }
    }
    for (const image of html.matchAll(/<img\b[^>]*>/g)) {
      assert.match(image[0], /\balt="[^"]*"/);
      assert.match(image[0], /\bwidth="\d+"/);
      assert.match(image[0], /\bheight="\d+"/);
    }
    assert.doesNotMatch(html, /<script\b|<iframe\b|<form\b/i);
  }
});

test('mobile approval uses a narrowly claimed, verified app link with a non-authorizing fallback', async () => {
  const aasa = JSON.parse(await readFile(new URL('dist/.well-known/apple-app-site-association', root), 'utf8'));
  assert.deepEqual(aasa.applinks.details[0].appIDs, ['8BA2RY6RCA.com.nmarkspdx.tresfort']);
  assert.deepEqual(aasa.applinks.details[0].components.map(component => component['/']), ['/coach/authorize']);
  const fallback = await readFile(new URL('dist/coach/authorize/index.html', root), 'utf8');
  assert.match(fallback, /No access has been granted/);
  assert.doesNotMatch(fallback, /<script|access_token|refresh_token|passphrase/);
  const headers = await readFile(new URL('dist/_headers', root), 'utf8');
  assert.match(headers, /Referrer-Policy: no-referrer/);
});

test('the AI setup guide matches the app and the connector it documents', async () => {
  const guide = pages.get('/connect');
  const swift = await readFile(new URL('../ios/TresFort/Profile/CoachConnectView.swift', root), 'utf8');
  const appList = swift.match(/static let sharedData = \[([\s\S]*?)\]/)[1];
  assert.deepEqual([...appList.matchAll(/"([^"]+)"/g)].map(m => m[1]), SHARED_DATA);
  const plugin = JSON.parse(await readFile(new URL('../plugins/tres-fort/.mcp.json', root), 'utf8'));
  assert.equal(plugin.mcpServers['tres-fort'].url, MCP_URL);
  const profile = await readFile(new URL('../ios/TresFort/Profile/ProfileView.swift', root), 'utf8');
  for (const label of ['Set up your AI coach', 'Connect with Claude', 'Copy setup link', 'Copy setup for Codex',
    'Use a connect code', 'Open Très Fort to review access', 'Disconnect all AI apps']) {
    assert.ok(guide.includes(label), `guide is missing ${label}`);
    assert.ok(swift.includes(label) || profile.includes(label), `the app no longer shows ${label}`);
  }
  for (const step of ['Customize → Connectors → Très Fort', 'Always allow']) {
    assert.ok(guide.includes(step), `guide is missing Claude's tool permission step: ${step}`);
  }
  assert.ok(pages.get('/').includes('href="/connect"'), 'home page links the guide');
});

test('the published terms are linked where app directories and members find them', async () => {
  const terms = pages.get('/terms');
  assert.match(terms, /<h1>Terms of service<\/h1>/);
  assert.match(terms, /not a medical service/);
  assert.ok(terms.includes('href="/privacy"'), 'terms link the privacy policy');
  assert.ok(pages.get('/').includes('href="/terms"'), 'home page links the terms');
  assert.ok(pages.get('/connect').includes('href="/terms"'), 'the AI guide links the terms');
  const manifest = JSON.parse(await readFile(new URL('../plugins/tres-fort/.codex-plugin/plugin.json', root), 'utf8'));
  assert.equal(manifest.interface.termsOfServiceURL, 'https://tresfort.app/terms');
  assert.equal(manifest.interface.privacyPolicyURL, 'https://tresfort.app/privacy');
});
