'use server';

// Story 4.3 — the operator's approval-queue actions. Sole write path = Server
// Actions (AD-1). Owner is resolved from the SESSION via requireOwnerId (AD-8) — this is
// an authenticated operator surface (behind proxy.ts), NOT the public token path of
// 4.2. The ONLY untrusted input is the pending-request `id`; owner/client/date are
// never taken from a form field. Approve routes through the ONE capacity path
// (commitBooking, AD-2) — caps are never re-checked here; decline never touches
// capacity. Return contract (AR15): { ok, data } | { ok:false, reason }; no thrown
// error crosses the boundary; only lib/db speaks SQL (AD-1), reached directly here.

import { requireOwnerId } from '@/lib/auth/requireOwnerId';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { client } from '@/lib/db/schema';
// The capacity-side reasons that mean "this slot is no longer bookable" (the day
// filled, or the requested day is now past / non-working since the stranger picked
// it). These are the ONLY commitBooking failures the operator sees as
// 'no-availability'; anything else is a generic 'approve-failed'. Kept as a Set so
// the mapping is defined once (grepping `fail(` in lib/domain/capacity.ts yields the
// full reason vocabulary: day-maxed, week-full, date-past, non-working-day, plus the
// shape/precondition reasons date-invalid / client-not-found / booking-conflict /
// idempotency-key-missing / booking-failed which are NOT slot-availability).
const NO_AVAILABILITY_REASONS = new Set([
  'day-maxed',
  'week-full',
  'date-past',
  'non-working-day',
]);
import {
  listPendingRequests,
  getPendingRequest,
  setPendingRequestStatus,
  type PendingRequestListItem,
} from '@/lib/db/queries';
import { commitBooking } from '@/lib/domain/capacity';
import { ok, fail, type ActionResult } from '@/lib/domain/result';

/**
 * Owner-scoped read for the RSC queue surface. The surface calls this action instead
 * of importing lib/db (dependency direction: surfaces → actions → db). owner_id is
 * resolved here, so the filter value is always applied.
 */
export async function listOwnerPendingRequests(): Promise<
  PendingRequestListItem[]
> {
  const ownerId = await requireOwnerId();
  return listPendingRequests(ownerId);
}

/**
 * Approve a pending new-client request (AC2) — race-safe, self-healing. Re-reads the
 * request owner-scoped; a missing / declined / withdrawn row is unreachable →
 * fail('not-pending'). `pending` and `approved` may both proceed: `approved` is the
 * RESUME path for an approve that committed a Job but crashed before promoting the
 * client, so a retry heals it (no stranded provisional client, no double Job).
 *
 * Ordering (the fix): ELECT THE WINNER FIRST. When still `pending`, guard-flip
 * pending→approved BEFORE commitBooking. This closes the decline/approve phantom-Job
 * window — a concurrent decline guards pending→declined, so it either wins the flip
 * first (this approve then reads a declined row → not-pending, never commits) or loses
 * (this approve already owns `approved`; the decline no-ops). A Job can never end up
 * under a declined request. Commit is idempotent on the deterministic `approve:<id>`
 * key (AD-12), so the resume path REPLAYS the same Job rather than consuming twice.
 *
 * On a commit failure we FIRST roll the status back to `approved`→`pending` so the
 * request stays actionable (the operator can retry or decline), THEN map the reason:
 * a slot-no-longer-bookable reason → fail('no-availability'); anything else →
 * fail('approve-failed'). Client promotion (provisional→active) runs only AFTER a
 * successful commit and is itself idempotent (guarded on status='provisional').
 */
