#!/usr/bin/env node
// Apple Watch screens for the mock kit (docs/plans/apple-watch): Today on the
// wrist, lifting from the wrist and runs, at 208 x 248 points (Apple Watch
// Series 10, 46 mm). Colors are the app's dark-mode tokens, read from
// ios/Shared/BrandPalette.swift like every other mock; watchOS has one
// appearance. Writes watch-options.png (all three groups) and one PNG per
// group into out/, or the folder given.
//
//   node design/mock-kit/watch.mjs [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readPalette } from './tokens.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(here, 'out'));
const t = readPalette().dark; // watchOS is always dark
const font = (f) => pathToFileURL(path.join(repo, 'ios/TresFort/Fonts', f)).href;

const css = `
@font-face { font-family: Bebas; src: url('${font('BebasNeue-Regular.ttf')}'); }
@font-face { font-family: JBM; font-weight: 700; src: url('${font('JetBrainsMono-Bold.ttf')}'); }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 32px 36px; background: #e9edf2; color: #0f1d2f;
  font: 15px/1.35 Inter, -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
h1 { font: 400 40px/1 Bebas, sans-serif; letter-spacing: .02em; margin: 0 0 4px; }
.lede { color: #525f6f; max-width: 980px; margin: 0 0 22px; }
.band { background: #fdfdfe; border-radius: 22px; padding: 20px 22px 22px; margin-bottom: 18px; box-shadow: 0 1px 3px rgb(15 29 47 / .06); }
.band h2 { margin: 0; font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
.band p { margin: 4px 0 16px; color: #525f6f; max-width: 940px; }
.tags { display: inline-flex; gap: 6px; }
.tag { font-size: 11px; font-weight: 800; letter-spacing: .6px; padding: 3px 8px; border-radius: 7px; background: #15273e; color: #fff; }
.tag.o { background: #ee694f; color: #091628; }
.row { display: flex; gap: 26px; flex-wrap: wrap; }
figure { margin: 0; width: 232px; }
figcaption { font-size: 12.5px; color: #525f6f; margin-top: 9px; line-height: 1.35; }
figcaption b { color: #0f1d2f; display: block; font-size: 13px; }

/* The watch: a 208 x 248 pt screen in a case with a crown. */
.case { position: relative; width: 232px; height: 272px; border-radius: 62px; background: #1b1d21; padding: 12px;
  box-shadow: inset 0 0 0 2px #33363c, 0 6px 18px rgb(15 29 47 / .18); }
.case::after { content: ''; position: absolute; right: -7px; top: 78px; width: 9px; height: 44px; border-radius: 4px; background: #2b2e33; }
.case.crown::after { background: ${t.signal}; box-shadow: 0 0 0 2px rgb(236 120 89 / .3); }
.scr { position: relative; width: 208px; height: 248px; border-radius: 50px; background: #000; overflow: hidden; color: ${t.text};
  font: 15px/1.25 Inter, -apple-system, sans-serif; padding: 0 12px 12px; display: flex; flex-direction: column; }
.top { height: 34px; flex: none; display: flex; align-items: flex-end; justify-content: space-between; padding: 0 14px 3px 16px; font-size: 14px; font-weight: 600; }
.top .ttl { color: ${t.signal}; }
.top .clk { color: ${t.text}; font-variant-numeric: tabular-nums; }
.lbl { font-size: 10px; font-weight: 800; letter-spacing: 1.1px; text-transform: uppercase; color: ${t.muted}; }
.lbl.sig { color: ${t.signal}; }
.disp { font: 400 30px/1 Bebas, sans-serif; letter-spacing: .01em; }
.num { font-family: JBM, monospace; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
.muted { color: ${t.muted}; } .ok { color: ${t.done}; } .acc { color: ${t.accent}; }
.sm { font-size: 12.5px; } .xs { font-size: 11.5px; }
.hero { background: ${t.hero}; border: 1px solid ${t.heroEdge}; border-radius: 18px; padding: 10px 12px 11px; }
.card { background: ${t.surface}; border-radius: 14px; padding: 8px 11px; }
.btn { display: flex; align-items: center; justify-content: center; height: 40px; border-radius: 20px; font-size: 16px; font-weight: 700; flex: none; }
.btn.go { background: ${t.signalFill}; color: ${t.onSignal}; }
.btn.quiet { background: ${t.surface2}; color: ${t.text}; }
.btn.tint { background: rgb(151 186 231 / .2); color: ${t.accent}; }
.btn.s { height: 34px; font-size: 14.5px; }
.sp { flex: 1; } .r { display: flex; align-items: center; gap: 6px; } .c { text-align: center; }
.bar { height: 5px; border-radius: 3px; background: ${t.heroRaised}; overflow: hidden; } .bar i { display: block; height: 100%; background: ${t.signal}; }
.dots { display: flex; gap: 5px; justify-content: center; } .dots i { width: 5px; height: 5px; border-radius: 3px; background: ${t.dim}; } .dots i.on { background: ${t.text}; }
.field { border-radius: 12px; padding: 5px 9px 6px; background: ${t.surface}; flex: 1; text-align: center; }
.field.on { box-shadow: 0 0 0 2px ${t.signal}; }
.face { background: radial-gradient(160px at 50% 40%, #16263b, #000 80%); }
`;

