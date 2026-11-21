import type {
  ActivityRow,
  EnrichedTemplateExercise,
  ExternalActivityRow,
  ExternalEventRow,
  PlanTree,
  RaceGoal,
  SessionRow,
  SetLogRow,
  Trip,
  WeeklySchedule,
} from '../../src/types';
import type { CatalogExercise } from './editing';
import type { ProgramBody } from './blocks';
import type { ActivityRouteResponse } from './routeMap';
import type { ActivitySwimResponse } from './swimDetail';
import type { ActivityStreamsResponse } from './activityCharts';
import type { PartnerWorkoutInput, PartnerSlot } from '../../src/partnerTraining';

/** The plan tree as GET /api/state returns it, with parsed plan meta. */
export type StatePlan = PlanTree & {
  schedule: WeeklySchedule;
  trips: Trip[];
  /** The member's goal event; absent from an API Worker that predates it. */
  race?: RaceGoal | null;
  workouts: (PlanTree['workouts'][number] & { exercises: EnrichedTemplateExercise[] })[];
};

type LoadFields = 'effective_load' | 'effective_intensity' | 'load_method';

/** A completed activity; an API Worker without migration 0060 omits the load fields. */
export type StateActivity = Omit<ExternalActivityRow, LoadFields> & Partial<Pick<ExternalActivityRow, LoadFields>> & {
  /** Where the activity came from, to show beside it ("Garmin Forerunner 945"). */
  source_attribution?: string | null;
};

export interface StateResponse {
  plan: StatePlan | null;
  plan_version: number;
  sessions: SessionRow[];
  /** Every logged set; the Activity page reads them for workouts and bests. */
  sets?: SetLogRow[];
  external_events: ExternalEventRow[];
  external_activities: StateActivity[];
  /** Activities the member logged by hand (soccer, yoga, …). */
  activities?: ActivityRow[];
}

export interface Me {
  id: string;
  display_name: string | null;
  email: string | null;
  /** `is_owner` opens the owner's Diagnostics tab; `connected` says an AI app has access. */
  coach?: { is_owner?: boolean; connected?: boolean };
  /** This member's intervals.icu connection (Settings → Connections). */
  intervals?: IntervalsStatus;
  /** Whether this member's Apple Health workouts show in their group. */
  health?: { sharing_in_group?: boolean };
}

export interface IntervalsStatus {
  connected: boolean;
  needs_reauth: boolean;
  credential_generation: number;
  sync_pending: boolean;
  last_synced_at: number | null;
}

export interface WhoopStatus {
  configured: boolean;
  connected: boolean;
  needs_reauth: boolean;
  connected_at: number | null;
  last_synced_at: number | null;
}

/** One AI app's access, without any credential. */
export interface CoachGrant {
  id: string;
  /** The name the app registered with: its own words, shown as text only. */
  client_name: string | null;
  created_at: number;
  last_refreshed_at: number | null;
}

export type ConnectProvider = 'intervals' | 'whoop';

export class SignedOutError extends Error {
  constructor() {
    super('signed_out');
  }
}

/** The browser session changed after the member reviewed an operation. */
export class AccountChangedError extends SignedOutError {
  constructor() { super(); this.message = 'account_changed'; }
}

/** A refused request, with the API's JSON answer. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`Request failed (${status})`);
  }
}

/** The plan changed since the page loaded it (in the app, or by the coach). */
export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
    && (error.body as { conflict?: unknown } | null)?.conflict === true;
}

/** Every API call carries this header; the gateway refuses calls without it. */
const WEB_HEADERS = { 'x-tres-fort-web': '1', accept: 'application/json' };

async function request<T>(method: string, path: string, body?: unknown, expectedAccountId?: string): Promise<T> {
  const headers = { ...WEB_HEADERS, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(expectedAccountId === undefined ? {} : { 'x-tresfort-account': expectedAccountId }) };
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 401) throw new SignedOutError();
  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 409 && (payload as { error?: unknown } | null)?.error === 'account_changed') throw new AccountChangedError();
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}

