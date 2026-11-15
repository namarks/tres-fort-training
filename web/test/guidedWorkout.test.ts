import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountChangedError, ApiError, createPrescribedWorkout, fetchMe, SignedOutError } from '../src/api';
import { buildPrescription, creationFailure, creationReview, draftFromPrescription, guidedErrors, guidedTarget, HOME_STARTS,
  initialGuidedDraft, isEquipmentFree, prescriptionAuthority, readPendingCreation, savePendingCreation, transitionPendingCreation,
  type CreationReview } from '../src/guidedWorkout';
import type { CatalogExercise } from '../src/editing';
import { isPartnerWorkoutInput } from '../../src/partnerTraining';
import { validatePlanExerciseGroups } from '../../src/exerciseGroups';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { GuidedWorkoutCreator } from '../src/GuidedWorkoutCreator';

const UUID = '00000000-0000-4000-8000-000000000001';
function exercise(id: string, overrides: Partial<CatalogExercise> = {}): CatalogExercise {
  return { id, name: id, primary_muscle: 'core', modality: 'bw', unit: 'lb', laterality: 'bilateral', load_mode: 'total', demo_slug: null, aliases: null, ...overrides };
}
const timed = new Set(['ex_plank', 'ex_side_plank', 'ex_hollow']);
const catalog = [...new Set(Object.values(HOME_STARTS).flatMap(start => [...start.ids]))].map(id => exercise(id,
  { modality: timed.has(id) ? 'timed' : 'bw', laterality: id === 'ex_side_plank' ? 'unilateral' : 'bilateral' }));
