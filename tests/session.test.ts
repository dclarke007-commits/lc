// Session token sign/verify round-trip + tamper + expiry rejection. Pure — no DB.
import { describe, it, expect } from 'vitest';
import {
  signSession,
  verifySession,
  SESSION_MAX_AGE_SECONDS,
} from '../lib/auth/session';

const SECRET = 'test-secret-at-least-32-characters-long!!';
const nowSec = () => Math.floor(Date.now() / 1000);

describe('session HMAC token', () => {
  it('verifies a fresh token it signed and returns the payload (with exp)', async () => {
    const iat = nowSec();
    const token = await signSession({ sub: 'owner-1', iat }, SECRET);
    const payload = await verifySession(token, SECRET);
    expect(payload).toEqual({
      sub: 'owner-1',
      iat,
      exp: iat + SESSION_MAX_AGE_SECONDS,
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession({ sub: 'owner-1', iat: nowSec() }, SECRET);
    expect(await verifySession(token, 'a-different-secret-value-32chars!!')).toBeNull();
  });

  it('rejects a tampered / malformed token and empty input', async () => {
    const token = await signSession({ sub: 'owner-1', iat: nowSec() }, SECRET);
    expect(await verifySession(`${token}x`, SECRET)).toBeNull();
    expect(await verifySession('garbage', SECRET)).toBeNull();
    expect(await verifySession(undefined, SECRET)).toBeNull();
  });

  it('rejects a token older than the max age but verifies a fresh one', async () => {
    // iat far enough in the past that exp (iat + max age) is already elapsed.
    const staleIat = nowSec() - SESSION_MAX_AGE_SECONDS - 60;
    const staleToken = await signSession({ sub: 'owner-1', iat: staleIat }, SECRET);
    expect(await verifySession(staleToken, SECRET)).toBeNull();

    const freshToken = await signSession({ sub: 'owner-1', iat: nowSec() }, SECRET);
    expect(await verifySession(freshToken, SECRET)).not.toBeNull();
  });

  it('fails closed when the secret is too weak (< 32 chars)', async () => {
    const token = await signSession({ sub: 'owner-1', iat: nowSec() }, SECRET);
    expect(await verifySession(token, 'too-short')).toBeNull();
  });
});
