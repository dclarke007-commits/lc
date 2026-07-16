'use server';

// Sole write path = Server Actions (AD-1). These verb-first actions call the
// lifecycle domain service — the ONE writer of Job.completion (AD-10). Typed AR15
// return { ok, data } | { ok:false, reason }; no thrown error crosses the
// boundary, no silent catch. The surface calls THIS (never lib/db or lifecycle
// directly): surfaces → actions → domain → db.

import { revalidatePath } from 'next/cache';
import {
  getOwnerId,
  listJobs,
  getJob,
  getClient,
  getCapacitySettings,
  getMessageTemplates,
  listJobsFrom,
  type JobListItem,
} from '@/lib/db/queries';
import type { Job } from '@/lib/db/schema';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import {
  markCompleted,
  markNoShow,
  markCancelled,
  correctOutcome as correctOutcomeLifecycle,
} from '@/lib/domain/lifecycle';
import { reschedule } from '@/lib/domain/capacity';
import { proposeRebookSlot } from '@/lib/domain/derive';
import { compose, type MessageDraft } from '@/lib/domain/compose';
import { ensureClientToken } from '@/lib/domain/booking';
import { localDateKey, weekRangeOfDate, formatDateKey } from '@/lib/domain/clock';
import {
  DEFAULT_CAPACITY,
  type CapacityConfig,
} from '@/lib/domain/capacityConfig';
import { DEFAULT_TEMPLATE_BODIES } from '@/lib/domain/messageTemplateConfig';

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

/**
 * Cancel a booked job (FR41). Reads jobId, resolves the owner fail-closed, and
 * delegates to lifecycle.markCancelled (booked→cancelled). The freed slot
 * reappears in capacity automatically — room-left is derived-on-read (AD-7), so
 * there is no counter to adjust here. Typed AR15.
 */
export async function cancelJob(
  formData: FormData,
): Promise<ActionResult<Job>> {
  const jobId = String(formData.get('jobId') ?? '').trim();

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed', err);
    return fail('owner-unresolved');
  }

  const result = await markCancelled(ownerId, jobId);
  if (!result.ok) return result;

  revalidatePath('/jobs');
  return ok(result.data);
}

/**
 * Reschedule a booked job to a new date (FR41), atomically under the cap check.
 * Reads jobId + newDate, resolves the owner fail-closed, and delegates the
 * transaction + destination-week lock + cap re-check + move to capacity.reschedule
 * (AD-12/AD-2/AD-3). Writes nothing on reject. Typed AR15.
 */
export async function rescheduleJob(
  formData: FormData,
): Promise<ActionResult<Job>> {
  const jobId = String(formData.get('jobId') ?? '').trim();
  const newDate = String(formData.get('newDate') ?? '').trim();

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed', err);
    return fail('owner-unresolved');
  }

  const result = await reschedule({ ownerId, jobId, newDate });
  if (!result.ok) return result;

  revalidatePath('/jobs');
  return ok(result.data);
}

/** The rebooking proposal: the proposed slot (formatted, or null) + its ready draft. */
export interface RebookProposal {
  slot: string | null; // {slot} display string ("Mon, Aug 3"), or null when none open
  draft: MessageDraft | null; // the composed rebooking_nudge draft, or null when no slot
}

/**
 * Story 3.3 — the one-tap rebooking PROPOSAL (FR10/FR11), mirroring
 * getConfirmationDraft's read-and-compose shape. Owner-scoped (AD-8, fail-closed).
 * Loads the tapped Job, its client, the operator capacity config (or domain defaults),
 * and this-week-forward jobs, then derives the proposed slot via the PURE
 * derive.proposeRebookSlot (cadence interval past the anchor, or soonest-open for a
 * one-time client; nearest-open alternative when the ideal is full — AC1/AC3). No slot
 * in range → ok({ slot:null, draft:null }) (the surface renders "no open slot", never
 * an error, AC3). Otherwise composes the operator's `rebooking_nudge` template (Story
 * 2.1, default body if unseeded) into a MessageDraft (Story 2.2, unchanged) and APPENDS
 * the client's stable per-client booking link (Story 3.1) to the body — satisfying FR11
 * without growing the template contract or leaking a raw {token}. This action STOPS at a
 * MessageDraft (AD-5: compose ≠ deliver): no send, no MessageLog, no dispatch. Typed AR15.
 */
export async function getRebookProposal(
  jobId: string,
): Promise<ActionResult<RebookProposal>> {
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed (rebook)', err);
    return fail('owner-unresolved');
  }

  const job = await getJob(ownerId, jobId);
  if (!job) return fail('job-not-found');

  const client = await getClient(ownerId, job.clientId);
  if (!client) return fail('client-not-found');

  // Config = the operator's persisted capacity, or the domain defaults on first-run
  // (single source, AR16). The timezone anchors "today" so the proposal never lands
  // on a past day (AD-9).
  const settings = await getCapacitySettings(ownerId);
  const config: CapacityConfig = settings
    ? {
        workingDays: settings.workingDays,
        perDayCap: settings.perDayCap,
        weeklyCeiling: settings.weeklyCeiling,
        defaultJobPriceCents: settings.defaultJobPriceCents,
        timezone: settings.timezone,
      }
    : DEFAULT_CAPACITY;

  const today = localDateKey(new Date(), config.timezone);
  const { monday } = weekRangeOfDate(today);
  const jobs = await listJobsFrom(ownerId, monday);

  // Pure derive (AD-7): computed on tap from canonical rows, never stored. Anchor is
  // the tapped job's own date.
  const { slot } = proposeRebookSlot({
    cadence: client.cadence,
    anchorDate: job.date,
    jobs,
    config,
    today,
  });

  // No open day in the bounded window: not an error (AC3). The surface renders "no
  // open slot in range."
  if (slot == null) return ok({ slot: null, draft: null });

  const formattedSlot = formatDateKey(slot);

  // Story 3.1's ONE stable per-client link (read-or-create). Appended to the body so
  // the composed draft is ready to send via Epic 2 (FR11), never a new transport key.
  const token = await ensureClientToken(ownerId, client.id);
  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const bookingUrl = `${baseUrl}/book/${encodeURIComponent(token)}`;

  // The operator's rebooking_nudge copy, or the domain default when unseeded (mirrors
  // getConfirmationDraft). compose/resolveTemplate stay UNCHANGED (Story 2.1/2.2).
  const templates = await getMessageTemplates(ownerId);
  const body =
    templates.find((t) => t.type === 'rebooking_nudge')?.body ??
    DEFAULT_TEMPLATE_BODIES.rebooking_nudge;

  const draft = compose(
    { name: client.name, phone: client.phone },
    formattedSlot,
    config.defaultJobPriceCents,
    { type: 'rebooking_nudge', body },
  );
  // Append the per-client link (FR11) — single blank-line separator. The template
  // contract is untouched: no {link}/{token} placeholder, so no raw token can leak.
  draft.body = `${draft.body}\n\n${bookingUrl}`;

  return ok({ slot: formattedSlot, draft });
}
