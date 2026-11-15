export interface Env {
  DB: D1Database;
  APPLE_BUNDLE_ID: string;
  /**
   * Sign in with Apple Services ID used by the web app (non-secret). When set,
   * /auth/apple also accepts identity tokens issued to it; those must carry
   * the nonce the web gateway bound to the browser that started sign-in.
   */
  APPLE_WEB_SERVICES_ID?: string;
  /** Apple Developer Team ID used to sign the server-to-server client secret. */
  APPLE_TEAM_ID?: string;
  /** Sign in with Apple private-key identifier (`wrangler secret put`). */
  APPLE_KEY_ID?: string;
  /** PKCS#8 EC private signing key (`wrangler secret put`; never committed). */
  APPLE_PRIVATE_KEY?: string;
  APP_JWT_SECRET: string;
  /** Base64-encoded 32-byte AES-GCM key; stored only as a Worker secret. */
  CREDENTIAL_ENCRYPTION_KEY?: string;
  MCP_STATIC_TOKEN?: string;
  /**
   * Read-only bearer for the owner diagnostics lookups at /diagnostics/*
   * (docs/DIAGNOSTICS.md): the owner's own data only, Garmin and WHOOP left
   * out. At least 32 characters; unset = the door is closed (404).
   */
  DIAGNOSTICS_TOKEN?: string;
  /** Allowlisted Apple `sub`. If set, only this user may sign in. */
  OWNER_APPLE_SUB?: string;
  /** If set, enables POST /auth/dev for local + integration tests. */
  DEV_AUTH_SECRET?: string;
  /**
   * Standing connect code for one synthetic connector-directory review member
   * (a `wrangler secret put` secret, at least 43 URL-safe characters). Works
   * only with REVIEW_USER_ID and only for an account that is not the owner and
   * has no groups, imported activities or Intervals.icu link. Unset = off.
   */
  REVIEW_CONNECT_CODE?: string;
  /** The synthetic review member's user id (non-sensitive). */
  REVIEW_USER_ID?: string;
  /**
   * Domain-verification token issued by OpenAI's plugin portal, served as plain
   * text at /.well-known/openai-apps-challenge. Public once served; set with
   * `wrangler secret put` so it needs no code release. Unset = 404.
   */
  OPENAI_APPS_CHALLENGE?: string;
  /** Retired: never authorizes public coach consent. Kept for legacy fixture compatibility. */
  OWNER_AUTH_PASSPHRASE?: string;
  /**
   * intervals.icu API key (a `wrangler secret put` secret — NEVER committed).
   * The cycling-awareness feature is DORMANT (a clean no-op, no error) when
   * this is unset.
   */
  INTERVALS_ICU_API_KEY?: string;
  /** intervals.icu athlete id (non-sensitive — lives in wrangler.jsonc vars). */
  INTERVALS_ICU_ATHLETE_ID?: string;
  /**
   * intervals.icu OAuth client id (non-sensitive — lives in wrangler.jsonc
   * vars). Issued by the provider for the registered app. When unset,
   * the OAuth "Connect with intervals.icu" flow is dormant (the start route
   * 503s) and only the per-user API-key path is available.
   */
  INTERVALS_OAUTH_CLIENT_ID?: string;
  /**
   * intervals.icu OAuth client secret (a `wrangler secret put` secret — NEVER
   * committed). Used server-side in the /auth/intervals/callback code→token
   * exchange. Paired with INTERVALS_OAUTH_CLIENT_ID.
   */
  INTERVALS_OAUTH_CLIENT_SECRET?: string;
  /**
   * Optional canonical OAuth redirect URI. When set, used verbatim by BOTH
   * /auth/intervals/start and /callback so a multi-hostname/proxy deployment
   * can't derive mismatched origins (intervals.icu rejects a redirect_uri
   * mismatch). Unset → derived from the request origin (fine single-host).
   */
  INTERVALS_OAUTH_REDIRECT_URI?: string;
  /**
   * WHOOP developer app (docs/plans/whoop). Both are `wrangler secret put`
   * secrets, never committed. The client secret signs the token exchange and
   * refresh and also verifies WHOOP's webhook signatures. Either unset → the
   * WHOOP connection is dormant (start 503s, webhooks 401, cron skips it).
   */
  WHOOP_CLIENT_ID?: string;
  WHOOP_CLIENT_SECRET?: string;
  /** Optional canonical WHOOP redirect URI; unset → request origin + /auth/whoop/callback. */
  WHOOP_OAUTH_REDIRECT_URI?: string;
  /**
   * Garmin Connect developer app (docs/plans/garmin). `wrangler secret put`
   * secrets, never committed. GARMIN_PUSH_SECRET is the unguessable path
   * segment of the notification endpoints configured in Garmin's developer
   * tools (/webhooks/garmin/<secret>/...), since Garmin does not sign pushes.
   * Any of the three unset → the Garmin connection is dormant (start 503s,
   * pushes 404, the cron skips it).
   */
  GARMIN_CLIENT_ID?: string;
  GARMIN_CLIENT_SECRET?: string;
  GARMIN_PUSH_SECRET?: string;
  /** Optional canonical Garmin redirect URI; unset → request origin + /auth/garmin/callback. */
  GARMIN_OAUTH_REDIRECT_URI?: string;
  /**
   * Shared secret for the intervals.icu push webhook (`POST /webhooks/intervals`,
   * a `wrangler secret put` secret — NEVER committed). MUST equal the
   * "Webhook Secret" configured on the intervals.icu Manage App page. Every
   * delivery carries this in its JSON body; the receiver matches it to
   * authenticate. UNSET → the webhook receiver is dormant (it 401s every
   * request) and the hourly backstop cron remains the only sync path.
   */
  INTERVALS_WEBHOOK_SECRET?: string;
  /**
   * Optional second factor for the webhook (a `wrangler secret put` secret).
   * The Manage App page can set a "Webhook Authorization Header"; when this is
   * configured, the receiver ALSO requires the request's `Authorization`
   * header to match it verbatim. UNSET → only the body secret is checked.
   */
  INTERVALS_WEBHOOK_AUTH_HEADER?: string;
  /**
   * R2 bucket fronting exercise demo images (free-exercise-db frames,
   * public domain). Optional so vitest envs without an R2 binding still
   * type-check; the demo route 404s gracefully when unset.
   */
  DEMOS?: R2Bucket;
}

