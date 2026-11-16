/** The Plan section's own tabs: the schedule of weeks and the workouts it
 * is made of. Both live under Plan in the top bar. */
export function PlanTabs({ current }: { current: 'schedule' | 'workouts' }) {
  return (
    <nav className="plan-tabs" aria-label="Plan sections">
      <a href="#plan" aria-current={current === 'schedule' ? 'page' : undefined}>Schedule</a>
      <a href="#workouts" aria-current={current === 'workouts' ? 'page' : undefined}>Workouts</a>
    </nav>
  );
}
