import { normalizeProgram, WEEKDAYS } from '../../src/types';
import { programBody, FIELD_LABELS, parseSeconds, settingTarget, weekValue, type ProgramBody, type TargetField } from './blocks';
import { allowsAssistance, parseNumber } from './editing';
import { describeRunSteps, WEEKDAY_LABELS, type Workout, type Slot } from './model';

export interface BlockDraft { programId: string; saved: ProgramBody; draft: ProgramBody; identities: Record<string, string>; inputs?: Record<string, string> }
const identity = (slot: Slot) => JSON.stringify([slot.exercise_id, slot.exercise_modality, slot.exercise_load_mode, slot.exercise_laterality, slot.group_id ?? null, slot.target_weight_unit ?? 'lb', slot.is_warmup, slot.target_duration_s != null]);
export const blockSlotIdentities = (workouts: Workout[]): Record<string, string> => Object.fromEntries(workouts.flatMap(w => w.exercises.map(s => [s.id, identity(s)])));

/** JSON objects have no key order; arrays and all values still must match. */
function sameJSONStructure(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
    && left.every((value, index) => sameJSONStructure(value, right[index]));
  if (Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every(key => Object.hasOwn(b, key) && sameJSONStructure(a[key], b[key]));
}

function validProgram(value: unknown): value is ProgramBody {
  try {
    const normalized = normalizeProgram({ ...(value as ProgramBody), id: 'draft' });
    return !!normalized && typeof (value as ProgramBody).repeat === 'boolean'
      && sameJSONStructure(programBody(normalized), programBody(value as ProgramBody));
  } catch { return false; }
}
export function isBlockDraft(value: unknown): value is BlockDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as BlockDraft;
  return typeof d.programId === 'string' && validProgram(d.saved) && validProgram(d.draft)
    && !!d.identities && typeof d.identities === 'object' && Object.values(d.identities).every(v => typeof v === 'string')
    && (d.inputs === undefined || (!!d.inputs && typeof d.inputs === 'object' && Object.entries(d.inputs).every(([k,v]) => { const key = readTargetInputKey(k); return !!key && key[1] < d.draft.weeks.length && typeof v === 'string'; })));
}

export const targetInputKey = (slotId: string, index: number, field: TargetField) => JSON.stringify([slotId, index, field]);
function readTargetInputKey(key: string): [string, number, TargetField] | null {
  try {
    const v = JSON.parse(key) as unknown;
    return Array.isArray(v) && v.length === 3 && typeof v[0] === 'string' && Number.isSafeInteger(v[1]) && v[1] >= 0
      && ['target_sets', 'target_reps', 'target_weight', 'target_duration_s'].includes(v[2]) ? v as [string, number, TargetField] : null;
  } catch { return null; }
}
export function parsedTargetInput(text: string, field: TargetField, slot: Slot): { value: number | null } | null {
  if (!text.trim()) return { value: null };
  const n = field === 'target_duration_s' ? parseSeconds(text) : parseNumber(text);
  if (n == null || !Number.isFinite(n) || (n < 0 && !(field === 'target_weight' && allowsAssistance(slot.exercise_modality)))) return null;
  if (field !== 'target_weight' && (!Number.isInteger(n) || n < 1)) return null;
  return { value: n };
}
export function blockInputErrors(inputs: Record<string, string>, workouts: Workout[]): string[] {
  const slots = new Map(workouts.flatMap(w => w.exercises.map(s => [s.id, s] as const)));
  return Object.entries(inputs).flatMap(([key, text]) => {
    const parsed = readTargetInputKey(key), slot = parsed && slots.get(parsed[0]);
    return !parsed || !slot || !parsedTargetInput(text, parsed[2], slot)
      ? [`Finish or clear ${parsed ? `Week ${parsed[1] + 1} ${FIELD_LABELS[parsed[2]]}` : 'this target'} before saving.`] : [];
  });
}
/** Actions such as applying a ramp replace the affected raw cells, not unrelated typing. */
export function reconcileBlockInputs(inputs: Record<string, string>, before: ProgramBody, next: ProgramBody, workouts: Workout[]) {
  const slots = new Map(workouts.flatMap(w => w.exercises.map(s => [s.id, s] as const)));
  return Object.fromEntries(Object.entries(inputs).filter(([key]) => {
    const parsed = readTargetInputKey(key), slot = parsed && slots.get(parsed[0]);
    return !!parsed && !!slot && parsed[1] < next.weeks.length
      && weekValue(before, parsed[1], slot, parsed[2]) === weekValue(next, parsed[1], slot, parsed[2]);
  }));
}
/** Store text on every keystroke, including incomplete/invalid numbers. */
export function changingBlockInput(value: BlockDraft, workouts: Workout[], workout: Workout, slot: Slot, index: number, field: TargetField, text: string): BlockDraft {
  const parsed = parsedTargetInput(text, field, slot);
  const next = parsed ? settingTarget(value.draft, index, workout, slot, field, parsed.value) : value.draft;
  const inputs = reconcileBlockInputs(value.inputs ?? {}, value.draft, next, workouts);
  if (field === 'target_sets' && slot.group_id) {
    // Shared rounds have one latest intent, even when typing/clearing happens
    // to equal today's base and therefore changes no canonical number yet.
    const members = new Set(workout.exercises.filter(s => s.group_id === slot.group_id).map(s => s.id));
    for (const key of Object.keys(inputs)) {
      const parts = readTargetInputKey(key);
      if (parts && parts[1] === index && parts[2] === 'target_sets' && members.has(parts[0])) delete inputs[key];
    }
  }
  inputs[targetInputKey(slot.id, index, field)] = text;
  return { ...value, draft: next, inputs };
}

