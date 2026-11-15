import type { CatalogExercise } from './editing';
import { guidedErrors, isTimed, type GuidedDraft } from './guidedWorkout';

/** Mirrors RoutineTimerPreview.swift and the native runner's ordinary order.
 * Each timed set has one countdown. Rep pace and manual pauses stay unknown. */
export interface RoutinePreviewStep {
  kind: 'work' | 'rest'; exerciseId: string; title: string; context: string;
  seconds: number | null; reps: number | null; perSide: boolean;
}
export interface RoutinePreview {
  steps: RoutinePreviewStep[]; timedWorkSeconds: number; restSeconds: number; untimedSets: number;
}
export function routineTimerPreview(draft: GuidedDraft, catalog: CatalogExercise[]): RoutinePreview | null {
  if (draft.kind !== 'home' || guidedErrors(draft, catalog).length) return null;
  const exercises = draft.exerciseIds.map(id => catalog.find(exercise => exercise.id === id)!);
  const sets = Number(draft.sets), count = sets * exercises.length;
  const preview: RoutinePreview = { steps: [], timedWorkSeconds: 0, restSeconds: 0, untimedSets: 0 };
  for (let workIndex = 0; workIndex < count; workIndex++) {
    const exerciseIndex = draft.circuit ? workIndex % exercises.length : Math.floor(workIndex / sets);
    const set = draft.circuit ? Math.floor(workIndex / exercises.length) + 1 : workIndex % sets + 1;
    const exercise = exercises[exerciseIndex]!, timed = isTimed(draft, exercise);
    const context = `${draft.circuit ? 'Round' : 'Set'} ${set} of ${sets}`;
    preview.steps.push({ kind: 'work', exerciseId: exercise.id, title: exercise.name, context,
      seconds: timed ? Number(draft.seconds) : null, reps: timed ? null : Number(draft.reps),
      perSide: !timed && exercise.laterality === 'unilateral' });
    if (timed) preview.timedWorkSeconds += Number(draft.seconds); else preview.untimedSets++;
    if (workIndex + 1 === count) continue;
    const endsRound = exerciseIndex + 1 === exercises.length;
    const pause = Number(draft.circuit ? (endsRound ? draft.roundRest : draft.transitionRest) : draft.rest);
    if (pause === 0) continue;
    preview.restSeconds += pause;
    preview.steps.push({ kind: 'rest', exerciseId: exercise.id,
      title: draft.circuit ? (endsRound ? 'Between rounds' : 'Between exercises') : 'After the set',
      context, seconds: pause, reps: null, perSide: false });
  }
  return preview;
}
export function previewDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), remainder = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hr`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (remainder > 0 || !parts.length) parts.push(`${remainder} sec`);
  return parts.join(' ');
}
export function previewTimeSummary(preview: RoutinePreview): string {
  const seconds = preview.timedWorkSeconds + preview.restSeconds;
  return seconds === 0 ? 'No fixed duration' : previewDuration(seconds)
    + (preview.timedWorkSeconds === 0 ? ' of planned rest' : ' of planned timers');
}
export function previewTimeExplanation(preview: RoutinePreview): string {
  const reps = preview.untimedSets > 0 ? `Plus ${preview.untimedSets} rep-based ${preview.untimedSets === 1 ? 'set' : 'sets'} at your own pace. ` : '';
  return reps + 'Allow extra time for setup and pauses. Skipping rests shortens this estimate.';
}
export function previewStepTarget(step: RoutinePreviewStep): string {
  return step.seconds === null ? `${step.reps} reps${step.perSide ? ' each side' : ''}`
    : previewDuration(step.seconds) + (step.kind === 'rest' ? ' rest' : ' timer');
}
export function previewStepInstruction(step: RoutinePreviewStep): string {
  if (step.kind === 'rest') return 'Rest starts after the set logs. A cue marks the end; the next set waits for you.';
  return step.seconds === null ? 'Complete the reps, then log the set.' : 'Tap Start. The countdown logs this set when it finishes.';
}
