// Booking-surface domain orchestration (Story 3.1). The public route
// (app/book/[token]) calls resolveBookingView — it never touches lib/db or the
// crypto directly (AD-1: surface → domain → db). Two responsibilities:
//
//   • ensureClientToken  — Task 2: mint (sign, deterministic) + persist the ONE
//     stable per-client booking link.
//   • resolveBookingView — Tasks 3+4: turn a bearer token into a scoped, genuinely-
//     open-slot view, or a generic failure that reveals NOTHING.
//
// Security spine (AD-6): the token is the entire authorization. Verification is a
// FAIL-CLOSED chain — signature → revocation row → owner/client scope — and every
// slot read is owner-scoped on the value the token proved (AD-8). The genuinely-open
// predicate is Story 1.7's derive, never re-derived here (AD-2/AD-7).

import {
  getClientTokenSecret,
  signClientToken,
  verifyClientToken,
  generateTokenNonce,
  type TokenCapability,
  type ClientTokenClaims,
} from '@/lib/auth/clientToken';
import {
  findTokenByValue,
  findClientToken,
  insertClientTokenIfAbsent,
  rotateClientTokenRow,
  deleteClientToken,
  getClient,
  getCapacitySettings,
  listJobsFrom,
} from '@/lib/db/queries';
import { DEFAULT_CAPACITY, type CapacityConfig } from '@/lib/domain/capacityConfig';
import { localDateKey, weekRangeOfDate } from '@/lib/domain/clock';
import { weekCapacity, nearestOpen } from '@/lib/domain/derive';

/** The per-client capability minted here (view one client's slots + book them, 3.2). */
const PER_CLIENT_CAPABILITY: TokenCapability = 'book-client';

/**
 * Return the ONE stable per-client booking link, creating it on first call (Task 2 /
 * code-review D1). READ-OR-CREATE, not upsert: if a row already exists we return its
 * stored token verbatim — so calling this repeatedly (e.g. Story 3.3 regenerating links
 * to send) yields the SAME URL and, crucially, can NEVER resurrect a rotated/revoked
 * link. Only a first mint signs, folding in a fresh persisted random nonce (D1) so the
 * signature is unguessable and revocation is durable. Returns the token to embed in the
 * client's URL. Revoke with revokeClientToken; reissue with rotateClientToken.
 */
export async function ensureClientToken(
  ownerId: string,
  clientId: string,
): Promise<string> {
  const secret = getClientTokenSecret();
  const existing = await findClientToken(
    ownerId,
    clientId,
    PER_CLIENT_CAPABILITY,
  );
  if (existing) {
    // Stable link: return the stored value AS LONG AS it still verifies. If the
    // CLIENT_TOKEN_SECRET was rotated, the stored signature no longer validates —
    // re-sign with the SAME persisted nonce (identity unchanged, D1 durability kept)
    // and refresh the row so the client is never handed a dead link (heals rotation,
    // Story 3.1 P1). A stale row does NOT resurrect a revoked link: revocation deletes
    // the row, so this branch is never reached for a revoked client.
    if (await verifyClientToken(existing.tokenValue, secret)) {
      return existing.tokenValue;
    }
    const healed = await signClientToken(
      { clientId, ownerId, capability: PER_CLIENT_CAPABILITY, nonce: existing.nonce },
      secret,
    );
    const row = await rotateClientTokenRow(
      ownerId,
      clientId,
      healed,
      PER_CLIENT_CAPABILITY,
      existing.nonce,
    );
    return row.tokenValue;
  }

  const nonce = generateTokenNonce();
  const tokenValue = await signClientToken(
    { clientId, ownerId, capability: PER_CLIENT_CAPABILITY, nonce },
    secret,
  );
  const row = await insertClientTokenIfAbsent(
    ownerId,
    clientId,
    tokenValue,
    PER_CLIENT_CAPABILITY,
    nonce,
  );
  return row.tokenValue;
}

/**
 * Rotate the client's link (D1 durable reissue): mint a fresh nonce → a genuinely NEW
 * token value and overwrite the row. The previously-issued link (possibly leaked) stops
 * resolving immediately and forever, while the client gets a working new URL. Returns
 * the new token string. Use when a link may be compromised but the client should keep
 * booking access.
 */
export async function rotateClientToken(
  ownerId: string,
  clientId: string,
): Promise<string> {
  const secret = getClientTokenSecret();
  const nonce = generateTokenNonce();
  const tokenValue = await signClientToken(
    { clientId, ownerId, capability: PER_CLIENT_CAPABILITY, nonce },
    secret,
  );
  const row = await rotateClientTokenRow(
    ownerId,
    clientId,
    tokenValue,
    PER_CLIENT_CAPABILITY,
    nonce,
  );
  return row.tokenValue;
}

/**
 * Revoke the client's link (D1): delete the row so the token fails closed on the next
 * request even though its HMAC is still valid. Durable — a later ensureClientToken mints
 * a brand-new nonce/value, never the deleted one. Returns true if a link was removed.
 */
export async function revokeClientToken(
  ownerId: string,
  clientId: string,
): Promise<boolean> {
  return deleteClientToken(ownerId, clientId, PER_CLIENT_CAPABILITY);
}

