#!/usr/bin/env node
// Renders the mock kit's screens to PNG with the app's real tokens.
//
//   node design/mock-kit/render.mjs                       # shipped palette
//   node design/mock-kit/render.mjs --palette a.json --palette b.json
//   node design/mock-kit/render.mjs --screens today --modes light --out /tmp/x
//
// Each --palette is a JSON override of BrandPalette tokens (see README.md);
// "current" (no override) is always the first row. Writes one PNG per
// palette, screen and mode, plus board.png comparing them all.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readPalette, applyOverride, cssFor } from './tokens.mjs';
import { expandIcons, icon } from './icons.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');

function args() {
  const a = process.argv.slice(2), o = { palettes: [], screens: null, modes: ['light', 'dark'], out: path.join(here, 'out'), scale: 2 };
  for (let i = 0; i < a.length; i++) {
    const k = a[i], v = a[i + 1];
    if (k === '--palette') { o.palettes.push(v); i++; }
    else if (k === '--screens') { o.screens = v.split(','); i++; }
    else if (k === '--modes') { o.modes = v.split(','); i++; }
    else if (k === '--out') { o.out = path.resolve(v); i++; }
    else if (k === '--scale') { o.scale = Number(v); i++; }
    else if (k === '--help' || k === '-h') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n')); process.exit(0); }
    else throw new Error(`Unknown argument ${k}`);
  }
  return o;
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const globalRoot = execSync('npm root -g').toString().trim();
  return createRequire(path.join(globalRoot, 'noop.js'))('playwright');
}

// The tab bar tint the app uses, read from MainTabView.swift.
function tabTint() {
  const src = readFileSync(path.join(repo, 'ios/TresFort/MainTabView.swift'), 'utf8');
  const m = [...src.matchAll(/\.tint\(Theme\.(\w+)\)/g)].pop();
  return m ? m[1] : 'accent';
}

const status = `<div class="status"><span>9:41</span><span class="icons">
  <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
  <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.5c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .7 10.4 10.4 0 0 0 .8 3.6L2 4.9a8.6 8.6 0 0 1 6-2.4zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.6 6.6 0 0 0 8 4.3 6.6 6.6 0 0 0 3.4 6.1l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3zM8 9.7l1.9-2a2.8 2.8 0 0 0-3.8 0z"/></svg>
  <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor"/><rect x="25" y="4.5" width="1.5" height="4" rx=".7" fill="currentColor" opacity=".4"/></svg></span></div>`;

const TABS = [['today', 'Today', 'figure.strengthtraining.traditional'], ['plan', 'Plan', 'list.bullet.clipboard'],
  ['activity', 'Activity', 'chart.line.uptrend.xyaxis'], ['group', 'Group', 'person.2.fill']];
const tabbar = (sel) => `<div class="tabbar">${TABS.map(([k, l, g]) =>
  `<div class="tab ${k === sel ? 'on' : ''}">${icon(g, 27, 1.7)}<span>${l}</span></div>`).join('')}</div><div class="home-indicator"></div>`;

const route = 'M30 150 C 60 110, 85 140, 115 100 S 165 50, 205 70 S 265 130, 295 90 S 335 30, 345 50';
const map = `<svg width="100%" height="180" viewBox="0 0 362 180" preserveAspectRatio="xMidYMid slice">
  <rect width="362" height="180" fill="var(--map-land)"/>
  <path d="M0 0 h70 q-12 34 -70 50z" fill="var(--map-water)"/><path d="M190 120 q40 -12 85 18 l-12 42 h-90z" fill="var(--map-park)"/>
  <path d="M0 38 L362 20 M0 112 L362 126 M60 0 L88 180 M182 0 L172 180 M282 0 L300 180 M0 166 L362 158" stroke="var(--map-road)" stroke-width="6"/>
  <path d="${route}" fill="none" stroke="var(--route)" stroke-width="4" stroke-linecap="round"/></svg>`;

function chart(title, value, colorVar) {
  const pts = [...Array(46)].map((_, i) => [i * 7.6, 55 + 20 * Math.sin(i / 3.1) + 9 * Math.sin(i / 1.2) + (i > 14 && i < 33 ? -16 : 0)]);
  const d = 'M' + pts.map(([x, y]) => `${(x + 30).toFixed(1)} ${y.toFixed(1)}`).join(' L');
  const grid = [20, 55, 90].map((y) => `<line x1="30" x2="362" y1="${y}" y2="${y}" stroke="var(--dim)" stroke-opacity=".3"/>`).join('')
    + [30, 140, 250, 360].map((x) => `<line x1="${x}" x2="${x}" y1="0" y2="96" stroke="var(--dim)" stroke-opacity=".3"/>`).join('');
  const labels = ['8:20', '7:40', '7:00'].map((t, i) => `<text x="0" y="${24 + i * 35}" font-size="10" fill="var(--muted)">${t}</text>`).join('')
    + ['0', '1', '2', '3'].map((t, i) => `<text x="${30 + i * 110}" y="108" font-size="10" fill="var(--muted)">${t}</text>`).join('');
  return `<div class="chart"><div class="h"><span class="k">${title}</span><span class="v">${value}</span></div>
  <svg width="100%" height="110" viewBox="0 0 362 110">${grid}${labels}<path d="${d}" fill="none" stroke="var(--${colorVar})" stroke-width="2"/></svg></div>`;
}

