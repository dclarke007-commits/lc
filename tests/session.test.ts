// Session token sign/verify round-trip + tamper rejection. Pure — no DB.
import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from '../lib/auth/session';

const SECRET = 'test-secret-at-least-32-characters-long!!';

describe('session HMAC token', () => {
  it('verifies a token it signed and returns the payload', async () => {
    const token = await signSession({ sub: 'owner-1', iat: 1000 }, SECRET);
    const payload = await verifySession(token, SECRET);
    expect(payload).toEqual({ sub: 'owner-1', iat: 1000 });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession({ sub: 'owner-1', iat: 1000 }, SECRET);
    expect(await verifySession(token, 'a-different-secret-value-32chars!!')).toBeNull();
  });

  it('rejects a tampered / malformed token and empty input', async () => {
    const token = await signSession({ sub: 'owner-1', iat: 1000 }, SECRET);
    expect(await verifySession(`${token}x`, SECRET)).toBeNull();
    expect(await verifySession('garbage', SECRET)).toBeNull();
    expect(await verifySession(undefined, SECRET)).toBeNull();
  });
});
