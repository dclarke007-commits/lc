'use server';

// Draft-preview reads (Story 2.2). The sole path from the surface to the DB
// (AD-1): the surface never imports lib/db — it calls these, then renders the
// returned channel-agnostic MessageDraft and lets lib/delivery turn it into a
// deep-link on the operator's tap. No write, no dispatch, no logging here
// (Story 2.3 owns MessageLog); nothing sends autonomously (FR19).

import { getOwnerId, listClients, getClient, getMessageTemplates } from '@/lib/db/queries';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import { compose, type MessageDraft } from '@/lib/domain/compose';
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
