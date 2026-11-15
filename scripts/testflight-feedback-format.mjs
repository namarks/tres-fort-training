// Pure formatting for TestFlight feedback read from the App Store Connect API.
// Shared by scripts/testflight-feedback.mjs (read-only list + local copies)
// and scripts/beta-feedback-to-issues.mjs (GitHub mirror), and unit tested.
// Kept free of node: imports so the test can load it under the Workers pool.

/**
 * Flatten one betaFeedbackScreenshotSubmissions / betaFeedbackCrashSubmissions
 * resource (plus the `build` and `tester` resources an `include=build,tester`
 * request returned) into the fields a person reads.
 */
export function summarizeSubmission(kind, sub, buildsById, testersById) {
  const a = sub.attributes || {};
  const buildId = sub.relationships?.build?.data?.id;
  const build = buildId ? buildsById.get(buildId) : undefined;
  const testerId = sub.relationships?.tester?.data?.id;
  const t = testerId ? testersById.get(testerId) : undefined;
  const testerName = t ? [t.firstName, t.lastName].filter(Boolean).join(" ").trim() : "";
  return {
    id: sub.id,
    kind,
    createdDate: a.createdDate || null,
    comment: (a.comment || "").trim(),
    build: build?.version || null,
    tester: testerName || t?.email || a.email || null,
    deviceModel: a.deviceModel || null,
    osVersion: a.osVersion || null,
    locale: a.locale || null,
    timeZone: a.timeZone || null,
    batteryPercentage: a.batteryPercentage ?? null,
    appUptimeInMilliseconds: a.appUptimeInMilliseconds ?? null,
    connectionType: a.connectionType || null,
    screenshots: (a.screenshots || [])
      .map((s) => ({ url: screenshotUrl(s), expirationDate: s.expirationDate || null }))
      .filter((s) => s.url),
  };
}

/**
 * A screenshot's download URL. Apple serves a direct `url`; if a template
 * with `{w}`/`{h}`/`{f}` placeholders ever appears, fill it at full size.
 */
export function screenshotUrl(s) {
  const raw = s?.url || s?.templateUrl;
  if (!raw) return null;
  return raw
    .replace("{w}", String(s.width || 2000))
    .replace("{h}", String(s.height || 2000))
    .replace("{f}", "png");
}

/** True when the submission was created at or after `cutoffMs`. */
export function isOnOrAfter(createdDate, cutoffMs) {
  const t = Date.parse(createdDate || "");
  return Number.isFinite(t) && t >= cutoffMs;
}

/**
 * The folder a submission's local copy lives in, e.g.
 * `2026-11-13-screenshot-1a2b3c4d`. Date first so a listing sorts by time;
 * the id prefix keeps it unique and lets the GitHub mirror point at it.
 */
export function submissionFolderName(summary) {
  const date = (summary.createdDate || "").slice(0, 10) || "undated";
  const id = String(summary.id).replace(/[^A-Za-z0-9-]/g, "").slice(0, 8) || "unknown";
  return `${date}-${summary.kind}-${id}`;
}

/** File name for the i-th (0-based) screenshot, keeping a known extension. */
export function screenshotFileName(index, url) {
  const m = /\.(png|jpe?g|heic)(?:[?#]|$)/i.exec(url || "");
  const ext = m ? m[1].toLowerCase().replace("jpeg", "jpg") : "png";
  return `screenshot-${index + 1}.${ext}`;
}

/** One line per submission for the terminal. */
export function summaryLine(s) {
  const when = (s.createdDate || "").replace("T", " ").slice(0, 16);
  const who = s.tester || "unknown tester";
  const where = [s.build && `build ${s.build}`, s.deviceModel, s.osVersion && `iOS ${s.osVersion}`]
    .filter(Boolean)
    .join(" · ");
  const shots = s.screenshots.length ? ` · ${s.screenshots.length} screenshot(s)` : "";
  const text = s.comment ? s.comment.replace(/\s+/g, " ") : "(no comment)";
  return `${when}  [${s.kind}] ${who} — ${where}${shots}\n    ${text}`;
}

/**
 * Markdown for a submission's local `feedback.md`. `files` names what was
 * saved beside it (screenshots, crash log) so a reader can open them.
 */
export function feedbackMarkdown(s, files = []) {
  const rows = [
    ["Submitted", s.createdDate || "—"],
    ["Kind", s.kind],
    ["Tester", s.tester || "—"],
    ["Build", s.build || "—"],
    ["Device", [s.deviceModel, s.osVersion && `iOS ${s.osVersion}`].filter(Boolean).join(" · ") || "—"],
    ["Locale / TZ", [s.locale, s.timeZone].filter(Boolean).join(" · ") || "—"],
  ];
  const state = [
    s.batteryPercentage != null ? `${s.batteryPercentage}% battery` : null,
    s.appUptimeInMilliseconds != null ? `${Math.round(s.appUptimeInMilliseconds / 1000)}s uptime` : null,
    s.connectionType,
  ].filter(Boolean);
  if (state.length) rows.push(["State", state.join(" · ")]);
  rows.push(["Submission id", s.id]);
  const comment = s.comment
    ? s.comment.split("\n").map((l) => `> ${l}`).join("\n")
    : "_(no comment)_";
  const fileList = files.length ? `\n## Files\n\n${files.map((f) => `- [${f}](${f})`).join("\n")}\n` : "";
  return [
    `# TestFlight ${s.kind} feedback`,
    "",
    comment,
    "",
    "| Field | Value |",
    "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, "\\|")} |`),
    fileList,
  ].join("\n");
}
