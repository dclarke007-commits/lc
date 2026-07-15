// Pure domain module — NO framework imports (dependency rule: domain sits below
// actions/surfaces). The single source of truth for capacity DEFAULTS and their
// validation (FR1, AR16). Business defaults live HERE, never as DB column
// defaults and never re-hardcoded downstream (Stories 1.4/1.6/1.7 read the
// persisted config; on first view getOwnerCapacity returns DEFAULT_CAPACITY).

// The operator's availability model. workingDays are ISO weekday ints (1=Mon ..
// 7=Sun); price is integer cents, USD (AR16); timezone is an IANA name (AD-9).
export interface CapacityConfig {
  workingDays: number[];
  perDayCap: number;
  weeklyCeiling: number;
  defaultJobPriceCents: number;
  timezone: string;
}

// FR1 / AC-1 defaults: Mon–Sat working days, per-day cap 3, weekly ceiling 14,
// default job price $200 (= 20000 cents), operator-local tz America/Chicago.
export const DEFAULT_CAPACITY: CapacityConfig = {
  workingDays: [1, 2, 3, 4, 5, 6],
  perDayCap: 3,
  weeklyCeiling: 14,
  defaultJobPriceCents: 20000,
  timezone: 'America/Chicago',
};

// Raw (unvalidated) shape as parsed from a form. Every field may be malformed;
// validateCapacity is the gate that turns it into a trusted CapacityConfig.
export interface CapacityInput {
  workingDays: number[];
  perDayCap: number;
  weeklyCeiling: number;
  defaultJobPriceCents: number;
  timezone: string;
}

function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    // Throws RangeError for an unknown IANA name; a valid one constructs fine.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate raw capacity input. Minimal, explicit rules (NFR7). On any failure
 * returns a machine-readable reason (the action writes NOTHING). On success the
 * value is normalised to a trusted CapacityConfig with a de-duplicated,
 * ascending working-day set.
 */
export function validateCapacity(
  input: CapacityInput,
):
  | { ok: true; value: CapacityConfig }
  | { ok: false; reason: string } {
  const { workingDays, perDayCap, weeklyCeiling, defaultJobPriceCents, timezone } =
    input;

  if (!Array.isArray(workingDays) || workingDays.length === 0) {
    return { ok: false, reason: 'working-days-required' };
  }
  for (const d of workingDays) {
    if (!Number.isInteger(d) || d < 1 || d > 7) {
      return { ok: false, reason: 'working-day-invalid' };
    }
  }
  // Reject duplicate weekdays outright (a malformed set), then normalise order.
  const unique = new Set(workingDays);
  if (unique.size !== workingDays.length) {
    return { ok: false, reason: 'working-day-invalid' };
  }
  const normalisedDays = [...unique].sort((a, b) => a - b);

  if (!Number.isInteger(perDayCap) || perDayCap <= 0) {
    return { ok: false, reason: 'per-day-cap-invalid' };
  }
  if (!Number.isInteger(weeklyCeiling) || weeklyCeiling <= 0) {
    return { ok: false, reason: 'weekly-ceiling-invalid' };
  }
  if (weeklyCeiling < perDayCap) {
    return { ok: false, reason: 'ceiling-below-per-day' };
  }
  if (!Number.isInteger(defaultJobPriceCents) || defaultJobPriceCents < 0) {
    return { ok: false, reason: 'price-invalid' };
  }
  if (!isValidTimezone(timezone)) {
    return { ok: false, reason: 'timezone-invalid' };
  }

  return {
    ok: true,
    value: {
      workingDays: normalisedDays,
      perDayCap,
      weeklyCeiling,
      defaultJobPriceCents,
      timezone,
    },
  };
}
