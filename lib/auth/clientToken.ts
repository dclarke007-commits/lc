// Per-client booking token (Story 3.1, AD-6/FR34/NFR6). A signed, unguessable
// credential that IS the authorization on the public booking surface — no client
// login, no session, no account. Mirrors the operator session (session.ts): the same
// HMAC-SHA256 primitive (lib/auth/hmac.ts), a distinct server-held secret, fail-closed
// on a weak/missing key. A bearer can do EXACTLY what the token's claims scope,
// nothing more.
//
// DETERMINISTIC by design: sign() over the canonical {clientId, ownerId, capability}
// yields the same string every time, so exactly one stable link exists per client
// (idempotent re-mint). Rotation/revocation is handled by the DB row (lib/db), not by
// the signature — delete the row and verification fails closed even though the HMAC
// is still valid.

import { signPayload, verifyPayload } from '@/lib/auth/hmac';

/** What a token bearer may do. MUST match the `token_capability` DB enum exactly. */
export type TokenCapability = 'book-client' | 'book-public';

const CAPABILITIES: readonly TokenCapability[] = ['book-client', 'book-public'];

/** The scope a per-client token carries and grants. */
export interface ClientTokenClaims {
  clientId: string;
  ownerId: string;
  capability: TokenCapability;
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
  const { clientId, ownerId, capability } = payload;
  if (
    typeof clientId === 'string' &&
    typeof ownerId === 'string' &&
    isCapability(capability)
  ) {
    return { clientId, ownerId, capability };
  }
  return null;
}
