import { describe, expect, it } from 'vitest';
import { isEmptySwimView, pacePer100, swimView, type ActivitySwimResponse } from '../src/swimDetail';
import { activityLoad, isEffortLoad } from '../src/model';
import type { StateActivity } from '../src/api';

const pool: ActivitySwimResponse = {
  activity_id: 'a',
  swim: {
    location: 'pool', pool_length_m: 22.86, pool_unit: 'yd', strokes: 64, lengths: [],
    sets: [{ start_s: 0, duration_s: 105, distance_m: 91.4, lengths: 4, stroke: 'freestyle' }],
  },
  summary: {
    length_count: 4, strokes: 64, strokes_per_length: 16, swolf: 39.3,
    stroke_breakdown: [
      { stroke: 'freestyle', lengths: 3, distance_m: 68.6 },
      { stroke: 'breaststroke', lengths: 1, distance_m: 22.9 },
    ],
  },
};

describe('swim detail', () => {
  it('words a pool swim in the pool\'s own unit', () => {
    const view = swimView(pool, false);
    expect(view.place).toBe('25 yd pool');
    expect(view.facts).toEqual([
      { label: 'Lengths', value: '4' },
      { label: 'Strokes', value: '64' },
      { label: 'Strokes / length', value: '16.0' },
      { label: 'SWOLF', value: '39' },
    ]);
    expect(view.strokes).toBe('Freestyle 3 · Breaststroke 1');
    expect(view.sets).toEqual([{ title: 'Set 1 · Freestyle', figures: '100 yd · 1:45 · 1:45 /100yd' }]);
  });

  it('reads an open-water swim with nothing else, and knows an empty one', () => {
    const open = swimView({
      activity_id: 'b',
      swim: { location: 'open_water', pool_length_m: null, pool_unit: null, strokes: null, lengths: [], sets: [] },
      summary: { length_count: 0, strokes: null, strokes_per_length: null, swolf: null, stroke_breakdown: [] },
    }, true);
    expect(open).toEqual({ place: 'Open water', facts: [], strokes: null, sets: [] });
    expect(isEmptySwimView(open)).toBe(false);
    expect(isEmptySwimView({ place: null, facts: [], strokes: null, sets: [] })).toBe(true);
    expect(pacePer100(120, 100, false)).toBe('2:00 /100m');
    expect(pacePer100(120, null, false)).toBeNull();
  });

  it('labels a load from Apple Watch\'s effort score until the member rates it', () => {
    const swim = { effective_load: 50, load_method: 'effort', effort: null, provider_effort: 7, training_load: null } as StateActivity;
    expect(activityLoad(swim)).toEqual({ load: 50, method: 'watch_effort' });
    expect(isEffortLoad(activityLoad(swim))).toBe(true);
    expect(activityLoad({ ...swim, effort: 4 })).toEqual({ load: 50, method: 'effort' });
  });
});
