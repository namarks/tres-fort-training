import { describe, expect, it } from 'vitest';
import { layerProgram } from '../../src/programLayers';
import type { TrainingProgram, WeeklySchedule } from '../../src/types';
import { ownForm, trimmedSchedule } from '../src/blockLayers';
import shared from '../../ios/TresFortTests/Fixtures/BlockLayers.json';

// The iPhone app edits a block's own workouts with the same rules
// (docs/plans/progressive-plans P7). This fixture is the contract with
// ios/TresFortTests/BlockLayersTests.swift (BlockLayers.swift).

type Pattern = { week: Record<string, string | null>; extras?: Record<string, string[]> };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const full = (week: Record<string, string | null | undefined>) => Object.fromEntries(DAYS.map((day) => [day, week[day] ?? null]));
const pattern = (p: Pattern) => ({ week: full(p.week), ...(p.extras ? { extras: p.extras } : {}) }) as unknown as WeeklySchedule;
const program = (p: { workout_ids?: string[]; weeks: { week: Record<string, string | null> }[] }) =>
  ({ id: 'p', start: '2030-01-07', repeat: false, ...p, weeks: p.weeks.map((week) => ({ ...week, week: full(week.week) })) }) as unknown as TrainingProgram;

describe('shared TypeScript/Swift block layer fixtures', () => {
  for (const item of shared.layer) {
    it(`layers: ${item.name}`, () => {
      expect(layerProgram(program(item.program as never), pattern(item.before as Pattern), pattern(item.after as Pattern)).weeks)
        .toEqual(item.expected_weeks);
    });
  }
  for (const item of shared.own_form) {
    it(`own form: ${item.name}`, () => {
      expect(ownForm(program(item.program as never), pattern(item.schedule as Pattern)).weeks).toEqual(item.expected_weeks);
    });
  }
  for (const item of shared.trimmed) {
    it(`trimmed week: ${item.name}`, () => {
      expect(trimmedSchedule(pattern(item.schedule as Pattern), item.workout_ids ?? undefined)).toEqual(item.expected);
    });
  }
});
