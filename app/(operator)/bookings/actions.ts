'use server';

// Sole write path = Server Actions (AD-1). The verb-first booking action calls
// capacity.commitBooking — the ONE slot-consuming insert (AD-2). Typed AR15
// return { ok, data } | { ok:false, reason }; no thrown error crosses the
// boundary, no silent catch. The FR39 override is an explicit operator toggle
// passed straight through to commitBooking (never a separate path).
//
// The surface calls THIS (never lib/db): surfaces → actions → domain → db.

import { requireOwnerId } from '@/lib/auth/requireOwnerId';
import { revalidatePath } from 'next/cache';
import {
  listClients,
  getClient,
  getJob,
  getMessageTemplates,
  upsertMessageDraft,
} from '@/lib/db/queries';
import type { Client, Job } from '@/lib/db/schema';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import { commitBooking } from '@/lib/domain/capacity';
import {
  compose,
  confirmationDraftNonce,
  type MessageDraft,
} from '@/lib/domain/compose';
import { formatDateKey } from '@/lib/domain/clock';
import { DEFAULT_TEMPLATE_BODIES } from '@/lib/domain/messageTemplateConfig';

/** Owner's clients for the booking surface's picker (owner-scoped read). */
export async function getBookableClients(): Promise<Client[]> {
  // Fail LOUD, not silent: an unresolved owner is a deploy-invariant violation.
  // Log and rethrow rather than masking it behind an empty list (a silent []
  // would read as "no clients"). The RSC render surface shows the error boundary.
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch (err) {
    console.error('[bookings] requireOwnerId failed (read path)', err);
    throw new Error('owner-unresolved');
  }
  return listClients(ownerId);
}

/** Parse the raw booking form into commitBooking's typed input fields. */
function readBookingForm(formData: FormData): {
  clientId: string;
  date: string;
  override: boolean;
  idempotencyKey: string;
} {
  return {
    clientId: String(formData.get('clientId') ?? '').trim(),
    date: String(formData.get('date') ?? '').trim(),
    // Native checkbox: present ('on') when checked, absent otherwise.
    override: formData.get('override') != null,
    // Hidden per-form nonce (AD-12): a repeat submit carries the same key.
    idempotencyKey: String(formData.get('idempotencyKey') ?? '').trim(),
  };
}

/**
 * Book a job for a client on a date, caps enforced (FR9/FR39). Resolves the
 * owner (fail-closed with a reason), then delegates the transaction + lock + cap
 * re-check + insert to capacity.commitBooking. Writes nothing on reject.
 */
export async function createBooking(
  formData: FormData,
): Promise<ActionResult<Job>> {
  const { clientId, date, override, idempotencyKey } = readBookingForm(formData);

  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch (err) {
    console.error('[bookings] requireOwnerId failed', err);
    return fail('owner-unresolved');
  }

  const result = await commitBooking({
    ownerId,
    clientId,
    date,
    override,
    idempotencyKey,
  });
  if (!result.ok) return result;

  const job = result.data;

  // Story 2.4 (AC1/AC3): produce the booking-confirmation DRAFT off the committed
  // Job — AFTER commit, OUTSIDE the capacity txn. BEST-EFFORT: a draft-write failure
  // must NEVER roll back or block the committed booking (AD-5: compose ≠ deliver; a
  // draft is not capacity-consuming, AD-2). Deterministic nonce keyed on the Job id
  // dedupes: an idempotent repeat commit (AD-12) returns the same Job → the same
  // nonce → exactly one draft. drafted_at is set here; NO dispatch (FR19, no
  // autonomous send) — the operator's tap sends it later. resulting_job_ref = job.id
  // attaches the draft to the Job it confirms (FR13).
  try {
    await upsertMessageDraft(
      ownerId,
      job.clientId,
      'booking_confirmation',
      confirmationDraftNonce(job.id),
      job.id,
    );
  } catch (err) {
    console.error('[bookings] confirmation draft write failed (booking kept)', err);
  }

  revalidatePath('/bookings');
  return ok(job);
}

/** The composed booking-confirmation draft plus the fields the send form needs. */
export interface ConfirmationDraft {
  draft: MessageDraft;
  clientId: string; // the Job's client — the send form's `client` field
  nonce: string; // the Job-keyed dispatch nonce (Story 2.3 send path)
  slot: string; // {slot} display string = the Job's scheduled date
  amountDollars: string; // the Job price in dollars, for the send form
}

/**
 * Read-and-compose the booking-confirmation draft for a committed Job (Story 2.4,
 * AC1/AC3), for the post-booking surface. Reads the Job's OWN client/date/price
 * (never re-derives the booking), plus the operator's booking-confirmation template
 * (falling back to the domain default if unseeded — mirrors previewDraft). Pure
 * read → compose; the drafted MessageLog row was already written at commit. Typed
 * AR15 result; no throw crosses the boundary.
 */
export async function getConfirmationDraft(
  jobId: string,
): Promise<ActionResult<ConfirmationDraft>> {
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch (err) {
    console.error('[bookings] requireOwnerId failed (confirmation)', err);
    return fail('owner-unresolved');
  }

  const job = await getJob(ownerId, jobId);
  if (!job) return fail('job-not-found');

  const client = await getClient(ownerId, job.clientId);
  if (!client) return fail('client-not-found');

  const templates = await getMessageTemplates(ownerId);
  const body =
    templates.find((t) => t.type === 'booking_confirmation')?.body ??
    DEFAULT_TEMPLATE_BODIES.booking_confirmation;

  // {slot} is a display string (code-review 2026-07-16, P4): format the Job's raw
  // calendar day to "Mon, Aug 3" so the client-facing confirmation never reads a bare
  // ISO date. The send form carries this SAME formatted slot so the re-compose in
  // sendDraft reproduces an identical body.
  const slot = formatDateKey(job.date);

  const draft = compose(
    { name: client.name, phone: client.phone },
    slot,
    job.priceCents,
    { type: 'booking_confirmation', body },
  );

  return ok({
    draft,
    clientId: job.clientId,
    nonce: confirmationDraftNonce(job.id),
    slot,
    amountDollars: (job.priceCents / 100).toString(),
  });
}
