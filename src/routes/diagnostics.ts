import { Hono, type Context } from 'hono';
import type { Env, HonoEnv } from '../types';
import {
  DIAGNOSTICS_LOOKUPS,
  diagnosticsActivities,
  diagnosticsActivity,
  diagnosticsAudit,
  diagnosticsDays,
  diagnosticsRecordings,
  diagnosticsReport,
  diagnosticsReportScreenshot,
  diagnosticsReports,
  diagnosticsSessions,
  diagnosticsSince,
  diagnosticsSync,
  findOwnerRow,
  isAccountDeletionInProgress,
  memberUsage,
  memberUsageDays,
  recordDiagnosticsRead,
  TEST_MEMBER_APPLE_SUB_PREFIX,
  type DiagnosticsActor,
  type DiagnosticsLookup,
} from '../db';

// Owner diagnostics (docs/DIAGNOSTICS.md): a fixed list of read-only lookups
// of the owner's own data. Two doors, the same lookups:
//
//   /diagnostics/*          Authorization: Bearer <DIAGNOSTICS_TOKEN>, for
//                           Nick's Claude threads. Unset secret = 404.
//   /api/me/diagnostics/*   the owner's own app session (the web page).
//                           Anyone else gets the 404 an unknown route returns.
//
// Both resolve to the distinguished owner only and read the owner's own
// data, except problem reports: every member's reports, and an activity a
// member attached while their 14-day consent lasts. Garmin and WHOOP data
// stays out (src/services/diagnostics.ts). Every lookup is recorded in
// audit_log. Nothing here writes training data.

type DiagnosticsEnv = {
  Bindings: Env;
  Variables: HonoEnv['Variables'] & {
    diagnosticsUserId: string;
    diagnosticsActor: DiagnosticsActor;
  };
};

const ISO_DATE_LENGTH = 10;

/** Today's civil date in UTC, one day early so a member west of UTC still
 * sees all of their own "today": the windows are "at least N days". */
function windowSince(days: number): string {
  return diagnosticsSince(new Date().toISOString().slice(0, ISO_DATE_LENGTH), days + 1);
}

function noStore(c: Context) {
  c.header('Cache-Control', 'no-store');
}

