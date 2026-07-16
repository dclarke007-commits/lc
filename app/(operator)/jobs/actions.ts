'use server';

// Sole write path = Server Actions (AD-1). These verb-first actions call the
// lifecycle domain service — the ONE writer of Job.completion (AD-10). Typed AR15
// return { ok, data } | { ok:false, reason }; no thrown error crosses the
// boundary, no silent catch. The surface calls THIS (never lib/db or lifecycle
// directly): surfaces → actions → domain → db.

import { revalidatePath } from 'next/cache';
import { getOwnerId, listJobs, type JobListItem } from '@/lib/db/queries';
import type { Job } from '@/lib/db/schema';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import {
  markCompleted,
  markNoShow,
  correctOutcome as correctOutcomeLifecycle,
} from '@/lib/domain/lifecycle';

/** Owner's jobs for the jobs surface (owner-scoped read). */
export async function getOwnerJobs(): Promise<JobListItem[]> {
  // Fail LOUD, not silent: an unresolved owner is a deploy-invariant violation.
  // Log and rethrow rather than masking it behind an empty list (a silent []
  // would read as "no jobs"). The RSC render surface shows the error boundary.
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed (read path)', err);
    throw new Error('owner-unresolved');
  }
  return listJobs(ownerId);
}

/**
 * NORMAL mark of a booked job's outcome (FR40). Reads jobId + outcome (must be
 * `completed` or `no-show`), resolves the owner fail-closed, then delegates to
 * lifecycle.markCompleted/markNoShow. Any other outcome is illegal-transition.
 */
export async function markOutcome(
  formData: FormData,
): Promise<ActionResult<Job>> {
  const jobId = String(formData.get('jobId') ?? '').trim();
  const outcome = String(formData.get('outcome') ?? '').trim();

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed', err);
    return fail('owner-unresolved');
  }

  let result: ActionResult<Job>;
  if (outcome === 'completed') {
    result = await markCompleted(ownerId, jobId);
  } else if (outcome === 'no-show') {
    result = await markNoShow(ownerId, jobId);
  } else {
    // Not a valid NORMAL mark — reject before touching the domain.
    return fail('illegal-transition');
  }
  if (!result.ok) return result;

  revalidatePath('/jobs');
  return ok(result.data);
}

/**
 * Explicit operator CORRECTION path (AD-10). Reads jobId + the target `to`,
 * resolves the owner fail-closed, and delegates to lifecycle.correctOutcome.
 * Legality is decided SOLELY by the lifecycle whitelist — this action adds no
 * separate source-state guard, so it does not itself guarantee the row is
 * terminal/completed; an illegal `to` comes back as illegal-transition. The
 * correction UI only surfaces this on terminal/completed rows.
 */
export async function correctOutcome(
  formData: FormData,
): Promise<ActionResult<Job>> {
  const jobId = String(formData.get('jobId') ?? '').trim();
  const to = String(formData.get('to') ?? '').trim();

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed', err);
    return fail('owner-unresolved');
  }

  const result = await correctOutcomeLifecycle(ownerId, jobId, to);
  if (!result.ok) return result;

  revalidatePath('/jobs');
  return ok(result.data);
}
