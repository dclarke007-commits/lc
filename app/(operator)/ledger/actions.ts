'use server';

// Ledger reminder draft (Story 5.3, FR31). The sole path from a ledger surface to
// the DB (AD-1): a surface never imports lib/db — it calls this, renders the
// returned channel-agnostic MessageDraft, and lets lib/delivery turn it into a
// deep-link on the operator's explicit send tap. NO write, NO dispatch, NO
// MessageLog here — composing a reminder is side-effect-free; dispatch is logged
// only later in Story 2.3's recordDispatch on the send tap (FR19: never auto-sent).

import {
  getOwnerId,
  getClient,
  getMessageTemplates,
  listLedgerJobs,
} from '@/lib/db/queries';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import { paymentReminderDraft, type MessageDraft } from '@/lib/domain/compose';
import { outstanding } from '@/lib/domain/derive';
import { DEFAULT_TEMPLATE_BODIES } from '@/lib/domain/messageTemplateConfig';

/**
 * Compose a payment-reminder draft for `clientId` from that client's outstanding
 * ledger total (derive.outstanding over listLedgerJobs, 5.2). Pure read → compose;
 * AR15 typed result, no throw crosses the boundary. `nothing-owed` when the client
 * owes nothing (paymentReminderDraft guards $0/negative) — the operator never gets
 * an empty reminder. Reuses the persisted payment_reminder template, falling back to
 * the seeded default. Composing does NOT send (FR19) — delivery happens on the tap.
 */
export async function draftPaymentReminder(
  clientId: string,
): Promise<ActionResult<MessageDraft>> {
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[ledger] getOwnerId failed', err);
    return fail('owner-unresolved');
  }

  const client = await getClient(ownerId, clientId);
  if (!client) return fail('client-not-found');

  // Outstanding is DERIVED on read (AD-7) from the client's owed, ledger-eligible
  // jobs — no stored total. A client with no owed line owes 0 → guarded below.
  const ledger = outstanding(await listLedgerJobs(ownerId));
  const owedCents =
    ledger.clients.find((c) => c.clientId === clientId)?.owedCents ?? 0;

  const templates = await getMessageTemplates(ownerId);
  const body =
    templates.find((t) => t.type === 'payment_reminder')?.body ??
    DEFAULT_TEMPLATE_BODIES.payment_reminder;

  const draft = paymentReminderDraft(
    { name: client.name, phone: client.phone },
    owedCents,
    body,
  );
  if (!draft) return fail('nothing-owed');
  return ok(draft);
}
