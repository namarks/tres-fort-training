import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Slot, Workout } from '../src/model';
import { planWrites } from '../src/api';
import { EditorDraftStore, type DraftStorage } from '../src/editorDrafts';
import { groupDraftDocument, groupEditAnchor, groupEditDirty, groupEditOrder, groupEditProblems, groupEditRequest,
  groupSlotLabel, isGroupEditDraft, moveGroupDraftMember, newGroupEdit, reviewGroupEdit } from '../src/groupEditing';
import { GroupMembershipEditor } from '../src/GroupMembershipEditor';

const groupId = '00000000-0000-4000-8000-000000000001', otherGroup = '00000000-0000-4000-8000-000000000002';
function slot(id: string, order_index: number, group_id: string | null = null): Slot {
  return { id, workout_id: 'workout', exercise_id: `exercise-${id}`, exercise_name: id, exercise_unit: 'lb', exercise_muscle: 'legs',
    exercise_modality: 'barbell', exercise_laterality: 'bilateral', exercise_load_mode: 'total', exercise_demo_slug: null,
    order_index, group_id, group_rest_seconds: group_id ? 73 : null, group_transition_seconds: group_id ? 0 : null,
    target_sets: 3, target_reps: 5, target_reps_max: null, target_weight: 135, target_weight_unit: 'lb', target_duration_s: null,
    target_rpe: null, rest_seconds: 101 + order_index, cues: null, progression: null, run_steps: null, is_warmup: 0, created_at: 0, updated_at: 0 };
}
function workout(): Workout {
  return { id: 'workout', plan_id: 'plan', name: 'Strength', day_label: null, order_index: 0, notes: null,
    archived_at: null, created_at: 0, updated_at: 0, exercises: ['pre', 'early', 'a', 'b', 'c', 'x', 'y', 'late']
      .map((id, i) => slot(id, i, ['a', 'b', 'c'].includes(id) ? groupId : ['x', 'y'].includes(id) ? otherGroup : null)) };
}
afterEach(() => vi.unstubAllGlobals());

