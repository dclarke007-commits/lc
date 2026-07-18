---
baseline_commit: cd71368
---

# Story 5.2: Outstanding aggregation — "who owes"

Status: done

## Story

As the operator,
I want owed jobs totalled and grouped by client,
so that I can see the float at a glance — who owes me and how much.

## Acceptance Criteria

1. **(FR30, AR8)** Given `owed` jobs, `derive` flags them and aggregates their amounts into an outstanding balance — a total plus a per-client "who owes" breakdown.
2. **(FR30, AR8, AD-7)** The outstanding total is **derived on read** from `owed` job amounts — **no stored running total**, no cached field, no cron.
3. **(AR11, builds on 5.1)** Only a **ledger-eligible** job counts: `isLedgerEligible(job) && payment === 'owed'`. A `booked`/`no-show`/`cancelled` job carrying the default `owed` is **excluded** — no phantom debt.
4. Amounts are each job's frozen `priceCents` snapshot (from booking); the total is their integer-cents sum. No float math.
5. Regression bar: full `vitest`, `tsc --noEmit`, `next build` green. No DB migration.

## Tasks / Subtasks

- [x] **Task 1 — `outstanding()` aggregation in `derive.ts` (AC: #1, #2, #3, #4)**
  - [x] Added `LedgerJob` projection (`clientId`, `clientName`, `completion`, `payment`, `priceCents`) + `OutstandingClient`/`OutstandingLedger` types.
  - [x] `outstanding(jobs): { totalCents, clients }` — includes a job iff `isLedgerEligible(job) && payment === 'owed'` (reuses 5.1 predicate, no re-inline); groups by `clientId`, sums `priceCents`, sorts `owedCents` desc + `clientName` tiebreak.
  - [x] Pure/db-free; no stored total (AD-7).
- [x] **Task 2 — Query projection (AC: #1)**
  - [x] `listLedgerJobs(ownerId)` in `queries.ts` — own projection, owner-scoped on the VALUE + owner-scoped client join (AD-8), no aggregation (derive does that). `listJobs`/`JobListItem` left untouched.
- [x] **Task 3 — Tests (AC: #1–#4)**
  - [x] 6 `outstanding()` cases: empty; completed+owed sum; completed+paid excluded; booked/no-show/cancelled+owed excluded (phantom-debt guard); multi-client grouping+desc sort; derived-on-read mutation proof.
- [x] **Task 4 — Regression gate (AC: #5)**
  - [x] `vitest` 302/302 (+6); `tsc` clean; `next build` success. No migration.

## Dev Notes

### Builds directly on 5.1
- `derive.isLedgerEligible(job)` (completion-gated, AR11) is the eligibility half; `outstanding()` adds the `payment === 'owed'` half. Reuse the predicate — do not re-inline `completion === 'completed'`.

### Architecture guardrails
- **AD-7 / AR8 (spine:86-90, 126):** derived on read, no stored running total. `outstanding()` must be a pure function of its input rows — cancel/pay a job and the next call reflects it with nothing to invalidate.
- **`derive.ts` is pure** — no db, no framework imports. The aggregation lives here (spine:219 maps cash ledger to `derive` + ledger actions + `lib/db`).
- **Money = integer cents** (spine:134). Sum in cents; never divide until display. `compose.formatAmount` already renders cents→`$X.XX` for later UI.
- **AD-8 owner-scoping (queries):** follow `listJobs` pattern exactly — owner filter on the value, client join owner-scoped, so no cross-tenant row is reachable.

### Scope boundaries
- **IN:** the `outstanding()` derive function + its query projection + tests.
- **OUT:** the dashboard screen (Epic 6 owns the single-screen surface), the reminder draft (5.3), `markPaid` (5.4). Do NOT build a full page here; a read surface is deferred to Epic 6's dashboard. If a thin ledger read page is wanted for manual verification, keep it out of scope unless requested.

### Prior-story nit to absorb
- 5.1 review flagged a behaviorally-vacuous `priceCents` test — 5.2 is where `priceCents` is actually read, so amount-sum correctness is now genuinely tested here (supersedes that nit).

### Project Structure Notes
- `outstanding()` + types → `lib/domain/derive.ts`. Query → `lib/db/queries.ts`. Tests → `tests/derive.test.ts`. No new files, no migration.

### Testing standards
- Vitest, pure unit tests for `outstanding()` (db-free). Independently re-run `vitest`+`tsc` on any green claim ([[lovescleaning-verify-discipline]]).

### References
- [Source: epics.md#Story 5.2] — ACs (lines 644-658)
- [Source: ARCHITECTURE-SPINE.md#AD-7] — derived-on-read, no stored total (86-90, 126)
- [Source: ARCHITECTURE-SPINE.md#Conventions] — integer cents (134)
- [Source: lib/domain/derive.ts] — `isLedgerEligible` (5.1), pure-module + projection pattern
- [Source: lib/db/queries.ts:listJobs] — owner-scoped join pattern (AD-8), `payment` already selected
- [Source: lib/domain/compose.ts:100] — `formatAmount` for later display

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (inline dev-story cycle)

### Debug Log References

- `vitest run` → 302 passed (was 296; +6 `outstanding` cases) · `tsc --noEmit` → 0 · `next build` → success

### Completion Notes List

- `outstanding()` composes on 5.1: eligibility (`isLedgerEligible`, completion-gated) × settlement (`payment === 'owed'`). Phantom-debt guard tested (a no-show's default `owed` never counts).
- Derived on read, no stored total (AD-7) — proven by a mutation test (`payment → 'paid'` drops the total to 0 with nothing to invalidate).
- Integer-cents sum throughout; display formatting deferred to `compose.formatAmount` in the reminder (5.3) / dashboard (Epic 6).
- `listLedgerJobs` is a dedicated owner-scoped projection (AD-8); `listJobs` left lean. Type-only import of `LedgerJob` into `queries.ts` — no runtime cycle.
- No schema/migration; no `completion`/`payment` writes.

### File List

- `lib/domain/derive.ts` (modified) — `LedgerJob`/`OutstandingClient`/`OutstandingLedger` types + `outstanding()`
- `lib/db/queries.ts` (modified) — `listLedgerJobs` projection + type import
- `tests/derive.test.ts` (modified) — `describe('derive.outstanding')` (6 cases)
- `_bmad-output/implementation-artifacts/5-2-outstanding-aggregation-who-owes.md` (modified) — story record

### Change Log

- 2026-07-18 — Implemented Story 5.2: `derive.outstanding()` "who owes" aggregation (completion×owed gated, per-client, integer-cents, derived-on-read) + `listLedgerJobs` query. 302/302, tsc + build green.
- 2026-07-18 — Inline adversarial review: **APPROVE**, 0 findings. Supersedes 5.1 low nit (priceCents now genuinely summed/tested). Status → done.
