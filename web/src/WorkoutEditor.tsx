import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { planWrites, type Reviewed } from './api';
import {
  draftFromSlot,
  factsOfCatalog,
  factsOfSlot,
  groupDraft,
  groupKind,
  groupMoveDestination,
  groupValues,
  isRun,
  moveDestination,
  newDraft,
  prescriptionFields,
  reorderedMembers,
  replacementDraft,
  replacementFields,
  sameSlotIdentity,
  slotDraftComparison,
  isSlotDraft,
  searchCatalog,
  selectedMembers,
  storedGroupValues,
  tagsOf,
  workoutMoveDestination,
  type CatalogExercise,
  type ExerciseFacts,
  type GroupDraft,
  type GroupValues,
  type SlotDraft,
  type WeightUnit,
} from './editing';
import { describeGroup, describeRunSteps, describeSlot, slotBlocks, type Slot, type SlotBlock, type Workout } from './model';
import { RunPlanEditor } from './RunPlanEditor';
import { SlotFields } from './SlotFields';
import { GuidedWorkoutCreator } from './GuidedWorkoutCreator';
import { readPendingCreation, savePendingCreation } from './guidedWorkout';
import { useEditorDraft } from './useEditorDraft';
import { editorDraftStore } from './editorDrafts';
import { groupDraftDocument, groupEditDirty, groupEditProblems, groupEditRequest, isGroupEditDraft, newGroupEdit, reviewGroupEdit, type GroupEditDraft } from './groupEditing';
import { GroupMembershipEditor } from './GroupMembershipEditor';
import { detailsDocument, isWorkoutDetailsDraft, newWorkoutDetailsDraft, workoutDetails, workoutDetailsRequest, type WorkoutDetails, type WorkoutDetailsDraft } from './programmingDrafts';

/** Runs one plan write against the version on screen; true when it saved. */
export type Write = (action: (at: Reviewed) => Promise<unknown>) => Promise<boolean>;

export type Catalog =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; exercises: CatalogExercise[] };

const UNIT_KEY = 'tresfort.weightUnit';

/** The unit a new slot starts in: the member's last choice, else their region's. */
function preferredUnit(miles: boolean): WeightUnit {
  try {
    const saved = localStorage.getItem(UNIT_KEY);
    if (saved === 'lb' || saved === 'kg') return saved;
  } catch {
    // Storage can be unavailable (private windows); fall through.
  }
  return miles ? 'lb' : 'kg';
}

function rememberUnit(unit: WeightUnit) {
  try {
    localStorage.setItem(UNIT_KEY, unit);
  } catch {
    // Not remembering is fine.
  }
}