describe('reviewed group maintenance', () => {
  it('packs nonadjacent additions and a reorder at the original group anchor, preserving every other slot', () => {
    const original = workout(), before = structuredClone(original), draft = newGroupEdit(original, groupId)!;
    draft.members = ['c', 'early', 'a', 'late'];
    expect(groupEditAnchor(draft)).toBe(1);
    expect(groupEditOrder(draft).map(slot => slot.id)).toEqual(['pre', 'c', 'early', 'a', 'late', 'b', 'x', 'y']);
    expect(groupEditRequest(draft)).toEqual({ members: ['c', 'early', 'a', 'late'],
      values: { target_sets: 3, transition_rest: 0, round_rest: 73, order_index: 1 } });
    expect(original).toEqual(before);
    expect(groupEditOrder(draft).map(slot => [slot.id, slot.rest_seconds]).sort()).toEqual(original.exercises.map(slot => [slot.id, slot.rest_seconds]).sort());
  });

  it('retains an interior removed member immediately after the updated group', () => {
    const current = workout(); current.exercises = current.exercises.filter(slot => slot.id !== 'early');
    const draft = newGroupEdit(current, groupId)!; draft.members = ['a', 'c'];
    expect(groupEditAnchor(draft)).toBe(1);
    expect(groupEditOrder(draft).map(slot => slot.id)).toEqual(['pre', 'a', 'c', 'b', 'x', 'y', 'late']);
  });

  it('keeps exact zero/odd rests and incomplete timing text through scoped storage and explicit version review', () => {
    const original = workout(), draft = newGroupEdit(original, groupId)!;
    draft.members = ['c', 'a', 'late']; draft.timing = { rounds: '4e', roundRest: '91', transitionRest: '0' };
    const values = new Map<string, string>(), disk: DraftStorage = { getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
    const scope = { accountId: 'member', planId: 'plan', documentId: groupDraftDocument(original.id) };
    const store = new EditorDraftStore(() => disk, () => 'draft');
    const saved = store.write(scope, null, draft, 7);
    expect(new EditorDraftStore(() => disk).read(scope, isGroupEditDraft)).toEqual(saved);
    expect(store.read({ ...scope, accountId: 'other' }, isGroupEditDraft)).toBeNull();
    expect(store.read({ ...scope, planId: 'other' }, isGroupEditDraft)).toBeNull();
    const changed = structuredClone(original); changed.exercises[2]!.group_rest_seconds = 120;
    const reviewed = reviewGroupEdit(draft, changed)!;
    expect(reviewed.members).toEqual(draft.members); expect(reviewed.timing).toEqual(draft.timing);
    expect(reviewed.original[2]?.group_rest_seconds).toBe(120);
    expect(groupEditRequest(draft)).toBeNull();
    const valid = { ...reviewed, timing: { ...reviewed.timing, rounds: '4' } };
    expect(groupEditRequest(valid)?.values).toMatchObject({ target_sets: 4, round_rest: 91, transition_rest: 0 });
  });

  it('does not silently drop missing, replaced or regrouped selected members', () => {
    const original = workout(), draft = newGroupEdit(original, groupId)!;
    draft.members = ['a', 'c', 'late'];
    for (const change of ['missing', 'replaced', 'regrouped']) {
      const current = structuredClone(original);
      if (change === 'missing') current.exercises = current.exercises.filter(slot => slot.id !== 'c');
      if (change === 'replaced') current.exercises.find(slot => slot.id === 'a')!.exercise_id = 'new';
      if (change === 'regrouped') current.exercises.find(slot => slot.id === 'late')!.group_id = otherGroup;
      expect(groupEditProblems(draft, current).join(' ')).toMatch(/removed, replaced, or moved/);
      expect(reviewGroupEdit(draft, current)).toBeNull();
      expect(draft.members).toEqual(['a', 'c', 'late']);
    }
    expect(groupEditProblems(draft, { ...original, id: 'other' })).not.toEqual([]);
    expect(groupEditProblems(draft, { ...original, archived_at: 10 })).not.toEqual([]);
  });

  it('allows explicit removal of an unavailable selection before reviewing, retaining order and typed timing', () => {
    const original = workout(), draft = newGroupEdit(original, groupId)!;
    draft.members = ['c', 'a', 'late']; draft.timing = { rounds: '5', transitionRest: '0', roundRest: '87' };
    const current = structuredClone(original); current.exercises = current.exercises.filter(slot => slot.id !== 'c');
    expect(reviewGroupEdit(draft, current)).toBeNull();
    const repaired = { ...draft, members: draft.members.filter(id => id !== 'c') };
    expect(groupEditProblems(repaired, current)).toEqual([]);
    const reviewed = reviewGroupEdit(repaired, current)!;
    expect(reviewed.members).toEqual(['a', 'late']); expect(reviewed.timing).toEqual(draft.timing);
    expect(isGroupEditDraft(reviewed)).toBe(true);
    expect(groupEditRequest(reviewed)?.values).toMatchObject({ target_sets: 5, transition_rest: 0, round_rest: 87 });
  });

  it('keeps members and timing dirty until discarded or acknowledged and guards later drafts from old ACKs', () => {
    const draft = newGroupEdit(workout(), groupId)!;
    expect(groupEditDirty(draft)).toBe(false);
    const reordered = moveGroupDraftMember(draft, 'c', -1);
    expect(reordered.members).toEqual(['a', 'c', 'b']); expect(groupEditDirty(reordered)).toBe(true);
    expect(moveGroupDraftMember(draft, 'a', -1)).toBe(draft);
    const store = new EditorDraftStore(() => null, () => 'ack-draft');
    const scope = { accountId: 'member', planId: 'plan', documentId: groupDraftDocument('workout') };
    const submitted = store.write(scope, null, reordered, 7), newer = store.write(scope, submitted, { ...reordered, timing: { ...draft.timing, rounds: '5' } }, 7);
    expect(store.clear(scope, submitted)).toBe(false);
    expect(store.read(scope, isGroupEditDraft)).toEqual(newer);
    expect(store.clear(scope, newer)).toBe(true);
    expect(store.read(scope, isGroupEditDraft)).toBeNull();
  });

  it('requires at least two members and validates persisted identities without accepting slots from another group', () => {
    const draft = newGroupEdit(workout(), groupId)!;
    expect(isGroupEditDraft(draft)).toBe(true);
    expect(isGroupEditDraft({ ...draft, members: ['a', 'x'] })).toBe(false);
    expect(isGroupEditDraft({ ...draft, members: ['a', 'missing'] })).toBe(false);
    expect(isGroupEditDraft({ ...draft, members: ['a', 'a'] })).toBe(false);
    expect(groupEditRequest({ ...draft, members: ['a'] })).toBeNull();
    expect(newGroupEdit(workout(), 'missing')).toBeNull();
  });

  it('sends one group mutation with stable identity, reviewed account/version, selected order and packing anchor', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal('fetch', fetch);
    const draft = newGroupEdit(workout(), groupId)!; draft.members = ['c', 'early', 'a', 'late'];
    const request = groupEditRequest(draft)!;
    await planWrites.setGroup(draft.workoutId, draft.groupId, request.members, request.values, { accountId: 'member', planId: 'plan', version: 7 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![0]).toBe('/api/workouts/workout/groups');
    expect(fetch.mock.calls[0]![1].headers['x-tresfort-account']).toBe('member');
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ group_id: groupId, exercises: ['c', 'early', 'a', 'late'],
      target_sets: 3, round_rest: 73, transition_rest: 0, order_index: 1, expected_version: 7 });
  });

  it('shows the selected order, eligible standalone options and explicit stale review without offering another group’s slots', () => {
    const current = workout(), draft = newGroupEdit(current, groupId)!;
    const html = renderToStaticMarkup(createElement(GroupMembershipEditor, { draft, workout: current, busy: false, needsReview: true, problems: [],
      onChange: () => undefined, onReview: () => undefined, onSave: () => undefined, onUngroup: () => undefined, onCancel: () => undefined }));
    expect(html).toContain('Review draft with latest group'); expect(html).toContain('Current saved members');
    expect(html).toContain('Remove a from group'); expect(html).toContain('value="early"'); expect(html).toContain('value="late"');
    expect(html).not.toContain('<option value="x"'); expect(html).not.toContain('<option value="y"');
    expect(html).toContain('Workout order after saving'); expect(html).toContain('type="submit" disabled=""');
  });

  it('distinguishes repeated movement slots by reviewed position and warm-up status throughout the editor', () => {
    const current = workout();
    Object.assign(current.exercises[2]!, { exercise_name: 'Bench Press', is_warmup: 1, target_weight: 45 });
    Object.assign(current.exercises[7]!, { exercise_name: 'Bench Press', is_warmup: 0, target_weight: 135 });
    const draft = newGroupEdit(current, groupId)!;
    const warmup = 'Bench Press · workout exercise 3 · warm-up', working = 'Bench Press · workout exercise 8 · working';
    expect(groupSlotLabel(draft.original, draft.original[2]!)).toBe(warmup);
    expect(groupSlotLabel(draft.original, draft.original[7]!)).toBe(working);
    const html = renderToStaticMarkup(createElement(GroupMembershipEditor, { draft, workout: current, busy: false, needsReview: true, problems: [],
      onChange: () => undefined, onReview: () => undefined, onSave: () => undefined, onUngroup: () => undefined, onCancel: () => undefined }));
    expect(html).toContain(`aria-label="Remove ${warmup} from group"`);
    expect(html).toContain(`aria-label="Move ${warmup} down in draft"`);
    expect(html).toContain(`<option value="late">${working}</option>`);
    expect(html).toContain(`<strong>Current saved members:</strong> ${warmup}`);
    expect(html).toContain(`<strong>Your proposed members:</strong> ${warmup}`);
    expect(html).toContain(`<li>${working}</li>`);
    const changed = { ...draft, members: ['late', 'c', 'a'] };
    expect(groupEditRequest(changed)?.members).toEqual(['late', 'c', 'a']);
    expect(groupSlotLabel(changed.original, changed.original[2]!)).toBe(warmup);
  });
});
