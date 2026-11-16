import { useState } from 'react';
import type { ActiveBlock } from './BlockEditor';
import type { Workout } from './model';
import { lighterWeek, liftingWorkoutsInWeek, weekScopeLabel } from './weekAdjustment';

export function WeekAdjustment({ block, index, workouts, onClose }: {
  block: ActiveBlock; index: number; workouts: Workout[]; onClose: () => void;
}) {
  const [workoutId, setWorkoutId] = useState('');
  const [sets, setSets] = useState('20');
  const [load, setLoad] = useState('10');
  const valid = [sets, load].every(v => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 90);
  const choices = liftingWorkoutsInWeek(block.draft, index, workouts);
  const preview = lighterWeek(block.draft, index, workouts, { workoutId, setsPercent: Number(sets), loadPercent: Number(load) });
  const blocked = !valid || !!block.problem || block.needsReview || block.inputErrors.length > 0 || !preview.rows.length
    || (!!workoutId && !choices.some(w => w.id === workoutId));
  return <section className="panel" aria-label="Make week lighter">
    <h2>Make week {index + 1} lighter</h2>
    <p>{weekScopeLabel(block.draft, index)}. Saved workouts and history stay unchanged. Finish in-progress workouts before changing their targets; other weeks remain editable. Finish or sync workouts started on another device first.</p>
    <div className="field"><label htmlFor="lighter-workout">Workouts</label>
      <select id="lighter-workout" value={workoutId} onChange={e => setWorkoutId(e.target.value)}>
        <option value="">All lifting workouts in this week</option>
        {choices.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select></div>
    <div className="field-row">
      <div className="field"><label htmlFor="lighter-sets">Fewer sets or rounds (%)</label>
        <input id="lighter-sets" type="number" min="0" max="90" value={sets} onChange={e => setSets(e.target.value)} /></div>
      <div className="field"><label htmlFor="lighter-load">Lighter load (%)</label>
        <input id="lighter-load" type="number" min="0" max="90" value={load} onChange={e => setLoad(e.target.value)} /></div>
    </div>
    <p className="muted fine">Use 0 to keep a target. Sets round down, with at least one. Assistance increases; unknown and zero loads stay as they are. Warm-ups and cardio stay unchanged. Mixed cardio groups keep their rounds.</p>
    {!valid && <p role="alert">Use a percentage from 0 to 90.</p>}
    {valid && preview.rows.length > 0 ? <div className="block-grid-wrap"><table>
      <thead><tr><th>Movement</th><th>Target</th><th>Current week target</th><th>Proposed</th></tr></thead>
      <tbody>{preview.rows.map(row => <tr key={row.key}><th scope="row">{row.workout} · {row.exercise}</th>
        <td>{row.field}</td><td>{row.before} {row.unit}</td><td>{row.after} {row.unit}</td></tr>)}</tbody>
    </table></div> : valid ? <p>No lifting targets would change.</p> : null}
    <div className="actions"><button type="button" className="primary" disabled={blocked} onClick={() => { block.setDraft(preview.program); onClose(); }}>Apply to block draft</button>
      <button type="button" className="ghost" onClick={onClose}>Cancel</button></div>
    <p className="muted fine">Review the block, then save its changes.</p>
  </section>;
}
