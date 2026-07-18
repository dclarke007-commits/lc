// Defense-in-depth owner resolution (AD-6 hardening) — tests the REAL requireOwnerId,
// bypassing the global setup.ts delegate mock via vi.importActual. Proves the in-action
// check: a valid HMAC session cookie resolves to its `sub`; a missing/invalid/expired
// cookie or a weak secret throws (fail-closed), so an operator action can never run
// owner-scoped work without a verified session.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signSession, SESSION_COOKIE } from '../lib/auth/session';

const SECRET = 'test-session-secret-at-least-32-chars-long!!';

// Mutable cookie value the next/headers mock returns for SESSION_COOKIE.
let cookieValue: string | undefined;

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && cookieValue !== undefined
        ? { value: cookieValue }
        : undefined,
  }),
}));

// Pull the ACTUAL implementation (setup.ts globally replaces it with a getOwnerId delegate).
const { requireOwnerId } = await vi.importActual<
  typeof import('../lib/auth/requireOwnerId')
>('../lib/auth/requireOwnerId');

// Sign with the real current second so `exp` (iat + 7d) is in the future — verifySession
// rejects an expired token, so a fixed past iat would fail the happy path.
const nowSec = () => Math.floor(Date.now() / 1000);

describe('requireOwnerId — in-action session verification', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
    cookieValue = undefined;
  });

  it('returns the session sub (owner id) for a valid, unexpired cookie', async () => {
    cookieValue = await signSession({ sub: 'owner-123', iat: nowSec() }, SECRET);
    await expect(requireOwnerId()).resolves.toBe('owner-123');
  });

  it('throws when no session cookie is present (fail-closed)', async () => {
    cookieValue = undefined;
    await expect(requireOwnerId()).rejects.toThrow();
  });

  it('throws for a tampered/garbage token', async () => {
    cookieValue = 'not-a-valid-token';
    await expect(requireOwnerId()).rejects.toThrow();
  });

  it('throws when the secret is missing/weak (never verifies against a bad key)', async () => {
    cookieValue = await signSession({ sub: 'owner-123', iat: nowSec() }, SECRET);
    process.env.SESSION_SECRET = 'too-short';
    await expect(requireOwnerId()).rejects.toThrow();
  });
});
