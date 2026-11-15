import { groupDraft, groupValues, sameSlotIdentity, type GroupDraft } from './editing';
import { orderedSlots, type Slot, type Workout } from './model';

export const groupDraftDocument = (workoutId: string) => `workout-group:${workoutId}`;
export interface GroupEditDraft {
  workoutId: string;
  groupId: string;
  original: Slot[];
  members: string[];
  timing: GroupDraft;
}

/** Repeated movements remain identifiable by the slot's reviewed workout position. */
export function groupSlotLabel(slots: readonly Slot[], slot: Slot): string {
  if (slots.filter(candidate => candidate.exercise_name === slot.exercise_name).length < 2) return slot.exercise_name;
  const position = [...slots].sort((a, b) => a.order_index - b.order_index).findIndex(candidate => candidate.id === slot.id) + 1;
  return `${slot.exercise_name} · workout exercise ${position} · ${slot.is_warmup ? 'warm-up' : 'working'}`;
}

export function newGroupEdit(workout: Workout, groupId: string): GroupEditDraft | null {
  const original = orderedSlots(workout).map(slot => ({ ...slot }));
  const members = original.filter(slot => slot.group_id === groupId);
  return members.length < 2 ? null : { workoutId: workout.id, groupId, original,
    members: members.map(slot => slot.id), timing: groupDraft(members) };
}

export function isGroupEditDraft(value: unknown): value is GroupEditDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as GroupEditDraft;
  if (typeof draft.workoutId !== 'string' || typeof draft.groupId !== 'string' || !Array.isArray(draft.original)
      || !draft.original.length || !Array.isArray(draft.members) || new Set(draft.members).size !== draft.members.length
      || !draft.timing || !['rounds', 'roundRest', 'transitionRest'].every(key => typeof draft.timing[key as keyof GroupDraft] === 'string')) return false;
  if (!draft.original.every(slot => !!slot && ['id', 'exercise_id', 'exercise_name', 'exercise_modality', 'exercise_laterality', 'exercise_load_mode']
    .every(key => typeof slot[key as keyof Slot] === 'string') && slot.workout_id === draft.workoutId
    && Number.isSafeInteger(slot.order_index) && slot.order_index >= 0
    && Number.isSafeInteger(slot.target_sets) && Number.isSafeInteger(slot.rest_seconds))) return false;
  return new Set(draft.original.map(slot => slot.id)).size === draft.original.length
    && draft.original.filter(slot => slot.group_id === draft.groupId).length >= 2
    && draft.members.every(id => typeof id === 'string' && draft.original.some(slot => slot.id === id && (!slot.group_id || slot.group_id === draft.groupId)));
}

/** Missing/replaced/moved members are never silently removed from the proposal. */
export function groupEditProblems(draft: GroupEditDraft, workout: Workout): string[] {
  if (workout.id !== draft.workoutId || workout.archived_at) return ['This workout is no longer available for group editing. Your draft is kept.'];
  const problems: string[] = [];
  if (workout.exercises.filter(slot => slot.group_id === draft.groupId).length < 2) problems.push('This group was removed or ungrouped. Discard this draft before editing another group.');
  const checked = draft.original.filter(slot => draft.members.includes(slot.id));
  for (const original of checked) {
    const current = workout.exercises.find(slot => slot.id === original.id);
    if (!sameSlotIdentity(original, current)) problems.push(`${groupSlotLabel(draft.original, original)} was removed, replaced, or moved to another group. Your selected members have not been changed.`);
  }
  return problems;
}

export function groupEditDirty(draft: GroupEditDraft): boolean {
  const members = draft.original.filter(slot => slot.group_id === draft.groupId);
  return JSON.stringify(draft.members) !== JSON.stringify(members.map(slot => slot.id))
    || JSON.stringify(draft.timing) !== JSON.stringify(groupDraft(members));
}

/** Adopt current placement only after the member explicitly reviews it. */
export function reviewGroupEdit(draft: GroupEditDraft, workout: Workout): GroupEditDraft | null {
  return groupEditProblems(draft, workout).length ? null : { ...draft, original: orderedSlots(workout).map(slot => ({ ...slot })) };
}

export function groupEditAnchor(draft: GroupEditDraft): number {
  const first = draft.original.findIndex(slot => slot.group_id === draft.groupId);
  return draft.original.slice(0, first).filter(slot => !draft.members.includes(slot.id)).length;
}

/** This matches the service's one atomic packing operation, including retained old members. */
export function groupEditOrder(draft: GroupEditDraft): Slot[] {
  const selected = draft.members.map(id => draft.original.find(slot => slot.id === id)!);
  const others = draft.original.filter(slot => !draft.members.includes(slot.id));
  const anchor = groupEditAnchor(draft);
  return [...others.slice(0, anchor), ...selected, ...others.slice(anchor)];
}

export function groupEditRequest(draft: GroupEditDraft) {
  const parsed = groupValues(draft.timing);
  if (!parsed.ok || draft.members.length < 2) return null;
  return { members: [...draft.members], values: { ...parsed.values, order_index: groupEditAnchor(draft) } };
}

export function moveGroupDraftMember(draft: GroupEditDraft, id: string, direction: -1 | 1): GroupEditDraft {
  const index = draft.members.indexOf(id), next = index + direction;
  if (index < 0 || next < 0 || next >= draft.members.length) return draft;
  const members = [...draft.members]; [members[index], members[next]] = [members[next]!, members[index]!];
  return { ...draft, members };
}
