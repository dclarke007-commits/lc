'use server';

// Story 1.7 — the dashboard's capacity read (FR26/FR27/FR28). Surfaces call THIS,
// never lib/db or lib/domain/derive directly: surfaces → actions → domain → db.
// Everything is DERIVED on read (AD-7) from canonical Job rows — no stored flag,
// no cron. The action resolves the owner's config + this-week-forward jobs, then
// hands them to the pure `derive` module. Reads only; no write path here.

import { cache } from 'react';
import {
  getOwnerId,
  listJobsFrom,
  listJobsForMetrics,
  listClients,
  listLedgerJobs,
  listInquiries,
} from '@/lib/db/queries';
import { getOwnerCapacity } from '@/app/(operator)/settings/actions';
import { localDateKey, weekRangeOfDate } from '@/lib/domain/clock';
import {
  weekCapacity,
  nearestOpen,
  monthlyRevenue,
  repeatBookingRate,
  repeatVsLapsedCounts,
  outstanding,
  inquiryConversion,
  oneTimeToRepeat,
  caughtColdThisWeek,
  type DeriveJob,
  type ClientLifecycle,
} from '@/lib/domain/derive';

// Request-scoped de-dupe (Story 6.2): getDashboardMetrics AND getLeakIndicators both
// run during the SAME dashboard render and read the same lean projections. React
// `cache()` collapses each into one DB round-trip per request. Request-scoped, NOT
// `use cache` — an operator surface stays live mid-call (AD-13); a later render re-reads.
const metricsJobsCached = cache((ownerId: string) => listJobsForMetrics(ownerId));
const clientsCached = cache((ownerId: string) => listClients(ownerId));
const inquiriesCached = cache((ownerId: string) => listInquiries(ownerId));

/** Group the owner's jobs per client and pair with each client's cadence — the
 *  ClientLifecycle shape the repeat/lapsed, one-time→repeat, and caught-cold derives
 *  all consume. Built once from the two shared reads. */
function buildLifecycles(
  clients: { id: string; cadence: ClientLifecycle['cadence'] }[],
  jobs: { clientId: string; date: string; completion: string }[],
): ClientLifecycle[] {
  const byClient = new Map<string, DeriveJob[]>();
  for (const j of jobs) {
    const list = byClient.get(j.clientId) ?? [];
    list.push({ date: j.date, completion: j.completion });
    byClient.set(j.clientId, list);
  }
  return clients.map((c) => ({ cadence: c.cadence, jobs: byClient.get(c.id) ?? [] }));
}

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

// --- Story 6.1: single-screen dashboard metrics (FR22, AR8/AD-7) -----------------

/** The dashboard's honest numbers — every field maps to a leak or a cash/capacity
 *  decision (FR25, NFR1), all derived on read. */
export interface DashboardMetrics {
  // Capacity decision: how full is this week (utilization = consuming ÷ ceiling).
  consuming: number;
  weeklyCeiling: number;
  // Revenue trajectory (cash decision), operator-local months.
  revenueThisMonthCents: number;
  revenueLastMonthCents: number;
  revenueDeltaCents: number;
  // Payment leak: the outstanding float.
  outstandingTotalCents: number;
  // Retention: repeat vs. lapsed COUNTS (Story 6.1) — distinct from 6.2 rates.
  repeatCount: number;
  lapsedCount: number;
  // North-star (AR19, addendum-F): null when no completed jobs in the 30-day window
  // (the surface renders "—" — "no data" is not "0%", FR25).
  repeatRate: number | null;
}

