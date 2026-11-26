import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => vite.close());

const {
  effectiveMonthDay,
  formatRoutineCadence,
  isRoutineDoneForDate,
  isRoutineDueOnDate,
  isRoutineScheduledOnDate,
  last7DaysStatus,
  routineStreak,
  toggleRoutineForDate,
} = await vite.ssrLoadModule('/src/lib/routines.ts');
const { translators } = await vite.ssrLoadModule('/src/lib/i18n.ts');

const makeRoutine = (overrides = {}) => ({
  id: 'r1',
  title: 'Take medicine',
  cadence: 'daily',
  completions: {},
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

test('daily and weekday cadences schedule and track completions per day', () => {
  let daily = makeRoutine({ cadence: 'daily' });
  assert.equal(isRoutineScheduledOnDate(daily, '2026-11-26'), true); // Thu
  assert.equal(isRoutineScheduledOnDate(daily, '2026-11-28'), true); // Sat
  assert.equal(isRoutineDoneForDate(daily, '2026-11-26'), false);

  daily = toggleRoutineForDate(daily, '2026-11-26', 100);
  assert.equal(isRoutineDoneForDate(daily, '2026-11-26'), true);
  assert.equal(isRoutineDoneForDate(daily, '2026-11-27'), false);

  const weekdays = makeRoutine({ cadence: 'weekdays' });
  assert.equal(isRoutineScheduledOnDate(weekdays, '2026-11-27'), true); // Fri
  assert.equal(isRoutineScheduledOnDate(weekdays, '2026-11-28'), false); // Sat
  assert.equal(isRoutineScheduledOnDate(weekdays, '2026-11-29'), false); // Sun
});

test('weekend cadence shares completion across Saturday and Sunday of the same weekend, resetting next week', () => {
  let wknd = makeRoutine({ title: 'Upload income & expense to AI', cadence: 'weekends' });
  // 2026-11-28 is Saturday, 2026-11-29 is Sunday, 2026-12-05 is next Saturday
  assert.equal(isRoutineScheduledOnDate(wknd, '2026-11-27'), false);
  assert.equal(isRoutineScheduledOnDate(wknd, '2026-11-28'), true);
  assert.equal(isRoutineScheduledOnDate(wknd, '2026-11-29'), true);

  wknd = toggleRoutineForDate(wknd, '2026-11-28', 100);
  assert.equal(isRoutineDoneForDate(wknd, '2026-11-28'), true);
  assert.equal(isRoutineDoneForDate(wknd, '2026-11-29'), true);
  assert.equal(isRoutineDoneForDate(wknd, '2026-12-05'), false);

  // Untoggling on Sunday clears the weekend completion
  wknd = toggleRoutineForDate(wknd, '2026-11-29', 200);
  assert.equal(isRoutineDoneForDate(wknd, '2026-11-28'), false);
  assert.equal(isRoutineDoneForDate(wknd, '2026-11-29'), false);
});

test('weekly custom days and monthly clamping + carry-over due behavior', () => {
  const customWeekly = makeRoutine({ cadence: 'weekly', weekdays: [1, 3, 5] }); // Mon, Wed, Fri
  assert.equal(isRoutineScheduledOnDate(customWeekly, '2026-11-25'), true); // Wed
  assert.equal(isRoutineScheduledOnDate(customWeekly, '2026-11-26'), false); // Thu
  assert.equal(formatRoutineCadence(customWeekly, translators['zh-Hant']), '每週一、三、五');

  assert.equal(effectiveMonthDay(2026, 1, 31), 28); // Feb 2026 -> 28
  assert.equal(effectiveMonthDay(2024, 1, 31), 29); // Feb 2024 leap year -> 29

  let monthly = makeRoutine({ cadence: 'monthly', monthDay: 15 });
  assert.equal(isRoutineDueOnDate(monthly, '2026-11-10', '2026-11-10'), false);
  assert.equal(isRoutineDueOnDate(monthly, '2026-11-15', '2026-11-15'), true);
  // Still due later in November until completed
  assert.equal(isRoutineDueOnDate(monthly, '2026-11-26', '2026-11-26'), true);

  monthly = toggleRoutineForDate(monthly, '2026-11-26', 300);
  assert.equal(isRoutineDoneForDate(monthly, '2026-11-26'), true);
  // Stays in "Completed today" on the day it was checked off, then clears the next day
  assert.equal(isRoutineDueOnDate(monthly, '2026-11-26', '2026-11-26'), true);
  assert.equal(isRoutineDueOnDate(monthly, '2026-11-27', '2026-11-27'), false);
  // On Dec 15 it becomes due again
  assert.equal(isRoutineDueOnDate(monthly, '2026-12-15', '2026-12-15'), true);

  // Monthly routine created AFTER this month's target day waits until next month
  const futureMonthly = makeRoutine({
    cadence: 'monthly',
    monthDay: 1,
    createdAt: new Date(2026, 10, 26, 12, 0, 0).getTime(),
  });
  assert.equal(isRoutineDueOnDate(futureMonthly, '2026-11-26', '2026-11-26'), false);
  assert.equal(isRoutineDueOnDate(futureMonthly, '2026-12-01', '2026-12-01'), true);
});

test('routineStreak and last7DaysStatus compute streaks accurately without breaking mid-day', () => {
  const r = makeRoutine({
    cadence: 'daily',
    completions: {
      '2026-11-23': 1,
      '2026-11-24': 1,
      '2026-11-25': 1,
    },
  });
  // Before checking off on 2026-11-26, streak from past 3 days is preserved at 3
  assert.equal(routineStreak(r, '2026-11-26'), 3);
  const doneToday = toggleRoutineForDate(r, '2026-11-26', 2);
  assert.equal(routineStreak(doneToday, '2026-11-26'), 4);

  const dots = last7DaysStatus(r, '2026-11-26');
  assert.equal(dots.length, 7);
  assert.deepEqual(
    dots.map((d) => d.state),
    ['missed', 'missed', 'missed', 'done', 'done', 'done', 'today-open'],
  );
});
