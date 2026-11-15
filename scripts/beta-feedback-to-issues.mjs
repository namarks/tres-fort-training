#!/usr/bin/env node
// Mirror TestFlight beta feedback into GitHub issues.
//
// Pulls screenshot + crash feedback from App Store Connect and opens one
// GitHub issue per submission. Idempotent: each issue body carries an
// `<!-- asc-feedback:<id> -->` marker and every existing issue is scanned for
// it (and for the `<!-- ASC-ID: <id> -->` marker an earlier mirror wrote), so
// re-running never creates duplicates. Private destinations only, by opt-in.
//
// Auth (no secrets committed — same model as upload-testflight.sh):
//   - App Store Connect: the account-level API key .p8 on disk. Only the
//     key id / issuer id (non-sensitive) live here.
//   - GitHub: the `gh` CLI, using your existing login. An explicit REPO and
//     FEEDBACK_FILE_ISSUES=1 are required; public or unknown destinations fail
//     before App Store Connect authentication or feedback collection.
//
// Usage:
//   FEEDBACK_FILE_ISSUES=1 REPO=owner/private-repo npm run beta:feedback
//   FEEDBACK_FILE_ISSUES=1 REPO=owner/private-repo npm run beta:feedback -- --dry-run
//   # Dry-run reports counts only; read raw feedback privately with beta:feedback:list.
//
// Requires: an ASC API key at ~/.appstoreconnect/private_keys/AuthKey_<ID>.p8
// and an authenticated `gh`. To read feedback without filing anything, use
// scripts/testflight-feedback.mjs. See docs/TESTFLIGHT.md.

import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { feedbackIdFromBody } from "./beta-feedback-marker.mjs";
import { ascToken, collectFeedback, fail, FEEDBACK_SAVE_DIR, findApp } from "./asc-api.mjs";
import { submissionFolderName } from "./testflight-feedback-format.mjs";

const LABEL = "beta-feedback";

function gh(args, opts = {}) {
  try {
    // Never echo subprocess stderr or the command: issue titles are raw feedback.
    return execFileSync("gh", args, {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts,
    });
  } catch {
    throw new Error("GitHub command failed. Check gh authentication and repository permissions.");
  }
}

function configuredDestination(env) {
  if (env.FEEDBACK_FILE_ISSUES !== "1") {
    throw new Error("Raw feedback mirroring is disabled. Read it privately with npm run beta:feedback:list. To opt in to a private destination, set FEEDBACK_FILE_ISSUES=1 and REPO=owner/private-repo.");
  }
  const repo = env.REPO || "";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("Set REPO=owner/private-repo explicitly; the current checkout is never an implicit feedback destination.");
  }
  return repo;
}

function requirePrivateDestination(repo, runGh) {
  let metadata;
  try {
    metadata = JSON.parse(runGh([
      "api", `repos/${repo}`, "--jq", "{full_name, visibility, private}",
    ]));
  } catch {
    throw new Error("Cannot verify the feedback destination is private. No feedback will be published.");
  }
  if (metadata?.visibility !== "private" || metadata?.private !== true
      || typeof metadata?.full_name !== "string"
      || metadata.full_name.toLowerCase() !== repo.toLowerCase()) {
    throw new Error("Raw TestFlight feedback can only be mirrored to a verified private repository. Public, internal, redirected, or unknown destinations are refused, including dry-runs.");
  }
}

// Existing issues already filed from feedback, keyed by ASC submission id.
// Fully paginated so the dedup scan never silently drops older markers once
// the repo has many mirrored issues — `gh issue list --limit N` would cap.
// `--paginate --jq` applies the filter per page and concatenates, yielding
// newline-delimited JSON across all pages (plain `--paginate` would emit one
// separate JSON array per page, which JSON.parse can't read; `--slurp` can't
// be combined with `--jq`). Deliberately NOT filtered by label: an earlier
// mirror filed its issues under `testflight-feedback` with an
// `<!-- ASC-ID: <id> -->` marker, and those must dedup too — so every issue
// is scanned and both marker syntaxes are recognised (see
// beta-feedback-marker.mjs). The issues endpoint also returns pull requests;
// the jq filter drops them.
function existingFeedbackIds(repo, runGh) {
  const out = runGh([
    "api", "--paginate",
    `repos/${repo}/issues?state=all&per_page=100`,
    "--jq", ".[] | select(.pull_request == null) | {number, body}",
  ]);
  const ids = new Map();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    let it;
    try { it = JSON.parse(line); }
    catch { throw new Error("Could not read existing feedback issue markers; refusing to risk duplicate issues."); }
    const id = feedbackIdFromBody(it.body);
    if (id) ids.set(id, it.number);
  }
  return ids;
}

// Provision every label the run may apply. Crash submissions add `crash`; if
// it didn't exist, `gh issue create` would fail on the first crash and abort
// the whole sync, so create it up front alongside beta-feedback.
function ensureLabels(repo, runGh) {
  const defs = [
    [LABEL, "D93F0B", "Auto-filed from TestFlight beta feedback"],
    ["crash", "B60205", "TestFlight crash feedback"],
  ];
  for (const [name, color, description] of defs) {
    requirePrivateDestination(repo, runGh);
    try {
      runGh(["label", "create", name, "--repo", repo, "--color", color,
        "--description", description], { stdio: "ignore" });
    } catch {
      // already exists — fine
    }
  }
}

