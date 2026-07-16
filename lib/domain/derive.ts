// Story 1.7 — the READ-side twin of capacity.commitBooking. Derive-on-read
// (AD-7, verbatim): "A single `derive` module computes … `roomLeft` (via
// `consumesSlot`, AD-2), `dayMaxed`, all dashboard metrics … from canonical rows
// on every render … No stored derived flags, no cron, no background job."
//
// Pure domain module — NO framework imports, NO db. It takes an in-memory list of
// Job rows plus the operator's CapacityConfig and computes everything the capacity
// dashboard shows. Because it is a pure function of its inputs, the "recomputed on
// read, never a stored flag" guarantee is structural: cancel a job (its row stops
// consuming) and the very next call returns more room — nothing to invalidate.
//
// Two invariants meet here, each from its single source:
//   • AD-2 — which states consume a slot: capacity.consumesSlot (NEVER re-defined).
//   • AD-9 — the Mon–Sun operator-local week: clock.weekRangeOfDate (the one clock).

import { consumesSlot } from '@/lib/domain/capacity';
import type { CapacityConfig } from '@/lib/domain/capacityConfig';
import {
  addDaysToDate,
  isoWeekdayOfDate,
  weekRangeOfDate,
} from '@/lib/domain/clock';

/** The only Job fields derive reads. A projection keeps callers cheap (AD-8). */
export interface DeriveJob {
  date: string; // operator-local 'YYYY-MM-DD'
  completion: string;
}

/** One working day's capacity view, computed on read. */
export interface DayCapacity {
  date: string; // 'YYYY-MM-DD'
  isoWeekday: number; // 1=Mon..7=Sun
  consuming: number; // consuming jobs on this day (AD-2)
  maxed: boolean; // consuming >= perDayCap (FR27)
}

/** The current week's capacity view — the dashboard's primary read (FR26/27). */
export interface WeekCapacity {
  weekStart: string; // Monday date-key (inclusive)
  weekEnd: string; // next Monday date-key (exclusive)
  weeklyCeiling: number; // config ceiling (default 14)
  consuming: number; // consuming jobs this week (may exceed ceiling via override)
  roomLeft: number; // max(0, ceiling - consuming) — never negative (FR26)
  over: number; // max(0, consuming - ceiling) — the overbook amount (FR39)
  days: DayCapacity[]; // only the operator's WORKING days, Mon→Sun order
}

// nearest-open (FR28): future-facing, surface the SINGLE next working day with
// room (operator decision 2026-07-16). MAX_SCAN bounds the forward walk so a fully
// booked far horizon can never loop unbounded — it is a safety ceiling, not a
// product limit (with default count=1 the scan returns on the first open day).
const NEAREST_OPEN_DEFAULT_COUNT = 1;
const NEAREST_OPEN_MAX_WORKING_DAYS = 28;

/** consuming-job count per date-key (AD-2 predicate applied once). */
function consumingByDay(jobs: DeriveJob[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const j of jobs) {
    if (!consumesSlot(j)) continue;
    counts.set(j.date, (counts.get(j.date) ?? 0) + 1);
  }
  return counts;
}

/** Sum of consuming jobs across the Mon–Sun week starting at `monday`. */
function weekConsuming(byDay: Map<string, number>, monday: string): number {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    total += byDay.get(addDaysToDate(monday, i)) ?? 0;
  }
  return total;
}

/**
 * Does this specific calendar day still have room to book? True only when it is a
 * working day AND below the per-day cap AND its week is below the weekly ceiling.
 * The week gate matters: a day under its per-day cap in a week already at the
 * ceiling has no room (both caps must hold — same rule commitBooking enforces).
 */
function dayHasRoom(
  byDay: Map<string, number>,
  config: CapacityConfig,
  dateKey: string,
): boolean {
  if (!config.workingDays.includes(isoWeekdayOfDate(dateKey))) return false;
  if ((byDay.get(dateKey) ?? 0) >= config.perDayCap) return false;
  const { monday } = weekRangeOfDate(dateKey);
  if (weekConsuming(byDay, monday) >= config.weeklyCeiling) return false;
  return true;
}

/**
 * room-left for the Mon–Sun week containing `anchorDate` (FR26/AC1): the weekly
 * ceiling minus consuming jobs this week, clamped at 0 (an FR39 override can push
 * consuming past the ceiling — room can't go negative for display). Derived on
 * read from the passed rows; no stored counter (AD-7).
 */
export function roomLeft(
  jobs: DeriveJob[],
  config: CapacityConfig,
  anchorDate: string,
): number {
  const { monday } = weekRangeOfDate(anchorDate);
  const consuming = weekConsuming(consumingByDay(jobs), monday);
  return Math.max(0, config.weeklyCeiling - consuming);
}

/**
 * Is `dayDate` at or over its per-day cap (FR27/AC2)? Counts only consuming jobs
 * (AD-2) on that exact calendar day. Computed on read — no stored flag.
 */
export function dayMaxed(
  jobs: DeriveJob[],
  config: CapacityConfig,
  dayDate: string,
): boolean {
  const dayCount = consumingByDay(jobs).get(dayDate) ?? 0;
  return dayCount >= config.perDayCap;
}

/**
 * The nearest future working days with room, starting the day AFTER `fromDate`
 * (FR28/AC3). Future-facing only; skips non-working days and days whose week is
 * already at the ceiling (dayHasRoom). Returns up to `count` (default 1 — the
 * single next open day). Bounded by NEAREST_OPEN_MAX_WORKING_DAYS working days
 * examined so a saturated horizon returns [] rather than looping.
 */
export function nearestOpen(
  jobs: DeriveJob[],
  config: CapacityConfig,
  fromDate: string,
  count: number = NEAREST_OPEN_DEFAULT_COUNT,
): string[] {
  const byDay = consumingByDay(jobs);
  const open: string[] = [];
  let workingDaysSeen = 0;
  let delta = 1;
  while (
    open.length < count &&
    workingDaysSeen < NEAREST_OPEN_MAX_WORKING_DAYS
  ) {
    const candidate = addDaysToDate(fromDate, delta);
    if (config.workingDays.includes(isoWeekdayOfDate(candidate))) {
      workingDaysSeen++;
      if (dayHasRoom(byDay, config, candidate)) open.push(candidate);
    }
    delta++;
  }
  return open;
}

/**
 * The whole current-week capacity view in one derive call (FR26/FR27) — the
 * dashboard's primary read. Builds a DayCapacity for each of the operator's
 * WORKING days in the Mon–Sun week containing `anchorDate`, plus the week's
 * room-left / over figures. Non-working days are omitted (the operator does not
 * book them). Everything recomputed from `jobs` on read (AD-7).
 */
export function weekCapacity(
  jobs: DeriveJob[],
  config: CapacityConfig,
  anchorDate: string,
): WeekCapacity {
  const { monday, nextMonday } = weekRangeOfDate(anchorDate);
  const byDay = consumingByDay(jobs);

  const days: DayCapacity[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysToDate(monday, i);
    const isoWeekday = isoWeekdayOfDate(date);
    if (!config.workingDays.includes(isoWeekday)) continue;
    const consuming = byDay.get(date) ?? 0;
    days.push({
      date,
      isoWeekday,
      consuming,
      maxed: consuming >= config.perDayCap,
    });
  }

  const consuming = weekConsuming(byDay, monday);
  return {
    weekStart: monday,
    weekEnd: nextMonday,
    weeklyCeiling: config.weeklyCeiling,
    consuming,
    roomLeft: Math.max(0, config.weeklyCeiling - consuming),
    over: Math.max(0, consuming - config.weeklyCeiling),
    days,
  };
}
