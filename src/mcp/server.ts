import { weekdayOf, weekPatternOn } from '../calendarProjection';
import { validWorkoutTags, validArchivedAt } from '../workoutMetadata';
import { ATTRIBUTION_INSTRUCTIONS } from '../dataAttribution';
import { coachingSession, coachingPlanMeta } from '../coachingContext';
import { TRAINING_PROFILE_COACH_GUIDANCE } from '../trainingProfile';
// Minimal, spec-correct MCP server over Streamable HTTP (JSON-RPC 2.0,
// single application/json responses — no server-initiated streams needed
// for read tools). Stateless: no Mcp-Session-Id required. All data access
// goes through src/db.ts, identical to REST.
import type { Env } from '../types';
import { isEffort } from '../trainingLoad';
import { coachGroupSummary, coachWorkouts } from '../exerciseGroupViews';
import { programWeekSummary, resolvedScheduleExtras, resolvedScheduleNames, resolvedScheduleTimes, splitOneTimeWorkouts } from '../planViews';
import { weekTargetsOn } from '../programTargets';
import { positiveSetTonnage } from '../metrics';
import type { MetricExercise } from '../metrics';
import {
  hasRetiredWorkoutFields,
  hasField,
  invalidFields,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
} from '../validation';
import { isGroupId } from '../exerciseGroups';
import {
  getTrainingProfile,
  getOwnedSessionByDate,
  getWorkoutInPlan,
  startFreestyleSession,
  addWorkoutAtVersion,
  addTemplateExercise,
  addTrip,
  setGroup,
  clearGroup,
  adjustToday,
  deleteTemplateExercise,
  deleteWorkout,
  discardSession,
  findRecentMatchingSet,
  findWorkoutByRef,
  findMcpExerciseGroupAcknowledgement,
  getActivePlan,
  getExercises,
  getGroupFeed,
  getGroupStats,
  getHistory,
  getInProgressSessions,
  getSessionsByDate,
  getLastCompletedSession,
  getOrCreateSession,
  getPlanTree,
  getRecentActivities,
  getRecentSessions,
  getRideConflicts,
  getSessionByDate,
  getSetsForSession,
  getSetsForSessions,
  getUpcomingRides,
  getVolume,
  getWorkoutSummary,
  ensureActivePlan,
  isGroupMember,
  listPlanHistory,
  listGroupsForUser,
  deleteIntervalsActivityByExternalId,
  getUserTimezone,
  logActivity,
  logEnduranceActivity,
  logSet,
  softDeleteActivity,
  setActivityEffort,
  slotWeightUnit,
  logWorkoutComplete,
  nextWorkoutOrderIndex,
  nextExerciseOrderIndex,
  patchWorkoutAtVersion,
  patchSet,
  resolveExercise,
  restorePlanSnapshot,
  comparePlanVersions,
  removeTrip,
  setPeriodization,
  setPlanSchedule,
  setProgram,
  buildEventBlock,
  setPlannedSession,
  setRace,
  setStressModel,
  SessionWriteConflictError,
  skipPlannedSession,
  todayForUser,
  swapExercise,
  syncExternalActivities,
  syncExternalEvents,
  updateExercise,
  updatePlanTree,
  updateTrip,
  writeAudit,
  writeNote,
} from '../db';
import type { ProgramInput } from '../db';
import { parseEventBuildBody } from '../eventBuildRequest';
import { isScheduleExtrasInput, isScheduleTimesInput, MAX_SCHEDULE_EXTRAS, parsePlanMeta, TRIP_TYPES, WEEKDAYS } from '../types';
import {
  clockInTz,
  enduranceAlias,
  intervalsTypeFor,
  METERS_PER,
  parseActivityMetrics,
} from '../enduranceActivity';
import { logUnexpectedError, publicToolErrorCode } from '../errors';
import type {
  PeriodizationPhase,
  RaceGoal,
  StressModel,
  Trip,
  TripType,
  Weekday,
} from '../types';

const SERVER_INFO = { name: 'tres-fort', version: '0.1.0' };
// Host-injected system instructions (MCP `initialize.instructions`). Shapes
// how the model uses these tools — specifically the no-auto-log policy that
// stops phantom/duplicate set_logs when the user is just narrating a workout
// they are already logging in the iOS app.
const SERVER_INSTRUCTIONS =
  "You are the user's strength coach. Start by calling get_coach_brief. " +
  'A change the member wants for one day only ("make today harder", "short ' +
  'on time today") goes in a one-time workout (add_one_time_workout), never ' +
  'into the reusable workout, which would change every week. ' +
  "The iOS app is the primary set " +
  'logger: the user records their own reps and weights in the gym. Your ' +
  'job in chat is to coach (review history, adapt the plan, motivate, ' +
  'answer questions) — NOT to mirror what they are logging. Do NOT call ' +
  'log_set unless the user explicitly asks you to log/record/add a set ' +
  '("log this", "add 225x5", "I forgot to log my warmup"). Narration like ' +
  '"set 2 down", "5x135", "just hit a PR", or "that felt easy" is a ' +
  'status update — acknowledge it, do not log. Sets with source="ios" in ' +
  'get_current_session / get_today_workout are evidence the user is ' +
  'logging in-app right now; assume any set they mention is already ' +
  'recorded. When in doubt, ask before logging. Use correct_set for value ' +
  'mistakes and delete_set only to remove a phantom or duplicate set. ' + TRAINING_PROFILE_COACH_GUIDANCE;
const DEFAULT_PROTOCOL = '2025-06-18';
const SUPPORTED_PROTOCOLS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

type Json = Record<string, unknown>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "24:07" or "1:02:03" from whole seconds. */
function formatDuration(totalS: number): string {
  const s = Math.round(totalS);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Json;
}

const ok = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const err = (id: RpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

/** Add n whole days to a YYYY-MM-DD (UTC math, date part only — no DST). */
const addDaysIso = (ymd: string, n: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** "30d" | "8w" | "6mo" | "all" -> epoch-ms lower bound. */
function rangeToFrom(range: string | undefined): number {
  if (!range || range === 'all') return 0;
  const m = /^(\d+)(d|w|mo)$/.exec(range.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const dayMs = 86_400_000;
  const mult = m[2] === 'd' ? dayMs : m[2] === 'w' ? 7 * dayMs : 30 * dayMs;
  return Date.now() - n * mult;
}

// ---- tool registry -------------------------------------------------------

/**
 * Cloudflare execution context surface we depend on. `waitUntil` keeps a
 * promise alive AFTER the response is returned without blocking it — used
 * so the best-effort intervals.icu export never delays log_workout_complete
 * (BLOCKER-2 fix). Optional everywhere: when absent (e.g. a direct unit
 * call) the export still runs, just inline.
 */
export interface BgScheduler {
  waitUntil(p: Promise<unknown>): void;
}

interface ToolBase {
  /** Short human-readable name; directories require one on every tool. */
  title: string;
  description: string;
  inputSchema: Json;
  handler: (
    args: Json,
    env: Env,
    userId: string,
    bg?: BgScheduler,
  ) => Promise<unknown>;
  /** Write tools are audited; `note` (if it returns text) is persisted. */
  write?: boolean;
  /** Appends records without replacing or deleting existing user data. */
  appendOnly?: boolean;
  /** The service writes its own audit trail; do not duplicate it in dispatch. */
  handlerAudited?: boolean;
}

/**
 * `atomicWrite` and `note` are mutually exclusive: the dispatcher consults
 * `note` only on the non-atomic, non-handler-audited path, so a plan writer
 * that commits its audit/note inside the same D1 transaction can never have
 * a dispatcher note run. The type keeps a dead hook from being re-added.
 */
type Tool =
  | (ToolBase & {
      /** Plan writer persisted its audit/note in the same D1 transaction. */
      atomicWrite: true;
      note?: never;
    })
  | (ToolBase & {
      atomicWrite?: false;
      note?: (args: Json, result: any) => string | null;
    });

const obj = (props: Json, required: string[] = []): Json => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: false,
});

const RUN_STEPS_DESCRIPTION =
  'Planned run steps, only on the "Outdoor Run" exercise; null clears them. An ordered array of steps and repeat groups. ' +
  'A step is {kind: "warmup"|"work"|"recovery"|"cooldown", duration_s OR distance_m (exactly one), optional target}. ' +
  'A target is {type: "pace", fastest_s_per_km, slowest_s_per_km} (whole seconds per km, 120 to 1200, fastest ≤ slowest) ' +
  'or {type: "heart_rate", min_bpm, max_bpm} (40 to 230, min ≤ max). ' +
  'A repeat group is {repeat: 1-50, steps: [1-10 plain steps]}; groups do not nest. ' +
  'At most 50 items and 200 steps once repeats are expanded. Example, 4 × 800 m: ' +
  '[{"kind":"warmup","duration_s":600},{"repeat":4,"steps":[{"kind":"work","distance_m":800,' +
  '"target":{"type":"pace","fastest_s_per_km":245,"slowest_s_per_km":255}},{"kind":"recovery","duration_s":120}]},' +
  '{"kind":"cooldown","duration_s":600}]. Plan readers return the steps as JSON text in run_steps.';

const RUN_STEPS_SCHEMA = {
  type: ['array', 'null'],
  description: RUN_STEPS_DESCRIPTION,
  items: { type: 'object' },
  maxItems: 50,
};

function addWorkoutTool(): Tool {
  const tool: Tool = {
    title: 'Add workout',
    description: 'Create a reusable workout in the active plan. Scheduling is optional; the workout can stay on demand. Creates a plan if none exists.',
    inputSchema: obj(
      {
        name: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 12 },
        archived_at: { type: ['integer', 'null'] },
        day_label: { type: 'string' },
        order_index: { type: 'integer' },
      },
      ['name'],
    ),
    write: true,
    // Inserting at an occupied index rewrites existing workout order values.
    atomicWrite: true,
    handler: async (a, env, userId) => {
      if ((a.tags !== undefined && !validWorkoutTags(a.tags)) ||
          (a.archived_at !== undefined && !validArchivedAt(a.archived_at))) {
        return { error: 'invalid_fields', fields: ['tags', 'archived_at'] };
      }
      let plan = await getActivePlan(env.DB, userId);
      if (!plan) {
        plan = (await ensureActivePlan(env.DB, userId, 'My Plan', {
          actor: 'mcp', operation: 'ensure_active_plan', args: { name: 'My Plan' },
        })).plan;
      }
      // Append densely (max+1) rather than the old 99 sentinel — same
      // fix the add_exercise path got. Honors an explicit order_index.
      const orderIndex =
        typeof a.order_index === 'number'
          ? a.order_index
          : await nextWorkoutOrderIndex(env.DB, plan.id);
      return addWorkoutAtVersion(
        env.DB,
        userId,
        plan,
        String(a.name),
        typeof a.day_label === 'string' ? a.day_label : null,
        orderIndex,
        { actor: 'mcp', operation: 'add_workout', args: a, note: `Added workout "${a.name}".` },
        [], { tags: a.tags as string[] | undefined, archived_at: a.archived_at as number | null | undefined },
      );
    },
  };
  return tool;
}

/** "Make today's run harder" without changing the run every week
 * (workout-library P3): a workout made for one date, by default a copy of
 * the workout that date has, put on that date in its place. */
function addOneTimeWorkoutTool(): Tool {
  const tool: Tool = {
    title: 'Add a one-time workout',
    description:
      'Make a ONE-TIME workout for one date and put it on that date in place of the workout planned there, so a change for "just today" never touches the reusable workout or any other week. Use this instead of update_exercise / swap_exercise / add_exercise / delete_exercise / adjust_today whenever the member wants a change for one day only ("I missed yesterday, make today\'s run harder", "only 20 minutes today", "swap squats for lunges today"). By default it copies the workout the date has (its targets as they read that date, run steps included); `copy_from` copies another workout instead, and `exercises` starts it from those exercises (default targets). Then change the copy with update_exercise / delete_exercise using the slot ids it returns (`workout.exercises[].id`), or add_exercise / swap_exercise with `day` set to its id (`workout.id`; its name means the reusable workout); those edits change only this date. A one-time workout never appears in the library, the weekly schedule or a block, and update_plan leaves it alone; get_current_plan and get_today_workout list it under `one_time_workouts`. Pass `expected_attempt` from that date\'s session (default: the current one); a started or finished workout on the date is not replaced. With `place: "none"` it is only created; to add it beside the day\'s workout instead, use set_planned_session with additional: true and its id. Bumps the plan version.',
    inputSchema: obj(
      {
        date: { type: 'string', description: 'YYYY-MM-DD (device-local), usually today' },
        copy_from: { type: 'string', description: 'Workout id, label or name to copy; default the workout the date has' },
        exercises: { type: 'array', items: { type: 'string' }, maxItems: 50,
          description: 'Exercise names, aliases or ids to start from instead of a copy' },
        name: { type: 'string', description: 'Default: the copied workout\'s name' },
        place: { type: 'string', enum: ['replace', 'none'], description: 'replace (default): put it on the date in place of the workout planned there' },
        expected_attempt: { type: 'integer', minimum: 0 },
        id: { type: 'string', format: 'uuid', description: 'Optional caller UUID; retrying with the same id after a timeout returns the same workout instead of making another' },
      },
      ['date'],
    ),
    write: true,
    // The plan write audits itself; the date assignment is audited below.
    handlerAudited: true,
    handler: async (a, env, userId) => {
      const date = String(a.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || addDaysIso(date, 0) !== date) return { error: 'invalid_date' };
      if (a.copy_from !== undefined && a.exercises !== undefined) {
        return { error: 'invalid_fields', fields: ['copy_from', 'exercises'] };
      }
      const place = a.place === 'none' ? 'none' : 'replace';
      if (a.id !== undefined && (typeof a.id !== 'string'
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.id))) {
        return { error: 'invalid_fields', fields: ['id'] };
      }
      const clientID = typeof a.id === 'string' ? a.id.toLowerCase() : undefined;
      const plan = await getActivePlan(env.DB, userId);
      if (!plan) return { error: 'no_active_plan' };
      const tree = await getPlanTree(env.DB, userId);
      if (!tree) return { error: 'no_active_plan' };
      const session = (await getSessionsByDate(env.DB, userId, date)).find((row) => (row.slot ?? 0) === 0) ?? null;
      // A retry whose first try already made and placed this workout.
      if (clientID && session?.workout_id === clientID
          && tree.workouts.some((workout) => workout.id === clientID && workout.one_time_date === date)) {
        return { ok: true, workout: coachWorkouts(tree).find((row) => row.id === clientID), placed: true, session };
      }
      if (place === 'replace' && session && (session.status === 'in_progress' || session.status === 'completed')) {
        return { error: 'session_already_started', status: session.status };
      }
      const attempt = typeof a.expected_attempt === 'number' ? a.expected_attempt : session?.attempt ?? 0;
      if (place === 'replace' && (session?.attempt ?? 0) !== attempt) {
        return { conflict: true, expected_attempt: attempt, current_attempt: session?.attempt ?? 0 };
      }
      const live = tree.workouts.filter((workout) => workout.archived_at == null);
      let source: (typeof live)[number] | undefined;
      const exerciseIds: string[] = [];
      if (typeof a.copy_from === 'string') {
        const ref = a.copy_from.toLowerCase();
        source = live.find((workout) => workout.id === a.copy_from)
          ?? live.find((workout) => workout.one_time_date == null && workout.day_label?.toLowerCase() === ref)
          ?? live.find((workout) => workout.one_time_date == null && workout.name.toLowerCase() === ref);
        if (!source) return { error: 'unknown_day_ref', ref: a.copy_from };
      } else if (Array.isArray(a.exercises)) {
        for (const query of a.exercises) {
          const ex = await resolveExercise(env.DB, String(query));
          if (!ex) return { error: 'unknown_exercise', query };
          exerciseIds.push((ex as { id: string }).id);
        }
      } else {
        // The workout the date has: its session's, else its week pattern's.
        const meta = parsePlanMeta(tree.meta);
        const planned = session?.workout_id
          ?? weekPatternOn(meta.schedule, meta.program, date).week[weekdayOf(date)] ?? null;
        source = live.find((workout) => workout.id === planned);
      }
      const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : source?.name;
      if (!name) return { error: 'invalid_fields', fields: ['name'], detail: 'The date has no workout to copy; pass a name and exercises.' };
      const created = await addWorkoutAtVersion(
        env.DB, userId, plan, name, null, await nextWorkoutOrderIndex(env.DB, plan.id),
        { actor: 'mcp', operation: 'add_one_time_workout', args: a,
          note: `Made a one-time workout "${name}" for ${date}${source ? ` from "${source.name}"` : ''}.` },
        exerciseIds, {}, { date, id: clientID ?? crypto.randomUUID(), ...(source ? { copyFrom: source.id } : {}) },
      );
      if ('error' in created || 'conflict' in created) return created;
      // The workout is committed. A later failure must not hide its id, or a
      // retry would make a second one: report placement and reads as outcomes.
      const retryPlace = 'Put it on the date with set_planned_session using this workout id.';
      let placement: Record<string, unknown> = { placed: false };
      if (place === 'replace') {
        try {
          const pinned = await setPlannedSession(env.DB, userId, date, created.id, attempt, 0);
          await writeAudit(env.DB, userId, 'set_planned_session', { date, day: created.id, expected_attempt: attempt },
            JSON.stringify(pinned)).catch(() => undefined);
          placement = 'ok' in pinned ? { placed: true, session: pinned.session }
            : { placed: false, place_error: pinned, detail: retryPlace };
        } catch {
          placement = { placed: false, place_error: { error: 'placement_failed' }, detail: retryPlace };
        }
      }
      let workout: unknown = { id: created.id, name, one_time_date: date };
      try {
        const after = await getPlanTree(env.DB, userId);
        workout = (after && coachWorkouts(after).find((row) => row.id === created.id)) ?? workout;
      } catch {
        return { ok: true, workout, ...placement, read_error: 'Read it back with get_current_plan.' };
      }
      return { ok: true, workout, ...placement };
    },
  };
  return tool;
}

