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
import { confirmBookingResult } from './confirm';
import { submitPublicRequestResult } from './request';
import { getRequestIp } from '@/lib/security/requestIp';
import { checkThrottle } from '@/lib/security/rateLimit';

// Per-IP sliding-window throttle for the UNAUTHENTICATED public writes (retrospective
// action item — the previously-LOCKED gap). The cheap first line against a single source
// hammering the book surface; the DURABLE per-owner cap on provisional rows lives in
// request.ts. Distinct key prefixes give confirm and submit separate budgets. Best-effort
// (in-memory, per-instance) — see lib/security/rateLimit for the documented limitation.
const BOOK_THROTTLE = { limit: 10, windowMs: 60_000 };

// confirmBookingResult (the token→commit core) lives in ./confirm — a non-'use
// server' module — so it is NOT registered as a public Server Action. Only
// confirmBooking below is an action, so the redirect mask can never be bypassed
// (code-review 2026-07-16).

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

  // Throttle before any DB work. On block, redirect-mask to the existing generic banner
  // (the known-client surface already renders `invalid`) — never reveal the throttle.
  const ip = await getRequestIp();
  if (!checkThrottle(`book:confirm:${ip}`, Date.now(), BOOK_THROTTLE).allowed) {
    redirect(`/book/${encodeURIComponent(token)}?error=invalid`);
  }

  const result = await confirmBookingResult(token, date);
  if (result.ok) redirect(`/book/${encodeURIComponent(token)}?booked=1`);

  if (
    result.reason === 'day-maxed' ||
    result.reason === 'week-full' ||
    result.reason === 'slot-unavailable'
  ) {
    redirect(`/book/${encodeURIComponent(token)}?error=no-availability`);
  }
  redirect(`/book/${encodeURIComponent(token)}?error=invalid`);
}

/**
 * Story 4.2 — the NEW-CLIENT public request action (zero-JS form, NFR1). A stranger
 * submits name/phone/address + a chosen open day on the ONE public link; this delegates
 * to submitPublicRequestResult (resolve token → provisional client + PendingRequest +
 * one `link` inquiry, idempotent per visit, NO capacity — AR5/AR12) and redirect-masks
 * the outcome. `redirect()` throws NEXT_REDIRECT so each branch terminates the action.
 * A day that filled or was never offered (a lost race / tampered field) maps to the one
 * client-facing no-availability line; any other rejection (including a fail-closed
 * invalid token) → generic invalid. The raw machine reason is never shown.
 */
export async function submitPublicRequest(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');

  // Throttle before any DB work (per-IP first line); the durable per-owner provisional-row
  // cap is enforced inside submitPublicRequestResult. Both map to the one "slow down" copy.
  const ip = await getRequestIp();
  if (!checkThrottle(`book:submit:${ip}`, Date.now(), BOOK_THROTTLE).allowed) {
    redirect(`/book/${encodeURIComponent(token)}?error=too-many`);
  }

  const result = await submitPublicRequestResult(token, formData);
  if (result.ok) redirect(`/book/${encodeURIComponent(token)}?submitted=1`);

  if (result.reason === 'no-availability') {
    redirect(`/book/${encodeURIComponent(token)}?error=no-availability`);
  }
  // The DB-backed provisional-row cap surfaces as the same "slow down" banner as the
  // per-IP throttle above (abuse path — a generic, non-revealing message).
  if (result.reason === 'rate-limited') {
    redirect(`/book/${encodeURIComponent(token)}?error=too-many`);
  }
  redirect(`/book/${encodeURIComponent(token)}?error=invalid`);
}
