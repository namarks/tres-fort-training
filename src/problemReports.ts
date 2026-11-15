/**
 * A problem a member reports from the app (migration 0077,
 * docs/DIAGNOSTICS.md): what kind, what happened in their words, an
 * optional way to reply, an optional screenshot, an optional activity, and
 * the app's version and device. This module validates the fields of
 * `POST /api/me/problem-reports` (multipart form data) and owns the
 * `context` JSON's shape. Pure: no database.
 */

export const PROBLEM_REPORT_KINDS = ['bug', 'activity', 'feedback'] as const;
export type ProblemReportKind = (typeof PROBLEM_REPORT_KINDS)[number];

export const PROBLEM_REPORT_LIMITS = {
  messageChars: 4000,
  contactChars: 200,
  contextFieldChars: 80,
  /** A phone screenshot, downscaled and compressed by the app. */
  screenshotBytes: 1_000_000,
  /** Reports one member can send in a day. */
  perDay: 20,
  /** How long an attached activity's details stay readable by support. */
  activityAccessMs: 14 * 24 * 60 * 60 * 1000,
} as const;

/** The app and device a report came from, so support needn't ask. */
export interface ProblemReportContext {
  platform: 'ios' | 'web' | null;
  app_version: string | null;
  build: string | null;
  os_version: string | null;
  device: string | null;
  /** Where the member started the report: `profile` or `activity`. */
  screen: string | null;
}

export const CONTEXT_FIELDS = ['app_version', 'build', 'os_version', 'device', 'screen'] as const;

export interface ProblemReportInput {
  id: string;
  kind: ProblemReportKind;
  message: string;
  contact: string | null;
  activity_id: string | null;
  context: ProblemReportContext;
}

export type ScreenshotType = 'image/jpeg' | 'image/png';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Control characters other than tab and line breaks. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.replace(CONTROL_RE, '').trim() : null;
}

/** One short context value: a single line, at most 80 characters. */
function contextValue(value: unknown): string | null {
  const v = text(value);
  if (v === null || v.length === 0) return null;
  return v.replace(/\s+/g, ' ').slice(0, PROBLEM_REPORT_LIMITS.contextFieldChars);
}

export type ParsedProblemReport =
  | { ok: true; input: ProblemReportInput }
  | { ok: false; error: string };

/**
 * The report's text fields, from form fields read as strings (a missing
 * field is undefined). Context values are best effort: too long is cut,
 * never refused, so a report is never lost to a long device name.
 */
export function parseProblemReport(fields: Record<string, unknown>): ParsedProblemReport {
  const id = fields.id;
  if (typeof id !== 'string' || !UUID_RE.test(id)) return { ok: false, error: 'invalid_id' };
  const kind = fields.kind;
  if (typeof kind !== 'string' || !(PROBLEM_REPORT_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: 'invalid_kind' };
  }
  const message = text(fields.message);
  if (message === null || message.length === 0) return { ok: false, error: 'missing_message' };
  if (message.length > PROBLEM_REPORT_LIMITS.messageChars) return { ok: false, error: 'message_too_long' };
  let contact: string | null = null;
  if (fields.contact !== undefined && fields.contact !== null) {
    contact = text(fields.contact);
    if (contact === null) return { ok: false, error: 'invalid_contact' };
    if (contact.length > PROBLEM_REPORT_LIMITS.contactChars) return { ok: false, error: 'contact_too_long' };
    if (contact.length === 0) contact = null;
  }
  let activityId: string | null = null;
  if (fields.activity_id !== undefined && fields.activity_id !== null && fields.activity_id !== '') {
    if (typeof fields.activity_id !== 'string' || fields.activity_id.length > 300) {
      return { ok: false, error: 'invalid_activity_id' };
    }
    activityId = fields.activity_id;
  }
  const platform = fields.platform === 'ios' || fields.platform === 'web' ? fields.platform : null;
  const context: ProblemReportContext = {
    platform,
    app_version: contextValue(fields.app_version),
    build: contextValue(fields.build),
    os_version: contextValue(fields.os_version),
    device: contextValue(fields.device),
    screen: contextValue(fields.screen),
  };
  return {
    ok: true,
    input: { id: id.toLowerCase(), kind: kind as ProblemReportKind, message, contact, activity_id: activityId, context },
  };
}

/** A screenshot's type from its first bytes: JPEG or PNG only. */
export function screenshotType(bytes: Uint8Array): ScreenshotType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) return 'image/png';
  return null;
}

/** The stored context, tolerating anything an older row holds. */
export function parseStoredContext(text: unknown): ProblemReportContext | null {
  if (typeof text !== 'string') return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ProblemReportContext) : null;
  } catch {
    return null;
  }
}

/** D1 returns a BLOB as an array of numbers or a buffer, by runtime. */
export function blobBytes(value: ArrayBuffer | number[] | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

/** Base64 of any size, in chunks so a large image can't overflow the stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
