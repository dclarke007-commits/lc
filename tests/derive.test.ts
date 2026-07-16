// Story 1.7 — derive-on-read capacity (room-left, day-maxed, nearest-open).
// PURE unit tests: no DB, no clock mocking. Each function is a pure function of
// (jobs, config, anchorDate), so the AD-7 "recomputed on read, never a stored
// flag" guarantee is proven by mutating the in-memory jobs array between calls.

import { describe, it, expect } from 'vitest';
import {
  roomLeft,
  dayMaxed,
  nearestOpen,
  weekCapacity,
  type DeriveJob,
} from '../lib/domain/derive';
import { DEFAULT_CAPACITY, type CapacityConfig } from '../lib/domain/capacityConfig';

// Default config: Mon–Sat working, per-day 3, weekly 14 (FR1). Anchor inside a
// known Mon–Sun week: 2026-07-13 is a Monday, so the week is 07-13 .. 07-19 (Sun),
// next Monday 07-20. Weekdays: Mon13 Tue14 Wed15 Thu16 Fri17 Sat18 Sun19(non-working).
const cfg: CapacityConfig = DEFAULT_CAPACITY;
const MON = '2026-07-13';
const TUE = '2026-07-14';
const WED = '2026-07-15';
const SUN = '2026-07-19';

/** n consuming (booked) jobs on `date`. */
function booked(date: string, n: number): DeriveJob[] {
  return Array.from({ length: n }, () => ({ date, completion: 'booked' }));
}

describe('derive.roomLeft (AC1, FR26)', () => {
  it('empty book → full ceiling (14) of room', () => {
    expect(roomLeft([], cfg, WED)).toBe(14);
  });

  it('room-left = 14 − consuming this week, regardless of which day is anchored', () => {
    const jobs = [...booked(MON, 3), ...booked(TUE, 2)]; // 5 consuming this week
    expect(roomLeft(jobs, cfg, WED)).toBe(9);
    // Any anchor inside the same Mon–Sun week yields the same week figure.
    expect(roomLeft(jobs, cfg, SUN)).toBe(9);
  });

  it('no-show consumes, cancelled does NOT (AD-2 via consumesSlot)', () => {
    const jobs: DeriveJob[] = [
      { date: MON, completion: 'no-show' }, // consumes
      { date: MON, completion: 'completed' }, // consumes
      { date: TUE, completion: 'cancelled' }, // does NOT consume
    ];
    expect(roomLeft(jobs, cfg, WED)).toBe(12); // 14 − 2
  });

  it('clamps at 0 when an override pushes the week past the ceiling (no negative)', () => {
    const jobs = booked(MON, 3).concat(
      booked(TUE, 3),
      booked(WED, 3),
      booked('2026-07-16', 3),
      booked('2026-07-17', 3), // 15 consuming > 14
    );
    expect(roomLeft(jobs, cfg, WED)).toBe(0);
  });

  it('jobs in adjacent weeks do not count toward this week', () => {
    const jobs = [
      ...booked('2026-07-06', 3), // prior week
      ...booked('2026-07-20', 3), // next week
      ...booked(MON, 1), // this week
    ];
    expect(roomLeft(jobs, cfg, WED)).toBe(13);
  });
});

describe('derive.dayMaxed (AC2, FR27)', () => {
  it('true only at/over the per-day cap', () => {
    expect(dayMaxed(booked(TUE, 2), cfg, TUE)).toBe(false);
    expect(dayMaxed(booked(TUE, 3), cfg, TUE)).toBe(true);
    expect(dayMaxed(booked(TUE, 4), cfg, TUE)).toBe(true); // override past cap
  });

  it('counts only consuming jobs on that exact day', () => {
    const jobs: DeriveJob[] = [
      ...booked(TUE, 2),
      { date: TUE, completion: 'cancelled' }, // ignored
      ...booked(WED, 3), // other day, ignored for TUE
    ];
    expect(dayMaxed(jobs, cfg, TUE)).toBe(false); // only 2 consuming on TUE
    expect(dayMaxed(jobs, cfg, WED)).toBe(true);
  });
});

