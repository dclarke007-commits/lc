'use server';

// Sole write path = Server Actions (AD-1). The verb-first booking action calls
// capacity.commitBooking — the ONE slot-consuming insert (AD-2). Typed AR15
// return { ok, data } | { ok:false, reason }; no thrown error crosses the
// boundary, no silent catch. The FR39 override is an explicit operator toggle
// passed straight through to commitBooking (never a separate path).
//
// The surface calls THIS (never lib/db): surfaces → actions → domain → db.

import { revalidatePath } from 'next/cache';
import { getOwnerId, listClients } from '@/lib/db/queries';
import type { Client, Job } from '@/lib/db/schema';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import { commitBooking } from '@/lib/domain/capacity';

/** Owner's clients for the booking surface's picker (owner-scoped read). */
export async function getBookableClients(): Promise<Client[]> {
  // Fail LOUD, not silent: an unresolved owner is a deploy-invariant violation.
  // Log and rethrow rather than masking it behind an empty list (a silent []
  // would read as "no clients"). The RSC render surface shows the error boundary.
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[bookings] getOwnerId failed (read path)', err);
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
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[bookings] getOwnerId failed', err);
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

  revalidatePath('/bookings');
  return ok(result.data);
}
