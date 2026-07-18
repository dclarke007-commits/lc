// Per-client booking token (Story 3.1, AD-6/FR34/NFR6). A signed, unguessable
// credential that IS the authorization on the public booking surface — no client
// login, no session, no account. Mirrors the operator session (session.ts): the same
// HMAC-SHA256 primitive (lib/auth/hmac.ts), a distinct server-held secret, fail-closed
// on a weak/missing key. A bearer can do EXACTLY what the token's claims scope,
// nothing more.
//
// Per-link RANDOM nonce (code-review D1, 2026-07-16): the payload folds in a nonce
// generated once and persisted with the token row, so the signature is NOT a pure
// function of {clientId, ownerId, capability}. Re-mint reuses the stored nonce (the
// link stays stable — one link per client); rotateClientToken issues a fresh nonce
// (a genuinely new link) and revoke/delete kills the row. This makes revocation
// DURABLE: a deleted link can never be reproduced by re-signing, and the old value
// stops resolving even though its HMAC is still mathematically valid.

import { randomBytes } from 'node:crypto';
import { signPayload, verifyPayload } from '@/lib/auth/hmac';

/** What a token bearer may do. MUST match the `token_capability` DB enum exactly. */
export type TokenCapability = 'book-client' | 'book-public';

const CAPABILITIES: readonly TokenCapability[] = ['book-client', 'book-public'];

/** The scope a per-client token carries and grants. */
export interface ClientTokenClaims {
  clientId: string;
  ownerId: string;
  capability: TokenCapability;
  // Per-link random nonce (D1). Persisted in the token row; folded into the
  // signature so a re-mint reproduces the value ONLY while the stored nonce is
  // unchanged, and a rotate/revoke makes the old value unresolvable forever.
  nonce: string;
}

/**
 * A fresh, unguessable per-link nonce (128 bits, hex). Generated ONCE per link and
 * persisted; do not regenerate on an idempotent re-mint (that would change the URL).
 */
export function generateTokenNonce(): string {
  return randomBytes(16).toString('hex');
}

/** A weak HMAC key is unacceptable — same bar as the operator session (FIX 4). */
const MIN_SECRET_LENGTH = 32;

/**
 * Central, validated access to the client-token HMAC secret. A DISTINCT secret from
 * the operator session (key separation: a session token and a booking token can never
 * be cross-interpreted). Throws (fail-closed for signing) if missing or too weak;
 * verify() catches the throw at the boundary and denies access.
 *
 * Deployment note: if CLIENT_TOKEN_SECRET is unset in prod, ALL client booking links
 * fail closed (generic invalid-link) — correct, but set it (Vercel env) before use.
 */
export function getClientTokenSecret(): string {
  const secret = process.env.CLIENT_TOKEN_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `CLIENT_TOKEN_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

function isCapability(value: unknown): value is TokenCapability {
  return (
    typeof value === 'string' &&
    (CAPABILITIES as readonly string[]).includes(value)
  );
}

/**
 * Sign a per-client token. Canonical claim order ({clientId, ownerId, capability})
 * so the signature is stable regardless of how the caller built the object — this is
 * what makes the token idempotent per client.
 */
export async function signClientToken(
  claims: ClientTokenClaims,
  secret: string,
): Promise<string> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error('Refusing to sign a client token with a weak CLIENT_TOKEN_SECRET.');
  }
  return signPayload(
    {
      clientId: claims.clientId,
      ownerId: claims.ownerId,
      capability: claims.capability,
      nonce: claims.nonce,
    },
    secret,
  );
}

/**
 * Verify a token and return its claims, or null. Fails CLOSED on: weak/missing secret,
 * bad signature (unforgeable without the secret), malformed token, or a claim shape
 * that is not exactly {clientId:string, ownerId:string, capability:known}. The last
 * guard matters: a bearer must not be able to present a validly-signed token with an
 * invented capability and have it accepted.
 */
export async function verifyClientToken(
  token: string | undefined | null,
  secret: string,
): Promise<ClientTokenClaims | null> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  const payload = await verifyPayload(token, secret);
  if (!payload) return null;
  const { clientId, ownerId, capability, nonce } = payload;
  if (
    typeof clientId === 'string' &&
    typeof ownerId === 'string' &&
    isCapability(capability) &&
    typeof nonce === 'string' &&
    nonce.length > 0
  ) {
    return { clientId, ownerId, capability, nonce };
  }
  return null;
}

// --- Public self-serve booking token (Story 4.1, AD-6/FR4/FR34/NFR6) ---------
// The sibling of the per-client token above: ONE unguessable, signed public link
// (the `book-public` capability) that any prospective client can open with no
// account, scoped to NO single client. Same HMAC-SHA256 primitive (hmac.ts) and
// the same durable per-link nonce (D1). A DISTINCT secret (PUBLIC_TOKEN_SECRET,
// key separation) so a per-client link and the public link can never be
// cross-interpreted — and the capability guard on verify is a second, independent
// barrier even if the secrets were ever the same.

/** The scope the ONE public token carries. No `clientId` — it is client-less. */
export interface PublicTokenClaims {
  ownerId: string;
  capability: 'book-public';
  // Per-link random nonce (D1), persisted in the token row and folded into the
  // signature so a rotate/revoke makes the old value unresolvable forever.
  nonce: string;
}

/**
 * Central, validated access to the public-token HMAC secret. DISTINCT from
 * CLIENT_TOKEN_SECRET and SESSION_SECRET (key separation). Throws (fail-closed for
 * signing) if missing or too weak; resolvePublicTokenClaims catches the throw and
 * denies access. Deployment: if unset in prod, the public booking link fails closed.
 */
export function getPublicTokenSecret(): string {
  const secret = process.env.PUBLIC_TOKEN_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `PUBLIC_TOKEN_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

/**
 * Sign the public token. Canonical claim order ({ownerId, capability, nonce}) so the
 * signature is stable regardless of how the caller built the object — one stable
 * public link per owner (idempotent re-mint while the nonce is unchanged).
 */
export async function signPublicToken(
  claims: PublicTokenClaims,
  secret: string,
): Promise<string> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error('Refusing to sign a public token with a weak PUBLIC_TOKEN_SECRET.');
  }
  return signPayload(
    {
      ownerId: claims.ownerId,
      capability: claims.capability,
      nonce: claims.nonce,
    },
    secret,
  );
}

/**
 * Verify a public token and return its claims, or null. Fails CLOSED on: weak/missing
 * secret, bad signature, malformed token, or a claim shape that is not exactly
 * {ownerId:string, capability:'book-public', nonce:string}. The capability guard is
 * the second barrier: a validly-signed token whose capability is anything but
 * `book-public` (e.g. a per-client token) is never accepted on the public path.
 */
export async function verifyPublicToken(
  token: string | undefined | null,
  secret: string,
): Promise<PublicTokenClaims | null> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  const payload = await verifyPayload(token, secret);
  if (!payload) return null;
  const { ownerId, capability, nonce } = payload;
  if (
    typeof ownerId === 'string' &&
    capability === 'book-public' &&
    typeof nonce === 'string' &&
    nonce.length > 0
  ) {
    return { ownerId, capability, nonce };
  }
  return null;
}
