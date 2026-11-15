import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDraftStore, draftKey, type DraftStorage } from '../src/editorDrafts';
import { blockComparison, blockDraftProblem, blockInputErrors, blockSlotIdentities, changingBlockInput, isBlockDraft, parsedTargetInput, resettingBlockInputs, resolveBlockInputs, targetInputKey } from '../src/blockDrafts';
import { draftFromSlot, isSlotDraft, replacementDraft, replacementFields, sameSlotIdentity, slotDraftComparison, searchCatalog, type CatalogExercise } from '../src/editing';
import { programBody } from '../src/blocks';
import { planWrites } from '../src/api';
import type { Slot, Workout } from '../src/model';

function storage(): DraftStorage {
  const values = new Map<string, string>();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } };
}
const scope = { accountId: 'member-a', planId: 'plan-a', documentId: 'workout:w1' };
const validate = (v: unknown): v is { weight: string } => !!v && typeof v === 'object' && typeof (v as { weight?: unknown }).weight === 'string';
function slot(overrides: Partial<Slot> = {}): Slot {
  return { id: 's1', workout_id: 'w1', exercise_id: 'ex_bench', exercise_name: 'Bench Press', exercise_unit: 'lb', exercise_modality: 'barbell', exercise_load_mode: 'total', exercise_laterality: 'bilateral', exercise_muscle: 'chest', exercise_demo_slug: null,
    order_index: 0, target_sets: 3, target_reps: 5, target_reps_max: null, target_duration_s: null, target_weight: 135, target_weight_unit: 'lb', target_rpe: 8, rest_seconds: 120,
    cues: null, progression: null, run_steps: null, is_warmup: 0, created_at: 0, updated_at: 0, ...overrides };
}
const dumbbell: CatalogExercise = { id: 'ex_db_press', name: 'Dumbbell Bench Press', primary_muscle: 'chest', modality: 'dumbbell', unit: 'lb', laterality: 'bilateral', load_mode: 'per_hand', demo_slug: null, aliases: null };
const workouts = (s = slot()): Workout[] => [{ id: 'w1', plan_id: 'plan-a', name: 'Upper', day_label: null, order_index: 0, notes: null, archived_at: null, created_at: 0, updated_at: 0, exercises: [s] }];
const program = { id: 'block-a', start: '2026-11-16', repeat: false, weeks: [{ week: { mon: 'w1', tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }, targets: { s1: { target_weight: 140 } } }] };

