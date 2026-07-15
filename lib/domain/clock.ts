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
 * measure the offset at that guess, correct, then refine once to settle DST
 * boundaries. offset = localWall - utc.
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
  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let instant = new Date(asUtcMs);
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(instant, tz);
    const wallAsUtc = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    const offset = wallAsUtc - instant.getTime(); // localWall - utc
    const corrected = asUtcMs - offset;
    if (corrected === instant.getTime()) break;
    instant = new Date(corrected);
  }
  return instant;
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
