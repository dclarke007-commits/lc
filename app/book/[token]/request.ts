// Story 4.2 — the inner, unit-testable core of the NEW-CLIENT public booking request.
// Deliberately NOT a `'use server'` module (code-review 2026-07-16, story 3.2): in an
// App Router `'use server'` file EVERY exported async function becomes a client-callable
// Server Action, so exporting this raw-`{ok:false,reason}` core from actions.ts would
// expose a second public endpoint that leaks the machine reasons submitPublicRequest is
// careful to mask. Keeping it here (plain module, imported by the action and the tests)
// means only submitPublicRequest is an action, so the redirect mask can never be bypassed.
//
// A surface-adjacent caller (AD-1): it speaks to the DOMAIN (resolvePublicTokenClaims +
// resolvePublicBookingView) and ONE db write (insertPublicBookingRequest), never raw SQL.
// The stranger's identity is collected FRESH here (there is no client token — this is a
// new client); owner_id ALWAYS comes from the resolved public token, never a form field
// (AR7/AD-6). The write is fully idempotent per token-visit session (AR12) and NEVER
// consumes capacity — no commitBooking, no Job, no lock (AR5/AD-4).

import {
  resolvePublicTokenClaims,
  resolvePublicBookingView,
} from '@/lib/domain/publicToken';
import {
  insertPublicBookingRequest,
  countRecentPendingRequests,
} from '@/lib/db/queries';
import { generateTokenNonce } from '@/lib/auth/clientToken';
import { ok, fail, type ActionResult } from '@/lib/domain/result';

// Provisional-row cap window/limit (public-write rate limit, DB-backed half). Per owner:
// at most PROVISIONAL_MAX_PER_WINDOW pending_request rows may be created in the trailing
// PROVISIONAL_WINDOW_MS. Generous for a single cleaner's genuine inbound (a real stranger
// files one request) while still bounding a scripted flood. Deliberately soft — capacity's
// advisory lock is the one hard invariant; this only slows provisional-client minting.
export const PROVISIONAL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const PROVISIONAL_MAX_PER_WINDOW = 30;

/**
 * Validate + normalise the stranger's submission. Minimal rules (NFR7): name and phone
 * must be non-empty once trimmed; address is optional (nullable); a date must be
 * present (its membership in the open set is checked by the caller, not here). `visit`
 * is the per-render token-visit session nonce (AR12) — when absent/blank (a tampered or
 * direct POST that skipped the rendered form) we mint a fresh one so the submission is
 * DISTINCT, never colliding with a legitimate session's dedup row. On any failure returns
 * a machine reason and the caller writes NOTHING.
 */