export function resettingBlockInputs(value: BlockDraft, workout: Workout, slot: Slot, index: number, fields: TargetField[]): BlockDraft {
  let draft = value.draft;
  for (const field of fields) draft = settingTarget(draft, index, workout, slot, field, null);
  const members = new Set(slot.group_id ? workout.exercises.filter(s => s.group_id === slot.group_id).map(s => s.id) : [slot.id]);
  const inputs = Object.fromEntries(Object.entries(value.inputs ?? {}).filter(([key]) => {
    const parts = readTargetInputKey(key);
    if (!parts || parts[1] !== index || !fields.includes(parts[2])) return true;
    return parts[2] === 'target_sets' ? !members.has(parts[0]) : parts[0] !== slot.id;
  }));
  return { ...value, draft, inputs };
}

/**
 * Raw text is intent, even when it equaled the old saved-workout target and
 * therefore had no canonical override. Re-resolve it against the reviewed
 * live baseline for display, comparison, rebase and the eventual write.
 * Empty text deliberately keeps inheritance from that live workout.
 */
export function resolveBlockInputs(draft: ProgramBody, inputs: Record<string, string>, workouts: Workout[]): ProgramBody {
  let next = draft;
  const slots = new Map(workouts.flatMap(workout => workout.exercises.map(slot => [slot.id, { workout, slot }] as const)));
  for (const [key, text] of Object.entries(inputs)) {
    const parts = readTargetInputKey(key), entry = parts && slots.get(parts[0]);
    if (!parts || !entry || parts[1] >= next.weeks.length) continue;
    const parsed = parsedTargetInput(text, parts[2], entry.slot);
    if (parsed) next = settingTarget(next, parts[1], entry.workout, entry.slot, parts[2], parsed.value);
  }
  return next;
}

/** A retained week target may not silently change meaning after a slot swap. */
export function blockDraftProblem(value: BlockDraft, programId: string | null, workouts: Workout[]): string | null {
  if (value.programId !== programId) return 'This block was ended or replaced. Your draft is kept below, but cannot overwrite a different block.';
  const live = new Set(workouts.filter(w => !w.archived_at && !w.one_time_date).map(w => w.id));
  const slots = blockSlotIdentities(workouts);
  for (const key of Object.keys(value.inputs ?? {})) {
    const input = readTargetInputKey(key);
    if (!input || !slots[input[0]] || slots[input[0]] !== value.identities[input[0]]) return 'A typed target no longer matches its exercise. Your draft is kept, but cannot be saved until you discard it and review the exercise.';
  }
  for (const week of value.draft.weeks) {
    if ([...Object.values(week.week), ...Object.values(week.extras ?? {}).flat()].some(id => id != null && !live.has(id))) {
      return 'A workout in this draft is no longer available. Remove it from the draft before reviewing the latest block.';
    }
    if (Object.keys(week.targets ?? {}).some(id => !slots[id] || slots[id] !== value.identities[id])) {
      return 'An exercise with week-specific targets was removed, replaced, regrouped, or changed how its targets are measured. Discard this draft and review that exercise before programming it again.';
    }
  }
  return null;
}

