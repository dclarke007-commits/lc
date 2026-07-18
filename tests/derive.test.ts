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
  distinctInquiryCount,
  isLedgerEligible,
  outstanding,
  monthlyRevenue,
  repeatBookingRate,
  repeatVsLapsedCounts,
  type DeriveJob,
  type LedgerJob,
  type RevenueJob,
  type RepeatRateJob,
  type ClientLifecycle,
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

describe('derive.isLedgerEligible (Story 5.1, FR29/AR11)', () => {
  it('a completed job IS ledger-eligible', () => {
    expect(isLedgerEligible({ completion: 'completed' })).toBe(true);
  });

  it('booked / no-show / cancelled are NOT ledger-eligible', () => {
    expect(isLedgerEligible({ completion: 'booked' })).toBe(false);
    expect(isLedgerEligible({ completion: 'no-show' })).toBe(false);
    expect(isLedgerEligible({ completion: 'cancelled' })).toBe(false);
  });

  it('gates on completion, NOT payment: a booked job carrying owed is still ineligible', () => {
    // A new booking defaults to payment 'owed' (schema) while still `booked`;
    // eligibility must ignore `payment` entirely and key only on completion (AR11).
    expect(
      isLedgerEligible({ completion: 'booked', payment: 'owed' } as {
        completion: string;
      }),
    ).toBe(false);
  });

  it('amount is the per-job priceCents snapshot, independent of the config default', () => {
    // The ledger reads the job's frozen priceCents (stamped at booking), never the
    // operator's current defaultJobPriceCents — re-pricing never rewrites history.
    const completedJob = { completion: 'completed', priceCents: 15000 };
    expect(isLedgerEligible(completedJob)).toBe(true);
    expect(completedJob.priceCents).toBe(15000);
  });
});

