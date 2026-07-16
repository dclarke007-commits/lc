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
  localWeekBounds,
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
  past: boolean; // date < the anchor (today) — already elapsed, not bookable
  open: boolean; // actually bookable: not past, under per-day cap AND week under ceiling
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
// Hard calendar backstop: even a config with a single working day per week reaches
// 28 working days within this many calendar days. Bounding the WALK (not only
// working-days-seen) guarantees termination when workingDays is empty or holds no
// valid weekday — otherwise workingDaysSeen never increments and the loop spins.
const NEAREST_OPEN_MAX_SCAN_DAYS = NEAREST_OPEN_MAX_WORKING_DAYS * 7;

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
    workingDaysSeen < NEAREST_OPEN_MAX_WORKING_DAYS &&
    delta <= NEAREST_OPEN_MAX_SCAN_DAYS
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
  const consuming = weekConsuming(byDay, monday);
  // The weekly ceiling gates EVERY day: a day under its per-day cap in a week
  // that is already full is not bookable (same rule commitBooking enforces).
  const weekUnderCeiling = consuming < config.weeklyCeiling;

  const days: DayCapacity[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysToDate(monday, i);
    const isoWeekday = isoWeekdayOfDate(date);
    if (!config.workingDays.includes(isoWeekday)) continue;
    const dayConsuming = byDay.get(date) ?? 0;
    const maxed = dayConsuming >= config.perDayCap;
    // `anchorDate` is "today" for the dashboard — a day before it has elapsed and
    // is not bookable (commitBooking rejects past dates), so it is never "open".
    const past = date < anchorDate;
    days.push({
      date,
      isoWeekday,
      consuming: dayConsuming,
      maxed,
      past,
      open: !past && !maxed && weekUnderCeiling,
    });
  }

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

// --- Story 3.3: forward rebooking-slot proposal (derived on read) ---
//
// The forward twin of the nearest-open scan: given the anchor job's date and the
// client's cadence, propose the next slot to offer. PURE (AD-7) — a function of the
// passed rows/config, no db, no stored forecast, no cron. It NEVER throws (AC3):
// when the bounded scan finds no open day it returns { slot: null } for the surface
// to render gracefully. Openness is judged with derive's OWN reads (weekCapacity +
// nearestOpen), which already route through capacity.consumesSlot (AD-2) — capacity
// is never re-derived here. The gone-cold / expectedNextDate lapse twin is Story 3.5.

/** Cadence enum's proposable clients (one-time has no interval). Client.cadence type. */
export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'one-time';

/**
 * Cadence → day-count interval, operator-local (AD-9). biweekly = 14d, monthly = 28d
 * (a stable 4-week interval, NOT a calendar month — keeps lapse (3.5) and rebooking
 * agreeing on one arithmetic). `one-time` has NO interval and is absent here.
 */
export const CADENCE_INTERVAL_DAYS: Record<
  'weekly' | 'biweekly' | 'monthly',
  number
> = {
  weekly: 7,
  biweekly: 14,
  monthly: 28,
};

/**
 * Propose the slot at/after `start` (inclusive): the start day itself if it is
 * genuinely open, else the nearest open day AFTER it via Story 1.7's forward scan.
 * Start-day openness reuses derive's OWN weekCapacity `open` (working day AND not
 * day-maxed AND week under ceiling — computed via consumesSlot, AD-2); the fallback
 * is nearestOpen (which starts the day after `start`), so together they cover
 * "at/after start" with no re-implemented scan and no re-derived capacity.
 */
function proposeFromStart(
  jobs: DeriveJob[],
  config: CapacityConfig,
  start: string,
): string | null {
  // weekCapacity computes `open` for each WORKING day of start's week, anchored at
  // `start` (so start itself is never "past"). A non-working start day is simply
  // absent from days → treated as not open → fall through to the forward scan.
  const startDay = weekCapacity(jobs, config, start).days.find(
    (d) => d.date === start,
  );
  if (startDay?.open) return start;
  return nearestOpen(jobs, config, start)[0] ?? null;
}

