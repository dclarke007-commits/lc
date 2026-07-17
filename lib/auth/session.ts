// Minimal HMAC-signed operator session token (no auth framework — NFR7 simplicity
// gate). The HMAC-SHA256 primitive and the base64url(payload).base64url(sig) format
// live in lib/auth/hmac.ts — the ONE crypto path, shared with the per-client booking
// token (clientToken.ts). This module adds only the session-specific claim shape
// (sub/iat/exp) and the server-side expiry check on top of it. Because hmac uses
// WebCrypto, a token signed in a Server Action verifies in proxy.ts unchanged.

import { signPayload, verifyPayload } from '@/lib/auth/hmac';

export interface SessionPayload {
  /** operator (owner) id — the AD-8 owner_id value. */
  sub: string;
  /** issued-at, epoch seconds. */
  iat: number;
  /** expiry, epoch seconds. HMAC-covered so it cannot be tampered with. */
  exp: number;
}

export const SESSION_COOKIE = 'lc_session';

/**
 * Session lifetime. MUST equal the sign-in cookie `maxAge` (imported there) so
 * the server-side `exp` check and the browser cookie expire together.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** Minimum SESSION_SECRET length. A weak HMAC key is unacceptable (FIX 4). */
const MIN_SESSION_SECRET_LENGTH = 32;

/**
 * Central, validated access to the HMAC secret. Throws (fail-closed for signing
 * paths) if the secret is missing or too weak. Callers that must never fail open
 * on redirect (proxy.ts) catch the throw and deny access.
 */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be set and at least ${MIN_SESSION_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

export async function signSession(
  payload: { sub: string; iat: number },
  secret: string,
): Promise<string> {
  if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error('Refusing to sign a session with a weak SESSION_SECRET.');
  }
  // exp is derived from iat and HMAC-covered so expiry cannot be forged.
  return signPayload(
    {
      sub: payload.sub,
      iat: payload.iat,
      exp: payload.iat + SESSION_MAX_AGE_SECONDS,
    },
    secret,
  );
}

export async function verifySession(
  token: string | undefined | null,
  secret: string,
): Promise<SessionPayload | null> {
  // Fail closed on a weak/missing secret — never verify against a bad key.
  if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) return null;
  const parsed = await verifyPayload(token, secret);
  if (!parsed) return null;
  if (
    typeof parsed.sub === 'string' &&
    typeof parsed.iat === 'number' &&
    typeof parsed.exp === 'number'
  ) {
    // Server-side expiry: reject an expired (or over-max-age) token even though its
    // HMAC is valid. exp is HMAC-covered, so this cannot be spoofed.
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (parsed.exp <= nowSeconds) return null;
    return { sub: parsed.sub, iat: parsed.iat, exp: parsed.exp };
  }
  return null;
}