export function WorkoutsPage(props: {
  workouts: Workout[];
  planId: string | null;
  accountId: string;
  reload: () => Promise<void>;
  onSignedOut: (error?: unknown) => void;
  onSchedule?: (workoutId: string) => void;
  /** The live plan version; retained drafts require explicit review after it changes. */
  version: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  write: Write;
  busy: boolean;
  catalog: Catalog;
  miles: boolean;
}) {
  const { workouts, version, selectedId, onSelect, write, busy, catalog, miles, planId, accountId, reload, onSignedOut, onSchedule } = props;
  const [showArchived, setShowArchived] = useState(false);
  // A one-time workout (made for one date, workout-library P3) is not part
  // of the library; it opens from its date.
  const library = workouts.filter((workout) => !workout.one_time_date);
  const active = library.filter((workout) => !workout.archived_at);
  const archived = library.filter((workout) => workout.archived_at);
  const listed = showArchived ? archived : active;
  const selected = workouts.find((workout) => workout.id === selectedId) ?? null;
  const selectWorkout = (id: string | null) => {
    if (id !== selectedId && selectedId && planId) {
      const group = editorDraftStore.read({ accountId, planId, documentId: groupDraftDocument(selectedId) }, isGroupEditDraft);
      if (group && group !== 'unreadable' && group.dirty && !window.confirm('Keep this unfinished group edit and switch workouts?')) return;
    }
    onSelect(id);
  };
  // Only a confirmed write AND the exact refreshed row retire its receipt.
  // An ACK followed by a failed refresh keeps the recovery screen available.
  useEffect(() => {
    try {
      const pending = readPendingCreation(sessionStorage, accountId);
      if (pending && pending !== 'unreadable' && pending.status === 'saved'
          && workouts.some(workout => workout.id === pending.request.workout_id)) {
        savePendingCreation(sessionStorage, accountId, null);
      }
    } catch { /* The creator also retains the pending request in memory. */ }
  }, [accountId, workouts]);
  const move = (workout: Workout, to: number) =>
    write((at) => planWrites.updateWorkout(workout.id, { order_index: to }, at));

  return (
    <main className="workouts">
      <nav className="workout-list" aria-labelledby="workouts-title">
        <h1 id="workouts-title">Workouts</h1>
        <button type="button" className="ghost" disabled={busy} onClick={() => selectWorkout(null)}>New workout</button>
        <ul>
          {listed.map((workout) => {
            const up = showArchived ? null : workoutMoveDestination(workouts, workout.id, -1);
            const down = showArchived ? null : workoutMoveDestination(workouts, workout.id, 1);
            return (
              <li key={workout.id}>
                <button
                  type="button"
                  className="workout-link"
                  aria-current={workout.id === selectedId ? 'page' : undefined}
                  onClick={() => selectWorkout(workout.id)}
                >
                  <span>{workout.name}</span>
                  <span className="muted">{exerciseCount(workout)}</span>
                </button>
                {!showArchived && active.length > 1 && (
                  <span className="order-actions">
                    <button type="button" className="icon" disabled={busy || up === null} onClick={() => up !== null && move(workout, up)} aria-label={`Move ${workout.name} up`}>↑</button>
                    <button type="button" className="icon" disabled={busy || down === null} onClick={() => down !== null && move(workout, down)} aria-label={`Move ${workout.name} down`}>↓</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {listed.length === 0 && (
          <p className="muted">{showArchived ? 'No archived workouts.' : 'No workouts yet. Choose a starting point to create one.'}</p>
        )}
        {(archived.length > 0 || showArchived) && (
          <button type="button" className="ghost small" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Show workouts' : `Show archived (${archived.length})`}
          </button>
        )}
      </nav>
      <section className="editor" aria-live="polite">
        {selected ? (
          <WorkoutEditor key={`${accountId}:${planId}:${selected.id}`} accountId={accountId} planId={planId!} workout={selected} version={version} write={write} busy={busy} catalog={catalog} miles={miles} onRemoved={() => onSelect(null)} onSchedule={onSchedule} />
        ) : (
          <GuidedWorkoutCreator key={accountId} accountId={accountId} planId={planId} version={version} catalog={catalog} unit={preferredUnit(miles)}
            busy={busy} workouts={workouts} reload={reload} onSelect={onSelect} onSignedOut={onSignedOut}
            customForm={<NewWorkoutForm write={write} busy={busy} onCreated={onSelect} />} />
        )}
      </section>
    </main>
  );
}

function exerciseCount(workout: Workout): string {
  const count = workout.exercises.length;
  return count === 1 ? '1 exercise' : `${count} exercises`;
}

function NewWorkoutForm({ write, busy, onCreated }: { write: Write; busy: boolean; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const inputId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    let created: string | null = null;
    const saved = await write(async (at) => {
      created = (await planWrites.addWorkout(trimmed, at)).id;
    });
    if (saved && created) {
      setName('');
      onCreated(created);
    }
  }

  return (
    <form className="new-workout" onSubmit={submit}>
      <label htmlFor={inputId}>New workout</label>
      <div className="inline-fields">
        <input id={inputId} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Upper body" maxLength={80} />
        <button type="submit" disabled={busy || !name.trim()}>Add</button>
      </div>
    </form>
  );
}

type Panel =
  | { kind: 'details' }
  | { kind: 'archive' }
  | { kind: 'delete' }
  | { kind: 'add'; warmup: boolean; exercise: CatalogExercise | null }
  | { kind: 'edit'; slotId: string }
  | { kind: 'run'; slotId: string }
  | { kind: 'replace'; slotId: string }
  | { kind: 'remove'; slotId: string }
  /** A new group (from selected exercises) or an existing one. */
  | { kind: 'group'; groupId: string; members: Slot[]; existing: boolean };

interface SlotEditDraft { kind: 'edit' | 'replace'; slot: Slot; draft: SlotDraft; replacement: CatalogExercise | null }
function isSlotEditDraft(value: unknown): value is SlotEditDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as SlotEditDraft, s = d.slot, e = d.replacement;
  return ['edit', 'replace'].includes(d.kind) && isSlotDraft(d.draft) && !!s
    && ['id', 'workout_id', 'exercise_id', 'exercise_name', 'exercise_modality', 'exercise_laterality', 'exercise_load_mode'].every(k => typeof s[k as keyof Slot] === 'string')
    && ['target_sets', 'target_reps', 'rest_seconds'].every(k => typeof s[k as keyof Slot] === 'number')
    && (e === null || ['id', 'name', 'modality', 'laterality', 'load_mode'].every(k => typeof e[k as keyof CatalogExercise] === 'string'));
}

function WorkoutEditor(props: {
  accountId: string;
  planId: string;
  workout: Workout;
  version: number;
  write: Write;
  busy: boolean;
  catalog: Catalog;
  miles: boolean;
  onRemoved: () => void;
  onSchedule?: (workoutId: string) => void;
}) {
  const { accountId, planId, workout, version, write, busy, catalog, miles, onRemoved, onSchedule } = props;
  const retained = useEditorDraft<SlotEditDraft>({ accountId, planId, documentId: `workout:${workout.id}` }, isSlotEditDraft);
  const groupRetained = useEditorDraft<GroupEditDraft>({ accountId, planId, documentId: groupDraftDocument(workout.id) }, isGroupEditDraft);
  const detailsRetained = useEditorDraft<WorkoutDetailsDraft>({ accountId, planId, documentId: detailsDocument(workout.id) }, isWorkoutDetailsDraft);
  const detailsPending = detailsRetained.record?.value;
  const detailsNeedsReview = !!detailsRetained.record && detailsRetained.record.version !== version;
  const detailsIdentityMatches = !detailsPending || (detailsPending.workoutId === workout.id && detailsPending.archived === !!workout.archived_at);
  const groupPending = groupRetained.record?.value;
  const groupNeedsReview = !!groupRetained.record && groupRetained.record.version !== version;
  const groupProblems = groupPending ? groupEditProblems(groupPending, workout) : [];
  const pending = retained.record?.value;
  const liveSlot = pending ? workout.exercises.find(slot => slot.id === pending.slot.id) : undefined;
  const identityMatches = !pending || (!workout.archived_at && sameSlotIdentity(pending.slot, liveSlot));
  const needsReview = !!retained.record && retained.record.version !== version;
  const [panel, setPanel] = useState<Panel | null>(null);
  // Choosing exercises to group: the ids ticked so far, or null when not choosing.
  const [choosing, setChoosing] = useState<ReadonlySet<string> | null>(null);
  // Non-draft actions still reset; target edits keep their captured version.
  useEffect(() => { setPanel(null); setChoosing(null); }, [version]);
  const blocks = useMemo(() => slotBlocks(workout), [workout]);
  const archived = !!workout.archived_at;
  const tags = tagsOf(workout);
  const close = () => {
    if (detailsRetained.record?.dirty && !window.confirm('Discard this unfinished workout-details edit?')) return;
    if (groupRetained.record?.dirty && !window.confirm('Discard this unfinished group edit?')) return;
    if (retained.record?.dirty && !window.confirm('Discard this unfinished target edit?')) return;
    retained.clear(); groupRetained.clear(); detailsRetained.clear(); setPanel(null);
  };
  const open = (next: Panel) => {
    if (retained.unreadable || groupRetained.unreadable || detailsRetained.unreadable) return;
    if (detailsRetained.record?.dirty && !window.confirm('Discard the current workout-details edit and open another action?')) return;
    if (groupRetained.record?.dirty && !window.confirm('Discard the current group edit and open another action?')) return;
    if (retained.record?.dirty && !window.confirm('Discard the current target edit and open another action?')) return;
    retained.clear(); groupRetained.clear(); detailsRetained.clear();
    if (next.kind === 'details') {
      detailsRetained.save(newWorkoutDetailsDraft(workout), version, false); setPanel(null);
    } else if (next.kind === 'group' && next.existing) {
      const draft = newGroupEdit(workout, next.groupId);
      if (draft) groupRetained.save(draft, version, false);
      setPanel(null);
    } else if (next.kind === 'edit' || next.kind === 'replace') {
      const slot = workout.exercises.find(s => s.id === next.slotId);
      if (slot) retained.save({ kind: next.kind, slot, draft: draftFromSlot(slot), replacement: null }, version, false);
      setPanel(null);
    } else setPanel(next);
  };
  const chosen = choosing ? selectedMembers(workout, choosing) : null;
  // Two single exercises next to each other can start a superset.
  const canGroup = blocks.some((block, index) => !block.group && blocks[index + 1] && !blocks[index + 1]!.group);
  const listRef = useRef<HTMLOListElement>(null);
  const isChoosing = choosing !== null;
  // Keyboard users start choosing at the first exercise that can be grouped.
  useEffect(() => {
    if (isChoosing) listRef.current?.querySelector<HTMLInputElement>('input[type=checkbox]')?.focus();
  }, [isChoosing]);
  const startChoosing = () => {
    if (detailsRetained.record?.dirty && !window.confirm('Discard the current workout-details edit?')) return;
    if (groupRetained.record?.dirty && !window.confirm('Discard the current group edit?')) return;
    if (retained.record?.dirty && !window.confirm('Discard the current target edit?')) return;
    retained.clear(); groupRetained.clear(); detailsRetained.clear(); setPanel(null);
    setChoosing(new Set());
  };
  const toggle = (slotId: string, on: boolean) => setChoosing((current) => {
    const next = new Set(current ?? []);
    if (on) next.add(slotId);
    else next.delete(slotId);
    return next;
  });

  async function run(action: (at: Reviewed) => Promise<unknown>, after?: () => void) {
    if (await write(action)) {
      setPanel(null);
      after?.();
    }
  }

  const slotPanel = (slot: Slot): ReactNode => {
    if (!panel || !('slotId' in panel) || panel.slotId !== slot.id) return null;
    if (panel.kind === 'run') {
      return (
        <RunPlanEditor
          slot={slot}
          miles={miles}
          busy={busy}
          onCancel={close}
          onSave={(steps) => run((at) => planWrites.updateSlot(workout.id, slot.id, { run_steps: steps }, at))}
        />
      );
    }
    return (
      <Confirm
        busy={busy}
        action="Remove exercise"
        onCancel={close}
        onConfirm={() => run((at) => planWrites.removeSlot(workout.id, slot.id, at))}
      >
        Remove {slot.exercise_name} from this workout? Sets you already logged stay in your history.
        {slot.group_id ? ' If one exercise is left in its group, it becomes a single exercise again.' : ''}
      </Confirm>
    );
  };

  const single = (slot: Slot) => (
    <SlotRow
      key={slot.id}
      slot={slot}
      miles={miles}
      busy={busy || !!groupPending}
      archived={archived}
      move={(direction) => {
        const to = moveDestination(workout, slot.id, direction);
        return to === null ? null : () => run((at) => planWrites.updateSlot(workout.id, slot.id, { order_index: to }, at));
      }}
      onOpen={(kind) => open({ kind, slotId: slot.id })}
      choose={choosing ? { checked: choosing.has(slot.id), onChange: (on) => toggle(slot.id, on) } : undefined}
      panel={slotPanel(slot)}
    />
  );

  // A group member moves within its group; the group's rounds and rests stay.
  const member = (slot: Slot, block: SlotBlock) => (
    <SlotRow
      key={slot.id}
      slot={slot}
      miles={miles}
      busy={busy || !!choosing || !!groupPending}
      archived={archived}
      moveLabel="within its group"
      move={(direction) => {
        const members = reorderedMembers(block.members, slot.id, direction);
        return members === null ? null : () => run((at) => planWrites.setGroup(
          workout.id, slot.group_id!, members, storedGroupValues(block.members), at,
        ));
      }}
      onOpen={(kind) => open({ kind, slotId: slot.id })}
      panel={slotPanel(slot)}
    />
  );

  const groupBlock = (block: SlotBlock) => {
    const group = block.group!;
    const groupId = block.members[0]!.group_id!;
    const memberIds = block.members.map((slot) => slot.id);
    const up = groupMoveDestination(workout, groupId, -1);
    const down = groupMoveDestination(workout, groupId, 1);
    const moveGroup = (to: number) => run((at) => planWrites.setGroup(
      workout.id, groupId, memberIds, { ...storedGroupValues(block.members), order_index: to }, at,
    ));
    return (
      <li key={groupId} className="group-block">
        <div className="group-head">
          <div>
            <strong>{group.title}</strong>
            <span className="muted">{describeGroup(group)}</span>
          </div>
          {!archived && (
            <div className="row-actions">
              <button type="button" className="icon" disabled={busy || !!choosing || !!groupPending || up === null} onClick={() => up !== null && moveGroup(up)} aria-label={`Move ${group.title} up`}>↑</button>
              <button type="button" className="icon" disabled={busy || !!choosing || !!groupPending || down === null} onClick={() => down !== null && moveGroup(down)} aria-label={`Move ${group.title} down`}>↓</button>
              <button type="button" className="ghost small" disabled={busy || !!choosing}
                onClick={() => open({ kind: 'group', groupId, members: block.members, existing: true })}
                aria-label={`Edit ${group.title}`}>Edit group</button>
            </div>
          )}
        </div>
        <ol className="slots">{block.members.map((slot) => member(slot, block))}</ol>
      </li>
    );
  };

  return (
    <article className="workout-editor" aria-labelledby="workout-title">
      <header className="editor-head">
        <div>
          <h2 id="workout-title">{workout.name}</h2>
          <p className="muted">
            {workout.one_time_date ? `Edits apply only to ${workout.one_time_date}. Your saved workout and other dates stay unchanged.`
              : archived ? 'Archived. Restore it to use it in your routine again.' : 'Edits apply to this saved workout whenever you use it. Completed workouts stay as they were.'}
          </p>
          {tags.length > 0 && <p className="tags">{tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}</p>}
          {workout.notes && <p className="muted">{workout.notes}</p>}
        </div>
        <div className="head-actions">
          {!archived && !workout.one_time_date && onSchedule && <button type="button" className="primary" disabled={busy} onClick={() => onSchedule(workout.id)}>Add to your week</button>}
          <button type="button" className="ghost" disabled={busy} onClick={() => open({ kind: 'details' })}>Rename and tags</button>
          {archived ? (
            <button type="button" className="ghost" disabled={busy} onClick={() => run((at) => planWrites.updateWorkout(workout.id, { archived_at: null }, at))}>Restore</button>
          ) : (
            <button type="button" className="ghost" disabled={busy} onClick={() => open({ kind: 'archive' })}>Archive</button>
          )}
          <button type="button" className="ghost danger" disabled={busy} onClick={() => open({ kind: 'delete' })}>Delete</button>
        </div>
      </header>

      {retained.unreadable && <div className="panel" role="alert">
        <p>This browser's saved edit could not be read. No change has been sent.</p>
        <button type="button" className="ghost" onClick={() => retained.clear()}>Discard unreadable draft</button>
      </div>}
      {groupRetained.unreadable && <div className="panel" role="alert">
        <p>This browser’s saved group edit could not be read. No group change has been sent.</p>
        <button type="button" className="ghost" onClick={() => groupRetained.clear()}>Discard unreadable group draft</button>
      </div>}
      {groupPending && <GroupMembershipEditor key={groupRetained.record!.id} draft={groupPending} workout={workout}
        busy={busy} needsReview={groupNeedsReview} problems={groupProblems} onCancel={close}
        onChange={draft => groupRetained.save(draft, groupRetained.record!.version, groupEditDirty(draft))}
        onReview={() => {
          const reviewed = reviewGroupEdit(groupPending, workout);
          if (reviewed) groupRetained.save(reviewed, version, groupEditDirty(reviewed));
        }}
        onSave={async () => {
          const captured = groupRetained.record, request = groupEditRequest(groupPending);
          if (!captured || captured.version !== version || groupProblems.length || !request) return;
          await write(async at => {
            if (at.planId !== planId || at.accountId !== accountId || at.version !== captured.version) throw new Error('draft_version_changed');
            await planWrites.setGroup(workout.id, groupPending.groupId, request.members, request.values, at);
            groupRetained.clear(captured);
          });
        }}
        onUngroup={async () => {
          const captured = groupRetained.record;
          if (!captured || captured.version !== version || groupProblems.length) return;
          await write(async at => {
            if (at.planId !== planId || at.accountId !== accountId || at.version !== captured.version) throw new Error('draft_version_changed');
            await planWrites.clearGroup(workout.id, groupPending.groupId, at);
            groupRetained.clear(captured);
          });
        }} />}
      {pending && <section key={retained.record!.id} className="retained-targets" aria-label="Retained target draft">
        <h3>{pending.kind === 'replace' ? 'Replace' : 'Edit'} {pending.slot.exercise_name}</h3>
        {!identityMatches && <p role="alert" className="problem">{workout.archived_at ? 'This workout is archived. Restore it before reviewing or saving this draft.' : 'This exercise was removed, replaced, or regrouped. Your draft is kept below, but cannot be applied to a different exercise. Copy any values you need, then discard it.'}</p>}
        {needsReview && identityMatches && <div className="panel" role="alert">
          <p>Your plan changed. Your proposed targets are kept below. Review them against the current saved targets before continuing.</p>
          <div className="block-grid-wrap"><table><thead><tr><th>Target</th><th>Current saved</th><th>Your draft</th></tr></thead>
            <tbody>{slotDraftComparison(liveSlot!, pending.draft, pending.replacement ? factsOfCatalog(pending.replacement) : undefined).map(row =>
              <tr key={row.label}><th scope="row">{row.label}</th><td>{row.current}</td><td>{row.proposed}</td></tr>)}</tbody></table></div>
          <button type="button" className="ghost" disabled={busy} onClick={() => retained.save({ ...pending, slot: liveSlot!, draft: liveSlot!.group_id ? { ...pending.draft, sets: String(liveSlot!.target_sets), rest: String(liveSlot!.rest_seconds) } : pending.draft }, version, retained.record!.dirty)}>Use draft with latest targets</button>
        </div>}
        {pending.kind === 'replace' && !pending.replacement ? <ExercisePicker
          title={`Choose replacement for ${pending.slot.exercise_name}`} catalog={catalog} exclude={pending.slot.exercise_id}
          busy={busy || needsReview || !identityMatches} onCancel={close}
          onPick={exercise => retained.save({ ...pending, replacement: exercise, draft: replacementDraft(pending.slot, exercise) }, retained.record!.version)}
        /> : <>
          {pending.replacement && <div className="panel">
            <p><strong>From:</strong> {pending.slot.exercise_name} · {describeSlot(pending.slot)}</p>
            <p><strong>To:</strong> {pending.replacement.name}{pending.replacement.load_mode === 'per_hand' ? ' · weight for each hand' : ' · total weight'}</p>
            <p className="muted">Review every target before saving. A change in how weight is measured clears the weight for you to choose.</p>
            <p className="muted">Week-specific targets for this exercise reset to these saved targets. Group rounds stay unchanged. Logged sets keep their original exercise.</p>
          </div>}
          <SlotForm facts={pending.replacement ? factsOfCatalog(pending.replacement) : factsOfSlot(pending.slot)}
            initial={pending.draft} value={pending.draft} editing={pending.slot}
            onChange={draft => retained.save({ ...pending, draft }, retained.record!.version,
              !!pending.replacement || JSON.stringify(draft) !== JSON.stringify(draftFromSlot(pending.slot)))}
            replacement={pending.replacement ?? undefined}
            busy={busy} blocked={needsReview || !identityMatches}
            submitLabel={pending.replacement ? 'Save replacement' : 'Save targets'} onCancel={close}
            onSubmit={async fields => {
              const captured = retained.record;
              if (!captured || captured.version !== version || !identityMatches) return;
              const ok = await write(at => {
                if (at.planId !== planId || at.accountId !== accountId || at.version !== captured.version) throw new Error('draft_version_changed');
                return pending.replacement
                  ? planWrites.replaceSlot(workout.id, pending.slot.id, pending.replacement.id, at, fields)
                  : planWrites.updateSlot(workout.id, pending.slot.id, fields, at);
              });
              if (ok) retained.clear(captured);
            }} />
        </>}
      </section>}

      {detailsRetained.unreadable && <div className="panel" role="alert">
        <p>This browser’s workout-details draft could not be read. No change has been sent.</p>
        <button type="button" onClick={() => detailsRetained.clear()}>Discard unreadable workout-details draft</button>
      </div>}
      {detailsPending && <section aria-label="Retained workout-details draft">
        <p className="muted">Your unfinished workout details are kept in this browser when you leave this page.</p>
        {!detailsIdentityMatches && <p role="alert" className="problem">This workout’s archive status changed. Your draft is kept, but cannot be saved until the workout has the same archive status as when you opened it.</p>}
        {detailsNeedsReview && detailsIdentityMatches && <div className="panel" role="alert">
          <h3>Review your workout details</h3>
          <p>Your plan changed. Compare the saved details with your draft before continuing.</p>
          <div className="block-grid-wrap"><table><thead><tr><th>Setting</th><th>Current saved</th><th>Your draft</th></tr></thead>
            <tbody>{(['name', 'tags', 'notes'] as const).map(field => <tr key={field}><th scope="row">{field === 'name' ? 'Name' : field === 'tags' ? 'Tags' : 'Notes'}</th><td>{workoutDetails(workout)[field] || 'None'}</td><td>{detailsPending.draft[field] || 'None'}</td></tr>)}</tbody></table></div>
          <button type="button" className="ghost" disabled={busy} onClick={() => detailsRetained.save({ ...detailsPending, saved: workoutDetails(workout) }, version, JSON.stringify(detailsPending.draft) !== JSON.stringify(workoutDetails(workout)))}>Use draft with latest workout</button>
        </div>}
        <DetailsForm value={detailsPending.draft} busy={busy} blocked={detailsNeedsReview || !detailsIdentityMatches || !detailsRetained.record?.dirty} onCancel={close}
          onChange={draft => detailsRetained.save({ ...detailsPending, draft }, detailsRetained.record!.version, JSON.stringify(draft) !== JSON.stringify(detailsPending.saved))}
          onSubmit={async fields => {
            const captured = detailsRetained.record;
            if (!captured || captured.version !== version || !detailsIdentityMatches || !captured.dirty) return;
            await write(async at => {
              if (at.planId !== planId || at.accountId !== accountId || at.version !== captured.version) throw new Error('draft_version_changed');
              await planWrites.updateWorkout(workout.id, fields, at);
              detailsRetained.clear(captured);
            });
          }} />
      </section>}
      {panel?.kind === 'archive' && (
        <Confirm busy={busy} action="Archive workout" onCancel={close}
          onConfirm={() => run((at) => planWrites.updateWorkout(workout.id, { archived_at: Date.now() }, at))}>
          Archive {workout.name}? Completed workouts and logged sets stay in your history. Weekdays and dates that use it become rest days. You can restore it later.
        </Confirm>
      )}
      {panel?.kind === 'delete' && (
        <Confirm busy={busy} action="Delete workout" onCancel={close}
          onConfirm={() => run((at) => planWrites.deleteWorkout(workout.id, at), onRemoved)}>
          Delete {workout.name}? Past sessions and logged sets stay in your history. Weekdays that use it become rest days.
        </Confirm>
      )}

      {blocks.length === 0 ? (
        <p className="muted">No exercises yet. Add one below.</p>
      ) : (
        <ol ref={listRef} className="slots editable">
          {blocks.map((block) => (block.group ? groupBlock(block) : single(block.members[0]!)))}
        </ol>
      )}

      {!archived && choosing && (
        <div className="panel" role="group" aria-label="Group exercises">
          <p>
            {chosen
              ? `${chosen.map((slot) => slot.exercise_name).join(', ')}: one set of each per round.`
              : 'Tick two or more exercises next to each other that aren’t already in a superset or circuit.'}
          </p>
          <div className="form-actions">
            <button type="button" className="primary" disabled={busy || !chosen}
              onClick={() => {
                if (!chosen) return;
                setChoosing(null);
                setPanel({ kind: 'group', groupId: crypto.randomUUID(), members: chosen, existing: false });
              }}>
              {chosen ? `Make a ${groupKind(chosen.length)}` : 'Make a superset'}
            </button>
            <button type="button" className="ghost" onClick={() => setChoosing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {!archived && panel?.kind === 'group' && !panel.existing && (
        <GroupForm
          title={`New ${groupKind(panel.members.length)}`}
          members={panel.members}
          existing={false}
          busy={busy}
          onCancel={close}
          onSubmit={(values) => run((at) => planWrites.setGroup(workout.id, panel.groupId, panel.members.map((slot) => slot.id), values, at))}
        />
      )}

      {!archived && !choosing && !(panel?.kind === 'group' && !panel.existing) && (
        panel?.kind === 'add' ? (
          panel.exercise ? (
            <div className="panel">
              <h3>{panel.warmup ? 'Add warm-up' : 'Add exercise'}: {panel.exercise.name}</h3>
              <SlotForm
                facts={factsOfCatalog(panel.exercise)}
                initial={newDraft(factsOfCatalog(panel.exercise), { warmup: panel.warmup, unit: preferredUnit(miles) })}
                busy={busy}
                submitLabel="Add to workout"
                onCancel={close}
                onSubmit={(fields) => {
                  if (typeof fields.target_weight_unit === 'string') rememberUnit(fields.target_weight_unit as WeightUnit);
                  return run((at) => planWrites.addSlot(workout.id, panel.exercise!.id, fields, at));
                }}
              />
            </div>
          ) : (
            <ExercisePicker
              title={panel.warmup ? 'Add warm-up' : 'Add exercise'}
              catalog={catalog}
              busy={busy}
              onCancel={close}
              onPick={(exercise) => setPanel({ ...panel, exercise })}
            />
          )
        ) : (
          <div className="add-actions">
            <button type="button" disabled={busy} onClick={() => open({ kind: 'add', warmup: false, exercise: null })}>Add exercise</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => open({ kind: 'add', warmup: true, exercise: null })}>Add warm-up</button>
            {canGroup && <button type="button" className="ghost" disabled={busy} onClick={startChoosing}>Make a superset or circuit</button>}
          </div>
        )
      )}
    </article>
  );
}

function SlotRow(props: {
  slot: Slot;
  miles: boolean;
  busy: boolean;
  archived: boolean;
  /** The move one place up (-1) or down (+1), or null where it can't go. */
  move: (direction: -1 | 1) => (() => void) | null;
  /** Said after "Move <name> up" for a screen reader, e.g. "within its group". */
  moveLabel?: string;
  onOpen: (kind: 'edit' | 'run' | 'replace' | 'remove') => void;
  /** While choosing exercises to group, a tick box replaces the actions. */
  choose?: { checked: boolean; onChange: (on: boolean) => void };
  panel: ReactNode;
}) {
  const { slot, miles, busy, archived, move, moveLabel, onOpen, choose, panel } = props;
  const up = move(-1);
  const down = move(1);
  const run = isRun(factsOfSlot(slot));
  const steps = describeRunSteps(slot.run_steps, miles);
  const name = slot.exercise_name;
  const within = moveLabel ? ` ${moveLabel}` : '';
  return (
    <li className={slot.is_warmup ? 'warmup' : ''}>
      <div className="slot-row">
        {choose && (
          <input type="checkbox" className="choose" checked={choose.checked}
            onChange={(e) => choose.onChange(e.target.checked)} aria-label={`Choose ${name}`} />
        )}
        <div className="slot-text">
          <div className="slot-name">
            {slot.group_label ? <span className="group">{slot.group_label}</span> : null}
            {name}
            {slot.is_warmup ? <span className="tag">Warm-up</span> : null}
          </div>
          {steps.length ? (
            <ul className="steps">{steps.map((line, i) => <li key={i}>{line}</li>)}</ul>
          ) : (
            <div className="muted">{run ? 'No steps planned' : describeSlot(slot)}</div>
          )}
        </div>
        {!archived && !choose && (
          <div className="row-actions">
            <button type="button" className="icon" disabled={busy || !up} onClick={() => up?.()} aria-label={`Move ${name} up${within}`}>↑</button>
            <button type="button" className="icon" disabled={busy || !down} onClick={() => down?.()} aria-label={`Move ${name} down${within}`}>↓</button>
            {run
              ? <button type="button" className="ghost small" disabled={busy} onClick={() => onOpen('run')} aria-label={`Plan ${name}`}>Plan run</button>
              : <button type="button" className="ghost small" disabled={busy} onClick={() => onOpen('edit')} aria-label={`Edit ${name}`}>Edit</button>}
            {!slot.run_steps && <button type="button" className="ghost small" disabled={busy} onClick={() => onOpen('replace')} aria-label={`Replace ${name}`}>Replace</button>}
            <button type="button" className="ghost small danger" disabled={busy} onClick={() => onOpen('remove')} aria-label={`Remove ${name}`}>Remove</button>
          </div>
        )}
      </div>
      {panel}
    </li>
  );
}

function Confirm(props: { children: ReactNode; action: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  // Focus starts on the safe choice, so Enter alone never deletes anything.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div className="panel confirm" role="group" aria-label={props.action}>
      <p>{props.children}</p>
      <div className="form-actions">
        <button type="button" className="danger-fill" disabled={props.busy} onClick={props.onConfirm}>{props.action}</button>
        <button ref={cancelRef} type="button" className="ghost" onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Rounds and rests of a superset or circuit; also where an existing one is ungrouped. */
function GroupForm(props: {
  title: string;
  members: Slot[];
  existing: boolean;
  busy: boolean;
  onSubmit: (values: GroupValues) => void;
  onUngroup?: () => void;
  onCancel: () => void;
}) {
  const { title, members, existing, busy, onSubmit, onUngroup, onCancel } = props;
  const [draft, setDraft] = useState<GroupDraft>(() => groupDraft(members));
  const [errors, setErrors] = useState<string[]>([]);
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => formRef.current?.querySelector<HTMLInputElement>('input')?.focus(), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = groupValues(draft);
    if (!result.ok) return setErrors(result.errors);
    setErrors([]);
    const stored = groupValues(groupDraft(members));
    const unchanged = stored.ok && JSON.stringify(stored.values) === JSON.stringify(result.values);
    if (existing && unchanged) return onCancel();
    onSubmit(result.values);
  }

  const field = (key: keyof GroupDraft, label: string) => (
    <div className="field small-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input id={`${id}-${key}`} inputMode="numeric" value={draft[key]}
        onChange={(e) => setDraft((current) => ({ ...current, [key]: e.target.value }))} />
    </div>
  );

  return (
    <form ref={formRef} className="panel group-form" onSubmit={submit} noValidate aria-label={title}>
      <h3>{title}</h3>
      <ol className="member-order">{members.map((slot) => <li key={slot.id}>{slot.exercise_name}</li>)}</ol>
      <div className="field-row">
        {field('rounds', 'Rounds')}
        {field('transitionRest', 'Rest between exercises, seconds')}
        {field('roundRest', 'Rest after each round, seconds')}
      </div>
      <small className="muted">
        Do one set of each exercise per round, resting between exercises and again after the last.
        Each exercise’s own rest is kept in case you ungroup.
      </small>
      {errors.length > 0 && (
        <ul role="alert" className="problem">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
      )}
      <div className="form-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save group' : `Make ${groupKind(members.length)}`}</button>
        {onUngroup && <button type="button" className="ghost" disabled={busy} onClick={onUngroup}>Ungroup</button>}
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function DetailsForm(props: {
  value: WorkoutDetails;
  onChange: (draft: WorkoutDetails) => void;
  busy: boolean;
  blocked: boolean;
  onSubmit: (fields: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const { value, onChange, busy, blocked, onSubmit, onCancel } = props;
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), tags: useId(), notes: useId() };
  function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked || busy) return;
    const result = workoutDetailsRequest(value);
    if ('error' in result) { setError(result.error); return; }
    setError(null); onSubmit(result.fields);
  }
  return (
    <form className="panel" onSubmit={submit}>
      <div className="field"><label htmlFor={ids.name}>Name</label>
        <input id={ids.name} value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} maxLength={80} autoFocus /></div>
      <div className="field"><label htmlFor={ids.tags}>Tags</label>
        <input id={ids.tags} value={value.tags} onChange={e => onChange({ ...value, tags: e.target.value })} placeholder="Separate with commas, e.g. travel, upper" aria-describedby={`${ids.tags}-hint`} />
        <small id={`${ids.tags}-hint`} className="muted">When you pick a workout for an away date in the app, ones tagged travel are listed first.</small></div>
      <div className="field"><label htmlFor={ids.notes}>Notes</label>
        <textarea id={ids.notes} value={value.notes} onChange={e => onChange({ ...value, notes: e.target.value })} rows={3} /></div>
      {error && <p role="alert" className="problem">{error}</p>}
      <div className="form-actions"><button type="submit" disabled={busy || blocked}>Save</button>
        <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export function ExercisePicker(props: {
  title: string;
  catalog: Catalog;
  exclude?: string;
  busy: boolean;
  onPick: (exercise: CatalogExercise) => void;
  onCancel: () => void;
}) {
  const { title, catalog, exclude, busy, onPick, onCancel } = props;
  const [query, setQuery] = useState('');
  const searchId = useId();
  const matches = useMemo(
    () => catalog.kind === 'ready' ? searchCatalog(catalog.exercises.filter((e) => e.id !== exclude), query) : [],
    [catalog, exclude, query],
  );
  return (
    <div className="panel picker">
      <h3>{title}</h3>
      <label htmlFor={searchId}>Search exercises</label>
      <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, alias, muscle or equipment" autoFocus />
      {catalog.kind === 'loading' && <p className="muted">Loading exercises…</p>}
      {catalog.kind === 'error' && <p role="alert" className="problem">The exercise list couldn’t be loaded. Refresh to try again.</p>}
      {catalog.kind === 'ready' && (
        matches.length ? (
          <ul className="matches">
            {matches.map((exercise) => (
              <li key={exercise.id}>
                <button type="button" disabled={busy} onClick={() => onPick(exercise)}>
                  <span>{exercise.name}</span>
                  <span className="muted">{exercise.primary_muscle} · {MODALITY_LABELS[exercise.modality] ?? exercise.modality}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No exercises match.</p>
      )}
      <div className="form-actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const MODALITY_LABELS: Record<string, string> = {
  barbell: 'barbell', dumbbell: 'dumbbell', bw: 'bodyweight', timed: 'hold', cardio: 'cardio',
  machine: 'machine', kettlebell: 'kettlebell', band: 'band',
};

function SlotForm(props: {
  facts: ExerciseFacts;
  initial: SlotDraft;
  value?: SlotDraft;
  onChange?: (value: SlotDraft) => void;
  replacement?: CatalogExercise;
  blocked?: boolean;
  editing?: Slot;
  busy: boolean;
  submitLabel: string;
  onSubmit: (fields: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const { facts, initial, editing, busy, submitLabel, onSubmit, onCancel, replacement, blocked } = props;
  const [localDraft, setLocalDraft] = useState(initial);
  const draft = props.value ?? localDraft;
  const setDraft = (next: SlotDraft) => { setLocalDraft(next); props.onChange?.(next); };
  const [errors, setErrors] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  // Keyboard users land in the form that just opened.
  useEffect(() => formRef.current?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus(), []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || blocked) return;
    const result = replacement && editing ? replacementFields(draft, replacement, editing) : prescriptionFields(draft, facts, editing);
    if (!result.ok) return setErrors(result.errors);
    setErrors([]);
    if (!replacement && Object.keys(result.fields).length === 0) return onCancel();
    onSubmit(result.fields);
  }

  return (
    <form ref={formRef} className="panel slot-form" onSubmit={submit} noValidate>
      <SlotFields facts={facts} draft={draft} onChange={setDraft} grouped={!!editing?.group_id} warmupLocked={!!replacement || busy} />

      {errors.length > 0 && (
        <ul role="alert" className="problem">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
      )}
      <div className="form-actions">
        <button type="submit" disabled={busy || blocked}>{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