const check = `<svg width="13" height="13" viewBox="0 0 13 13"><circle cx="6.5" cy="6.5" r="6.5" fill="${t.done}"/><path d="M3.6 6.7l2 2 3.9-4.2" stroke="#06140a" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const heart = `<svg width="13" height="12" viewBox="0 0 13 12"><path d="M6.5 11.3C2.2 8.2.6 6.1.6 3.9A3 3 0 0 1 6.5 2.6 3 3 0 0 1 12.4 3.9c0 2.2-1.6 4.3-5.9 7.4z" fill="${t.danger}"/></svg>`;
const top = (ttl, clk = '9:41') => `<div class="top"><span class="ttl">${ttl}</span><span class="clk">${clk}</span></div>`;
const ring = (frac, label, sub) => {
  const r = 54, c = 2 * Math.PI * r;
  return `<div style="position:relative;width:128px;height:128px;margin:0 auto">
  <svg width="128" height="128" viewBox="0 0 128 128"><circle cx="64" cy="64" r="${r}" fill="none" stroke="${t.surface2}" stroke-width="9"/>
  <circle cx="64" cy="64" r="${r}" fill="none" stroke="${t.signal}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 64 64)"/></svg>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
  <span class="num" style="font-size:34px">${label}</span><span class="lbl" style="margin-top:4px">${sub}</span></div></div>`;
};

const S = {};
// ---- Today on the wrist ---------------------------------------------------
S.today = { cap: ['Today', 'The same day list as the iPhone: finished rows shrink, the next item sits on navy with Start.'], html: `${top('Today')}
  <div class="lbl" style="padding:2px 4px 6px">Thu Nov 13</div>
  <div class="r sm muted" style="padding:0 4px 7px">${check}<span>Easy run · 3.1 mi</span></div>
  <div class="hero"><div class="lbl sig">Up next · 5:30 PM</div>
    <div class="disp" style="margin-top:5px">Lower Body</div>
    <div class="xs muted" style="margin:3px 0 9px">5 exercises · 45 min</div>
    <div class="btn go s">Start</div></div>` };
S.face = { cap: ['On the watch face', 'A complication shows what is next today and opens the app there.'], cls: 'face', html: `
  <div style="display:flex;justify-content:space-between;padding:20px 8px 0"><div class="lbl" style="color:${t.signal}">Thu 13</div><div class="lbl">62°</div></div>
  <div class="num c" style="font-size:66px;margin-top:22px;letter-spacing:-2px">9:41</div>
  <div class="sp"></div>
  <div class="card" style="background:${t.hero};margin-bottom:8px"><div class="lbl sig">Tres Fort · 5:30 PM</div>
  <div style="font-weight:700;font-size:15px;margin-top:2px">Lower Body</div><div class="xs muted">5 exercises · 45 min</div></div>` };
S.rest = { cap: ['Rest day', 'A rest day says so and shows what is coming next.'], html: `${top('Today')}
  <div class="lbl" style="padding:2px 4px 6px">Fri Nov 14</div>
  <div class="card" style="padding:12px"><div class="disp">Rest day</div><div class="xs muted" style="margin-top:4px">Nothing planned today.</div></div>
  <div class="lbl" style="padding:12px 4px 5px">Coming up</div>
  <div class="card"><div class="xs muted">Sat</div><div style="font-weight:600;font-size:14px">Tempo run · 4 × 4 min</div></div>` };

// ---- Lifting ---------------------------------------------------------------
S.set = { cap: ['Log a set', 'The set the iPhone runner is on. One tap logs it as planned.'], html: `${top('Lower Body')}
  <div class="lbl sig" style="padding:2px 4px 0">Set 2 of 4</div>
  <div style="font-weight:700;font-size:18px;padding:1px 4px 0">Back Squat</div>
  <div class="sp"></div>
  <div class="r" style="justify-content:center;align-items:baseline;gap:5px"><span class="num" style="font-size:40px">185</span><span class="sm muted">lb</span><span class="num muted" style="font-size:22px;margin:0 2px">×</span><span class="num" style="font-size:40px">5</span></div>
  <div class="xs muted c" style="margin-top:5px">Last time 180 × 5</div>
  <div class="sp"></div>
  <div class="btn go">Log set</div>` };
S.adjust = { crown: true, cap: ['Change the load or reps', 'Tap a number, then turn the crown. Loads step by the plate you can add.'], html: `${top('Back Squat')}
  <div class="lbl sig" style="padding:2px 4px 8px">Set 2 of 4</div>
  <div class="r" style="gap:8px"><div class="field on"><div class="num" style="font-size:32px">190</div><div class="lbl" style="margin-top:3px">lb</div></div>
  <div class="field"><div class="num" style="font-size:32px">5</div><div class="lbl" style="margin-top:3px">reps</div></div></div>
  <div class="xs muted c" style="margin-top:8px">Planned 185 × 5</div>
  <div class="sp"></div>
  <div class="btn go">Log 190 × 5</div>` };
S.resting = { cap: ['Rest', 'The rest counts down with a tap on the wrist at zero. Next set is shown.'], html: `${top('Rest')}
  ${ring(0.6, '1:12', 'Rest')}
  <div class="xs muted c" style="margin:5px 0 7px">Next <b style="color:${t.text}">Set 3 · 185 × 5</b></div>
  <div class="sp"></div>
  <div class="btn tint s">End rest</div>` };
S.done = { cap: ['Finish', 'The last set offers Finish. The summary matches the iPhone.'], html: `${top('Lower Body')}
  <div class="c" style="margin-top:8px">${check.replace(/13/g, '26').replace('viewBox="0 0 26 26"', 'viewBox="0 0 13 13"')}</div>
  <div class="disp c" style="margin-top:6px">Workout done</div>
  <div class="r" style="justify-content:space-around;margin-top:12px">
    <div class="c"><div class="num" style="font-size:20px">42</div><div class="lbl">min</div></div>
    <div class="c"><div class="num" style="font-size:20px">18</div><div class="lbl">sets</div></div>
    <div class="c"><div class="num" style="font-size:20px">12.4k</div><div class="lbl">lb</div></div></div>
  <div class="sp"></div>
  <div class="btn quiet s">Done</div>` };

// ---- Runs ------------------------------------------------------------------
S.runStart = { cap: ['Start a run', 'Today’s planned run with its steps, or an open run with no plan.'], html: `${top('Run')}
  <div class="hero" style="margin-top:2px"><div class="lbl sig">Planned run</div>
    <div class="disp" style="margin-top:5px">4 × 4 min</div>
    <div class="xs muted" style="margin:3px 0 9px">at 6:00–6:15 /mi · 38 min</div>
    <div class="btn go s">Start</div></div>
  <div class="sp"></div>
  <div class="btn quiet s">Open run</div>` };
S.runStep = { cap: ['The step you are on', 'Time left, pace against the target and heart rate. A haptic marks each step and off-target pace.'], html: `${top('18:18')}
  <div class="lbl sig" style="padding:2px 4px 0">Rep 2 of 4</div>
  <div class="r" style="align-items:baseline;padding:2px 4px 0"><span class="num" style="font-size:50px;color:${t.accent}">1:42</span><span class="lbl">left</span></div>
  <div class="bar" style="margin:8px 4px 0"><i style="width:57%"></i></div>
  <div class="sp"></div>
  <div class="r" style="padding:0 4px;align-items:flex-end"><div><div class="num" style="font-size:26px">6:08</div><div class="xs ok" style="margin-top:3px">✓ 6:00–6:15 /mi</div></div>
  <span class="sp"></span><div style="text-align:right"><div class="num" style="font-size:26px">164</div><div class="r xs muted" style="justify-content:flex-end;margin-top:3px">${heart} bpm</div></div></div>
  <div class="xs muted" style="padding:8px 4px 6px">Next <b style="color:${t.text}">2 min recovery</b></div>
  <div class="dots"><i class="on"></i><i></i><i></i></div>` };
S.runTotals = { cap: ['The whole run', 'Swipe for totals: time, distance, pace and heart rate from the wrist.'], html: `${top('Run')}
  <div class="num" style="font-size:44px;padding:4px 4px 0;color:${t.accent}">18:18</div>
  <div class="sp"></div>
  <div class="r" style="padding:0 4px;align-items:flex-end"><div><div class="num" style="font-size:26px">2.31</div><div class="lbl" style="margin-top:3px">mi</div></div>
  <span class="sp"></span><div style="text-align:right"><div class="num" style="font-size:26px">7:55</div><div class="lbl" style="margin-top:3px">avg /mi</div></div></div>
  <div class="r" style="padding:10px 4px 0;align-items:flex-end"><div><div class="num" style="font-size:26px">164</div><div class="r xs muted" style="margin-top:3px">${heart} bpm</div></div>
  <span class="sp"></span><div style="text-align:right"><div class="num" style="font-size:26px">112</div><div class="lbl" style="margin-top:3px">ft climb</div></div></div>
  <div class="sp"></div>
  <div class="dots"><i></i><i class="on"></i><i></i></div>` };
S.runPaused = { cap: ['Pause and finish', 'Pause, resume or finish from the wrist. The run saves to Tres Fort through the iPhone.'], html: `${top('Paused')}
  <div class="num c" style="font-size:38px;margin-top:6px">18:18</div>
  <div class="xs muted c" style="margin-top:4px">2.31 mi · 7:55 /mi</div>
  <div class="sp"></div>
  <div class="btn go">Resume</div>
  <div class="btn quiet s" style="margin-top:8px">Finish</div>` };

const fig = (k) => `<figure><div class="case${S[k].crown ? ' crown' : ''}"><div class="scr ${S[k].cls ?? ''}">${S[k].html}</div></div>
<figcaption><b>${S[k].cap[0]}</b>${S[k].cap[1]}</figcaption></figure>`;
const band = (title, tags, text, keys) => `<section class="band"><h2>${title}<span class="tags">${tags}</span></h2><p>${text}</p><div class="row">${keys.map(fig).join('')}</div></section>`;
const tag = (l, o) => `<span class="tag${o ? ' o' : ''}">${l}</span>`;

const bands = {
  today: band('Today on the wrist', tag('A') + tag('B') + tag('C'),
    'In every option. The iPhone sends the day it already shows, so the Watch never signs in or decides what a day is.', ['today', 'face', 'rest']),
  lift: band('Lifting', tag('A') + tag('C'),
    'The Watch drives the iPhone’s set-by-set runner, the way a linked iPad does. The iPhone stays in your pocket or bag and keeps the workout.', ['set', 'adjust', 'resting', 'done']),
  run: band('Runs', tag('B') + tag('C'),
    'The Watch records the run itself with GPS and wrist heart rate. The iPhone shows the same run live and saves it.', ['runStart', 'runStep', 'runTotals', 'runPaused']),
};
const page = (body, w) => `<!doctype html><html><head><meta charset="utf-8"><style>${css} body { width: ${w}px; }</style></head><body>${body}</body></html>`;
const head = `<h1>Tres Fort on Apple Watch</h1><p class="lede">The three scopes put to the owner on 2026-11-22: <b>A</b> lifting from the wrist, <b>B</b> runs from the wrist, <b>C</b> the whole day, lifting built first and runs after. The owner chose C. Black background as watchOS expects, navy for the day’s key card, orange only for the next action and progress. Mocks, not the built app.</p>`;

mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(path.join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright'); }
const browser = await pw.chromium.launch().catch(() => pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
async function shot(name, body, w) {
  const html = path.join(out, `${name}.html`);
  writeFileSync(html, page(body, w));
  const pg = await browser.newPage({ viewport: { width: w + 64, height: 600 }, deviceScaleFactor: 2 });
  await pg.goto(pathToFileURL(html).href);
  await pg.evaluate(() => document.fonts.ready);
  await pg.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  await pg.close();
}
await shot('watch-options', head + bands.today + bands.lift + bands.run, 1140);
await shot('watch-today', bands.today, 1140);
await shot('watch-lifting', bands.lift, 1140);
await shot('watch-runs', bands.run, 1140);
await browser.close();
console.log('wrote', out);
