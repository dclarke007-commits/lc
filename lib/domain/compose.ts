// Pure domain module — NO framework/db imports (dependency rule: domain sits
// below actions/surfaces). Composes channel-agnostic message text (AD-5).
//
// Story 2.1 establishes the FIRST half: resolveTemplate — the placeholder seam
// Story 2.2's `compose` consumes to build a MessageDraft. This file owns ONLY
// template→text resolution; MessageDraft construction and the wa.me/sms delivery
// adapter are Story 2.2, never here (AD-5: compose ≠ deliver).

import {
  TEMPLATE_PLACEHOLDERS,
  type TemplatePlaceholder,
  type MessageTemplateType,
} from './messageTemplateConfig';

// Matches any brace-token `{...}` (no nested braces). We inspect EVERY match, not
// just the three sanctioned names, so an unknown or malformed token can never
// survive to the output — the core AC3 guarantee.
const TOKEN_RE = /\{([^{}]*)\}/g;

const SANCTIONED = new Set<string>(TEMPLATE_PLACEHOLDERS);

/**
 * Resolve a template `body` against provided placeholder `values`, guaranteeing
 * no raw `{token}` ever leaks (AC3).
 *
 * - A sanctioned token ({client}/{slot}/{amount}) with a non-empty value →
 *   substituted with that value.
 * - A sanctioned token whose value is undefined/null/empty → blank (safe text),
 *   never the literal `{amount}`.
 * - Any other brace-token (unknown, mistyped, or spaced like `{ amount }`) →
 *   stripped. `{ amount }` trims to a sanctioned name and resolves; `{foo}` blanks.
 *
 * Values are already stringified by the caller (Story 2.2's compose owns turning
 * a date into a {slot} string and integer cents (AR16) into a display {amount}).
 * Pure function; the seam 2.2 builds MessageDraft on top of.
 */
export function resolveTemplate(
  body: string,
  values: Partial<Record<TemplatePlaceholder, string>>,
): string {
  const substituted = body.replace(TOKEN_RE, (_match, rawName: string) => {
    const name = rawName.trim().toLowerCase();
    if (SANCTIONED.has(name)) {
      const value = values[name as TemplatePlaceholder];
      // undefined/null/'' all resolve to blank — never a literal {token}.
      return value == null ? '' : value;
    }
    // Unknown/malformed brace-token — strip it so nothing raw reaches a client.
    return '';
  });

  // Brace backstop (code-review 2026-07-16, AC3): the single-pass regex above
  // resolves one balanced `{name}` at a time, so nested/doubled/unbalanced braces
  // can strand a literal `{` or `}` — `{{amount}}` → `{$5}`, `{foo{bar}}` → `{foo}`,
  // an unclosed `{amount` never matches at all. AC3 is absolute ("no raw brace-token
  // can ever reach a client"), so strip ANY residual brace character. Braces are
  // reserved for placeholders by contract; nothing legitimate survives here.
  const debraced = substituted.replace(/[{}]/g, '');

  // Blank-collapse (Open gap 3 — dev decision): a blanked token can leave double
  // spaces ("owe  total" → "owe total"), a dangling space before punctuation
  // ("owe ." → "owe."), or a trailing space; tidy all three so client-facing copy
  // never reads as broken. Collapse intra-line runs to one space, drop a space
  // sitting just before sentence punctuation, strip per-line trailing spaces, and
  // trim the whole string. Newlines are preserved.
  return debraced
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/[^\S\n]+([.,!?;:])/g, '$1')
    .replace(/[^\S\n]+$/gm, '')
    .trim();
}

// --- Story 2.2: compose → MessageDraft (the transport-agnostic half of AD-5) ---

// A channel-agnostic outbound message (AR6/AD-5). Deliberately carries NO transport
// detail — no `url`, no `wa.me`/`sms:`, no channel field. `recipient` is the client's
// raw phone (normalization is the delivery adapter's job, never the draft's); `body`
// is the resolved template text; `type` is the message KIND, not a channel. A future
// auto-send transport is a new `lib/delivery` adapter over this same shape — zero
// change here (AD-5).
export interface MessageDraft {
  recipient: string;
  body: string;
  type: MessageTemplateType;
}

// The minimal client fields compose needs. Phone is the raw stored string.
export interface ComposeClient {
  name: string;
  phone: string;
}

// The persisted template compose reads (Story 2.1). Only type + body are consumed.
export interface ComposeTemplate {
  type: MessageTemplateType;
  body: string;
}

/** Render integer cents (AR16) as a display USD string, e.g. 20000 → "$200.00". */
function formatAmount(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}

/**
 * Turn `(client, slot, amount, template)` into a channel-agnostic `MessageDraft`
 * (AC1). PURE and transport-agnostic: no framework/db/delivery import, no deep-link
 * string, no side effect. Reuses Story 2.1's `resolveTemplate` for placeholder fill
 * (a missing value → blank, never a `{token}` leak). compose owns the two value
 * formats the resolver delegates to its caller: the `{slot}` display string (passed
 * in, already formatted) and `{amount}` (integer cents → USD here). `amountCents`
 * null → `{amount}` resolves to blank.
 */
export function compose(
  client: ComposeClient,
  slot: string,
  amountCents: number | null,
  template: ComposeTemplate,
): MessageDraft {
  const body = resolveTemplate(template.body, {
    client: client.name,
    slot,
    amount: amountCents == null ? '' : formatAmount(amountCents),
  });
  return { recipient: client.phone, body, type: template.type };
}

/**
 * The deterministic per-draft idempotency nonce for a Job's booking-confirmation
 * draft (Story 2.4, Open gap #2). Keyed on the Job id, NOT a random value: an
 * idempotent repeat `commitBooking` (AD-12) returns the SAME Job, so the same nonce
 * → the same MessageLog row → exactly one confirmation draft, never a duplicate. The
 * send surface derives the same nonce from the job id, so no nonce needs threading
 * through the redirect. Mirrors the Story 2.3 (owner, draft_nonce) Option-B key.
 */
export function confirmationDraftNonce(jobId: string): string {
  return `confirm:${jobId}`;
}

/**
 * The deterministic per-draft idempotency nonce for a Job's post-job REBOOKING nudge
 * (Story 3.4, Task 2). Keyed on the anchor Job id (mirrors confirmationDraftNonce's
 * `confirm:<jobId>`): the send tap resubmits this same nonce → the SAME MessageLog row →
 * dispatched_at is stamped ONCE (Story 2.3 idempotency), so a re-tap never double-logs a
 * nudge. One dispatched `rebooking_nudge` row per anchor job is exactly the "nudge sent"
 * fact the conversion metric counts.
 */
export function rebookingDispatchNonce(jobId: string): string {
  return `rebook:${jobId}`;
}
