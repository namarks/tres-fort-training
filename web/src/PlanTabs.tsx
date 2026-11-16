/** The Plan section's own tabs: the schedule of weeks, the training block
 * and the workouts both are made of. All three live under Plan in the top bar. */
export function PlanTabs({ current }: { current: 'schedule' | 'block' | 'workouts' }) {
  return (
    <nav className="plan-tabs" aria-label="Plan sections">
      <a href="#plan" aria-current={current === 'schedule' ? 'page' : undefined}>Schedule</a>
      <a href="#block" aria-current={current === 'block' ? 'page' : undefined}>Block</a>
      <a href="#workouts" aria-current={current === 'workouts' ? 'page' : undefined}>Workouts</a>
    </nav>
  );
}
