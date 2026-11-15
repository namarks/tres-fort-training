import { describe, expect, it } from 'vitest';
import type { ProgramWeek, ScheduleWeek } from '../../src/types';
import type { ProgramBody } from '../src/blocks';
import { addingExtraIn, blockEndMonday, planRows, removingExtraIn, scopeDiffers, scopedWeeks, settingDayIn } from '../src/planWeeks';

const REST: ScheduleWeek = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

function week(tue: string | null, extras: string[] = []): ProgramWeek {
  return { week: { ...REST, tue }, ...(extras.length ? { extras: { tue: extras } } : {}) };
}

function block(start: string, weeks: ProgramWeek[], repeat = false): ProgramBody {
  return { start, repeat, weeks };
}

// Thursday, November 19, 2026; its Monday is November 16.
const today = '2026-11-19';

describe('Plan page week rows', () => {
  it('shows last week and the next five without a block', () => {
    const rows = planRows(null, today);
    expect(rows.map((row) => row.monday)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14']);
    expect(rows.every((row) => row.week === null)).toBe(true);
  });

  it('runs from a recent block start through two usual weeks after it', () => {
    const rows = planRows(block('2026-11-02', [week('a'), week('a'), week('b'), week('b')]), today);
    expect(rows.map((row) => [row.monday, row.week])).toEqual([
      ['2026-11-02', 0], ['2026-11-09', 1], ['2026-11-16', 2], ['2026-11-23', 3],
      ['2026-11-30', null], ['2026-12-07', null],
    ]);
  });

  it('starts at most four weeks back in a long block, and at least at last week', () => {
    const long = block('2026-08-03', Array.from({ length: 20 }, () => week('a')));
    expect(planRows(long, today)[0]).toEqual({ monday: '2026-10-19', week: 11 });
    const future = block('2026-12-07', [week('a'), week('a')]);
    const rows = planRows(future, today);
    expect(rows[0]).toEqual({ monday: '2026-11-09', week: null });
    expect(rows.slice(-4).map((row) => row.week)).toEqual([0, 1, null, null]);
  });

  it('adds whole weeks for Show earlier and Show later', () => {
    const rows = planRows(null, today, 4, 2);
    expect(rows[0]!.monday).toBe('2026-10-12');
    expect(rows[rows.length - 1]!.monday).toBe('2026-12-28');
  });

  it('ends a repeating block after the run that covers today', () => {
    const repeating = block('2026-10-26', [week('a'), week('b')], true);
    expect(blockEndMonday(repeating, today)).toBe('2026-11-23');
    expect(blockEndMonday(repeating, '2026-10-01')).toBe('2026-11-09');
    expect(planRows(repeating, today).map((row) => row.week)).toEqual([0, 1, 0, 1, 0, 1]);
  });
});

describe('changing a block weekday in scope', () => {
  const body = block('2026-11-02', [week('a'), week('b', ['core']), week('a'), week('a')]);

  it('names the weeks each scope touches', () => {
    expect(scopedWeeks(body, 1, 'week')).toEqual([1]);
    expect(scopedWeeks(body, 1, 'block')).toEqual([0, 1, 2, 3]);
    expect(scopedWeeks(body, 2, 'later')).toEqual([2, 3]);
    expect(scopedWeeks(body, 9, 'week')).toEqual([]);
  });

  it('tells when the weeks in scope disagree on that day', () => {
    expect(scopeDiffers(body, [0, 2, 3], 'tue')).toBe(false);
    expect(scopeDiffers(body, [0, 1], 'tue')).toBe(true);
    expect(scopeDiffers(body, [0, 1], 'mon')).toBe(false);
  });

  it('sets the main workout in every week in scope and only there', () => {
    const next = settingDayIn(body, [2, 3], 'tue', 'run');
    expect(next.weeks.map((w) => w.week.tue)).toEqual(['a', 'b', 'run', 'run']);
    expect(body.weeks[2]!.week.tue).toBe('a');
  });

  it('adds an extra where it fits and removes it from every week in scope', () => {
    const added = addingExtraIn(body, [0, 1, 2, 3], 'tue', 'core')!;
    expect(added.weeks.map((w) => w.extras?.tue ?? [])).toEqual([['core'], ['core'], ['core'], ['core']]);
    expect(addingExtraIn(body, [1], 'tue', 'core')).toBeNull();
    const removed = removingExtraIn(added, [0, 1], 'tue', 'core');
    expect(removed.weeks.map((w) => w.extras?.tue ?? [])).toEqual([[], [], ['core'], ['core']]);
  });
});
