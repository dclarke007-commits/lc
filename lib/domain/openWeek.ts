// The owner's genuinely-open week (Story 1.7 derive), shared by BOTH booking
// surfaces (Story 4.1). The per-client view (booking.ts) and the public view
// (publicToken.ts) show the SAME availability — the ONLY difference is whether a
// client name is attached — so the capacity math lives here ONCE. Re-deriving it in
// two places is exactly the week-math duplication that caused a prior HIGH bug; keep
// this the single source (AD-2/AD-7).
//
// FAIL-CLOSED (code-review 3.1 P2): a corrupt/invalid config.timezone makes
// localDateKey's Intl.DateTimeFormat throw. On the PUBLIC surface that must never
// surface a 500 — it returns null and the caller renders the generic invalid-link.

import {
  getCapacitySettings,
  listJobsFrom,
} from '@/lib/db/queries';
import { DEFAULT_CAPACITY, type CapacityConfig } from '@/lib/domain/capacityConfig';
import { localDateKey, weekRangeOfDate } from '@/lib/domain/clock';
import { weekCapacity, nearestOpen } from '@/lib/domain/derive';

/** A genuinely-open day (day under cap AND week under ceiling). */
export interface OpenSlot {
  date: string; // operator-local 'YYYY-MM-DD'
  isoWeekday: number; // 1=Mon..7=Sun
}

/** The owner's open week — no client scope. */
export interface OwnerOpenWeek {
  timezone: string;
  weekStart: string; // Monday (inclusive)
  weekEnd: string; // next Monday (exclusive)
  openSlots: OpenSlot[]; // genuinely-open days this week (may be empty)
  nextOpen: string | null; // next open working day when this week has none
}

/**
 * Derive the owner's genuinely-open slots for the current operator week, owner-scoped
 * (AD-8). Config = the operator's persisted capacity, or the domain defaults on
 * first-run (single source, AR16). Returns null on ANY failure (fail-closed) so the
 * public/client surface renders one generic invalid-link, never a 500.
 */
export async function deriveOwnerOpenWeek(
  ownerId: string,
): Promise<OwnerOpenWeek | null> {
  try {
    const settings = await getCapacitySettings(ownerId);
    const config: CapacityConfig = settings
      ? {
          workingDays: settings.workingDays,
          perDayCap: settings.perDayCap,
          weeklyCeiling: settings.weeklyCeiling,
          defaultJobPriceCents: settings.defaultJobPriceCents,
          timezone: settings.timezone,
        }
      : DEFAULT_CAPACITY;

    const today = localDateKey(new Date(), config.timezone);
    const { monday } = weekRangeOfDate(today);
    const jobs = await listJobsFrom(ownerId, monday);
    const week = weekCapacity(jobs, config, today);

    const openSlots: OpenSlot[] = week.days
      .filter((d) => d.open)
      .map((d) => ({ date: d.date, isoWeekday: d.isoWeekday }));

    // When this week has no open day, offer the single next open working day (FR28).
    const nextOpen =
      openSlots.length === 0 ? (nearestOpen(jobs, config, today)[0] ?? null) : null;

    return {
      timezone: config.timezone,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      openSlots,
      nextOpen,
    };
  } catch (err) {
    console.error('[openWeek] owner open-week derivation failed', err);
    return null;
  }
}
