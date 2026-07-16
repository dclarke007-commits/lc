// Story 1.5 — the SOLE writer of Job.completion (AD-10). No other module (not the
// ledger, not derive, not an action) writes `completion`; every completion change
// routes through one of the transition functions here so the state machine is
// enforced in exactly one place.
//
// State machine (AD-10):
//   NORMAL     (from `booked`):  booked → completed | no-show | cancelled
//   CORRECTION (explicit operator override):  completed → cancelled
//   `no-show` and `cancelled` are TERMINAL (see LEGAL_TRANSITIONS for why the
//   resurrection paths are closed).
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
  // AD-10 NORMAL marks + cancel (Story 1.6): booked → completed | no-show | cancelled.
  booked: ['completed', 'no-show', 'cancelled'],
  // AD-10 permits ONLY completed → cancelled out of completed. completed → booked
  // is NOT in the invariant (was D1) — removed in Story 1.6 for quote-exactness.
  completed: ['cancelled'],
  // Terminal. Resurrection → booked re-consumes a slot with NO cap/ceiling recheck
  // (was D2, keystone bug) — closed fail-closed in Story 1.6. To undo a mistaken
  // cancel/no-show today, re-book (commitBooking is cap-checked) or reschedule; a
  // capacity-checked resurrection can be re-opened in a later story if needed.
  'no-show': [],
  cancelled: [],
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
  // Optional source-state constraint: when set, the CURRENT state must equal it
  // or the transition is rejected as illegal — lets a caller (e.g. markCancelled)
  // narrow a whitelist-legal target to a single legal source, without opening a
  // second write path. Checked under the same row lock as the whitelist.
  requireFrom?: Completion,
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
      // Source-state constraint (if any) THEN the whitelist. Either reject writes
      // NOTHING — the (empty) transaction commits, which is fine.
      if (requireFrom && current.completion !== requireFrom) {
        return fail('illegal-transition');
      }
      if (!canTransition(current.completion, to)) {
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
 * Cancel a booked job: booked → cancelled (Story 1.6, FR41). `cancelled` does NOT
 * consume (consumesSlot false), so the slot is released automatically — room-left
 * / day-maxed recompute on read with no stored counter to decrement (AD-7).
 * completed_at stays null. A cancelled job is NOT counted `completed` for lapse
 * (FR17) or repeat-rate (Epic 3). Only a booked job can be cancelled here; any
 * other source state → illegal-transition, writing nothing.
 */
export function markCancelled(
  ownerId: string,
  jobId: string,
): Promise<ActionResult<Job>> {
  // requireFrom 'booked': cancel is booked→cancelled ONLY. A completed job is
  // reversed via the correctOutcome CORRECTION path (completed→cancelled), not
  // this ordinary cancel — so the two stay cleanly separated.
  return transition(ownerId, jobId, 'cancelled', 'booked');
}

/**
 * Explicit operator CORRECTION path. `to` is validated against the SAME
 * legal-transition whitelist as the normal marks — this function shares
 * `transition()` and adds no separate guard, so the whitelist alone decides
 * legality. After Story 1.6 the only correction the whitelist still permits is
 * completed → cancelled (booked's normal targets also pass here, so callers must
 * not rely on this function to *reject* normal marks). An illegal target — e.g.
 * any resurrection back to `booked` — is rejected as illegal-transition, writing
 * nothing. A completed→cancelled correction frees the slot automatically
 * (cancelled does not consume).
 */
export function correctOutcome(
  ownerId: string,
  jobId: string,
  to: string,
): Promise<ActionResult<Job>> {
  return transition(ownerId, jobId, to as Completion);
}