export type HonoEnv = {
  Bindings: Env;
  Variables: {
    userId: string;
    appAuthTime: number;
    appSessionId: string;
    appSessionExpiresAt: number;
    appReview: boolean;
    /** Which client signed in: the iOS app, or the web app (docs/plans/web-app). */
    appClient: AppClient;
  };
};

/** Actor recorded on audit rows and plan versions for a member's own REST writes. */
export type AppClient = 'ios' | 'web';

export interface User {
  id: string;
  apple_sub: string;
  email: string | null;
  display_name: string | null;
  created_at: number;
  /** Device-reported IANA timezone (e.g. America/Los_Angeles); null until first sync. */
  timezone: string | null;
  /**
   * Per-user intervals.icu API key (M1 multi-user foundation, 0016). Each
   * user owns their own intervals.icu credentials; sync* loops per user.
   * NULL → that user's cycling-awareness is dormant (no fetch, no error).
   */
  intervals_api_key: string | null;
  /** Legacy athlete identity. Null after the monotonic P4.6 source-fence cutover. */
  intervals_athlete_id: string | null;
  /** Active athlete identity after the P4.6 source-fence cutover. */
  intervals_cutover_athlete_id: string | null;
  /**
   * Per-user intervals.icu OAuth bearer token (0022). When set, intervals
   * I/O uses `Authorization: Bearer <token>` and `intervals_api_key` is
   * cleared. NULL → this user authenticates via the API key (or is dormant).
   */
  intervals_oauth_access_token: string | null;
  /** OAuth refresh token, if the token response provided one (else NULL). */
  intervals_oauth_refresh_token: string | null;
  /** OAuth access-token expiry (epoch-ms), if known; NULL = no known expiry. */
  intervals_oauth_expires_at: number | null;
  /**
   * Epoch-ms when a sync last got 401/403 from intervals.icu and could not
   * refresh — the credential is dead (expired/revoked). NULL = healthy. Set
   * by the sync (markIntervalsAuthError), cleared on any (re)connect. Drives
   * the env-seed/fallback back-off and the `needs_reauth` profile flag (0023).
   */
  intervals_auth_error_at: number | null;
  /** Monotonic fence for intervals provider identity changes and disconnects. */
  intervals_credential_generation: number;
  /** Last successful planned-events reconcile for the current credential identity. */
  intervals_events_synced_at: number | null;
  /** Last successful completed-activities reconcile for the current credential identity. */
  intervals_activities_synced_at: number | null;
  /** Latest planned-events sync attempt claimed in the current credential generation. */
  intervals_events_sync_attempt: number;
  /** Latest completed-activities sync attempt claimed in the current credential generation. */
  intervals_activities_sync_attempt: number;
  /** Monotonic protected-write sequence used by the P4.6 source fence. */
  intervals_protocol_write_seq: number;
  /**
   * Retired PBKDF2 fields (migration 0025). Public authorization no longer
   * reads these; single-use coach_connect_codes replace reusable passwords.
   */
  mcp_passphrase_hash: string | null;
  mcp_passphrase_salt: string | null;
}

/** Public account identity returned by Sign in with Apple. */
export interface PublicUser {
  id: string;
  email: string | null;
  display_name: string | null;
}

export interface PlanRow {
  id: string;
  user_id: string;
  name: string;
  status: string;
  version: number;
  meta: string | null;
  created_at: number;
  updated_at: number;
}