catalog.push(exercise('ex_outdoor_run', { name: 'Outdoor Run', modality: 'cardio', unit: 'min' }));
function make(start: Parameters<typeof initialGuidedDraft>[0] = 'core') {
  let next = 0;
  return buildPrescription(initialGuidedDraft(start), catalog, { planId: null, version: 0 },
    () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`)!;
}
function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
afterEach(() => vi.unstubAllGlobals());

describe('guided reviewed prescriptions', () => {
  it('requires the live account identity before opening account-scoped drafts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ display_name: 'Member' }))
      .mockResolvedValueOnce(Response.json({ id: UUID, display_name: 'Member' })));
    await expect(fetchMe()).rejects.toThrow('missing_account_identity');
    await expect(fetchMe()).resolves.toMatchObject({ id: UUID });
  });
  it('preserves the iPhone home presets and mixed timed/reps targets without adding a load', () => {
    const request = make();
    expect(request.name).toBe('Core routine');
    expect(request.slots.map(slot => slot.exercise_id)).toEqual(['ex_plank', 'ex_dead_bug', 'ex_side_plank', 'ex_bird_dog', 'ex_hollow']);
    expect(request.slots.map(slot => slot.target_duration_s)).toEqual([45, null, 45, null, 45]);
    expect(request.slots.map(slot => slot.target_reps)).toEqual([45, 8, 45, 8, 45]);
    expect(request.slots.every(slot => slot.target_weight === null && slot.rest_seconds === 120 && slot.target_sets === 3)).toBe(true);
    expect(isPartnerWorkoutInput(request)).toBe(true);
    expect(guidedTarget(initialGuidedDraft('core'), catalog.find(row => row.id === 'ex_side_plank')!)).toBe('3 × 45s');
  });
  it('saves real contiguous circuit grouping with one shared UUID and reviewed rests', () => {
    const request = make('bodyweight');
    expect(new Set(request.slots.map(slot => slot.group_id)).size).toBe(1);
    expect(request.slots.every(slot => slot.group_id && slot.group_rest_seconds === 60 && slot.group_transition_seconds === 20 && slot.rest_seconds === 60)).toBe(true);
    expect(request.slots.map(slot => slot.order_index)).toEqual([0, 1, 2, 3, 4]);
    expect(validatePlanExerciseGroups([{ exercises: request.slots }])).toBeNull();
    expect(isPartnerWorkoutInput(request)).toBe(true);
  });
  it('uses edited timing for every selected exercise and round, including bodyweight moves', () => {
    const draft = { ...initialGuidedDraft('core'), sets: ' 4 ', seconds: '30', timeEveryExercise: true, circuit: true, transitionRest: '0', roundRest: '90' };
    const request = buildPrescription(draft, catalog, { planId: UUID, version: 17 })!;
    expect(request.expected_version).toBe(17);
    expect(request.slots.every(slot => slot.target_duration_s === 30 && slot.target_reps === 30 && slot.target_sets === 4 && slot.group_rest_seconds === 90 && slot.group_transition_seconds === 0)).toBe(true);
    expect(draftFromPrescription(request)).toMatchObject({ sets: '4', seconds: '30', timeEveryExercise: true, circuit: true, roundRest: '90' });
  });
  it('creates an open run without a misleading timer target or unsupported run_steps', () => {
    const request = make('run');
    expect(request.slots).toHaveLength(1);
    expect(request.slots[0]).toMatchObject({ exercise_id: 'ex_outdoor_run', target_sets: 1, target_reps: 1, target_duration_s: null, rest_seconds: 0 });
    expect(request.slots[0]).not.toHaveProperty('run_steps');
    expect(isPartnerWorkoutInput(request)).toBe(true);
  });
  it('does not silently drop missing presets or substitute catalog placeholders', () => {
    expect(buildPrescription(initialGuidedDraft('core'), catalog.filter(row => row.id !== 'ex_plank'), { planId: null, version: 0 })).toBeNull();
    expect(guidedErrors(initialGuidedDraft('core'), [])).toContain('Some selected exercises are unavailable. Reload the catalog before saving.');
  });
  it.each(['', '-1', '2.5', '1e2', '101', 'NaN'])('rejects invalid sets %s instead of replacing them with defaults', sets => {
    expect(buildPrescription({ ...initialGuidedDraft('core'), sets }, catalog, { planId: null, version: 0 })).toBeNull();
  });
  it('validates only visible targets and enforces timing/reps/rest and group bounds', () => {
    const draft = { ...initialGuidedDraft('core'), seconds: '7201', reps: '1001', rest: '3601' };
    expect(guidedErrors(draft, catalog)).toHaveLength(3);
    expect(guidedErrors({ ...draft, seconds: '7200', reps: '1000', rest: '3600' }, catalog)).toEqual([]);
    expect(guidedErrors({ ...initialGuidedDraft('core'), timeEveryExercise: true, reps: '' }, catalog)).toEqual([]);
    expect(guidedErrors({ ...initialGuidedDraft('bodyweight'), exerciseIds: ['ex_plank'] }, catalog)).toContain('A circuit needs at least two exercises.');
    expect(guidedErrors({ ...initialGuidedDraft('bodyweight'), transitionRest: '-1' }, catalog)).toContain('Enter transition and round rests from 0 to 3,600 seconds.');
  });
  it('excludes equipment-dependent bodyweight exercises using iPhone rules', () => {
    for (const row of [exercise('ex_ab_wheel'), exercise('custom', { name: 'Ring push-up' }), exercise('custom', { name: 'Pull-up' }), exercise('custom', { modality: 'dumbbell' })]) {
      expect(isEquipmentFree(row)).toBe(false);
    }
    expect(isEquipmentFree(exercise('ex_pushup', { name: 'Push-Up' }))).toBe(true);
  });
  it('shows the explicit open-run limitation and preserves the custom option', () => {
    const props = { accountId: 'member', planId: null, version: 0, catalog: { kind: 'ready' as const, exercises: catalog },
      busy: false, workouts: [], reload: async () => {}, onSelect: () => {}, onSignedOut: () => {}, customForm: null };
    const chooser = renderToStaticMarkup(createElement(GuidedWorkoutCreator, props));
    expect(chooser).toContain('At home'); expect(chooser).toContain('Custom workout');
    const storage = memoryStorage(); savePendingCreation(storage, 'member', { request: make('run'), status: 'pending' });
    vi.stubGlobal('sessionStorage', storage);
    const markup = renderToStaticMarkup(createElement(GuidedWorkoutCreator, props));
    expect(markup).toContain('Open run — choose distance or intervals in the run editor after saving.');
    expect(markup).toContain('Retry same save'); expect(markup).not.toContain('Hold / work');
  });
});

describe('creation retry identity and recovery', () => {
  it('round-trips the full reviewed request only within its account', () => {
    const storage = memoryStorage(), request = make('bodyweight');
    expect(savePendingCreation(storage, 'one', { request, status: 'pending' })).toBe(true);
    expect(readPendingCreation(storage, 'one')).toEqual({ request, status: 'pending' });
    expect(readPendingCreation(storage, 'two')).toBeNull();
    savePendingCreation(storage, 'two', { request: make('run'), status: 'saved' });
    savePendingCreation(storage, 'one', null);
    expect(readPendingCreation(storage, 'one')).toBeNull();
    expect(readPendingCreation(storage, 'two')).toMatchObject({ status: 'saved' });
  });
  it('fails closed for unreadable records and unavailable persistence', () => {
    const storage = memoryStorage();
    storage.setItem('tresfort.pendingWorkout.v1.one', '{bad');
    expect(readPendingCreation(storage, 'one')).toBe('unreadable');
    expect(transitionPendingCreation(storage, 'one', null, { request: make(), status: 'pending' })).toBe('unavailable');
    const unavailable = { ...memoryStorage(), setItem: () => { throw new Error('quota'); } };
    expect(transitionPendingCreation(unavailable, 'one', null, { request: make(), status: 'pending' })).toBe('unavailable');
    expect(readPendingCreation(unavailable, 'one')).toBeNull();
  });
  it('requires a fresh library check before clearing a receipt conflict even if an old row is visible', () => {
    const storage = memoryStorage(), request = make();
    savePendingCreation(storage, 'one', { request, status: 'blocked' });
    vi.stubGlobal('sessionStorage', storage);
    const markup = renderToStaticMarkup(createElement(GuidedWorkoutCreator, {
      accountId: 'one', planId: UUID, version: 1, catalog: { kind: 'ready', exercises: catalog }, busy: false,
      workouts: [{ id: request.workout_id, plan_id: UUID, name: 'Core routine', day_label: null, order_index: 0,
        notes: null, created_at: 0, updated_at: 0, archived_at: null, exercises: [] }],
      reload: async () => {}, onSelect: () => {}, onSignedOut: () => {}, customForm: null,
    }));
    expect(markup).toContain('Refresh workout library');
    expect(markup).not.toContain('Open saved workout');
    expect(markup).not.toContain('clear this request');
  });
  it('rejects late completions replacing or clearing a newer request', () => {
    const storage = memoryStorage(), old = make(), next = { ...make(), workout_id: '00000000-0000-4000-8000-000000000999' };
    expect(transitionPendingCreation(storage, 'one', null, { request: old, status: 'pending' })).toBe('saved');
    expect(transitionPendingCreation(storage, 'one', old.workout_id, null)).toBe('saved');
    expect(transitionPendingCreation(storage, 'one', null, { request: next, status: 'pending' })).toBe('saved');
    expect(transitionPendingCreation(storage, 'one', old.workout_id, { request: old, status: 'saved' })).toBe('stale');
    expect(transitionPendingCreation(storage, 'one', old.workout_id, null)).toBe('stale');
    expect(readPendingCreation(storage, 'one')).toEqual({ request: next, status: 'pending' });
  });
  it('does not regress an ACK on a delayed rejection or pending retry', () => {
    const storage = memoryStorage(), request = make();
    savePendingCreation(storage, 'one', { request, status: 'saved' });
    expect(transitionPendingCreation(storage, 'one', request.workout_id, null)).toBe('stale');
    expect(transitionPendingCreation(storage, 'one', request.workout_id, { request, status: 'pending' })).toBe('stale');
    expect(readPendingCreation(storage, 'one')).toEqual({ request, status: 'saved' });
  });
  it('separates definite review failures from receipt conflicts and ambiguous replies', () => {
    expect(creationFailure(new ApiError(400, { error: 'invalid_fields' }))).toBe('review');
    expect(creationFailure(new ApiError(409, { conflict: true, current_version: 2 }))).toBe('review');
    expect(creationFailure(new ApiError(409, { error: 'idempotency_conflict' }))).toBe('blocked');
    expect(creationFailure(new ApiError(409, { error: 'workout_changed' }))).toBe('blocked');
    expect(creationFailure(new ApiError(503, null))).toBe('uncertain');
    expect(creationFailure(new TypeError('Failed to fetch'))).toBe('uncertain');
  });
  it('sends identical stored bytes after an ambiguous response, without rebasing the version', async () => {
    const request = make('bodyweight'), storage = memoryStorage();
    savePendingCreation(storage, 'one', { request, status: 'pending' });
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('lost reply')).mockResolvedValueOnce(new Response(JSON.stringify({ workout_id: request.workout_id, plan_id: UUID, version: 9 }), { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(createPrescribedWorkout(request, 'one')).rejects.toThrow('lost reply');
    const restored = readPendingCreation(storage, 'one');
    if (!restored || restored === 'unreadable') throw new Error('missing request');
    await expect(createPrescribedWorkout(restored.request, 'one')).resolves.toMatchObject({ workout_id: request.workout_id, version: 9 });
    const first = fetcher.mock.calls[0]!, second = fetcher.mock.calls[1]!;
    expect(first[0]).toBe('/api/workouts/prescribed');
    expect(first[1].body).toBe(second[1].body);
    expect(JSON.parse(first[1].body).expected_version).toBe(0);
    expect(first[1].headers['x-tres-fort-web']).toBe('1');
    expect(first[1].headers['x-tresfort-account']).toBe('one');
    expect(second[1].headers['x-tresfort-account']).toBe('one');
  });
  it('treats a malformed success as uncertain and retains signed-out semantics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 201 })).mockResolvedValueOnce(new Response('{}', { status: 401 })));
    await expect(createPrescribedWorkout(make(), 'one')).rejects.toThrow('unreadable_prescription_receipt');
    await expect(createPrescribedWorkout(make(), 'one')).rejects.toBeInstanceOf(SignedOutError);
  });
  it('retains the original account binding when an ambient cookie switches accounts', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"error":"account_changed"}', { status: 409 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(createPrescribedWorkout(make(), 'reviewed-account')).rejects.toBeInstanceOf(AccountChangedError);
    expect(fetcher.mock.calls[0]![1].headers['x-tresfort-account']).toBe('reviewed-account');
  });
  it('keeps reviewed targets through conflict and refresh outage, then requires explicit fresh review', () => {
    const draft = { ...initialGuidedDraft('core'), name: 'Evening core', seconds: '35', sets: '2', rest: '75' };
    const at = { planId: UUID, version: 3 }, latest = { planId: UUID, version: 4 };
    let review: CreationReview = { at, recovery: 'none' };
    const first = buildPrescription(draft, catalog, prescriptionAuthority(review, at)!)!;
    review = creationReview(review, { kind: 'refused' });
    review = creationReview(review, { kind: 'refresh_failed' });
    expect(prescriptionAuthority(review, at)).toBeNull();
    // Neither clicking review nor choosing another preset bypasses a failed read.
    review = creationReview(review, { kind: 'review', at });
    review = creationReview(review, { kind: 'new_draft', at });
    expect(prescriptionAuthority(review, at)).toBeNull();
    review = creationReview(review, { kind: 'refreshed' });
    expect(prescriptionAuthority(review, latest)).toBeNull();
    review = creationReview(review, { kind: 'review', at: latest });
    const retry = buildPrescription(draft, catalog, prescriptionAuthority(review, latest)!)!;
    expect(retry.expected_version).toBe(4);
    expect(retry.name).toBe(first.name);
    expect(retry.slots.map(({ id: _, ...slot }) => slot)).toEqual(first.slots.map(({ id: _, ...slot }) => slot));
    expect(prescriptionAuthority(review, { planId: 'another-plan', version: 4 })).toBeNull();
  });
});
