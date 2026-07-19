'use server';

// Story 4.4 — the operator's MANUAL inquiry log (FR37/AR12). Sole write path = Server
// Actions (AD-1). Owner is resolved from the SESSION via requireOwnerId (AD-8) — this is an
// authenticated operator surface (behind proxy.ts), NOT the public token path of 4.2.
// Return contract (AR15): { ok, data } | { ok:false, reason }; no thrown error crosses
// the boundary; only lib/db speaks SQL (AD-1), reached directly here.
//
// SECURITY (AR12): `link` is a SERVER-ONLY inquiry source — auto-logged by the 4.2 public
// submission transaction. This action WHITELISTS exactly phone|walk-in|referral|other and
// REJECTS `link` (and any unknown value), writing nothing, so a hand-crafted source=link
// POST can never forge a link inquiry and skew provenance.

import { requireOwnerId } from '@/lib/auth/requireOwnerId';
import { revalidatePath } from 'next/cache';
import {
  getClient,
  insertInquiry,
  listInquiries,
  type InquiryListItem,
} from '@/lib/db/queries';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import type { Inquiry } from '@/lib/db/schema';

// The four MANUAL sources the operator may log. `link` is DELIBERATELY absent (AR12 —
// server-only). Kept in lockstep with the pgEnum minus `link`.
const MANUAL_SOURCES = ['phone', 'walk-in', 'referral', 'other'] as const;
type ManualSource = (typeof MANUAL_SOURCES)[number];

function isManualSource(v: string): v is ManualSource {
  return (MANUAL_SOURCES as readonly string[]).includes(v);
}

/**
 * Owner-scoped read for the RSC surface. The surface calls this action instead of
 * importing lib/db (dependency direction: surfaces → actions → db). owner_id is
 * resolved here, so the filter value is always applied.
 */
export async function listOwnerInquiries(): Promise<InquiryListItem[]> {
  const ownerId = await requireOwnerId();
  return listInquiries(ownerId);
}

/**
 * Log a manual inquiry with its source (AC1). Reads `source` and WHITELISTS the four
 * manual values — `link` or any unknown value is rejected with a machine reason and
 * NOTHING is written (AR12). Optional `clientId`: when provided it must be a real,
 * owner-scoped client (getClient UUID-guards + owner-scopes); absent → null (an
 * anonymous verbal inquiry). Owner from the session, fail-closed (AD-8/AR15).
 */
export async function logInquiry(
  formData: FormData,
): Promise<ActionResult<Inquiry>> {
  const source = String(formData.get('source') ?? '').trim();
  // WHITELIST gate FIRST (no write on a bad source, AR12) — `link`/unknown → rejected.
  if (!isManualSource(source)) return fail('source-invalid');

  const clientIdRaw = String(formData.get('clientId') ?? '').trim();
  // Per-render submit nonce (Epic 4 retro action item): dedups a double-tapped log of the
  // SAME rendered form. Empty → null (no dedup). The surface embeds a fresh nonce per render.
  const submitNonce = String(formData.get('submitNonce') ?? '').trim() || null;

  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[inquiries] requireOwnerId failed', err);
    return fail('owner-unresolved');
  }

  // Optional clientId: when present it must resolve to an existing owner-scoped client
  // (getClient guards a non-UUID → undefined, and a cross-owner id → undefined). Absent
  // → null. A provided-but-unknown id fails closed rather than logging an orphan ref.
  let clientId: string | null = null;
  if (clientIdRaw) {
    const c = await getClient(ownerId, clientIdRaw);
    if (!c) return fail('client-not-found');
    clientId = c.id;
  }

  try {
    const row = await insertInquiry({ ownerId, source, clientId, sessionNonce: submitNonce });
    revalidatePath('/inquiries');
    return ok(row);
  } catch (err) {
    // AR15: fail closed with a machine reason, but log for observability.
    console.error('[inquiries] inquiry write failed', err);
    return fail('inquiry-write-failed');
  }
}
