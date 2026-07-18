'use server';

// Sole write path = Server Actions (AD-1). Verb-first name `saveCapacitySettings`.
// Capacity config is the single source all downstream capacity/cadence math reads
// (Stories 1.4/1.6/1.7) — never re-hardcode 3/14/Mon–Sat.
//
// Return contract (AR15): { ok, data } | { ok: false, reason }. No thrown error
// crosses the boundary; no silent catch. Only lib/db speaks SQL (AD-1). Business
// defaults live in the domain (DEFAULT_CAPACITY), not in DB column defaults —
// getOwnerCapacity substitutes them on first view (AR16, single source).

import { requireOwnerId } from '@/lib/auth/requireOwnerId';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { capacitySettings } from '@/lib/db/schema';
import { getCapacitySettings } from '@/lib/db/queries';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import {
  DEFAULT_CAPACITY,
  validateCapacity,
  type CapacityConfig,
} from '@/lib/domain/capacityConfig';

/**
 * Owner-scoped read for the RSC settings surface. On first view (no row yet)
 * returns DEFAULT_CAPACITY — that is how "defaults on first view" works (AC1),
 * and it keeps the defaults in ONE place (the domain), never the DB.
 */
export async function getOwnerCapacity(): Promise<CapacityConfig> {
  // Fail LOUD, not silent: an unresolved owner is a deploy-invariant violation
  // (the operator is a seeded singleton), so we log and rethrow rather than
  // masking it behind DEFAULT_CAPACITY — the write path logs the same way, and a
  // silent default here would hide a real DB/seed failure. The RSC render surface
  // shows the error boundary. (code-review 2026-07-16; parity with saveCapacitySettings.)
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch (err) {
    console.error('[settings] requireOwnerId failed (read path)', err);
    throw new Error('owner-unresolved');
  }
  const row = await getCapacitySettings(ownerId);
  if (!row) return DEFAULT_CAPACITY;
  return {
    workingDays: row.workingDays,
    perDayCap: row.perDayCap,
    weeklyCeiling: row.weeklyCeiling,
    defaultJobPriceCents: row.defaultJobPriceCents,
    timezone: row.timezone,
  };
}

/** Parse the raw form fields into the domain's CapacityInput shape. */
function readCapacityForm(formData: FormData): {
  workingDays: number[];
  perDayCap: number;
  weeklyCeiling: number;
  defaultJobPriceCents: number;
  timezone: string;
} {
  // Multiple checkboxes share name="workingDays"; getAll returns each checked
  // value. Non-numeric entries become NaN and are rejected by validateCapacity.
  const workingDays = formData
    .getAll('workingDays')
    .map((v) => Number(String(v)));

  const perDayCap = Number(String(formData.get('perDayCap') ?? ''));
  const weeklyCeiling = Number(String(formData.get('weeklyCeiling') ?? ''));

  // Price input is in DOLLARS → convert to integer cents (AR16). Empty/NaN
  // dollars become NaN and are rejected downstream. Reject sub-cent precision
  // (e.g. "20000.999") rather than silently rounding a value the operator typed;
  // a tiny binary-float tolerance keeps legit 2-decimal inputs (1.005*100 =
  // 100.4999… is genuinely sub-cent → NaN → 'price-invalid'). (code-review 2026-07-16)
  const rawCents = Number(String(formData.get('defaultJobPrice') ?? '')) * 100;
  const roundedCents = Math.round(rawCents);
  const defaultJobPriceCents =
    Number.isFinite(rawCents) && Math.abs(rawCents - roundedCents) < 1e-6
      ? roundedCents
      : NaN;

  const timezone = String(formData.get('timezone') ?? '').trim();

  return { workingDays, perDayCap, weeklyCeiling, defaultJobPriceCents, timezone };
}

/**
 * Persist the owner's capacity config (sole write path, AD-1). Validates first;
 * on any failure returns a machine reason and writes NOTHING (AC2). On success
 * UPSERTs the single owner row (insert, or update on the owner_id conflict).
 */
export async function saveCapacitySettings(
  formData: FormData,
): Promise<ActionResult<CapacityConfig>> {
  const parsed = validateCapacity(readCapacityForm(formData));
  if (!parsed.ok) return fail(parsed.reason);
  const config = parsed.value;

  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[settings] requireOwnerId failed', err);
    return fail('owner-unresolved');
  }

  try {
    await db
      .insert(capacitySettings)
      .values({
        ownerId,
        workingDays: config.workingDays,
        perDayCap: config.perDayCap,
        weeklyCeiling: config.weeklyCeiling,
        defaultJobPriceCents: config.defaultJobPriceCents,
        timezone: config.timezone,
      })
      .onConflictDoUpdate({
        target: capacitySettings.ownerId,
        set: {
          workingDays: config.workingDays,
          perDayCap: config.perDayCap,
          weeklyCeiling: config.weeklyCeiling,
          defaultJobPriceCents: config.defaultJobPriceCents,
          timezone: config.timezone,
          updatedAt: new Date().toISOString(),
        },
      });
    revalidatePath('/settings');
    return ok(config);
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[settings] capacity write failed', err);
    return fail('capacity-write-failed');
  }
}
