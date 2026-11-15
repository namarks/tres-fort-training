import { useMemo } from 'react';
import type { StateResponse } from './api';
import { formatLongDate, formatScheduleTime } from './model';
import { IPHONE_APP_URL, OPEN_TODAY_URL, nextPlannedDay } from './phonePlanning';

export function PhoneHandoff({ state, today }: { state: StateResponse; today: string }) {
  const next = useMemo(() => nextPlannedDay(state, today), [state, today]);
  if (!next) return null;
  return (
    <section className="phone-handoff panel" aria-labelledby="phone-handoff-title">
      <h2 id="phone-handoff-title">Take your week to iPhone</h2>
      <p className="muted">Next planned day: {formatLongDate(next.date)}</p>
      <ul aria-label="Next workouts">
        {next.workouts.map(workout => <li key={workout.id}>
          <strong>{workout.name}</strong>{workout.started ? ' · In progress' : workout.time ? ` · ${formatScheduleTime(workout.time)}` : ''}
        </li>)}
      </ul>
      <p>Sign in to Très Fort with the same Apple account. Your saved workouts and week will be there; open Today when you’re ready to train.</p>
      <p className="muted hint">Times organize your week. Turn on workout reminders in the iPhone app.</p>
      <div className="head-actions">
        <a href={IPHONE_APP_URL} target="_blank" rel="noopener noreferrer">Get the iPhone app</a>
        <a href={OPEN_TODAY_URL}>Open the iPhone app</a>
      </div>
    </section>
  );
}