function page(screen, tokens, mode, palette, darkTokens) {
  const tint = palette.tabTint ?? tabTint();
  const css = readFileSync(path.join(here, 'kit.css'), 'utf8')
    .replace(/url\('\.\.\/\.\.\/(.*?)'\)/g, (_, p) => `url('${pathToFileURL(path.join(repo, p)).href}')`);
  let body = readFileSync(path.join(here, 'screens', `${screen}.html`), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace('{{status}}', status)
    .replace(/\{\{tabbar:(\w+)\}\}/, (_, t) => tabbar(t))
    .replace('{{map}}', map)
    .replace(/\{\{chart\|([^|]+)\|([^|]+)\|(\w+)\}\}/g, (_, t, v, c) => chart(t, v, c));
  body = expandIcons(body);
  // heroCard(): its content takes the dark-mode tokens, the card keeps this mode's hero color.
  const heroVars = Object.entries(darkTokens).filter(([k]) => !k.startsWith('hero'))
    .map(([k, v]) => `--${k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}: ${v};`).join(' ');
  const hero = palette.heroCard === false || !tokens.hero
    ? '.hero { background: var(--surface); border-color: transparent; } body.light .hero { box-shadow: 0 1px 3px rgb(15 29 47 / .06), 0 4px 16px rgb(15 29 47 / .04); }'
    : `.hero > * { ${heroVars} color: var(--text); }`;
  const extra = `${hero}\n:root { --tab-tint: var(--${tint}); --route: var(--${palette.route ?? (tint === 'signal' ? 'signal' : 'accent')}); }\n${palette.css ?? ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${cssFor(tokens)}${css}${extra}</style></head>
<body class="${mode}">${body}</body></html>`;
}

const order = ['today', 'plan-week', 'plan-weekday', 'plan-add', 'plan-add-ride', 'plan-add-home', 'activity', 'run-detail', 'coach-connect', 'coach-connected', 'coach-approval', 'run-recorder', 'run-recorder-map', 'run-lock'];
const opts = args();
const base = readPalette();
const palettes = [{ name: 'This checkout (BrandPalette.swift)', file: null, override: {} },
  ...opts.palettes.map((f) => ({ name: null, file: f, override: JSON.parse(readFileSync(f, 'utf8')) }))];
palettes.forEach((p, i) => { p.name = p.override.name ?? p.name ?? `Option ${i}`; p.slug = p.file ? path.basename(p.file, '.json') : 'current'; });
const screens = opts.screens ?? readdirSync(path.join(here, 'screens')).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5))
  .sort((a, b) => order.indexOf(a) - order.indexOf(b));
mkdirSync(opts.out, { recursive: true });

const { chromium } = loadPlaywright();
const launch = { headless: true };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, executablePath: '/opt/pw-browsers/chromium' }));
const shots = [];
for (const p of palettes) {
  const tokens = applyOverride(base, p.override);
  for (const screen of screens) for (const mode of opts.modes) {
    const html = path.join(opts.out, `${p.slug}-${screen}-${mode}.html`);
    writeFileSync(html, page(screen, tokens[mode], mode, p.override, tokens.dark));
    const pg = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: opts.scale });
    await pg.goto(pathToFileURL(html).href);
    await pg.evaluate(() => document.fonts.ready);
    const png = path.join(opts.out, `${p.slug}-${screen}-${mode}.png`);
    await pg.screenshot({ path: png });
    await pg.close();
    shots.push({ palette: p.name, slug: p.slug, screen, mode, png });
  }
}
const board = `<!doctype html><html><body style="margin:0;padding:24px;background:#e5e3de;font:600 15px Inter,-apple-system,sans-serif;color:#15273e">
${palettes.map((p) => `<h2 style="margin:6px 0 10px;font-size:19px">${p.name}</h2><div style="display:flex;gap:12px;margin-bottom:22px">${
  shots.filter((s) => s.slug === p.slug).map((s) => `<figure style="margin:0"><img src="${pathToFileURL(s.png).href}" style="width:241px;border-radius:26px;border:1px solid #0002;display:block"><figcaption style="font-size:12px;margin-top:4px;color:#555">${s.screen} · ${s.mode}</figcaption></figure>`).join('')}</div>`).join('')}</body></html>`;
writeFileSync(path.join(opts.out, 'board.html'), board);
const pg = await browser.newPage({ viewport: { width: 48 + screens.length * opts.modes.length * 253, height: 600 }, deviceScaleFactor: 1.5 });
await pg.goto(pathToFileURL(path.join(opts.out, 'board.html')).href);
await pg.waitForTimeout(300);
await pg.screenshot({ path: path.join(opts.out, 'board.png'), fullPage: true });
await browser.close();
console.log(`Wrote ${shots.length} screens and board.png to ${opts.out}`);