/** Readable, changed values only; no raw request JSON in the review surface. */
export function blockComparison(current: ProgramBody, proposed: ProgramBody, workouts: Workout[]) {
  const names = new Map(workouts.map(w => [w.id, w.name]));
  const slots = new Map(workouts.flatMap(w => w.exercises.map(s => [s.id, s] as const)));
  const describe = (body: ProgramBody) => {
    const rows = new Map<string, { label: string; value: string }>();
    for (const [label, value] of [['Name', body.name || 'Your block'], ['Starts', body.start], ['Repeats', body.repeat ? 'Yes' : 'No'], ['Weeks', String(body.weeks.length)]]) rows.set(label!, { label: label!, value: value! });
    body.weeks.forEach((week, i) => {
      const prefix = `Week ${i + 1}`;
      rows.set(`${prefix} label`, { label: `${prefix} label`, value: week.label || 'No label' });
      WEEKDAYS.forEach(day => rows.set(`${prefix}:${day}`, { label: `${prefix} · ${WEEKDAY_LABELS[day]}`, value: [week.week[day], ...(week.extras?.[day] ?? [])].filter(Boolean).map(id => names.get(id!) ?? 'Unavailable workout').join(' + ') || 'Rest' }));
      Object.entries(week.targets ?? {}).forEach(([id, targets]) => Object.entries(targets).forEach(([field, value]) => {
        const slot = slots.get(id);
        const fieldLabel = (FIELD_LABELS as Record<string, string>)[field] ?? ({ target_weight_unit: 'Weight unit', run_steps: 'Run steps' } as Record<string, string>)[field] ?? field.replace(/^target_/, '').replaceAll('_', ' ');
        const label = `${prefix} · ${slot ? `${names.get(slot.workout_id) ?? 'Workout'} · ${slot.exercise_name}${slot.is_warmup ? ' warm-up' : ''} (exercise ${slot.order_index + 1})` : 'Unavailable exercise'} · ${fieldLabel}`;
        rows.set(JSON.stringify([i, id, field]), { label, value: value === null ? 'No target' : field === 'run_steps' ? describeRunSteps(JSON.stringify(value), false).join('; ')
          : field === 'target_weight' ? `${value} ${targets.target_weight_unit ?? slot?.target_weight_unit ?? 'lb'}${slot?.exercise_load_mode === 'per_hand' ? ' each hand' : ''}`
          : field === 'target_duration_s' ? `${value} seconds` : String(value) });
      }));
    });
    return rows;
  };
  const inherited = (key: string, body: ProgramBody): string => {
    try {
      const [index, id, field] = JSON.parse(key) as [number, string, keyof Slot];
      if (!body.weeks[index]) return 'Week not present';
      const slot: Slot | undefined = slots.get(id);
      if (!slot) return 'Exercise unavailable';
      const value = field === 'target_weight_unit' ? slot.target_weight_unit ?? 'lb' : slot[field];
      const text = value == null ? 'No target' : field === 'run_steps' ? describeRunSteps(String(value), false).join('; ')
        : field === 'target_weight' ? `${value} ${slot.target_weight_unit ?? 'lb'}${slot.exercise_load_mode === 'per_hand' ? ' each hand' : ''}`
        : field === 'target_duration_s' ? `${value} seconds` : String(value);
      return `${text} (saved workout)`;
    } catch { return 'Not set'; }
  };
  const a = describe(current), b = describe(proposed);
  return [...new Set([...a.keys(), ...b.keys()])].flatMap(key => a.get(key)?.value === b.get(key)?.value ? [] : [{ key, label: b.get(key)?.label ?? a.get(key)!.label, current: a.get(key)?.value ?? inherited(key, current), proposed: b.get(key)?.value ?? inherited(key, proposed) }]);
}
