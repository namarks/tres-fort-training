// WHOOP adapter (docs/plans/whoop): the WHOOP v2 developer API's OAuth,
// collections and webhook signatures, plus the pure mapping from WHOOP's
// records to Tres Fort's. No database access; the fetcher is injected, so
// tests run offline. Contract: https://api.prod.whoop.com/developer/doc/openapi.json.
//
// - OAuth 2.0 authorization code with the client secret. `offline` is what
//   returns a refresh token; access tokens last an hour and every refresh
//   rotates the refresh token (src/services/whoop.ts serializes refreshes).
// - Collections return newest first, `limit` at most 25, `nextToken` pages.
// - Webhooks carry only ids and are signed with the client secret.
import type { Fetcher } from './intervals';

export const WHOOP_API = 'https://api.prod.whoop.com';
export const WHOOP_AUTHORIZE_URL = `${WHOOP_API}/oauth/oauth2/auth`;
export const WHOOP_TOKEN_URL = `${WHOOP_API}/oauth/oauth2/token`;
export const WHOOP_SCOPES = [
  'read:workout', 'read:recovery', 'read:sleep', 'read:cycles', 'read:profile', 'read:body_measurement', 'offline',
] as const;

const TIMEOUT_MS = 10_000;
const PAGE_LIMIT = 25;

export function whoopAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(WHOOP_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', WHOOP_SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

export interface WhoopTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms, or null when WHOOP sent no lifetime. */
  expiresAt: number | null;
  scopes: string | null;
}

export type WhoopTokenResult =
  | { ok: true; tokens: WhoopTokens }
  /** `invalid`: WHOOP refused the code or refresh token (reconnect needed).
   * `transient`: network, timeout, 5xx, 429 or an unreadable body. */
  | { ok: false; reason: 'invalid' | 'transient'; status?: number };

export function parseWhoopTokens(body: unknown, now = Date.now()): WhoopTokens | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.access_token !== 'string' || b.access_token.length === 0) return null;
  const expiresIn = typeof b.expires_in === 'number' && Number.isFinite(b.expires_in) && b.expires_in > 0
    ? b.expires_in : null;
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === 'string' && b.refresh_token.length > 0 ? b.refresh_token : null,
    expiresAt: expiresIn === null ? null : now + Math.round(expiresIn * 1000),
    scopes: typeof b.scope === 'string' ? b.scope : null,
  };
}

async function tokenRequest(fetcher: Fetcher, form: Record<string, string>): Promise<WhoopTokenResult> {
  let res: Awaited<ReturnType<Fetcher>>;
  try {
    res = await fetcher(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'transient' };
  }
  if (!res.ok) {
    // 400 (invalid_grant) and 401 (invalid_client) cannot succeed on retry.
    const invalid = res.status === 400 || res.status === 401 || res.status === 403;
    return { ok: false, reason: invalid ? 'invalid' : 'transient', status: res.status };
  }
  let body: unknown;
  try { body = await res.json(); } catch { return { ok: false, reason: 'transient', status: res.status }; }
  const tokens = parseWhoopTokens(body);
  return tokens ? { ok: true, tokens } : { ok: false, reason: 'transient', status: res.status };
}

export function exchangeWhoopCode(
  fetcher: Fetcher,
  p: { clientId: string; clientSecret: string; code: string; redirectUri: string },
): Promise<WhoopTokenResult> {
  return tokenRequest(fetcher, {
    grant_type: 'authorization_code', code: p.code, client_id: p.clientId,
    client_secret: p.clientSecret, redirect_uri: p.redirectUri,
  });
}

export function refreshWhoopTokens(
  fetcher: Fetcher,
  p: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<WhoopTokenResult> {
  return tokenRequest(fetcher, {
    grant_type: 'refresh_token', refresh_token: p.refreshToken, client_id: p.clientId,
    client_secret: p.clientSecret, scope: 'offline',
  });
}

export type WhoopReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; status?: number; reason: 'unauthorized' | 'http' | 'timeout' | 'parse' };

