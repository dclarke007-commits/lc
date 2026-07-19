// Load local env for DB-backed tests (seed idempotency, signIn). Pure/unit tests
// (route-guard, session) do not depend on this.
import 'dotenv/config';
import { vi } from 'vitest';

// Defense-in-depth owner resolution (AD-6) verifies the operator SESSION cookie in-action
// via next/headers `cookies()`. Integration/unit tests drive operator Server Actions
// directly, out of any request scope (no cookie jar), so the real `requireOwnerId` would
// throw for every action. Globally delegate it to the DB singleton resolver `getOwnerId`
// here — restoring the exact owner-resolution semantics these tests were written against —
// while PRODUCTION keeps the real session check. The session-verification logic itself is
// covered directly (against the REAL implementation) in tests/require-owner-id.test.ts,
// which pulls the actual module via vi.importActual.
vi.mock('@/lib/auth/requireOwnerId', async () => {
  const { getOwnerId } = await import('@/lib/db/queries');
  return { requireOwnerId: () => getOwnerId() };
});

// The public-write throttle reads the client IP via next/headers `headers()` and keeps
// shared in-process window state — neither is meaningful outside a request scope, and the
// wrapper-action tests invoke these Server Actions directly. Neutralize the throttle
// (always allow) and the IP lookup in tests so wrapper redirect-mapping is exercised
// unimpeded; the throttle's REAL sliding-window logic is covered against the actual module
// in tests/rate-limit.test.ts via vi.importActual.
vi.mock('@/lib/security/rateLimit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/security/rateLimit')>(
    '@/lib/security/rateLimit',
  );
  return { ...actual, checkThrottle: () => ({ allowed: true, retryAfterMs: 0 }) };
});
vi.mock('@/lib/security/requestIp', () => ({
  getRequestIp: async () => 'test-ip',
}));