describe('derive.nearestOpen (AC3, FR28)', () => {
  it('surfaces the single next working day with room after a maxed day', () => {
    const jobs = booked(TUE, 3); // TUE maxed
    // Day after TUE is WED (working, empty) → nearest open is WED.
    expect(nearestOpen(jobs, cfg, TUE)).toEqual([WED]);
  });

  it('skips non-working days (Sunday) when scanning forward', () => {
    // Anchor Sat 07-18; Sun 07-19 is non-working, next working is Mon 07-20.
    expect(nearestOpen([], cfg, '2026-07-18')).toEqual(['2026-07-20']);
  });

  it('skips days that are themselves maxed', () => {
    const jobs = [...booked(TUE, 3), ...booked(WED, 3)]; // TUE & WED maxed
    expect(nearestOpen(jobs, cfg, TUE)).toEqual(['2026-07-16']); // THU
  });

  it('skips a day whose week is already at the ceiling, into the next week', () => {
    // Fill this week (07-13..07-18) to 14 consuming: 3+3+3+3+2 across Mon–Fri = 14.
    const jobs = booked(MON, 3).concat(
      booked(TUE, 3),
      booked(WED, 3),
      booked('2026-07-16', 3),
      booked('2026-07-17', 2), // week total = 14 (at ceiling)
    );
    // From Mon: every remaining day this week is blocked by the weekly ceiling;
    // the next room is Mon of the following week (07-20).
    expect(nearestOpen(jobs, cfg, MON)).toEqual(['2026-07-20']);
  });

  it('returns an array (never loops) when scanning a mostly-saturated horizon', () => {
    const monOnly: CapacityConfig = { ...cfg, workingDays: [1], weeklyCeiling: 1 };
    // Book several upcoming Mondays so near-term weeks are at ceiling; the bound
    // guarantees termination and a well-typed result either way.
    const jobs: DeriveJob[] = [
      { date: '2026-07-20', completion: 'booked' },
      { date: '2026-07-27', completion: 'booked' },
    ];
    expect(Array.isArray(nearestOpen(jobs, monOnly, MON))).toBe(true);
  });
});

describe('derive.weekCapacity (AC1+AC2 aggregate)', () => {
  it('builds only working days Mon→Sun with per-day maxed markers', () => {
    const jobs = [...booked(MON, 3), ...booked(TUE, 1)];
    const wk = weekCapacity(jobs, cfg, WED);
    expect(wk.weekStart).toBe(MON);
    expect(wk.weekEnd).toBe('2026-07-20');
    expect(wk.weeklyCeiling).toBe(14);
    expect(wk.consuming).toBe(4);
    expect(wk.roomLeft).toBe(10);
    expect(wk.over).toBe(0);
    // Mon–Sat only (6 working days); Sunday omitted.
    expect(wk.days.map((d) => d.isoWeekday)).toEqual([1, 2, 3, 4, 5, 6]);
    const mon = wk.days.find((d) => d.date === MON)!;
    expect(mon.consuming).toBe(3);
    expect(mon.maxed).toBe(true);
    const tue = wk.days.find((d) => d.date === TUE)!;
    expect(tue.maxed).toBe(false);
  });

  it('reports over-capacity (override) with roomLeft clamped at 0', () => {
    const jobs = booked(MON, 3).concat(
      booked(TUE, 3),
      booked(WED, 3),
      booked('2026-07-16', 3),
      booked('2026-07-17', 3), // 15 consuming
    );
    const wk = weekCapacity(jobs, cfg, WED);
    expect(wk.consuming).toBe(15);
    expect(wk.roomLeft).toBe(0);
    expect(wk.over).toBe(1);
  });
});

describe('derived on read — no stored flag (AD-7)', () => {
  it('cancelling a job (mutating the row set) frees room on the very next call', () => {
    const jobs: DeriveJob[] = [...booked(MON, 3)]; // MON maxed, 3 consuming
    expect(roomLeft(jobs, cfg, MON)).toBe(11);
    expect(dayMaxed(jobs, cfg, MON)).toBe(true);

    // Simulate a cancel: the row's completion flips to 'cancelled' (Story 1.6).
    // No derive state to invalidate — the next read simply recomputes.
    jobs[0].completion = 'cancelled';
    expect(roomLeft(jobs, cfg, MON)).toBe(12);
    expect(dayMaxed(jobs, cfg, MON)).toBe(false);
  });
});
