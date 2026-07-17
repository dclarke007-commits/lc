// Story 1.3 — operator-local clock helper (AD-9). Pure unit tests, no DB. Covers
// the weekly-14 Mon–Sun boundary in the operator's local tz, including instants
// whose UTC day differs from their local day (both offset directions).
import { describe, it, expect } from 'vitest';
import {
  localDateKey,
  localISOWeekday,
  localWeekBounds,
  isWorkingDay,
} from '../lib/domain/clock';

describe('clock helper (Story 1.3, AD-9)', () => {
  // 2026-07-15T04:00:00Z is 2026-07-14 23:00 local in America/Chicago (CDT,
  // UTC-5): the UTC day (15th) differs from the local day (14th).
  const chicago = 'America/Chicago';
  const nightBeforeUtc = new Date('2026-07-15T04:00:00Z');

  it('localDateKey resolves the LOCAL calendar day, not the UTC day', () => {
    expect(localDateKey(nightBeforeUtc, chicago)).toBe('2026-07-14');
  });

  it('localISOWeekday returns Mon=1..Sun=7 in the local tz', () => {
    // 2026-07-14 local is a Tuesday → 2.
    expect(localISOWeekday(nightBeforeUtc, chicago)).toBe(2);
  });

  it('localWeekBounds resolves the Mon–Sun week (UTC day ≠ local day)', () => {
    // Local day is Tue 2026-07-14 → week Monday is 2026-07-13 local. In CDT
    // (UTC-5) Monday 00:00 local = 05:00Z; the following Monday 2026-07-20 too.
    const { startUtc, endUtc } = localWeekBounds(nightBeforeUtc, chicago);
    expect(startUtc).toBe('2026-07-13T05:00:00.000Z');
    expect(endUtc).toBe('2026-07-20T05:00:00.000Z');
  });

  it('an instant already on Monday-local lands in the same week', () => {
    // 2026-07-13T12:00:00Z = 07:00 local Monday → same week bounds.
    const { startUtc, endUtc } = localWeekBounds(
      new Date('2026-07-13T12:00:00Z'),
      chicago,
    );
    expect(startUtc).toBe('2026-07-13T05:00:00.000Z');
    expect(endUtc).toBe('2026-07-20T05:00:00.000Z');
  });

  it('a positive-offset tz flips the day the other way (Asia/Tokyo)', () => {
    // 2026-07-13T20:00:00Z is 2026-07-14 05:00 local in Tokyo (UTC+9): UTC day
    // 13th (Mon) but local day 14th (Tue).
    const tokyo = 'Asia/Tokyo';
    const instant = new Date('2026-07-13T20:00:00Z');
    expect(localDateKey(instant, tokyo)).toBe('2026-07-14');
    expect(localISOWeekday(instant, tokyo)).toBe(2); // Tuesday local

    // Week Monday = 2026-07-13 local. Tokyo Monday 00:00 local = 2026-07-12
    // 15:00Z; next Monday 2026-07-20 00:00 local = 2026-07-19 15:00Z.
    const { startUtc, endUtc } = localWeekBounds(instant, tokyo);
    expect(startUtc).toBe('2026-07-12T15:00:00.000Z');
    expect(endUtc).toBe('2026-07-19T15:00:00.000Z');
  });

  it('isWorkingDay reflects the local weekday against the working set', () => {
    // Default Mon–Sat = [1..6]. Local Tue (2) is a working day; Sun (7) is not.
    expect(isWorkingDay(nightBeforeUtc, chicago, [1, 2, 3, 4, 5, 6])).toBe(true);
    // 2026-07-19T12:00:00Z = 07:00 local Sunday in Chicago.
    expect(
      isWorkingDay(new Date('2026-07-19T12:00:00Z'), chicago, [1, 2, 3, 4, 5, 6]),
    ).toBe(false);
  });

  // --- DST / standard-time coverage (code-review 2026-07-16). The prior suite
  // only exercised CDT (summer, UTC-5); these pin the offset-varies-with-DST path
  // that Stories 1.4/1.6/1.7 lean on. ---

  it('resolves a standard-time (CST, UTC-6) week — winter offset differs from summer', () => {
    // 2026-01-14T12:00:00Z = 06:00 local Wed in Chicago (CST, UTC-6). Week Monday
    // = 2026-01-12; Monday 00:00 CST = 06:00Z (vs 05:00Z in CDT summer).
    const { startUtc, endUtc } = localWeekBounds(
      new Date('2026-01-14T12:00:00Z'),
      chicago,
    );
    expect(startUtc).toBe('2026-01-12T06:00:00.000Z');
    expect(endUtc).toBe('2026-01-19T06:00:00.000Z');
  });

  it('a spring-forward week is 167h long and stays Monday-aligned', () => {
    // Chicago springs forward Sun 2026-03-08 02:00→03:00. The week Mon 03-02 →
    // Mon 03-09 crosses it: start is CST (06:00Z), end is CDT (05:00Z) → 167h.
    const { startUtc, endUtc } = localWeekBounds(
      new Date('2026-03-04T12:00:00Z'),
      chicago,
    );
    expect(startUtc).toBe('2026-03-02T06:00:00.000Z');
    expect(endUtc).toBe('2026-03-09T05:00:00.000Z');
    const hours =
      (Date.parse(endUtc) - Date.parse(startUtc)) / 3_600_000;
    expect(hours).toBe(167);
  });

  it('a fall-back week is 169h long and stays Monday-aligned', () => {
    // Chicago falls back Sun 2026-11-01 02:00→01:00. Week Mon 10-26 (CDT, 05:00Z)
    // → Mon 11-02 (CST, 06:00Z) → 169h.
    const { startUtc, endUtc } = localWeekBounds(
      new Date('2026-10-28T12:00:00Z'),
      chicago,
    );
    expect(startUtc).toBe('2026-10-26T05:00:00.000Z');
    expect(endUtc).toBe('2026-11-02T06:00:00.000Z');
    const hours =
      (Date.parse(endUtc) - Date.parse(startUtc)) / 3_600_000;
    expect(hours).toBe(169);
  });

  it('a week whose Monday-midnight is a spring-forward GAP lands on Monday, not the day before', () => {
    // Regression for the DST-gap bug: Asia/Tehran sprang forward at Mon
    // 2021-03-22 00:00 local (→01:00, +03:30→+04:30), so Monday 00:00 does NOT
    // exist. The boundary must resolve FORWARD to the first real instant of that
    // Monday — never back onto Sunday 2021-03-21 (the previous week).
    const tehran = 'Asia/Tehran';
    const midWeek = new Date('2021-03-24T12:00:00Z'); // Wed of that week
    const { startUtc } = localWeekBounds(midWeek, tehran);
    const start = new Date(startUtc);
    expect(localISOWeekday(start, tehran)).toBe(1); // Monday
    expect(localDateKey(start, tehran)).toBe('2021-03-22');
  });
});