function updateWorkoutTool(): Tool {
  const tool: Tool = {
    title: 'Update workout',
    description:
      "Patch a reusable workout's metadata in the active plan: `name`, `day_label`, `order_index`, `notes`, `tags` (up to 12 short labels), `archived_at` (epoch-ms to archive, null to restore). Archiving clears scheduling and keeps history; active workouts cannot be archived. Identify the workout by `workout_id` OR by `day` (label/name). Bumps the plan version. Unknown patch keys → `{error:'unknown_fields', fields}`. To change exercises within a workout, use add_exercise / update_exercise / delete_exercise / swap_exercise.",
    inputSchema: obj(
      {
        workout_id: { type: 'string' },
        day: { type: 'string', description: 'day label or name (used when workout_id is omitted)' },
        patch: { type: 'object' },
      },
      ['patch'],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const plan = await getActivePlan(env.DB, userId);
      if (!plan) return { error: 'no_active_plan' };
      let dayId: string | null = null;
      if (typeof a.workout_id === 'string') {
        dayId = a.workout_id;
      } else if (typeof a.day === 'string') {
        dayId = await findWorkoutByRef(env.DB, plan.id, a.day, true);
      }
      if (!dayId) return { error: 'day_not_found' };
      const r = await patchWorkoutAtVersion(
        env.DB,
        userId,
        plan,
        dayId,
        (a.patch as Json) ?? {},
        { actor: 'mcp', operation: 'update_workout', args: a, note: 'Updated workout.' },
      );
      return r ?? { error: 'day_not_found' };
    },
  };
  return tool;
}

