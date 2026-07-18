// Shared absolute-origin helper for client-facing booking links (Story 3.3 → 4.1).
// Extracted from jobs/actions.ts when Story 4.1 became the second consumer (the
// operator public-link surface): the rebooking proposal and the public link/QR both
// need the same hardened origin, so it lives in ONE place (single source).
//
// Hardened (code-review 3.3 P4): strips a trailing slash so we never emit `//book/…`.
// In PRODUCTION APP_BASE_URL is REQUIRED — when unset we FAIL CLOSED (base-url-unset)
// rather than hand a real client a localhost link. In dev/test an unset var keeps the
// http://localhost:3000 default. Returns a typed result so callers surface the reason.

import { ok, fail, type ActionResult } from '@/lib/domain/result';

export function bookingBaseUrl(): ActionResult<string> {
  const raw = process.env.APP_BASE_URL;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') return fail('base-url-unset');
    return ok('http://localhost:3000');
  }
  return ok(raw.replace(/\/+$/, ''));
}
