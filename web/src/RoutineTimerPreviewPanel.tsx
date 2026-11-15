import { useId, useState } from 'react';
import { previewStepInstruction, previewStepTarget, previewTimeExplanation, previewTimeSummary, type RoutinePreview } from './routineTimerPreview';

export function RoutineTimerPreview({ preview }: { preview: RoutinePreview }) {
  const [index, setIndex] = useState(0);
  const id = useId();
  const current = Math.min(index, preview.steps.length - 1), step = preview.steps[current];
  return <section className="panel routine-preview" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>Time and timer preview</h3>
    <p><strong>{previewTimeSummary(preview)}</strong></p>
    <p className="muted">{previewTimeExplanation(preview)}</p>
    {step && <>
      <div className="routine-preview-step" aria-live="polite" aria-atomic="true">
        <p className="muted">Step {current + 1} of {preview.steps.length} · {step.context}</p>
        <h4>{step.title}</h4>
        <p>{previewStepTarget(step)}</p>
        <p className="muted">{previewStepInstruction(step)}</p>
      </div>
      <div className="form-actions">
        <button className="ghost" type="button" disabled={current === 0} onClick={() => setIndex(current - 1)}>Previous step</button>
        <button className="ghost" type="button" disabled={current + 1 === preview.steps.length} onClick={() => setIndex(current + 1)}>Next step</button>
      </div>
      <p className="muted">No rest follows the final set. Previewing does not start or log a workout.</p>
    </>}
  </section>;
}
