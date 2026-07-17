'use server';

// Story 1.7 — the dashboard's capacity read (FR26/FR27/FR28). Surfaces call THIS,
// never lib/db or lib/domain/derive directly: surfaces → actions → domain → db.
// Everything is DERIVED on read (AD-7) from canonical Job rows — no stored flag,
// no cron. The action resolves the owner's config + this-week-forward jobs, then
// hands them to the pure `derive` module. Reads only; no write path here.

import { getOwnerId, listJobsFrom } from '@/lib/db/queries';
import { getOwnerCapacity } from '@/app/(operator)/settings/actions';
import { localDateKey, weekRangeOfDate } from '@/lib/domain/clock';
import { weekCapacity, nearestOpen } from '@/lib/domain/derive';

/** One working day, plus the single next open day when this one is maxed (FR28). */
export interface DashboardDay {
  date: string; // 'YYYY-MM-DD'
  isoWeekday: number; // 1=Mon..7=Sun
  consuming: number;
  perDayCap: number;
  maxed: boolean; // per-day cap reached (FR27)
  past: boolean; // already elapsed (before today) — not bookable
  open: boolean; // bookable now: not past, under per-day cap AND week under ceiling
  nextOpen: string | null; // set only for a maxed, non-past day; null otherwise
}

/** The at-a-glance capacity view the dashboard renders (all derived on read). */
export interface DashboardCapacity {
  today: string; // operator-local 'YYYY-MM-DD'
  timezone: string;
  weekStart: string; // Monday (inclusive)
  weekEnd: string; // next Monday (exclusive)
  weeklyCeiling: number;
  perDayCap: number;
  consuming: number; // consuming jobs this week
  roomLeft: number; // clamped ≥ 0 (FR26)
  over: number; // amount past the ceiling via override (FR39); 0 normally
  days: DashboardDay[];
  weekNextOpen: string | null; // when the week is full, the next open day from today
}

/**
 * Capacity for the current operator-local week, derived on read (AD-7). Resolves
 * the owner FAIL-LOUD (an unresolved owner is a deploy-invariant violation — the
 * jobs read does the same), reads the persisted config (defaults on first run),
 * loads this-week-forward jobs, and computes room-left / day-maxed / nearest-open
 * via the pure derive module. The RSC surface stays dynamic (never `use cache`,
 * AD-13) so these values are live mid-call.
 */
export async function getDashboardCapacity(): Promise<DashboardCapacity> {
  // Config first — it carries the operator's timezone (AD-9), which decides what
  // "today"/"this week" mean. getOwnerCapacity throws on an unresolved owner; let
  // it propagate to the RSC error boundary rather than masking capacity as empty.
  const config = await getOwnerCapacity();

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[dashboard] getOwnerId failed (read path)', err);
    throw new Error('owner-unresolved');
  }

  const today = localDateKey(new Date(), config.timezone);
  const { monday } = weekRangeOfDate(today);

  // Bounded read: this week's Monday forward covers the current-week counts AND
  // the forward nearest-open scan. No history before this week is needed.
  const jobs = await listJobsFrom(ownerId, monday);

  const week = weekCapacity(jobs, config, today);

  const days: DashboardDay[] = week.days.map((d) => ({
    date: d.date,
    isoWeekday: d.isoWeekday,
    consuming: d.consuming,
    perDayCap: config.perDayCap,
    maxed: d.maxed,
    past: d.past,
    open: d.open,
    // FR28: when a maxed day is today or future, surface the single next open
    // working day. A PAST maxed day gets none — nearestOpen scans forward from the
    // day itself, which for a past day could otherwise point at an already-elapsed
    // (unbookable) date.
    nextOpen:
      d.maxed && !d.past ? (nearestOpen(jobs, config, d.date)[0] ?? null) : null,
  }));

  return {
    today,
    timezone: config.timezone,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    weeklyCeiling: week.weeklyCeiling,
    perDayCap: config.perDayCap,
    consuming: week.consuming,
    roomLeft: week.roomLeft,
    over: week.over,
    days,
    // When the whole week is full, offer the next open day measured from today.
    weekNextOpen:
      week.roomLeft === 0 ? (nearestOpen(jobs, config, today)[0] ?? null) : null,
  };
}
