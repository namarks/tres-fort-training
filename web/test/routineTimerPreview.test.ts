import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CatalogExercise } from '../src/editing';
import { initialGuidedDraft, type GuidedDraft } from '../src/guidedWorkout';
import { RoutineTimerPreview } from '../src/RoutineTimerPreviewPanel';
import { previewStepTarget, previewTimeExplanation, previewTimeSummary, routineTimerPreview } from '../src/routineTimerPreview';

interface Fixture {
  name: string; exercises: { id: string; name: string; modality: string; laterality?: string }[];
  draft: Omit<GuidedDraft, 'kind' | 'name' | 'exerciseIds'>;
  expected: null | { workOrder: string[]; rests: number[]; timedWorkSeconds: number; restSeconds: number; untimedSets: number; summary: string; firstTarget: string };
}
const cases: Fixture[] = JSON.parse(readFileSync(new URL('../../ios/TresFortTests/Fixtures/RoutineTimerPreview.json', import.meta.url), 'utf8'));
const catalogFor = (fixture: Fixture): CatalogExercise[] => fixture.exercises.map(exercise => ({
  ...exercise, primary_muscle: 'core', unit: 'lb', laterality: exercise.laterality ?? 'bilateral', load_mode: 'total', demo_slug: null, aliases: null,
}));
const draftFor = (fixture: Fixture): GuidedDraft => ({ kind: 'home', name: 'Routine', exerciseIds: fixture.exercises.map(exercise => exercise.id), ...fixture.draft });

describe('shared web and native timer preview contract', () => {
  it.each(cases)('$name', fixture => {
    const actual = routineTimerPreview(draftFor(fixture), catalogFor(fixture));
    if (!fixture.expected) { expect(actual).toBeNull(); return; }
    expect(actual).not.toBeNull();
    const expected = fixture.expected;
    expect(actual!.steps.filter(step => step.kind === 'work').map(step => step.exerciseId)).toEqual(expected.workOrder);
    expect(actual!.steps.filter(step => step.kind === 'rest').map(step => step.seconds)).toEqual(expected.rests);
    expect(actual!.timedWorkSeconds).toBe(expected.timedWorkSeconds);
    expect(actual!.restSeconds).toBe(expected.restSeconds);
    expect(actual!.untimedSets).toBe(expected.untimedSets);
    expect(previewTimeSummary(actual!)).toBe(expected.summary);
    expect(previewStepTarget(actual!.steps[0]!)).toBe(expected.firstTarget);
    expect(actual!.steps.at(-1)?.kind).toBe('work');
    expect(previewTimeExplanation(actual!).includes('at your own pace')).toBe(expected.untimedSets > 0);
  });
  it('shows the reviewed prescription, manual start and no-write boundary', () => {
    const fixture = cases[1]!, preview = routineTimerPreview(draftFor(fixture), catalogFor(fixture))!;
    const markup = renderToStaticMarkup(createElement(RoutineTimerPreview, { preview }));
    expect(markup).toContain('4 min 20 sec of planned timers');
    expect(markup).toContain('Round 1 of 2');
    expect(markup).toContain('Plank');
    expect(markup).toContain('40 sec timer');
    expect(markup).toContain('Tap Start.');
    expect(markup).toContain('Previewing does not start or log a workout.');
    expect(preview.steps[3]).toMatchObject({ kind: 'rest', title: 'Between rounds', context: 'Round 1 of 2', seconds: 60 });
    expect(preview.steps[4]).toMatchObject({ kind: 'work', title: 'Plank', context: 'Round 2 of 2' });
  });
  it('does not preview missing catalog rows, invalid input, or an open run', () => {
    const fixture = cases[0]!, draft = draftFor(fixture), catalog = catalogFor(fixture);
    expect(routineTimerPreview(draft, catalog.slice(1))).toBeNull();
    expect(routineTimerPreview({ ...draft, seconds: '' }, catalog)).toBeNull();
    expect(routineTimerPreview({ ...draft, sets: '1000000' }, catalog)).toBeNull();
    expect(routineTimerPreview(initialGuidedDraft('run'), catalog)).toBeNull();
  });
});
