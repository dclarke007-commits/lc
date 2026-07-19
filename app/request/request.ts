// Task 4 — Tokenless NEW-CLIENT public request core (homepage self-serve). Mirror of the
// token path (app/book/[token]/request.ts) with two differences: (1) owner_id comes
// from the single-owner lookup getOwnerId() — NEVER a form field (AR7/AD-6); (2) there
// is no per-client offered slot set, so the date is stored as a stated preference and
// no open-week derive runs. Capacity is STILL never consumed (AR5): the write mints only
// a provisional client + pending request + one inquiry, idempotent per visit (AR12). The
// inquiry's source defaults to 'link' (insertPublicBookingRequest hardcodes it) — the
// homepage path reuses the token path's dedup index rather than a dedicated 'web' value.
//
// A plain module (NOT 'use server') so it is unit-testable and is NOT itself a public
// endpoint — only a future app/request/actions.ts would register the redirect-masked
// Server Action.

import { getOwnerId, insertPublicBookingRequest, countRecentPendingRequests } from '@/lib/db/queries';
import {
  readPublicFields,
  PROVISIONAL_WINDOW_MS,
  PROVISIONAL_MAX_PER_WINDOW,
} from '@/app/book/[token]/request';
import { ok, fail, type ActionResult } from '@/lib/domain/result';

export async function submitPublicRequestNoToken(
  formData: FormData,
): Promise<ActionResult<{ created: boolean }>> {
  // Single-owner v1: owner_id is resolved server-side, never from the form (AR7/AD-6).
  // getOwnerId throws when unseeded — fail closed to a generic reason (never a raw 500).
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch {
    console.error('[request] no operator seeded (fail-closed)');
    return fail('invalid');
  }

  const fields = readPublicFields(formData);
  if (!fields.ok) return fail(fields.reason);

  // Provisional-row cap pre-check (load-shed). Fail-closed on a count error — the same
  // discipline as the token path: an induced count error must not widen the flood window.
  const capSinceIso = new Date(Date.now() - PROVISIONAL_WINDOW_MS).toISOString();
  try {
    const recent = await countRecentPendingRequests(ownerId, capSinceIso);
    if (recent >= PROVISIONAL_MAX_PER_WINDOW) return fail('rate-limited');
  } catch {
    console.error('[request] provisional-row count failed (fail-closed)');
    return fail('invalid');
  }

  try {
    const result = await insertPublicBookingRequest({
      ownerId,
      name: fields.name,
      phone: fields.phone,
      address: fields.address,
      requestedDate: fields.date, // stated preference; no open-set validation (no token view)
      sessionNonce: fields.sessionNonce,
      cap: { sinceIso: capSinceIso, max: PROVISIONAL_MAX_PER_WINDOW },
    });
    if (!result.created && result.reason === 'rate-limited') return fail('rate-limited');
    return ok({ created: result.created }); // duplicate (same session+day) is still success
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown';
    console.error('[request] write failed (fail-closed):', detail);
    return fail('invalid');
  }
}
