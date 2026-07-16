// Story 1.4 — capacity has ONE owner (AD-2). This module holds the single
// predicate that decides whether a Job consumes a slot, and the single function
// that inserts a capacity-consuming Job. commitBooking is the sole slot-consuming
// write path: operator-direct (FR39), client-confirm (Epic 3), and
// approve-from-queue (Epic 4) all route through it — the FR39 override is a
// boolean arg, never a separate insert. It re-checks the per-day cap AND the
// weekly-14 ceiling inside one transaction, serialized by a day-scoped
// transaction advisory lock (AD-3), so exactly one concurrent claim wins the
// last slot.
//
// Layering note: capacity is the domain service that necessarily composes the
// booking transaction (lock + count + insert), so — like the Server Action layer
// — it speaks to the db client. Surfaces NEVER reach here directly; they call the
// Server Action, which calls commitBooking.

import { and, eq, gte, lt, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { job, capacitySettings, client } from '@/lib/db/schema';
import type { Job } from '@/lib/db/schema';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import {
  DEFAULT_CAPACITY,
  type CapacityConfig,
} from '@/lib/domain/capacityConfig';

// AD-2: the ONE consuming-status set. consumesSlot is the single predicate, and
// the SQL capacity counts below filter on this exact list, so the rule is defined
// once and never re-derived (derive.roomLeft in Story 1.7 imports consumesSlot).
export const CONSUMING_COMPLETIONS = ['booked', 'completed', 'no-show'] as const;

/**
 * AD-2 predicate: does this job consume a capacity slot? `booked`, `completed`,
 * and `no-show` consume; `cancelled` does not. The ONE definition — both
 * commitBooking and derive.roomLeft (Story 1.7) call this.
 */
export function consumesSlot(j: { completion: string }): boolean {
  return (CONSUMING_COMPLETIONS as readonly string[]).includes(j.completion);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO weekday (1=Mon..7=Sun) of a 'YYYY-MM-DD' calendar date — tz-independent. */
function isoWeekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

/** Shift a 'YYYY-MM-DD' calendar date by whole days (pure, no tz). */
function shiftDate(dateStr: string, deltaDays: number): string {
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
function weekRange(dateStr: string): { monday: string; nextMonday: string } {
  const wd = isoWeekdayOf(dateStr);
  return {
    monday: shiftDate(dateStr, -(wd - 1)),
    nextMonday: shiftDate(dateStr, 8 - wd),
  };
}

export interface CommitBookingInput {
  ownerId: string;
  clientId: string;
  date: string; // operator-local 'YYYY-MM-DD'
  override: boolean;
  idempotencyKey: string;
  priceCents?: number; // defaults to the operator's configured price
}

/**
 * The sole capacity-consuming insert (AD-2/AD-3/AD-12). Inside one transaction:
 * take the day-scoped advisory lock, replay idempotency, re-check BOTH caps under
 * the lock, then insert-or-reject. Typed AR15 result; writes nothing on reject.
 */
export async function commitBooking(
  input: CommitBookingInput,
): Promise<ActionResult<Job>> {
  const { ownerId, clientId, date, override, idempotencyKey } = input;

  if (!DATE_RE.test(date)) return fail('date-invalid');
  if (!idempotencyKey) return fail('idempotency-key-missing');

  try {
    return await db.transaction(async (tx) => {
      // AD-3: transaction-scoped advisory lock keyed on (owner, date). Released
      // at COMMIT/ROLLBACK. Session-scoped locks are FORBIDDEN (pgBouncer
      // transaction pooling breaks them). Two int4 keys: hashtext(owner) +
      // hashtext(date) — concurrent claims on the same day serialize here.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${ownerId}), hashtext(${date}))`,
      );

      // AD-12 idempotency: a repeat submit (same owner+key) returns the SAME Job.
      // Serialized by the lock, so it always observes a prior committed insert.
      const [existing] = await tx
        .select()
        .from(job)
        .where(
          and(eq(job.ownerId, ownerId), eq(job.idempotencyKey, idempotencyKey)),
        )
        .limit(1);
      if (existing) return ok(existing);

      // Client must exist and belong to this owner (AD-8) — no cross-tenant book.
      const [ownedClient] = await tx
        .select({ id: client.id })
        .from(client)
        .where(and(eq(client.ownerId, ownerId), eq(client.id, clientId)))
        .limit(1);
      if (!ownedClient) return fail('client-not-found');

      // Config = the operator's persisted capacity, or the domain defaults on
      // first-run (single source, AR16 — never re-hardcode 3/14/Mon–Sat).
      const [settings] = await tx
        .select()
        .from(capacitySettings)
        .where(eq(capacitySettings.ownerId, ownerId))
        .limit(1);
      const config: CapacityConfig = settings
        ? {
            workingDays: settings.workingDays,
            perDayCap: settings.perDayCap,
            weeklyCeiling: settings.weeklyCeiling,
            defaultJobPriceCents: settings.defaultJobPriceCents,
            timezone: settings.timezone,
          }
        : DEFAULT_CAPACITY;

      // Re-check BOTH caps under the lock, counting only consuming jobs (AD-2).
      const { monday, nextMonday } = weekRange(date);
      const consuming = [...CONSUMING_COMPLETIONS];
      const [dayRow] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(job)
        .where(
          and(
            eq(job.ownerId, ownerId),
            eq(job.date, date),
            inArray(job.completion, consuming),
          ),
        );
      const [weekRow] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(job)
        .where(
          and(
            eq(job.ownerId, ownerId),
            gte(job.date, monday),
            lt(job.date, nextMonday),
            inArray(job.completion, consuming),
          ),
        );
      const dayCount = dayRow.c;
      const weekCount = weekRow.c;
      const overCap =
        dayCount >= config.perDayCap || weekCount >= config.weeklyCeiling;

      // FR9/FR39: reject over-cap unless the operator explicitly overrides.
      // Per-day is the narrower reason, so it wins when both are full.
      if (!override) {
        if (dayCount >= config.perDayCap) return fail('day-maxed');
        if (weekCount >= config.weeklyCeiling) return fail('week-full');
      }

      const [row] = await tx
        .insert(job)
        .values({
          ownerId,
          clientId,
          date,
          completion: 'booked',
          // FR39: overridden=true only when the booking actually bypassed a full
          // cap — that is the overbooking counter-metric. A normal in-cap booking
          // with the flag set is not an override.
          overridden: override && overCap,
          priceCents: input.priceCents ?? config.defaultJobPriceCents,
          idempotencyKey,
        })
        .returning();
      return ok(row);
    });
  } catch (err) {
    // AR15: fail closed with a machine reason, but log for observability.
    console.error('[capacity] commitBooking failed', err);
    return fail('booking-failed');
  }
}
