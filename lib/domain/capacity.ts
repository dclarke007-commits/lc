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

import { and, eq, ne, gte, lt, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { job, capacitySettings, client } from '@/lib/db/schema';
import type { Job } from '@/lib/db/schema';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import {
  DEFAULT_CAPACITY,
  type CapacityConfig,
} from '@/lib/domain/capacityConfig';
import {
  localDateKey,
  isoWeekdayOfDate as isoWeekdayOf,
  weekRangeOfDate as weekRange,
} from '@/lib/domain/clock';

// AD-2: the ONE consuming-status set. consumesSlot is the single predicate, and
// the SQL capacity counts below filter on this exact list, so the rule is defined
// once and never re-derived (derive.roomLeft in Story 1.7 imports consumesSlot).
export const CONSUMING_COMPLETIONS = ['booked', 'completed', 'no-show'] as const;

/**
 * AD-2 predicate: does this job consume a capacity slot? `booked`, `completed`,
 * and `no-show` consume; `cancelled` does not. The ONE definition — both
 * commitBooking and derive.roomLeft (Story 1.7) call this.
 *
 * DIVERGENCE NOTE (Epic 3 retro action item): lapse detection does NOT reuse this
 * predicate. derive.hasFutureBooking (the "future booking on file" suppressor for
 * goneCold) is deliberately narrower — `booked` ONLY — because for lapse a today/future
 * `no-show` is the very lapse signal and must NOT suppress cold, and a `completed` is a
 * past fact, not a future appointment. Capacity counts all three (a no-show still burned
 * the slot); lapse counts only a live future booking. Two predicates, two intents — keep
 * them distinct; do not collapse hasFutureBooking onto consumesSlot.
 */
export function consumesSlot(j: { completion: string }): boolean {
  return (CONSUMING_COMPLETIONS as readonly string[]).includes(j.completion);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True only for a REAL calendar date: right shape AND the fields survive a
 * round-trip through Date.UTC. Rejects well-formed-but-invalid values like
 * '2026-02-30' or '2026-13-01' that would otherwise roll over into a wrong week
 * window and then throw at the Postgres `date` column (code-review 2026-07-16).
 */
function isRealDate(dateStr: string): boolean {
  if (!DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return (
    t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
  );
}

// The Mon–Sun week arithmetic (`isoWeekdayOf`, `weekRange`) and calendar-date
// shifting now live in lib/domain/clock.ts — the ONE clock (AD-9), imported above.
// derive.ts (Story 1.7) reads the same helpers, so the booking caps and the
// dashboard can never disagree on "the week."

// Shared under-lock helpers so the capacity RULE lives in ONE place (AD-2) and is
// reused by both commitBooking (INSERT a new slot) and reschedule (MOVE an
// existing one). The tx type is derived from db.transaction's callback param so
// the helpers run inside the caller's transaction + advisory lock.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The operator's persisted capacity config, or the domain defaults on first run
 * (single source, AR16 — never re-hardcode 3/14/Mon–Sat downstream).
 */
async function resolveConfig(tx: Tx, ownerId: string): Promise<CapacityConfig> {
  const [settings] = await tx
    .select()
    .from(capacitySettings)
    .where(eq(capacitySettings.ownerId, ownerId))
    .limit(1);
  return settings
    ? {
        workingDays: settings.workingDays,
        perDayCap: settings.perDayCap,
        weeklyCeiling: settings.weeklyCeiling,
        defaultJobPriceCents: settings.defaultJobPriceCents,
        timezone: settings.timezone,
      }
    : DEFAULT_CAPACITY;
}

/**
 * Count CONSUMING jobs (AD-2) on `date`'s day and its Mon–Sun week, optionally
 * EXCLUDING one job id — the job being MOVED in a reschedule, so it is never
 * counted against itself (a same-week move must not be blocked by its own slot).
 * The ONE capacity-counting rule; both commitBooking and reschedule call it under
 * the week-scoped advisory lock.
 */
async function countConsuming(
  tx: Tx,
  ownerId: string,
  date: string,
  monday: string,
  nextMonday: string,
  excludeJobId?: string,
): Promise<{ dayCount: number; weekCount: number }> {
  const consuming = [...CONSUMING_COMPLETIONS];
  const notSelf = excludeJobId ? [ne(job.id, excludeJobId)] : [];
  const [dayRow] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(job)
    .where(
      and(
        eq(job.ownerId, ownerId),
        eq(job.date, date),
        inArray(job.completion, consuming),
        ...notSelf,
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
        ...notSelf,
      ),
    );
  return { dayCount: dayRow.c, weekCount: weekRow.c };
}

export interface CommitBookingInput {
  ownerId: string;
  clientId: string;
  date: string; // operator-local 'YYYY-MM-DD'
  override: boolean;
  idempotencyKey: string;
  priceCents?: number; // defaults to the operator's configured price
  now?: Date; // "now" for the past-date check; defaults to new Date() (injectable for tests)
}

/**
 * The sole capacity-consuming insert (AD-2/AD-3/AD-12). Inside one transaction:
 * take the WEEK-scoped advisory lock (so BOTH the per-day cap and the weekly-14
 * ceiling serialize — same-day is a subset of same-week), replay idempotency,
 * re-check both caps under the lock, then insert-or-reject. Typed AR15 result;
 * writes nothing on reject.
 */
export async function commitBooking(
  input: CommitBookingInput,
): Promise<ActionResult<Job>> {
  const { ownerId, clientId, date, override, idempotencyKey } = input;

  // Request-shape validation (no DB). Reject before opening a transaction.
  if (!isRealDate(date)) return fail('date-invalid');
  if (!idempotencyKey) return fail('idempotency-key-missing');
  // A non-UUID clientId would make Postgres throw a uuid-syntax error; treat it
  // as "not this owner's client" rather than swallowing it into booking-failed.
  if (!UUID_RE.test(clientId)) return fail('client-not-found');

  // The Mon–Sun week of the target date (pure). The advisory lock keys on the
  // WEEK, not the day — two claims on different days of the same week MUST still
  // serialize or the weekly-14 ceiling races past its limit (AD-3).
  const { monday, nextMonday } = weekRange(date);
  const now = input.now ?? new Date();

  try {
    return await db.transaction(async (tx) => {
      // NOTE: returning fail() from this callback COMMITS the (empty) transaction
      // — drizzle only rolls back on a THROWN error. Every reject path below
      // writes nothing before returning, so the committed txn is empty and the
      // "writes nothing on reject" guarantee holds. If you ever add a write before
      // the cap check, THROW to roll back instead of returning fail().

      // AD-3: transaction-scoped advisory lock keyed on (owner, week-monday).
      // Released at COMMIT/ROLLBACK. Session-scoped locks are FORBIDDEN (pgBouncer
      // transaction pooling breaks them). Week-scoped so the per-day cap AND the
      // weekly-14 ceiling both serialize; two int4 keys via hashtext.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${ownerId}), hashtext(${monday}))`,
      );

      // AD-12 idempotency: a repeat submit (same owner+key) returns the SAME Job.
      // Serialized by the lock, so it always observes a prior committed insert.
      // Filter to CONSUMING completions only (code-review 2026-07-16): the unique
      // index is partial on the same set, so a cancelled row can share this key —
      // it must NOT count as an existing booking, or a client could never re-book
      // a day they once cancelled (the false "You're booked" replay bug). A dead
      // (cancelled) row is ignored here and the insert below reuses the key.
      const [existing] = await tx
        .select()
        .from(job)
        .where(
          and(
            eq(job.ownerId, ownerId),
            eq(job.idempotencyKey, idempotencyKey),
            inArray(job.completion, CONSUMING_COMPLETIONS),
          ),
        )
        .limit(1);
      if (existing) {
        // The key identifies ONE live booking attempt. If it is replayed with a
        // different date/client (a cached form edited after Back), that is a
        // conflict — do NOT silently return the wrong Job. Replay only on a match.
        if (existing.date === date && existing.clientId === clientId) {
          return ok(existing);
        }
        return fail('booking-conflict');
      }

      // Client must exist and belong to this owner (AD-8) — no cross-tenant book.
      const [ownedClient] = await tx
        .select({ id: client.id })
        .from(client)
        .where(and(eq(client.ownerId, ownerId), eq(client.id, clientId)))
        .limit(1);
      if (!ownedClient) return fail('client-not-found');

      // Config = the operator's persisted capacity, or the domain defaults on
      // first-run (single source, AR16 — never re-hardcode 3/14/Mon–Sat).
      const config = await resolveConfig(tx, ownerId);

      // Availability gates — NOT capacity, so the cap override never bypasses
      // them. Reject a non-working weekday, and a date already past in the
      // operator's local timezone (AD-9). "Today" is allowed; only strictly
      // earlier is past.
      if (!config.workingDays.includes(isoWeekdayOf(date))) {
        return fail('non-working-day');
      }
      if (date < localDateKey(now, config.timezone)) {
        return fail('date-past');
      }

      // Re-check BOTH caps under the lock, counting only consuming jobs (AD-2).
      const { dayCount, weekCount } = await countConsuming(
        tx,
        ownerId,
        date,
        monday,
        nextMonday,
      );
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

export interface RescheduleInput {
  ownerId: string;
  jobId: string;
  newDate: string; // operator-local 'YYYY-MM-DD'
  now?: Date; // "now" for the past-date check; injectable for tests
}

/**
 * Reschedule a BOOKED job to newDate, atomically under the destination-week cap
 * check (AD-12/AD-2/AD-3). The row MOVES (its `date` changes) — identity/history
 * are preserved and `completion` is NEVER touched, so lifecycle stays the sole
 * completion writer (AD-10). The original slot frees automatically: once the row
 * sits on newDate, its old day/week simply no longer count it (derive-on-read,
 * AD-7 — no stored counter to decrement).
 *
 * Only the DESTINATION week is locked. Freeing the source slot can never breach a
 * cap, so the source week needs no lock; the destination is serialized on the
 * SAME (owner, week-monday) advisory key commitBooking uses, so a concurrent
 * booking/reschedule into that week can't race the cap past its limit (AD-3).
 *
 * Idempotent: moving to the date the job already occupies is a no-op success.
 * Capacity is never transiently double-held or lost — the single UPDATE both
 * frees the old slot and claims the new one in one statement (AD-12).
 */
export async function reschedule(
  input: RescheduleInput,
): Promise<ActionResult<Job>> {
  const { ownerId, jobId, newDate } = input;

  // Request-shape validation (no DB). Reject before opening a transaction.
  if (!isRealDate(newDate)) return fail('date-invalid');
  // A non-UUID id can never match a real row — treat as job-not-found rather than
  // letting Postgres throw a uuid-syntax error out of the transaction.
  if (!UUID_RE.test(jobId)) return fail('job-not-found');

  const { monday, nextMonday } = weekRange(newDate);
  const now = input.now ?? new Date();

  try {
    return await db.transaction(async (tx) => {
      // NOTE: as in commitBooking, returning fail() COMMITS an empty transaction
      // (drizzle only rolls back on a THROWN error). Every reject path below runs
      // before the UPDATE, so nothing is written on reject.

      // AD-3: lock the DESTINATION week (owner, newWeekMonday) — the same key
      // commitBooking uses — so the cap re-check + move serialize against any
      // concurrent claim into that week.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${ownerId}), hashtext(${monday}))`,
      );

      // Load + row-lock the job (owner-scoped, AD-8). Only a BOOKED job can move.
      const [current] = await tx
        .select()
        .from(job)
        .where(and(eq(job.ownerId, ownerId), eq(job.id, jobId)))
        .for('update')
        .limit(1);
      if (!current) return fail('job-not-found');
      if (current.completion !== 'booked') return fail('not-reschedulable');

      // Idempotent no-op: already on the requested date. Return the row unchanged
      // — a double-tapped reschedule can never double-consume (it is one row).
      if (current.date === newDate) return ok(current);

      const config = await resolveConfig(tx, ownerId);

      // Availability gates (same as commitBooking) — NOT capacity, so they are
      // always enforced. Can't move onto a non-working weekday or into the past
      // in the operator's local tz (AD-9). "Today" is allowed.
      if (!config.workingDays.includes(isoWeekdayOf(newDate))) {
        return fail('non-working-day');
      }
      if (newDate < localDateKey(now, config.timezone)) {
        return fail('date-past');
      }

      // Cap re-check on the DESTINATION, EXCLUDING this job so an intra-week move
      // is not blocked by the job's own current slot. Per-day is the narrower
      // reason, so it wins when both are full. Reschedule never overrides (AC2).
      const { dayCount, weekCount } = await countConsuming(
        tx,
        ownerId,
        newDate,
        monday,
        nextMonday,
        jobId,
      );
      // The per-day cap always applies. The weekly ceiling applies ONLY to a
      // cross-week move: a move WITHIN the same Mon–Sun week does not change the
      // week's membership count, so it is capacity-neutral for the ceiling —
      // blocking it would trap a job inside an over-ceiling week (reachable via
      // the FR39 override). weekCount already excludes this job, so for a same-week
      // destination it would double-punish the move.
      const sameWeek = weekRange(current.date).monday === monday;
      if (dayCount >= config.perDayCap) return fail('day-maxed');
      if (!sameWeek && weekCount >= config.weeklyCeiling) return fail('week-full');

      // One UPDATE frees the old slot and claims the new one — capacity is never
      // transiently double-held or lost (AD-12). completion is left untouched.
      // Clear `overridden`: a successful reschedule passed the cap check WITHOUT
      // an override (reschedule has no override path), so the moved booking no
      // longer bypasses a full cap and must not keep inflating the FR39 metric.
      const [row] = await tx
        .update(job)
        .set({ date: newDate, overridden: false })
        .where(and(eq(job.ownerId, ownerId), eq(job.id, jobId)))
        .returning();
      return ok(row);
    });
  } catch (err) {
    // AR15: fail closed with a machine reason, but log for observability.
    console.error('[capacity] reschedule failed', err);
    return fail('reschedule-failed');
  }
}