export interface WorkoutRow {
  tags?: string;
  archived_at?: number | null;
  /** A one-time workout's date (workout-library P3, migration 0075): made
   * for that day only and kept out of the library, the weekly schedule and
   * blocks. Null (or absent before 0075) for a library workout. */
  one_time_date?: string | null;
  id: string;
  plan_id: string;
  name: string;
  day_label: string | null;
  order_index: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface TemplateExerciseRow {
  group_id?: string | null;
  group_rest_seconds?: number | null;
  group_transition_seconds?: number | null;
  id: string;
  workout_id: string;
  exercise_id: string;
  order_index: number;
  target_sets: number;
  target_reps: number;
  target_reps_max: number | null;
  target_rpe: number | null;
  rest_seconds: number;
  target_weight: number | null;
  /** Unit of target_weight; never derived from the catalog unit. Added in
   *  migration 0055; every stored row has one (pre-0055 rows read 'lb'). */
  target_weight_unit?: 'lb' | 'kg';
  /** Planned hold/duration in seconds for timed slots (planks, Cat-Cow,
   *  etc.). NULL → conventional weight-and-reps slot. Mirror of
   *  set_logs.duration_s (the *logged* counterpart). Added in 0010. */
  target_duration_s: number | null;
  progression: string | null;
  /** Planned run steps as canonical JSON text (src/runSteps.ts), only on the
   *  outdoor run exercise. NULL → no steps. Added in migration 0058. */
  run_steps?: string | null;
  cues: string | null;
  /** 1 = this slot is a PRESCRIBED warm-up (erg, mobility, ramp-up): renders
   *  in a warm-up section, its logged sets default to is_warmup=1, and it is
   *  excluded from working-set rollups / session RPE. 0 = working slot. The
   *  *planned* counterpart to set_logs.is_warmup. Added in migration 0026. */
  is_warmup: number;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  /** Stable position on a civil date. Missing only in older cached payloads. */
  slot?: number;
  additional_request?: string | null;
  partner_workout_id?: string | null;
  kind?: 'planned' | 'freestyle';
  exercise_swaps?: string | null;
  runner_targets?: string | null;
  id: string;
  user_id: string;
  plan_id: string;
  workout_id: string | null;
  date: string;
  status: string;
  started_at: number | null;
  completed_at: number | null;
  perceived_fatigue: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  attempt: number;
  /** Rolling-release mode for the current generation. `legacy` accepts the
   * released app's tokenless writes; the first attempt-aware mutation claims
   * `attempt-v1`, after which tokenless writes fail visibly. */
  write_protocol: 'legacy' | 'attempt-v1';
}

export interface SetLogRow {
  id: string;
  user_id: string;
  session_id: string;
  exercise_id: string;
  template_exercise_id: string | null;
  set_index: number;
  weight: number;
  reps: number;
  rpe: number | null;
  is_warmup: number;
  notes: string | null;
  logged_at: number;
  /** Server-owned mutable cursor for incremental set sync. */
  updated_at: number;
  source: string;
  duration_s: number | null;
  /** 1 = a deliberate timed hold (render as "Ns"); 0 = a rep set. Stored
   *  per-set because duration_s alone is unreliable (legacy rep sets carry an
   *  incidental wall-clock duration). Added in migration 0024. */
  is_timed: number;
  deleted_at: number | null;
  /** Unit of `weight`, as logged ('lb' | 'kg'). Rows predating migration
   *  0055 read 'lb'; it never derives from the catalog exercise unit. */
  weight_unit: 'lb' | 'kg';
}

export interface EnrichedTemplateExercise extends TemplateExerciseRow {
  exercise_name: string;
  exercise_unit: string;
  exercise_muscle: string;
  exercise_modality: string;
  /** 'bilateral' | 'unilateral'. Unilateral exercises log reps per-side. */
  exercise_laterality: string;
  /** 'total' | 'per_hand'. per_hand → weight is one dumbbell, shown "X each hand". */
  exercise_load_mode: string;
  /** free-exercise-db slug (e.g. "Barbell_Squat") iOS uses to look up demo
   * frames in the bundled asset catalog (foundational lifts) or fetch from
   * the Worker-fronted R2 bucket. Null when no upstream demo exists
   * (planks, holds, band/quadruped primitives) — sheet falls back to cues. */
  exercise_demo_slug: string | null;
}

export interface PlanTree extends PlanRow {
  workouts: (WorkoutRow & { exercises: EnrichedTemplateExercise[] })[];
}

// ---- external events (frozen contract — see migrations/0006) -------------

/**
 * Server-owned reconciled cache of planned endurance events (intervals.icu).
 * NOT versioned plan tree, NOT the append-only log. Soft-deleted only.
 */
export interface ExternalEventRow {
  id: string; // "intervals:{external_id}"
  user_id: string;
  source: string; // 'intervals'
  external_id: string;
  date: string; // YYYY-MM-DD from start_date_local, verbatim
  kind: string; // ride|run|swim|other
  title: string | null;
  description: string | null;
  planned_duration_sec: number | null;
  training_load: number | null;
  intensity: number | null;
  raw: string | null;
  synced_at: number; // epoch-ms
  deleted_at: number | null;
}

/** A normalized planned event as returned by the intervals.icu fetcher. */
export interface PlannedEvent {
  external_id: string;
  date: string; // start_date_local YYYY-MM-DD verbatim
  /** start_date_local parsed to epoch-ms (treated as UTC for ordering only). */
  start_date_local_ms: number | null;
  kind: string; // ride|run|swim|other
  title: string | null;
  description: string | null;
  planned_duration_sec: number | null;
  training_load: number | null;
  intensity: number | null;
  raw: string; // source JSON for this event
}

// ---- completed activities (frozen contract — see migrations/0015) ---------

/**
 * Server-owned reconciled cache of COMPLETED endurance activities pulled
 * from intervals.icu (the actuals: duration, power, HR, distance, TSS).
 * Parallel to ExternalEventRow but a SEPARATE consistency class: completed
 * (past) actuals, never the planned (future) conflict-awareness feed.
 * Soft-deleted only; a sync never bumps plans.version.
 */
export interface ExternalActivityRow {
  id: string; // "{source}:activity:{user_id}:{external_id}" (source-prefixed PK)
  user_id: string;
  source: string; // 'intervals' | 'healthkit' | … (migration 0027: multi-source)
  external_id: string;
  start_date_local_ms?: number | null;
  start_date_utc_ms?: number | null;
  source_timezone?: string | null;
  date: string; // YYYY-MM-DD from start_date_local, verbatim
  kind: string; // ride|run|swim|other
  /** What the workout was (soccer, tennis, …; migration 0064, src/sports.ts). */
  sport?: string | null;
  name: string | null;
  moving_time_sec: number | null;
  elapsed_time_sec: number | null;
  distance_m: number | null;
  average_watts: number | null;
  weighted_avg_watts: number | null; // normalized power
  average_hr: number | null;
  max_hr: number | null;
  training_load: number | null; // TSS-like
  intensity: number | null; // IF
  calories: number | null;
  elevation_gain_m: number | null;
  raw: string | null;
  synced_at: number; // epoch-ms
  deleted_at: number | null;
  // Cross-source dedup (migration 0027). canonical=1 → surface this row;
  // 0 → a deduped duplicate kept for provenance. duplicate_of points a
  // non-canonical row at an external activity or `session:<native UUID>`.
  canonical: number; // 0 | 1
  duplicate_of: string | null;
  // Load Tres Fort shows (migration 0060): the provider's figure, or one
  // computed from the member's thresholds; NULL when no usable data.
  effective_load: number | null;
  effective_intensity: number | null;
  load_method: string | null;
  // Detail-stream summaries from Apple Health (migration 0061); NULL when no
  // dense stream was sent. Inputs to effective_load, not shown on their own.
  stream_np_w: number | null;
  stream_hr_rms: number | null;
  stream_hr_sec: number | null;
  /** The member's own 1–10 "How hard was it?" (migration 0066); scores the
   * workout only when nothing measured does (load_method 'effort'). */
  effort?: number | null;
  /** Apple Watch's workout effort score, 1–10 (migration 0072): the member's
   * rating in Apple's Fitness app, else the watch's estimate. Scores the
   * workout like `effort` when the member gave no rating in Tres Fort. */
  provider_effort?: number | null;
  /** Heart rate at the stop of a run recorded in the app, and one and two
   * minutes after it (migration 0067); only on source='recording' rows. */
  recovery_hr_at_stop?: number | null;
  recovery_hr_after_60s?: number | null;
  recovery_hr_after_120s?: number | null;
}

/** A normalized completed activity as returned by the intervals.icu fetcher. */
export interface CompletedActivity {
  external_id: string;
  date: string; // start_date_local YYYY-MM-DD verbatim
  /** start_date_local parsed to epoch-ms (treated as UTC for ordering only). */
  start_date_local_ms: number | null;
  /** Actual source instant, only when the provider supplies an explicit zone. */
  start_date_utc_ms?: number | null;
  kind: string; // ride|run|swim|other
  /** What the workout was (soccer, tennis, …); see src/sports.ts. */
  sport?: string;
  name: string | null;
  moving_time_sec: number | null;
  elapsed_time_sec: number | null;
  distance_m: number | null;
  average_watts: number | null;
  weighted_avg_watts: number | null;
  average_hr: number | null;
  max_hr: number | null;
  training_load: number | null;
  intensity: number | null;
  calories: number | null;
  elevation_gain_m: number | null;
  raw: string; // source JSON for this activity
}

// ---- user-authored generic activities (see migrations/0017) --------------

/**
 * Generic activity log: Pilates classes, jump rope, yoga, walks, anything
 * outside strength sessions (set_logs) and intervals.icu actuals
 * (external_activities). Append-only log class — `id` is the client-
 * generated UUID idempotency key, rows are soft-deleted only, writes never
 * bump plans.version. Powers the group/family accountability feed (M4).
 */
export interface ActivityRow {
  id: string;
  user_id: string;
  date: string;            // 'YYYY-MM-DD' device-local, verbatim
  type: string;            // lower-case freeform: pilates|cardio|yoga|walk|other|...
  title: string | null;
  duration_minutes: number | null;
  duration_s: number | null;   // precise duration (migration 0057), else null
  avg_hr: number | null;       // average heart rate, bpm (migration 0057)
  calories: number | null;     // kcal (migration 0057)
  notes: string | null;
  logged_at: number;       // client-authored event time, epoch ms
  updated_at: number;      // server-owned mutable delta-sync cursor
  source: string;          // 'ios' | 'mcp'
  deleted_at: number | null;
}

// ---- groups + invites (see migrations/0018) ------------------------------

/**
 * A friends/family group. The creator is auto-added as a member at
 * creation time (see `createGroup` in src/db.ts). Orphan groups (last
 * member left) are allowed — cleanup is deferred. Group writes do NOT
 * bump plans.version (groups live outside the versioned plan document).
 */
export interface Group {
  id: string;
  name: string;
  created_by: string;       // creator user_id; shared projections use '' when hidden
  created_at: number;       // epoch ms
}

/**
 * A row in `group_members`. `display_name` is a per-group nickname
 * override — NULL means "use users.display_name" (resolved at read time
 * in listGroupsForUser / GET /api/groups/:id).
 */
export interface GroupMember {
  group_id: string;
  user_id: string;
  display_name: string | null;
  joined_at: number;
}

/** A member with the *resolved* display name baked in (override or fallback). */
export interface ResolvedGroupMember extends GroupMember {
  /** Per-group override if set, else the user's global display_name. */
  effective_display_name: string | null;
}

/**
 * A single-use group invite. `code` is the 6-char human-shareable key
 * (32-char no-ambiguous alphabet — A-Z minus I/L/O, 2-9). `expires_at`
 * NULL = never expires; default at creation is +30 days. `used_at` /
 * `used_by` are NULL until the code is redeemed; once set, the code is
 * dead and any further redemption attempt is rejected with `used`.
 */
export interface GroupInvite {
  code: string;
  group_id: string;
  created_by: string;
  created_at: number;
  expires_at: number | null;
  used_at: number | null;
  used_by: string | null;
}

/** Scheduling heuristic only. Legacy severity names are retained:
 * brick = both measures known below thresholds; clash/heavy-next-day = a
 * threshold met; unknown = incomplete inputs without a threshold met. */
export interface DayConflict {
  date: string;
  conflicts: string[]; // external_event ids
  severity: 'brick' | 'clash' | 'heavy-next-day' | 'unknown';
}

// ---- weekly schedule (frozen contract — see migrations/0005) -------------

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** Weekday-keyed recurring pattern. Value = workout_id, or null = rest. */
export type ScheduleWeek = Record<Weekday, string | null>;

/** Activities done on a weekday besides its main workout ("Morning
 *  stretching", "Core before bed"), in order. Only workouts without
 *  exercises: they are logged, not run set by set, so they never compete
 *  with the date's one workout session. Absent weekdays have none. */
export type ScheduleExtras = Partial<Record<Weekday, string[]>>;

/** The most activities one weekday holds besides its main workout. */
export const MAX_SCHEDULE_EXTRAS = 4;

/** Request shape for schedule extras: weekday keys to lists of non-empty
 *  workout refs. Shape only; `setPlanSchedule` resolves and checks each ref. */
export function isScheduleExtrasInput(value: unknown): value is ScheduleExtras {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([key, list]) =>
    (WEEKDAYS as readonly string[]).includes(key)
      && Array.isArray(list)
      && list.every((ref) => typeof ref === 'string' && ref.length > 0));
}

