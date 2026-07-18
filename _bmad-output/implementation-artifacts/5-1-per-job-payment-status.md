---
baseline_commit: 860da1e658e8782df0ba7e37c63fc3685a937fe7
---

# Story 5.1: Per-job payment status

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want every completed job to carry a `paid` or `owed` status with its amount, and only completed jobs to count in the ledger,
so that I always know what's genuinely outstanding — never a phantom debt from a booked, cancelled, or no-show slot.

## Acceptance Criteria

1. **(FR29)** A `completed` job carries a payment status of `paid` or `owed` with an amount in integer cents. (The row already stores `payment` + `priceCents`; this story makes the ledger *read* that carriage truthfully.)
2. **(FR29, AR11)** A job whose `completion` is not `completed` (`booked`, `no-show`, `cancelled`) is **not ledger-eligible** — the ledger never treats its `payment`/`priceCents` as an `owed`/`paid` obligation. Only a `completed` job is ledger-eligible.
3. Ledger-eligibility is defined in **exactly one place** — a single exported predicate — the way `capacity.consumesSlot` is the sole definition of slot consumption. Every future ledger read (5.2 aggregation, 5.3 reminder selection) and the 5.4 write path consult that one predicate; the rule is never re-inlined.
4. The per-job amount is the price **snapshotted at booking** (`priceCents`), not the operator's current `defaultJobPriceCents` — so re-pricing the business later never rewrites historical ledger amounts.
5. Regression bar: full `vitest` suite, `tsc --noEmit`, and `next build` all green. No DB migration is introduced by this story.

## Tasks / Subtasks

