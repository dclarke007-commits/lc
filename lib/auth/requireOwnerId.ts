// Defense-in-depth owner resolution (AD-6 hardening — Epic-1 retrospective action item).
// Every operator Server Action derives its owner_id scope from the VERIFIED session
// cookie IN-ACTION, not merely from the proxy.ts route gate. proxy.ts protects
// NAVIGATION to `(operator)` routes, but a Server Action POST is its own request whose
// auth the middleware matcher must also cover; verifying here makes each action
// independently fail-closed, so a matcher gap, a future public embedding, or a direct
// action invocation can never run owner-scoped work without a valid session.
//
// The id returned IS the HMAC-covered session `sub` — the AD-8 owner_id (sign-in signs
// operatorId as `sub`). Trusting the VERIFIED sub (signature + expiry checked) rather
// than the DB "pick the one seeded operator" resolver (getOwnerId) is what ties the
// scope to the authenticated caller — the whole point of the in-action check. No DB
// round-trip is needed to resolve the owner, so this is also cheaper than getOwnerId.
//
// THROWS on any missing/weak secret, missing cookie, or invalid/expired token. Operator
// actions already wrap owner resolution in try/catch and convert the throw to their
// fail-closed ActionResult (or let it hit the RSC error boundary) — the SAME contract
// getOwnerId had, so call sites swap 1:1.
//
// FAIL-PATTERN UNIFORMITY (Epic 3 retro action item — enforced by
// tests/read-surface-fail-uniformity.test.ts). Every RSC read surface MUST fail CLOSED when
// this rejects — it must NEVER degrade to data (an empty list, DEFAULT_CAPACITY, default
// templates) on an unresolved owner, because that renders an authenticated-looking page for a
// caller with no verified session. The TWO sanctioned shapes:
//   • a bare-value reader (returns T, e.g. listOwnerInquiries → InquiryListItem[]) lets the
//     rejection PROPAGATE — either directly, or re-thrown as `throw new Error('owner-unresolved')`
//     after logging — so the RSC error boundary shows, never a silent [].
//   • an ActionResult reader (returns { ok } | { ok:false, reason }) catches and returns
//     `fail('owner-unresolved')` — a typed failure carrying NO data.
// A first-run DEFAULT (no settings row, no seeded template) is a SEPARATE concern reached only
// AFTER a successful owner resolve — never conflate it with the auth-failure path.

import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession, getSessionSecret } from '@/lib/auth/session';

export async function requireOwnerId(): Promise<string> {
  // getSessionSecret throws on a missing/weak secret — fail closed, never resolve an
  // owner against a bad key (mirrors proxy.ts's fail-closed redirect).
  const secret = getSessionSecret();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, secret);
  if (!session) {
    throw new Error('requireOwnerId: no valid operator session (fail-closed)');
  }
  return session.sub;
}
