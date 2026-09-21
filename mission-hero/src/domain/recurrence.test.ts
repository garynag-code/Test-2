import { describe, expect, it } from 'vitest';
import { expandSchedule, isDueOn, nextDueDate, type ScheduleSpec } from './recurrence';

const base = { startDate: '2026-09-01' } as const;

describe('expandSchedule — ONE_TIME', () => {
  it('emits the start date once, and only inside the window', () => {
    const spec: ScheduleSpec = { ...base, frequency: 'ONE_TIME' };
    expect(expandSchedule(spec, '2026-09-01', '2026-09-30')).toEqual(['2026-09-01']);
    expect(expandSchedule(spec, '2026-09-02', '2026-09-30')).toEqual([]);
  });
});

describe('expandSchedule — DAILY', () => {
  it('emits every day in the window', () => {
    const spec: ScheduleSpec = { ...base, frequency: 'DAILY' };
    expect(expandSchedule(spec, '2026-09-01', '2026-09-05')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });

  it('honours an interval of every N days counted from the start date', () => {
    const spec: ScheduleSpec = { ...base, frequency: 'DAILY', interval: 3 };
    expect(expandSchedule(spec, '2026-09-01', '2026-09-10')).toEqual([
      '2026-09-01',
      '2026-09-04',
      '2026-09-07',
      '2026-09-10',
    ]);
  });

  it('never emits before the start date (BR-21)', () => {
    const spec: ScheduleSpec = { frequency: 'DAILY', startDate: '2026-09-10' };
    expect(expandSchedule(spec, '2026-09-01', '2026-09-12')).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
  });

  it('never emits after the end date (BR-21)', () => {
    const spec: ScheduleSpec = { frequency: 'DAILY', startDate: '2026-09-01', endDate: '2026-09-03' };
    expect(expandSchedule(spec, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
  });
});

describe('expandSchedule — WEEKDAYS / WEEKENDS (BR-20)', () => {
  it('WEEKDAYS covers Monday to Friday only', () => {
    const spec: ScheduleSpec = { ...base, frequency: 'WEEKDAYS' };
    // 2026-09-19 Sat, 2026-09-20 Sun, 2026-09-21 Mon
    expect(expandSchedule(spec, '2026-09-18', '2026-09-22')).toEqual([
      '2026-09-18',
      '2026-09-21',
      '2026-09-22',
    ]);
  });

  it('WEEKENDS covers Saturday and Sunday only', () => {
    const spec: ScheduleSpec = { ...base, frequency: 'WEEKENDS' };
    expect(expandSchedule(spec, '2026-09-18', '2026-09-22')).toEqual(['2026-09-19', '2026-09-20']);
  });
});

describe('expandSchedule — SELECTED_DAYS', () => {
  it('emits only the chosen weekdays', () => {
    const spec: ScheduleSpec = { ...base, frequency: 'SELECTED_DAYS', weekdays: [1, 3, 5] };
    expect(expandSchedule(spec, '2026-09-21', '2026-09-27')).toEqual([
      '2026-09-21', // Mon
      '2026-09-23', // Wed
      '2026-09-25', // Fri
    ]);
  });

  it('deduplicates and ignores out-of-range weekday values', () => {
    const spec: ScheduleSpec = { ...base, frequency: 'SELECTED_DAYS', weekdays: [1, 1, 9, -2] };
    expect(expandSchedule(spec, '2026-09-21', '2026-09-27')).toEqual(['2026-09-21']);
  });

  it('falls back to the start date weekday when no days are given', () => {
    const spec: ScheduleSpec = { frequency: 'WEEKLY', startDate: '2026-09-21' }; // a Monday
    expect(expandSchedule(spec, '2026-09-21', '2026-10-05')).toEqual([
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
    ]);
  });

  it('supports every-other-week', () => {
    const spec: ScheduleSpec = {
      frequency: 'WEEKLY',
      startDate: '2026-09-21',
      weekdays: [1],
      interval: 2,
    };
    expect(expandSchedule(spec, '2026-09-21', '2026-10-19')).toEqual([
      '2026-09-21',
      '2026-10-05',
      '2026-10-19',
    ]);
  });
});

describe('expandSchedule — MONTHLY (BR-22)', () => {
  it('emits the same day each month', () => {
    const spec: ScheduleSpec = { frequency: 'MONTHLY', startDate: '2026-01-15', monthDay: 15 };
    expect(expandSchedule(spec, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ]);
  });

  it('clamps day 31 to the last day of shorter months', () => {
    const spec: ScheduleSpec = { frequency: 'MONTHLY', startDate: '2026-01-31', monthDay: 31 };
    expect(expandSchedule(spec, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('clamps to 29 February in a leap year', () => {
    const spec: ScheduleSpec = { frequency: 'MONTHLY', startDate: '2024-01-31', monthDay: 31 };
    expect(expandSchedule(spec, '2024-02-01', '2024-02-29')).toEqual(['2024-02-29']);
  });

  it('supports every-other-month', () => {
    const spec: ScheduleSpec = { frequency: 'MONTHLY', startDate: '2026-01-10', monthDay: 10, interval: 2 };
    expect(expandSchedule(spec, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-10',
      '2026-03-10',
      '2026-05-10',
    ]);
  });
});

describe('expandSchedule — QUARTERLY and ANNUAL', () => {
  it('QUARTERLY steps three months', () => {
    const spec: ScheduleSpec = { frequency: 'QUARTERLY', startDate: '2026-01-05', monthDay: 5 };
    expect(expandSchedule(spec, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-05',
      '2026-04-05',
      '2026-07-05',
      '2026-10-05',
    ]);
  });

  it('ANNUAL repeats on the same month and day', () => {
    const spec: ScheduleSpec = { frequency: 'ANNUAL', startDate: '2026-06-01', month: 6, monthDay: 1 };
    expect(expandSchedule(spec, '2026-01-01', '2028-12-31')).toEqual([
      '2026-06-01',
      '2027-06-01',
      '2028-06-01',
    ]);
  });
});

describe('expandSchedule — invariants', () => {
  const specs: ScheduleSpec[] = [
    { frequency: 'DAILY', startDate: '2026-01-01' },
    { frequency: 'WEEKDAYS', startDate: '2026-01-01' },
    { frequency: 'SELECTED_DAYS', startDate: '2026-01-01', weekdays: [0, 2, 4, 6] },
    { frequency: 'MONTHLY', startDate: '2026-01-31', monthDay: 31 },
    { frequency: 'QUARTERLY', startDate: '2026-02-15', monthDay: 15 },
    { frequency: 'WEEKLY', startDate: '2026-01-05', weekdays: [1], interval: 3 },
  ];

  it('is ascending, unique and stable across repeated calls', () => {
    for (const spec of specs) {
      const first = expandSchedule(spec, '2026-01-01', '2026-12-31');
      const second = expandSchedule(spec, '2026-01-01', '2026-12-31');
      expect(second).toEqual(first);
      expect(new Set(first).size).toBe(first.length);
      expect([...first].sort()).toEqual(first);
    }
  });

  it('agrees with isDueOn for every emitted and skipped day', () => {
    const spec: ScheduleSpec = { frequency: 'SELECTED_DAYS', startDate: '2026-09-01', weekdays: [2, 4] };
    const due = new Set(expandSchedule(spec, '2026-09-01', '2026-09-30'));
    for (let day = 1; day <= 30; day += 1) {
      const date = `2026-09-${String(day).padStart(2, '0')}`;
      expect(isDueOn(spec, date)).toBe(due.has(date));
    }
  });

  it('returns nothing when the window is inverted', () => {
    expect(expandSchedule({ frequency: 'DAILY', startDate: '2026-01-01' }, '2026-02-01', '2026-01-01')).toEqual([]);
  });

  it('refuses an absurdly large range rather than hanging', () => {
    expect(() =>
      expandSchedule({ frequency: 'DAILY', startDate: '2000-01-01' }, '2000-01-01', '2030-01-01'),
    ).toThrow(/range too large/);
  });

  it('treats an interval of 0 as 1 rather than looping forever', () => {
    const spec: ScheduleSpec = { frequency: 'DAILY', startDate: '2026-09-01', interval: 0 };
    expect(expandSchedule(spec, '2026-09-01', '2026-09-03')).toHaveLength(3);
  });
});

describe('nextDueDate', () => {
  it('finds the next occurrence strictly after the given day', () => {
    const spec: ScheduleSpec = { frequency: 'SELECTED_DAYS', startDate: '2026-09-01', weekdays: [1] };
    expect(nextDueDate(spec, '2026-09-21')).toBe('2026-09-28');
  });

  it('returns null once the schedule has ended', () => {
    const spec: ScheduleSpec = { frequency: 'DAILY', startDate: '2026-09-01', endDate: '2026-09-05' };
    expect(nextDueDate(spec, '2026-09-05')).toBeNull();
  });
});
