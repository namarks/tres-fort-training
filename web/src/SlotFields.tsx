import { useId } from 'react';
import { allowsAssistance, fixedMeasure, showsLoad, switchUnit, type ExerciseFacts, type SlotDraft, type WeightUnit } from './editing';

/** Shared prescription controls; callers own the form and save boundary. */
export function SlotFields({ facts, draft, onChange, grouped = false, warmupLocked = false }: {
  facts: ExerciseFacts; draft: SlotDraft; onChange: (draft: SlotDraft) => void; grouped?: boolean; warmupLocked?: boolean;
}) {
  const id = useId();
  const setDraft = onChange;
  const set = (patch: Partial<SlotDraft>) => onChange({ ...draft, ...patch });
  const fixed = fixedMeasure(facts.modality), measure = fixed ?? draft.measure;
  const perSide = facts.laterality === 'unilateral' ? ' per side' : '';
  const assistance = allowsAssistance(facts.modality);
  const number = (key: keyof SlotDraft, label: string, options: { disabled?: boolean } = {}) => (
    <div className="field small-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input id={`${id}-${key}`} inputMode="decimal" value={draft[key] as string} disabled={options.disabled}
        onChange={event => set({ [key]: event.target.value } as Partial<SlotDraft>)} />
    </div>
  );
  return <>
      <label className="check">
        <input type="checkbox" disabled={warmupLocked} checked={draft.isWarmup} onChange={(e) => set({ isWarmup: e.target.checked })} />
        Warm-up <span className="muted">(kept out of working-set totals and session intensity)</span>
      </label>

      {!fixed && (
        <fieldset className="segmented">
          <legend>Measure</legend>
          <label><input type="radio" name={`${id}-measure`} checked={measure === 'reps'} onChange={() => set({ measure: 'reps' })} /> Reps</label>
          <label><input type="radio" name={`${id}-measure`} checked={measure === 'hold'} onChange={() => set({ measure: 'hold' })} /> Hold</label>
        </fieldset>
      )}

      <div className="field-row">
        {number('sets', grouped ? 'Rounds (set on the group)' : 'Sets', { disabled: grouped })}
        {measure === 'reps' && number('reps', draft.useRange ? `Reps, at least${perSide}` : `Reps${perSide}`)}
        {measure === 'reps' && draft.useRange && number('repsMax', `Up to${perSide}`)}
        {measure === 'hold' && number('holdSeconds', 'Seconds each')}
        {measure === 'duration' && number('minutes', 'Minutes')}
      </div>
      {measure === 'reps' && (
        <label className="check">
          <input type="checkbox" checked={draft.useRange} onChange={(e) => set({ useRange: e.target.checked })} />
          Rep range
        </label>
      )}

      {showsLoad(facts.modality) && (
        <div className="field-row">
          <div className="field small-field">
            <label htmlFor={`${id}-weight`}>Weight{facts.loadMode === 'per_hand' ? ', each hand' : ''}</label>
            <div className="inline-fields">
              <input id={`${id}-weight`} inputMode="decimal" value={draft.weight} placeholder="No target"
                aria-describedby={`${id}-weight-hint`} onChange={(e) => set({ weight: e.target.value })} />
              <select aria-label="Weight unit" value={draft.unit} onChange={(e) => setDraft(switchUnit(draft, e.target.value as WeightUnit))}>
                <option value="lb">lb</option>
                <option value="kg">kg</option>
              </select>
            </div>
          </div>
          {number('rpe', 'Target RPE')}
        </div>
      )}
      {showsLoad(facts.modality) && (
        <small id={`${id}-weight-hint`} className="muted">
          {assistance
            ? 'Enter 0 for bodyweight, added load as a positive number and assistance as a negative one. Leave it empty to start from your last set.'
            : 'Each set starts at this weight. Leave it empty to start from your last set. RPE is optional, from 1 to 10.'}
        </small>
      )}

      <div className="field-row">
        {number('rest', grouped ? 'Rest (set on the group)' : 'Rest between sets, seconds', { disabled: grouped })}
      </div>

  </>;
}
