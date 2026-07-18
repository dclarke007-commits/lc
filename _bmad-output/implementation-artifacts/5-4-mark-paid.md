---
baseline_commit: deb127a
---

# Story 5.4: Mark paid

Status: done

## Story

As the operator,
I want to mark an owed job paid,
so that the outstanding total stays honest.

## Acceptance Criteria

1. **(FR32)** Given an owed job, when I mark it paid, its `payment` flips `owed → paid` and it clears from the outstanding total (which is derived on read — 5.2 — so it drops automatically).
2. **(FR32, AR11)** `markPaid` sets `payment` **only** and **never** alters `completion`. It is the SOLE writer of `payment` (mirror of `lifecycle` as the sole writer of `completion`).
3. **(AR11)** Only a ledger-eligible (`completed`) job can be paid — a `booked`/`no-show`/`cancelled` job → rejected, nothing written.
4. Safe under repeat/concurrency: owner-scoped, row-locked check-then-write; an already-`paid` job → idempotent no-op returning the row (no second write); an unknown/non-uuid id → typed `job-not-found`. Never throws across the boundary (AR15).
5. Regression bar: `vitest`, `tsc --noEmit`, `next build` green. No migration.

## Tasks / Subtasks

- [x] **Task 1 — `markPaid` payment writer (AC: #1, #2, #3, #4)**
  - [x] New `lib/domain/ledger.ts`: `markPaid(ownerId, jobId)`. Mirrors `lifecycle.transition` — uuid guard; tx `.for('update')` owner-scoped lock; `job-not-found`; `isLedgerEligible` gate → `not-ledger-eligible`; already-paid → idempotent `ok(current)`; else `update({ payment: 'paid' })` (payment ONLY, completion untouched); catch → `ledger-write-failed`.
- [x] **Task 2 — `markJobPaid` Server Action (AC: #1)**
  - [x] `markJobPaid(jobId)` in `app/(operator)/ledger/actions.ts`: resolve owner, `markPaid`, `revalidatePath('/jobs')` on success. Thin, AR15 typed.
- [x] **Task 3 — Tests (AC: #1–#4)**
  - [x] `tests/ledger-mark-paid.test.ts` (db-integration, mirrors `lifecycle.test.ts`): 6 cases — completed+owed→paid (completion unchanged), idempotent already-paid, booked→not-ledger-eligible (payment unchanged), no-show→not-ledger-eligible, non-uuid→job-not-found, other-owner→job-not-found. Completion asserted unmutated on every path.
- [x] **Task 4 — Regression gate (AC: #5)**
  - [x] `vitest` 314/314 (+6); `tsc` 0; `next build` success. No migration.

## Dev Notes

### The payment-writer invariant (the crux)
- **AR11 / AD-10 (spine:108, 136):** "`markPaid` sets `payment` and NEVER alters `completion`. No path outside the ledger writes `payment`; no path outside `lifecycle` writes `completion`." `ledger.ts` is the payment-writer counterpart to `lifecycle.ts`. Do not write `payment` anywhere else; do not write `completion` here.
- **Eligibility gate reuses 5.1:** `isLedgerEligible(current)` (`derive.ts`, pure) — a non-`completed` job can never be paid. One predicate, three consumers now (5.2 aggregation, 5.3 reminder amount, 5.4 pay gate).
- **Outstanding clears automatically (AD-7):** the total is derived on read (5.2). Flipping `payment` → the next `outstanding()` call excludes the job — nothing to decrement, no stored total.

### Concurrency / idempotency (mirror lifecycle.transition)
- Transactional `.for('update')` row lock, owner-scoped select then update, so two concurrent taps can't both flip a stale row. Already-`paid` → `ok(current)` no-op (never a second write). Non-uuid short-circuits to `job-not-found` (avoids a 22P02 out of the tx). Typed result, never throws (AR15).

### Architecture guardrails
- **AD-1:** surface never imports `lib/db`; it calls `markJobPaid`. Domain writer `markPaid(ownerId, jobId)` is db-facing like `lifecycle` (owns a transactional write).
- **Owner-scoping (AD-8):** every select/update filters on the owner VALUE; an other-owner jobId is unreachable → `job-not-found`.

### Scope boundaries
- **IN:** `markPaid` writer + `markJobPaid` action + tests.
- **OUT:** the "mark paid" button / dashboard (Epic 6 wires it); no UI here. No `completion` writes. No new columns.

### Project Structure Notes
- Writer → `lib/domain/ledger.ts` (new). Action → append to `app/(operator)/ledger/actions.ts` (5.3). Tests → `tests/ledger-mark-paid.test.ts` (new, db-integration). No migration.

### Testing standards
- Vitest against the Docker Postgres (serial/singleFork, per `vitest.config`), mirroring `lifecycle.test.ts` seed/insert/read helpers. Independently re-run `vitest`+`tsc` on any green claim ([[lovescleaning-verify-discipline]]).

### References
- [Source: epics.md#Story 5.4] — ACs (lines 676-690)
- [Source: lib/domain/lifecycle.ts] — sole-writer pattern, transactional row-lock, uuid guard, typed result (mirror this)
- [Source: lib/domain/derive.ts] — `isLedgerEligible` (5.1) eligibility gate; `outstanding` (5.2) auto-clears
- [Source: app/(operator)/ledger/actions.ts] — 5.3 action file to extend
- [Source: ARCHITECTURE-SPINE.md] — AR11/AD-10 payment≠completion, AD-1/AD-8, AD-7 derived-on-read
- [Source: tests/lifecycle.test.ts] — db-integration harness to mirror

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (inline dev-story cycle)

### Debug Log References

- `vitest run` → 314 passed (31 files; +6 `markPaid` db-integration cases) · `tsc` → 0 · `next build` → success

### Completion Notes List

- `ledger.ts` is the payment-writer counterpart to `lifecycle.ts`: two orthogonal fields (`completion`/`payment`), one writer each, neither touching the other (AR11). markPaid sets `payment` only — tests assert `completion`/`completedAt` are never mutated.
- Eligibility gate reuses the single 5.1 predicate (`isLedgerEligible`) — a booked/no-show/cancelled job can never be paid. The predicate now has 3 consumers (5.2 aggregation, 5.3 reminder amount, 5.4 pay gate).
- Idempotent + concurrency-safe: `.for('update')` row lock, already-paid → `ok(current)` no-op, non-uuid → `job-not-found` (no 22P02 leak) — mirrors `lifecycle.transition`.
- Outstanding clears automatically (AD-7): no stored total to decrement; the next `outstanding()` excludes the now-`paid` job.
- Owner-scoped (AD-8): other-owner jobId unreachable → `job-not-found` (tested). No schema/migration.

### File List

- `lib/domain/ledger.ts` (new) — `markPaid` (sole payment writer, AR11)
- `app/(operator)/ledger/actions.ts` (modified) — `markJobPaid` Server Action + imports
- `tests/ledger-mark-paid.test.ts` (new) — 6 db-integration tests
- `_bmad-output/implementation-artifacts/5-4-mark-paid.md` (modified) — story record

### Change Log

- 2026-07-18 — Implemented Story 5.4: `ledger.markPaid` (sole payment writer, owed→paid, completion untouched, eligibility-gated, idempotent, owner-scoped) + `markJobPaid` action. 314/314, tsc + build green.
- 2026-07-18 — Inline adversarial review: **APPROVE**, 0 findings. Status → done. Epic 5 complete.