function truncate(s, n) {
  s = (s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function metaTable(a, build, tester) {
  const rows = [
    ["Submitted", a.createdDate],
    ["Build", build ? `${build}` : a.buildBundleId || "—"],
    ["Device", [a.deviceModel, a.osVersion && `iOS ${a.osVersion}`].filter(Boolean).join(" · ")],
    ["Locale / TZ", [a.locale, a.timeZone].filter(Boolean).join(" · ") || "—"],
    ["Tester", tester || a.email || "—"],
  ];
  if (a.batteryPercentage != null || a.appUptimeInMilliseconds != null) {
    const battery = a.batteryPercentage != null ? `${a.batteryPercentage}%` : null;
    const uptime =
      a.appUptimeInMilliseconds != null ? `${Math.round(a.appUptimeInMilliseconds / 1000)}s uptime` : null;
    rows.push(["State", [battery, uptime].filter(Boolean).join(" · ")]);
  }
  return ["| Field | Value |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
}

function screenshotBlock(a) {
  if (!a.screenshots?.length) return "";
  const lines = a.screenshots.map((s, i) => {
    const exp = s.expirationDate ? ` (link expires ${s.expirationDate})` : "";
    return `- [Screenshot ${i + 1}](${s.url})${exp}`;
  });
  return `\n**Screenshots**${a.screenshots[0].expirationDate ? " — Apple-hosted, time-limited" : ""}:\n${lines.join("\n")}\n`;
}

// Where `npm run beta:feedback:list -- --save` keeps this submission's
// screenshots, which outlive Apple's expiring links. Named only if present.
function localCopyBlock(summary, saveDir) {
  const name = submissionFolderName(summary);
  if (!existsSync(join(saveDir, name))) return "";
  return `\n**Local copy** on the release Mac: \`~/Downloads/testflight-feedback/${name}/\`\n`;
}

function makeIssue(kind, sub, build, tester, summary, saveDir) {
  const a = sub.attributes;
  const comment = (a.comment || "").trim();
  const isCrash = kind === "crash";
  const title = isCrash
    ? `[Beta crash] ${truncate(comment || `${a.deviceModel || "device"} · iOS ${a.osVersion || "?"}`, 70)}`
    : `[Beta] ${truncate(comment || "(screenshot, no comment)", 70)}`;
  const crashBlock = isCrash && a.crashLog?.url ? `\n**Crash log** (expires ${a.crashLog.expirationDate || "soon"}): ${a.crashLog.url}\n` : "";
  const body = [
    comment ? `> ${comment}` : "_(no comment provided)_",
    "",
    metaTable(a, build, tester),
    screenshotBlock(a),
    crashBlock,
    localCopyBlock(summary, saveDir),
    "---",
    "_Filed automatically from App Store Connect → TestFlight → Feedback._",
    `<!-- asc-feedback:${sub.id} -->`,
  ].join("\n");
  return { title, body, labels: isCrash ? [LABEL, "crash"] : [LABEL] };
}

// Dependencies are injected only by tests; the CLI always uses the real clients.
export async function mirrorFeedback({
  env = process.env, dryRun = false, runGh = gh, tokenForAsc = ascToken,
  find = findApp, collect = collectFeedback, log = console.log,
  saveDir = FEEDBACK_SAVE_DIR,
} = {}) {
  const repo = configuredDestination(env);
  requirePrivateDestination(repo, runGh);
  const token = tokenForAsc();
  const app = await find(token);
  const feedback = await collect(token, app.id);

  // Visibility can change while the provider request is running. Recheck it
  // before each GitHub mutation too; publication must stop all mirror jobs.
  requirePrivateDestination(repo, runGh);
  if (!feedback.length) {
    log("No feedback submissions to mirror.");
    return;
  }
  const existing = existingFeedbackIds(repo, runGh);
  if (!dryRun) ensureLabels(repo, runGh);

  let created = 0;
  for (const { kind, sub, build, tester, summary } of feedback) {
    if (existing.has(sub.id)) continue;
    if (dryRun) {
      created++;
      continue; // Raw titles, comments, tester details and links stay out of logs.
    }
    requirePrivateDestination(repo, runGh);
    const { title, body, labels } = makeIssue(kind, sub, build, tester, summary, saveDir);
    const dir = mkdtempSync(join(tmpdir(), "asc-fb-"));
    const tmp = join(dir, "body.md");
    try {
      writeFileSync(tmp, body, { mode: 0o600 });
      const labelArgs = labels.flatMap((l) => ["--label", l]);
      runGh([
        "issue", "create", "--repo", repo,
        "--title", title, "--body-file", tmp, ...labelArgs,
      ]);
      created++;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  log(`${dryRun ? "[dry-run] " : ""}${created} new, ${feedback.length - created} already filed. Raw feedback is omitted from this log.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run" && arg !== "--help")) {
    fail("Unknown argument. Use --help for usage; only --dry-run and --help are accepted.");
  }
  if (args.includes("--help")) {
    console.log(`Usage: FEEDBACK_FILE_ISSUES=1 REPO=owner/private-repo npm run beta:feedback -- [--dry-run]

Mirrors raw TestFlight feedback only to an explicitly verified private repository.
--dry-run  Report counts only; do not create issues or labels.
--help     Print this usage without contacting GitHub or App Store Connect.

For private local reading and preservation, use npm run beta:feedback:list -- --save.`);
  } else {
    mirrorFeedback({ dryRun: args.includes("--dry-run") })
      .catch((error) => fail(error.message));
  }
}
