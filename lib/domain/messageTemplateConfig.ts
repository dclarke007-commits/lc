// Pure domain module — NO framework/db imports (dependency rule: domain sits
// below actions/surfaces). The four sanctioned message-template types (a CLOSED
// set, FR20) plus their default operator-voice copy and edit validation.
//
// Defaults live HERE (the domain single source), not as DB column defaults — the
// seed (lib/db/seed.ts) reads them, exactly mirroring how DEFAULT_CAPACITY works
// for Story 1.3. Downstream composes (2.2/2.4, Epics 3/5) read the persisted row,
// never re-hardcode copy.

import { fail, ok, type ActionResult } from './result';

// The four FR20 template types, in operator-facing display order. Mirrors the
// Postgres `message_template_type` enum — a closed set, not user-addable.
export const MESSAGE_TEMPLATE_TYPES = [
  'booking_confirmation',
  'rebooking_nudge',
  'win_back',
  'payment_reminder',
] as const;

export type MessageTemplateType = (typeof MESSAGE_TEMPLATE_TYPES)[number];

// The ONLY three placeholder tokens resolveTemplate substitutes. Any other
// brace-token is stripped so no raw {token} can ever reach a client (AC3).
export const TEMPLATE_PLACEHOLDERS = ['client', 'slot', 'amount'] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

// Human labels for the settings surface. Keyed by the closed type set.
export const MESSAGE_TEMPLATE_LABELS: Record<MessageTemplateType, string> = {
  booking_confirmation: 'Booking confirmation',
  rebooking_nudge: 'Rebooking nudge',
  win_back: 'Win-back check-in',
  payment_reminder: 'Payment reminder',
};

// Default copy (Open gap 1: dev decision). Concise, first-person operator voice,
// using ONLY the sanctioned {client}/{slot}/{amount} tokens — never invent a new
// token. A type without a relevant amount/slot simply omits that placeholder.
export const DEFAULT_TEMPLATE_BODIES: Record<MessageTemplateType, string> = {
  booking_confirmation:
    "Hi {client}, you're all set for {slot}. See you then! — Love's Cleaning",
  rebooking_nudge:
    'Hi {client}, ready for your next clean? I have {slot} open — want me to lock it in?',
  win_back:
    "Hi {client}, it's been a while! Want to get back on the schedule? Happy to find a time that works for you.",
  payment_reminder:
    'Hi {client}, a friendly reminder that {amount} is still due for your recent clean. Thank you!',
};

/** Type guard: is `value` one of the four sanctioned template types? */
export function isMessageTemplateType(
  value: string,
): value is MessageTemplateType {
  return (MESSAGE_TEMPLATE_TYPES as readonly string[]).includes(value);
}

export interface TemplateInput {
  type: string;
  body: string;
}

export interface TemplateEdit {
  type: MessageTemplateType;
  body: string;
}

/**
 * Validate a template edit before the sole write path persists it (AR15). An
 * unknown `type` (form tampering) or an empty `body` writes NOTHING. Returns the
 * trimmed body so a template is never saved as pure whitespace.
 */
export function validateTemplate(input: TemplateInput): ActionResult<TemplateEdit> {
  if (!isMessageTemplateType(input.type)) return fail('template-type-invalid');
  const body = input.body.trim();
  if (body.length === 0) return fail('template-body-required');
  return ok({ type: input.type, body });
}