export interface ProposeRebookInput {
  cadence: Cadence;
  anchorDate: string; // the anchor job's operator-local 'YYYY-MM-DD'
  jobs: DeriveJob[];
  config: CapacityConfig;
  today: string; // operator-local 'YYYY-MM-DD' — never propose a day before this
}

/**
 * The one-tap rebooking proposal (FR10/AC1/AC3). For a CADENCED client the ideal
 * slot is the cadence interval past the anchor job, clamped forward so a past ideal
 * never surfaces (start = max(target, today)); the actual proposal is that start day
 * if open, else the nearest open ALTERNATIVE (AC3 — a full ideal slot yields the
 * nearest open day, never a failure). For a ONE-TIME client there is no interval —
 * propose the soonest open slot at/after today (the one-time→repeat conversion, FR10).
 * Returns { slot: null } only when the bounded scan window holds no open day; NEVER
 * throws.
 */
export function proposeRebookSlot(input: ProposeRebookInput): {
  slot: string | null;
} {
  const { cadence, anchorDate, jobs, config, today } = input;

  // One-time: no cadence interval — the soonest open slot from today (FR10).
  if (cadence === 'one-time') {
    return { slot: proposeFromStart(jobs, config, today) };
  }

  // Defensive (code-review P5): if the Cadence enum ever grows a member without a
  // matching CADENCE_INTERVAL_DAYS entry, `interval` is undefined at runtime and
  // addDaysToDate(anchor, undefined) yields "NaN-NaN-NaN". Degrade to the one-time
  // soonest-open path (same as `one-time`) so it fails safe, never a garbage slot.
  const interval = CADENCE_INTERVAL_DAYS[cadence];
  if (interval == null) return { slot: proposeFromStart(jobs, config, today) };

  // Cadenced: the cadence interval past the anchor, never earlier than today. Both
  // are 'YYYY-MM-DD', so the lexical max is the calendar max.
  const target = addDaysToDate(anchorDate, interval);
  const start = target < today ? today : target;
  return { slot: proposeFromStart(jobs, config, start) };
}

// --- Story 2.3: nudge-fatigue (derived on read from MessageLog.dispatched_at) ---

/**
 * The only MessageLog fields nudge-fatigue reads. A DISPATCHED row (dispatched_at
 * non-null); `queries.listDispatchedMessages` already excludes unsent drafts, so a
 * draft never counts. Structurally a subset of that db projection.
 */
export interface NudgeMessage {
  clientId: string;
  dispatchedAt: string; // UTC instant (ISO-8601 or Postgres timestamptz text)
}

/**
 * How many messages were DISPATCHED to `clientId` in the operator-local Mon–Sun week
 * containing `anchor` (AC3/FR21). Reads ONLY dispatched_at — an unsent draft never
 * counts. The week window is the SAME operator-local Mon–Sun boundary capacity uses
 * (clock.localWeekBounds, AD-9), so fatigue-weeks and capacity-weeks never drift.
 * Derived on read (AD-7): a pure function of the passed rows — no stored counter, no
 * cron. Mutate the input array and the very next call reflects it.
 *
 * dispatched_at (UTC) and the week bounds are compared as INSTANTS (epoch ms), never
 * as strings: Postgres timestamptz ("…+00") and ISO ("…Z") are the same instant in
 * different text, so a lexical compare across the two formats would be wrong.
 */
export function nudgeFatigueForClient(
  messages: NudgeMessage[],
  tz: string,
  clientId: string,
  anchor: Date,
): number {
  const { startUtc, endUtc } = localWeekBounds(anchor, tz);
  const start = new Date(startUtc).getTime();
  const end = new Date(endUtc).getTime();
  let count = 0;
  for (const m of messages) {
    if (m.clientId !== clientId) continue;
    const t = new Date(m.dispatchedAt).getTime();
    if (t >= start && t < end) count++;
  }
  return count;
}

