import type { StateResponse } from './api';
import { planBlocks } from './event';
import { WEEKDAYS } from '../../src/types';

/** Introduce week-to-week changes only after the member has a usable week. */
export function PlanNextSteps({ state }: { state: StateResponse }) {
  const plan = state.plan;
  if (!plan || planBlocks(state).program) return null;
  const available = new Set(plan.workouts.filter(workout => !workout.archived_at && !workout.one_time_date)
    .map(workout => workout.id));
  const hasWeek = WEEKDAYS.some(day => available.has(plan.schedule.week[day] ?? '')
    || (plan.schedule.extras?.[day] ?? []).some(id => available.has(id)));
  if (!hasWeek) return null;
  return (
    <section className="panel" aria-labelledby="plan-next-steps-title">
      <h2 id="plan-next-steps-title">Build on your week</h2>
      <p>Your weekly routine repeats until you change it. Keep using it for as long as it works for you.</p>
      <p>When you want different weeks, a training block starts from this routine. Change a week’s workouts,
        sets, reps, load or run targets, and include easier weeks. Review the targets before training.</p>
      <div className="head-actions">
        <a href="#block">Explore a training block</a>
        <a href="#workouts">Adjust saved workout targets</a>
      </div>
      <p className="muted hint">Saved workout edits apply whenever that workout is used. Block targets apply
        to their weeks. Opening either editor leaves your plan unchanged until you save.</p>
    </section>
  );
}