const TOOLS: Record<string, Tool> = {
  get_coach_brief: {
    title: "Get coaching brief",
    description: 'Start a coaching conversation here. Read the current training plan, recent sessions, feedback, activity context and coaching rules. Available to clients that do not load MCP resources or prompts.',
    inputSchema: obj({}),
    handler: async (_args, env, userId) => ({
      instructions: SERVER_INSTRUCTIONS,
      brief: await buildStateBrief(env, userId),
    }),
  },
  get_current_plan: {
    title: "Get current plan",
    description:
      'Get the active training plan: reusable workouts with optional recurring scheduling, exercises, target sets/reps/RPE, rest, progression rules, and form cues. Every weight carries its own unit: each template exercise has `target_weight_unit` (`lb` or `kg`). Units are per exercise, not per plan — a plan can mix lb and kg slots. A planned run is an "Outdoor Run" slot whose `run_steps` holds its steps and pace or heart rate targets as JSON text (null when it has none).',
    inputSchema: obj({}),
    handler: async (_a, env, userId) => {
      const tree = await getPlanTree(env.DB, userId);
      const training_profile = await getTrainingProfile(env.DB, userId);
      if (!tree) return { plan: null, training_profile, note: 'No active plan yet.' };
      // Fold in the resolved recurring weekly schedule (weekday → day name),
      // projected from the tree already in hand.
      const schedule = resolvedScheduleNames(tree);
      const schedule_extras = resolvedScheduleExtras(tree);
      const schedule_times = resolvedScheduleTimes(tree);
      // Conflict-aware with zero extra calls: a compact 28-day lift/ride
      // conflict list rides along with the plan context.
      const today = await todayForUser(env.DB, userId);
      const ride_conflicts = await getRideConflicts(
        env.DB,
        userId,
        today,
        addDaysIso(today, 28),
        today,
      );
      // Authored multisport intent rides along so the coach can reason over
      // the goal/phases/trips/stress model in one read (docs/MULTISPORT.md §9).
      const meta = parsePlanMeta(tree.meta);
      // One-time workouts are listed apart from the library, so a rebuild
      // from `workouts` never turns one into a reusable workout.
      const { library, oneTime } = splitOneTimeWorkouts(coachWorkouts(tree), today);
      return {
        ...tree,
        training_profile,
        workouts: library,
        ...(oneTime.length ? { one_time_workouts: oneTime } : {}),
        schedule,
        // Activities a weekday holds alongside its main workout; omitted
        // when the plan has none.
        ...(Object.keys(schedule_extras).length ? { schedule_extras } : {}),
        // The member's optional times of day; omitted when none is set.
        ...(Object.keys(schedule_times).length ? { schedule_times } : {}),
        ride_conflicts,
        race: meta.race ?? null,
        periodization: meta.periodization ?? [],
        trips: meta.trips ?? [],
        stress_model: meta.stress_model ?? null,
      };
    },
  },
  get_plan_history: {
    title: "Get plan history",
    description:
      'List recent immutable versions of the active plan, including who changed it, why, and a compact summary. Use this before offering a restore.',
    inputSchema: obj({
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      before_version: { type: 'integer', minimum: 1 },
    }),
    handler: async (a, env, userId) => {
      const fields = invalidFields(a, {}, {
        limit: (value) => isPositiveInteger(value) && (value as number) <= 100,
        before_version: isPositiveInteger,
      });
      if (fields.length > 0) return { error: 'invalid_fields', fields };
      return listPlanHistory(
        env.DB, userId,
        typeof a.limit === 'number' ? a.limit : 30,
        typeof a.before_version === 'number' ? a.before_version : undefined,
      );
    },
  },
  compare_plan_versions: {
    title: "Compare plan versions",
    description:
      'Compare an older selected plan version with the current plan (default) or another captured version. Results are labeled from_version → to_version.',
    inputSchema: obj({
      from_version: { type: 'integer', minimum: 1 },
      to_version: { type: 'integer', minimum: 1 },
    }, ['from_version']),
    handler: async (a, env, userId) => {
      const fields = invalidFields(a, { from_version: isPositiveInteger }, {
        to_version: isPositiveInteger,
      });
      if (fields.length > 0) return { error: 'invalid_fields', fields };
      return comparePlanVersions(
        env.DB, userId, a.from_version as number,
        typeof a.to_version === 'number' ? a.to_version : undefined,
      );
    },
  },
  restore_plan: {
    title: "Restore plan version",
    description:
      'Restore a captured version of the active plan as a NEW version. First compare the selected version with current. Requires the current plan id and expected version; rejects stale, foreign-plan, and active-workout attempts.',
    inputSchema: obj({
      snapshot_version: { type: 'integer', minimum: 1 },
      plan_id: { type: 'string' },
      expected_version: { type: 'integer', minimum: 1 },
      reason: { type: 'string' },
    }, ['snapshot_version', 'plan_id', 'expected_version']),
    handler: async (a, env, userId) => {
      const fields = invalidFields(a, {
        snapshot_version: isPositiveInteger,
        plan_id: isNonEmptyString,
        expected_version: isPositiveInteger,
      }, { reason: (value) => typeof value === 'string' });
      if (fields.length > 0) return { error: 'invalid_fields', fields };
      return restorePlanSnapshot(env.DB, userId, {
        snapshot_version: a.snapshot_version as number,
        plan_id: (a.plan_id as string).trim(),
        expected_version: a.expected_version as number,
        actor: 'mcp', reason: typeof a.reason === 'string' ? a.reason : null,
      });
    },
    write: true,
    atomicWrite: true,
    // restorePlanSnapshot persists its audit, note, and resulting snapshot in
    // the same D1 transaction as the restore; dispatcher-level writes would
    // duplicate the trail and could fail after acknowledgement.
  },
  get_today_workout: {
    title: "Get today's workout",
    description:
      "Get today's workout: the date, any existing session for today, the reusable workout library, this week's schedule (so you can answer 'what should I do today?' from one call; when a block of weeks covers today, its week is used and `program_week` says which week it is), and prior-session context. `last_session` is the most recent non-discarded session of ANY status (could be a skip/planned row); `last_completed_session` is the most recent COMPLETED session — use that for real training context, since a skipped day in between obscures `last_session`.",
    inputSchema: obj({}),
    handler: async (_a, env, userId) => {
      const date = await todayForUser(env.DB, userId);
      const tree = await getPlanTree(env.DB, userId);
      const sessions = await getSessionsByDate(env.DB, userId, date);
      const session = sessions.find(s => (s.slot ?? 0) === 0) ?? null;
      const recent = await getRecentSessions(env.DB, userId, 1, date, date);
      const last = recent.find((s) => s.date !== date) ?? null;
      // The most recent COMPLETED session — the real "last training" for
      // coaching, unobscured by an intervening skip/planned row.
      const lastCompleted = await getLastCompletedSession(env.DB, userId, date);
      // `schedule` lets an agent answer "what should I do today?" without
      // a second call to get_current_plan — the natural one-shot answer.
      // A block of weeks covering today replaces the repeating week.
      const schedule = tree ? resolvedScheduleNames(tree, date) : null;
      const schedule_extras = tree ? resolvedScheduleExtras(tree, date) : {};
      const program_week = tree ? programWeekSummary(tree, date) : null;
      const oneTime = tree ? splitOneTimeWorkouts(coachWorkouts(tree), date).oneTime : [];
      return {
        date,
        ...(program_week ? { program_week } : {}),
        sessions: await Promise.all(sessions.map(async session => ({ session, sets: await getSetsForSession(env.DB, session.id) }))),
        session,
        sets: session ? await getSetsForSession(env.DB, session.id) : [],
        plan_workouts: tree ? splitOneTimeWorkouts(coachWorkouts(tree), date).library
          .filter(workout => workout.archived_at == null) : [],
        // Workouts made for one date (today's included), apart from the
        // library; `session.workout_id` may point at one.
        ...(oneTime.length ? { one_time_workouts: oneTime } : {}),
        schedule,
        ...(Object.keys(schedule_extras).length ? { schedule_extras } : {}),
        last_session: last,
        last_session_sets: last ? await getSetsForSession(env.DB, last.id) : [],
        last_completed_session: lastCompleted,
        last_completed_session_sets: lastCompleted
          ? await getSetsForSession(env.DB, lastCompleted.id)
          : [],
      };
    },
  },
  get_current_session: {
    title: "Get current session",
    description: 'Get every in-progress workout with its sets. Optionally select a slot. The singular session field is populated only when exactly one workout matches.',
    inputSchema: obj({ slot: { type: 'integer', minimum: 0 } }),
    handler: async (a, env, userId) => {
      if (a.slot !== undefined && !isNonNegativeInteger(a.slot)) return { error: 'invalid_fields', fields: ['slot'] };
      const sessions = await getInProgressSessions(env.DB, userId, a.slot as number | undefined);
      const workouts = await Promise.all(sessions.map(async session => ({ session, sets: await getSetsForSession(env.DB, session.id) })));
      return { session: sessions.length === 1 ? sessions[0] : null,
        sets: workouts.length === 1 ? workouts[0]!.sets : [], sessions: workouts };
    },
  },
  get_session_log: {
    title: "Get session log",
    description: 'Get logged sessions and their persisted completion summary: work, same-load rep/hold records, and differences from targets captured when logging began. Missing historical targets are unavailable. Pass a date (YYYY-MM-DD) or recent_n for the last N.',
    inputSchema: obj(
      {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        recent_n: { type: 'integer', minimum: 1, maximum: 50 },
      },
      [],
    ),
    handler: async (a, env, userId) => {
      if (typeof a.date === 'string') {
        const sessions = await getSessionsByDate(env.DB, userId, a.date);
        return Promise.all(sessions.map(async session => ({ session, sets: await getSetsForSession(env.DB, session.id), summary: await getWorkoutSummary(env.DB, userId, session.id) })));
      }
      const n = typeof a.recent_n === 'number' ? a.recent_n : 5;
      const sessions = await getRecentSessions(env.DB, userId, n);
      return Promise.all(
        sessions.map(async (s) => ({ session: s, sets: await getSetsForSession(env.DB, s.id), summary: await getWorkoutSummary(env.DB, userId, s.id) })),
      );
    },
  },
  get_history: {
    title: "Get training history",
    description:
      'Get set history for one exercise (by name or id, e.g. "bench"). Compare reps and holds only within the returned cohorts (same exercise/variation, execution mode and exact external load). Mixed bodyweight/hold conditions have no overall top set. Bodyweight est_1rm is always null, including positive added load; Epley is only for conventional loaded rep work. Pooled total reps describe work, not strength progress. Nullable tonnage measures positive external-load volume only, never bodyweight system load. Each set has its own weight_unit; a session\'s top and est_1rm are in its `unit`, and tonnage is null when lb and kg both contribute (see tonnage_by_unit).',
    inputSchema: obj(
      {
        exercise: { type: 'string', description: 'Exercise name, alias, or id' },
        range: { type: 'string', description: '30d | 90d | 6mo | all (default 90d)' },
      },
      ['exercise'],
    ),
    handler: async (a, env, userId) => {
      const ex = await resolveExercise(env.DB, String(a.exercise));
      if (!ex) return { error: 'unknown_exercise', query: a.exercise };
      const id = (ex as { id: string }).id;
      const from = rangeToFrom(typeof a.range === 'string' ? a.range : '90d');
      return { exercise: ex, ...(await getHistory(env.DB, userId, id, from, Date.now())) };
    },
  },
  get_volume_trend: {
    title: "Get volume trend",
    description:
      'Get weekly logged working-set counts (legacy hard_sets), primary-muscle attribution and recorded-effort coverage, plus positive external-load volume (tonnage_basis=external_load) for a muscle group (e.g. "chest","quads","back") over a range. Tonnage is null for unsupported work or mixed units. external_load_volume keeps each unit separate; negative assistance never subtracts. Counts are logged rows, not measured stimulus or complete muscle volume.',
    inputSchema: obj(
      {
        muscle_group: { type: 'string' },
        range: { type: 'string', description: '8w | 12w | 6mo | all (default 12w)' },
      },
      ['muscle_group'],
    ),
    handler: async (a, env, userId) => {
      const from = rangeToFrom(typeof a.range === 'string' ? a.range : '12w');
      return getVolume(env.DB, userId, String(a.muscle_group), from, Date.now());
    },
  },

  list_exercises: {
    title: "List exercises",
    description:
      'List the exercise catalog so you can discover what is resolvable BEFORE calling add_exercise / update_plan (those reject unknown names with `unknown_exercise`). Optional filters: `query` (case-insensitive substring on name), `muscle` (primary_muscle exact, e.g. "quads"), `modality` (e.g. "barbell","dumbbell","bw","machine","timed"). Each row includes `laterality` ("bilateral" | "unilateral"); unilateral exercises log reps per-side, and the system doubles for total reps / tonnage (see log_set). Each row also includes `load_mode` ("total" | "per_hand"); for "per_hand" two-dumbbell lifts the weight is ONE dumbbell — set target_weight and phrase guidance per hand ("25 lb each hand"), never the doubled total. Tonnage independently counts both implements, so a per_hand + unilateral lift gets both multipliers. Returns up to a few hundred rows in the seeded catalog; combine filters to narrow.',
    inputSchema: obj(
      {
        query: { type: 'string' },
        muscle: { type: 'string' },
        modality: { type: 'string' },
      },
      [],
    ),
    handler: (a, env, _userId) =>
      getExercises(env.DB, {
        query: typeof a.query === 'string' ? a.query : undefined,
        muscle: typeof a.muscle === 'string' ? a.muscle : undefined,
        modality: typeof a.modality === 'string' ? a.modality : undefined,
      }),
  },

  get_upcoming_rides: {
    title: "Get upcoming rides",
    description:
      "Get cached intervals.icu planned endurance events and a scheduling heuristic against projected lift dates. Range is days from today (default 30, max 90). Legacy clash/heavy-next-day mean training_load >=150 or planned_duration_sec >=9000 on the same/next civil day. Brick means both measures are known below thresholds; unknown means inputs are incomplete without threshold evidence. These labels do not prove easy work, intended pairing, individualized safety or interference; strength load/muscle data is not an input.",
    inputSchema: obj(
      { range: { type: 'integer', minimum: 1, maximum: 90, description: 'days ahead (default 30)' } },
      [],
    ),
    handler: async (a, env, userId) => {
      const range = typeof a.range === 'number' ? Math.min(90, Math.max(1, a.range)) : 30;
      const today = await todayForUser(env.DB, userId);
      const to = addDaysIso(today, range);
      const rides = await getUpcomingRides(env.DB, userId, { from: today, range });
      const conflicts = await getRideConflicts(env.DB, userId, today, to, today);
      return {
        from: today,
        to,
        rides: rides.map((r) => ({
          id: r.id,
          date: r.date,
          kind: r.kind,
          title: r.title,
          planned_duration_sec: r.planned_duration_sec,
          training_load: r.training_load,
        })),
        conflicts,
        conflict_basis: 'scheduling_heuristic',
      };
    },
  },

  // ---- write tools -------------------------------------------------------

  log_set: {
    title: "Log set",
    description:
      "Log one working/warmup set into the workout database. Auto-creates " +
      "the day's session and infers set_index. Logs to today unless " +
      'session_date is given. ' +
      'STRICT USAGE: do NOT call this tool while the user is narrating a ' +
      'workout in progress. Assume the iOS app is the primary logger — ' +
      'sets with source="ios" in get_current_session / get_today_workout ' +
      'mean the user is actively logging in-app, so any set they mention ' +
      'in chat is almost certainly ALREADY recorded. Only call log_set ' +
      'when the user explicitly asks you to ("log this", "record this ' +
      'set", "add 225x5 for me", "I forgot to log my warmup"). Phrases ' +
      'like "set 2 down", "5x135", "just did bench", "that felt heavy" ' +
      'are status reports, not logging requests — acknowledge them, do ' +
      'not call this tool. When unsure, ask the user before logging. The ' +
      'server also rejects an ambiguous same exercise/weight/reps set ' +
      'logged by iOS within the last 120 seconds (error: ' +
      '"recent_duplicate"); that signal almost always means iOS already ' +
      'logged it — do NOT retry or tweak the numbers. A distinct explicit ' +
      'set_index or duration_s is treated as a separate intended set, and ' +
      'same-weight MCP straight sets are preserved. If the user confirms ' +
      'the rejected set is separate, retry it unchanged with ' +
      'confirm_duplicate=true. The dedupe gate is ' +
      'skipped for explicit backfill (session_date set to a past day, e.g. ' +
      '"log yesterday\'s 185x5") — those are explicit logging intents. ' +
      'CONVENTION: weight is per implement and reps is per side. For a ' +
      'unilateral exercise (Bulgarian split squat, lunge, one-arm row — ' +
      'list_exercises returns laterality), log ONE set with the per-side ' +
      'numbers; the system doubles for total reps and tonnage. Example: ' +
      'DB Bulgarian split squat with 45lb DBs, 8 reps each leg → ' +
      '`weight=45, reps=8` (NOT 90, NOT 16). The response echoes ' +
      'exercise.laterality + effective.{sides,total_reps,tonnage} so you ' +
      'can confirm to the user. ' +
      'TWO-DUMBBELL LIFTS: when list_exercises reports load_mode="per_hand" ' +
      '(DB bench, DB shoulder press, DB curl, lateral raise, DB lunge…), ' +
      'weight is the weight of ONE dumbbell. Set target_weight and phrase ' +
      'all guidance per hand — say "25 lb in each hand", never a vague ' +
      'doubled "50 lb". The response echoes exercise.load_mode so you can ' +
      'word it correctly; effective.implements is 2 and tonnage counts both ' +
      'implements independently from any unilateral-side multiplier. ' +
      'BODYWEIGHT / TIMED LOAD: for a bodyweight or timed hold, weight is ' +
      'external load relative to bodyweight: positive for a belt/vest, zero ' +
      'for strict bodyweight, and negative for band or machine assistance. ' +
      'Do not substitute the athlete\'s body mass. Zero, assisted, and timed ' +
      'sets have undefined tonnage. Positive tonnage is external-load volume only. ' +
      'Compare best reps or holds only at the same exercise, mode and exact load; ' +
      'pooled rep totals describe work, not strength progress. Bodyweight e1RM is unsupported.',
    inputSchema: obj(
      {
        slot: { type: 'integer', minimum: 0, description: 'Workout position on the date. Omitted: the only in-progress workout, otherwise primary slot 0.' },
        exercise: { type: 'string', description: 'name, alias, or id' },
        weight: {
          type: 'number',
          description:
            "External load. Pair with weight_unit (`lb`|`kg`); when weight_unit is omitted the set inherits the slot's target_weight_unit (freestyle / no-slot sets default to `lb`).",
        },
        weight_unit: {
          type: 'string', enum: ['lb', 'kg'],
          description: "Unit for weight. Optional; defaults to the slot's target_weight_unit, or `lb` for freestyle sets.",
        },
        reps: { type: 'integer' },
        rpe: { type: 'number' },
        is_warmup: { type: 'boolean' },
        set_index: { type: 'integer' },
        session_date: { type: 'string', description: 'YYYY-MM-DD (default today)' },
        duration_s: { type: 'integer', description: 'seconds the set took / was held' },
        is_timed: {
          type: 'boolean',
          description:
            'true if this set is a timed hold (renders as "Ns"). Defaults to the exercise modality; pass true when logging a duration-pinned hold on a non-timed exercise.',
        },
        confirm_duplicate: {
          type: 'boolean',
          description:
            'true only after the user explicitly confirms a recent_duplicate is a separate intended set',
        },
        notes: { type: 'string' },
      },
      ['exercise', 'weight', 'reps'],
    ),
    write: true,
    // Reviving a discarded legacy session can clear its old feedback and
    // assignment, so the tool must retain the destructive-action hint.
    handler: async (a, env, userId) => {
      const plan = await getActivePlan(env.DB, userId);
      if (!plan) return { error: 'no_active_plan' };
      if (a.slot !== undefined && !isNonNegativeInteger(a.slot)) return { error: 'invalid_fields', fields: ['slot'] };
      const today = await todayForUser(env.DB, userId);
      const date = typeof a.session_date === 'string' ? a.session_date : today;
      const active = (await getSessionsByDate(env.DB,userId,date)).filter(s => s.status === 'in_progress');
      const slot = typeof a.slot === 'number' ? a.slot : active.length === 1 ? active[0]!.slot ?? 0 : 0;
      const previous = await getOwnedSessionByDate(env.DB,userId,date,slot);
      if (slot > 0 && !previous) return { error: 'session_slot_missing' };
      if (a.weight_unit !== undefined && a.weight_unit !== 'lb' && a.weight_unit !== 'kg') {
        return { error: 'invalid_fields', fields: ['weight_unit'] };
      }
      const ex = await resolveExercise(env.DB, String(a.exercise));
      if (!ex) return { error: 'unknown_exercise', query: a.exercise };
      const exId = (ex as { id: string }).id;
      const isWarmup = a.is_warmup === true;
      const requestedSetIndex = typeof a.set_index === 'number' ? a.set_index : null;
      const requestedDuration = a.duration_s == null ? null : Number(a.duration_s);
      // Phantom-dupe guard: refuse only an ambiguous cross-channel replay.
      // Repeated MCP calls are legitimate straight/timed sets, and explicit
      // set indices or durations distinguish separate work from the recent
      // iOS set. An unchanged retry is allowed only after user confirmation.
      // BUT: skip the gate for explicit backfill ("log yesterday's 185x5")
      // — when session_date is supplied and isn't today, the user is making
      // an explicit historical log, not narrating; rejecting it on a same-
      // day same-triple iOS write would block a legitimate workflow.
      const isBackfill = typeof a.session_date === 'string' && a.session_date !== today;
      const recent = isBackfill
        ? null
        : await findRecentMatchingSet(env.DB, userId, {
            exercise_id: exId,
            weight: Number(a.weight),
            reps: Number(a.reps),
            is_warmup: isWarmup,
            set_index: requestedSetIndex,
            duration_s: requestedDuration,
            // An unnamed unit can still be the iOS set it would duplicate.
            weight_unit: a.weight_unit as 'lb' | 'kg' | undefined,
            // Keep the cross-date replay warning, but a matching set in a
            // different workout on this date is independent work. Filter in
            // SQL so a newer sibling set cannot hide a real duplicate.
            workout_scope: { date, slot },
          });
      if (recent && a.confirm_duplicate !== true) {
        const ageS = Math.max(0, Math.round((Date.now() - recent.logged_at) / 1000));
        return {
          error: 'recent_duplicate',
          message:
            `A ${a.weight}x${a.reps}${isWarmup ? ' warmup' : ''} set for ` +
            `${(ex as { name: string }).name} was already logged ${ageS}s ` +
            `ago (source=${recent.source}). This is almost certainly a ` +
            `duplicate from the user logging in iOS — do NOT retry or ` +
            `tweak the numbers. If the user confirms this is a separate ` +
            `intended set, retry unchanged with confirm_duplicate=true. ` +
            `Use correct_set if the existing values are wrong; use ` +
            `delete_set only if the whole set should be removed.`,
          existing_set: recent,
        };
      }
      // All rejection-only validation must finish before touching the date
      // row. In particular, a recent cross-channel duplicate must not revive
      // a discarded target session when no set will be written.
      const meta = parsePlanMeta(plan.meta);
      const scheduledId = weekPatternOn(meta.schedule, meta.program, date).week[weekdayOf(date)];
      const scheduled = slot === 0 && previous?.status !== 'skipped' && !(meta.trips ?? []).some(t => t.start <= date && date <= t.end)
        && scheduledId && await getWorkoutInPlan(env.DB, plan.id, scheduledId);
      const emptyGeneration = !previous || previous.status === 'discarded'
        || (previous.workout_id === null && ['planned', 'skipped'].includes(previous.status));
      const started = !scheduled && emptyGeneration
        ? await startFreestyleSession(env.DB,userId,date,previous?.attempt ?? 0,'mcp', { slot }) : null;
      if (started && 'error' in started) return started;
      const session = started && 'session' in started ? started.session
        : await getOrCreateSession(env.DB, userId, plan.id, date, null, { slot });
      const existing = await getSetsForSession(env.DB, session.id);
      const setIndex =
        requestedSetIndex != null
          ? requestedSetIndex
          : existing.filter((s) => s.exercise_id === exId && !s.is_warmup).length + 1;
      const weightUnit = (a.weight_unit as 'lb' | 'kg' | undefined)
        ?? await slotWeightUnit(env.DB, session.workout_id, exId, isWarmup, weekTargetsOn(meta.program, date));
      let writeResult: Awaited<ReturnType<typeof logSet>>;
      try {
        writeResult = await logSet(env.DB, userId, {
          id: crypto.randomUUID(),
          session_id: session.id,
          exercise_id: exId,
          set_index: setIndex,
          weight: Number(a.weight),
          weight_unit: weightUnit,
          reps: Number(a.reps),
          rpe: a.rpe == null ? null : Number(a.rpe),
          is_warmup: a.is_warmup === true,
          notes: typeof a.notes === 'string' ? a.notes : null,
          duration_s: requestedDuration,
          is_timed: typeof a.is_timed === 'boolean' ? a.is_timed : undefined,
          expected_attempt: session.attempt,
          source: 'mcp',
        });
      } catch (error) {
        if (error instanceof SessionWriteConflictError) return error.response();
        throw error;
      }
      const { set, deduped } = writeResult;
      // Surface the resolved exercise + per-side/per-hand accounting so the
      // agent can confirm "two 45 lb DBs x8 each leg → 16 total reps,
      // 1,440 lb tonnage" to the user without a second lookup.
      const exLat = (ex as { laterality?: string }).laterality ?? 'bilateral';
      const exLoad = (ex as { load_mode?: string }).load_mode ?? 'total';
      const sides = exLat === 'unilateral' ? 2 : 1;
      const perHand = exLoad === 'per_hand';
      const implementsUsed = perHand ? 2 : 1;
      // One tonnage policy for every surface: the shared read-only metric,
      // fed the same defaulted laterality/load_mode echoed to the caller.
      const metricExercise: MetricExercise = {
        ...(ex as MetricExercise),
        laterality: exLat,
        load_mode: exLoad,
      };
      return {
        set,
        deduped,
        session_id: session.id,
        exercise: {
          id: exId,
          name: (ex as { name: string }).name,
          laterality: exLat,
          load_mode: exLoad,
        },
        effective: {
          sides,
          implements: implementsUsed,
          total_reps: set.is_timed === 1 ? null : set.reps * sides,
          tonnage_basis: 'external_load',
          tonnage: positiveSetTonnage(set, metricExercise),
          // For two-dumbbell lifts, the weight is one dumbbell — surface a
          // ready-to-say phrasing so guidance never reads as the vague total.
          weight_display: perHand
            ? `${set.weight} ${set.weight_unit} in each hand`
            : `${set.weight} ${set.weight_unit}`,
        },
      };
    },
  },
  correct_set: {
    title: "Correct set",
    description:
      'Correct the values on an existing logged set while preserving its identity and history. ' +
      'Pass the set_id plus at least one corrected value: weight, weight_unit, reps, rpe, notes, or duration_s. ' +
      'Use null to clear rpe, notes, or duration_s. Find the id with get_current_session or ' +
      'get_session_log. Use delete_set instead only when the entire set is a phantom or duplicate.',
    inputSchema: obj(
      {
        set_id: { type: 'string', description: 'set_logs.id (UUID) to correct' },
        weight: { type: 'number' },
        weight_unit: { type: 'string', enum: ['lb', 'kg'], description: 'Unit for weight.' },
        reps: { type: 'integer', minimum: 0 },
        rpe: { type: ['number', 'null'] },
        notes: { type: ['string', 'null'] },
        duration_s: {
          type: ['integer', 'null'],
          minimum: 0,
          description: 'seconds, or null to clear the recorded duration',
        },
      },
      ['set_id'],
    ),
    write: true,
    handler: async (a, env, userId) => {
      const has = (field: string) => Object.prototype.hasOwnProperty.call(a, field);
      const allowed = new Set(['set_id', 'weight', 'weight_unit', 'reps', 'rpe', 'notes', 'duration_s']);
      const invalid: string[] = [];
      if (typeof a.set_id !== 'string' || a.set_id.length === 0) invalid.push('set_id');
      if (has('weight') && (typeof a.weight !== 'number' || !Number.isFinite(a.weight))) {
        invalid.push('weight');
      }
      if (has('weight_unit') && a.weight_unit !== 'lb' && a.weight_unit !== 'kg') {
        invalid.push('weight_unit');
      }
      if (has('reps') && (!Number.isSafeInteger(a.reps) || (a.reps as number) < 0)) {
        invalid.push('reps');
      }
      if (
        has('rpe') &&
        a.rpe !== null &&
        (typeof a.rpe !== 'number' || !Number.isFinite(a.rpe))
      ) {
        invalid.push('rpe');
      }
      if (has('notes') && a.notes !== null && typeof a.notes !== 'string') {
        invalid.push('notes');
      }
      if (
        has('duration_s') &&
        a.duration_s !== null &&
        (!Number.isSafeInteger(a.duration_s) || (a.duration_s as number) < 0)
      ) {
        invalid.push('duration_s');
      }
      invalid.push(...Object.keys(a).filter((field) => !allowed.has(field)));
      if (invalid.length > 0) return { error: 'invalid_fields', fields: invalid };

      const correctionFields = ['weight', 'weight_unit', 'reps', 'rpe', 'notes', 'duration_s'] as const;
      if (!correctionFields.some(has)) return { error: 'no_corrections' };
      const patch: {
        weight?: number;
        weight_unit?: 'lb' | 'kg';
        reps?: number;
        rpe?: number | null;
        notes?: string | null;
        duration_s?: number | null;
      } = {};
      if (has('weight')) patch.weight = a.weight as number;
      if (has('weight_unit')) patch.weight_unit = a.weight_unit as 'lb' | 'kg';
      if (has('reps')) patch.reps = a.reps as number;
      if (has('rpe')) patch.rpe = a.rpe as number | null;
      if (has('notes')) patch.notes = a.notes as string | null;
      if (has('duration_s')) patch.duration_s = a.duration_s as number | null;

      const row = await patchSet(env.DB, userId, a.set_id as string, patch);
      return row ?? { error: 'not_found', set_id: a.set_id };
    },
    note: (a, r) =>
      r?.error
        ? null
        : `Corrected set ${a.set_id} to ${r.weight}${r.weight_unit === 'kg' ? ' kg' : ''}x${r.reps}` +
          `${r.rpe == null ? '' : ` @ RPE ${r.rpe}`}` +
          `${r.duration_s == null ? '' : `, ${r.duration_s}s`}.`,
  },
  delete_set: {
    title: "Delete set",
    description:
      'Soft-delete a logged set by id — use this to undo a wrong log_set ' +
      'call (a phantom set you logged in error, or a true duplicate). The ' +
      'row is marked deleted (deleted_at set); history is preserved but ' +
      'it stops counting toward volume/sync. To find the set_id, call ' +
      'get_current_session or get_session_log first. Use correct_set instead ' +
      'for value corrections such as wrong weight, reps, RPE, notes, or duration.',
    inputSchema: obj(
      {
        set_id: { type: 'string', description: 'set_logs.id (UUID) to soft-delete' },
      },
      ['set_id'],
    ),
    write: true,
    handler: async (a, env, userId) => {
      const row = await patchSet(env.DB, userId, String(a.set_id), { deleted: true });
      return row ?? { error: 'not_found', set_id: a.set_id };
    },
    note: (a, r) =>
      r?.error
        ? null
        : `Deleted set ${a.set_id} (${r.weight}x${r.reps}${r.is_warmup ? ' warmup' : ''}).`,
  },
  discard_workout: {
    title: "Discard workout",
    description:
      'Discard one specific existing workout session that the user confirms they did not do. ' +
      'This marks the session discarded and soft-deletes every logged set in it. It does not ' +
      'look up a session by date or create a session. Read the session id and current attempt ' +
      'first, then pass both explicitly; a stale attempt returns a conflict.',
    inputSchema: obj(
      {
        session_id: { type: 'string', description: 'Existing owned sessions.id (UUID)' },
        expected_attempt: {
          type: 'integer',
          minimum: 0,
          description: 'Current session attempt observed from a read tool',
        },
      },
      ['session_id', 'expected_attempt'],
    ),
    write: true,
    handlerAudited: true,
    handler: async (a, env, userId) => {
      const invalid = invalidFields(a, {
        session_id: isNonEmptyString,
        expected_attempt: isNonNegativeInteger,
      });
      if (invalid.length > 0) return { error: 'invalid_fields', fields: invalid };
      const session = await discardSession(
        env.DB,
        userId,
        a.session_id as string,
        a.expected_attempt as number,
      );
      if (!session) return { error: 'not_found', session_id: a.session_id };
      if ('error' in session) return session;
      return { ok: true, session };
    },
  },
  log_activity: {
    title: "Log activity",
    description:
      'Log a completed activity outside strength sessions (use log_set for lifts). Where it goes depends on `type`:\n' +
      '- ENDURANCE (run, ride, swim, walk and aliases: jog, treadmill, trail run, bike, cycling, spin, ' +
      'indoor ride, pool swim, treadmill walk, ...) is created on the user\'s linked intervals.icu account as a ' +
      'manual activity, so it counts toward training load. "treadmill" is a Run with trainer=true; an indoor ride ' +
      'is a VirtualRide. It is NOT stored in the local log; it comes back through the intervals.icu sync and ' +
      'appears in get_recent_activities. A duration (duration_s, duration_minutes, or distance + pace) is required. ' +
      'If intervals.icu is not connected or the call fails, an error is returned and nothing is saved anywhere.\n' +
      '- EVERYTHING ELSE (pilates, yoga, jump rope, mobility, "other", ...) goes to the local activities log. ' +
      'Distance and pace are ignored there.\n' +
      'Fields: duration_s (seconds, takes precedence over duration_minutes); distance + distance_unit (mi|km|m); ' +
      'pace + pace_unit (min/mi|min/km, pace as "M:SS") which derives distance when it is missing, or duration when ' +
      'that is missing; avg_hr (bpm); calories (kcal); indoor (bool, overrides the type\'s default); start_time ' +
      '("HH:MM" 24h in the user\'s timezone, default now); date (YYYY-MM-DD, default the user\'s today). ' +
      'Duplicates are not created: an existing intervals.icu activity with the same activity_id, or on the same date ' +
      'with the same sport and a duration within one minute, is returned instead (deduplicated=true). Pass the same ' +
      'activity_id when retrying an uncertain result. To undo, call delete_activity with the returned activity_id ' +
      '(endurance) or activity.id (local). A deduplicated match that Tres Fort did not create has activity_id null ' +
      'and cannot be deleted through this server.',
    inputSchema: obj(
      {
        type: {
          type: 'string',
          description: 'free-form: run|treadmill|jog|ride|spin|swim|walk|... (intervals.icu) or pilates|yoga|jump rope|other|... (local)',
        },
        title: { type: 'string', description: 'e.g. "Reformer class at Studio MDR" or "Easy treadmill run"' },
        duration_s: { type: 'number', exclusiveMinimum: 0, description: 'seconds; takes precedence over duration_minutes' },
        duration_minutes: { type: 'integer', minimum: 0 },
        distance: { type: 'number', exclusiveMinimum: 0 },
        distance_unit: { type: 'string', enum: ['mi', 'km', 'm'] },
        pace: { type: 'string', description: 'average pace "M:SS", e.g. "8:00"' },
        pace_unit: { type: 'string', enum: ['min/mi', 'min/km'] },
        avg_hr: { type: 'integer', minimum: 20, maximum: 250, description: 'average heart rate, bpm' },
        calories: { type: 'number', minimum: 0, description: 'kcal' },
        indoor: { type: 'boolean', description: 'treadmill / trainer / indoor session' },
        start_time: { type: 'string', description: 'HH:MM (24h) in the user\'s timezone; default now' },
        date: { type: 'string', description: 'YYYY-MM-DD (default today in user tz)' },
        notes: { type: 'string', description: 'free text; becomes the intervals.icu description for endurance' },
        activity_id: { type: 'string', description: 'optional UUID idempotency key; reuse it when retrying' },
      },
      ['type'],
    ),
    write: true,
    appendOnly: true,
    handler: async (a, env, userId) => {
      const type = typeof a.type === 'string' ? a.type.toLowerCase().trim() : '';
      if (!type) return { error: 'invalid_type' };
      const invalid = invalidFields(a, {}, {
        date: (v) => typeof v === 'string' && ISO_DATE.test(v),
        title: (v) => v === null || typeof v === 'string',
        notes: (v) => v === null || typeof v === 'string',
        activity_id: (v) => typeof v === 'string' && UUID.test(v),
      });
      const parsed = parseActivityMetrics(a);
      if ('invalid' in parsed) invalid.push(...parsed.invalid);
      if (invalid.length > 0 || 'invalid' in parsed) return { error: 'invalid_fields', fields: invalid };
      const m = parsed.metrics;
      const date = typeof a.date === 'string' ? a.date : await todayForUser(env.DB, userId);
      const id = typeof a.activity_id === 'string' ? a.activity_id.toLowerCase() : crypto.randomUUID();
      const title = typeof a.title === 'string' && a.title.trim() ? a.title.trim() : null;
      const notes = typeof a.notes === 'string' && a.notes.trim() ? a.notes : null;

      const alias = enduranceAlias(type);
      if (alias) {
        if (m.duration_s === null) {
          return {
            error: 'duration_required',
            message: 'Endurance activities need a duration: duration_s, duration_minutes, or distance with pace.',
          };
        }
        const mapping = intervalsTypeFor(alias, m.indoor);
        const result = await logEnduranceActivity(env.DB, env, userId, {
          activity_id: id,
          date,
          start_time: m.start_time ?? clockInTz(await getUserTimezone(env.DB, userId)),
          mapping,
          name: title ?? mapping.label,
          duration_s: m.duration_s,
          distance_m: m.distance_m,
          avg_hr: m.avg_hr,
          calories: m.calories,
          notes,
        });
        if (!('ok' in result)) return result;
        const unit = a.distance_unit === 'km' || a.pace_unit === 'min/km' ? 'km' : 'mi';
        const act = result.intervals_activity;
        const dist = act.distance ?? m.distance_m;
        const what =
          `${formatDuration(act.moving_time ?? m.duration_s)} ${act.name ?? mapping.label}` +
          (dist ? ` (${(dist / METERS_PER[unit]).toFixed(2)} ${unit})` : '') +
          ` on ${act.start_date_local?.slice(0, 10) ?? date}`;
        return {
          ...result,
          ...(m.derived.length ? { derived: m.derived } : {}),
          message: result.deduplicated
            ? `Already on intervals.icu, not logged again: ${what}`
            : `Logged ${what} to intervals.icu`,
        };
      }

      const row = await logActivity(
        env.DB,
        userId,
        {
          id,
          date,
          type,
          title,
          duration_minutes:
            typeof a.duration_minutes === 'number' && !hasField(a, 'duration_s')
              ? a.duration_minutes
              : m.duration_s !== null
                ? Math.round(m.duration_s / 60)
                : null,
          // Only a supplied duration_s is precise; minutes stay in duration_minutes.
          duration_s: typeof a.duration_s === 'number' ? m.duration_s : null,
          avg_hr: m.avg_hr,
          calories: m.calories,
          notes,
          logged_at: Date.now(),
        },
        'mcp',
      );
      const ignored = ['distance', 'distance_unit', 'pace', 'pace_unit', 'indoor', 'start_time'].filter(
        (k) => hasField(a, k),
      );
      const dur = row.duration_s != null
        ? `${formatDuration(row.duration_s)} `
        : row.duration_minutes != null ? `${row.duration_minutes}min ` : '';
      const msg = `Logged ${dur}${row.type} on ${row.date}${row.title ? ` — ${row.title}` : ''}`;
      return {
        ok: true,
        destination: 'local',
        message: msg,
        activity: row,
        ...(ignored.length ? { ignored_fields: ignored } : {}),
      };
    },
    // Audited like every write tool (dispatch loop calls writeAudit). The
    // `note` hook persists a coach-authored note row, matching the pattern
    // used by delete_set / adjust_today so the activity has a visible
    // coaching trail.
    note: (_a, r) => (r?.ok && !r.deduplicated ? `Logged activity: ${r.message}.` : null),
  },
  delete_activity: {
    title: "Delete activity",
    description:
      'Delete an activity logged with log_activity. Pass `activity.id` it returned for a local activity ' +
      '(pilates, yoga, ...), which is soft-deleted, or `activity_id` it returned for an endurance ' +
      'activity, which deletes that activity on intervals.icu and refreshes the sync. Only intervals.icu ' +
      'activities Tres Fort created (external_id "tresfort:activity:<id>") can be deleted; watch-synced or ' +
      'hand-entered intervals.icu activities cannot. ' +
      '`date` (YYYY-MM-DD) optionally narrows the intervals.icu lookup.',
    inputSchema: obj(
      {
        id: { type: 'string', description: 'local activity id, or the activity_id of a Tres Fort-created intervals.icu activity' },
        date: { type: 'string', description: 'YYYY-MM-DD the endurance activity happened (optional)' },
      },
      ['id'],
    ),
    write: true,
    handler: async (a, env, userId) => {
      const invalid = invalidFields(a, { id: isNonEmptyString }, {
        date: (v) => typeof v === 'string' && ISO_DATE.test(v),
      });
      if (invalid.length > 0) return { error: 'invalid_fields', fields: invalid };
      const id = (a.id as string).trim();
      if (await softDeleteActivity(env.DB, userId, id)) {
        return { ok: true, destination: 'local', id };
      }
      return deleteIntervalsActivityByExternalId(env.DB, env, userId, id, {
        today: await todayForUser(env.DB, userId),
        ...(typeof a.date === 'string' ? { date: a.date } : {}),
      });
    },
    note: (a, r) =>
      r?.ok
        ? r.destination === 'local'
          ? `Deleted activity ${a.id}.`
          : `Deleted intervals.icu activity ${r.intervals_activity_id} (activity_id ${r.activity_id}).`
        : null,
  },
  rate_activity: {
    title: "Rate activity effort",
    description:
      'Record how hard a completed activity was, as the member told you: `effort` 1 to 10 (1 very easy, ' +
      '3 moderate, 5 hard, 7 very hard, about how an hour at threshold feels, 10 all out), or null to clear ' +
      'it. Pass the `id` from get_recent_activities. Use it only when the member gives a rating; never guess ' +
      'one. A workout with no heart-rate, power, pace or provider load is then scored from the rating ' +
      '(load_method "effort", an estimate: one hour at 7 is 100); a measured load always wins. The member ' +
      'can rate the same workout in the app.',
    inputSchema: obj(
      {
        id: { type: 'string', description: 'activity id from get_recent_activities' },
        effort: { type: ['integer', 'null'], minimum: 1, maximum: 10, description: '1-10, or null to clear' },
      },
      ['id', 'effort'],
    ),
    write: true,
    handler: async (a, env, userId) => {
      const invalid = invalidFields(a, { id: isNonEmptyString, effort: (v) => v === null || isEffort(v) });
      if (invalid.length > 0) return { error: 'invalid_fields', fields: invalid };
      // WHOOP activities are the member's to rate in the app, never through a coach.
      const row = await setActivityEffort(env.DB, userId, (a.id as string).trim(), a.effort as number | null,
        undefined, { coach: true });
      if (!row) return { error: 'not_found' };
      return {
        ok: true,
        id: row.id,
        date: row.date,
        sport: row.sport ?? null,
        effort: row.effort,
        load: row.effective_load,
        load_method: row.load_method,
      };
    },
  },
  log_workout_complete: {
    title: "Finish workout",
    description: 'Mark a session complete, optionally with perceived fatigue (1-10) and notes.',
    inputSchema: obj(
      {
        slot: { type: 'integer', minimum: 0 },
        session_date: { type: 'string', description: 'YYYY-MM-DD (default today)' },
        perceived_fatigue: { type: 'integer', minimum: 1, maximum: 10 },
        notes: { type: 'string' },
      },
      [],
    ),
    write: true,
    handler: async (a, env, userId) => {
      if (a.slot !== undefined && !isNonNegativeInteger(a.slot)) return { error: 'invalid_fields', fields: ['slot'] };
      const date = typeof a.session_date === 'string' ? a.session_date : await todayForUser(env.DB, userId);
      const s = await logWorkoutComplete(
        env.DB,
        userId,
        date,
        a.perceived_fatigue == null ? null : Number(a.perceived_fatigue),
        typeof a.notes === 'string' ? a.notes : null,
        typeof a.slot === 'number' ? a.slot : 0,
      );
      if (!s) return { error: 'no_active_plan' };
      if ('error' in s) return s;
      const summary = await getWorkoutSummary(env.DB, userId, s.id).catch(() => null);
      return { ...s, summary: summary?.attempt === s.attempt && summary.final ? summary : null };
    },
  },
  add_note: {
    title: "Add coaching note",
    description:
      'Record a coaching note (your reasoning). scope: plan|session|exercise|general; ref_id optional.',
    inputSchema: obj(
      {
        scope: { type: 'string', enum: ['plan', 'session', 'exercise', 'general'] },
        ref_id: { type: 'string' },
        body: { type: 'string' },
      },
      ['scope', 'body'],
    ),
    write: true,
    appendOnly: true,
    handler: async (a, env, userId) => {
      await writeNote(
        env.DB,
        userId,
        String(a.scope),
        typeof a.ref_id === 'string' ? a.ref_id : null,
        'coach',
        String(a.body),
      );
      return { ok: true };
    },
  },
  update_plan: {
    title: "Replace plan",
    description:
      'Replace the plan tree (reusable workouts + exercises) transactionally. Exercise names must match the closed catalog — call list_exercises first to discover valid names (a single unknown name surfaces ALL unknowns at once in `queries: string[]`, not just the first). Each exercise slot carries its own `target_weight_unit` (`lb`|`kg`, default `lb`); weights are read with their own unit, never reinterpreted across units. A rebuilt slot that omits it keeps the unit of the slot it replaces. An "Outdoor Run" slot can carry `run_steps` (see add_exercise); a rebuilt slot that omits it keeps the steps of the slot it replaces, and null clears them. Pass expected_version for optimistic concurrency; it is required whenever the existing or supplied tree has group fields. A mismatch returns a conflict — refetch get_current_plan and reapply. Workouts are matched by day_label/name across the rebuild, so the weekly schedule follows surviving workouts; schedule entries for removed workouts are cleared. Workouts need not be scheduled.',
    inputSchema: obj(
      {
        name: { type: 'string' },
        meta: { type: 'object' },
        expected_version: { type: 'integer' },
        workouts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day_label: { type: 'string' },
              name: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' }, maxItems: 12 },
                  archived_at: { type: ['integer', 'null'] },
              order_index: { type: 'integer' },
              notes: { type: 'string' },
              exercises: { type: 'array', items: { type: 'object' } },
            },
            required: ['name'],
          },
        },
      },
      [],
    ),
    write: true,
    atomicWrite: true,
    handler: (a, env, userId) =>
      updatePlanTree(
        env.DB,
        userId,
        a as unknown as Parameters<typeof updatePlanTree>[2],
        { actor: 'mcp', operation: 'update_plan', args: a, note: 'Rebuilt training plan.' },
      ),
  },
  group_exercises: {
    title: "Group exercises",
    description: 'Group adjacent exercise slots into a superset or circuit. Use a caller-generated group_id UUID and current expected_version. Exercises are template slot IDs (recommended, especially for repeated exercises) or unambiguous names/aliases in the selected day. Every member performs the same number of rounds. round_rest follows the last member; transition_rest defaults to zero between members. Ordinary per-slot rest is preserved. Retry the same ID, version and payload after an uncertain response; refetch on conflict.',
    inputSchema: obj({
      day: { type: 'string', description: 'Workout day ID, label or exact name; a one-time workout only by its ID' },
      group_id: { type: 'string', format: 'uuid' },
      expected_version: { type: 'integer', minimum: 1 },
      exercises: { type: 'array', minItems: 2, items: { type: 'string' } },
      round_rest: { type: 'integer', minimum: 0 },
      transition_rest: { type: 'integer', minimum: 0 },
      target_sets: { type: 'integer', minimum: 1 },
      order_index: { type: 'integer', minimum: 0, description: 'Optional destination index for moving the entire group as a block' },
    }, ['day', 'group_id', 'expected_version', 'exercises', 'round_rest']),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const unknown = Object.keys(a).filter((key) => !['day', 'group_id', 'expected_version', 'exercises',
        'round_rest', 'transition_rest', 'target_sets', 'order_index'].includes(key));
      if (unknown.length) return { error: 'unknown_fields', fields: unknown };
      const fields = invalidFields(a, {
        day: isNonEmptyString, group_id: isGroupId, expected_version: isPositiveInteger,
        exercises: (value) => Array.isArray(value) && value.length >= 2 && value.every(isNonEmptyString),
        round_rest: isNonNegativeInteger,
      }, { transition_rest: isNonNegativeInteger, target_sets: isPositiveInteger, order_index: isNonNegativeInteger });
      if (fields.length) return { error: 'invalid_fields', fields };
      const replay = await findMcpExerciseGroupAcknowledgement(env.DB, userId, 'group_exercises', a);
      if (replay) return replay;
      const tree = await getPlanTree(env.DB, userId);
      if (!tree) return { error: 'no_active_plan' };
      if (tree.version !== a.expected_version) {
        // A simultaneous copy may have committed after the first receipt read.
        // Changed stale payloads conflict before stale names can fail lookup.
        return await findMcpExerciseGroupAcknowledgement(env.DB, userId, 'group_exercises', a)
          ?? { conflict: true, current_version: tree.version };
      }
      // A one-time workout shares its source's name: reach it by id only.
      const matchingDays = tree.workouts.filter((day) => day.id === a.day
        || (day.one_time_date == null && (day.day_label === a.day || day.name === a.day)));
      if (matchingDays.length > 1) return { error: 'ambiguous_day' };
      if (!matchingDays.length && !isGroupId(a.day)) return { error: 'day_not_found' };
      const day = matchingDays[0];
      const members: string[] = [];
      for (const ref of a.exercises as string[]) {
        const exact = day?.exercises.find((slot) => slot.id === ref);
        if (exact) { members.push(exact.id); continue; }
        // Preserve caller slot IDs through a retry even if a later rebuild
        // removed them: receipt recognition belongs to the atomic service.
        if (isGroupId(ref)) {
          members.push(ref); continue;
        }
        const exercise = await resolveExercise(env.DB, ref);
        if (!exercise) return { error: 'unknown_exercise', query: ref };
        const matching = day?.exercises.filter((slot) => slot.exercise_id === exercise.id) ?? [];
        if (matching.length !== 1) return { error: matching.length ? 'ambiguous_exercise' : 'slot_not_found', query: ref };
        members.push(matching[0]!.id);
      }
      return setGroup(env.DB, userId, day?.id ?? a.day as string, a.group_id as string, members, {
        expected_version: a.expected_version as number, round_rest: a.round_rest as number,
        ...(hasField(a, 'transition_rest') ? { transition_rest: a.transition_rest as number } : {}),
        ...(hasField(a, 'target_sets') ? { target_sets: a.target_sets as number } : {}),
        ...(hasField(a, 'order_index') ? { order_index: a.order_index as number } : {}),
      }, { actor: 'mcp', operation: 'group_exercises', args: a, note: 'Grouped exercise slots.' });
    },
  },
  ungroup_exercises: {
    title: "Ungroup exercises",
    description: 'Clear a superset or circuit by group_id and the current expected_version. All members regain their unchanged ordinary per-slot rests. An exact acknowledged retry creates no extra version or history.',
    inputSchema: obj({ group_id: { type: 'string', format: 'uuid' },
      expected_version: { type: 'integer', minimum: 1 } }, ['group_id', 'expected_version']),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const unknown = Object.keys(a).filter((key) => !['group_id', 'expected_version'].includes(key));
      if (unknown.length) return { error: 'unknown_fields', fields: unknown };
      const fields = invalidFields(a, { group_id: isGroupId, expected_version: isPositiveInteger });
      if (fields.length) return { error: 'invalid_fields', fields };
      const replay = await findMcpExerciseGroupAcknowledgement(env.DB, userId, 'ungroup_exercises', a);
      if (replay) return replay;
      return clearGroup(env.DB, userId, a.group_id as string, a.expected_version as number,
        { actor: 'mcp', operation: 'ungroup_exercises', args: a, note: 'Ungrouped exercise slots.' });
    },
  },
  update_exercise: {
    title: "Update exercise",
    description:
      'Patch one plan slot. Identify it by template_exercise_id, or by day (label/name) + exercise. Patchable keys: target_sets, target_reps, target_reps_max, target_rpe, rest_seconds, target_weight, target_weight_unit (`lb`|`kg`), target_duration_s, cues, progression, order_index, is_warmup, run_steps (an array of planned run steps on an "Outdoor Run" slot, in the format add_exercise describes; null clears them). Each slot carries its own target_weight_unit — units are per exercise, not per plan. Group columns are changed only through group_exercises/ungroup_exercises; grouped order and target_sets are group-owned. Unknown keys are rejected with {error:"unknown_fields", fields:[...]} — no silent drop. A slot of a reusable workout changes every date that uses it; for a change to one date only, call add_one_time_workout first and change its copy (whose slots change only that date).',
    inputSchema: obj(
      {
        expected_version: { type: 'integer', minimum: 1, description: 'Reviewed plan version. A stale value returns conflict/current_version; omit only for a tokenless patch with one bounded retry.' },
        template_exercise_id: { type: 'string' },
        day: { type: 'string', description: 'Workout id, label or name; a one-time workout only by its id' },
        exercise: { type: 'string' },
        patch: { type: 'object' },
      },
      ['patch'],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const fields = invalidFields(a, {}, { expected_version: isPositiveInteger });
      if (fields.length) return { error: 'invalid_fields', fields };
      const r = await updateExercise(
        env.DB,
        userId,
        {
          template_exercise_id:
            typeof a.template_exercise_id === 'string' ? a.template_exercise_id : undefined,
          day: typeof a.day === 'string' ? a.day : undefined,
          exercise: typeof a.exercise === 'string' ? a.exercise : undefined,
        },
        (a.patch as Json) ?? {},
        { actor: 'mcp', operation: 'update_exercise', args: a, note: 'Updated exercise slot.' },
        { expectedVersion: a.expected_version as number | undefined },
      );
      return r ?? { error: 'slot_not_found' };
    },
  },
  swap_exercise: {
    title: "Swap exercise",
    description: 'Replace an exercise in a day with another (e.g. RDL → good mornings on Wednesday), preserving its targets, order, warm-up flag, and slot identity. Carried targets must be valid for the destination modality, and planned run steps stay on an "Outdoor Run": clear them before swapping that slot to another exercise. Historical sets keep their original exercise. Both names must match the closed catalog — use list_exercises to discover valid names. A slot of a reusable workout changes every date that uses it; for a change to one date only, call add_one_time_workout first and change its copy (whose slots change only that date).',
    inputSchema: obj(
      {
        expected_version: { type: 'integer', minimum: 1, description: 'Reviewed plan version. A stale value returns conflict/current_version; omit only for a tokenless patch with one bounded retry.' },
        day: { type: 'string', description: 'Workout id, label or name; a one-time workout only by its id' },
        from_exercise: { type: 'string' },
        to_exercise: { type: 'string' },
      },
      ['day', 'from_exercise', 'to_exercise'],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const fields = invalidFields(a, {}, { expected_version: isPositiveInteger });
      if (fields.length) return { error: 'invalid_fields', fields };
      const r = await swapExercise(env.DB, userId, {
        expected_version: a.expected_version as number | undefined,
        day: String(a.day),
        from_exercise: String(a.from_exercise),
        to_exercise: String(a.to_exercise),
      }, {
        actor: 'mcp', operation: 'swap_exercise', args: a,
        note: `Swapped ${a.from_exercise} → ${a.to_exercise} on ${a.day}.`,
      });
      return r ?? { error: 'slot_not_found' };
    },
  },
  add_exercise: {
    title: "Add exercise",
    description: 'Add an exercise to a day in the active plan. `exercise` must match the closed catalog — use list_exercises to discover valid names. order_index defaults to max(existing)+1 (append dense), not the old 99 sentinel. Set is_warmup:true for a prescribed warm-up (erg, mobility) — its logged sets stay out of working-set rollups / session RPE. For a duration-based warm-up (e.g. 5-min row), use a cardio exercise and set target_duration_s. For bodyweight or timed work, target_weight is external load relative to bodyweight: positive for added load, zero for strict bodyweight, and negative for assistance; never store body mass. For AMRAP, use target_reps as the minimum, leave target_reps_max unset, and put "AMRAP" in cues. For a planned run, add "Outdoor Run" with target_sets 1, target_reps 1 and run_steps. A slot of a reusable workout changes every date that uses it; for a change to one date only, call add_one_time_workout first and change its copy (whose slots change only that date).',
    inputSchema: obj(
      {
        expected_version: { type: 'integer', minimum: 1, description: 'Reviewed plan version. A stale value returns conflict/current_version; omit only for a tokenless patch with one bounded retry.' },
        day: { type: 'string', description: 'Workout id, label or name; a one-time workout only by its id' },
        exercise: { type: 'string' },
        target_sets: { type: 'integer' },
        target_reps: { type: 'integer' },
        target_reps_max: { type: 'integer' },
        target_rpe: { type: 'number' },
        rest_seconds: { type: 'integer' },
        target_weight: {
          type: 'number',
          description:
            'Planned external load, in target_weight_unit (`lb`|`kg`; defaults to `lb`). On bodyweight/timed work: positive = added load, 0 = strict bodyweight, negative = assistance.',
        },
        target_weight_unit: {
          type: 'string', enum: ['lb', 'kg'],
          description: 'Unit for target_weight on this slot. Optional; defaults to `lb`.',
        },
        target_duration_s: { type: 'integer', description: 'Planned hold/effort seconds for timed or cardio slots (planks, erg warm-ups); leave unset for conventional reps slots.' },
        progression: { type: 'object' },
        order_index: { type: 'integer' },
        is_warmup: { type: 'boolean', description: 'Mark this slot a prescribed warm-up (excluded from working-set rollups / session RPE).' },
        run_steps: RUN_STEPS_SCHEMA,
      },
      ['day', 'exercise', 'target_sets', 'target_reps'],
    ),
    write: true,
    // Inserting at an occupied index rewrites existing exercise order values.
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const fields = invalidFields(a, {}, { expected_version: isPositiveInteger });
      if (fields.length) return { error: 'invalid_fields', fields };
      const groupFields = Object.keys(a).filter((key) => ['group_id', 'group_rest_seconds', 'group_transition_seconds'].includes(key));
      if (groupFields.length) return { error: 'unknown_fields', fields: groupFields };
      const plan = await getActivePlan(env.DB, userId);
      if (!plan) return { error: 'no_active_plan' };
      if (a.expected_version !== undefined && a.expected_version !== plan.version) {
        return { conflict: true, current_version: plan.version };
      }
      const dayId = await findWorkoutByRef(env.DB, plan.id, String(a.day));
      if (!dayId) return { error: 'day_not_found', day: a.day };
      const ex = await resolveExercise(env.DB, String(a.exercise));
      if (!ex) return { error: 'unknown_exercise', query: a.exercise };
      // Honor an explicit order_index; otherwise append densely (max+1)
      // instead of the old 99 sentinel, which stranded everything at the
      // bottom (P0 in the bug report).
      const orderIndex =
        a.order_index !== undefined
          ? a.order_index as number
          : await nextExerciseOrderIndex(env.DB, dayId);
      return addTemplateExercise(env.DB, plan.id, {
        workout_id: dayId,
        exercise_id: (ex as { id: string }).id,
        order_index: orderIndex,
        target_sets: a.target_sets as number,
        target_reps: a.target_reps as number,
        target_reps_max: a.target_reps_max == null ? null : a.target_reps_max as number,
        target_rpe: a.target_rpe == null ? null : a.target_rpe as number,
        rest_seconds: a.rest_seconds === undefined ? 120 : a.rest_seconds as number,
        target_weight: a.target_weight == null ? null : a.target_weight as number,
        ...(a.target_weight_unit === undefined ? {} : { target_weight_unit: a.target_weight_unit as 'lb' | 'kg' }),
        target_duration_s:
          a.target_duration_s == null ? null : a.target_duration_s as number,
        progression: a.progression == null ? null : JSON.stringify(a.progression),
        cues: null,
        is_warmup: a.is_warmup === undefined ? 0 : a.is_warmup as boolean,
        ...(a.run_steps === undefined ? {} : { run_steps: a.run_steps }),
      }, {
        actor: 'mcp', operation: 'add_exercise', args: a,
        note: `Added ${a.exercise} to ${a.day}.`,
      }, { expectedVersion: a.expected_version as number | undefined });
    },
  },
  add_workout: addWorkoutTool(),
  add_one_time_workout: addOneTimeWorkoutTool(),
  update_workout: updateWorkoutTool(),
  delete_workout: {
    title: "Delete workout",
    description: 'Delete a reusable workout from the active plan, clearing its recurring schedule entries and preserving completed workout history. Requires the workout ID and current plan version. Rejected while the workout is in progress. To keep the workout but remove its weekdays, use set_schedule instead.',
    inputSchema: obj({ workout_id: { type: 'string' }, expected_version: { type: 'integer', minimum: 1 } }, ['workout_id', 'expected_version']),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const invalid = invalidFields(a, { workout_id: isNonEmptyString, expected_version: isPositiveInteger });
      if (invalid.length) return { error: 'invalid_fields', fields: invalid };
      return deleteWorkout(env.DB, userId, String(a.workout_id), Number(a.expected_version), {
        actor: 'mcp', operation: 'delete_workout', args: a, note: 'Deleted workout.',
      });
    },
  },
  delete_exercise: {
    title: "Delete exercise",
    description:
      'Remove an exercise slot from a day in the active plan. Identify it by `template_exercise_id` OR by `day` (label/name) + `exercise`. NULLs any historical `set_logs.template_exercise_id` that pointed at this slot (sets are kept, queryable by exercise_id; the slot pointer is detached). Bumps the plan version. For substitution, use `swap_exercise` instead. A slot of a reusable workout changes every date that uses it; for a change to one date only, call add_one_time_workout first and change its copy (whose slots change only that date).',
    inputSchema: obj(
      {
        expected_version: { type: 'integer', minimum: 1, description: 'Reviewed plan version. A stale value returns conflict/current_version; omit only for a tokenless patch with one bounded retry.' },
        template_exercise_id: { type: 'string' },
        day: { type: 'string', description: 'Workout id, label or name; a one-time workout only by its id' },
        exercise: { type: 'string' },
      },
      [],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const fields = invalidFields(a, {}, { expected_version: isPositiveInteger });
      if (fields.length) return { error: 'invalid_fields', fields };
      const r = await deleteTemplateExercise(env.DB, userId, {
        template_exercise_id:
          typeof a.template_exercise_id === 'string' ? a.template_exercise_id : undefined,
        day: typeof a.day === 'string' ? a.day : undefined,
        exercise: typeof a.exercise === 'string' ? a.exercise : undefined,
      }, {
        actor: 'mcp', operation: 'delete_exercise', args: a,
        note: 'Deleted exercise slot.',
      }, { expectedVersion: a.expected_version as number | undefined });
      return r ?? { error: 'slot_not_found' };
    },
  },
  adjust_today: {
    title: "Adjust recurring targets",
    description:
      'Persistently changes recurring workout-template targets. With day_label it changes every future use of that named workout; when omitted it changes every workout in the plan. This is not a one-date override: for one date only, use add_one_time_workout and change its copy. Reduces sets (reduce_volume/deload) or load/assistance (reduce_intensity), reports before/after changes, and may be a no-op when no supported reduction exists.',
    inputSchema: obj(
      {
        intent: { type: 'string', enum: ['deload', 'reduce_volume', 'reduce_intensity'] },
        magnitude: { type: 'string', enum: ['light', 'moderate', 'heavy'] },
        day_label: { type: 'string' },
        reason: { type: 'string', description: 'why — stored as a coaching note' },
      },
      ['intent'],
    ),
    write: true,
    atomicWrite: true,
    handler: (a, env, userId) =>
      adjustToday(
        env.DB,
        userId,
        a.intent as 'deload' | 'reduce_volume' | 'reduce_intensity',
        (a.magnitude as 'light' | 'moderate' | 'heavy') ?? 'moderate',
        typeof a.day_label === 'string' ? a.day_label : undefined,
        {
          actor: 'mcp', operation: 'adjust_today', args: a,
          reason: typeof a.reason === 'string' ? a.reason : null,
          note: `${a.intent}(${a.magnitude ?? 'moderate'})${a.day_label ? ` ${a.day_label}` : ''}.` +
            (typeof a.reason === 'string' ? ` Reason: ${a.reason}` : ''),
        },
      ),
  },
  set_schedule: {
    title: "Set weekly schedule",
    description:
      'Set the PERMANENT recurring weekly training pattern (which day template runs each weekday — Mon..Sun). This is the standing routine, not a one-off: it repeats every week and drives the future calendar. Pass `week` as a full map keyed mon/tue/wed/thu/fri/sat/sun; each value is a day template id, day_label, or day name, or null for a rest day. Omitted weekdays become rest. Optionally pass expected_version for optimistic concurrency (mismatch → conflict, refetch get_current_plan and reapply). Bumps the plan version. A weekday can also hold `extras`: activities done besides its main workout (morning stretching, core before bed). Anything a weekday holds can have an optional `times` entry, a 24-hour local time the app reminds the member at; most have none. For a single specific date use set_planned_session / skip_planned_session instead.',
    inputSchema: obj(
      {
        week: {
          type: 'object',
          description: 'Keys mon..sun → day id/label/name or null (rest).',
          properties: {
            mon: { type: ['string', 'null'] },
            tue: { type: ['string', 'null'] },
            wed: { type: ['string', 'null'] },
            thu: { type: ['string', 'null'] },
            fri: { type: ['string', 'null'] },
            sat: { type: ['string', 'null'] },
            sun: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
        extras: {
          type: 'object',
          description: `Optional. Keys mon..sun → ordered list of saved workouts or activities done that day besides its main workout, at most ${MAX_SCHEDULE_EXTRAS} per day. Replaces every weekday's extras; omit to keep them.`,
          properties: Object.fromEntries(WEEKDAYS.map((d) => [d, { type: 'array', items: { type: 'string' } }])),
          additionalProperties: false,
        },
        times: {
          type: 'object',
          description: 'Optional. Keys mon..sun → map of a workout on that day (its main workout or one of its extras; id, label or name) → "HH:MM" 24-hour local time, such as {"mon": {"Core before bed": "21:00"}}. Only for times the member chose; most items have none. Replaces every weekday\'s times; omit to keep them. A workout not on that weekday is rejected (time_not_on_day).',
          properties: Object.fromEntries(WEEKDAYS.map((d) => [d, {
            type: 'object', additionalProperties: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
          }])),
          additionalProperties: false,
        },
        expected_plan_id: { type: 'string' },
        expected_version: { type: 'integer' },
      },
      ['week'],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const week = (a.week as Record<string, string | null>) ?? {};
      if (a.times !== undefined && !isScheduleTimesInput(a.times)) {
        return { error: 'invalid_times', detail: 'times maps mon..sun to maps of workout names or ids to "HH:MM" (24-hour).' };
      }
      if (a.extras !== undefined && !isScheduleExtrasInput(a.extras)) {
        return { error: 'invalid_extras', detail: 'extras maps mon..sun to lists of workout names or ids.' };
      }
      const extras = a.extras as Partial<Record<Weekday, string[]>> | undefined;
      const r = await setPlanSchedule(
        env.DB,
        userId,
        week as Partial<Record<Weekday, string | null>>,
        typeof a.expected_version === 'number' ? a.expected_version : null,
        typeof a.expected_plan_id === 'string' ? a.expected_plan_id : null,
        { actor: 'mcp', operation: 'set_schedule', args: a, note: 'Set recurring weekly schedule.' },
        extras,
        a.times as Partial<Record<Weekday, Record<string, string>>> | undefined,
      );
      return r;
    },
  },
  set_program: {
    title: "Set a block of weeks",
    description:
      'Set or clear a BLOCK of weeks that differ, for training that changes over a period (a marathon build with an easier week every few weeks and a taper, or a cycle such as an A week and a B week). `program.start` is a Monday (YYYY-MM-DD); `program.weeks` is the ordered list of weeks, each with `week` (mon..sun → workout id/label/name or null for rest, like set_schedule), optional `extras` (activities only, at most four a day) an optional short `label` such as "Base", "Easy week" or "Taper", and optional `targets` (slot id from get_current_plan → that week: target_sets, target_reps, target_reps_max, target_rpe, target_weight, target_weight_unit, target_duration_s or run_steps; omitted fields keep the slot values, null clears a nullable one) so one long run can grow from week to week without a workout per week. With `repeat: true` the weeks start over after the last one until cleared; otherwise, once the block ends, the repeating weekly schedule (set_schedule) applies again, as it does before the start. Pass `program: null` to clear the block. Replaces any existing block. A real session on a date and trips still win, as with the weekly schedule. Optionally pass expected_version (mismatch → conflict, refetch get_current_plan and reapply). Bumps the plan version.',
    inputSchema: obj(
      {
        program: {
          type: ['object', 'null'],
          properties: {
            name: { type: 'string', description: 'Optional, up to 60 characters.' },
            start: { type: 'string', description: 'The Monday the first week starts, YYYY-MM-DD.' },
            repeat: { type: 'boolean', description: 'true = a cycle that starts over after the last week.' },
            weeks: {
              type: 'array',
              minItems: 1,
              maxItems: 52,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Optional, up to 40 characters.' },
                  week: {
                    type: 'object',
                    properties: Object.fromEntries(WEEKDAYS.map((d) => [d, { type: ['string', 'null'] }])),
                    additionalProperties: false,
                  },
                  extras: {
                    type: 'object',
                    properties: Object.fromEntries(WEEKDAYS.map((d) => [d, { type: 'array', items: { type: 'string' } }])),
                    additionalProperties: false,
                  },
                  targets: {
                    type: 'object',
                    description: 'Slot id → this week\'s targets for that slot.',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        target_sets: { type: 'integer', minimum: 1 },
                        target_reps: { type: 'integer', minimum: 1 },
                        target_reps_max: { type: ['integer', 'null'], minimum: 1 },
                        target_rpe: { type: ['number', 'null'] },
                        target_weight: { type: ['number', 'null'] },
                        target_weight_unit: { type: 'string', enum: ['lb', 'kg'] },
                        target_duration_s: { type: ['integer', 'null'], minimum: 1 },
                        run_steps: { type: ['array', 'null'], description: 'Run steps, as on the run slot.' },
                      },
                      additionalProperties: false,
                    },
                  },
                },
                required: ['week'],
                additionalProperties: false,
              },
            },
          },
          required: ['start', 'weeks'],
          additionalProperties: false,
        },
        expected_version: { type: 'integer' },
      },
      ['program'],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const program = a.program === null ? null : a.program as ProgramInput | undefined;
      if (program === undefined || (program !== null && (typeof program !== 'object' || Array.isArray(program)))) {
        return { error: 'invalid_program', detail: 'Pass program as an object, or null to clear the block.' };
      }
      return setProgram(env.DB, userId, program,
        typeof a.expected_version === 'number' ? a.expected_version : null,
        { actor: 'mcp', operation: 'set_program', args: a,
          note: program ? `Set a block of ${program.weeks?.length ?? 0} weeks from ${program.start}.` : 'Cleared the block of weeks.' });
    },
  },
  build_program: {
    title: "Build a block of weeks to an event",
    description:
      'Lay out a block of weeks to a running event by the same fixed rules as the app\'s "Train for an event", as a starting point you can then adjust week by week with set_program. Without `save` it only PREVIEWS (writes nothing): each week\'s phase (base, build, peak, easy, taper, race), long run in meters, how much of it is at goal pace, and the workout day\'s session `{type: strides|tempo|intervals|goal_pace|shakeout, reps, work_s}`, plus the rules with defaults filled in and `plan_version`. The rules: the long run builds from the longest run lately to `peak_m` (at most 15% or a mile a week), every `easy_every`th week is easier (75%), the last `taper_weeks` weeks taper (race week included); the workout day runs strides, then a growing tempo, then peak sessions, then tapers; with `race.goal_time_s` a half or marathon long run finishes at goal pace. Lifts and other activities stay as in the weekly schedule; other runs shorten in easier weeks. With `save: true` and `expected_version` (the preview\'s `plan_version`) it sets the race and the block together in one plan version, replacing any block; to keep exactly the previewed weeks, send the preview\'s resolved rules back. The long run day\'s and workout day\'s run workouts must each be on only that day. Pass `workout_weekday: null` for no workout day; omitted, one is suggested. Distances are meters; `unit` (mi or km) only rounds the long runs. For training with no event ("Keep building, no date"), pass `open: {weeks}` (4 to 52) instead of `race`: the long run steps up by at most 15% or a mile a week to `peak_m` (the ceiling, default 10 mi), every `easy_every`th week easier, then holds there until the block ends; no event is saved.',
    inputSchema: obj(
      {
        race: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            discipline: { type: 'string', description: 'running' },
            distance: { type: 'string', description: 'e.g. "Marathon"' },
            distance_m: { type: 'number', description: 'Required: 5000, 10000, 21097, 42195…' },
            goal_time_s: { type: 'integer', description: 'Optional goal finish time; the plan then aims at goal pace.' },
            priority: { type: 'string', enum: ['A', 'B', 'C'] },
            location: { type: 'string' },
          },
          required: ['name', 'date', 'discipline', 'distance_m'],
          additionalProperties: false,
        },
        open: {
          type: 'object',
          description: 'Instead of race: a block with no event.',
          properties: { weeks: { type: 'integer', minimum: 4, maximum: 52 } },
          required: ['weeks'],
          additionalProperties: false,
        },
        long_run_weekday: { type: 'string', enum: [...WEEKDAYS] },
        workout_weekday: { type: ['string', 'null'], enum: [...WEEKDAYS, null] },
        today: { type: 'string', description: "YYYY-MM-DD; defaults to the member's today." },
        start: { type: 'string', description: 'The first Monday; defaults to the Monday on or after today.' },
        long_run_now_m: { type: 'number', description: 'Where the build starts; defaults to the longest run in the last four weeks.' },
        peak_m: { type: 'number' },
        easy_every: { type: 'integer', description: '0 for never, else 2 to 8.' },
        taper_weeks: { type: 'integer', minimum: 1, maximum: 4 },
        shorten_other_runs: { type: 'boolean' },
        unit: { type: 'string', enum: ['mi', 'km'] },
        save: { type: 'boolean' },
        expected_version: { type: 'integer' },
      },
      ['long_run_weekday'],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const body = { ...a } as Record<string, unknown>;
      if (body.today === undefined) body.today = await todayForUser(env.DB, userId);
      const request = parseEventBuildBody(body);
      if ('invalid' in request) return { error: 'invalid_fields', fields: request.invalid };
      const result = await buildEventBlock(env.DB, userId, request.input,
        request.expectedVersion == null ? null : {
          expectedVersion: request.expectedVersion,
          attribution: { actor: 'mcp', operation: 'build_program', args: a,
            note: request.input.race
              ? `Built a ${request.input.race.name} block to ${request.input.race.date} by the event rules.`
              : `Built a ${request.input.open?.weeks}-week "Keep building" block by the rules.` },
        }, { coach: true });
      return result;
    },
  },
  set_planned_session: {
    title: "Plan a date",
    description:
      'Pin ONE specific calendar date to a training day (a single-date override, NOT a recurring change). Use this for "next Saturday do legs" — it does not alter the standing weekly pattern and does not bump the plan version. `day` accepts a day template id, day_label, or name. Pass expected_attempt from the current session, or 0 when no session exists; a mismatch returns a conflict so this calendar edit cannot rewrite a newer workout attempt. For the permanent weekly routine use set_schedule.',
    inputSchema: obj(
      {
        slot: { type: 'integer', minimum: 0 },
        additional: { type: 'boolean', description: 'Allocate another workout on this date. In this mode day must be an exact workout id. Requires a stable client UUID id; retry the same id after a timeout.' },
        id: { type: 'string', format: 'uuid' },
        date: { type: 'string', description: 'YYYY-MM-DD (device-local)' },
        day: { type: 'string', description: 'day template id, label, or name' },
        expected_attempt: { type: 'integer', minimum: 0 },
      },
      ['date', 'day'],
    ),
    write: true,
    handler: async (a, env, userId) => {
      if (a.slot !== undefined && (!Number.isSafeInteger(a.slot) || Number(a.slot) < 0)) return { error: 'invalid_slot' };
      if (a.additional !== undefined && typeof a.additional !== 'boolean') return { error: 'invalid_additional' };
      if (a.additional === true && (typeof a.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.id)
          || a.slot !== undefined || (a.expected_attempt !== undefined && a.expected_attempt !== 0))) return { error: 'invalid_additional' };
      if (a.id !== undefined && a.additional !== true) return { error: 'invalid_additional' };
      return setPlannedSession(
        env.DB,
        userId,
        String(a.date),
        String(a.day),
        typeof a.expected_attempt === 'number' ? a.expected_attempt : 0,
        typeof a.slot === 'number' ? a.slot : 0,
        a.additional === true ? String(a.id) : undefined,
      );
    },
    note: (a, r) =>
      r?.ok ? `Planned ${a.date} → day "${a.day}" (one-off, no plan change).` : null,
  },
  skip_planned_session: {
    title: "Skip a date",
    description:
      'Mark ONE specific calendar date as a rest/skip day (single-date override, NOT recurring). Use for "skip this Friday". Pass expected_attempt from the current session, or 0 when no session exists; a mismatch returns a conflict so this calendar edit cannot hide a newer workout attempt. Does not change the standing weekly pattern and does not bump the plan version.',
    inputSchema: obj(
      {
        slot: { type: 'integer', minimum: 0 },
        date: { type: 'string', description: 'YYYY-MM-DD (device-local)' },
        expected_attempt: { type: 'integer', minimum: 0 },
      },
      ['date'],
    ),
    write: true,
    handler: async (a, env, userId) => {
      if (a.slot !== undefined && (!Number.isSafeInteger(a.slot) || Number(a.slot) < 0)) return { error: 'invalid_slot' };
      return skipPlannedSession(
        env.DB,
        userId,
        String(a.date),
        typeof a.expected_attempt === 'number' ? a.expected_attempt : 0,
        typeof a.slot === 'number' ? a.slot : 0,
      );
    },
    note: (a, r) => (r?.ok ? `Skipped ${a.date} (one-off rest, no plan change).` : null),
  },
  set_race: {
    title: "Set race goal",
    description:
      'Set the goal A-race the whole plan builds toward — the anchor for periodization, taper, and race-week logic. Pass name, date (YYYY-MM-DD), and discipline (e.g. triathlon, running, cycling); optionally distance (e.g. "70.3"), distance_m (the distance in meters, e.g. 5000), goal_time_s (the goal finish time in seconds), priority (A|B|C), and location. Replaces any existing race; the member can also set or clear it in the app or on the web. Versioned: optionally pass expected_version for optimistic concurrency (mismatch → conflict, refetch get_current_plan and reapply). Bumps the plan version.',
    inputSchema: obj(
      {
        name: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD civil date' },
        discipline: { type: 'string', description: 'triathlon | running | cycling | ...' },
        distance: { type: 'string', description: 'e.g. "70.3", "marathon"' },
        distance_m: { type: 'number', description: 'The distance in meters, e.g. 5000 for a 5k' },
        goal_time_s: { type: 'integer', description: 'Goal finish time in seconds' },
        priority: { type: 'string', enum: ['A', 'B', 'C'] },
        location: { type: 'string' },
        expected_version: { type: 'integer' },
      },
      ['name', 'date', 'discipline'],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const race: RaceGoal = {
        name: String(a.name),
        date: String(a.date),
        discipline: String(a.discipline),
      };
      if (typeof a.distance === 'string') race.distance = a.distance;
      if (typeof a.distance_m === 'number' && Number.isFinite(a.distance_m) && a.distance_m > 0) race.distance_m = a.distance_m;
      if (typeof a.goal_time_s === 'number' && Number.isFinite(a.goal_time_s) && a.goal_time_s > 0) {
        race.goal_time_s = Math.round(a.goal_time_s);
      }
      if (a.priority === 'A' || a.priority === 'B' || a.priority === 'C') race.priority = a.priority;
      if (typeof a.location === 'string') race.location = a.location;
      return setRace(
        env.DB,
        userId,
        race,
        typeof a.expected_version === 'number' ? a.expected_version : null,
        {
          actor: 'mcp', operation: 'set_race', args: a,
          note: `Set A-race: ${a.name} — ${a.discipline} on ${a.date}.`,
        },
      );
    },
  },
  set_periodization: {
    title: "Set training blocks",
    description:
      'Set the periodization plan — the ordered training phases (base|build|peak|taper|race|recovery) with date ranges and intent. This is the macrocycle STRUCTURE the coach reasons over, not a per-day calendar. Pass `phases` as a full ordered array; it REPLACES any existing periodization. Each phase: phase, start (YYYY-MM-DD), end (YYYY-MM-DD); optional focus, weekly_load_target, strength_emphasis. Versioned (expected_version optional). Bumps the plan version.',
    inputSchema: obj(
      {
        phases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              phase: {
                type: 'string',
                enum: ['base', 'build', 'peak', 'taper', 'race', 'recovery'],
              },
              start: { type: 'string', description: 'YYYY-MM-DD' },
              end: { type: 'string', description: 'YYYY-MM-DD' },
              focus: { type: 'string' },
              weekly_load_target: { type: 'number' },
              strength_emphasis: { type: 'string' },
            },
            required: ['phase', 'start', 'end'],
            additionalProperties: false,
          },
        },
        expected_version: { type: 'integer' },
      },
      ['phases'],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) =>
      setPeriodization(
        env.DB,
        userId,
        (a.phases as PeriodizationPhase[]) ?? [],
        typeof a.expected_version === 'number' ? a.expected_version : null,
        { actor: 'mcp', operation: 'set_periodization', args: a, note: 'Set periodization.' },
      ),
  },
  add_trip: {
    title: "Add trip",
    description:
      'Add a trip / availability blackout range (travel, planned rest, injury) so the plan knows when training is limited or off. Pass start + end (YYYY-MM-DD) and type (travel|rest|injury|other); optionally can_train_light (pool/run access while away?) and a note. Returns the new trip id. This stores the AVAILABILITY fact only — it does NOT itself blank the calendar; re-plan affected days with set_planned_session / skip_planned_session. Versioned (expected_version optional); bumps the plan version.',
    inputSchema: obj(
      {
        start: { type: 'string', description: 'YYYY-MM-DD' },
        end: { type: 'string', description: 'YYYY-MM-DD' },
        type: { type: 'string', enum: ['travel', 'rest', 'injury', 'other'] },
        can_train_light: { type: 'boolean' },
        note: { type: 'string' },
        expected_version: { type: 'integer' },
      },
      ['start', 'end'],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const trip: Omit<Trip, 'id'> = {
        start: String(a.start),
        end: String(a.end),
        type: (TRIP_TYPES.has(a.type as string) ? a.type : 'travel') as TripType,
      };
      if (typeof a.can_train_light === 'boolean') trip.can_train_light = a.can_train_light;
      if (typeof a.note === 'string') trip.note = a.note;
      return addTrip(
        env.DB,
        userId,
        trip,
        typeof a.expected_version === 'number' ? a.expected_version : null,
        {
          actor: 'mcp', operation: 'add_trip', args: a,
          note: `Added ${a.type ?? 'travel'} trip ${a.start}→${a.end}.`,
        },
      );
    },
  },
  update_trip: {
    title: "Update trip",
    description:
      'Edit an existing trip by id (dates, type, can_train_light, note). Pass the trip id (from add_trip or get_current_plan) plus the fields to change; omitted fields are left unchanged. Versioned (expected_version optional); bumps the plan version.',
    inputSchema: obj(
      {
        id: { type: 'string' },
        start: { type: 'string', description: 'YYYY-MM-DD' },
        end: { type: 'string', description: 'YYYY-MM-DD' },
        type: { type: 'string', enum: ['travel', 'rest', 'injury', 'other'] },
        can_train_light: { type: 'boolean' },
        note: { type: 'string' },
        expected_version: { type: 'integer' },
      },
      ['id'],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const patch: Partial<Omit<Trip, 'id'>> = {};
      if (typeof a.start === 'string') patch.start = a.start;
      if (typeof a.end === 'string') patch.end = a.end;
      if (TRIP_TYPES.has(a.type as string)) patch.type = a.type as TripType;
      if (typeof a.can_train_light === 'boolean') patch.can_train_light = a.can_train_light;
      if (typeof a.note === 'string') patch.note = a.note;
      return updateTrip(
        env.DB,
        userId,
        String(a.id),
        patch,
        typeof a.expected_version === 'number' ? a.expected_version : null,
        { actor: 'mcp', operation: 'update_trip', args: a, note: `Updated trip ${a.id}.` },
      );
    },
  },
  remove_trip: {
    title: "Remove trip",
    description:
      'Remove a trip by id. Versioned (expected_version optional); bumps the plan version.',
    inputSchema: obj(
      { id: { type: 'string' }, expected_version: { type: 'integer' } },
      ['id'],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) =>
      removeTrip(
        env.DB,
        userId,
        String(a.id),
        typeof a.expected_version === 'number' ? a.expected_version : null,
        { actor: 'mcp', operation: 'remove_trip', args: a, note: `Removed trip ${a.id}.` },
      ),
  },
  set_stress_model: {
    title: "Set training stress model",
    description:
      'Set the planning stress model — the multi-dimensional load/recovery rules the coach reasons over so training stress is NEVER reduced to one number (docs/MULTISPORT.md §7). Pass discipline_weights (per-discipline system loads, e.g. {run:{aerobic:1,impact:1}}), interference_rules (prose constraints like "heavy_lower 48h from key_run"), and age_modifiers (e.g. {athlete_age:75, recovery_multiplier:1.4}). Replaces the existing model. Versioned (expected_version optional); bumps the plan version.',
    inputSchema: obj(
      {
        discipline_weights: { type: 'object', additionalProperties: true },
        interference_rules: { type: 'array', items: { type: 'string' } },
        age_modifiers: { type: 'object', additionalProperties: true },
        expected_version: { type: 'integer' },
      },
      [],
    ),
    write: true,
    atomicWrite: true,
    handler: async (a, env, userId) => {
      const model: StressModel = {};
      if (a.discipline_weights && typeof a.discipline_weights === 'object') {
        model.discipline_weights = a.discipline_weights as StressModel['discipline_weights'];
      }
      if (Array.isArray(a.interference_rules)) {
        model.interference_rules = a.interference_rules as string[];
      }
      if (a.age_modifiers && typeof a.age_modifiers === 'object') {
        model.age_modifiers = a.age_modifiers as StressModel['age_modifiers'];
      }
      return setStressModel(
        env.DB,
        userId,
        model,
        typeof a.expected_version === 'number' ? a.expected_version : null,
        { actor: 'mcp', operation: 'set_stress_model', args: a, note: 'Updated planning stress model.' },
      );
    },
  },
  refresh_rides: {
    title: "Refresh rides",
    description:
      'Force an immediate refresh from intervals.icu: both the PLANNED cycling/endurance calendar (upcoming rides) AND the COMPLETED activity feed (rides/runs you finished, with their actual duration/power/HR). Webhooks are the primary sync path; an hourly backstop checks for caches never synced or last successfully synced more than two hours ago. Returns how many of each are cached and the sync status. Does NOT change the training plan or its version. No-op if the intervals.icu integration is not configured.',
    inputSchema: obj({}),
    // An action → audited. Reconciled caches only: NO plans.version bump and
    // (no `note`) NO notes row.
    write: true,
    handler: async (_a, env, userId) => {
      const r = await syncExternalEvents(env.DB, env, { userId });
      const a = await syncExternalActivities(env.DB, env, { userId });
      return {
        rides: { synced: r.synced, status: r.status, ...(r.detail ? { detail: r.detail } : {}) },
        activities: {
          synced: a.synced,
          status: a.status,
          ...(a.detail ? { detail: a.detail } : {}),
        },
      };
    },
  },
  get_recent_activities: {
    title: "Get recent activities",
    description:
      'Get COMPLETED activities (rides, runs, swims and other sports from intervals.icu, Apple Health, .fit files and the run recorder) with their actuals. `sport` names what it was (soccer, tennis, swim, …; `kind` is the coarse family): duration, average/normalized power, average/max heart rate, distance, elevation, TSS. `training_load` is the figure from the provider; `load` (with `load_intensity` and `load_method`: provider, power, power_summary, heart_rate, heart_rate_average, pace or effort) is the load Tres Fort shows, computed from the member thresholds when the provider has none, else estimated from the member’s own 1-10 `effort` rating (see rate_activity) or, without one, Apple Watch’s 1-10 `watch_effort` score, and null when there is no usable data. `range` is a day count back from today (default 30, max 365); `limit` caps the count (default 20). Use this to see what endurance work has actually been done when coaching around lifting.',
    inputSchema: obj(
      {
        range: { type: 'integer', minimum: 1, maximum: 365, description: 'days back (default 30)' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'max results (default 20)' },
      },
      [],
    ),
    handler: async (a, env, userId) => {
      const range = typeof a.range === 'number' ? Math.min(365, Math.max(1, a.range)) : 30;
      const limit = typeof a.limit === 'number' ? Math.min(200, Math.max(1, a.limit)) : 20;
      const today = await todayForUser(env.DB, userId);
      const acts = await getRecentActivities(env.DB, userId, { to: today, range, limit });
      return {
        to: today,
        range,
        attribution_instructions: ATTRIBUTION_INSTRUCTIONS,
        activities: acts.map((x) => ({
          source_attribution: x.source_attribution,
          id: x.id,
          date: x.date,
          kind: x.kind,
          sport: x.sport ?? null,
          name: x.name,
          moving_time_sec: x.moving_time_sec,
          distance_m: x.distance_m,
          average_watts: x.average_watts,
          weighted_avg_watts: x.weighted_avg_watts,
          average_hr: x.average_hr,
          max_hr: x.max_hr,
          training_load: x.training_load,
          intensity: x.intensity,
          load: x.effective_load,
          load_intensity: x.effective_intensity,
          load_method: x.load_method,
          effort: x.effort ?? null,
          watch_effort: x.provider_effort ?? null,
          calories: x.calories,
          elevation_gain_m: x.elevation_gain_m,
        })),
      };
    },
  },
  get_group_feed: {
    title: "Get group feed",
    description:
      'See the recent training activity of the people in a group — strength sessions (with top sets), intervals.icu rides, and free-form activities (pilates, yoga, walks) from every member, interleaved by recency. Pass `group_id` for a specific group or omit to default to the first group the user is in. `range` is "7d" | "14d" | "30d" (default 7d) and ALSO returns per-member workout_count + streak_days so you can compare. Use this to answer questions like "how is the group doing this week?" or "did Sarah lift yesterday?". Read-only; does not log anything. Privacy contract: a strength session here exposes the day name + top set per exercise but NEVER the session notes, perceived fatigue, set notes, or set-level RPE — those stay private to the lifter.',
    inputSchema: obj(
      {
        group_id: { type: 'string', description: 'Group id (UUID). Omit to default to the first group the user belongs to.' },
        range: { type: 'string', description: '7d | 14d | 30d (default 7d)' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max feed items (default 30)' },
      },
      [],
    ),
    handler: async (a, env, userId) => {
      // Resolve target group: explicit `group_id` (and verify caller is in
      // it — same 403/404 collapse the REST surface uses since MCP can't
      // distinguish a stranger vs a stale id any better) OR the caller's
      // first group via listGroupsForUser. The "no groups yet" empty-state
      // is a normal return value, not an error.
      const groups = await listGroupsForUser(env.DB, userId);
      let groupId: string | undefined;
      if (typeof a.group_id === 'string' && a.group_id.length > 0) {
        groupId = a.group_id;
        if (!(await isGroupMember(env.DB, userId, groupId))) {
          return { error: 'forbidden_or_not_found', group_id: groupId };
        }
      } else if (groups.length > 0) {
        groupId = groups[0]!.id;
      } else {
        return { groups: [], items: [], stats: [], note: 'You are not in any groups yet.' };
      }
      // range: same accepted set as the REST endpoint.
      const rangeStr = typeof a.range === 'string' ? a.range : '7d';
      const m = /^(\d+)d$/.exec(rangeStr);
      const days = m ? Math.max(1, Math.min(365, Number(m[1]))) : 7;
      const limit =
        typeof a.limit === 'number' ? Math.max(1, Math.min(100, Math.floor(a.limit))) : 30;
      const items = await getGroupFeed(env.DB, groupId, null, null, limit, userId);
      const stats = await getGroupStats(env.DB, groupId, days, userId);
      const groupName = groups.find((g) => g.id === groupId)?.name ?? null;
      return {
        group_id: groupId,
        group_name: groupName,
        range: `${days}d`,
        items,
        stats,
      };
    },
  },
};

