// Story 3.5 — lapse detection (expectedNextDate + goneCold), the READ-side twin of
// the Story 1.7 derive module. PURE unit tests: no DB, no clock mocking. Each
// function is a pure function of (cadence, jobs[, today]), so the AD-7 "recomputed
// on read, never a stored flag" guarantee is proven by mutating the in-memory jobs
// array between calls — a cancel/booking flips the result with nothing to invalidate.

import { describe, it, expect } from 'vitest';
import {
  expectedNextDate,
  goneCold,
  type DeriveJob,
} from '../lib/domain/derive';

// A completed job on `date` is the lapse BASIS (Story 1.5 lifecycle set `completed`).
function completed(date: string): DeriveJob {
  return { date, completion: 'completed' };
}
function booked(date: string): DeriveJob {
  return { date, completion: 'booked' };
}
function noShow(date: string): DeriveJob {
  return { date, completion: 'no-show' };
}
function cancelled(date: string): DeriveJob {
  return { date, completion: 'cancelled' };
}

// A known last-completed date; weekly → +7 = 07-08, biweekly → +14 = 07-15,
// monthly → +28 = 07-29. All calendar arithmetic (tz-independent, AD-9).
const LAST_DONE = '2026-07-01';

describe('derive.expectedNextDate (AC1, FR16)', () => {
  it('= last completed job date + cadence interval, per cadence', () => {
    const jobs = [completed(LAST_DONE)];
    expect(expectedNextDate('weekly', jobs)).toBe('2026-07-08'); // +7
    expect(expectedNextDate('biweekly', jobs)).toBe('2026-07-15'); // +14
    expect(expectedNextDate('monthly', jobs)).toBe('2026-07-29'); // +28
  });

  it('weekly vs monthly produce proportionally different expected dates', () => {
    const jobs = [completed(LAST_DONE)];
    expect(expectedNextDate('weekly', jobs)).not.toBe(
      expectedNextDate('monthly', jobs),
    );
  });

  it('reads the LAST completed job — a later no-show/cancelled does NOT advance the basis', () => {
    // A no-show and a cancellation AFTER the last completed job must not become the
    // basis (AD-10 — only `completed` is the lapse basis; FR41).
    const jobs = [
      completed(LAST_DONE),
      noShow('2026-07-10'),
      cancelled('2026-07-12'),
    ];
    expect(expectedNextDate('weekly', jobs)).toBe('2026-07-08'); // 07-01 + 7, not 07-10/07-12
  });

  it('uses the most recent completed job when several completed exist', () => {
    const jobs = [
      completed('2026-06-01'),
      completed(LAST_DONE),
      completed('2026-06-15'),
    ];
    expect(expectedNextDate('weekly', jobs)).toBe('2026-07-08'); // max completed = 07-01
  });

  it('one-time client has no interval → null (never lapses via cadence)', () => {
    expect(expectedNextDate('one-time', [completed(LAST_DONE)])).toBeNull();
  });

  it('a client with no completed jobs has no basis → null (does not crash)', () => {
    expect(expectedNextDate('weekly', [])).toBeNull();
    expect(expectedNextDate('weekly', [booked('2026-07-05')])).toBeNull();
    expect(expectedNextDate('weekly', [noShow('2026-07-05')])).toBeNull();
  });
});

describe('derive.goneCold (AC2, FR17)', () => {
  it('true when current date passes the expected date with no future booking', () => {
    const jobs = [completed(LAST_DONE)]; // weekly → expected 07-08
    expect(goneCold('weekly', jobs, '2026-07-09')).toBe(true);
  });

  it('false on the expected date itself — cold only once the date has PASSED', () => {
    const jobs = [completed(LAST_DONE)]; // expected 07-08
    expect(goneCold('weekly', jobs, '2026-07-08')).toBe(false);
    expect(goneCold('weekly', jobs, '2026-07-07')).toBe(false);
  });

  it('latency scales per cadence with NO extra grace buffer: cold exactly one day past expected', () => {
    const jobs = [completed(LAST_DONE)];
    // weekly expected 07-08 → cold at 07-09; monthly expected 07-29 → NOT cold at 07-09.
    expect(goneCold('weekly', jobs, '2026-07-09')).toBe(true);
    expect(goneCold('monthly', jobs, '2026-07-09')).toBe(false);
    // monthly goes cold the day after its own (later) expected date — proportional.
    expect(goneCold('monthly', jobs, '2026-07-30')).toBe(true);
  });

  it('false when a future live booking exists, even well past the expected date', () => {
    const jobs = [completed(LAST_DONE), booked('2026-07-20')]; // future booked
    expect(goneCold('weekly', jobs, '2026-07-15')).toBe(false);
  });

  it('a booking dated today counts as on-file → not cold', () => {
    const jobs = [completed(LAST_DONE), booked('2026-07-15')];
    expect(goneCold('weekly', jobs, '2026-07-15')).toBe(false);
  });

  it('a future CANCELLED job does not suppress cold (not a live/consuming booking)', () => {
    const jobs = [completed(LAST_DONE), cancelled('2026-07-20')];
    expect(goneCold('weekly', jobs, '2026-07-15')).toBe(true);
  });

  it('a today/future NO-SHOW does not suppress cold — only `booked` is on-file (code review 2026-07-17)', () => {
    // The suppressor is `booked`-only, INTENTIONALLY narrower than capacity.consumesSlot
    // (which also includes no-show/completed). A no-show is the very lapse signal, so it
    // must NOT hide the lapse it represents.
    const todayNoShow = [completed(LAST_DONE), noShow('2026-07-15')]; // dated today
    expect(goneCold('weekly', todayNoShow, '2026-07-15')).toBe(true);
    const futureNoShow = [completed(LAST_DONE), noShow('2026-07-20')]; // dated later
    expect(goneCold('weekly', futureNoShow, '2026-07-15')).toBe(true);
    // control: a future BOOKED on the same date DOES suppress.
    expect(
      goneCold('weekly', [completed(LAST_DONE), booked('2026-07-20')], '2026-07-15'),
    ).toBe(false);
  });

  it('a PAST live booking (not yet completed) does not suppress cold — cold is about upcoming work', () => {
    const jobs = [completed(LAST_DONE), booked('2026-07-05')]; // 07-05 < today 07-15
    expect(goneCold('weekly', jobs, '2026-07-15')).toBe(true);
  });

  it('one-time client is never gone-cold (no expected date)', () => {
    expect(goneCold('one-time', [completed(LAST_DONE)], '2026-12-31')).toBe(false);
  });

  it('a client with no completed basis is never gone-cold', () => {
    expect(goneCold('weekly', [], '2026-12-31')).toBe(false);
    expect(goneCold('weekly', [booked('2026-07-01')], '2026-12-31')).toBe(false);
  });
});

describe('derive lapse — recomputed on read, never a stored flag (AC3, AD-7)', () => {
  it('booking a future slot flips goneCold false on the very next call — no invalidation', () => {
    const jobs = [completed(LAST_DONE)]; // weekly expected 07-08
    const today = '2026-07-15';
    expect(goneCold('weekly', jobs, today)).toBe(true);
    // Operator books a future slot: mutate the same array, recompute — now not cold.
    jobs.push(booked('2026-07-22'));
    expect(goneCold('weekly', jobs, today)).toBe(false);
    // Cancel it again → cold returns. Nothing was ever persisted.
    jobs[jobs.length - 1] = cancelled('2026-07-22');
    expect(goneCold('weekly', jobs, today)).toBe(true);
  });
});