describe('retained editor drafts', () => {
  it('round-trips incomplete text and reviewed version through remounts while isolating account, plan and document', () => {
    const disk = storage(), store = new EditorDraftStore(() => disk, () => 'edit-1');
    const draft = store.write(scope, null, { weight: '14.' }, 7);
    expect(new EditorDraftStore(() => disk).read(scope, validate)).toEqual(draft);
    for (const other of [{ ...scope, accountId: 'member-b' }, { ...scope, planId: 'plan-b' }, { ...scope, documentId: 'workout:w2' }]) {
      expect(store.read(other, validate)).toBeNull();
    }
    expect(store.hasDrafts('member-a')).toBe(true);
    expect(store.hasDrafts('member-b')).toBe(false);
    expect(store.read(scope, validate)).toMatchObject({ version: 7 });
  });
  it('keeps a live copy when private/quota-restricted storage fails', () => {
    const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); }, removeItem() { throw Error('blocked'); } };
    const store = new EditorDraftStore(() => broken, () => 'edit-2');
    const draft = store.write(scope, null, { weight: '-2' }, 9);
    expect(store.read(scope, validate)).toEqual(draft);
    expect(store.clear(scope, draft)).toBe(true);
    expect(store.read(scope, validate)).toBeNull();
  });
  it('treats corrupt or wrong-owner storage as unreadable until explicit discard', () => {
    const disk = storage(); disk.setItem(draftKey(scope), '{broken');
    const store = new EditorDraftStore(() => disk);
    expect(store.read(scope, validate)).toBe('unreadable');
    store.clear(scope); expect(store.read(scope, validate)).toBeNull();
    disk.setItem(draftKey(scope), JSON.stringify({ ...scope, accountId: 'member-b', id: 'x', revision: 1, version: 7, value: { weight: '15' } }));
    expect(new EditorDraftStore(() => disk).read(scope, validate)).toBe('unreadable');
  });
  it('retires acknowledged drafts even when refresh fails, but never erases later edits', () => {
    const disk = storage(), store = new EditorDraftStore(() => disk, () => 'edit-3');
    const submitted = store.write(scope, null, { weight: '145' }, 7);
    const changed = store.write(scope, submitted, { weight: '150' }, 7);
    expect(store.clear(scope, submitted)).toBe(false);
    expect(store.read(scope, validate)).toEqual(changed);
    expect(store.clear(scope, changed)).toBe(true);
    expect(new EditorDraftStore(() => disk).read(scope, validate)).toBeNull();
  });
  it('notifies a remounted editor when an old request acknowledges, while protecting newer edits and other accounts', () => {
    const store = new EditorDraftStore(() => storage(), () => 'request-in-flight');
    const submitted = store.write(scope, null, { weight: '145' }, 7);
    // The original editor unmounted; a new editor reads and subscribes.
    let mounted = store.read(scope, validate), updates = 0, otherUpdates = 0;
    const unsubscribe = store.subscribe(scope, () => { mounted = store.read(scope, validate); updates++; });
    const unsubscribeOther = store.subscribe({ ...scope, accountId: 'member-b' }, () => otherUpdates++);
    expect(store.clear(scope, submitted)).toBe(true);
    expect(mounted).toBeNull();
    expect(updates).toBe(1);
    const next = store.write(scope, null, { weight: '150' }, 8);
    const edited = store.write(scope, next, { weight: '155' }, 8);
    expect(store.clear(scope, next)).toBe(false);
    expect(mounted).toEqual(edited);
    expect(otherUpdates).toBe(0);
    unsubscribe(); unsubscribeOther();
    store.clear(scope, edited);
    expect(updates).toBe(3);
    expect(store.snapshot(scope)).toBeNull();
  });
  it('does not warn on an inspected form until a value or replacement is chosen', () => {
    const store = new EditorDraftStore(() => storage(), () => 'edit-4');
    const inspected = store.write(scope, null, { weight: '135' }, 7, false);
    expect(store.hasDrafts('member-a')).toBe(false);
    store.write(scope, inspected, { weight: '145' }, 7, true);
    expect(store.hasDrafts('member-a')).toBe(true);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('reviewed replacement targets', () => {
  it('sends reviewed replacement and targets in one account/version-bound request, including an empty review', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await planWrites.replaceSlot('w1', 's1', 'db', { accountId: 'member-a', planId: 'plan-a', version: 7 }, {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('/api/workouts/w1/exercises/s1/swap');
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ to_exercise: 'db', expected_version: 7, targets: {} });
    expect(fetch.mock.calls[0]![1].headers['x-tresfort-account']).toBe('member-a');
  });
  it('clears a total load before per-hand replacement and sends explicit null without changing group rounds', () => {
    const original = slot(), draft = replacementDraft(original, dumbbell);
    expect(draft).toMatchObject({ weight: '', stored: null, sets: '3', reps: '5', rpe: '8', rest: '120' });
    expect(replacementFields(draft, dumbbell, original)).toEqual({ ok: true, fields: { target_weight: null } });
    const reviewed = replacementFields({ ...draft, weight: '45' }, dumbbell, original);
    expect(reviewed).toEqual({ ok: true, fields: { target_weight: 45, target_weight_unit: 'lb' } });
    const grouped = slot({ group_id: 'g', group_rest_seconds: 90, group_transition_seconds: 15 });
    const groupFields = replacementFields({ ...replacementDraft(grouped, dumbbell), sets: '10', rest: '42', weight: '40' }, dumbbell, grouped);
    expect(groupFields.ok && groupFields.fields).not.toHaveProperty('target_sets');
    expect(groupFields.ok && groupFields.fields).not.toHaveProperty('rest_seconds');
  });
  it('clears assistance and cardio load meaning, and retains a compatible reviewed prescription', () => {
    const assisted = slot({ exercise_modality: 'bw', target_weight: -20 });
    expect(replacementDraft(assisted, dumbbell).weight).toBe('');
    const cardio = { ...dumbbell, modality: 'cardio', load_mode: 'total' };
    const result = replacementFields(replacementDraft(slot(), cardio), cardio, slot());
    expect(result.ok && result.fields).toMatchObject({ target_weight: null, target_rpe: null, target_duration_s: 300 });
    const same = { ...dumbbell, modality: 'barbell', load_mode: 'total' };
    expect(replacementDraft(slot(), same).weight).toBe('135');
    const fromCardio = replacementDraft(slot({ exercise_modality: 'cardio', target_duration_s: 300 }), same);
    expect(fromCardio).toMatchObject({ measure: 'reps', reps: '8', useRange: false, weight: '' });
    expect(replacementFields(replacementDraft(slot(), same), same, slot())).toEqual({ ok: true, fields: {} });
  });
  it('validates retained half-typed forms and prevents applying them to a removed, swapped or regrouped slot', () => {
    const initial = slot();
    expect(isSlotDraft(draftFromSlot(initial))).toBe(true);
    expect(isSlotDraft({ ...draftFromSlot(initial), weight: 45 })).toBe(false);
    expect(sameSlotIdentity(initial, undefined)).toBe(false);
    expect(sameSlotIdentity(initial, slot({ exercise_id: 'different' }))).toBe(false);
    expect(sameSlotIdentity(initial, slot({ group_id: 'new-group' }))).toBe(false);
    expect(sameSlotIdentity(initial, slot({ target_weight: 150 }))).toBe(true);
  });
  it('makes every reviewed target explicit, including cleared RPE, zero rest and warm-up class', () => {
    const current = slot({ target_rpe: null, rest_seconds: 0, is_warmup: 1 });
    const comparisons = slotDraftComparison(current, { ...draftFromSlot(current), weight: '145', rpe: '7', rest: '90' });
    expect(comparisons).toContainEqual({ label: 'Weight', current: '135 lb', proposed: '145 lb' });
    expect(comparisons).toContainEqual({ label: 'Target RPE', current: 'No target', proposed: '7' });
    expect(comparisons).toContainEqual({ label: 'Rest between sets', current: '0 seconds', proposed: '90 seconds' });
    expect(comparisons).toContainEqual({ label: 'Warm-up', current: 'Yes', proposed: 'Yes' });
  });
  it('matches equipment and movement words in either order', () => {
    const squat = { ...dumbbell, id: 'squat', name: 'Back Squat', modality: 'barbell', primary_muscle: 'legs', aliases: '["squat","bb squat"]' };
    expect(searchCatalog([squat, dumbbell], 'barbell squat')).toEqual([squat]);
    expect(searchCatalog([squat, dumbbell], 'squat barbell')).toEqual([squat]);
  });
});

describe('retained block programming', () => {
  const value = () => ({ programId: program.id, saved: programBody(program), draft: programBody(program), identities: blockSlotIdentities(workouts()) });
  it('validates drafts without silently normalizing corrupt week data', () => {
    expect(isBlockDraft(value())).toBe(true);
    expect(isBlockDraft({ ...value(), draft: { ...programBody(program), weeks: [] } })).toBe(false);
    expect(isBlockDraft({ ...value(), draft: { ...programBody(program), weeks: [{ week: 'invalid' }] } })).toBe(false);
  });
  it('accepts multi-field targets in any object-key order and restores them after storage reload', () => {
    const library = workouts();
    const typed = changingBlockInput(value(), library, library[0]!, slot(), 0, 'target_sets', '4');
    expect(Object.keys(typed.draft.weeks[0]!.targets!.s1!)).toEqual(['target_weight', 'target_sets']);
    expect(isBlockDraft(typed)).toBe(true);
    const orders = [
      { target_weight: 140, target_sets: 4, target_reps: 6 },
      { target_reps: 6, target_weight: 140, target_sets: 4 },
      { target_sets: 4, target_reps: 6, target_weight: 140 },
    ];
    for (const targets of orders) {
      const draft = { ...typed, draft: { ...typed.draft, weeks: [{ ...typed.draft.weeks[0]!, targets: { s1: targets } }] } };
      expect(isBlockDraft(draft)).toBe(true);
      const disk = storage(), store = new EditorDraftStore(() => disk, () => 'multi-field');
      const scoped = { ...scope, documentId: 'block' };
      store.write(scoped, null, draft, 7);
      expect(new EditorDraftStore(() => disk).read(scoped, isBlockDraft)).toMatchObject({ version: 7, value: draft });
    }
    const malformed = { ...typed, draft: { ...typed.draft, weeks: [{ ...typed.draft.weeks[0]!, targets: { s1: { target_weight: 140, target_sets: 4, unknown_target: 12 } } }] } };
    expect(isBlockDraft(malformed)).toBe(false);
    expect(isBlockDraft({ ...malformed, draft: { ...typed.draft, weeks: [{ ...typed.draft.weeks[0]!, targets: { s1: { target_weight: 140, target_sets: '4' } } }] } })).toBe(false);
  });
  it('permits version review, but blocks changed block/slot identities and unavailable workouts', () => {
    expect(blockDraftProblem(value(), program.id, workouts(slot({ target_weight: 145 })))).toBeNull();
    expect(blockDraftProblem(value(), null, workouts())).toMatch(/ended or replaced/);
    expect(blockDraftProblem(value(), 'other-block', workouts())).toMatch(/different block/);
    expect(blockDraftProblem(value(), program.id, workouts(slot({ exercise_id: 'db' })))).toMatch(/removed, replaced, regrouped/);
    expect(blockDraftProblem(value(), program.id, workouts(slot({ target_weight_unit: 'kg' })))).toMatch(/changed how its targets are measured/);
    expect(blockDraftProblem(value(), program.id, [])).toMatch(/workout.*no longer available/);
  });
  it('keeps similarly named targets from different workouts distinct in conflict review', () => {
    const second = slot({ id: 's2', workout_id: 'w2' });
    const library = [...workouts(), { ...workouts(second)[0]!, id: 'w2', name: 'Upper again', exercises: [second] }];
    const current = { ...programBody(program), weeks: [{ ...program.weeks[0]!, targets: { s1: { target_weight: 140 }, s2: { target_weight: 150 } } }] };
    const proposed = { ...current, weeks: [{ ...current.weeks[0]!, targets: { s1: { target_weight: 145 }, s2: { target_weight: 150 } } }] };
    const rows = blockComparison(current, proposed, library);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: '[0,"s1","target_weight"]', label: 'Week 1 · Upper · Bench Press (exercise 1) · Load', current: '140 lb', proposed: '145 lb' });
  });
  it('retains focused raw target text before blur, updates valid values, and keeps invalid input without sending it', () => {
    const library = workouts(), original = value();
    const typed = changingBlockInput(original, library, library[0]!, slot(), 0, 'target_weight', '145.');
    const key = targetInputKey('s1', 0, 'target_weight');
    expect(typed.inputs?.[key]).toBe('145.');
    expect(typed.draft.weeks[0]!.targets?.s1?.target_weight).toBe(145);
    expect(blockInputErrors(typed.inputs!, library)).toEqual([]);
    const partial = changingBlockInput(typed, library, library[0]!, slot(), 0, 'target_weight', '-');
    expect(partial.inputs?.[key]).toBe('-');
    expect(partial.draft.weeks[0]!.targets?.s1?.target_weight).toBe(145);
    expect(blockInputErrors(partial.inputs!, library)).toHaveLength(1);
    expect(parsedTargetInput('0', 'target_sets', slot())).toBeNull();
    expect(parsedTargetInput('1.5', 'target_reps', slot())).toBeNull();
    const disk = storage(), store = new EditorDraftStore(() => disk, () => 'block-text');
    store.write({ ...scope, documentId: 'block' }, null, partial, 7);
    expect(new EditorDraftStore(() => disk).read({ ...scope, documentId: 'block' }, isBlockDraft)).toMatchObject({ value: { inputs: { [key]: '-' } } });
  });
  it('shows the current inherited load explicitly when only the draft has a week override', () => {
    const current = { ...programBody(program), weeks: [{ week: program.weeks[0]!.week }] };
    expect(blockComparison(current, programBody(program), workouts())[0]).toMatchObject({ current: '135 lb (saved workout)', proposed: '140 lb' });
  });
  it('preserves typed equal-baseline load after a concurrent baseline change through comparison, rebase and save', () => {
    const oldLibrary = workouts(), original = value();
    const typed = changingBlockInput(original, oldLibrary, oldLibrary[0]!, slot(), 0, 'target_weight', '135');
    expect(typed.draft.weeks[0]!.targets?.s1?.target_weight).toBeUndefined();
    const liveLibrary = workouts(slot({ target_weight: 155 }));
    const proposed = resolveBlockInputs(typed.draft, typed.inputs!, liveLibrary);
    expect(proposed.weeks[0]!.targets?.s1?.target_weight).toBe(135);
    expect(blockComparison(original.saved, proposed, liveLibrary)).toContainEqual({
      key: '[0,"s1","target_weight"]', label: 'Week 1 · Upper · Bench Press (exercise 1) · Load', current: '140 lb', proposed: '135 lb',
    });
    expect(blockComparison(typed.draft, proposed, liveLibrary)[0]).toMatchObject({ current: '155 lb (saved workout)', proposed: '135 lb' });
    const rebased = { ...typed, draft: proposed, identities: blockSlotIdentities(liveLibrary) };
    expect(programBody(resolveBlockInputs(rebased.draft, rebased.inputs!, liveLibrary))).toEqual(programBody(proposed));
    const inherited = changingBlockInput(original, oldLibrary, oldLibrary[0]!, slot(), 0, 'target_weight', '');
    expect(resolveBlockInputs(inherited.draft, inherited.inputs!, liveLibrary).weeks[0]!.targets?.s1?.target_weight).toBeUndefined();
  });
  it('resolves typed group rounds for every member after the saved group changes', () => {
    const a = slot({ group_id: 'group', target_sets: 3 }), b = slot({ id: 's2', order_index: 1, group_id: 'group', target_sets: 3 });
    const oldLibrary = [{ ...workouts(a)[0]!, exercises: [a, b] }];
    const original = { ...value(), identities: blockSlotIdentities(oldLibrary) };
    const typed = changingBlockInput(original, oldLibrary, oldLibrary[0]!, a, 0, 'target_sets', '3');
    expect(typed.draft.weeks[0]!.targets?.s1?.target_sets).toBeUndefined();
    const liveLibrary = [{ ...oldLibrary[0]!, exercises: [{ ...a, target_sets: 4 }, { ...b, target_sets: 4 }] }];
    const proposed = resolveBlockInputs(typed.draft, typed.inputs!, liveLibrary);
    expect(proposed.weeks[0]!.targets?.s1?.target_sets).toBe(3);
    expect(proposed.weeks[0]!.targets?.s2?.target_sets).toBe(3);
    const rows = blockComparison(original.saved, proposed, liveLibrary).filter(row => row.label.endsWith('Sets'));
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.current === '4 (saved workout)' && row.proposed === '3')).toBe(true);
  });
  it('keeps only the latest shared-round intent when typing and clearing equal the old baseline', () => {
    const a = slot({ group_id: 'group', target_sets: 3 }), b = slot({ id: 's2', order_index: 1, group_id: 'group', target_sets: 3 });
    const oldLibrary = [{ ...workouts(a)[0]!, exercises: [a, b] }];
    const original = { ...value(), identities: blockSlotIdentities(oldLibrary) };
    const typed = changingBlockInput(original, oldLibrary, oldLibrary[0]!, a, 0, 'target_sets', '3');
    const cleared = changingBlockInput(typed, oldLibrary, oldLibrary[0]!, b, 0, 'target_sets', '');
    expect(cleared.inputs?.[targetInputKey(a.id, 0, 'target_sets')]).toBeUndefined();
    expect(cleared.inputs?.[targetInputKey(b.id, 0, 'target_sets')]).toBe('');
    const liveLibrary = [{ ...oldLibrary[0]!, exercises: [{ ...a, target_sets: 4 }, { ...b, target_sets: 4 }] }];
    const resolved = resolveBlockInputs(cleared.draft, cleared.inputs!, liveLibrary);
    expect(resolved.weeks[0]!.targets?.s1?.target_sets).toBeUndefined();
    expect(resolved.weeks[0]!.targets?.s2?.target_sets).toBeUndefined();
    const reset = resettingBlockInputs(typed, oldLibrary[0]!, b, 0, ['target_sets', 'target_weight']);
    expect(reset.inputs?.[targetInputKey(a.id, 0, 'target_sets')]).toBeUndefined();
    expect(resolveBlockInputs(reset.draft, reset.inputs!, liveLibrary).weeks[0]!.targets?.s1?.target_sets).toBeUndefined();
  });
  it('shows changed current/proposed values with workout and exercise labels', () => {
    const proposed = { ...programBody(program), name: 'Build', weeks: [{ ...program.weeks[0]!, targets: { s1: { target_weight: 145 } } }] };
    expect(blockComparison(programBody(program), proposed, workouts())).toEqual([
      { key: 'Name', label: 'Name', current: 'Your block', proposed: 'Build' },
      { key: '[0,"s1","target_weight"]', label: 'Week 1 · Upper · Bench Press (exercise 1) · Load', current: '140 lb', proposed: '145 lb' },
    ]);
  });
});