/** An optional time of day for what a weekday holds: weekday → workout id
 *  (the day's main workout or one of its extras) → "HH:MM", 24-hour local
 *  time. Most items have none; the app reminds the member at a set time.
 *  Absent weekdays and items have no time. */
export type ScheduleTimes = Partial<Record<Weekday, Record<string, string>>>;

/** A 24-hour local time, "07:00" or "21:30". */
export const SCHEDULE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Request shape for schedule times: weekday keys to maps of non-empty
 *  workout refs to "HH:MM". Shape only; `setPlanSchedule` resolves each ref. */
export function isScheduleTimesInput(value: unknown): value is ScheduleTimes {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([key, map]) =>
    (WEEKDAYS as readonly string[]).includes(key)
      && map !== null && typeof map === 'object' && !Array.isArray(map)
      && Object.entries(map as Record<string, unknown>).every(([ref, time]) =>
        ref.length > 0 && typeof time === 'string' && SCHEDULE_TIME.test(time)));
}

export interface WeeklySchedule {
  version: number;
  week: ScheduleWeek;
  /** Omitted when no weekday has any (the frozen 0005 shape). */
  extras?: ScheduleExtras;
  /** Omitted when nothing has a time. */
  times?: ScheduleTimes;
}

/** Canonical weekday order, indexable by the calendar-derived day index. */
export const WEEKDAYS: readonly Weekday[] = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
];