- [x] **Task 1 — Ledger-eligibility predicate (AC: #2, #3)**
  - [x] Add `isLedgerEligible(job): boolean` to `lib/domain/derive.ts`, returning `job.completion === 'completed'`. Placed directly under the `DeriveJob` interface, near the `consumesSlot` usage so the "single-definition eligibility rule" pattern is visually paired.
  - [x] Minimal input shape: `{ completion: string }` — decoupled from `DeriveJob` (which also requires `date`, irrelevant here) and forward-compatible with 5.2 rows that add `payment`/`priceCents`. No parallel `LedgerJob` type introduced.
  - [x] Documented with an AR11 comment ("payment orthogonal but gated: only a completed Job is ledger-eligible") citing the `consumesSlot` precedent and the `priceCents` snapshot rule.
- [x] **Task 2 — Confirm truthful carriage, add no new columns (AC: #1, #4)**
  - [x] Verified (no schema change): `job_payment` pgEnum `['paid','owed']` (schema.ts:149), `job.payment` default `'owed'` (171), `job.priceCents` notNull (177). No column added/renamed/migrated.
  - [x] Verified `capacity.commitBooking` stamps `priceCents: input.priceCents ?? config.defaultJobPriceCents` (capacity.ts:270) — frozen per-job amount. No projection change needed: 5.1 has no read surface (`queries.listJobs` already selects `payment`; `priceCents` deferred to 5.2 when the aggregation needs it).
- [x] **Task 3 — Tests prove the invariant (AC: #1, #2, #3)**
  - [x] `tests/derive.test.ts`: `completed`→true; `booked`/`no-show`/`cancelled`→false; gates on `completion` not `payment` (booked+owed still ineligible); amount reads the `priceCents` snapshot.
  - [x] 4 new cases; predicate is db-free (pure), no DB fixture needed.
- [x] **Task 4 — Regression gate (AC: #5)**
  - [x] `vitest run` → 296/296 (+4 new); `tsc --noEmit` → clean; `next build` → success. No migration introduced.

## Dev Notes

### What already exists — DO NOT rebuild
- **Payment storage is done.** `lib/db/schema.ts`: `jobPayment` enum (`paid|owed`) at ~149; `job.payment` default `'owed'` at ~171; `job.priceCents` notNull at ~177. A new booking is `owed` until `markPaid` (5.4). **No migration in this story.**
- **Amount at booking:** `lib/domain/capacity.ts:270` — `priceCents: input.priceCents ?? config.defaultJobPriceCents`. Amount is a per-job snapshot (AC #4).
- **`derive.ts` is a PURE domain module** — no framework imports, no db (header comment lines 6–16). It takes in-memory job lists and computes on read. The ledger's aggregation (5.2) and this predicate live here by architecture mandate, NOT in a new `ledger.ts` module.
- **`derive.consumesSlot` precedent:** capacity eligibility is defined once (`capacity.consumesSlot`) and consumed by both `commitBooking` and `derive.roomLeft`. Mirror that discipline exactly for ledger-eligibility (AC #3).
- **Money formatting exists:** `lib/domain/compose.ts:100` `formatAmount(cents)` → `$X.XX`. Reuse it in later stories; 5.1 needs no formatting (no UI).

### Architecture guardrails (must follow)
- **AR11 / AD-10** (`ARCHITECTURE-SPINE.md:107-108`): `payment` is orthogonal to `completion` but **gated** — only a `completed` Job is ledger-eligible; `markPaid` (5.4) sets `payment` and NEVER alters `completion`. **No path outside the ledger writes `payment`; no path outside `lifecycle` writes `completion`.** This story writes neither — it only defines the *read* predicate.
- **AD-7 derive-on-read** (spine:86-90): outstanding total (5.2) is derived on read from `owed` amounts — **no stored running total, no cron.** 5.1 must not introduce any cached/stored ledger field.
- **Naming** (spine:132): domain modules lowercase (`derive`); Server Actions verb-first (`markPaid` — that's 5.4, not here). Money = integer cents, USD.
- **Layering:** surfaces never reach domain directly; they call a Server Action → domain. 5.1 adds a pure predicate only, so no action/surface work.

### Scope boundaries (prevent scope creep)
- **IN 5.1:** the eligibility predicate + its tests + confirming carriage. That's it.
- **OUT (later stories):** "who owes" aggregation + dashboard flag (5.2), reminder `MessageDraft` (5.3), `markPaid` Server Action (5.4). Do **not** build a UI, an action, or an aggregation here.
- **Lifecycle is closed:** `lib/domain/lifecycle.ts` is the sole writer of `completion` and needs **zero changes** — its header already notes "Ledger note (Epic 5, not built here): only a `completed` Job is ledger-eligible."

### Project Structure Notes
- Predicate → `lib/domain/derive.ts` (existing file, add export). Tests → `tests/derive.test.ts` (existing, Vitest). No new files expected unless a genuinely new projection type is required — justify in the PR if so.
- No conflict with unified structure: `derive` is the sanctioned home for read-side eligibility per spine:219 ("Cash ledger (FR29–32) | ledger actions, `lib/db`, `derive`").

### Testing standards
- Vitest, colocated in `tests/*.test.ts` (see `tests/derive.test.ts`, `tests/lifecycle.test.ts`). Pure-function unit tests — no DB needed for the predicate (derive is db-free). Independently re-run `vitest run` + `tsc` on any subagent "green" claim ([[lovescleaning-verify-discipline]]).

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1] — ACs (lines 628-642)
- [Source: _bmad-output/planning-artifacts/epics.md#Cash Ledger FR29] — FR29 per-job paid/owed with amount (line 62, 153)
- [Source: architecture/.../ARCHITECTURE-SPINE.md#AD-10] — AR11 completion/payment gating (lines 107-108)
- [Source: ARCHITECTURE-SPINE.md#AD-7] — derived-on-read, no stored total (lines 86-90, 126)
- [Source: ARCHITECTURE-SPINE.md#Conventions] — money as integer cents, naming (lines 132-136)
- [Source: lib/db/schema.ts] — `jobPayment` enum + `job.payment`/`job.priceCents` (149, 171, 177)
- [Source: lib/domain/capacity.ts:270] — `priceCents` snapshot at booking
- [Source: lib/domain/derive.ts] — pure module, `consumesSlot` single-definition precedent (16, 68)
- [Source: lib/domain/lifecycle.ts:25] — "only a completed Job is ledger-eligible" note (no change here)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (bmad-dev-story)

### Debug Log References

- `vitest run` → 29 files, 296 passed (was 292; +4 new `isLedgerEligible` cases)
- `tsc --noEmit` → exit 0
- `next build` → success (all routes compiled; no new dynamic surface)

### Completion Notes List

- **Foundation-only, as scoped.** Delivered the single ledger-eligibility predicate; no UI, no Server Action, no aggregation (those are 5.2–5.4). Schema untouched (payment/priceCents already existed from Epic 1) — no migration.
- **Design decision — predicate signature/home:** `isLedgerEligible({ completion })` in `derive.ts`, not a new `ledger.ts` module. Backed by ARCHITECTURE-SPINE §row 219 ("Cash ledger → ledger actions, lib/db, `derive`") and AD-7 (read-side eligibility is derive's job). Input typed as the minimal `{ completion: string }` rather than reusing `DeriveJob` (avoids demanding an irrelevant `date`) — mirrors how `capacity.consumesSlot` is a tiny single-purpose predicate.
- **Invariant proven by test:** eligibility keys ONLY on `completion`, never `payment` — a `booked` job carrying the default `owed` is still ineligible. This closes the "phantom debt from a booked/no-show slot" gap (AR11).
- **AR11 write-separation preserved:** this story writes neither `completion` nor `payment`; `lifecycle.ts` (sole completion writer) needed zero changes.

### File List

- `lib/domain/derive.ts` (modified) — added `isLedgerEligible` predicate + doc comment
- `tests/derive.test.ts` (modified) — added `describe('derive.isLedgerEligible')` block (4 cases) + import
- `_bmad-output/implementation-artifacts/5-1-per-job-payment-status.md` (modified) — story record

### Change Log

- 2026-07-18 — Implemented Story 5.1: `derive.isLedgerEligible` predicate (completion-gated ledger-eligibility, AR11), 4 unit tests. 296/296 tests, tsc + build green. Status → review.
- 2026-07-18 — Code review (adversarial: Blind Hunter / Edge Case / Acceptance Auditor). Outcome: **APPROVE** — 0 High, 0 Med, 1 Low. Status → done.

## Senior Developer Review (AI)

**Reviewer:** claude-opus-4-8[1m] · **Date:** 2026-07-18 · **Outcome:** Approve

**Diff reviewed:** `lib/domain/derive.ts` (+16), `tests/derive.test.ts` (+31) vs baseline `860da1e`.

**Findings:**
- **[Low] AC4 test is behaviorally vacuous.** `tests/derive.test.ts` — the "priceCents snapshot" case asserts `completedJob.priceCents === 15000`, which exercises JS object semantics, not `isLedgerEligible` (the predicate never reads `priceCents`). It documents the snapshot intent but tests nothing in our code. Non-blocking; the amount-snapshot behavior properly belongs to 5.2 aggregation where `priceCents` is actually read. Consider removing or relocating to 5.2.

**Confirmed correct:**
- Predicate is pure, db-free, fail-closed (unknown/undefined completion → false).
- Gates on `completion` only, never `payment` — closes the phantom-debt gap (AR11). Proven by test.
- Single definition, mirrors `consumesSlot`. No `completion`/`payment` write paths added; `lifecycle.ts` untouched.
- No schema change / migration; scope matches the foundation story exactly.

**Action Items:**
- [ ] [Low] Drop or move the priceCents-snapshot test to Story 5.2 when aggregation reads the amount.
