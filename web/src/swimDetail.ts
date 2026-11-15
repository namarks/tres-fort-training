// A swim's detail on the web (docs/plans/sport-activities P4), as the iPhone
// app words it (SwimDetailView.swift): the pool, lengths, strokes, SWOLF,
// lengths by stroke and one line per set, in the pool's own unit (yards in a
// yard pool), else the member's. Pure: ActivityPage.tsx draws it.
import type { SwimDetail, SwimStroke, SwimSummary } from '../../src/swimDetail';
import { formatClock } from './model';

/** `GET /api/activities/:id/swim`. */
export interface ActivitySwimResponse {
  activity_id: string;
  swim: SwimDetail;
  summary: SwimSummary;
}

export interface SwimView {
  /** "25 yd pool", "50 m pool", "Pool", "Open water" or null. */
  place: string | null;
  facts: { label: string; value: string }[];
  /** "Freestyle 30 · Breaststroke 4", when more than one stroke was swum. */
  strokes: string | null;
  sets: { title: string; figures: string }[];
}

const STROKE_NAMES: Record<SwimStroke, string> = {
  freestyle: 'Freestyle', backstroke: 'Backstroke', breaststroke: 'Breaststroke', butterfly: 'Butterfly',
  mixed: 'Mixed', kickboard: 'Kick', unknown: 'Unknown stroke',
};

const YARD = 0.9144;

function distance(meters: number, yards: boolean): string {
  return `${Math.round(yards ? meters / YARD : meters).toLocaleString('en-US')} ${yards ? 'yd' : 'm'}`;
}

/** "1:52 /100yd", or null without both a time and a distance. */
export function pacePer100(seconds: number, meters: number | null, yards: boolean): string | null {
  if (meters === null || meters <= 0 || seconds <= 0) return null;
  const pace = Math.round(seconds / (meters / (yards ? 100 * YARD : 100)));
  if (pace < 1) return null;
  return `${formatClock(pace)} /100${yards ? 'yd' : 'm'}`;
}

function duration(seconds: number): string {
  return formatClock(Math.round(seconds));
}

export function swimView(response: ActivitySwimResponse, miles: boolean): SwimView {
  const { swim, summary } = response;
  const yards = swim.pool_unit === 'yd' ? true : swim.pool_unit === 'm' ? false : miles;
  const pool = swim.pool_length_m === null ? null : `${distance(swim.pool_length_m, yards)} pool`;
  const place = swim.location === 'open_water' ? 'Open water' : swim.location === 'pool' ? pool ?? 'Pool' : pool;
  const facts: { label: string; value: string }[] = [];
  if (summary.length_count > 0) facts.push({ label: 'Lengths', value: String(summary.length_count) });
  if (summary.strokes !== null) facts.push({ label: 'Strokes', value: summary.strokes.toLocaleString('en-US') });
  if (summary.strokes_per_length !== null) facts.push({ label: 'Strokes / length', value: summary.strokes_per_length.toFixed(1) });
  if (summary.swolf !== null) facts.push({ label: 'SWOLF', value: summary.swolf.toFixed(0) });
  const shares = summary.stroke_breakdown.filter((s) => s.stroke !== 'unknown');
  const strokes = shares.length > 1 ? shares.map((s) => `${STROKE_NAMES[s.stroke]} ${s.lengths}`).join(' · ') : null;
  const sets = swim.sets.map((set, i) => {
    const parts: string[] = [];
    if (set.distance_m !== null && set.distance_m > 0) parts.push(distance(set.distance_m, yards));
    parts.push(duration(set.duration_s));
    const pace = pacePer100(set.duration_s, set.distance_m, yards);
    if (pace) parts.push(pace);
    const title = `Set ${i + 1}${set.stroke === 'unknown' ? '' : ` · ${STROKE_NAMES[set.stroke]}`}`;
    return { title, figures: parts.join(' · ') };
  });
  return { place, facts, strokes, sets };
}

export function isEmptySwimView(view: SwimView): boolean {
  return view.place === null && view.facts.length === 0 && view.strokes === null && view.sets.length === 0;
}
