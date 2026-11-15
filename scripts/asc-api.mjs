// Minimal App Store Connect API client for the TestFlight feedback scripts.
//
// Auth: the account-level ASC API key (team 8BA2RY6RCA, App Manager), the
// same one upload-testflight.sh and the Fastfile use. On the release Mac it is
// the .p8 in ~/.appstoreconnect/private_keys/; in the project's cloud
// environment it is the ASC_KEY_ID / ASC_ISSUER_ID / ASC_PRIVATE_KEY env vars,
// which win when ASC_PRIVATE_KEY is set. Only the default key id / issuer id
// (non-sensitive) live here; the key itself is never committed or printed.

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isOnOrAfter, summarizeSubmission } from "./testflight-feedback-format.mjs";

const ENV_KEY = process.env.ASC_PRIVATE_KEY || "";
export const KEY_ID = (ENV_KEY && process.env.ASC_KEY_ID) || "VP9G3R7Q85";
export const ISSUER_ID = (ENV_KEY && process.env.ASC_ISSUER_ID) || "b169cd8d-cb73-4efc-8d72-8c92c5ad29ed";
export const BUNDLE_ID = "com.nmarkspdx.tresfort";
export const P8_PATH = join(homedir(), ".appstoreconnect", "private_keys", `AuthKey_${KEY_ID}.p8`);
const API = "https://api.appstoreconnect.apple.com";

// Where `testflight-feedback.mjs --save` keeps local copies. Downloads is a
// folder Claude threads may already read on the release Mac.
export const FEEDBACK_SAVE_DIR = join(homedir(), "Downloads", "testflight-feedback");

export function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/** A 10-minute ES256 JWT signed with the on-disk key. */
export function ascToken() {
  let p8 = ENV_KEY.replace(/\\n/g, "\n");
  if (!p8) {
    try {
      p8 = readFileSync(P8_PATH, "utf8");
    } catch {
      fail(`Missing ASC API key: set ASC_PRIVATE_KEY or install ${P8_PATH}`);
    }
  }
  const b64 = (b) => Buffer.from(b).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const payload = b64(
    JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }),
  );
  const signingInput = `${header}.${payload}`;
  const sig = crypto.sign("sha256", Buffer.from(signingInput), {
    key: p8,
    dsaEncoding: "ieee-p1363", // JOSE wants raw r||s, not DER
  });
  return `${signingInput}.${b64(sig)}`;
}

/** GET one ASC path; fails loudly on anything but 200. */
export async function asc(token, path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (res.status !== 200) {
    fail(`ASC ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

/**
 * POST / PATCH / DELETE one ASC path with a JSON:API body. Returns the parsed
 * body (or {} for 204). Fails loudly unless the status is 2xx; Apple's error
 * `detail` text is printed so a refused change explains itself.
 */
export async function ascSend(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status < 200 || res.status >= 300) {
    const details = (json.errors || []).map((e) => e.detail || e.title).filter(Boolean).join("; ");
    throw new Error(`ASC ${method} ${path} -> ${res.status}: ${details || JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

// Walk every page of a list endpoint, gathering data + included resources.
// Follows links.next until exhausted so a large first-time backfill is never
// silently truncated. `stopAfterPage(pageData)` lets a newest-first caller
// stop once a page reaches older rows it does not need. MAX_PAGES is only a
// runaway guard (≈50k submissions at limit=50) and fails LOUDLY if hit.
const MAX_PAGES = 1000;
export async function ascAll(token, startPath, stopAfterPage = () => false) {
  const data = [];
  const included = [];
  let path = startPath;
  for (let page = 0; path; page++) {
    if (page >= MAX_PAGES) {
      fail(`ASC pagination exceeded ${MAX_PAGES} pages for ${startPath} — aborting (runaway guard)`);
    }
    const body = await asc(token, path);
    const pageData = body.data || [];
    data.push(...pageData);
    included.push(...(body.included || []));
    if (stopAfterPage(pageData)) break;
    const next = body.links?.next;
    path = next ? next.replace(API, "") : null;
  }
  return { data, included };
}

/** The Tres Fort app resource in App Store Connect. */
export async function findApp(token) {
  const apps = await asc(token, `/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  const app = apps.data?.[0];
  if (!app) fail(`No App Store Connect app for bundle ${BUNDLE_ID}`);
  return app;
}

/**
 * Every screenshot and crash feedback submission, newest first. With
 * `cutoffMs`, only submissions created at or after it (and pagination stops
 * at the first page that reaches older ones). Each entry carries the raw
 * resource, its build version and tester name, and a flat `summary`.
 */
export async function collectFeedback(token, appId, { cutoffMs } = {}) {
  const out = [];
  for (const [kind, resource] of [
    ["screenshot", "betaFeedbackScreenshotSubmissions"],
    ["crash", "betaFeedbackCrashSubmissions"],
  ]) {
    const stop =
      cutoffMs == null
        ? () => false
        : (page) => page.some((s) => !isOnOrAfter(s.attributes?.createdDate, cutoffMs));
    const { data, included } = await ascAll(
      token,
      `/v1/apps/${appId}/${resource}?limit=50&sort=-createdDate&include=build,tester`,
      stop,
    );
    const buildsById = new Map(included.filter((x) => x.type === "builds").map((b) => [b.id, b.attributes]));
    const testersById = new Map(included.filter((x) => x.type === "betaTesters").map((t) => [t.id, t.attributes]));
    for (const sub of data) {
      if (cutoffMs != null && !isOnOrAfter(sub.attributes?.createdDate, cutoffMs)) continue;
      const summary = summarizeSubmission(kind, sub, buildsById, testersById);
      out.push({ kind, sub, build: summary.build, tester: summary.tester, summary });
    }
  }
  out.sort((x, y) => (y.summary.createdDate || "").localeCompare(x.summary.createdDate || ""));
  return out;
}

/** A crash submission's log text, or null when Apple has none for it. */
export async function crashLogText(token, submissionId) {
  const res = await fetch(`${API}/v1/betaFeedbackCrashSubmissions/${submissionId}/crashLog`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) return null;
  const json = await res.json().catch(() => ({}));
  return json?.data?.attributes?.logText || null;
}
