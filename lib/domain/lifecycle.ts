// Story 1.5 — the SOLE writer of Job.completion (AD-10). No other module (not the
// ledger, not derive, not an action) writes `completion`; every completion change
// routes through one of the transition functions here so the state machine is
// enforced in exactly one place.
//
// State machine (AD-10):
//   NORMAL   (from `booked` only):  booked → completed | no-show
//   CORRECTION (explicit operator override — the ONLY exit from a
//               terminal/completed state):
//                 completed → cancelled | booked
//                 no-show   → booked
//                 cancelled → booked
// It is a small whitelist by design — arbitrary transitions are NOT opened.
//
// completed_at: set to now() ONLY when transitioning TO `completed`; cleared to
// null for every other target (leaving `completed` clears its timestamp).
//
// Capacity is DERIVED (capacity.consumesSlot), never touched here: a `no-show`
// still consumes (never releases), and a completed→cancelled correction frees the
// slot automatically because `cancelled` does not consume. So there is no explicit
// capacity code in this module.
//
// Layering: like capacity, lifecycle is the domain service that owns a
// transactional write, so it speaks to the db client. Surfaces NEVER reach here —
// they call the Server Action, which calls lifecycle.
//
// Ledger note (Epic 5, not built here): only a `completed` Job is ledger-eligible.

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { job } from '@/lib/db/schema';
import type { Job } from '@/lib/db/schema';
import { ok, fail, type ActionResult } from '@/lib/domain/result';

// A non-UUID id can never match a real row — treat as job-not-found rather than
// letting Postgres throw a 22P02 invalid-uuid error out of the transaction.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMPLETIONS = ['booked', 'completed', 'no-show', 'cancelled'] as const;
type Completion = (typeof COMPLETIONS)[number];

// The ONE legal-transition whitelist (AD-10). current → allowed targets. Anything
// not listed is rejected as illegal-transition, writing nothing.
const LEGAL_TRANSITIONS: Record<Completion, readonly Completion[]> = {
  booked: ['completed', 'no-show'], // NORMAL marks
  completed: ['cancelled', 'booked'], // CORRECTION out of completed
  'no-show': ['booked'], // CORRECTION: resurrect a mistaken no-show
  cancelled: ['booked'], // CORRECTION: resurrect a mistaken cancel
};

function canTransition(from: string, to: string): boolean {
  const targets = LEGAL_TRANSITIONS[from as Completion];
  return targets ? targets.includes(to as Completion) : false;
}

/**
 * Atomically move a Job's `completion` to `to`, owner-scoped. The check-then-write
 * runs inside one transaction with a `for update` row lock, so two concurrent
 * marks can never both pass the legality check against a stale state. Writes
 * nothing on any reject path. Typed AR15 result; never throws across the boundary.
 */
async function transition(
  ownerId: string,
  jobId: string,
  to: Completion,
): Promise<ActionResult<Job>> {
  if (!UUID_RE.test(jobId)) return fail('job-not-found');

  try {
    return await db.transaction(async (tx) => {
      // Lock the row (owner-scoped) so the current→target legality check is
      // atomic with the update. `cancelled`/`no-show`/`completed` are terminal
      // except via correction; the lock prevents a racing second mark from
      // observing a stale `booked` and double-transitioning.
      const [current] = await tx
        .select()
        .from(job)
        .where(and(eq(job.ownerId, ownerId), eq(job.id, jobId)))
        .for('update')
        .limit(1);

      if (!current) return fail('job-not-found');
      if (!canTransition(current.completion, to)) {
        // Reject writes NOTHING — the (empty) transaction commits, which is fine.
        return fail('illegal-transition');
      }

      // completed_at is set ONLY when the target is `completed`; every other
      // target (including leaving completed) clears it to null (AD-10).
      const completedAt = to === 'completed' ? new Date().toISOString() : null;

      const [row] = await tx
        .update(job)
        .set({ completion: to, completedAt })
        .where(and(eq(job.ownerId, ownerId), eq(job.id, jobId)))
        .returning();
      return ok(row);
    });
  } catch (err) {
    // AR15: fail closed with a machine reason, but log for observability.
    console.error('[lifecycle] transition failed', err);
    return fail('lifecycle-write-failed');
  }
}

/** NORMAL mark: booked → completed. Sets completed_at. Ledger-eligible (Epic 5). */
export function markCompleted(
  ownerId: string,
  jobId: string,
): Promise<ActionResult<Job>> {
  return transition(ownerId, jobId, 'completed');
}

/**
 * NORMAL mark: booked → no-show. Still consumes the slot (consumesSlot treats
 * no-show as consuming) and is NOT payment-eligible; completed_at stays null.
 */
export function markNoShow(
  ownerId: string,
  jobId: string,
): Promise<ActionResult<Job>> {
  return transition(ownerId, jobId, 'no-show');
}

/**
 * Explicit operator CORRECTION path. `to` is validated against the SAME
 * legal-transition whitelist as the normal marks — this function shares
 * `transition()` and adds no separate guard, so the whitelist alone decides
 * legality. In practice the correction UI only surfaces this on terminal/
 * completed rows; a booked row's normal targets (completed/no-show) also pass
 * here, so callers must not rely on this function to *reject* normal marks.
 * An illegal target is rejected as illegal-transition, writing nothing. A
 * completed→cancelled correction frees the slot automatically (cancelled does
 * not consume).
 */
export function correctOutcome(
  ownerId: string,
  jobId: string,
  to: string,
): Promise<ActionResult<Job>> {
  return transition(ownerId, jobId, to as Completion);
}
