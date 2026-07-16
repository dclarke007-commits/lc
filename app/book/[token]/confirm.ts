// Story 3.2 — the inner, unit-testable core of the known-client direct-confirm
// booking. Deliberately NOT a `'use server'` module (code-review 2026-07-16): in
// an App Router `'use server'` file EVERY exported async function is registered as
// a client-callable Server Action. Exporting this from actions.ts therefore exposed
// a second public endpoint that returns the RAW `{ok:false, reason}` — the very
// machine reasons the confirmBooking wrapper is careful to mask (AD-3/AR4). Keeping
// it here (plain server module, imported by the action and the tests) means only
// confirmBooking is an action, so the redirect mask can never be bypassed.
//
// A surface-adjacent caller (AD-1): it speaks to the DOMAIN (resolveTokenClaims +
// commitBooking), never lib/db. commitBooking is the ONE slot-consuming insert
// (AD-2); override is ALWAYS false (a known client never overrides caps).

import { resolveTokenClaims, resolveBookingView } from '@/lib/domain/booking';
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

  // Only a slot the surface actually OFFERED as a bookable form may be confirmed
  // (code-review 2026-07-16, P2 / AC1 "confirm an open slot"). page.tsx renders a
  // POST form ONLY for openSlots (current-week days genuinely open under both caps);
  // nextOpen is informational text, not tappable. Re-derive the offered set via the
  // ONE Story-1.7 derive (resolveBookingView — never a parallel rule, AD-2/AD-7): a
  // day filled since render is no longer offered (a lost race), and a date never
  // shown (a tampered hidden field) is rejected the same way — both map to the one
  // client-facing no-availability line, so the client can never commit a day outside
  // the shown, genuinely-open set.
  const view = await resolveBookingView(token);
  if (!view.ok) {
    console.error('[book] confirmBooking: view did not resolve (fail-closed)');
    return fail('invalid');
  }
  if (!view.view.openSlots.some((slot) => slot.date === date)) {
    return fail('slot-unavailable');
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