// ---- resource + prompt ---------------------------------------------------

const STATE_URI = 'coach://state/current';

async function buildStateBrief(env: Env, userId: string): Promise<string> {
  const tree = await getPlanTree(env.DB, userId);
  const today = await todayForUser(env.DB, userId);
  const recent = await getRecentSessions(env.DB, userId, 7, today);
  const catalog = await getExercises(env.DB);
  const last = recent[0] ?? null;
  // Resolve metadata and names from this exact plan tree, not a later read.
  const authoredContext = tree ? coachingPlanMeta(tree.meta) : null;
  const hasSchedule = authoredContext?.schedule != null;
  const schedule = tree && hasSchedule ? resolvedScheduleNames(tree) : null;
  const scheduleExtras = tree && hasSchedule ? resolvedScheduleExtras(tree) : {};
  const lastCompleted = await getLastCompletedSession(env.DB, userId, undefined, today);
  const summaryRows = [...recent];
  if (lastCompleted && !summaryRows.some(s => s.id === lastCompleted.id)) summaryRows.push(lastCompleted);
  // One batched read for every session in the brief, grouped here — the
  // per-session read was an N+1 over up to eight rows.
  const briefSets = await getSetsForSessions(env.DB, userId, summaryRows.map(session => session.id));
  const setsBySession = new Map<string, typeof briefSets>();
  for (const set of briefSets) {
    const rows = setsBySession.get(set.session_id);
    if (rows) rows.push(set); else setsBySession.set(set.session_id, [set]);
  }
  const summaries = new Map(summaryRows.map(session =>
    [session.id, coachingSession(session, setsBySession.get(session.id) ?? [], catalog)] as const));
  // Cycling awareness, zero extra Claude calls: a compact 28-day ride
  // window + conflicts folded straight into the auto-loaded brief.
  const horizon = addDaysIso(today, 28);
  const rides = await getUpcomingRides(env.DB, userId, { from: today, range: 28 });
  const conflicts = await getRideConflicts(env.DB, userId, today, horizon, today);
  // Completed endurance actuals (last 14d) so the coach sees real ride/run
  // load without an extra call. Empty when the integration is dormant.
  const recentActivities = await getRecentActivities(env.DB, userId, {
    to: today,
    range: 14,
    limit: 10,
  });
  const brief = {
    today,
    training_profile: await getTrainingProfile(env.DB, userId),
    active_plan: tree
      ? {
          id: tree.id,
          name: tree.name,
          version: tree.version,
          authored_context: authoredContext,
          weekly_schedule: schedule,
          ...(Object.keys(scheduleExtras).length ? { weekly_schedule_extras: scheduleExtras } : {}),
          // Where today falls in a block of weeks ("Week 6 of 16 · Build",
          // this week's changed targets); the weekly schedule above is the
          // pattern outside the block.
          program_week: programWeekSummary(tree, today),
          // Workouts made for one date only (today's included), apart from
          // the reusable ones below.
          ...(() => {
            const oneTime = splitOneTimeWorkouts(tree.workouts, today).oneTime;
            return oneTime.length ? { one_time_workouts: oneTime.map((d) => ({
              id: d.id, name: d.name, date: d.one_time_date, exercises: d.exercises.length })) } : {};
          })(),
          workouts: tree.workouts.filter(d => d.archived_at == null && d.one_time_date == null).map((d) => ({
            label: d.day_label,
            name: d.name,
            tags: JSON.parse(d.tags ?? '[]'),
            archived_at: d.archived_at ?? null,
            exercises: d.exercises.length,
            groups: coachGroupSummary(d.exercises),
          })),
        }
      : null,
    last_session: last ? summaries.get(last.id) : null,
    last_completed_session: lastCompleted ? summaries.get(lastCompleted.id) : null,
    recent_sessions: recent.map(session => summaries.get(session.id)),
    measures: {
      source: 'Persisted session/set logs and exercise catalog; feedback is member-authored.',
      logged_working_sets: 'Non-warm-up logged sets, counted once; primary muscle only, not measured stimulus or complete muscle volume.',
      effort_coverage: 'sets_with_effort counts recorded per-set RPE; missing effort is unknown.',
      external_load_volume: 'Positive external load times reps, with implement/side multipliers, grouped by unit; excludes timed, assisted and zero-load work. No system load or body mass.',
      key_sets: 'Best observed rep/hold set per exact comparable condition; not a PR. Counts and effort coverage include all logged working sets.',
      comparisons: 'Same exercise, execution mode, external load, units and side/implement convention only; no automatic readiness or strength conversion.',
    },
    scheduling_context: {
      basis: 'scheduling_heuristic',
      sources: ['projected strength dates', 'cached intervals.icu planned events'],
      thresholds: { training_load: 150, planned_duration_sec: 9000 },
      limitation: 'No strength-day load or muscle inputs. Unknown load/duration is incomplete context; thresholds do not establish easy work, individualized safety or interference.',
    },
    // Upcoming endurance load + lift/ride conflicts (next 28 days). Empty
    // arrays when the intervals.icu integration is dormant or clear.
    upcoming_rides: rides.map((r) => ({
      id: r.id,
      source: r.source,
      date: r.date,
      kind: r.kind,
      title: r.title,
      training_load: r.training_load,
      planned_duration_sec: r.planned_duration_sec,
    })),
    ride_conflicts: conflicts,
    // Recently COMPLETED endurance work (actuals from intervals.icu).
    attribution_instructions: ATTRIBUTION_INSTRUCTIONS,
    recent_activities: recentActivities.map((a) => ({
      source_attribution: a.source_attribution,
      id: a.id,
      source: a.source,
      date: a.date,
      kind: a.kind,
      sport: a.sport ?? null,
      name: a.name,
      moving_time_sec: a.moving_time_sec,
      distance_m: a.distance_m,
      average_watts: a.average_watts,
      average_hr: a.average_hr,
      training_load: a.training_load,
      load: a.effective_load,
      load_method: a.load_method,
    })),
  };
  return [
    '# tres-fort — current state',
    'Current training context. Use the tools for anything deeper.',
    '```json',
    JSON.stringify(brief, null, 2),
    '```',
  ].join('\n');
}