export async function approveRequest(
  formData: FormData,
): Promise<ActionResult<void>> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return fail('id-required');

  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[requests] requireOwnerId failed', err);
    return fail('owner-unresolved');
  }

  try {
    // Re-read state under the mutation (never trust the surface). Missing, or already
    // terminal-off-the-approve-path (declined/withdrawn), or another owner's → not
    // actionable. `pending` (fresh) and `approved` (resume a half-finished approve) both
    // proceed below.
    const req = await getPendingRequest(ownerId, id);
    if (!req) return fail('not-pending');
    if (req.status === 'declined' || req.status === 'withdrawn') {
      return fail('not-pending');
    }

    // ELECT THE WINNER before committing (only when still pending). The guarded flip
    // pending→approved is the concurrency backstop: whoever flips it owns the approve.
    if (req.status === 'pending') {
      const elected = await setPendingRequestStatus(
        ownerId,
        id,
        'pending',
        'approved',
      );
      if (!elected) {
        // A concurrent action moved it out of `pending` in the gap. Re-read: if a
        // concurrent approve already elected `approved`, resume (idempotent — the commit
        // below replays the same Job). Anything else (declined/withdrawn/gone) → stale.
        const now = await getPendingRequest(ownerId, id);
        if (!now || now.status !== 'approved') return fail('not-pending');
      }
      // else: we elected the winner — the row is now `approved`. Fall through to commit.
    }

    // The sole capacity-consuming insert (AD-2). commitBooking owns the advisory lock,
    // the cap re-check, and the one-winner guarantee (AR4) — do NOT re-derive caps here.
    // Deterministic key → the resume/double path REPLAYS the same Job (AD-12), never a
    // second consume.
    const commit = await commitBooking({
      ownerId,
      clientId: req.clientId,
      date: req.date,
      override: false,
      idempotencyKey: `approve:${req.id}`,
    });
    if (!commit.ok) {
      // Commit wrote nothing. Roll the status back to `pending` FIRST so the request
      // stays in the queue and actionable (the operator can retry or decline) — leaving
      // it stuck on `approved` with no Job is the "misleading banner" bug. The guarded
      // rollback only fires on the row WE just elected (approved→pending); if a concurrent
      // action already moved it, this no-ops harmlessly.
      await setPendingRequestStatus(ownerId, id, 'approved', 'pending');
      if (NO_AVAILABILITY_REASONS.has(commit.reason)) {
        // The day filled up, or the requested day is now past / non-working since submit
        // → surface no-longer-available (the operator can decline). The raw machine
        // reason never crosses as a 500.
        return fail('no-availability');
      }
      return fail('approve-failed');
    }

    // A real booking exists now → promote the provisional client into the active book
    // (owner+id scoped, AD-8). Guarded on status='provisional' so it is idempotent: a
    // resume/replay where the client is already active is a harmless no-op. Runs AFTER
    // the successful commit, so a fault here leaves status=`approved` + Job committed —
    // a retry re-reads `approved`, skips the flip, REPLAYS the same Job, and re-promotes
    // (self-heals; no stranded provisional client).
    await db
      .update(client)
      .set({ status: 'active', updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(client.ownerId, ownerId),
          eq(client.id, req.clientId),
          eq(client.status, 'provisional'),
        ),
      );

    revalidatePath('/requests');
    return ok(undefined);
  } catch (err) {
    // AR15: fail closed with a machine reason, but log for observability.
    console.error('[requests] approve failed', err);
    return fail('approve-failed');
  }
}

/**
 * Decline a pending request (AC3) — flip pending→declined via the guarded transition.
 * NO capacity touch: the slot is untouched, no Job, no cap change. A non-pending
 * request matches zero rows → a stale no-op (masked as not-pending). Owner from the
 * session (AD-8); the id is the only untrusted input.
 */
export async function declineRequest(
  formData: FormData,
): Promise<ActionResult<void>> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return fail('id-required');

  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[requests] requireOwnerId failed', err);
    return fail('owner-unresolved');
  }

  try {
    const row = await setPendingRequestStatus(ownerId, id, 'pending', 'declined');
    if (!row) return fail('not-pending');
    revalidatePath('/requests');
    return ok(undefined);
  } catch (err) {
    // AR15: fail closed with a machine reason, but log for observability.
    console.error('[requests] decline failed', err);
    return fail('decline-failed');
  }
}
