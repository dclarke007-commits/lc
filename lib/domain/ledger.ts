// Story 5.4 — the SOLE writer of Job.payment (AR11/AD-10). Symmetric to
// lifecycle.ts (the sole writer of Job.completion): no other module — not a
// surface, not derive, not lifecycle — writes `payment`. markPaid flips
// `owed → paid` and NEVER touches `completion`; the two orthogonal fields stay
// cleanly separated, each with one writer.
//
// Ledger-eligibility is NOT re-defined here: only a `completed` Job may be paid
// (derive.isLedgerEligible, the single Story 5.1 predicate). The outstanding total
// is derived on read (derive.outstanding, 5.2), so a flip to `paid` clears the debt
// on the next render with no stored counter to decrement (AD-7).
//
// Layering: like lifecycle, ledger is the domain service that owns a transactional
// write, so it speaks to the db client. Surfaces NEVER reach here — they call the
// Server Action, which calls markPaid.

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { job } from '@/lib/db/schema';
import type { Job } from '@/lib/db/schema';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import { isLedgerEligible } from '@/lib/domain/derive';

// A non-UUID id can never match a real row — treat as job-not-found rather than
// letting Postgres throw a 22P02 invalid-uuid error out of the transaction.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Flip a completed Job's payment `owed → paid`, owner-scoped and atomic. The
 * check-then-write runs inside one transaction with a `for update` row lock, so two
 * concurrent "mark paid" taps can never both act on a stale state. Sets `payment`
 * ONLY — `completion` is never touched (AR11). Writes nothing on any reject path.
 *
 * - non-uuid / missing (owner-scoped) → `job-not-found`
 * - not ledger-eligible (`completion !== 'completed'`) → `not-ledger-eligible`:
 *   a booked/no-show/cancelled job can never be "paid" (AR11).
 * - already `paid` → idempotent no-op, returns the row (no second write).
 *
 * Typed AR15 result; never throws across the boundary.
 */
export async function markPaid(
  ownerId: string,
  jobId: string,
): Promise<ActionResult<Job>> {
  if (!UUID_RE.test(jobId)) return fail('job-not-found');

  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(job)
        .where(and(eq(job.ownerId, ownerId), eq(job.id, jobId)))
        .for('update')
        .limit(1);

      if (!current) return fail('job-not-found');
      // AR11 gate: only a completed Job is ledger-eligible. Reuses the single
      // Story 5.1 predicate — the completion check is never re-inlined.
      if (!isLedgerEligible(current)) return fail('not-ledger-eligible');
      // Idempotent: an already-paid job returns as-is, never a second write —
      // a double-tap or replay cannot corrupt the ledger.
      if (current.payment === 'paid') return ok(current);

      const [row] = await tx
        .update(job)
        .set({ payment: 'paid' }) // payment ONLY — completion untouched (AR11)
        .where(and(eq(job.ownerId, ownerId), eq(job.id, jobId)))
        .returning();
      return ok(row);
    });
  } catch (err) {
    // AR15: fail closed with a machine reason, but log for observability.
    console.error('[ledger] markPaid failed', err);
    return fail('ledger-write-failed');
  }
}
