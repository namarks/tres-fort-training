import { WEEKDAYS } from '../../src/types';
import { settingTarget, slotUnit, weekValue, type ProgramBody } from './blocks';
import type { Slot, Workout } from './model';

export interface WeekAdjustmentRow {
  key: string; workout: string; exercise: string; field: 'Sets' | 'Rounds' | 'Load';
  before: number; after: number; unit: string;
}

export function weekScopeLabel(program: ProgramBody, index: number): string {
  return `Week ${index + 1} of this block${program.repeat ? ', each time the block repeats' : ''}`;
}

export function liftingWorkoutsInWeek(program: ProgramBody, index: number, workouts: readonly Workout[]): Workout[] {
  const week = program.weeks[index];
  if (!week) return [];
  const ids = new Set(WEEKDAYS.flatMap(day => [week.week[day], ...(week.extras?.[day] ?? [])]));
  return workouts.filter(w => !w.archived_at && !w.one_time_date && ids.has(w.id)
    && (w.exercises as Slot[]).some(isWorkingLift));
}

const isWorkingLift = (s: Slot) => !s.is_warmup && s.exercise_modality !== 'cardio' && s.exercise_id !== 'ex_outdoor_run';

/** A preview only. Repeated occurrences share their workout's week targets;
 * each slot is reduced once. No template, other week or past set is changed. */
export function lighterWeek(program: ProgramBody, index: number, workouts: readonly Workout[], options: {
  workoutId?: string; setsPercent: number; loadPercent: number;
}): { program: ProgramBody; rows: WeekAdjustmentRow[] } {
  const rows: WeekAdjustmentRow[] = [];
  if (![options.setsPercent, options.loadPercent].every(n => Number.isFinite(n) && n >= 0 && n <= 90)) {
    return { program, rows };
  }
  let next = program;
  for (const workout of liftingWorkoutsInWeek(program, index, workouts)) {
    if (options.workoutId && workout.id !== options.workoutId) continue;
    const slots = workout.exercises as Slot[];
    const changedGroups = new Set<string>();
    for (const slot of slots.filter(isWorkingLift)) {
      const members = slot.group_id ? slots.filter(s => s.group_id === slot.group_id) : [slot];
      // A mixed lifting/cardio group keeps its shared round count intact.
      if (options.setsPercent > 0 && members.every(isWorkingLift)
        && (!slot.group_id || !changedGroups.has(slot.group_id))) {
        const before = weekValue(program, index, slot, 'target_sets')!;
        const after = Math.max(1, Math.floor(before * (1 - options.setsPercent / 100)));
        if (before !== after) {
          next = settingTarget(next, index, workout, slot, 'target_sets', after);
          // A reviewed easy-week choice stays explicit even if it equals the
          // reusable target today; later template edits must not erase it.
          const weeks = [...next.weeks];
          const targets = { ...weeks[index]!.targets };
          for (const member of members) targets[member.id] = { ...targets[member.id], target_sets: after };
          weeks[index] = { ...weeks[index]!, targets }; next = { ...next, weeks };
          rows.push({ key: `${slot.id}:sets`, workout: workout.name,
            exercise: members.map(s => s.exercise_name).join(' + '), field: slot.group_id ? 'Rounds' : 'Sets', before, after, unit: '' });
        }
        if (slot.group_id) changedGroups.add(slot.group_id);
      }
      const entry = program.weeks[index]?.targets?.[slot.id];
      const before = entry?.target_weight !== undefined ? entry.target_weight : slot.target_weight;
      const unit = entry?.target_weight_unit ?? slotUnit(slot);
      if (options.loadPercent > 0 && before != null && before !== 0) {
        // Negative load is assistance: more assistance makes the movement lighter.
        const after = Math.round(before * (before < 0 ? 1 + options.loadPercent / 100 : 1 - options.loadPercent / 100) * 10) / 10;
        if (before !== after) {
          const weeks = [...next.weeks];
          weeks[index] = { ...weeks[index]!, targets: { ...weeks[index]!.targets,
            [slot.id]: { ...weeks[index]!.targets?.[slot.id], target_weight: after,
              ...(entry?.target_weight_unit !== undefined ? { target_weight_unit: unit } : {}) } } };
          next = { ...next, weeks };
          rows.push({ key: `${slot.id}:load`, workout: workout.name, exercise: slot.exercise_name,
            field: 'Load', before, after, unit });
        }
      }
    }
  }
  return { program: next, rows };
}