async function getJson(fetcher: Fetcher, token: string, path: string): Promise<WhoopReadResult<unknown>> {
  let res: Awaited<ReturnType<Fetcher>>;
  try {
    res = await fetcher(`${WHOOP_API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'timeout' };
  }
  if (res.status === 401) return { ok: false, reason: 'unauthorized', status: 401 };
  if (!res.ok) return { ok: false, reason: 'http', status: res.status };
  try { return { ok: true, value: await res.json() }; } catch { return { ok: false, reason: 'parse', status: res.status }; }
}

/** The WHOOP member's id, as a string (WHOOP sends an int64). */
export async function fetchWhoopUserId(fetcher: Fetcher, token: string): Promise<WhoopReadResult<string>> {
  const r = await getJson(fetcher, token, '/developer/v2/user/profile/basic');
  if (!r.ok) return r;
  const id = (r.value as { user_id?: unknown } | null)?.user_id;
  if ((typeof id !== 'number' || !Number.isSafeInteger(id)) && (typeof id !== 'string' || !/^\d{1,20}$/.test(id))) {
    return { ok: false, reason: 'parse' };
  }
  return { ok: true, value: String(id) };
}

export type WhoopCollection = 'activity/workout' | 'activity/sleep' | 'recovery' | 'cycle';

/** Every record in [start, now), following nextToken up to `maxPages` pages.
 * Fails as a whole, so a caller reconciling the window never sees a partial
 * list. */
export async function fetchWhoopCollection(
  fetcher: Fetcher, token: string, collection: WhoopCollection, startIso: string, maxPages = 40,
): Promise<WhoopReadResult<unknown[]>> {
  const records: unknown[] = [];
  let next: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ limit: String(PAGE_LIMIT), start: startIso });
    if (next) q.set('nextToken', next);
    const r = await getJson(fetcher, token, `/developer/v2/${collection}?${q}`);
    if (!r.ok) return r;
    const body = r.value as { records?: unknown; next_token?: unknown } | null;
    if (!body || !Array.isArray(body.records)) return { ok: false, reason: 'parse' };
    records.push(...body.records);
    next = typeof body.next_token === 'string' && body.next_token.length > 0 ? body.next_token : null;
    if (!next) return { ok: true, value: records };
  }
  // More pages than allowed: refuse rather than reconcile a truncated window.
  return { ok: false, reason: 'parse' };
}

/** When one workout or sleep began, for a webhook naming a record Tres Fort
 * does not hold yet. Recovery events name their sleep. */
export async function fetchWhoopRecordStart(
  fetcher: Fetcher, token: string, kind: 'workout' | 'sleep', id: string,
): Promise<WhoopReadResult<number>> {
  if (!UUID.test(id)) return { ok: false, reason: 'parse' };
  const r = await getJson(fetcher, token, `/developer/v2/activity/${kind}/${id.toLowerCase()}`);
  if (!r.ok) return r;
  const start = instant((r.value as { start?: unknown } | null)?.start);
  return start === null ? { ok: false, reason: 'parse' } : { ok: true, value: start };
}

/** Best effort: tell WHOOP the member disconnected. */
export async function revokeWhoopAccess(fetcher: Fetcher, token: string): Promise<boolean> {
  try {
    const res = await fetcher(`${WHOOP_API}/developer/v2/user/access`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function base64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/** WHOOP signs base64(HMAC-SHA256(timestamp + raw body, client secret)). */
export async function whoopWebhookSignature(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return base64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + rawBody)));
}

export async function verifyWhoopWebhook(
  secret: string, timestamp: string | null, signature: string | null, rawBody: string,
  now = Date.now(), maxSkewMs = 24 * 60 * 60 * 1000,
): Promise<boolean> {
  if (!timestamp || !signature || !/^\d{10,16}$/.test(timestamp)) return false;
  // Retries arrive for about an hour; a day-old or future-dated delivery is refused.
  if (Math.abs(now - Number(timestamp)) > maxSkewMs) return false;
  const expected = new TextEncoder().encode(await whoopWebhookSignature(secret, timestamp, rawBody));
  const given = new TextEncoder().encode(signature);
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ given[i]!;
  return diff === 0;
}

// ---- mapping ---------------------------------------------------------------

/** WHOOP's sport names, lower-cased with punctuation as spaces. */
const WHOOP_SPORTS: Readonly<Record<string, string>> = {
  'running': 'run', 'track field': 'run', 'stroller jogging': 'run',
  'cycling': 'ride', 'mountain biking': 'ride', 'spin': 'ride',
  'swimming': 'swim',
  'walking': 'walk', 'dog walking': 'walk', 'stroller walking': 'walk',
  'hiking rucking': 'hike', 'hiking': 'hike', 'rucking': 'hike',
  'rowing': 'row',
  'elliptical': 'elliptical',
  'stairmaster': 'stairs', 'stadium steps': 'stairs',
  'assault bike': 'cardio', 'climber': 'cardio',
  'hiit': 'hiit', 'f45 training': 'hiit', 'barry s': 'hiit',
  'functional fitness': 'cross_training', 'obstacle course racing': 'cross_training',
  'weightlifting': 'strength', 'powerlifting': 'strength', 'strength trainer': 'strength',
  'yoga': 'yoga', 'hot yoga': 'yoga',
  'pilates': 'pilates',
  'barre': 'barre', 'barre3': 'barre',
  'stretching': 'flexibility',
  'dance': 'dance',
  'boxing': 'boxing', 'box fitness': 'boxing',
  'kickboxing': 'martial_arts', 'martial arts': 'martial_arts', 'jiu jitsu': 'martial_arts', 'wrestling': 'martial_arts',
  'rock climbing': 'climbing',
  'soccer': 'soccer',
  'basketball': 'basketball',
  'volleyball': 'volleyball',
  'football': 'american_football',
  'rugby': 'rugby',
  'ice hockey': 'hockey', 'field hockey': 'hockey',
  'lacrosse': 'lacrosse',
  'handball': 'handball',
  'baseball': 'baseball',
  'softball': 'softball',
  'cricket': 'cricket',
  'ultimate': 'disc_sports',
  'tennis': 'tennis', 'paddle tennis': 'tennis',
  'pickleball': 'pickleball',
  'padel': 'padel',
  'squash': 'squash',
  'badminton': 'badminton',
  'table tennis': 'table_tennis',
  'golf': 'golf',
  'ice skating': 'skating', 'inline skating': 'skating',
  'skiing': 'downhill_ski',
  'cross country skiing': 'cross_country_ski',
  'snowboarding': 'snowboard',
  'kayaking': 'paddling', 'paddleboarding': 'paddling',
  'surfing': 'surfing', 'kite boarding': 'surfing',
  'sailing': 'sailing',
  'jumping rope': 'jump_rope',
};

/** Activities WHOOP lets members log that are not training. */
const NOT_TRAINING = new Set([
  'meditation', 'sauna', 'ice bath', 'massage therapy', 'air compression', 'percussive massage',
  'watching sports', 'gaming', 'public speaking', 'high stress work', 'stage performance',
  'musical performance', 'cooking', 'cleaning', 'caddying', 'coaching', 'commuting',
  'dedicated parenting', 'babywearing', 'toddlerwearing', 'yard work', 'manual labor', 'motor racing',
]);

function normalizeSportName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The Tres Fort sport for a WHOOP sport name; 'other' when unknown, null
 * when it is not training (a sauna or a meditation). */
export function sportForWhoopName(name: unknown): string | null {
  if (typeof name !== 'string') return 'other';
  const key = normalizeSportName(name);
  if (NOT_TRAINING.has(key)) return null;
  return WHOOP_SPORTS[key] ?? 'other';
}

/** The coarse dedup kind for a sport, matching the other importers. */
export function kindForSport(sport: string): string {
  switch (sport) {
    case 'run': case 'ride': case 'swim': case 'walk': case 'hike': case 'row':
    case 'elliptical': case 'strength': case 'yoga':
      return sport;
    case 'downhill_ski': case 'cross_country_ski':
      return 'ski';
    default:
      return 'other';
  }
}

/** Seconds east of UTC from WHOOP's `timezone_offset` (`-05:00`, `+0530`, `Z`). */
export function parseWhoopOffset(offset: unknown): number | null {
  if (offset === 'Z') return 0;
  if (typeof offset !== 'string') return null;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!m) return null;
  const h = Number(m[2]), min = Number(m[3]);
  if (h > 14 || min > 59) return null;
  return (m[1] === '-' ? -1 : 1) * (h * 3600 + min * 60);
}

function instant(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function nonNegative(v: unknown): number | null {
  const n = num(v);
  return n !== null && n >= 0 ? n : null;
}

export interface WhoopWorkout {
  id: string;
  sport: string;
  kind: string;
  startUtcMs: number;
  endUtcMs: number;
  offsetSec: number | null;
  scored: boolean;
  strain: number | null;
  averageHr: number | null;
  maxHr: number | null;
  calories: number | null;
  distanceM: number | null;
  elevationGainM: number | null;
  percentRecorded: number | null;
  zoneDurationsMs: number[] | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KJ_PER_KCAL = 4.184;

/** A WHOOP workout record, validated; null for a malformed record or one
 * that is not training. Measurements exist only once WHOOP scored it. */
export function parseWhoopWorkout(record: unknown): WhoopWorkout | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  if (typeof r.id !== 'string' || !UUID.test(r.id)) return null;
  const start = instant(r.start), end = instant(r.end);
  if (start === null || end === null || end < start || end - start > 2 * 86_400_000) return null;
  const sport = sportForWhoopName(r.sport_name);
  if (sport === null) return null;
  const scored = r.score_state === 'SCORED';
  const s = scored && r.score && typeof r.score === 'object' ? r.score as Record<string, unknown> : {};
  const hr = (v: unknown) => { const n = num(v); return n !== null && n >= 25 && n <= 250 ? Math.round(n) : null; };
  const strain = num(s.strain);
  const kj = nonNegative(s.kilojoule);
  const zones = s.zone_durations && typeof s.zone_durations === 'object' ? s.zone_durations as Record<string, unknown> : null;
  const zoneKeys = ['zone_zero_milli', 'zone_one_milli', 'zone_two_milli', 'zone_three_milli', 'zone_four_milli', 'zone_five_milli'];
  const zoneValues = zones ? zoneKeys.map(k => nonNegative(zones[k])) : null;
  return {
    id: r.id.toLowerCase(),
    sport,
    kind: kindForSport(sport),
    startUtcMs: start,
    endUtcMs: end,
    offsetSec: parseWhoopOffset(r.timezone_offset),
    scored,
    strain: strain !== null && strain >= 0 && strain <= 21 ? Math.round(strain * 10) / 10 : null,
    averageHr: hr(s.average_heart_rate),
    maxHr: hr(s.max_heart_rate),
    calories: kj === null ? null : Math.round(kj / KJ_PER_KCAL),
    distanceM: nonNegative(s.distance_meter),
    elevationGainM: nonNegative(s.altitude_gain_meter),
    percentRecorded: nonNegative(s.percent_recorded),
    zoneDurationsMs: zoneValues && zoneValues.every(v => v !== null) ? zoneValues.map(v => Math.round(v!)) : null,
  };
}

export interface RecoveryDay {
  cycleId: string;
  /** The civil date the member woke up. */
  date: string;
  recoveryScore: number | null;
  hrvRmssdMs: number | null;
  restingHr: number | null;
  spo2Pct: number | null;
  skinTempC: number | null;
  calibrating: boolean | null;
  sleepStartUtcMs: number | null;
  sleepEndUtcMs: number | null;
  sleepMs: number | null;
  inBedMs: number | null;
  sleepPerformancePct: number | null;
  sleepEfficiencyPct: number | null;
  respiratoryRate: number | null;
  dayStrain: number | null;
  /** The night's WHOOP sleep id, which sleep and recovery webhooks name. */
  sleepId: string | null;
}

function civilDate(utcMs: number, offsetSec: number | null): string {
  return new Date(utcMs + (offsetSec ?? 0) * 1000).toISOString().slice(0, 10);
}

function pct(v: unknown): number | null {
  const n = num(v);
  return n !== null && n >= 0 && n <= 100 ? Math.round(n * 10) / 10 : null;
}

function cycleKey(v: unknown): string | null {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === 'string' && /^\d{1,20}$/.test(v)) return v;
  return null;
}

/**
 * One day per WHOOP cycle, joining the cycle's recovery, its main sleep and
 * the cycle's strain. The date is the local date the sleep ended; a cycle with
 * no sleep yet takes its start's local date, moved to the next day when it
 * began in the evening (a WHOOP cycle starts when the member falls asleep).
 * Unscored values stay null.
 */
export function buildRecoveryDays(recoveries: unknown[], sleeps: unknown[], cycles: unknown[]): RecoveryDay[] {
  const sleepById = new Map<string, Record<string, unknown>>();
  for (const s of sleeps) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r.id === 'string' && UUID.test(r.id) && r.nap !== true) sleepById.set(r.id.toLowerCase(), r);
  }
  const days = new Map<string, RecoveryDay>();
  const blank = (cycleId: string, date: string): RecoveryDay => ({
    cycleId, date, recoveryScore: null, hrvRmssdMs: null, restingHr: null, spo2Pct: null, skinTempC: null,
    calibrating: null, sleepStartUtcMs: null, sleepEndUtcMs: null, sleepMs: null, inBedMs: null,
    sleepPerformancePct: null, sleepEfficiencyPct: null, respiratoryRate: null, dayStrain: null, sleepId: null,
  });
  for (const c of cycles) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const id = cycleKey(r.id);
    const start = instant(r.start);
    if (!id || start === null) continue;
    const offset = parseWhoopOffset(r.timezone_offset);
    const localHour = new Date(start + (offset ?? 0) * 1000).getUTCHours();
    const date = civilDate(start + (localHour >= 12 ? 86_400_000 : 0), offset);
    const day = blank(id, date);
    const score = r.score_state === 'SCORED' && r.score && typeof r.score === 'object' ? r.score as Record<string, unknown> : {};
    const strain = num(score.strain);
    day.dayStrain = strain !== null && strain >= 0 && strain <= 21 ? Math.round(strain * 10) / 10 : null;
    days.set(id, day);
  }
  for (const rec of recoveries) {
    if (!rec || typeof rec !== 'object') continue;
    const r = rec as Record<string, unknown>;
    const id = cycleKey(r.cycle_id);
    if (!id) continue;
    const sleep = typeof r.sleep_id === 'string' ? sleepById.get(r.sleep_id.toLowerCase()) : undefined;
    const sleepEnd = sleep ? instant(sleep.end) : null;
    let day = days.get(id);
    if (!day) {
      // A recovery whose cycle fell outside the window still has a date
      // through its sleep; without one it cannot be placed.
      if (sleepEnd === null) continue;
      day = blank(id, civilDate(sleepEnd, parseWhoopOffset(sleep!.timezone_offset)));
      days.set(id, day);
    }
    if (typeof r.sleep_id === 'string' && UUID.test(r.sleep_id)) day.sleepId = r.sleep_id.toLowerCase();
    if (r.score_state === 'SCORED' && r.score && typeof r.score === 'object') {
      const s = r.score as Record<string, unknown>;
      day.recoveryScore = pct(s.recovery_score);
      const hrv = num(s.hrv_rmssd_milli);
      day.hrvRmssdMs = hrv !== null && hrv > 0 && hrv < 500 ? Math.round(hrv * 10) / 10 : null;
      const rhr = num(s.resting_heart_rate);
      day.restingHr = rhr !== null && rhr >= 20 && rhr <= 200 ? Math.round(rhr * 10) / 10 : null;
      day.spo2Pct = pct(s.spo2_percentage);
      const temp = num(s.skin_temp_celsius);
      day.skinTempC = temp !== null && temp > 20 && temp < 45 ? Math.round(temp * 100) / 100 : null;
      day.calibrating = typeof s.user_calibrating === 'boolean' ? s.user_calibrating : null;
    }
    if (sleep) {
      const start = instant(sleep.start);
      day.sleepStartUtcMs = start;
      day.sleepEndUtcMs = sleepEnd;
      if (sleepEnd !== null) day.date = civilDate(sleepEnd, parseWhoopOffset(sleep.timezone_offset));
      if (sleep.score_state === 'SCORED' && sleep.score && typeof sleep.score === 'object') {
        const s = sleep.score as Record<string, unknown>;
        const stages = s.stage_summary && typeof s.stage_summary === 'object' ? s.stage_summary as Record<string, unknown> : {};
        const light = nonNegative(stages.total_light_sleep_time_milli);
        const deep = nonNegative(stages.total_slow_wave_sleep_time_milli);
        const rem = nonNegative(stages.total_rem_sleep_time_milli);
        day.sleepMs = light === null || deep === null || rem === null ? null : Math.round(light + deep + rem);
        const bed = nonNegative(stages.total_in_bed_time_milli);
        day.inBedMs = bed === null ? null : Math.round(bed);
        day.sleepPerformancePct = pct(s.sleep_performance_percentage);
        day.sleepEfficiencyPct = pct(s.sleep_efficiency_percentage);
        const rr = num(s.respiratory_rate);
        day.respiratoryRate = rr !== null && rr > 0 && rr < 60 ? Math.round(rr * 10) / 10 : null;
      }
    }
  }
  return [...days.values()];
}
