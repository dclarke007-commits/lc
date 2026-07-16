// Delivery adapter (AD-5) — the ONLY module in the codebase where transport
// (`wa.me` / `sms:`) exists. Templates and `compose` never reference it; they
// produce a channel-agnostic MessageDraft, and this adapter renders that draft to
// a deep-link URL. It ONLY renders a string — it does not open, send, or log
// anything (no autonomous send, FR19). Auto-send later = a new adapter beside this
// one, with zero template/compose change.

import type { MessageDraft } from '../domain/compose';

export type DeliveryChannel = 'whatsapp' | 'sms';

/**
 * Normalize a raw stored phone to digits-only E.164 form (Open gap 1 — dev
 * decision). `Client.phone` is stored raw with no guaranteed format, but `wa.me`
 * requires digits only (no `+`, spaces, or dashes). Rule: strip every non-digit;
 * a bare 10-digit number is treated as US and gets the `1` country code; anything
 * else is assumed already country-code-prefixed and passed through. Returns null
 * when no digits remain, so the caller can degrade gracefully instead of building
 * a broken link.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

/**
 * Render a MessageDraft to a `wa.me` / `sms:` deep-link (AC2). The body is always
 * `encodeURIComponent`-escaped. Returns null when the recipient has no usable
 * phone — the surface then disables the send control rather than opening a broken
 * link. Channel choice (Open gap 3) lives HERE / at the surface, never on the
 * draft (AD-5): `MessageDraft.type` is the message kind, not a channel.
 *
 * - WhatsApp: `https://wa.me/<digits>?text=<encoded body>` (stable form).
 * - SMS: `sms:<digits>?&body=<encoded body>` — the `?&body=` variant (Open gap 2)
 *   is the widely-compatible form across iOS/Android.
 */
export function deepLink(
  draft: MessageDraft,
  channel: DeliveryChannel,
): string | null {
  const phone = normalizePhone(draft.recipient);
  if (!phone) return null;
  const body = encodeURIComponent(draft.body);
  return channel === 'whatsapp'
    ? `https://wa.me/${phone}?text=${body}`
    : `sms:${phone}?&body=${body}`;
}
