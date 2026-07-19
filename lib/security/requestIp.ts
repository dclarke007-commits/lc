// Best-effort client-IP extraction for the public-write throttle (rateLimit.ts). Kept
// apart from the pure limiter so the limiter stays framework-free and unit-testable.
//
// On Vercel the platform sets `x-forwarded-for` (client first, then proxies) and
// `x-real-ip`; we take the FIRST x-forwarded-for hop as the closest-to-client address.
// This is a throttle key, NOT an authorization input — a spoofed header only lets an
// attacker cycle their own bucket, never bypass an owner scope (the token/session does
// that). When no header is present we fall back to a single shared 'unknown' bucket, so
// an anonymized flood still shares one throttle rather than escaping it entirely.

import { headers } from 'next/headers';

export async function getRequestIp(): Promise<string> {
  // Never let IP extraction crash a public action — a throttle key is best-effort. If the
  // header store is somehow unavailable, fall back to the shared 'unknown' bucket so an
  // anonymized caller is still throttled together rather than escaping the limiter.
  try {
    const h = await headers();
    // Prefer platform-TRUSTED single-value headers (set by Vercel's edge, not forwardable
    // by the client) over the client-spoofable leftmost x-forwarded-for hop. Off-platform
    // (no trusted header) we fall back to the first XFF hop as best-effort — a spoofed key
    // there only lets an attacker cycle their OWN bucket, and the durable per-owner DB cap
    // is the real bound on the provisional-write path regardless.
    const trusted =
      h.get('x-vercel-forwarded-for')?.trim() || h.get('x-real-ip')?.trim();
    if (trusted) return trusted;
    const first = h.get('x-forwarded-for')?.split(',')[0]?.trim();
    return first || 'unknown';
  } catch {
    return 'unknown';
  }
}
