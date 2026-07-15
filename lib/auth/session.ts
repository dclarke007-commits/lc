// Minimal HMAC-signed session token (no auth framework — NFR7 simplicity gate).
// Uses the WebCrypto HMAC-SHA256 primitive (globalThis.crypto.subtle), which is
// available identically in the Node.js runtime (Server Actions) and the proxy
// runtime — so a token signed in an action verifies in proxy.ts unchanged.
//
// Token format:  base64url(payloadJSON) . base64url(HMAC-SHA256(payloadJSON))

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

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSession(
  payload: { sub: string; iat: number },
  secret: string,
): Promise<string> {
  if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error('Refusing to sign a session with a weak SESSION_SECRET.');
  }
  // exp is derived from iat and HMAC-covered so expiry cannot be forged.
  const full: SessionPayload = {
    sub: payload.sub,
    iat: payload.iat,
    exp: payload.iat + SESSION_MAX_AGE_SECONDS,
  };
  const body = b64urlEncode(encoder.encode(JSON.stringify(full)));
  const key = await importKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(body)),
  );
  return `${body}.${b64urlEncode(sig)}`;
}

export async function verifySession(
  token: string | undefined | null,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null;
  // Fail closed on a weak/missing secret — never verify against a bad key.
  if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!sig) return null;

  const key = await importKey(secret);
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sig) as BufferSource,
      encoder.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  try {
    const parsed = JSON.parse(decoder.decode(b64urlDecode(body)));
    if (
      typeof parsed?.sub === 'string' &&
      typeof parsed?.iat === 'number' &&
      typeof parsed?.exp === 'number'
    ) {
      // Server-side expiry: reject an expired (or over-max-age) token even though
      // its HMAC is valid. exp is HMAC-covered, so this cannot be spoofed.
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (parsed.exp <= nowSeconds) return null;
      return parsed as SessionPayload;
    }
    return null;
  } catch {
    return null;
  }
}
