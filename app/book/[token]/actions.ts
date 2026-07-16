'use server';

// Story 3.2 — the KNOWN-CLIENT direct-confirm booking action on the public
// per-client surface. The client is already known (the token IS the authorization,
// AD-6/AR7): we resolve client_id + owner_id from the token and NEVER re-collect
// identity, create a PendingRequest, or run an approval step — known clients skip
// the queue and commit directly (AD-4/FR7).
//
// A surface (AD-1): it calls the DOMAIN (resolveTokenClaims + commitBooking), never
// lib/db. commitBooking is the ONE slot-consuming insert (AD-2); override is ALWAYS
// false (a known client never overrides caps). Typed AR15 result from the inner,
// unit-testable function; the thin form wrapper maps it to a zero-JS redirect (NFR1).

import { redirect } from 'next/navigation';
import { resolveTokenClaims } from '@/lib/domain/booking';
import { commitBooking } from '@/lib/domain/capacity';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import type { Job } from '@/lib/db/schema';

/**
 * Resolve the token → commit the booking. Returns the typed AR15 result (unit-tested
 * directly — no redirect, no NEXT_REDIRECT). Fail-closed: an unresolvable/tampered/
 * revoked token yields fail('invalid') and reveals nothing (do NOT leak which guard
 * failed). The idempotency key is SERVER-DERIVED as `book:<clientId>:<date>` — the
 * client is fixed by the token and the slot (day) is the target, so a double-tap on
 * the same slot replays the SAME key → the SAME Job (AC2/AD-12), while a different
 * date derives a different key → a new Job. clientId/ownerId ALWAYS come from the
 * token, never from a form field (AR7/AD-6).
 */
export async function confirmBookingResult(
  token: string,
  date: string,
): Promise<ActionResult<Job>> {
  const claims = await resolveTokenClaims(token);
  if (!claims) {
    // Fail closed (AR15): log server-side, return a generic reason to the caller.
    console.error('[book] confirmBooking: token did not resolve (fail-closed)');
    return fail('invalid');
  }

  const idempotencyKey = `book:${claims.clientId}:${date}`;
  const result = await commitBooking({
    ownerId: claims.ownerId,
    clientId: claims.clientId,
    date,
    override: false,
    idempotencyKey,
  });
  if (!result.ok) {
    console.error('[book] confirmBooking rejected', result.reason);
    return result;
  }
  return ok(result.data);
}

/**
 * Zero-JS form wrapper (NFR1): the open-slot POST carries `token` (route token) and
 * `date` (that slot). Reads them, delegates to confirmBookingResult, then redirects.
 * `redirect()` throws NEXT_REDIRECT so each branch terminates the action. The two
 * capacity reasons (day-maxed | week-full) map to ONE client-facing no-availability
 * outcome — a lost race after view (AC3/FR9/AR4); the raw machine reason is never
 * shown. Any other reason (including a fail-closed invalid token) → generic invalid.
 */
export async function confirmBooking(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const date = String(formData.get('date') ?? '');

  const result = await confirmBookingResult(token, date);
  if (result.ok) redirect(`/book/${encodeURIComponent(token)}?booked=1`);

  if (result.reason === 'day-maxed' || result.reason === 'week-full') {
    redirect(`/book/${encodeURIComponent(token)}?error=no-availability`);
  }
  redirect(`/book/${encodeURIComponent(token)}?error=invalid`);
}
