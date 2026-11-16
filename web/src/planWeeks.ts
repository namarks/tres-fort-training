// The web Plan page (docs/plans/web-app P2): one calendar of week rows that
// shows the repeating week and, where a block covers a week, that block
// week. Pure. The block itself is edited in the Block tab (blockLayers.ts).
import { addDays, programWeekOn } from '../../src/calendarProjection';
import type { TrainingProgram } from '../../src/types';
import { mondayOnOrBefore, type ProgramBody } from './blocks';

/** One row of the Plan page: a Monday, and the block week it shows (null
 * when the usual week applies). */
export type PlanRow = { monday: string; week: number | null };

/** Rows shown before scrolling adds earlier or later weeks. */
const PAST_WEEKS_SHOWN = 4;
const WEEKS_AFTER_BLOCK = 2;
const WEEKS_WITHOUT_BLOCK = 6;
export const MAX_PLAN_ROWS = 160;

function weekOf(program: ProgramBody | null, date: string): number | null {
  return program ? programWeekOn(program as TrainingProgram, date) : null;
}

/** The Monday after the block's run that covers `today` (or its first run,
 * when it hasn't started). */
export function blockEndMonday(program: ProgramBody, today: string): string {
  const length = program.weeks.length * 7;
  if (!program.repeat || today < program.start) return addDays(program.start, length);
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${program.start}T00:00:00Z`)) / 86_400_000;
  return addDays(program.start, (Math.floor(days / length) + 1) * length);
}

/**
 * The week rows: a block's weeks from its start (or the last few weeks when
 * it began long ago) through two usual weeks after it; with no block, last
 * week and the next five. `earlier` and `later` add whole weeks each side.
 */
export function planRows(program: ProgramBody | null, today: string, earlier = 0, later = 0): PlanRow[] {
  const thisMonday = mondayOnOrBefore(today);
  let from: string;
  let to: string;
  if (program && program.weeks.length > 0) {
    // From the block's start, but at least last week and at most four back.
    const recent = addDays(thisMonday, -PAST_WEEKS_SHOWN * 7);
    const lastWeek = addDays(thisMonday, -7);
    const start = mondayOnOrBefore(program.start);
    from = start < recent ? recent : start > lastWeek ? lastWeek : start;
    const end = blockEndMonday(program, today);
    to = addDays(end > thisMonday ? end : addDays(thisMonday, 7), WEEKS_AFTER_BLOCK * 7);
  } else {
    from = addDays(thisMonday, -7);
    to = addDays(from, WEEKS_WITHOUT_BLOCK * 7);
  }
  from = addDays(from, -Math.max(0, earlier) * 7);
  to = addDays(to, Math.max(0, later) * 7);
  const rows: PlanRow[] = [];
  for (let monday = from; monday < to && rows.length < MAX_PLAN_ROWS; monday = addDays(monday, 7)) {
    rows.push({ monday, week: weekOf(program, monday) });
  }
  return rows;
}