// --- Story 3.4: post-job rebooking nudge (derived on read from canonical rows) ---
//
// Two PURE predicates/metrics over the SAME two facts every other derive reads
// (AD-7): dispatched `rebooking_nudge` MessageLog rows and their `resulting_job_ref`
// links. No stored `nudge_due` flag, no conversion counter, no cron — mutate the input
// and the very next call reflects it. Instants (epoch ms) are compared, never strings:
// dispatched_at (timestamptz "…+00") and a Job's completed_at ("…Z") are the same
// instant in different text, so a lexical compare across formats would be wrong.

/** The Job fields the post-job nudge predicate reads (a projection, AD-8). */
export interface NudgeJob {
  clientId: string;
  completion: string;
  completedAt: string | null; // UTC instant, non-null once `completed`
}

/** A DISPATCHED MessageLog row the nudge predicate / conversion metric read. */
export interface NudgeLog {
  clientId: string;
  messageType: string;
  dispatchedAt: string; // UTC instant — dispatched rows only (queries filter IS NOT NULL)
  resultingJobRef: string | null; // FR13 attribution — the Job this nudge produced, or null
}

/**
 * Does this job still WANT a post-job rebooking nudge (AC1/FR12/FR40)? True only when
 * the job is `completed` AND the client has NO dispatched `rebooking_nudge` on/after this
 * job's `completed_at`. `no-show`/`cancelled` NEVER qualify (FR40 — they do not advance
 * rebooking logic). Derive-on-read (AD-7): once a nudge is dispatched for the client
 * (its dispatched_at ≥ completedAt), the predicate flips false and the prompt disappears
 * with NO stored flag. A prior-job nudge dispatched BEFORE this completion does not
 * suppress it (dispatched_at < completedAt).
 */
export function needsRebookNudge(job: NudgeJob, messages: NudgeLog[]): boolean {
  if (job.completion !== 'completed') return false;
  if (!job.completedAt) return false; // defensive: a completed job always has completedAt
  const completedMs = new Date(job.completedAt).getTime();
  for (const m of messages) {
    if (m.clientId !== job.clientId) continue;
    if (m.messageType !== 'rebooking_nudge') continue;
    if (new Date(m.dispatchedAt).getTime() >= completedMs) return false;
  }
  return true;
}

/** The one-time → repeat nudge-conversion metric (AC2/FR13), recomputed on read. */
export interface RebookingConversion {
  sent: number; // dispatched rebooking nudges in the rolling window
  booked: number; // of those, the ones with a resulting_job_ref (led to a booking)
  ratio: number; // booked / sent, or 0 when sent === 0
}

// Rolling-window default: repeat-rate is a 30-day window (addendum F), and the nudge
// conversion shares that horizon so the two agree. Instant math (ms) over dispatched_at.
const CONVERSION_WINDOW_DAYS_DEFAULT = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The nudge-conversion ratio over dispatched `rebooking_nudge` rows whose `dispatched_at`
 * falls in the rolling `windowDays` ending at `anchorIso` (AC2/FR13). `sent` counts those
 * rows; `booked` counts the subset with a non-null `resulting_job_ref` (Task 3's attribution
 * fact); `ratio = booked/sent` (0 when sent === 0). PURE derive-on-read (AD-7): a function
 * of the two recorded facts only — NO stored counter, NO cron. This is the FR13 one-time→
 * repeat nudge ratio; addendum-F repeat-booking-rate is a SEPARATE Epic-6 dashboard metric.
 */
export function rebookingConversion(
  messages: NudgeLog[],
  anchorIso: string,
  windowDays: number = CONVERSION_WINDOW_DAYS_DEFAULT,
): RebookingConversion {
  const anchor = new Date(anchorIso).getTime();
  const windowStart = anchor - windowDays * MS_PER_DAY;
  let sent = 0;
  let booked = 0;
  for (const m of messages) {
    if (m.messageType !== 'rebooking_nudge') continue;
    const t = new Date(m.dispatchedAt).getTime();
    if (t < windowStart || t > anchor) continue;
    sent++;
    if (m.resultingJobRef != null) booked++;
  }
  return { sent, booked, ratio: sent === 0 ? 0 : booked / sent };
}
