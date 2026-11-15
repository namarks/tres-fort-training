#!/usr/bin/env node
// List recent TestFlight feedback from App Store Connect, read-only.
//
// Prints screenshot and crash feedback (comment, tester, build, device) and,
// with --save, keeps a local copy of each submission: feedback.md, the
// screenshots (Apple's links expire) and a crash's log. Never writes to
// GitHub or App Store Connect. Needs the ASC API key on the release Mac; see
// docs/TESTFLIGHT.md.
//
// Usage:
//   node scripts/testflight-feedback.mjs                  # last 14 days
//   node scripts/testflight-feedback.mjs --days 3 --tester geoff
//   node scripts/testflight-feedback.mjs --all --json
//   node scripts/testflight-feedback.mjs --save           # ~/Downloads/testflight-feedback
//   node scripts/testflight-feedback.mjs --save /some/dir

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ascToken, collectFeedback, crashLogText, fail, FEEDBACK_SAVE_DIR, findApp } from "./asc-api.mjs";
import {
  feedbackMarkdown,
  screenshotFileName,
  submissionFolderName,
  summaryLine,
} from "./testflight-feedback-format.mjs";

function parseArgs(argv) {
  const opts = { days: 14, all: false, json: false, save: null, tester: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v == null || v.startsWith("--")) fail(`${arg} needs a value`);
      i++;
      return v;
    };
    if (arg === "--days") {
      opts.days = Number(value());
      if (!Number.isFinite(opts.days) || opts.days <= 0) fail("--days must be a positive number");
    } else if (arg === "--all") opts.all = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--tester") opts.tester = value().toLowerCase();
    else if (arg === "--save") {
      const next = argv[i + 1];
      opts.save = next && !next.startsWith("--") ? resolve(argv[++i]) : FEEDBACK_SAVE_DIR;
    } else if (arg === "-h" || arg === "--help") {
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 17).join("\n"));
      process.exit(0);
    } else fail(`unknown option ${arg}`);
  }
  return opts;
}

async function download(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()), { mode: 0o600 });
}

// Save one submission. Idempotent: files already on disk are kept, so a
// re-run only fills in what an earlier run could not download.
async function saveSubmission(token, dir, s) {
  const folder = join(dir, submissionFolderName(s));
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const files = [];
  const problems = [];
  for (const [i, shot] of s.screenshots.entries()) {
    const name = screenshotFileName(i, shot.url);
    const path = join(folder, name);
    if (!existsSync(path)) {
      try {
        await download(shot.url, path);
      } catch (e) {
        problems.push(`${name}: ${e.message}`);
        continue;
      }
    }
    files.push(name);
  }
  if (s.kind === "crash") {
    const path = join(folder, "crash.log");
    if (!existsSync(path)) {
      const text = await crashLogText(token, s.id);
      if (text) writeFileSync(path, text, { mode: 0o600 });
      else problems.push("crash.log: not available");
    }
    if (existsSync(path)) files.push("crash.log");
  }
  writeFileSync(join(folder, "feedback.md"), feedbackMarkdown(s, files), { mode: 0o600 });
  return { folder, problems };
}

// index.md lists every saved submission, newest first, with its comment's
// first line, so a reader can find the right folder without opening each.
function writeIndex(dir) {
  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "feedback.md")))
    .map((d) => d.name)
    .sort()
    .reverse();
  const rows = folders.map((name) => {
    const md = readFileSync(join(dir, name, "feedback.md"), "utf8");
    const quote = md.split("\n").find((l) => l.startsWith("> ") || l.startsWith("_(no comment"));
    const tester = /\| Tester \| (.*) \|/.exec(md)?.[1] || "—";
    const text = (quote || "").replace(/^> /, "").slice(0, 100);
    return `- [${name}](${name}/feedback.md) — ${tester}: ${text}`;
  });
  writeFileSync(
    join(dir, "index.md"),
    [`# TestFlight feedback`, "", `Updated ${new Date().toISOString()}.`, "", ...rows, ""].join("\n"),
    { mode: 0o600 },
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const token = ascToken();
  const app = await findApp(token);
  const cutoffMs = opts.all ? undefined : Date.now() - opts.days * 86_400_000;
  let feedback = (await collectFeedback(token, app.id, { cutoffMs })).map((f) => f.summary);
  if (opts.tester) {
    feedback = feedback.filter((s) => (s.tester || "").toLowerCase().includes(opts.tester));
  }

  if (opts.json) {
    console.log(JSON.stringify(feedback, null, 2));
  } else {
    const range = opts.all ? "all time" : `last ${opts.days} day(s)`;
    console.log(`${app.attributes?.name}: ${feedback.length} feedback submission(s), ${range}.\n`);
    for (const s of feedback) console.log(`${summaryLine(s)}\n`);
  }

  if (opts.save) {
    mkdirSync(opts.save, { recursive: true, mode: 0o700 });
    let problemCount = 0;
    for (const s of feedback) {
      const { folder, problems } = await saveSubmission(token, opts.save, s);
      problemCount += problems.length;
      for (const p of problems) console.error(`warning: ${folder}: ${p}`);
    }
    writeIndex(opts.save);
    console.error(`Saved ${feedback.length} submission(s) under ${opts.save}${problemCount ? ` (${problemCount} warning(s))` : ""}.`);
  }
}

main().catch((e) => fail(e?.stack || String(e)));