export function readPublicFields(formData: FormData):
  | { ok: true; name: string; phone: string; address: string | null; date: string; sessionNonce: string }
  | { ok: false; reason: string } {
  const name = String(formData.get('name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const addressRaw = String(formData.get('address') ?? '').trim();
  const date = String(formData.get('date') ?? '').trim();
  const visit = String(formData.get('visit') ?? '').trim();

  if (!name) return { ok: false, reason: 'name-required' };
  if (!phone) return { ok: false, reason: 'phone-required' };
  if (!date) return { ok: false, reason: 'date-required' };

  // Bound the free-text fields on this UNAUTHENTICATED public write (security review
  // F2): the columns are unbounded `text`, so without a cap a scripted POST could store
  // multi-MB values per submit. 200 chars is generous for a real name/phone/address.
  const MAX_FIELD = 200;
  if (name.length > MAX_FIELD) return { ok: false, reason: 'name-too-long' };
  if (phone.length > MAX_FIELD) return { ok: false, reason: 'phone-too-long' };
  if (addressRaw.length > MAX_FIELD) return { ok: false, reason: 'address-too-long' };
  // `visit` is attacker-supplied FormData written verbatim into the unbounded `text`
  // session_nonce columns; on the tokenless /request path it is reachable WITHOUT any
  // token, so it needs the same bound as the other free-text fields (security review:
  // unbounded-visit Medium). A legitimate nonce is a short generated token.
  if (visit.length > MAX_FIELD) return { ok: false, reason: 'visit-too-long' };

  return {
    ok: true,
    name,
    phone,
    address: addressRaw || null,
    date,
    // A blank visit nonce would make the partial-unique (owner, '') collapse every
    // nonce-less link submission into ONE row — a tampered empty POST could then block
    // all legitimate first-submissions. Mint a fresh nonce instead so it stays distinct.
    sessionNonce: visit || generateTokenNonce(),
  };
}

/**
 * Resolve the public token → record a provisional client + a pending request + one
 * `link` inquiry, atomically and idempotently (AR12). Returns the typed AR15 result
 * (unit-tested directly — no redirect). Fail-closed: an unresolvable/tampered/revoked
 * token yields fail('invalid') and reveals nothing (do NOT leak which guard failed).
 *
 * The submitted date MUST be one the public view actually OFFERED (re-derived here via
 * the ONE shared open-week derive — never trust the form; mirrors confirm.ts P2). A day
 * outside the offered set → no-availability. NOTE (AR5): a day that is genuinely working
 * but currently full is still NOT in the offered open set, so it maps to no-availability
 * here too — a stranger can only request a day the operator was shown as open; capacity
 * itself is still never consumed by this path (the request holds no slot).
 */
export async function submitPublicRequestResult(
  token: string,
  formData: FormData,
): Promise<ActionResult<{ created: boolean }>> {
  const claims = await resolvePublicTokenClaims(token);
  if (!claims) {
    // Fail closed (AR15): log server-side, return a generic reason to the caller.
    console.error('[book] submitPublicRequest: token did not resolve (fail-closed)');
    return fail('invalid');
  }

  const fields = readPublicFields(formData);
  if (!fields.ok) return fail(fields.reason);

  // Provisional-row cap — cheap PRE-CHECK first (load-shed): reject BEFORE the expensive
  // open-week derive so a capped flood does not pay token+availability resolution. This is
  // best-effort; the atomic guarantee is the per-owner advisory-locked count inside
  // insertPublicBookingRequest (closes the count-then-insert TOCTOU). Owner-scoped (AR7),
  // never global. FAIL-CLOSED on a count error: if we cannot verify the cap we do NOT
  // proceed — a DB error here would fail the insert anyway, so an induced count error can
  // no longer widen the flood window (was previously fail-open).
  const capSinceIso = new Date(Date.now() - PROVISIONAL_WINDOW_MS).toISOString();
  try {
    const recent = await countRecentPendingRequests(claims.ownerId, capSinceIso);
    if (recent >= PROVISIONAL_MAX_PER_WINDOW) {
      console.warn('[book] submitPublicRequest: provisional-row cap hit (pre-check)');
      return fail('rate-limited');
    }
  } catch (err) {
    console.error(
      '[book] submitPublicRequest: provisional-row count failed (fail-closed)',
      err instanceof Error ? err.message : 'unknown',
    );
    return fail('invalid');
  }

  // Re-derive the offered open set (the same Story-1.7 derive the public view rendered).
  // Wrapped defensively: a corrupt settings.timezone makes the derive throw — that must
  // fail closed to a generic reason, never a raw 500 on the public route (story 3.1 P2).
  let view: Awaited<ReturnType<typeof resolvePublicBookingView>>;
  try {
    view = await resolvePublicBookingView(token);
  } catch (err) {
    console.error('[book] submitPublicRequest: view derive threw (fail-closed)', err);
    return fail('invalid');
  }
  if (!view.ok) return fail('invalid');
  if (!view.view.openSlots.some((slot) => slot.date === fields.date)) {
    return fail('no-availability');
  }

  try {
    const result = await insertPublicBookingRequest({
      ownerId: claims.ownerId,
      name: fields.name,
      phone: fields.phone,
      address: fields.address,
      requestedDate: fields.date,
      sessionNonce: fields.sessionNonce,
      // Atomic cap (TOCTOU close): the insert re-checks the count under a per-owner advisory
      // lock, so a concurrent burst that all passed the pre-check above cannot overshoot.
      cap: { sinceIso: capSinceIso, max: PROVISIONAL_MAX_PER_WINDOW },
    });
    // The atomic cap fired under concurrency (pre-check passed but a burst raced) — surface
    // the same "slow down" outcome as the pre-check path, not a false success.
    if (!result.created && result.reason === 'rate-limited') {
      return fail('rate-limited');
    }
    // A duplicate (same session + same day) is still a SUCCESS to the stranger — their
    // identical request already stands; we just didn't write a second copy. A different
    // day in the same session DID record a new request (created:true), no lost booking.
    return ok({ created: result.created });
  } catch (err) {
    // Log only the message (security review F4): avoid echoing a raw driver error that
    // could contain submitted field values into the platform logs.
    const detail = err instanceof Error ? err.message : 'unknown';
    console.error('[book] submitPublicRequest: write failed (fail-closed):', detail);
    return fail('invalid');
  }
}
