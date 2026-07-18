---
baseline_commit: c685fbe
---

# Story 5.3: Payment-reminder draft

Status: done

## Story

As the operator,
I want a one-tap payment reminder for a client who owes,
so that chasing money is frictionless — and never sent without my tap.

## Acceptance Criteria

1. **(FR31)** Given an outstanding client, when the operator triggers "remind", a payment-reminder `MessageDraft` is composed via the `payment_reminder` template (client's persisted body, falling back to the seeded default), with the client's outstanding amount filling `{amount}` — ready to send through Epic 2's delivery adapter.
2. **(FR31, FR19)** The reminder is **operator-triggered and never auto-sent**: composing produces a draft only; no dispatch, no `MessageLog` write, nothing autonomous.
3. A reminder is only composed when the client actually owes: `owedCents <= 0` (or a non-integer) → no draft (guard), so a `$0.00` reminder is never produced.
4. The reminder carries **no slot** (`{slot}` blanks) — a payment reminder is not about a booking time. Amount is the ledger's integer-cents outstanding total, rendered by `compose.formatAmount`.
5. Regression bar: `vitest`, `tsc --noEmit`, `next build` green. No migration.

## Tasks / Subtasks

- [x] **Task 1 — Pure `paymentReminderDraft` helper (AC: #1, #3, #4)**
  - [x] Added to `lib/domain/compose.ts`. Guard `!Number.isInteger(owedCents) || owedCents <= 0` → `null`; else `compose(client, '', owedCents, { type: 'payment_reminder', body })`.
  - [x] Pure/transport-agnostic (AD-5); reuses `compose` + `resolveTemplate` no-`{token}`-leak guarantee.
- [x] **Task 2 — `draftPaymentReminder` Server Action (AC: #1, #2)**
  - [x] New `app/(operator)/ledger/actions.ts`. Resolves owner, `getClient` (fail `client-not-found`), owed total via `outstanding(listLedgerJobs)`, template + default fallback, `paymentReminderDraft` → `nothing-owed` on null else `ok(draft)`.
  - [x] Read → compose only; no write/dispatch/MessageLog. AR15 typed, no throw crosses boundary.
- [x] **Task 3 — Tests (AC: #1, #3, #4)**
  - [x] New `tests/ledger.test.ts`: 6 cases — composes with owed amount, blank `{slot}`, no `{token}` leak, guards $0/negative/non-integer.
- [x] **Task 4 — Regression gate (AC: #5)**
  - [x] `vitest` 308/308 (+6); `tsc` 0; `next build` success (action-only, no route). No migration.

## Dev Notes

### Reuse — do NOT rebuild the message engine
- **`compose(client, slot, amountCents, template)`** (`lib/domain/compose.ts`) already builds a channel-agnostic `MessageDraft` for ANY template type and formats integer cents → `$X.XX` (`formatAmount`). `resolveTemplate` guarantees no raw `{token}` leaks and blanks a missing value. 5-3 wraps it; it does not re-implement composition.
- **`outstanding()`** (Story 5.2, `derive.ts`) already computes the per-client owed total. 5-3 reads the client's line — never re-sums.
- **Template plumbing:** `getMessageTemplates(ownerId)` + `DEFAULT_TEMPLATE_BODIES.payment_reminder` + `isMessageTemplateType` are the established pattern (`app/(operator)/draft/actions.ts`). The `payment_reminder` type + default body already exist (`messageTemplateConfig.ts`).
- **Delivery is later/existing:** turning the draft into a `wa.me`/`sms:` link is `lib/delivery` on the operator's tap (`sendDraft`). 5-3 stops at the draft (AD-5, FR19).

### Architecture guardrails
- **AD-5 (compose ≠ deliver):** the helper is pure and transport-agnostic — no channel, no url.
- **FR19 / FR31 (never auto-send):** composing is side-effect-free; dispatch/`MessageLog` happens ONLY in `recordDispatch` on the explicit send tap. 5-3 writes nothing.
- **AD-1 (sole write path = Server Actions):** the surface never imports `lib/db`; it calls `draftPaymentReminder`. (No surface built here — Epic 6's dashboard wires the button; 5-3 delivers the action.)
- **Money = integer cents** (spine:134); amount flows as cents, formatted only at compose.

### Scope boundaries
- **IN:** pure `paymentReminderDraft` helper + `draftPaymentReminder` action + tests.
- **OUT:** the "remind" button / dashboard surface (Epic 6), `markPaid` (5.4), any dispatch/logging (Story 2.3 owns it). Do not build a page or wire delivery.

### Project Structure Notes
- Helper → `lib/domain/compose.ts`. Action → `app/(operator)/ledger/actions.ts` (new; no page yet — action-only is fine, builds clean). Tests → `tests/ledger.test.ts` (new). No migration.

### Testing standards
- Vitest. The composition seam is pure → unit-tested directly (no DB). The action is thin glue over tested pieces. Independently re-run `vitest`+`tsc` on any green claim ([[lovescleaning-verify-discipline]]).

### References
- [Source: epics.md#Story 5.3] — ACs (lines 660-674)
- [Source: lib/domain/compose.ts] — `compose`, `resolveTemplate`, `formatAmount`, `MessageDraft`, `ComposeClient`
- [Source: lib/domain/derive.ts] — `outstanding` (5.2)
- [Source: app/(operator)/draft/actions.ts] — template-fetch + AR15 action pattern; `recordDispatch` (the ONLY dispatch writer — not touched here)
- [Source: lib/domain/messageTemplateConfig.ts] — `payment_reminder` type + default body
- [Source: ARCHITECTURE-SPINE.md] — AD-5 compose≠deliver, FR19 never auto-send, integer cents

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (inline dev-story cycle)

### Debug Log References

- `vitest run` → 308 passed (30 files; +6 `paymentReminderDraft` cases) · `tsc` → 0 · `next build` → success

### Completion Notes List

- 5-3 composes Epics 2 + 5: `outstanding()` (5.2) supplies the amount, `compose()` (2.2) supplies the draft. Only genuinely new code is the pure `paymentReminderDraft` seam (slot='', $0-guard) — everything else reused.
- **FR19 honored:** composing is side-effect-free — no write, no dispatch, no `MessageLog`. Dispatch stays in Story 2.3's `recordDispatch`, fired only on the operator's explicit send tap via `sendDraft`.
- **Guard:** non-integer/≤0 `owedCents` → null → `nothing-owed`; a client absent from the ledger owes 0 → same. No `$0.00` reminder ever produced.
- Owner-scoped end to end (`getClient`, `listLedgerJobs`); no cross-tenant reach (AD-8). No schema/migration.
- Action-only story — no `/ledger` page yet; Epic 6's dashboard wires the "remind" button to `draftPaymentReminder`.

### File List

- `lib/domain/compose.ts` (modified) — `paymentReminderDraft` helper
- `app/(operator)/ledger/actions.ts` (new) — `draftPaymentReminder` Server Action
- `tests/ledger.test.ts` (new) — `paymentReminderDraft` tests (6 cases)
- `_bmad-output/implementation-artifacts/5-3-payment-reminder-draft.md` (modified) — story record

### Change Log

- 2026-07-18 — Implemented Story 5.3: pure `paymentReminderDraft` (compose.ts) + `draftPaymentReminder` action (ledger/actions.ts), reusing 5.2 `outstanding` + Epic 2 `compose`. Operator-triggered, never auto-sent (FR19). 308/308, tsc + build green.
- 2026-07-18 — Inline adversarial review: **APPROVE**, 0 findings. Status → done.