// ---- multisport plan meta (authored intent — see docs/MULTISPORT.md §4) ----
// race / periodization / trips / stress_model all live in plans.meta JSON
// ALONGSIDE `schedule`: versioned document, optimistic concurrency, audit+note
// on write (DESIGN.md §3). They are AUTHORED TRUTH the coach reasons over, NOT a
// materialized calendar — the projection DERIVES days from them (store truth,
// derive views). The backend stores and projects; it never computes training
// science. Absent fields are simply omitted from the JSON. M2 authors them via
// the `set_*` tools; M4's calendar projection READS them.

export type RacePriority = 'A' | 'B' | 'C';

/** The goal event the plan builds toward. §4.1. */
export interface RaceGoal {
  name: string;
  date: string; // YYYY-MM-DD civil date (the periodization anchor)
  discipline: string; // triathlon | running | cycling | ...
  distance?: string; // "70.3", "marathon", ...
  /** The distance in meters, when it is one: lets a client work out goal
   * pace and compare training against it. */
  distance_m?: number;
  /** The member's goal finish time in seconds. */
  goal_time_s?: number;
  priority?: RacePriority;
  location?: string;
}

export type TrainingPhase =
  | 'base'
  | 'build'
  | 'peak'
  | 'taper'
  | 'race'
  | 'recovery';

