import { useEffect, useId, useRef } from 'react';
import { groupDraft, groupValues, sameSlotIdentity, type GroupDraft } from './editing';
import { groupEditOrder, groupSlotLabel, moveGroupDraftMember, type GroupEditDraft } from './groupEditing';
import type { Workout } from './model';

export function GroupMembershipEditor({ draft, workout, busy, needsReview, problems, onChange, onReview, onSave, onUngroup, onCancel }: {
  draft: GroupEditDraft; workout: Workout; busy: boolean; needsReview: boolean; problems: string[];
  onChange: (draft: GroupEditDraft) => void; onReview: () => void; onSave: () => void; onUngroup: () => void; onCancel: () => void;
}) {
  const id = useId(), heading = useRef<HTMLHeadingElement>(null);
  const memberList = useRef<HTMLOListElement>(null), addControl = useRef<HTMLSelectElement>(null);
  const removalFocus = useRef<{ member: string | null } | null>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'nearest' }); }, []);
  useEffect(() => {
    if (!removalFocus.current) return;
    const member = removalFocus.current.member; removalFocus.current = null;
    const row = [...(memberList.current?.querySelectorAll<HTMLLIElement>('[data-group-member]') ?? [])]
      .find(row => row.dataset.groupMember === member);
    const target = row?.querySelector<HTMLButtonElement>('[data-remove-member]') ?? addControl.current ?? heading.current;
    target?.focus();
  }, [draft.members]);
  const timing = groupValues(draft.timing), blocked = busy || needsReview || problems.length > 0;
  const currentMembers = workout.exercises.filter(slot => slot.group_id === draft.groupId).sort((a, b) => a.order_index - b.order_index);
  const savedTiming = currentMembers.length ? groupDraft(currentMembers) : null;
  const eligible = draft.original.filter(slot => !draft.members.includes(slot.id)
    && sameSlotIdentity(slot, workout.exercises.find(current => current.id === slot.id)));
  const available = eligible.filter(slot => !slot.group_id);
  const removed = eligible.filter(slot => slot.group_id === draft.groupId);
  const field = (key: keyof GroupDraft, label: string) => <label className="field small-field" htmlFor={`${id}-${key}`}>{label}
    <input id={`${id}-${key}`} inputMode="numeric" disabled={busy} value={draft.timing[key]}
      onChange={event => onChange({ ...draft, timing: { ...draft.timing, [key]: event.target.value } })} /></label>;
  return <section className="retained-group" aria-label="Retained group draft">
    <form className="panel group-form group-membership" onSubmit={event => { event.preventDefault(); if (!blocked) onSave(); }} noValidate>
      <h3 ref={heading} tabIndex={-1}>Edit group</h3>
      <p>Choose the exercises and their order for each round. Removing a member keeps its exercise in the workout.</p>
      {problems.length > 0 && <ul role="alert" className="problem">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
      {problems.length > 0 && <p>Remove any unavailable member from your selection to review the remaining draft, or Cancel to discard it.</p>}
      {needsReview && <div className="panel" role="alert">
        <p>Your plan changed. Your member order, rounds and rests are kept. Review the current saved group before saving again.</p>
        <p><strong>Current saved members:</strong> {currentMembers.map(slot => groupSlotLabel(workout.exercises, slot)).join(' → ') || 'Group unavailable'}</p>
        {savedTiming && <p><strong>Current saved timing:</strong> {savedTiming.rounds} rounds · {savedTiming.transitionRest}s between exercises · {savedTiming.roundRest}s after each round</p>}
        <p><strong>Your proposed members:</strong> {draft.members.map(member => groupSlotLabel(draft.original, draft.original.find(slot => slot.id === member)!)).join(' → ') || 'None selected'}</p>
        <button type="button" className="ghost" disabled={busy || problems.length > 0} onClick={onReview}>Review draft with latest group</button>
      </div>}
      <ol ref={memberList} className="member-order editable-members" aria-label="Selected group members">
        {draft.members.map((member, index) => {
          const slot = draft.original.find(row => row.id === member)!;
          const label = groupSlotLabel(draft.original, slot);
          return <li key={member} data-group-member={member}><span>{label}</span><div className="row-actions">
            <button type="button" className="icon" aria-label={`Move ${label} up in draft`} disabled={busy || index === 0}
              onClick={() => onChange(moveGroupDraftMember(draft, member, -1))}>↑</button>
            <button type="button" className="icon" aria-label={`Move ${label} down in draft`} disabled={busy || index === draft.members.length - 1}
              onClick={() => onChange(moveGroupDraftMember(draft, member, 1))}>↓</button>
            <button type="button" className="ghost" data-remove-member disabled={busy} onClick={() => {
              removalFocus.current = { member: draft.members[index + 1] ?? draft.members[index - 1] ?? null };
              onChange({ ...draft, members: draft.members.filter(id => id !== member) });
            }}
              aria-label={`Remove ${label} from group`}>Remove from group</button>
          </div></li>;
        })}
      </ol>
      {draft.members.length < 2 && <p role="alert">A group needs at least two exercises. Add a member or use Ungroup to keep every exercise as a standalone slot.</p>}
      {(available.length > 0 || removed.length > 0) && <label className="field">Add a workout exercise
        <select ref={addControl} aria-label="Add a workout exercise" value="" disabled={busy} onChange={event => {
          if (event.target.value) onChange({ ...draft, members: [...draft.members, event.target.value] });
        }}><option value="">Choose an exercise</option>{[...removed, ...available].map(slot => <option key={slot.id} value={slot.id}>{groupSlotLabel(draft.original, slot)}</option>)}</select>
      </label>}
      <p className="fine">Exercises in another group are not available here. Add new exercises to the workout first.</p>
      <div className="field-row">{field('rounds', 'Rounds')}{field('transitionRest', 'Rest between exercises, seconds')}{field('roundRest', 'Rest after each round, seconds')}</div>
      {!timing.ok && <ul role="alert" className="problem">{timing.errors.map(error => <li key={error}>{error}</li>)}</ul>}
      <details className="group-order-preview" open><summary>Workout order after saving</summary>
        <ol>{groupEditOrder(draft).map(slot => <li key={slot.id}>{groupSlotLabel(draft.original, slot)}{draft.members.includes(slot.id) ? ' · in this group' : ''}</li>)}</ol>
      </details>
      <p className="fine">The group stays at its original position. Removed members follow it as standalone exercises. Every exercise’s own rest stays saved; rounds and group rests apply to the selected members.</p>
      <div className="form-actions">
        <button type="submit" disabled={blocked || !timing.ok || draft.members.length < 2}>{busy ? 'Saving…' : 'Save group'}</button>
        <button type="button" className="ghost" disabled={blocked} onClick={onUngroup}>Ungroup</button>
        <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  </section>;
}
