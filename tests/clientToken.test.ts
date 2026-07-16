// Per-client booking token sign/verify round-trip + tamper + scope + unguessability.
// Pure — no DB (secret passed explicitly, like session.test.ts). The token is the
// ENTIRE authorization on client surfaces (AD-6), so these tests pin its security
// contract: unforgeable without the secret, deterministic (one stable link per
// client), and fail-closed on anything malformed.
import { describe, it, expect } from 'vitest';
import {
  signClientToken,
  verifyClientToken,
  type ClientTokenClaims,
} from '../lib/auth/clientToken';
import { signPayload } from '../lib/auth/hmac';

const SECRET = 'test-secret-at-least-32-characters-long!!';
const CLAIMS: ClientTokenClaims = {
  clientId: '11111111-1111-1111-1111-111111111111',
  ownerId: '22222222-2222-2222-2222-222222222222',
  capability: 'book-client',
};

describe('client booking token (HMAC)', () => {
  it('verifies a token it signed and returns the exact claims', async () => {
    const token = await signClientToken(CLAIMS, SECRET);
    expect(await verifyClientToken(token, SECRET)).toEqual(CLAIMS);
  });

  it('is DETERMINISTIC — same claims produce the same token (one stable link per client)', async () => {
    const a = await signClientToken(CLAIMS, SECRET);
    const b = await signClientToken(CLAIMS, SECRET);
    expect(a).toBe(b);
  });

  it('is unguessable/non-enumerable — adjacent client ids yield unrelated tokens', async () => {
    const t1 = await signClientToken(
      { ...CLAIMS, clientId: '00000000-0000-0000-0000-000000000001' },
      SECRET,
    );
    const t2 = await signClientToken(
      { ...CLAIMS, clientId: '00000000-0000-0000-0000-000000000002' },
      SECRET,
    );
    expect(t1).not.toBe(t2);
    // The HMAC segments must differ (the credential is not a sequential/derivable
    // transform of the client id).
    const sig1 = t1.split('.')[1];
    const sig2 = t2.split('.')[1];
    expect(sig1).not.toBe(sig2);
  });

  it('rejects a token signed with a different secret (unforgeable)', async () => {
    const token = await signClientToken(CLAIMS, SECRET);
    expect(
      await verifyClientToken(token, 'a-different-secret-value-32chars!!'),
    ).toBeNull();
  });

  it('rejects a tampered / malformed token and empty input', async () => {
    const token = await signClientToken(CLAIMS, SECRET);
    expect(await verifyClientToken(`${token}x`, SECRET)).toBeNull();
    expect(await verifyClientToken('garbage', SECRET)).toBeNull();
    expect(await verifyClientToken('', SECRET)).toBeNull();
    expect(await verifyClientToken(undefined, SECRET)).toBeNull();
  });

  it('fails closed on a weak secret (< 32 chars) for both sign and verify', async () => {
    await expect(signClientToken(CLAIMS, 'too-short')).rejects.toThrow();
    const token = await signClientToken(CLAIMS, SECRET);
    expect(await verifyClientToken(token, 'too-short')).toBeNull();
  });

  it('rejects a validly-signed token whose capability claim is not a known capability', async () => {
    // Forge a payload signed with the REAL secret but an unknown capability — the
    // HMAC is valid, yet the claim shape must be rejected (bearer cannot invent scope).
    const forged = await signPayload(
      { clientId: CLAIMS.clientId, ownerId: CLAIMS.ownerId, capability: 'admin' },
      SECRET,
    );
    expect(await verifyClientToken(forged, SECRET)).toBeNull();
  });
});
