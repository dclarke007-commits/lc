# Epic 5 Retrospective — Cash Ledger (Plug the Payment Leak)

**Date:** 2026-07-18 · **Outcome:** All 4 stories delivered, reviewed, green. Branch `feat/epic5-cash-ledger` / PR #5.

## What shipped

| Story | Deliverable | Key invariant |
|-------|-------------|---------------|
| 5.1 | `derive.isLedgerEligible` predicate | AR11: only a `completed` job is ledger-eligible |
| 5.2 | `derive.outstanding` "who owes" aggregation + `listLedgerJobs` | AD-7: derived on read, no stored total |
| 5.3 | `compose.paymentReminderDraft` + `draftPaymentReminder` action | FR19: operator-triggered, never auto-sent |
| 5.4 | `ledger.markPaid` (sole payment writer) + `markJobPaid` action | AR11: sets `payment` only, never `completion` |

**Metrics:** 314/314 tests (292 → 314, +22), `tsc` clean, `next build` green throughout. Zero HIGH/MED review findings across the epic; one LOW nit (5.1) superseded by 5.2.

## What went well

- **The predicate paid off 3×.** 5.1's one-line `isLedgerEligible` became the single gate for aggregation (5.2), reminder amount (5.3), and the pay guard (5.4). Defining eligibility once — the `consumesSlot` discipline applied to a new axis — kept the completion/payment gate from drifting across four surfaces.
- **Two orthogonal writers, cleanly split.** `lifecycle.ts` (completion) and `ledger.ts` (payment) mirror each other — same transactional row-lock, uuid guard, owner-scope, typed result — and neither writes the other's field. AR11 held structurally, not by vigilance.
- **Composition over new code.** 5.3 reused Epic 2's `compose` + 5.2's `outstanding` — the only new logic was a guarded seam. 5.2's amounts made 5.1's flagged-as-vacuous priceCents test genuinely meaningful.
- **Schema was already right.** `payment`/`priceCents` existed from Epic 1, so the whole epic shipped with **zero migrations**.

## Accepted limitations (carry into Epic 6 / later)

- **No ledger/dashboard UI yet.** 5.2–5.4 delivered domain + actions; the "who owes" list, "remind" button, and "mark paid" button are wired by **Epic 6's dashboard** (FR22–25). `draftPaymentReminder`/`markJobPaid` are ready to bind.
- **`revalidatePath('/jobs')` after markPaid** assumes the jobs surface is where payment shows; revisit when the Epic 6 dashboard becomes the canonical ledger view (may need to revalidate the dashboard route too).
- **Reminder is client-level (total owed).** Per-job reminders were not built — the epic's "outstanding job or client" AC was satisfied at the client-total granularity, which matches the per-client `outstanding()` shape. Add per-job if a use case appears.

## Action items

- [ ] **Epic 6:** wire `outstanding()` → dashboard "who owes" panel; bind `draftPaymentReminder` to a remind button and `markJobPaid` to a mark-paid button (agent-native parity — every operator action reachable).
- [ ] **Epic 6:** confirm `markJobPaid` revalidation covers the dashboard route once it exists.
- [ ] **Carried from Epic 3 (still open):** bounded/per-client `listJobs` projection + winback de-dupe before the dashboard aggregates at scale.
- [ ] **Carried from Epic 4 (still open):** manual-log dedup + public-write rate limiting (LOCKED gaps) before multi-tenant.

## Next

Epic 6 (Leak-Detector Dashboard + Data Export) — the honest-numbers payoff screen that surfaces every prior epic's signal, including this ledger's float. Recommended in a fresh session.