// ---- JSON-RPC dispatch ---------------------------------------------------

async function dispatch(
  req: RpcRequest,
  env: Env,
  userId: string,
  bg?: BgScheduler,
) {
  switch (req.method) {
    case 'initialize': {
      const requested = (req.params?.protocolVersion as string) ?? DEFAULT_PROTOCOL;
      return ok(req.id, {
        protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : DEFAULT_PROTOCOL,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS + "\n" + ATTRIBUTION_INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok(req.id, {});
    case 'tools/list':
      return ok(req.id, {
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          // All tools operate on the authenticated account and its bounded
          // catalog/groups/linked Intervals account. None publish publicly or
          // accept arbitrary external destinations. Writes default to a
          // destructive hint unless explicitly verified append-only below.
          annotations: {
            title: t.title,
            readOnlyHint: !t.write,
            destructiveHint: !!t.write && !t.appendOnly,
            openWorldHint: false,
          },
        })),
      });
    case 'tools/call': {
      const name = req.params?.name as string;
      const tool = TOOLS[name];
      if (!tool) return err(req.id, -32602, `unknown tool: ${name}`);
      try {
        const args = (req.params?.arguments as Json) ?? {};
        if (typeof args !== 'object' || Array.isArray(args) || hasRetiredWorkoutFields(args)) {
          return err(req.id, -32602, 'Invalid arguments. Use workouts and workout_id for workout fields.');
        }
        const result = await tool.handler(args, env, userId, bg);
        if (tool.write && !tool.atomicWrite && !tool.handlerAudited) {
          await writeAudit(env.DB, userId, name, args, JSON.stringify(result));
          const noteBody = tool.note?.(args, result);
          if (noteBody) await writeNote(env.DB, userId, 'plan', null, 'coach', noteBody);
        }
        // Compact JSON reduces formatting overhead while preserving parsed
        // values. Raw text changes; token savings depend
        // on the payload and client. Strings (including the Markdown brief)
        // retain their own whitespace.
        return ok(req.id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        });
      } catch (e) {
        const code = publicToolErrorCode(e);
        if (code === null) logUnexpectedError('mcp_tool', e);
        return ok(req.id, {
          content: [{ type: 'text', text: code === null
            ? 'error: internal. Check current state before retrying a write.'
            : `error: ${code}` }],
          isError: true,
        });
      }
    }
    case 'resources/list':
      return ok(req.id, {
        resources: [
          {
            uri: STATE_URI,
            name: 'Current coaching state',
            description: 'Active plan summary + last session. Read this at chat start.',
            mimeType: 'text/markdown',
          },
        ],
      });
    case 'resources/templates/list':
      return ok(req.id, { resourceTemplates: [] });
    case 'resources/read': {
      const uri = req.params?.uri as string;
      if (uri !== STATE_URI) return err(req.id, -32602, `unknown resource: ${uri}`);
      return ok(req.id, {
        contents: [
          { uri: STATE_URI, mimeType: 'text/markdown', text: await buildStateBrief(env, userId) },
        ],
      });
    }
    case 'prompts/list':
      return ok(req.id, {
        prompts: [
          { name: 'coach_brief', description: 'Load current training state and act as the coach.' },
        ],
      });
    case 'prompts/get': {
      if ((req.params?.name as string) !== 'coach_brief') {
        return err(req.id, -32602, 'unknown prompt');
      }
      return ok(req.id, {
        description: 'Coach brief',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                'You are my strength coach. Here is my current state:\n\n' +
                (await buildStateBrief(env, userId)) +
                '\n\nUse the tres-fort tools to read history and adapt the plan as we talk.',
            },
          },
        ],
      });
    }
    default:
      return err(req.id, -32601, `method not found: ${req.method}`);
  }
}

/** Handle one POST body (single request only; batching removed in spec). */
export async function handleMcp(
  body: unknown,
  env: Env,
  userId: string,
  bg?: BgScheduler,
): Promise<{ status: number; json?: unknown }> {
  const req = body as RpcRequest;
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return { status: 400, json: err(null, -32600, 'invalid request') };
  }
  // `userId` is resolved by the /mcp route from the bearer (static token →
  // owner; OAuth → the token's bound user). Multi-tenant: every tool scopes
  // to it. Notifications (no id) get a bare 202 with no body, per spec.
  if (req.id === undefined || req.id === null) {
    if (req.method.startsWith('notifications/')) return { status: 202 };
  }
  return { status: 200, json: await dispatch(req, env, userId, bg) };
}