const getJson = <T>(path: string) => request<T>('GET', path);

export async function fetchMe(): Promise<Me> {
  const me = await getJson<Me>('/api/me');
  if (!me || typeof me.id !== 'string' || !me.id) throw new Error('missing_account_identity');
  return me;
}
export const fetchState = (expectedAccountId?: string) => request<StateResponse>('GET', '/api/state', undefined, expectedAccountId);
export const fetchExercises = () => getJson<CatalogExercise[]>('/api/exercises');

export interface SessionFeedback {
  notes: string | null;
  perceived_fatigue: number | null;
}

/** Both fields and the reviewed baseline stay fixed until the write is acknowledged. */
export interface SessionFeedbackRequest extends SessionFeedback {
  expected_attempt: number;
  expected_feedback: SessionFeedback;
}

export async function saveSessionFeedback(session: SessionRow, body: SessionFeedbackRequest, accountId: string): Promise<SessionRow> {
  const result = await request<SessionRow>('PATCH', `/api/sessions/${encodeURIComponent(session.id)}/feedback`, body, accountId);
  // An unreadable or unrelated success is uncertain, never permission to
  // change the target or baseline. Retrying the same body is idempotent.
  if (!result || result.id !== session.id || result.user_id !== accountId
      || result.attempt !== body.expected_attempt || result.date !== session.date
      || (result.slot ?? 0) !== (session.slot ?? 0) || result.status !== 'completed'
      || result.notes !== body.notes || result.perceived_fatigue !== body.perceived_fatigue
      || !Number.isSafeInteger(result.updated_at) || result.updated_at < session.updated_at) {
    throw new Error('unreadable_feedback_receipt');
  }
  return result;
}

/** One of the owner's read-only diagnostics lookups (docs/DIAGNOSTICS.md),
 * by its `/api/me/diagnostics/...` path. */
export const fetchDiagnostics = (path: string) => {
  if (!path.startsWith('/api/me/diagnostics/')) throw new Error('not_a_diagnostics_path');
  return getJson<unknown>(path);
};

/** A problem report's screenshot as an object URL the page revokes. */
export async function fetchReportScreenshot(reportId: string): Promise<string> {
  const response = await fetch(`/api/me/diagnostics/reports/${encodeURIComponent(reportId)}/screenshot`, {
    credentials: 'same-origin',
    headers: { 'x-tres-fort-web': '1', accept: 'image/*' },
  });
  if (response.status === 401) throw new SignedOutError();
  if (!response.ok) throw new ApiError(response.status, null);
  return URL.createObjectURL(await response.blob());
}

