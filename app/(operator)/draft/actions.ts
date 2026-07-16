'use server';

// Draft-preview reads (Story 2.2). The sole path from the surface to the DB
// (AD-1): the surface never imports lib/db — it calls these, then renders the
// returned channel-agnostic MessageDraft and lets lib/delivery turn it into a
// deep-link on the operator's tap. No write, no dispatch, no logging here
// (Story 2.3 owns MessageLog); nothing sends autonomously (FR19).

import { redirect } from 'next/navigation';
import {
  getOwnerId,
  listClients,
  getClient,
  getMessageTemplates,
  upsertMessageDraft,
  markMessageDispatched,
  getMessageLogByNonce,
} from '@/lib/db/queries';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import { compose, type MessageDraft } from '@/lib/domain/compose';
import { deepLink, type DeliveryChannel } from '@/lib/delivery/deeplink';
import {
  isMessageTemplateType,
  DEFAULT_TEMPLATE_BODIES,
} from '@/lib/domain/messageTemplateConfig';

export interface DraftClientOption {
  id: string;
  name: string;
}

/** Owner-scoped client list for the preview picker (id + name only). */
export async function listDraftClients(): Promise<DraftClientOption[]> {
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[draft] getOwnerId failed (read path)', err);
    throw new Error('owner-unresolved');
  }
  const clients = await listClients(ownerId);
  return clients.map((c) => ({ id: c.id, name: c.name }));
}

/**
 * Compose a preview MessageDraft for `(client, type)` using the operator's
 * persisted template (falling back to the domain default if that type is not yet
 * seeded). Pure read → compose; returns the AR15 typed result. `slot` is a display
 * string (already formatted); `amountDollars` is optional operator input parsed to
 * integer cents (AR16), or null → `{amount}` blanks. No transport detail here — the
 * draft stays channel-agnostic (AD-5).
 */
export async function previewDraft(
  clientId: string,
  type: string,
  slot: string,
  amountDollars: string,
): Promise<ActionResult<MessageDraft>> {
  if (!isMessageTemplateType(type)) return fail('template-type-invalid');

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[draft] getOwnerId failed', err);
    return fail('owner-unresolved');
  }

  const client = await getClient(ownerId, clientId);
  if (!client) return fail('client-not-found');

  const templates = await getMessageTemplates(ownerId);
  const body =
    templates.find((t) => t.type === type)?.body ?? DEFAULT_TEMPLATE_BODIES[type];

  // Parse optional dollar input → integer cents (AR16). Blank/non-numeric → null
  // so `{amount}` resolves to safe-blank rather than a bogus figure.
  const rawCents = Number(amountDollars) * 100;
  const amountCents =
    amountDollars.trim() !== '' && Number.isFinite(rawCents)
      ? Math.round(rawCents)
      : null;

  const draft = compose(
    { name: client.name, phone: client.phone },
    slot.trim(),
    amountCents,
    { type, body },
  );
  return ok(draft);
}

/**
 * Record the operator's explicit send tap for a draft (Story 2.3, AC1/AC2). The
 * verb-first, typed logging action (AR15) — compose-independent: it records THAT a
 * message of `type` to `clientId` was drafted then dispatched, not the body. Two
 * writes, in order: materialize the drafted row (drafted_at, keyed on the per-draft
 * `nonce`), then stamp dispatched_at ONCE. Idempotent per draft (Option B): a re-tap
 * resubmits the same nonce → same row → the dispatch guard no-ops and the existing
 * dispatched_at is returned. Dispatch is logged ONLY here, on the tap — never on
 * render (AD-5). No thrown error crosses the boundary.
 */
export async function recordDispatch(
  clientId: string,
  type: string,
  nonce: string,
): Promise<ActionResult<{ dispatchedAt: string }>> {
  if (!isMessageTemplateType(type)) return fail('template-type-invalid');
  if (!nonce) return fail('draft-nonce-missing');

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[draft] getOwnerId failed (dispatch)', err);
    return fail('owner-unresolved');
  }

  const client = await getClient(ownerId, clientId);
  if (!client) return fail('client-not-found');

  // Drafted write first (idempotent per nonce), then the once-only dispatch stamp.
  await upsertMessageDraft(ownerId, clientId, type, nonce);
  const dispatched = await markMessageDispatched(ownerId, nonce);
  if (dispatched?.dispatchedAt) return ok({ dispatchedAt: dispatched.dispatchedAt });

  // Re-tap: the row was already dispatched (guard matched zero rows). Return the
  // existing timestamp — the idempotent no-op, never a second dispatch.
  const existing = await getMessageLogByNonce(ownerId, nonce);
  if (existing?.dispatchedAt) return ok({ dispatchedAt: existing.dispatchedAt });
  return fail('dispatch-log-failed');
}

/**
 * Surface glue (zero client JS, NFR1): the send button is a form POST carrying the
 * draft's (client, type, slot, amount, channel, nonce). Records the dispatch once
 * (recordDispatch) then redirects to the wa.me/sms deep link so the OS opens the chat
 * pre-filled — the single tap both LOGS and OPENS. A re-tap (browser back → resubmit)
 * carries the same nonce, so it opens again but never double-logs (AC2). `redirect()`
 * throws NEXT_REDIRECT, so each branch terminates the action.
 */
export async function sendDraft(formData: FormData): Promise<void> {
  const clientId = String(formData.get('client') ?? '');
  const type = String(formData.get('type') ?? '');
  const slot = String(formData.get('slot') ?? '');
  const amount = String(formData.get('amount') ?? '');
  const nonce = String(formData.get('nonce') ?? '');
  const channel: DeliveryChannel =
    String(formData.get('channel') ?? '') === 'sms' ? 'sms' : 'whatsapp';

  const back = (extra: string): string =>
    `/draft?client=${encodeURIComponent(clientId)}&type=${encodeURIComponent(
      type,
    )}&slot=${encodeURIComponent(slot)}&amount=${encodeURIComponent(amount)}${extra}`;

  const res = await recordDispatch(clientId, type, nonce);
  if (!res.ok) redirect(back(`&error=${encodeURIComponent(res.reason)}`));

  // Rebuild the deep link for the redirect (compose is a pure read; the log above is
  // the only write). No usable phone → fall back to the preview rather than a broken
  // link (deepLink already returns null for that case).
  const preview = await previewDraft(clientId, type, slot, amount);
  if (preview.ok) {
    const link = deepLink(preview.data, channel);
    if (link) redirect(link);
  }
  redirect(back(''));
}
