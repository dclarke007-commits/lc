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
}

export const SESSION_COOKIE = 'lc_session';

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
  payload: SessionPayload,
  secret: string,
): Promise<string> {
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
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
    if (typeof parsed?.sub === 'string' && typeof parsed?.iat === 'number') {
      return parsed as SessionPayload;
    }
    return null;
  } catch {
    return null;
  }
}
