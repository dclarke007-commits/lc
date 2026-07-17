'use server';

// Operator public-link surface actions (Story 4.1, FR4/FR5). Auth-gated by proxy.ts.
// Sole write path = Server Actions (AD-1): these call the DOMAIN (ensurePublicToken /
// rotatePublicToken) + the shared bookingBaseUrl + qrcode — never lib/db directly
// (surfaces → actions → domain → db). Typed AR15 return { ok, data } | { ok:false }.

import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { getOwnerId } from '@/lib/db/queries';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import { ensurePublicToken, rotatePublicToken } from '@/lib/domain/publicToken';
import { bookingBaseUrl } from '@/lib/domain/urls';

export interface PublicLink {
  /** The absolute public booking URL to share/print. */
  url: string;
  /** A self-contained inline SVG QR encoding `url` (FR5) — SSR, zero client JS. */
  qrSvg: string;
}

/**
 * Build the shareable link + QR from a token value: absolute origin (hardened, fails
 * closed in prod when APP_BASE_URL is unset) + a server-rendered SVG QR. The QR encodes
 * the PUBLIC link (FR5), for print placement on a van/flyer/card.
 */
async function buildPublicLink(tokenValue: string): Promise<ActionResult<PublicLink>> {
  const base = bookingBaseUrl();
  if (!base.ok) return base;
  const url = `${base.data}/book/${encodeURIComponent(tokenValue)}`;
  // Server-side SVG (no client JS, printable). margin/width tuned for a scannable card.
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 220 });
  return ok({ url, qrSvg });
}

/**
 * The operator's ONE public self-serve link + QR (FR4/FR5). Read-or-create: returns the
 * stable link (minting it on first view), then the QR. Fails closed with a typed reason
 * on: owner unresolved, APP_BASE_URL unset in prod (base-url-unset), or a weak/missing
 * PUBLIC_TOKEN_SECRET (link-unavailable). This surface is operator-only (auth-gated), so
 * returning the reason is safe (unlike the public book route).
 */
export async function getPublicBookingLink(): Promise<ActionResult<PublicLink>> {
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[link] getOwnerId failed (read)', err);
    return fail('owner-unresolved');
  }
  let tokenValue: string;
  try {
    tokenValue = await ensurePublicToken(ownerId);
  } catch (err) {
    // getPublicTokenSecret throws when PUBLIC_TOKEN_SECRET is unset/weak (or a DB fault).
    console.error('[link] ensurePublicToken failed', err);
    return fail('link-unavailable');
  }
  try {
    return await buildPublicLink(tokenValue);
  } catch (err) {
    // F5: a QR-generation fault is DISTINCT from the secret/token problem — don't
    // misdirect the operator to "check PUBLIC_TOKEN_SECRET". The link itself is fine.
    console.error('[link] buildPublicLink/QR failed', err);
    return fail('qr-failed');
  }
}

/**
 * Rotate the public link (D1): mint a fresh token/QR and kill the old one — for a link
 * that may have leaked (a flyer in the wrong hands). Thin action: rotate → redirect with
 * ?rotated=1 (or ?error=<reason>), zero client JS (NFR1).
 */
export async function rotatePublicLink(): Promise<void> {
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[link] getOwnerId failed (rotate)', err);
    redirect('/link?error=owner-unresolved');
  }
  try {
    await rotatePublicToken(ownerId);
  } catch (err) {
    console.error('[link] rotatePublicLink failed', err);
    redirect('/link?error=rotate-failed');
  }
  redirect('/link?rotated=1');
}