/**
 * The dashboard's core metrics, derived on read (AD-7). Surfaces call THIS, never
 * lib/db or lib/domain directly (surfaces → actions → domain → db). Owner resolved
 * FAIL-LOUD — an unresolved owner is a deploy-invariant violation, not an empty
 * dashboard. Reads three lean, owner-scoped projections (AR9) and hands them to pure
 * derives:
 *   • listJobsForMetrics → utilization (weekCapacity, reusing consumesSlot/AD-2),
 *     month-over-month revenue, the addendum-F repeat rate, and — grouped by client
 *     with each client's cadence — the repeat/lapsed counts.
 *   • listClients        → the cadence each lapse check needs.
 *   • listLedgerJobs     → the outstanding float (the canonical Story 5.2 seam).
 * The RSC surface stays dynamic (never `use cache`, AD-13) so the numbers are live.
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const config = await getOwnerCapacity(); // carries the operator tz (AD-9)

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[dashboard] getOwnerId failed (metrics read)', err);
    throw new Error('owner-unresolved');
  }

  const now = new Date();
  const today = localDateKey(now, config.timezone);

  const [metricsJobs, clients, ledgerJobs] = await Promise.all([
    metricsJobsCached(ownerId),
    clientsCached(ownerId),
    listLedgerJobs(ownerId),
  ]);

  // Utilization reuses the canonical week math (consumesSlot/AD-2) over full history;
  // weekCapacity filters to the current operator-local week internally.
  const week = weekCapacity(metricsJobs, config, today);

  const revenue = monthlyRevenue(metricsJobs, now, config.timezone);
  const repeatRate = repeatBookingRate(metricsJobs, now);

  // Group jobs per client for the lapse/repeat split; pair with each client's cadence.
  const lifecycles = buildLifecycles(clients, metricsJobs);
  const counts = repeatVsLapsedCounts(lifecycles, today);

  return {
    consuming: week.consuming,
    weeklyCeiling: week.weeklyCeiling,
    revenueThisMonthCents: revenue.thisMonthCents,
    revenueLastMonthCents: revenue.lastMonthCents,
    revenueDeltaCents: revenue.deltaCents,
    outstandingTotalCents: outstanding(ledgerJobs).totalCents,
    repeatCount: counts.repeat,
    lapsedCount: counts.lapsed,
    repeatRate,
  };
}

// --- Story 6.2: the three leak indicators (FR24, AR19/AD-7) -----------------------

/** The three leak-indicator RATES the dashboard surfaces front-and-center (FR24). Each
 *  ratio is `null` when its denominator is 0 (the surface renders "—"; "no data" ≠ "0%",
 *  FR25). The raw numerator/denominator ride along so the surface can show "3 / 12". */
export interface LeakIndicators {
  // Inquiry → booking: are inbound asks turning into booked work? (Epic 4 leak.)
  inquiryBookings: number;
  inquiryCount: number;
  inquiryRate: number | null;
  // One-time → repeat: are one-timers coming back? (Epic 3 leak.)
  oneTimeClients: number;
  oneTimeConverted: number;
  oneTimeRate: number | null;
  // Regulars caught cold THIS WEEK: the act-now count of just-slipped regulars.
  caughtColdThisWeek: number;
}

/**
 * The three leak indicators, derived on read (AD-7). Surfaces call THIS, never lib/db or
 * lib/domain directly. Owner resolved FAIL-LOUD (an unresolved owner is a deploy-invariant
 * violation, not an empty dashboard). Reads three owner-scoped projections (AR9) — jobs,
 * clients, inquiries — SHARED with getDashboardMetrics via request-scoped `cache()`, so the
 * two dashboard actions add no extra DB round-trips. Hands them to the pure 6.2 derives:
 *   • inquiryConversion(jobs, inquiries)  → inquiry→booking (bookings ÷ distinct inquiries)
 *   • oneTimeToRepeat(lifecycles)         → one-time clients who booked again ÷ one-time
 *   • caughtColdThisWeek(lifecycles, today) → regulars whose lapse flag raised this week
 * The RSC surface stays dynamic (never `use cache`, AD-13) so the numbers are live.
 */
export async function getLeakIndicators(): Promise<LeakIndicators> {
  const config = await getOwnerCapacity(); // carries the operator tz (AD-9)

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[dashboard] getOwnerId failed (leak indicators read)', err);
    throw new Error('owner-unresolved');
  }

  const today = localDateKey(new Date(), config.timezone);

  const [metricsJobs, clients, inquiries] = await Promise.all([
    metricsJobsCached(ownerId),
    clientsCached(ownerId),
    inquiriesCached(ownerId),
  ]);

  const inquiry = inquiryConversion(metricsJobs, inquiries);
  const lifecycles = buildLifecycles(clients, metricsJobs);
  const oneTime = oneTimeToRepeat(lifecycles);
  const caughtCold = caughtColdThisWeek(lifecycles, today);

  return {
    inquiryBookings: inquiry.bookings,
    inquiryCount: inquiry.inquiries,
    inquiryRate: inquiry.ratio,
    oneTimeClients: oneTime.oneTime,
    oneTimeConverted: oneTime.converted,
    oneTimeRate: oneTime.ratio,
    caughtColdThisWeek: caughtCold,
  };
}