/** One periodization block — phase INTENT, not per-day rows. §4.2. */
export interface PeriodizationPhase {
  phase: TrainingPhase;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  focus?: string;
  weekly_load_target?: number;
  strength_emphasis?: string; // hypertrophy | maintenance | minimal | ...
}

export type TripType = 'travel' | 'rest' | 'injury' | 'other';

/** An availability / blackout range. §4.3. The EFFECT (which days become rest)
 * is NOT stored here — the coach re-plans via set_planned_session/skip. */
export interface Trip {
  id: string; // uuid
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  type: TripType;
  /** Pool/run access while away? Defaults true; only an explicit false marks
   *  the range `unavailable` in the calendar projection (M4). */
  can_train_light?: boolean;
  note?: string;
}

/** The planning load model. §4.4. Intentionally LOOSE — the coach reasons over
 * these dimensions/rules; the backend only stores them, never interprets. */
export interface StressModel {
  discipline_weights?: Record<string, Record<string, number>>;
  interference_rules?: string[];
  age_modifiers?: Record<string, number>;
  [k: string]: unknown;
}

/** One week of a block (docs/plans/progressive-plans/spec.md): its own
 * weekday pattern and extras, with the repeating week's shape and rules. */
/** One slot's targets for one week of a block, overriding the slot's own
 * (spec.md, P1). An absent field keeps the slot's value; null clears a
 * nullable one. `run_steps` is canonical text, as in the slot column. */
export interface SlotTargets {
  target_sets?: number;
  target_reps?: number;
  target_reps_max?: number | null;
  target_rpe?: number | null;
  target_weight?: number | null;
  target_weight_unit?: 'lb' | 'kg';
  target_duration_s?: number | null;
  run_steps?: string | null;
}

export const SLOT_TARGET_FIELDS = ['target_sets', 'target_reps', 'target_reps_max', 'target_rpe',
  'target_weight', 'target_weight_unit', 'target_duration_s', 'run_steps'] as const;
/** Slots one week may give its own targets. */
export const MAX_PROGRAM_WEEK_TARGETS = 100;

export interface ProgramWeek {
  label?: string;
  week: ScheduleWeek;
  extras?: ScheduleExtras;
  /** Slot id → this week's targets for that slot. */
  targets?: Record<string, SlotTargets>;
}

/** A block of weeks from a start Monday (`plans.meta.program`). One-off by
 * default; `repeat` makes it a cycle that starts over after its last week.
 * Outside it (before the start, or after a one-off block) the repeating week
 * applies. */
export interface TrainingProgram {
  id: string;
  name?: string;
  start: string;
  repeat: boolean;
  weeks: ProgramWeek[];
}

export const MAX_PROGRAM_WEEKS = 52;
export const MAX_PROGRAM_LABEL = 40;
export const MAX_PROGRAM_NAME = 60;