/** A genuinely-open day the client may book (day under cap AND week under ceiling). */
export interface OpenSlot {
  date: string; // operator-local 'YYYY-MM-DD'
  isoWeekday: number; // 1=Mon..7=Sun
}

/** The client-facing view: one client's open slots for the current operator week. */
export interface BookingView {
  clientName: string;
  timezone: string;
  weekStart: string; // Monday (inclusive)
  weekEnd: string; // next Monday (exclusive)
  openSlots: OpenSlot[]; // genuinely-open days this week (may be empty)
  nextOpen: string | null; // next open working day when this week has none
}

/**
 * Resolve outcome. On ANY failure the result is a bare { ok: false } — the caller
 * renders one generic invalid-link message. We never distinguish "unknown token"
 * from "revoked" from "no such client", so a bearer learns nothing about existence.
 */
export type ResolveResult = { ok: true; view: BookingView } | { ok: false };

const INVALID: ResolveResult = { ok: false };

/**
 * The ONE fail-closed token→claims chain (AD-6), reused by BOTH the view resolver
 * (Story 3.1) and the client-confirm action (Story 3.2). Returns the signed claims
 * ONLY when every guard passes, else null (never a partial or a reason):
 *   1. Signature — unforgeable proof of the claims (secret held server-side only).
 *      A weak/missing secret throws in getClientTokenSecret; caught → null (fail
 *      closed), never a leaked server error.
 *   2. Capability — must be exactly the per-client booking capability.
 *   3. Revocation — a matching row must still exist (delete = revoke, even though the
 *      HMAC stays valid) and its columns must agree with the signed claims.
 * The caller then does its own owner-scoped work (view: getClient; confirm:
 * commitBooking, which re-checks the client belongs to the owner under the lock).
 */
export async function resolveTokenClaims(
  tokenValue: string | undefined | null,
): Promise<ClientTokenClaims | null> {
  if (!tokenValue) return null;

  // 1–2. Signature + capability.
  let secret: string;
  try {
    secret = getClientTokenSecret();
  } catch {
    return null;
  }
  const claims = await verifyClientToken(tokenValue, secret);
  if (!claims) return null;
  if (claims.capability !== PER_CLIENT_CAPABILITY) return null;
  if (!claims.clientId || !claims.ownerId) return null;

  // 3. Revocation: the row must exist AND agree with the signed claims. A deleted row
  // (revoked link) or any mismatch fails closed here. The nonce agreement (D1) makes a
  // rotated link's OLD value fail closed even in the unreachable case that its string
  // ever re-collided — the row now carries the CURRENT nonce, and a superseded token
  // embeds the old one.
  const row = await findTokenByValue(tokenValue);
  if (
    !row ||
    row.ownerId !== claims.ownerId ||
    row.clientId !== claims.clientId ||
    row.capability !== claims.capability ||
    row.nonce !== claims.nonce
  ) {
    return null;
  }

  return claims;
}

/**
 * Turn a bearer token into a scoped open-slot view (Tasks 3+4), or INVALID. Resolves
 * the token via the ONE fail-closed chain (resolveTokenClaims), then adds step 4:
 *   4. Scope — read ONLY this client, owner-scoped (AD-8): a token for client A under
 *      owner O can never surface client B or another owner's rows.
 * Then it derives genuinely-open slots via Story 1.7 (AD-2/AD-7) — no mutation here
 * (booking is Story 3.2).
 */
export async function resolveBookingView(
  tokenValue: string | undefined | null,
): Promise<ResolveResult> {
  const claims = await resolveTokenClaims(tokenValue);
  if (!claims) return INVALID;

  // 4. Scope: read ONLY this client, owner-scoped. Both predicates (owner AND id) are
  // enforced in the query, so a token can never resolve another owner's/client's row.
  const client = await getClient(claims.ownerId, claims.clientId);
  if (!client) return INVALID;

  // Genuinely-open slots: the operator's config + this-week-forward jobs, owner-scoped,
  // fed to the pure Story 1.7 derive. Defaults on first-run (no settings row) come from
  // the domain, never the DB (single source, AR16). Wrapped in try/catch (code-review
  // P2): a corrupt/invalid config.timezone makes localDateKey's Intl.DateTimeFormat
  // throw — on this PUBLIC surface that must fail closed to the generic invalid-link,
  // never surface a 500 (AD-6 fail-closed), so we log and return INVALID.
  try {
    const settings = await getCapacitySettings(claims.ownerId);
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
    const jobs = await listJobsFrom(claims.ownerId, monday);
    const week = weekCapacity(jobs, config, today);

    const openSlots: OpenSlot[] = week.days
      .filter((d) => d.open)
      .map((d) => ({ date: d.date, isoWeekday: d.isoWeekday }));

    // When this week has no open day, offer the single next open working day (FR28),
    // so a saturated week still points the client somewhere bookable.
    const nextOpen =
      openSlots.length === 0 ? (nearestOpen(jobs, config, today)[0] ?? null) : null;

    return {
      ok: true,
      view: {
        clientName: client.name,
        timezone: config.timezone,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        openSlots,
        nextOpen,
      },
    };
  } catch (err) {
    console.error('[booking] resolveBookingView slot derivation failed', err);
    return INVALID;
  }
}
