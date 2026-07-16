// Pure domain module — NO framework imports, NO deps (Intl only). AD-9, the one
// clock: timestamps are stored in UTC; all capacity, cadence, and week arithmetic
// is computed in the operator's single local timezone; the weekly-14 boundary is
// Monday–Sunday, operator-local (FR1). Stories 1.4/1.6/1.7 depend on this helper,
// so it is minimal but correct across tz offsets (incl. UTC-day ≠ local-day).

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number; // 0..23
  minute: number;
  second: number;
  weekday: number; // 1=Mon .. 7=Sun
}

/** Wall-clock fields of `instant` as seen in `tz`. Single Intl formatter call. */
function partsInZone(instant: Date, tz: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[map.weekday],
  };
}

/**
 * Convert a wall-clock date/time in `tz` to the UTC instant it denotes. The tz
 * offset varies with the date (DST), so we guess (treating the fields as UTC),
 * measure the offset, and correct. Around DST transitions a wall time can be
 * nonexistent (spring-forward gap) or occur twice (fall-back overlap); both are
 * resolved deterministically by round-tripping each candidate back to its local
 * wall time:
 *   - unique match → that instant;
 *   - two matches (overlap) → the EARLIER instant ('compatible' disambiguation);
 *   - no match (gap) → the LATER (post-gap) instant, so a midnight day/week
 *     boundary never falls back onto the previous local day.
 * Whole-second math (Intl exposes no ms); the input ms is re-applied at the end.
 */
function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  tz: string,
): Date {
  // The requested wall time as whole seconds, encoded in a UTC millisecond value.
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  // Local wall time seen at `utcMs`, re-encoded the same way (for comparison).
  const wallReadAt = (utcMs: number): number => {
    const p = partsInZone(new Date(utcMs), tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  };
  const offsetAt = (utcMs: number): number => wallReadAt(utcMs) - utcMs;

  const utc1 = target - offsetAt(target);
  const utc2 = target - offsetAt(utc1);
  const m1 = wallReadAt(utc1) === target;
  const m2 = wallReadAt(utc2) === target;

  let base: number;
  if (m1 && m2) base = Math.min(utc1, utc2); // overlap → earlier occurrence
  else if (m1) base = utc1;
  else if (m2) base = utc2;
  else base = Math.max(utc1, utc2); // gap → post-gap instant

  return new Date(base + ms);
}

/** Add `delta` whole days to a calendar date (pure Y-M-D arithmetic, no tz). */
function addDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(year, month - 1, day) + delta * 86_400_000);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
  };
}

/** 'YYYY-MM-DD' of `instant` in `tz`. */
export function localDateKey(instant: Date, tz: string): string {
  const p = partsInZone(instant, tz);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

/** ISO weekday of `instant` in `tz`: 1=Mon .. 7=Sun. */
export function localISOWeekday(instant: Date, tz: string): number {
  return partsInZone(instant, tz).weekday;
}

/**
 * The Monday–Sunday week (operator-local) containing `instant`, as UTC instants:
 * `startUtc` = Monday 00:00:00.000 local (inclusive); `endUtc` = the following
 * Monday 00:00:00.000 local (exclusive). Both are UTC ISO-8601 strings. This is
 * the weekly-14 boundary (AD-9/FR1) — correct even when the instant's UTC day
 * differs from its local day.
 */
export function localWeekBounds(
  instant: Date,
  tz: string,
): { startUtc: string; endUtc: string } {
  const p = partsInZone(instant, tz);
  // Local calendar date of this week's Monday.
  const monday = addDays(p.year, p.month, p.day, -(p.weekday - 1));
  const nextMonday = addDays(monday.year, monday.month, monday.day, 7);

  const start = zonedWallToUtc(
    monday.year,
    monday.month,
    monday.day,
    0,
    0,
    0,
    0,
    tz,
  );
  const end = zonedWallToUtc(
    nextMonday.year,
    nextMonday.month,
    nextMonday.day,
    0,
    0,
    0,
    0,
    tz,
  );
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

/** Whether `instant`, in `tz`, falls on one of the operator's working days. */
export function isWorkingDay(
  instant: Date,
  tz: string,
  workingDays: number[],
): boolean {
  return workingDays.includes(localISOWeekday(instant, tz));
}

// --- Calendar-date-key (Mon–Sun) arithmetic (AD-9) ---
//
// A Job's `date` is an operator-local CALENDAR day ('YYYY-MM-DD'), not an
// instant — a cleaning is "on the 20th". Its weekday and week window are pure
// Y-M-D arithmetic (tz-independent: the day is already local). These are the
// same Mon–Sun rule the capacity counts use; derive-on-read (AD-7, Story 1.7)
// consumes them so room-left/day-maxed and the booking caps agree on "the week".

/** ISO weekday (1=Mon..7=Sun) of a 'YYYY-MM-DD' calendar date — tz-independent. */
export function isoWeekdayOfDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

/** Shift a 'YYYY-MM-DD' calendar date by whole days (pure, no tz). */
export function addDaysToDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + deltaDays * 86_400_000);
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${t.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * The Mon–Sun week [monday, nextMonday) containing `dateStr`, as calendar-date
 * strings (exclusive end). Mon–Sun is operator-local by construction: `date` is
 * already a local calendar day, and a date's weekday is tz-independent (AD-9).
 */
export function weekRangeOfDate(dateStr: string): {
  monday: string;
  nextMonday: string;
} {
  const wd = isoWeekdayOfDate(dateStr);
  return {
    monday: addDaysToDate(dateStr, -(wd - 1)),
    nextMonday: addDaysToDate(dateStr, 8 - wd),
  };
}