/** A run's GPS route, or null when the activity has none. Routes are the member's own. */
export async function fetchActivityRoute(activityId: string): Promise<ActivityRouteResponse | null> {
  try {
    return await getJson<ActivityRouteResponse>(`/api/activities/${encodeURIComponent(activityId)}/route`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** An activity's pace, heart rate and elevation series, or null when it has
 * nothing to chart. The member's own only. */
export async function fetchActivityStreams(activityId: string): Promise<ActivityStreamsResponse | null> {
  try {
    return await getJson<ActivityStreamsResponse>(`/api/activities/${encodeURIComponent(activityId)}/streams`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** A swim's pool, lengths, sets and strokes with a summary, or null when
 * none is kept (src/swimDetail.ts). The member's own only. */
export async function fetchActivitySwim(activityId: string): Promise<ActivitySwimResponse | null> {
  try {
    return await getJson<ActivitySwimResponse>(`/api/activities/${encodeURIComponent(activityId)}/swim`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** The MapKit JS token for this site, or null when maps aren't set up. */
export async function fetchMapToken(): Promise<string | null> {
  try {
    const { token } = await getJson<{ token?: unknown }>('/maps/token');
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** The plan version a write was reviewed against. */
export interface Reviewed {
  planId: string;
  version: number;
  accountId?: string;
}

/** Frozen across both copy and placement retries; the copy includes block-week targets. */
export interface OneDateWorkoutRequest {
  id: string;
  name: string;
  one_time_date: string;
  copy_from: string;
  expected_plan_id: string;
  expected_version: number;
}

export async function copyWorkoutForDate(input: OneDateWorkoutRequest, accountId: string): Promise<void> {
  const result = await request<{ id: string; plan_id: string; one_time_date: string }>('POST', '/api/workouts', input, accountId);
  if (!result || result.id !== input.id || result.plan_id !== input.expected_plan_id
      || result.one_time_date !== input.one_time_date) throw new Error('unreadable_date_copy_receipt');
}

export async function placeWorkoutForDate(input: OneDateWorkoutRequest, expectedAttempt: number, accountId: string): Promise<void> {
  const result = await request<{ ok: boolean; session: SessionRow }>('PUT', `/api/calendar/${encodeURIComponent(input.one_time_date)}`,
    { workout_id: input.id, expected_attempt: expectedAttempt }, accountId);
  if (!result?.ok || result.session?.date !== input.one_time_date || (result.session.slot ?? 0) !== 0
      || result.session.workout_id !== input.id) throw new Error('unreadable_date_assignment_receipt');
}

/** Full reviewed prescription; this endpoint does not accept run_steps. */
export type PrescribedSlot = Omit<PartnerSlot, 'run_steps'>;
export type WorkoutPrescription = Omit<PartnerWorkoutInput, 'slots'> & { slots: PrescribedSlot[] };
export interface PrescriptionReceipt { workout_id: string; plan_id: string; version: number }

/** Keep this request, including every UUID, unchanged until acknowledged. */
export async function createPrescribedWorkout(input: WorkoutPrescription, accountId: string): Promise<PrescriptionReceipt> {
  const result = await request<PrescriptionReceipt>('POST', '/api/workouts/prescribed', input, accountId);
  // An unreadable success is uncertain: retry the same identity, never make another.
  if (!result || result.workout_id !== input.workout_id || typeof result.plan_id !== 'string'
      || !Number.isSafeInteger(result.version) || result.version < 1) throw new Error('unreadable_prescription_receipt');
  return result;
}

const id = encodeURIComponent;

/** Every plan write names the version the member saw; a newer plan answers 409. */
export const planWrites = {
  /** A member's first plan, for a web sign-up with nothing yet. */
  startPlan: () => request<{ plan: { id: string; version: number } }>('PUT', '/api/plan/active', { name: 'My Training' }),
  addWorkout: (name: string, at: Reviewed) =>
    request<{ id: string }>('POST', '/api/workouts', {
      name, expected_plan_id: at.planId, expected_version: at.version,
    }),
  updateWorkout: (workoutId: string, fields: Record<string, unknown>, at: Reviewed) =>
    request('PATCH', `/api/workouts/${id(workoutId)}`, { ...fields, expected_version: at.version }, at.accountId),
  deleteWorkout: (workoutId: string, at: Reviewed) =>
    request('DELETE', `/api/workouts/${id(workoutId)}?expected_version=${at.version}`, undefined, at.accountId),
  addSlot: (workoutId: string, exerciseId: string, fields: Record<string, unknown>, at: Reviewed) =>
    request('POST', `/api/workouts/${id(workoutId)}/exercises`, {
      ...fields, exercise: exerciseId, expected_version: at.version,
    }, at.accountId),
  updateSlot: (workoutId: string, slotId: string, fields: Record<string, unknown>, at: Reviewed) =>
    request('PATCH', `/api/workouts/${id(workoutId)}/exercises/${id(slotId)}`, { ...fields, expected_version: at.version }, at.accountId),
  removeSlot: (workoutId: string, slotId: string, at: Reviewed) =>
    request('DELETE', `/api/workouts/${id(workoutId)}/exercises/${id(slotId)}?expected_version=${at.version}`, undefined, at.accountId),
  replaceSlot: (workoutId: string, slotId: string, exerciseId: string, at: Reviewed, targets?: Record<string, unknown>) =>
    request('POST', `/api/workouts/${id(workoutId)}/exercises/${id(slotId)}/swap`, {
      to_exercise: exerciseId, expected_version: at.version, ...(targets ? { targets } : {}),
    }, at.accountId),
  /**
   * Creates or rewrites a superset or circuit: its members in order, rounds
   * and rests, and optionally where the whole block lands (the number of other
   * exercises before it). A retry keeps the same group id.
   */
  setGroup: (
    workoutId: string,
    groupId: string,
    members: string[],
    values: { target_sets: number; round_rest: number; transition_rest: number; order_index?: number },
    at: Reviewed,
  ) =>
    request('PUT', `/api/workouts/${id(workoutId)}/groups`, {
      group_id: groupId, exercises: members, ...values, expected_version: at.version,
    }, at.accountId),
  /** Ungroups; each exercise keeps the sets and rest it had before grouping. */
  clearGroup: (workoutId: string, groupId: string, at: Reviewed) =>
    request('PUT', `/api/workouts/${id(workoutId)}/groups`, {
      group_id: groupId, exercises: [], expected_version: at.version,
    }, at.accountId),
  /** Review the whole repeating week, including separate workouts and their times. */
  setRoutine: (schedule: Pick<WeeklySchedule, 'week' | 'extras' | 'times'>, at: Reviewed) =>
    request('PUT', '/api/plan/schedule', {
      week: schedule.week, extras: schedule.extras ?? {}, times: schedule.times ?? {},
      expected_plan_id: at.planId, expected_version: at.version,
    }, at.accountId),
  addAwayDates: (fields: Record<string, unknown>, at: Reviewed) =>
    request('POST', '/api/plan/trips', { ...fields, expected_version: at.version }, at.accountId),
  updateAwayDates: (tripId: string, fields: Record<string, unknown>, at: Reviewed) =>
    request('PATCH', `/api/plan/trips/${id(tripId)}`, { ...fields, expected_version: at.version }, at.accountId),
  removeAwayDates: (tripId: string, at: Reviewed) =>
    request('DELETE', `/api/plan/trips/${id(tripId)}?expected_version=${at.version}`, undefined, at.accountId),
  /** The whole goal event; fields left out are cleared. */
  setEvent: (race: RaceGoal, at: Reviewed) =>
    request<{ version?: number }>('PUT', '/api/plan/race', { race, expected_version: at.version }, at.accountId),
  clearEvent: (at: Reviewed) =>
    request('DELETE', `/api/plan/race?expected_version=${at.version}`, undefined, at.accountId),
  /** The whole block of weeks; weeks, days and targets left out are gone.
   * `schedule` saves the repeating week in the same plan version, for a
   * block whose own workouts leave it. A block that never listed its own
   * workouts says so (null), or the server would keep a replaced block's. */
  setProgram: (program: ProgramBody, at: Reviewed, schedule?: Pick<WeeklySchedule, 'week' | 'extras'> | null) =>
    request('PUT', '/api/plan/program', {
      program: { ...program, workout_ids: program.workout_ids ?? null },
      ...(schedule ? { schedule: { week: schedule.week, extras: schedule.extras ?? {} } } : {}),
      expected_version: at.version,
    }, at.accountId),
  /** Ends the block; only the repeating week is left. */
  clearProgram: (at: Reviewed) =>
    request('DELETE', `/api/plan/program?expected_version=${at.version}`, undefined, at.accountId),
  /** Ends the block with one of its weeks carried on: its days become the
   * repeating week and its targets the workouts' own. */
  endProgramKeeping: (weekIndex: number, at: Reviewed) =>
    request('DELETE', `/api/plan/program?expected_version=${at.version}&keep_week=${weekIndex}`, undefined, at.accountId),
};

/**
 * One date only, outside the versioned plan: each date's sessions row has an
 * attempt counter instead, and a write names the attempt the page saw (0 for
 * none), so two devices can't both change the same date unseen.
 */
export const dateWrites = {
  /** A workout on this date, or rest (null). */
  setDate: (date: string, workoutId: string | null, expectedAttempt: number) =>
    request('PUT', `/api/calendar/${id(date)}`, { workout_id: workoutId, expected_attempt: expectedAttempt }),
  /** Moves a date's workout to another date; the first date becomes rest. */
  moveDate: (move: {
    from: string; to: string; today: string; workoutId: string;
    fromAttempt: number; toAttempt: number;
  }, at: Reviewed) =>
    request('POST', `/api/calendar/${id(move.from)}/move`, {
      id: crypto.randomUUID(), to_date: move.to, today: move.today, workout_id: move.workoutId,
      expected_plan_id: at.planId, expected_version: at.version,
      expected_from_attempt: move.fromAttempt, expected_to_attempt: move.toAttempt,
    }),
};

export async function signOut(): Promise<void> {
  const response = await fetch('/auth/signout', { method: 'POST', headers: WEB_HEADERS, credentials: 'same-origin' });
  if (!response.ok) throw new Error('Couldn’t sign out. Please try again.');
}

/** An AI app's pending connection request, from its Très Fort sign-in page. */
export interface CoachRequest {
  client_name: string;
  redirect_uri: string;
  expires_at: number;
}

export interface CoachDecision {
  redirect_uri: string;
  allowed: boolean;
}

/** null when the request has expired, been used or never existed. */
export async function fetchCoachRequest(id: string): Promise<CoachRequest | null> {
  try {
    return await getJson<CoachRequest>(`/api/coach-requests/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 410) return null;
    throw error;
  }
}

/**
 * Decide for the account the member reviewed; a switched session decides nothing.
 * null when the request expired or was decided elsewhere first.
 */
export async function decideCoachRequest(id: string, allow: boolean, account: string): Promise<CoachDecision | null> {
  try {
    return await request<CoachDecision>('POST', `/api/coach-requests/${id}`, { decision: allow ? 'allow' : 'deny', account });
  } catch (error) {
    if (error instanceof ApiError && error.status === 410) return null;
    if (error instanceof ApiError && error.status === 409) throw new AccountChangedError();
    throw error;
  }
}

// ---- Settings: connections and AI coach --------------------------------------

export const fetchWhoopStatus = () => getJson<WhoopStatus>('/api/me/whoop');
export const fetchCoachGrants = async () => (await getJson<{ grants: CoachGrant[] }>('/api/me/coach-grants')).grants;

/**
 * Connecting a provider leaves the page for the provider's sign-in. The
 * gateway forwards these to the API's /auth/<provider>/* for this session;
 * the provider sends the browser back to Settings → Connections with a
 * completion only this session can finish.
 */
export const connectionWrites = {
  start: (provider: ConnectProvider) => request<{ authorize_url: string }>('POST', `/connect/${provider}/start`, {}),
  finish: (provider: ConnectProvider, completion: string) =>
    request<{ connected: true }>('POST', `/connect/${provider}/finish`, { completion }),
  syncIntervals: (expectedGeneration: number) =>
    request('POST', '/api/me/integrations/intervals/sync', { expected_generation: expectedGeneration }),
  disconnectIntervals: () => request('PATCH', '/api/me/integrations/intervals', { api_key: null, athlete_id: null }),
  syncWhoop: () => request('POST', '/api/me/whoop/sync', {}),
  disconnectWhoop: () => request('DELETE', '/api/me/whoop'),
  setHealthSharing: (enabled: boolean) => request('PATCH', '/api/me/health-sharing', { enabled }),
  removeCoachGrant: (grantId: string) => request('DELETE', `/api/me/coach-grants/${encodeURIComponent(grantId)}`),
  removeAllCoachGrants: () => request('DELETE', '/api/me/coach-grants'),
};