/** The lookups themselves, mounted behind either door. */
function lookupRoutes() {
  const routes = new Hono<DiagnosticsEnv>();
  const audit = (c: Context<DiagnosticsEnv>, lookup: DiagnosticsLookup, params: Record<string, string | number>) =>
    recordDiagnosticsRead(c.env.DB, c.get('diagnosticsUserId'), c.get('diagnosticsActor'), lookup, params);
  const badDays = (c: Context<DiagnosticsEnv>, max: number) =>
    c.json({ error: 'invalid_days', min: 1, max }, 400);

  routes.get('/', (c) => {
    noStore(c);
    return c.json({ lookups: DIAGNOSTICS_LOOKUPS, docs: 'docs/DIAGNOSTICS.md' });
  });

  routes.get('/recordings', async (c) => {
    noStore(c);
    const days = diagnosticsDays(c.req.query('days'), 14, 90);
    if (days === null) return badDays(c, 90);
    await audit(c, 'recordings', { days });
    return c.json(await diagnosticsRecordings(c.env.DB, c.get('diagnosticsUserId'), windowSince(days)));
  });

  routes.get('/activities', async (c) => {
    noStore(c);
    const days = diagnosticsDays(c.req.query('days'), 14, 90);
    if (days === null) return badDays(c, 90);
    await audit(c, 'activities', { days });
    return c.json(await diagnosticsActivities(c.env.DB, c.get('diagnosticsUserId'), windowSince(days)));
  });

  routes.get('/activities/:id', async (c) => {
    noStore(c);
    const id = c.req.param('id');
    if (id.length === 0 || id.length > 300) return c.json({ error: 'invalid_id' }, 400);
    await audit(c, 'activities/:id', { id });
    const found = await diagnosticsActivity(c.env.DB, c.get('diagnosticsUserId'), id);
    if (found.ok) return c.json(found.body);
    return c.json({ error: found.error }, found.error === 'not_found' ? 404 : 403);
  });

  routes.get('/sessions', async (c) => {
    noStore(c);
    const days = diagnosticsDays(c.req.query('days'), 14, 90);
    if (days === null) return badDays(c, 90);
    await audit(c, 'sessions', { days });
    return c.json(await diagnosticsSessions(c.env.DB, c.get('diagnosticsUserId'), windowSince(days)));
  });

  routes.get('/audit', async (c) => {
    noStore(c);
    const days = diagnosticsDays(c.req.query('days'), 7, 30);
    if (days === null) return badDays(c, 30);
    await audit(c, 'audit', { days });
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    return c.json(await diagnosticsAudit(c.env.DB, c.get('diagnosticsUserId'), sinceMs));
  });

  routes.get('/sync', async (c) => {
    noStore(c);
    await audit(c, 'sync', {});
    return c.json(await diagnosticsSync(c.env.DB, c.get('diagnosticsUserId'), windowSince(30)));
  });

  routes.get('/reports', async (c) => {
    noStore(c);
    const days = diagnosticsDays(c.req.query('days'), 30, 90);
    if (days === null) return badDays(c, 90);
    await audit(c, 'reports', { days });
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    return c.json(await diagnosticsReports(c.env.DB, c.get('diagnosticsUserId'), sinceMs));
  });

  routes.get('/reports/:id', async (c) => {
    noStore(c);
    const id = c.req.param('id');
    if (!REPORT_ID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);
    const found = await diagnosticsReport(c.env.DB, c.get('diagnosticsUserId'), id.toLowerCase());
    await audit(c, 'reports/:id', found.ok ? { id, member: found.memberId } : { id });
    if (!found.ok) return c.json({ error: found.error }, 404);
    return c.json(found.body);
  });

  routes.get('/reports/:id/screenshot', async (c) => {
    noStore(c);
    const id = c.req.param('id');
    if (!REPORT_ID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);
    await audit(c, 'reports/:id/screenshot', { id });
    const shot = await diagnosticsReportScreenshot(c.env.DB, id.toLowerCase());
    if (!shot) return c.json({ error: 'not_found' }, 404);
    return new Response(shot.bytes, {
      headers: {
        'Content-Type': shot.contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  });

  return routes;
}

const REPORT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The owner's id, or null when there is none or it is being deleted. */
async function ownerId(env: Env): Promise<string | null> {
  const owner = await findOwnerRow(env.DB, env.OWNER_APPLE_SUB);
  if (!owner || (await isAccountDeletionInProgress(env.DB, owner.id))) return null;
  return owner.id;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Compare two secrets without leaking where they differ. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** At least 32 characters, so a weak secret can't open the door. */
const MIN_TOKEN_LENGTH = 32;

/** `/diagnostics/*`, behind DIAGNOSTICS_TOKEN. */
export const diagnosticsTokenRoutes = new Hono<DiagnosticsEnv>();

diagnosticsTokenRoutes.use('*', async (c, next) => {
  noStore(c);
  const expected = c.env.DIAGNOSTICS_TOKEN;
  // Dormant until the secret is set.
  if (!expected || expected.length < MIN_TOKEN_LENGTH) return c.json({ error: 'not_found' }, 404);
  const header = c.req.header('Authorization') ?? '';
  const match = /^Bearer (\S+)$/.exec(header);
  if (!match || !(await sameSecret(match[1]!, expected))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const userId = await ownerId(c.env);
  if (!userId) return c.json({ error: 'not_found' }, 404);
  c.set('diagnosticsUserId', userId);
  c.set('diagnosticsActor', 'diagnostics');
  await next();
});

diagnosticsTokenRoutes.route('/', lookupRoutes());

/** `/api/me/diagnostics/*`, mounted inside apiRoutes after requireAppJwt. */
export const ownerDiagnosticsRoutes = new Hono<DiagnosticsEnv>();

ownerDiagnosticsRoutes.use('*', async (c, next) => {
  noStore(c);
  const userId = c.get('userId');
  if (c.get('appReview') || userId !== (await ownerId(c.env))) return c.json({ error: 'not_found' }, 404);
  c.set('diagnosticsUserId', userId);
  c.set('diagnosticsActor', c.get('appClient') === 'web' ? 'web' : 'ios');
  await next();
});

// The Members page: every member's app builds, active days and feature
// counts (docs/DIAGNOSTICS.md, "Members"). Only behind the owner's own app
// session, never the diagnostics token, so other members' usage doesn't
// reach the owner's Claude threads.
ownerDiagnosticsRoutes.get('/members', async (c) => {
  noStore(c);
  const days = memberUsageDays(c.req.query('days'));
  if (days === null) return c.json({ error: 'invalid_days', min: 1, max: 365 }, 400);
  const ownerUserId = c.get('diagnosticsUserId');
  await recordDiagnosticsRead(c.env.DB, ownerUserId, c.get('diagnosticsActor'), 'members', { days });
  return c.json(await memberUsage(c.env.DB, ownerUserId, days, TEST_MEMBER_APPLE_SUB_PREFIX));
});

ownerDiagnosticsRoutes.route('/', lookupRoutes());