/** Parsed shape of plans.meta. Schedule is always present after migration;
 * the multisport fields are optional (omitted until authored). */
export interface PlanMeta {
  schedule: WeeklySchedule;
  program?: TrainingProgram;
  race?: RaceGoal;
  periodization?: PeriodizationPhase[];
  trips?: Trip[];
  stress_model?: StressModel;
  [k: string]: unknown;
}

function emptyWeek(): ScheduleWeek {
  return { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Envelope-validators for the authored-intent meta fields. Each drops a
// malformed entry rather than throwing (same tolerance as the schedule parse)
// and returns `undefined` when there is nothing valid, so JSON.stringify omits
// the key. Known fields are coerced; freeform content passes through.
const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function normalizeRace(v: unknown): RaceGoal | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (!isStr(r.name) || !isStr(r.date) || !isStr(r.discipline)) return undefined;
  const out: RaceGoal = { name: r.name, date: r.date, discipline: r.discipline };
  if (isStr(r.distance)) out.distance = r.distance;
  if (isPositive(r.distance_m)) out.distance_m = r.distance_m;
  if (isPositive(r.goal_time_s)) out.goal_time_s = r.goal_time_s;
  if (r.priority === 'A' || r.priority === 'B' || r.priority === 'C') out.priority = r.priority;
  if (isStr(r.location)) out.location = r.location;
  return out;
}

const TRAINING_PHASES = new Set(['base', 'build', 'peak', 'taper', 'race', 'recovery']);
function normalizePeriodization(v: unknown): PeriodizationPhase[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const phases: PeriodizationPhase[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (!TRAINING_PHASES.has(p.phase as string) || !isStr(p.start) || !isStr(p.end)) continue;
    const phase: PeriodizationPhase = {
      phase: p.phase as TrainingPhase,
      start: p.start,
      end: p.end,
    };
    if (isStr(p.focus)) phase.focus = p.focus;
    if (typeof p.weekly_load_target === 'number') phase.weekly_load_target = p.weekly_load_target;
    if (isStr(p.strength_emphasis)) phase.strength_emphasis = p.strength_emphasis;
    phases.push(phase);
  }
  return phases.length ? phases : undefined;
}

/** The accepted trip/blackout kinds. Shared with the MCP write tools. */
export const TRIP_TYPES = new Set(['travel', 'rest', 'injury', 'other']);
function normalizeTrips(v: unknown): Trip[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const trips: Trip[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    if (!isStr(t.id) || !isStr(t.start) || !isStr(t.end)) continue;
    if (!YMD.test(t.start) || !YMD.test(t.end)) continue; // drop malformed dates
    const trip: Trip = {
      id: t.id,
      start: t.start,
      end: t.end,
      type: TRIP_TYPES.has(t.type as string) ? (t.type as TripType) : 'other',
    };
    // Default true: only an explicit `false` marks the range unavailable in
    // the M4 calendar projection (the conservative "they may still train" read).
    trip.can_train_light = t.can_train_light === false ? false : true;
    if (isStr(t.note)) trip.note = t.note;
    trips.push(trip);
  }
  return trips.length ? trips : undefined;
}

function normalizeStressModel(v: unknown): StressModel | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return v as StressModel; // freeform — the coach owns the semantics
}


/**
 * Each weekday's extra activities: non-empty string ids, in order, without
 * repeats or the weekday's main workout, at most MAX_SCHEDULE_EXTRAS.
 * Undefined when no weekday keeps one, so the frozen shape round-trips.
 */
export function normalizeScheduleExtras(v: unknown, week: ScheduleWeek): ScheduleExtras | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: ScheduleExtras = {};
  for (const d of WEEKDAYS) {
    const list = (v as Record<string, unknown>)[d];
    if (!Array.isArray(list)) continue;
    const kept: string[] = [];
    for (const id of list) {
      if (typeof id !== 'string' || id.length === 0 || id === week[d] || kept.includes(id)) continue;
      if (kept.length < MAX_SCHEDULE_EXTRAS) kept.push(id);
    }
    if (kept.length > 0) out[d] = kept;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Each weekday's times, kept only for what that weekday holds (its main
 * workout or one of its extras) and only in "HH:MM" form. Undefined when
 * nothing keeps a time, so a schedule without times round-trips unchanged.
 */
export function normalizeScheduleTimes(
  v: unknown,
  week: ScheduleWeek,
  extras: ScheduleExtras | undefined,
): ScheduleTimes | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: ScheduleTimes = {};
  for (const d of WEEKDAYS) {
    const map = (v as Record<string, unknown>)[d];
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    const held = new Set([week[d], ...(extras?.[d] ?? [])].filter((id): id is string => !!id));
    const kept: Record<string, string> = {};
    for (const [id, time] of Object.entries(map as Record<string, unknown>)) {
      if (held.has(id) && typeof time === 'string' && SCHEDULE_TIME.test(time)) kept[id] = time;
    }
    if (Object.keys(kept).length > 0) out[d] = kept;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeWeekMap(v: unknown): ScheduleWeek {
  const week = emptyWeek();
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const d of WEEKDAYS) {
      const id = (v as Record<string, unknown>)[d];
      week[d] = typeof id === 'string' && id.length > 0 ? id : null;
    }
  }
  return week;
}

