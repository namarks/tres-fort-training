import { describe, expect, it } from 'vitest';
import { EditorDraftStore, type DraftStorage } from '../src/editorDrafts';
import { detailsDocument, isNewBlockDraft, isWorkoutDetailsDraft, newBlockDraft, newBlockRequest, newWorkoutDetailsDraft, NEW_BLOCK_DOCUMENT, workoutDetailsRequest } from '../src/programmingDrafts';
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
    week.week.mon = null;
    expect(newBlockRequest({ ...draft, weeks: '3' })?.weeks).toHaveLength(3);
    expect(newBlockRequest({ ...draft, weeks: '3' })?.weeks[0]?.week.mon).toBe('w1');
    week.week.mon = 'w1';
  });
  it('rejects invalid creation inputs and corrupt stored structure without clamping', () => {
    const draft = newBlockDraft(week, [workout], '2026-11-16');
    expect(isNewBlockDraft(draft)).toBe(true);
    for (const weeks of ['', '0', '-1', '2.5', '53', '1e1']) expect(newBlockRequest({ ...draft, weeks })).toBeNull();
    expect(newBlockRequest({ ...draft, start: 'not-a-date' })).toBeNull();
    expect(isNewBlockDraft({ ...draft, source: { ...draft.source, weeks: [] } })).toBe(false);
    expect(isNewBlockDraft({ ...draft, repeat: 'yes' })).toBe(false);
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
