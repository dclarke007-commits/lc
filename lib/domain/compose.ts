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
 * Compose a payment-reminder MessageDraft for a client who owes (Story 5.3, FR31).
 * A reminder is NOT slot-bound, so `{slot}` blanks (empty string in). The amount is
 * the ledger's integer-cents outstanding total (from derive.outstanding, 5.2),
 * rendered by compose's formatAmount. Guarded: a non-integer or non-positive
 * `owedCents` → null (never draft a "$0.00" reminder for someone who owes nothing).
 * Pure and transport-agnostic like compose (AD-5) — the caller (the ledger Server
 * Action) turns null into a typed `nothing-owed` failure and never dispatches here
 * (FR19: reminders are operator-triggered on the send tap, never auto-sent).
 */
export function paymentReminderDraft(
  client: ComposeClient,
  owedCents: number,
  templateBody: string,
): MessageDraft | null {
  if (!Number.isInteger(owedCents) || owedCents <= 0) return null;
  return compose(client, '', owedCents, {
    type: 'payment_reminder',
    body: templateBody,
  });
}

// --- Dispatch-nonce keying convention (Epic 2 + Epic 3 retro action item) ---------
//
// Every message-dispatch idempotency nonce below keys on the EVENT INSTANCE, never on a
// bare entity id. The event instance is whatever recurring thing "sends this message once":
//   • a booking-confirmation / rebooking nudge → the ANCHOR JOB id (confirm:<jobId>,
//     rebook:<jobId>) — one dispatch per job.
//   • a win-back check-in → the client id AND the cold-SPELL discriminator
//     (winback:<clientId>:<expectedNextDate>) — one dispatch per cold spell, NOT per client.
// The rule exists because a bare-entity key (e.g. winback:<clientId>) collapses EVERY future
// occurrence into one lifetime MessageLog row: the second genuine send reuses the first's
// nonce, the (owner, draft_nonce) dispatch guard matches the old row, dispatched_at is never
// re-stamped, and the real send goes unlogged (under-counting fatigue/conversion). Keying on
// the instance means each occurrence gets a fresh nonce → a fresh row, while a re-TAP within
// the same instance still resubmits the SAME nonce → dispatched_at stamped exactly once
// (Story 2.3 idempotency: re-opens the chat, never double-logs). New nonce helpers MUST pick
// an instance discriminator that advances once per occurrence — never a bare id alone.

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

/**
 * The deterministic per-draft idempotency nonce for a client's WIN-BACK check-in
 * (Story 3.6). Keyed on the client id AND the current cold-spell discriminator
 * `spellKey` (the client's live `expectedNextDate`) — code review 2026-07-17. A win-back
 * has no anchor job, so a bare `winback:<clientId>` would collapse EVERY future win-back
 * into one lifetime MessageLog row: a client who revives then relapses months later would
 * reuse the same nonce, the dispatch guard would match zero rows, and the genuine second
 * send would never be logged (under-counting nudge-fatigue). Keying on `expectedNextDate`
 * — which advances once the client completes a new job — means each fresh cold spell gets
 * a NEW nonce → a NEW dispatch row, while a re-tap WITHIN the same spell still resubmits
 * the SAME nonce → dispatched_at stamped ONCE (Story 2.3 idempotency: re-opens the chat,
 * never double-logs). Mirrors rebookingDispatchNonce's per-`jobId` keying.
 */
export function winBackDispatchNonce(clientId: string, spellKey: string): string {
  return `winback:${clientId}:${spellKey}`;
}
