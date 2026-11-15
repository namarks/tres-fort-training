import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isPartnerWorkoutInput } from '../../src/partnerTraining';
import { createPrescribedWorkout } from '../src/api';
import { CREATION_DOCUMENT_ID, EditorDraftStore, draftKey, editorDraftStore } from '../src/editorDrafts';
import type { CatalogExercise } from '../src/editing';
import { GuidedWorkoutCreator } from '../src/GuidedWorkoutCreator';
import { creationReview, draftFromPrescription, prescriptionAuthority, readPendingCreation, savePendingCreation, transitionPendingCreation, type PendingCreation } from '../src/guidedWorkout';
import { addLiftingExercise, buildLiftingPrescription, initialLiftingDraft, isRetainedLiftingDraft, liftingDraftFromPrescription, liftingErrors, moveLiftingExercise } from '../src/liftingDraft';

const exercise = (id: string, modality = 'barbell', load_mode = 'total', laterality = 'bilateral'): CatalogExercise => ({
  id, name: id, modality, load_mode, laterality, primary_muscle: 'legs', unit: 'lb', demo_slug: null, aliases: null,
});
const catalog = [exercise('bench'), exercise('squat'), exercise('press', 'dumbbell', 'per_hand', 'unilateral'), exercise('pullup', 'bw'),
  exercise('plank', 'timed', 'total', 'unilateral'), exercise('bike', 'cardio'), exercise('ex_outdoor_run', 'cardio')];