/** Envelope-validate a stored week's slot targets: known fields with the
 * right primitive type survive, anything else is dropped. */
export function normalizeWeekTargets(v: unknown): Record<string, SlotTargets> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, SlotTargets> = {};
  for (const [slot, raw] of Object.entries(v as Record<string, unknown>).slice(0, MAX_PROGRAM_WEEK_TARGETS)) {
    if (!slot || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const t = raw as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    const int = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 1;
    const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
    if (int(t.target_sets)) kept.target_sets = t.target_sets;
    if (int(t.target_reps)) kept.target_reps = t.target_reps;
    for (const field of ['target_reps_max', 'target_duration_s'] as const) {
      if (t[field] === null || int(t[field])) kept[field] = t[field];
    }
    for (const field of ['target_rpe', 'target_weight'] as const) {
      if (t[field] === null || num(t[field])) kept[field] = t[field];
    }
    if (t.target_weight_unit === 'lb' || t.target_weight_unit === 'kg') kept.target_weight_unit = t.target_weight_unit;
    if (t.run_steps === null || typeof t.run_steps === 'string') kept.run_steps = t.run_steps;
    if (Object.keys(kept).length > 0) out[slot] = kept as SlotTargets;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Envelope-validate a stored block; undefined when absent or malformed, so a
 * bad value falls back to the repeating week instead of breaking the plan. */
export function normalizeProgram(v: unknown): TrainingProgram | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const p = v as Record<string, unknown>;
  if (!isStr(p.id) || !isStr(p.start) || !YMD.test(p.start) || !Array.isArray(p.weeks)) return undefined;
  const weeks: ProgramWeek[] = [];
  for (const item of p.weeks.slice(0, MAX_PROGRAM_WEEKS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const w = item as Record<string, unknown>;
    const week = normalizeWeekMap(w.week);
    const extras = normalizeScheduleExtras(w.extras, week);
    const label = typeof w.label === 'string' ? w.label.trim().slice(0, MAX_PROGRAM_LABEL) : '';
    const targets = normalizeWeekTargets(w.targets);
    weeks.push({ ...(label ? { label } : {}), week, ...(extras ? { extras } : {}),
      ...(targets ? { targets } : {}) });
  }
  if (weeks.length === 0) return undefined;
  const name = typeof p.name === 'string' ? p.name.trim().slice(0, MAX_PROGRAM_NAME) : '';
  return { id: p.id, ...(name ? { name } : {}), start: p.start, repeat: p.repeat === true, weeks };
}

/**
 * The ONLY place plan.meta is parsed. Never hand-parse meta elsewhere.
 * Tolerates null / invalid JSON / missing or malformed schedule and always
 * returns a well-formed PlanMeta with a complete weekday map. The authored
 * multisport fields are envelope-validated and omitted when absent/malformed.
 */
export function parsePlanMeta(raw: string | null): PlanMeta {
  let obj: Record<string, unknown> = {};
  if (raw != null) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        obj = p as Record<string, unknown>;
      }
    } catch {
      // fall through to defaults
    }
  }
  const sched = obj.schedule as Partial<WeeklySchedule> | undefined;
  const week = emptyWeek();
  if (sched && typeof sched === 'object' && sched.week && typeof sched.week === 'object') {
    for (const d of WEEKDAYS) {
      const v = (sched.week as Record<string, unknown>)[d];
      week[d] = typeof v === 'string' && v.length > 0 ? v : null;
    }
  }
  const extras = normalizeScheduleExtras(
    sched && typeof sched === 'object' ? (sched as Record<string, unknown>).extras : undefined,
    week,
  );
  const times = normalizeScheduleTimes(
    sched && typeof sched === 'object' ? (sched as Record<string, unknown>).times : undefined,
    week,
    extras,
  );
  return {
    ...obj,
    schedule: {
      version: typeof sched?.version === 'number' ? sched.version : 1,
      week,
      ...(extras ? { extras } : {}),
      ...(times ? { times } : {}),
    },
    race: normalizeRace(obj.race),
    periodization: normalizePeriodization(obj.periodization),
    trips: normalizeTrips(obj.trips),
    stress_model: normalizeStressModel(obj.stress_model),
    program: normalizeProgram(obj.program),
  };
}

/** Serialize meta back, with the schedule slotted in (preserving other keys). */
export function serializePlanMeta(meta: PlanMeta, schedule: WeeklySchedule): string {
  return JSON.stringify({ ...meta, schedule });
}