describe('derive.outstanding — who owes (Story 5.2, FR30/AR8)', () => {
  const ledgerJob = (o: Partial<LedgerJob>): LedgerJob => ({
    clientId: 'c1',
    clientName: 'Ann',
    completion: 'completed',
    payment: 'owed',
    priceCents: 10000,
    ...o,
  });

  it('empty book → zero total, no owers', () => {
    expect(outstanding([])).toEqual({ totalCents: 0, clients: [] });
  });

  it('sums only completed+owed jobs (integer cents)', () => {
    const total = outstanding([
      ledgerJob({ priceCents: 10000 }),
      ledgerJob({ priceCents: 5500 }),
    ]);
    expect(total.totalCents).toBe(15500);
    expect(total.clients).toHaveLength(1);
    expect(total.clients[0]).toMatchObject({ owedCents: 15500, jobCount: 2 });
  });

  it('excludes completed+paid (already settled)', () => {
    expect(
      outstanding([ledgerJob({ payment: 'paid', priceCents: 9999 })]).totalCents,
    ).toBe(0);
  });

  it('excludes non-completed owed jobs — no phantom debt (AR11)', () => {
    const jobs: LedgerJob[] = [
      ledgerJob({ completion: 'booked', payment: 'owed' }),
      ledgerJob({ completion: 'no-show', payment: 'owed' }),
      ledgerJob({ completion: 'cancelled', payment: 'owed' }),
    ];
    expect(outstanding(jobs)).toEqual({ totalCents: 0, clients: [] });
  });

  it('groups by client and sorts by owedCents desc (name tiebreak)', () => {
    const res = outstanding([
      ledgerJob({ clientId: 'a', clientName: 'Ann', priceCents: 5000 }),
      ledgerJob({ clientId: 'b', clientName: 'Bob', priceCents: 12000 }),
      ledgerJob({ clientId: 'a', clientName: 'Ann', priceCents: 3000 }),
    ]);
    expect(res.totalCents).toBe(20000);
    expect(res.clients.map((c) => c.clientId)).toEqual(['b', 'a']); // Bob 12000 > Ann 8000
    expect(res.clients[1]).toMatchObject({ owedCents: 8000, jobCount: 2 });
  });

  it('is derived on read — mutating the input reflects immediately (AD-7)', () => {
    const jobs = [ledgerJob({ priceCents: 10000 })];
    expect(outstanding(jobs).totalCents).toBe(10000);
    jobs[0].payment = 'paid'; // settle it
    expect(outstanding(jobs).totalCents).toBe(0); // no stored total to invalidate
  });
});

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

  it('returns [] and terminates when workingDays is empty (review P3 — no infinite loop)', () => {
    expect(nearestOpen([], { ...cfg, workingDays: [] }, MON)).toEqual([]);
  });

  it('returns [] and terminates when workingDays holds no valid weekday (review P3)', () => {
    expect(nearestOpen([], { ...cfg, workingDays: [8] }, MON)).toEqual([]);
  });

  it('terminates on a single-working-day config where near weeks are full', () => {
    const monOnly: CapacityConfig = { ...cfg, workingDays: [1], weeklyCeiling: 1 };
    const jobs: DeriveJob[] = [
      { date: '2026-07-20', completion: 'booked' }, // next Monday full
    ];
    // 2026-07-27 (the following Monday) is the first open working day.
    expect(nearestOpen(jobs, monOnly, MON)).toEqual(['2026-07-27']);
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

describe('derive.weekCapacity past / open (review P2)', () => {
  it('days before the anchor are past and never open; the anchor day is not past', () => {
    const wk = weekCapacity([], cfg, WED); // anchor Wednesday
    const mon = wk.days.find((d) => d.date === MON)!;
    expect(mon.past).toBe(true);
    expect(mon.open).toBe(false); // elapsed → not bookable
    const wed = wk.days.find((d) => d.date === WED)!;
    expect(wed.past).toBe(false);
    expect(wed.open).toBe(true);
  });

  it('a day under its per-day cap but in a ceiling-full week is NOT open', () => {
    const jobs = booked(MON, 3).concat(
      booked(TUE, 3),
      booked(WED, 3),
      booked('2026-07-16', 3),
      booked('2026-07-17', 2), // week total = 14 (at ceiling); Sat 07-18 empty
    );
    const wk = weekCapacity(jobs, cfg, MON); // anchor Monday → nothing past
    const sat = wk.days.find((d) => d.date === '2026-07-18')!;
    expect(sat.consuming).toBe(0);
    expect(sat.maxed).toBe(false); // under per-day cap
    expect(sat.open).toBe(false); // but the week is full → not bookable
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

// Story 4.4 (AC2, AR12) — the pure distinct-inquiry denominator. distinct =
// (distinct non-null clientIds) + (rows with a null clientId). A `link` auto-log and a
// manual log for the SAME client collapse to one; anonymous null-client rows each count.
describe('derive.distinctInquiryCount (AC2, AR12)', () => {
  it('empty → 0', () => {
    expect(distinctInquiryCount([])).toBe(0);
  });

  it('a link inquiry + a manual inquiry for the SAME client → 1', () => {
    // The core AR12 dedup: the 4.2 auto-`link` row and the 4.4 manual row both carry
    // the same clientId, so that one contact is not double-counted.
    expect(
      distinctInquiryCount([{ clientId: 'c1' }, { clientId: 'c1' }]),
    ).toBe(1);
  });

  it('two different clients → 2', () => {
    expect(
      distinctInquiryCount([{ clientId: 'c1' }, { clientId: 'c2' }]),
    ).toBe(2);
  });

  it('two null-client (anonymous) rows → 2', () => {
    // Anonymous verbal inquiries can't be matched to anyone, so each counts once.
    expect(
      distinctInquiryCount([{ clientId: null }, { clientId: null }]),
    ).toBe(2);
  });

  it('mixed: 2 rows for c1 + 1 for c2 + 2 anonymous → 4', () => {
    expect(
      distinctInquiryCount([
        { clientId: 'c1' },
        { clientId: 'c1' },
        { clientId: 'c2' },
        { clientId: null },
        { clientId: null },
      ]),
    ).toBe(4); // distinct clients {c1,c2}=2 + 2 anonymous
  });
});

// --- Story 6.1: dashboard core metrics -------------------------------------------
// Chicago is UTC-5 during July DST, which lets a UTC instant just after midnight fall
// into the PREVIOUS local calendar day/month — the case AD-9 (operator-local) exists for.
const TZ = 'America/Chicago';

describe('derive.monthlyRevenue (Story 6.1, FR22/AR8)', () => {
  const now = new Date('2026-07-15T12:00:00Z'); // local July → this=2026-07, last=2026-06

  it('sums ledger-eligible amounts into this vs last operator-local month', () => {
    const jobs: RevenueJob[] = [
      { completion: 'completed', completedAt: '2026-07-10T12:00:00Z', priceCents: 20000 }, // this
      { completion: 'completed', completedAt: '2026-06-20T12:00:00Z', priceCents: 15000 }, // last
    ];
    expect(monthlyRevenue(jobs, now, TZ)).toEqual({
      thisMonthCents: 20000,
      lastMonthCents: 15000,
      deltaCents: 5000,
    });
  });

  it('buckets by operator-local month, not UTC (AD-9)', () => {
    // 2026-08-01T04:30Z is 2026-07-31 23:30 in Chicago → counts as THIS month (July).
    const jobs: RevenueJob[] = [
      { completion: 'completed', completedAt: '2026-08-01T04:30:00Z', priceCents: 5000 },
    ];
    expect(monthlyRevenue(jobs, now, TZ).thisMonthCents).toBe(5000);
  });

  it('excludes no-show / cancelled / booked (not ledger-eligible) and out-of-window months', () => {
    const jobs: RevenueJob[] = [
      { completion: 'no-show', completedAt: '2026-07-05T12:00:00Z', priceCents: 99999 },
      { completion: 'cancelled', completedAt: '2026-07-05T12:00:00Z', priceCents: 99999 },
      { completion: 'booked', completedAt: null, priceCents: 99999 },
      { completion: 'completed', completedAt: '2026-05-01T12:00:00Z', priceCents: 99999 }, // May
    ];
    expect(monthlyRevenue(jobs, now, TZ)).toEqual({
      thisMonthCents: 0,
      lastMonthCents: 0,
      deltaCents: 0,
    });
  });

  it('handles the January → previous-December year rollover', () => {
    const jan = new Date('2027-01-10T12:00:00Z');
    const jobs: RevenueJob[] = [
      { completion: 'completed', completedAt: '2026-12-20T12:00:00Z', priceCents: 8000 },
    ];
    expect(monthlyRevenue(jobs, jan, TZ).lastMonthCents).toBe(8000);
  });
});

describe('derive.repeatBookingRate — addendum-F rolling 30-day (Story 6.1, AR19)', () => {
  const now = new Date('2026-07-31T12:00:00Z'); // window: (2026-07-01T12:00Z, 2026-07-31T12:00Z]

  it('null (not 0) when no completed jobs in the window', () => {
    const jobs: RepeatRateJob[] = [
      { clientId: 'c1', completion: 'booked', completedAt: null, createdAt: '2026-07-10T12:00:00Z' },
      // completed but BEFORE the window
      { clientId: 'c2', completion: 'completed', completedAt: '2026-05-01T12:00:00Z', createdAt: '2026-05-01T12:00:00Z' },
    ];
    expect(repeatBookingRate(jobs, now)).toBeNull();
  });

  it('same-client follow-on within 30 days counts; a lone completion does not', () => {
    const jobs: RepeatRateJob[] = [
      // c1 completed in window + a follow-on booking created 10 days later → numerator
      { clientId: 'c1', completion: 'completed', completedAt: '2026-07-10T12:00:00Z', createdAt: '2026-07-10T12:00:00Z' },
      { clientId: 'c1', completion: 'booked', completedAt: null, createdAt: '2026-07-20T12:00:00Z' },
      // c2 completed in window, no follow-on → denominator only
      { clientId: 'c2', completion: 'completed', completedAt: '2026-07-15T12:00:00Z', createdAt: '2026-07-15T12:00:00Z' },
    ];
    expect(repeatBookingRate(jobs, now)).toBe(0.5);
  });

  it('follow-on at exactly +30d counts (inclusive); +30d+1ms does not', () => {
    const inclusive: RepeatRateJob[] = [
      { clientId: 'c1', completion: 'completed', completedAt: '2026-07-10T00:00:00Z', createdAt: '2026-07-10T00:00:00Z' },
      { clientId: 'c1', completion: 'booked', completedAt: null, createdAt: '2026-08-09T00:00:00Z' }, // +30d exactly
    ];
    expect(repeatBookingRate(inclusive, now)).toBe(1);

    const justOver: RepeatRateJob[] = [
      { clientId: 'c1', completion: 'completed', completedAt: '2026-07-10T00:00:00Z', createdAt: '2026-07-10T00:00:00Z' },
      { clientId: 'c1', completion: 'booked', completedAt: null, createdAt: '2026-08-09T00:00:00.001Z' }, // +30d +1ms
    ];
    expect(repeatBookingRate(justOver, now)).toBe(0);
  });

  it('a booking predating the completion is not a re-book of it', () => {
    const jobs: RepeatRateJob[] = [
      { clientId: 'c1', completion: 'completed', completedAt: '2026-07-20T12:00:00Z', createdAt: '2026-07-20T12:00:00Z' },
      // created BEFORE the completion instant → does not count
      { clientId: 'c1', completion: 'booked', completedAt: null, createdAt: '2026-07-01T13:00:00Z' },
    ];
    expect(repeatBookingRate(jobs, now)).toBe(0);
  });
});

describe('derive.repeatVsLapsedCounts (Story 6.1, FR22)', () => {
  const today = '2026-07-15';

  it('counts repeat (>=2 completed) and lapsed (gone-cold) independently', () => {
    const clients: ClientLifecycle[] = [
      // repeat (2 completed) AND not lapsed (has a future booking) → repeat only
      {
        cadence: 'weekly',
        jobs: [
          { date: '2026-05-01', completion: 'completed' },
          { date: '2026-05-08', completion: 'completed' },
          { date: '2026-07-20', completion: 'booked' },
        ],
      },
      // 1 completed, no future → gone-cold → lapsed only
      { cadence: 'weekly', jobs: [{ date: '2026-06-01', completion: 'completed' }] },
      // one-time, 1 completed → neither (never cold, not repeat)
      { cadence: 'one-time', jobs: [{ date: '2026-06-01', completion: 'completed' }] },
    ];
    expect(repeatVsLapsedCounts(clients, today)).toEqual({ repeat: 1, lapsed: 1 });
  });

  it('empty client list → zeros', () => {
    expect(repeatVsLapsedCounts([], today)).toEqual({ repeat: 0, lapsed: 0 });
  });
});
