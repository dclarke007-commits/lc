// The ONE HMAC-SHA256 primitive for this app's signed tokens (operator session in
// session.ts AND the per-client booking token in clientToken.ts). Uses the WebCrypto
// HMAC-SHA256 primitive (globalThis.crypto.subtle), available identically in the
// Node.js runtime (Server Actions) and the proxy runtime — so a token signed in an
// action verifies in proxy.ts unchanged. Keeping it in one module means there is a
// single crypto path to audit (NFR7 simplicity), not one copy per token type.
//
// Token format:  base64url(payloadJSON) . base64url(HMAC-SHA256(payloadJSON))
//
// Note: the payload segment is base64url of the claims JSON — signed, NOT encrypted.
// Callers must treat claims as authenticated-but-readable and put nothing secret in
// them (both current callers carry only ids/timestamps/capability, matching AD-6).

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(input: string): Uint8Array {
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

/**
 * Sign a JSON-serializable payload → `base64url(json).base64url(hmac)`. Deterministic
 * for a given (payload, secret): the same object serializes to the same JSON, so the
 * signature is stable (the per-client booking token relies on this for one stable
 * link per client). Callers control claim key ORDER via the object they pass, since
 * JSON.stringify preserves insertion order.
 */
export async function signPayload(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(body)),
  );
  return `${body}.${b64urlEncode(sig)}`;
}

/**
 * Verify a `body.sig` token against `secret` and return the parsed payload, or null
 * if the token is missing/malformed, the signature does not match, or the body is not
 * valid JSON. Fails CLOSED on every error path — callers layer their own claim-shape
 * and expiry checks on top of the returned object.
 */
export async function verifyPayload(
  token: string | undefined | null,
  secret: string,
): Promise<Record<string, unknown> | null> {
  if (!token) return null;
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
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}
