'use server';

// Sole write path = Server Actions (AD-1). Verb-first name `saveMessageTemplate`.
// The four templates are the single source Story 2.2's compose and Story 2.4's
// booking-confirmation (and Epics 3/5 draft actions) all read — never re-hardcode
// message copy downstream.
//
// Return contract (AR15): { ok, data } | { ok: false, reason }. No thrown error
// crosses the boundary; no silent catch. Only lib/db speaks SQL (AD-1). Default
// copy lives in the domain (DEFAULT_TEMPLATE_BODIES), not in DB column defaults —
// getOwnerTemplates substitutes a default for any type not yet seeded.

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { messageTemplate } from '@/lib/db/schema';
import { getOwnerId, getMessageTemplates } from '@/lib/db/queries';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import {
  MESSAGE_TEMPLATE_TYPES,
  MESSAGE_TEMPLATE_LABELS,
  DEFAULT_TEMPLATE_BODIES,
  validateTemplate,
  type MessageTemplateType,
  type TemplateEdit,
} from '@/lib/domain/messageTemplateConfig';

export interface TemplateView {
  type: MessageTemplateType;
  label: string;
  body: string;
}

/**
 * Owner-scoped read for the RSC templates surface. Projects the four closed-set
 * types in display order; a type without a persisted row yet shows its domain
 * DEFAULT (that is how "defaults on first load" works, AC1) — keeping default
 * copy in ONE place (the domain), never the DB.
 *
 * Fails LOUD on an unresolved owner (a deploy-invariant violation — the operator
 * is a seeded singleton) rather than masking it behind defaults; parity with the
 * write path and with getOwnerCapacity (Story 1.3).
 */
export async function getOwnerTemplates(): Promise<TemplateView[]> {
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[templates] getOwnerId failed (read path)', err);
    throw new Error('owner-unresolved');
  }

  const rows = await getMessageTemplates(ownerId);
  const bodyByType = new Map(rows.map((r) => [r.type, r.body]));

  return MESSAGE_TEMPLATE_TYPES.map((type) => ({
    type,
    label: MESSAGE_TEMPLATE_LABELS[type],
    body: bodyByType.get(type) ?? DEFAULT_TEMPLATE_BODIES[type],
  }));
}

/**
 * Persist ONE template edit (sole write path, AD-1). Validates first; on any
 * failure returns a machine reason and writes NOTHING (AC2). On success UPSERTs
 * the single (owner, type) row so the edit persists per owner and later composes
 * read it. A tampered/unknown `type` is rejected by validateTemplate.
 */
export async function saveMessageTemplate(
  formData: FormData,
): Promise<ActionResult<TemplateEdit>> {
  const parsed = validateTemplate({
    type: String(formData.get('type') ?? ''),
    body: String(formData.get('body') ?? ''),
  });
  if (!parsed.ok) return fail(parsed.reason);
  const edit = parsed.data;

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[templates] getOwnerId failed', err);
    return fail('owner-unresolved');
  }

  try {
    await db
      .insert(messageTemplate)
      .values({ ownerId, type: edit.type, body: edit.body })
      .onConflictDoUpdate({
        target: [messageTemplate.ownerId, messageTemplate.type],
        set: { body: edit.body, updatedAt: new Date().toISOString() },
      });
    revalidatePath('/templates');
    return ok(edit);
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[templates] template write failed', err);
    return fail('template-write-failed');
  }
}
