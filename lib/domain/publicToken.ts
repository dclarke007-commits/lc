// Public self-serve booking token domain orchestration (Story 4.1). The sibling of
// booking.ts's per-client seam, for the ONE client-less public token (the book-public
// capability, AD-6/FR4). The operator link surface calls ensurePublicToken; the public
// route (app/book/[token]) calls resolvePublicBookingView — neither touches lib/db or
// the crypto directly (AD-1: surface → domain → db).
//
// Security spine (AD-6), identical to the per-client token: the token is the entire
// authorization. Verification is a FAIL-CLOSED chain — signature → capability →
// revocation row (with owner + capability + nonce agreement, AND client_id IS NULL) —
// and the open-slot derive is owner-scoped (AD-8), shared with the per-client view
// (openWeek.ts) so availability is computed ONCE. Durable revocation (D1): the per-link
// nonce means a rotated/revoked link can never be reproduced by re-signing.

import {
  getPublicTokenSecret,
  signPublicToken,
  verifyPublicToken,
  generateTokenNonce,
  type TokenCapability,
  type PublicTokenClaims,
} from '@/lib/auth/clientToken';
import {
  findTokenByValue,
  findPublicToken,
  insertPublicTokenIfAbsent,
  rotatePublicTokenRow,
  deletePublicToken,
} from '@/lib/db/queries';
import {
  deriveOwnerOpenWeek,
  type OwnerOpenWeek,
} from '@/lib/domain/openWeek';

/** The single public capability minted here (view the operator's open slots, no login). */
const PUBLIC_CAPABILITY: TokenCapability = 'book-public';

/**
 * Return the ONE stable public booking link, creating it on first call (D1 read-or-
 * create, mirroring ensureClientToken). If a row exists we return its stored token
 * verbatim — so calling this repeatedly (every operator page load) yields the SAME URL
 * and can NEVER resurrect a rotated/revoked link. Only a first mint signs, folding in a
 * fresh persisted random nonce. If PUBLIC_TOKEN_SECRET was rotated, the stored signature
 * no longer validates — re-sign with the SAME persisted nonce (identity unchanged) and
 * refresh the row so the operator is never handed a dead link (heals rotation).
 */
export async function ensurePublicToken(ownerId: string): Promise<string> {
  const secret = getPublicTokenSecret();
  const existing = await findPublicToken(ownerId, PUBLIC_CAPABILITY);
  if (existing) {
    if (await verifyPublicToken(existing.tokenValue, secret)) {
      return existing.tokenValue;
    }
    const healed = await signPublicToken(
      { ownerId, capability: 'book-public', nonce: existing.nonce },
      secret,
    );
    const row = await rotatePublicTokenRow(
      ownerId,
      healed,
      PUBLIC_CAPABILITY,
      existing.nonce,
      existing.tokenValue, // F2: only heal if the row still holds this stale value
    );
    if (row) return row.tokenValue;
    // A concurrent rotatePublicToken already replaced the row — return the CURRENT live
    // link, never the heal (which would resurrect the stale value). If the row vanished
    // (concurrent revoke), fall through to a fresh mint below.
    const current = await findPublicToken(ownerId, PUBLIC_CAPABILITY);
    if (current) return current.tokenValue;
  }

  const nonce = generateTokenNonce();
  const tokenValue = await signPublicToken(
    { ownerId, capability: 'book-public', nonce },
    secret,
  );
  const row = await insertPublicTokenIfAbsent(
    ownerId,
    tokenValue,
    PUBLIC_CAPABILITY,
    nonce,
  );
  return row.tokenValue;
}

/**
 * Rotate the public link (D1 durable reissue): mint a fresh nonce → a genuinely NEW
 * token value and overwrite the row. The previously-issued link (possibly leaked, e.g.
 * a flyer that fell into the wrong hands) stops resolving immediately and forever, while
 * the operator gets a working new URL/QR to reprint. Returns the new token string.
 */
export async function rotatePublicToken(ownerId: string): Promise<string> {
  const secret = getPublicTokenSecret();
  const nonce = generateTokenNonce();
  const tokenValue = await signPublicToken(
    { ownerId, capability: 'book-public', nonce },
    secret,
  );
  const row = await rotatePublicTokenRow(
    ownerId,
    tokenValue,
    PUBLIC_CAPABILITY,
    nonce,
  );
  // No expectedTokenValue → the upsert always inserts or updates, so a row is returned.
  if (!row) throw new Error('rotatePublicToken: upsert returned no row');
  return row.tokenValue;
}

/**
 * Revoke the public link (D1): delete the row so the token fails closed on the next
 * request even though its HMAC is still valid. Durable — a later ensurePublicToken mints
 * a brand-new nonce/value, never the deleted one. Returns true if a link was removed.
 */
export async function revokePublicToken(ownerId: string): Promise<boolean> {
  return deletePublicToken(ownerId, PUBLIC_CAPABILITY);
}

/**
 * The ONE fail-closed public-token→claims chain (AD-6). Returns the signed claims ONLY
 * when every guard passes, else null (never a partial or a reason):
 *   1. Signature — under PUBLIC_TOKEN_SECRET (a weak/missing secret throws in
 *      getPublicTokenSecret; caught → null, fail closed).
 *   2. Capability — must be exactly `book-public`.
 *   3. Revocation — a matching row must still exist AND its columns agree with the
 *      signed claims: owner + capability + nonce, AND client_id IS NULL (a client token
 *      row can never resolve here, defense-in-depth over the capability guard).
 */
export async function resolvePublicTokenClaims(
  tokenValue: string | undefined | null,
): Promise<PublicTokenClaims | null> {
  if (!tokenValue) return null;

  let secret: string;
  try {
    secret = getPublicTokenSecret();
  } catch {
    return null;
  }
  const claims = await verifyPublicToken(tokenValue, secret);
  if (!claims) return null;
  if (claims.capability !== PUBLIC_CAPABILITY) return null;
  if (!claims.ownerId) return null;

  // F1: guard the DB lookup so a transient fault (pool exhaustion under public load)
  // fails CLOSED to null rather than throwing up to the public route as a raw 500 —
  // there is no app/error.tsx, so an unhandled throw here would violate AC5. Mirrors the
  // deriveOwnerOpenWeek try/catch; the token-row lookup had the same latent exposure.
  let row: Awaited<ReturnType<typeof findTokenByValue>>;
  try {
    row = await findTokenByValue(tokenValue);
  } catch (err) {
    console.error('[publicToken] token row lookup failed (fail-closed)', err);
    return null;
  }
  if (
    !row ||
    row.clientId !== null ||
    row.ownerId !== claims.ownerId ||
    row.capability !== claims.capability ||
    row.nonce !== claims.nonce
  ) {
    return null;
  }

  return claims;
}

/**
 * The public open-slot view: the operator's genuinely-open week with NO client scope
 * (a stranger sees availability, not a named client). Resolves the token via the ONE
 * fail-closed chain, then derives via the SHARED openWeek helper (same availability as
 * the per-client view). Story 4.1 is view-only — a stranger's SUBMISSION (→ provisional
 * client + PendingRequest) is Story 4.2, so there is no commit path here.
 */
export type PublicResolveResult =
  | { ok: true; view: OwnerOpenWeek }
  | { ok: false };

export async function resolvePublicBookingView(
  tokenValue: string | undefined | null,
): Promise<PublicResolveResult> {
  const claims = await resolvePublicTokenClaims(tokenValue);
  if (!claims) return { ok: false };

  const week = await deriveOwnerOpenWeek(claims.ownerId);
  if (!week) return { ok: false };

  return { ok: true, view: week };
}
