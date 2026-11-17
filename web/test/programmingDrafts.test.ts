import { describe, expect, it } from 'vitest';
import { EditorDraftStore, type DraftStorage } from '../src/editorDrafts';
import { detailsDocument, isNewBlockDraft, isWorkoutDetailsDraft, newBlockDraft, newBlockRequest, newWorkoutDetailsDraft, NEW_BLOCK_DOCUMENT, setupBlockRequest, setupEasy, setupWeeks, workoutDetailsRequest } from '../src/programmingDrafts';
import { eventDraft } from '../src/event';
import type { Slot } from '../src/model';
import type { Workout } from '../src/model';
import type { WeeklySchedule } from '../../src/types';
const workout: Workout = { id: 'w1', plan_id: 'p1', name: 'Upper', day_label: null, order_index: 0, notes: 'Old notes', tags: '["gym"]', archived_at: null, created_at: 0, updated_at: 0, exercises: [] };
const week: WeeklySchedule = { version: 1, week: { mon: 'w1', tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }, extras: { tue: ['w1'] } };
const scope = { accountId: 'a1', planId: 'p1', documentId: NEW_BLOCK_DOCUMENT };
function disk(): DraftStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}

describe('new block and workout metadata drafts', () => {
  it('retains incomplete new-block input and frozen reviewed week across reload and account/document boundaries', () => {
    const storage = disk(), store = new EditorDraftStore(() => storage, () => 'new-block');
    const draft = { ...newBlockDraft(week, [workout], '2026-11-16'), name: 'My build', weeks: '', repeat: true };
    const saved = store.write(scope, null, draft, 5);
    expect(new EditorDraftStore(() => storage).read(scope, isNewBlockDraft)).toEqual(saved);
    expect(newBlockRequest(draft)).toBeNull();
    expect(store.read({ ...scope, accountId: 'a2' }, isNewBlockDraft)).toBeNull();
    expect(store.read({ ...scope, planId: 'p2' }, isNewBlockDraft)).toBeNull();
    expect(store.read({ ...scope, documentId: 'block' }, isNewBlockDraft)).toBeNull();
    // The block is built from the week reviewed when the draft began, and
    // holds only the workouts ticked for it.
    week.week.mon = null;
    expect(newBlockRequest({ ...draft, weeks: '3' })).toBeNull();
    const request = newBlockRequest({ ...draft, weeks: '3', picked: ['w1'] });
    expect(request?.weeks).toHaveLength(3);
    expect(request?.weeks[0]?.week).toMatchObject({ mon: 'w1', tue: 'w1', wed: null });
    expect(request?.workout_ids).toEqual(['w1']);
    week.week.mon = 'w1';
  });
  it('starts a block from ticked and added workouts only, without archived ones', () => {
    const core: Workout = { ...workout, id: 'core', name: 'Core' };
    const run: Workout = { ...workout, id: 'run', name: 'Tempo run' };
    const usual: WeeklySchedule = { version: 1, week: { mon: 'w1', tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }, extras: { mon: ['core'] } };
    const draft = { ...newBlockDraft(usual, [workout, core, run], '2026-11-16'), picked: ['w1'], added: [{ id: 'run', day: 'fri' as const }] };
    expect(draft.weeks).toBe('6');
    const request = newBlockRequest(draft, [workout, core, run]);
    expect(request?.weeks).toHaveLength(6);
    expect(request?.weeks[0]).toEqual({ week: { mon: 'w1', tue: null, wed: null, thu: null, fri: 'run', sat: null, sun: null } });
    expect(request?.workout_ids).toEqual(['w1', 'run']);
    expect(newBlockRequest(draft, [core, run])?.workout_ids).toEqual(['run']);
    expect(newBlockRequest({ ...draft, added: [] }, [core, run])).toBeNull();
  });
  it('rejects invalid creation inputs and corrupt stored structure without clamping', () => {
    const draft = newBlockDraft(week, [workout], '2026-11-16');
    expect(isNewBlockDraft(draft)).toBe(true);
    const ticked = { ...draft, picked: ['w1'] };
    expect(newBlockRequest(ticked)).not.toBeNull();
    for (const weeks of ['', '0', '-1', '2.5', '53', '1e1']) expect(newBlockRequest({ ...ticked, weeks })).toBeNull();
    expect(newBlockRequest({ ...ticked, start: 'not-a-date' })).toBeNull();
    expect(isNewBlockDraft({ ...draft, picked: [1] })).toBe(false);
    expect(isNewBlockDraft({ ...draft, added: [{ id: 'w1', day: 'someday' }] })).toBe(false);
    expect(isNewBlockDraft({ ...draft, source: { ...draft.source, weeks: [] } })).toBe(false);
    expect(isNewBlockDraft({ ...draft, repeat: 'yes' })).toBe(false);
  });
  it('builds the guided setup’s block: weeks to the event, each workout’s rule, and the easier weeks', () => {
    const swing = { id: 'swing', workout_id: 'w1', exercise_id: 'ex_kb_swing', order_index: 0, target_sets: 3, target_reps: 8, target_reps_max: null,
      target_rpe: null, rest_seconds: 60, target_weight: 53, target_weight_unit: 'lb', target_duration_s: null, progression: null, run_steps: null,
      cues: null, is_warmup: 0, created_at: 0, updated_at: 0, exercise_name: 'Kettlebell Swing', exercise_unit: 'lb', exercise_muscle: 'legs',
      exercise_modality: 'kettlebell', exercise_laterality: 'bilateral', exercise_load_mode: 'total', exercise_demo_slug: null } as Slot;
    const lift: Workout = { ...workout, exercises: [swing] };
    const soccer: Workout = { ...workout, id: 'soccer', name: 'Soccer' };
    const usual: WeeklySchedule = { version: 1, week: { mon: 'soccer', tue: 'w1', wed: null, thu: null, fri: null, sat: null, sun: null } };
    const base = { ...newBlockDraft(usual, [lift, soccer], '2026-11-16'), picked: ['w1'] };
    const event = { ...eventDraft(null, true), name: 'Turkey Trot', date: '2026-12-26' };
    const toEvent = { ...base, step: 3 as const, purpose: 'event' as const, event };
    expect(isNewBlockDraft(toEvent)).toBe(true);
    expect(setupWeeks(toEvent)).toBe(6);
    expect(setupEasy(toEvent, 6)).toBe(4);
    expect(setupEasy({ ...toEvent, easy: null }, 6)).toBeNull();
    expect(setupEasy(toEvent, 3)).toBeNull();
    const body = setupBlockRequest(toEvent, [lift, soccer], true)!;
    expect(body.name).toBe('Turkey Trot');
    expect(body.workout_ids).toEqual(['w1']);
    expect(body.weeks).toHaveLength(6);
    // The default rule adds a rep a week, with week 4 easier and labeled.
    expect(body.weeks.map(entry => entry.targets?.swing?.target_reps ?? 8)).toEqual([8, 9, 10, 8, 11, 12]);
    expect(body.weeks.map(entry => entry.label ?? null)).toEqual([null, null, null, 'Easier week', null, null]);
    // A chosen rule replaces the default; the same every week writes no targets or labels.
    const flat = setupBlockRequest({ ...toEvent, builds: { w1: { kind: 'same' } } }, [lift, soccer], true)!;
    expect(flat.weeks.every(entry => entry.targets === undefined && entry.label === undefined)).toBe(true);
    const load = setupBlockRequest({ ...toEvent, easy: null, builds: { w1: { kind: 'add', target: 'load', amount: 5 } } }, [lift, soccer], true)!;
    expect(load.weeks.map(entry => entry.targets?.swing?.target_weight ?? 53)).toEqual([53, 58, 63, 68, 73, 78]);
    // A set number of weeks ignores the event; an unfinished step saves nothing.
    expect(setupBlockRequest({ ...toEvent, purpose: 'weeks', weeks: '3' }, [lift, soccer], true)?.weeks).toHaveLength(3);
    expect(setupBlockRequest({ ...toEvent, event: { ...event, date: '2026-11-01' } }, [lift, soccer], true)).toBeNull();
    expect(setupBlockRequest({ ...toEvent, picked: [] }, [lift, soccer], true)).toBeNull();
    // Stored setup choices are checked like the rest of the draft.
    expect(isNewBlockDraft({ ...toEvent, step: 4 })).toBe(false);
    expect(isNewBlockDraft({ ...toEvent, purpose: 'race' })).toBe(false);
    expect(isNewBlockDraft({ ...toEvent, builds: { w1: { kind: 'add', target: 'speed', amount: 1 } } })).toBe(false);
    expect(isNewBlockDraft({ ...toEvent, easy: 2 })).toBe(false);
  });
  it('keeps later new-block edits when an older request is acknowledged', () => {
    const storage = disk(), store = new EditorDraftStore(() => storage, () => 'new-block');
    const first = store.write(scope, null, newBlockDraft(week, [workout], '2026-11-16'), 5);
    const next = store.write(scope, first, { ...first.value, name: 'Still editing' }, 5);
    expect(store.clear(scope, first)).toBe(false);
    expect(store.read(scope, isNewBlockDraft)).toEqual(next);
    expect(store.clear(scope, next)).toBe(true);
  });
  it('retains metadata baselines and raw proposals, and validates explicit clears', () => {
    const storage = disk(), store = new EditorDraftStore(() => storage, () => 'metadata');
    const metadataScope = { ...scope, documentId: detailsDocument(workout.id) };
    const initial = newWorkoutDetailsDraft(workout);
    const changed = { ...initial, draft: { name: ' New upper ', tags: 'travel, quick', notes: '  ' } };
    const saved = store.write(metadataScope, null, changed, 9);
    expect(new EditorDraftStore(() => storage).read(metadataScope, isWorkoutDetailsDraft)).toEqual(saved);
    expect(initial.saved.notes).toBe('Old notes');
    expect(workoutDetailsRequest(changed.draft)).toEqual({ fields: { name: 'New upper', tags: ['travel', 'quick'], notes: null } });
    expect(workoutDetailsRequest({ ...changed.draft, name: ' ' })).toHaveProperty('error');
    expect(isWorkoutDetailsDraft({ ...changed, draft: { ...changed.draft, tags: [] } })).toBe(false);
    expect(store.read({ ...metadataScope, documentId: detailsDocument('w2') }, isWorkoutDetailsDraft)).toBeNull();
    const newer = store.write(metadataScope, saved, { ...changed, draft: { ...changed.draft, notes: 'Newer notes' } }, 9);
    expect(store.clear(metadataScope, saved)).toBe(false);
    expect(store.read(metadataScope, isWorkoutDetailsDraft)).toEqual(newer);
  });
});