const at = { planId: null, version: 0 };
const uuid = () => { let id = 0; return () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`; };
function reviewedDraft() {
  const draft = catalog.slice(0, 6).reduce((draft, row) => addLiftingExercise(draft, row, 'kg'), initialLiftingDraft());
  const overrides = [
    { sets: '2', reps: '10', weight: '20', isWarmup: true, rest: '45' },
    { sets: '5', reps: '5', weight: '135', unit: 'lb' as const, rpe: '8', rest: '150' },
    { sets: '3', reps: '8', useRange: true, repsMax: '12', rest: '75' },
    { sets: '4', reps: '6', weight: '-10', rpe: '7.5', rest: '90' },
    { sets: '2', holdSeconds: '35', rest: '30' },
    { sets: '1', minutes: '5.25', rest: '0' },
  ];
  draft.rows = draft.rows.map((row, i) => ({ ...row, targets: { ...row.targets, ...overrides[i] } }));
  return draft;
}
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
afterEach(() => vi.unstubAllGlobals());

describe('reviewed lifting creation', () => {
  it('saves six individually reviewed prescriptions in the chosen order with blank loads and mixed units', () => {
    const draft = moveLiftingExercise(reviewedDraft(), 2, -1);
    const request = buildLiftingPrescription(draft, catalog, at, uuid())!;
    expect(isPartnerWorkoutInput(request)).toBe(true);
    expect(request.slots.map(slot => slot.exercise_id)).toEqual(['bench', 'press', 'squat', 'pullup', 'plank', 'bike']);
    expect(request.slots.map(slot => slot.order_index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(request.slots[0]).toMatchObject({ target_sets: 2, target_reps: 10, target_weight: 20, target_weight_unit: 'kg', is_warmup: 1, rest_seconds: 45 });
    expect(request.slots[1]).toMatchObject({ target_sets: 3, target_reps: 8, target_reps_max: 12, target_weight: null, target_weight_unit: 'kg', rest_seconds: 75 });
    expect(request.slots[2]).toMatchObject({ target_sets: 5, target_reps: 5, target_weight: 135, target_weight_unit: 'lb', target_rpe: 8, rest_seconds: 150 });
    expect(request.slots[3]).toMatchObject({ target_weight: -10, target_rpe: 7.5, rest_seconds: 90 });
    expect(request.slots[4]).toMatchObject({ target_sets: 2, target_duration_s: 35, target_reps: 35, rest_seconds: 30 });
    expect(request.slots[5]).toMatchObject({ target_sets: 1, target_duration_s: 315, target_reps: 1, target_weight: null, rest_seconds: 0 });
    expect(new Set([request.workout_id, ...request.slots.map(slot => slot.id)]).size).toBe(7);
  });
  it('does not invent loads, duplicate movements, include Outdoor Run, or exceed 50 selected rows', () => {
    const draft = addLiftingExercise(initialLiftingDraft(), catalog[0]!, 'kg');
    expect(draft.rows[0]!.targets.weight).toBe('');
    expect(draft.rows[0]!.targets.unit).toBe('kg');
    expect(addLiftingExercise(draft, catalog[0]!, 'lb')).toBe(draft);
    expect(addLiftingExercise(draft, catalog[6]!, 'lb')).toBe(draft);
    const full = Array.from({ length: 50 }, (_, index) => exercise(`movement-${index}`)).reduce((draft, row) => addLiftingExercise(draft, row, 'lb'), initialLiftingDraft());
    expect(addLiftingExercise(full, catalog[0]!, 'lb')).toBe(full);
  });
  it('validates each visible target before allocating any UUIDs', () => {
    const draft = reviewedDraft();
    draft.rows[2]!.targets.repsMax = '4'; draft.rows[4]!.targets.holdSeconds = '0'; draft.rows[0]!.targets.rest = '2.5';
    const allocate = vi.fn(uuid());
    expect(buildLiftingPrescription(draft, catalog, at, allocate)).toBeNull();
    expect(allocate).not.toHaveBeenCalled();
    expect(liftingErrors(draft, catalog)).toEqual(expect.arrayContaining([
      'press: The top of the rep range must be at least the minimum.', 'plank: Hold must be 1 to 7200 seconds.', 'bench: Rest must be 0 to 3600 seconds.',
    ]));
    expect(buildLiftingPrescription(reviewedDraft(), [], at, allocate)).toBeNull();
  });
  it('restores all heterogeneous pending fields and metadata, retaining legacy home/run records', () => {
    const request = buildLiftingPrescription(reviewedDraft(), catalog, at, uuid())!, disk = storage();
    savePendingCreation(disk, 'a', { request, kind: 'lifting', status: 'pending' });
    const pending = readPendingCreation(disk, 'a') as PendingCreation;
    expect(pending.kind).toBe('lifting');
    expect(buildLiftingPrescription(liftingDraftFromPrescription(pending.request), catalog, at, uuid())).toEqual(request);
    savePendingCreation(disk, 'legacy', { request, status: 'pending' });
    const legacy = readPendingCreation(disk, 'legacy') as PendingCreation;
    expect(legacy.kind).toBeUndefined();
    expect(draftFromPrescription(legacy.request).kind).toBe('home');
    const run = { ...request, slots: [{ ...request.slots[5]!, exercise_id: 'ex_outdoor_run', order_index: 0 }] };
    savePendingCreation(disk, 'legacy-run', { request: run, status: 'pending' });
    expect(draftFromPrescription((readPendingCreation(disk, 'legacy-run') as PendingCreation).request).kind).toBe('run');
  });
  it('retries the frozen bytes and account after an uncertain save and does not downgrade an acknowledgement', async () => {
    const request = buildLiftingPrescription(reviewedDraft(), catalog, at, uuid())!, disk = storage();
    const pending: PendingCreation = { request, kind: 'lifting', status: 'pending' };
    expect(transitionPendingCreation(disk, 'member', null, pending)).toBe('saved');
    const fetch = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(Response.json({ workout_id: request.workout_id, plan_id: 'plan', version: 1 }));
    vi.stubGlobal('fetch', fetch);
    await expect(createPrescribedWorkout(request, 'member')).rejects.toThrow();
    const restored = readPendingCreation(disk, 'member') as PendingCreation;
    await createPrescribedWorkout(restored.request, 'member');
    expect(fetch.mock.calls[0]![1].body).toEqual(fetch.mock.calls[1]![1].body);
    expect(fetch.mock.calls[1]![1].headers['x-tresfort-account']).toBe('member');
    expect(transitionPendingCreation(disk, 'member', request.workout_id, { ...restored, status: 'saved' })).toBe('saved');
    expect(transitionPendingCreation(disk, 'member', request.workout_id, pending)).toBe('stale');
    expect(readPendingCreation(disk, 'other')).toBeNull();
  });
  it('retains half-typed planless targets only in creation scopes and requires explicit version review', () => {
    const disk = storage(), store = new EditorDraftStore(() => disk, () => 'draft');
    const scope = { accountId: 'a', planId: null, documentId: CREATION_DOCUMENT_ID };
    const draft = reviewedDraft(); draft.rows[1]!.targets.weight = '13.';
    const review = { at, recovery: 'none' as const }, value = { draft, review };
    const saved = store.write(scope, null, value, 0);
    expect(new EditorDraftStore(() => disk).read(scope, isRetainedLiftingDraft)).toEqual(saved);
    expect(store.hasDrafts('a')).toBe(true);
    for (const other of [{ ...scope, accountId: 'b' }, { ...scope, planId: 'plan' }]) expect(store.read(other, isRetainedLiftingDraft)).toBeNull();
    const existing = { ...scope, planId: 'plan', documentId: 'workout:one' };
    store.write(existing, null, value, 0);
    expect(store.read(existing, isRetainedLiftingDraft)).toBe('unreadable');
    const notCreation = { ...scope, documentId: 'workout:one' };
    store.write(notCreation, null, value, 0);
    expect(store.read(notCreation, isRetainedLiftingDraft)).toBe('unreadable');
    store.write(notCreation, null, value, 1);
    expect(store.read(notCreation, isRetainedLiftingDraft)).toBe('unreadable');
    const original = { at: { planId: 'existing', version: 7 }, recovery: 'none' as const }, advanced = { planId: 'existing', version: 8 };
    expect(prescriptionAuthority(original, advanced)).toBeNull();
    expect(prescriptionAuthority(creationReview(original, { kind: 'review', at: advanced }), advanced)).toEqual(advanced);
    expect(prescriptionAuthority(review, { planId: 'other', version: 0 })).toBeNull();
    const changed = store.write(scope, saved, { ...value, draft: { ...draft, name: 'Later edits' } }, 0);
    expect(store.clear(scope, saved)).toBe(false);
    expect(store.read(scope, isRetainedLiftingDraft)).toEqual(changed);
    expect(disk.getItem(draftKey(scope))).toContain('13.');
  });
  it('renders frozen pending rows before any other draft, with per-hand/side and assistance labels', () => {
    const disk = storage(), accountId = 'pending-lifting-render', request = buildLiftingPrescription(reviewedDraft(), catalog, at, uuid())!;
    vi.stubGlobal('sessionStorage', disk);
    const scope = { accountId, planId: null, documentId: CREATION_DOCUMENT_ID };
    editorDraftStore.write(scope, null, { draft: { ...reviewedDraft(), name: 'Later proposal' }, review: { at, recovery: 'none' } }, 0);
    savePendingCreation(disk, accountId, { request, kind: 'lifting', status: 'pending' });
    const markup = renderToStaticMarkup(createElement(GuidedWorkoutCreator, {
      accountId, planId: null, version: 0, catalog: { kind: 'ready', exercises: catalog }, busy: false, workouts: [],
      reload: async () => {}, onSelect: () => {}, onSignedOut: () => {}, customForm: null,
    }));
    expect(markup).toContain('value="Lifting workout"'); expect(markup).not.toContain('Later proposal');
    expect(markup).toContain('Weight, each hand'); expect(markup).toContain('per side'); expect(markup).toContain('assistance as a negative one');
    expect(markup).toContain('value="135"'); expect(markup).toContain('value="-10"'); expect(markup).toContain('value="35"');
    expect(markup).toContain('Your reviewed targets are locked');
    expect((markup.match(/<form/g) ?? []).length).toBe(1);
    editorDraftStore.clear(scope);
  });
});
