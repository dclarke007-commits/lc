<!-- Powered by BMAD-CORE™ -->

# Story 6.1: Single-screen dashboard core

**Status:** ready-for-dev

## Story

As the operator,
I want one screen with my real numbers,
So that I run the business on truth, not vanity.

## Acceptance Criteria

**AC1 — Four headline numbers, derived on read**
**Given** the current week
**When** the dashboard renders
**Then** it shows current-week **utilization** (of the weekly ceiling), **repeat vs. lapsed counts**, **month-over-month revenue**, and **outstanding balance** — all derived on read, never stored (FR22, AR8/AD-7).

**AC2 — Metric math is exact and canonical**
**Given** metric math
**When** computed
**Then** **utilization = consuming-jobs-this-week ÷ weeklyCeiling** (ceiling is the operator's configured `weeklyCeiling`, default 14 — do NOT hardcode 14), **and** the repeat-booking rate follows the **addendum-F rolling-30-day definition** (AR19): of jobs *completed* in a rolling 30-day window, the share for which the *same client has a booking created within 30 days of that job's completion date*. It reads `Job.createdAt` + `Job.completedAt`, **never the scheduled `date`** as a substitute.

**AC3 — No vanity; every element earns its place**
**Given** any candidate element
**When** placed on the dashboard
**Then** it maps to a named leak or a capacity/cash decision, or it does not ship (FR25, NFR1).

## Tasks / Subtasks

- [ ] **Task 1 — Revenue derive (`derive.monthlyRevenue`)** (AC1, AC2)
  - [ ] Add pure fn in `lib/domain/derive.ts`: given ledger-eligible jobs with `{ completedAt, priceCents }` and the operator timezone + a reference "now", return `{ thisMonthCents, lastMonthCents, deltaCents }`. Bucket by the operator-local calendar month of `completedAt` (AD-9/AR10 — month boundary is operator-local, not UTC).
  - [ ] Revenue counts only ledger-eligible jobs (reuse `isLedgerEligible`, Story 5.1) — a no-show earns nothing; a cancelled job never happened.
- [ ] **Task 2 — Repeat/lapsed counts + repeat-rate derive** (AC1, AC2)
  - [ ] Add `derive.repeatBookingRate(jobs, now, tz)` implementing addendum-F exactly (rolling 30-day window on `completedAt`; numerator = same-client follow-on booking `createdAt` within 30 days of that completion). Denominator zero → return `null` (not `0` — "no completed jobs yet" ≠ "0% repeat"), surface renders "—".
  - [ ] Add `derive.repeatVsLapsedCounts(...)`: **repeat** = distinct active clients with ≥2 lifetime completed jobs; **lapsed** = distinct clients currently gone-cold (reuse `goneCold` / `expectedNextDate`, Story 3.5). Counts, not rates (rates are Story 6.2 — hold the line).
- [ ] **Task 3 — Dashboard read query** (AC1)
  - [ ] Add `queries.getDashboardData(ownerId)` (or extend the action layer) returning the rows the three derives + `outstanding()` + `weekCapacity()` need, all `owner_id`-scoped (AR9). Reuse `listLedgerJobs` (Story 5.2) where it already fits; add only what is missing.
  - [ ] **Absorb Epic-5 retro perf debt** flagged for this epic: bounded/per-client `listJobs` projection, drop the unused `clientName` join, de-dupe the win-back double-load. Do not surface lapse at scale on an unbounded scan.
- [ ] **Task 4 — Dashboard action + surface** (AC1, AC3)
  - [ ] Add `getDashboardMetrics()` to `app/(operator)/actions.ts` (the surface calls the action layer only — surfaces never import `lib/domain` or `lib/db`, AD-7/AD-13). It composes `weekCapacity`/`roomLeft` (utilization), the two new derives, and `outstanding()` (Story 5.2) into one view-model.
  - [ ] Extend `app/(operator)/page.tsx`: add a metrics section **above** the existing capacity table. Keep `export const dynamic = 'force-dynamic'` and the in-page session read (AD-6/AD-7). Phone-legible, RSC, no client JS.
  - [ ] Each rendered element carries a one-line "why it's here" mapping to a leak/decision (AC3) — outstanding→payment leak, lapsed→revenue leak, utilization→capacity decision, MoM revenue→cash trajectory.
- [ ] **Task 5 — Tests + regression gate** (all ACs)
  - [ ] Unit-test `monthlyRevenue`, `repeatBookingRate` (incl. the null-denominator and the "follow-on created >30d after completion does NOT count" edge), `repeatVsLapsedCounts` in `tests/derive.test.ts`.
  - [ ] Test the addendum-F boundary explicitly: a follow-on booking `createdAt` exactly 30 days after completion (inclusive/exclusive per addendum) and one at 31 days (excluded).
  - [ ] Full gate: `vitest run` (all green), `tsc --noEmit` clean, `next build` green.

## Dev Notes

### Builds directly on Epics 1, 3, 5

The dashboard is the aggregation payoff — it **reuses** existing derives, it does not reinvent them:
- **Utilization** → `weekCapacity()` / `roomLeft()` (Story 1.7, `lib/domain/derive.ts`). Ceiling comes from `getCapacitySettings` (`weeklyCeiling`), **not** a literal 14.
- **Outstanding balance** → `outstanding()` + `listLedgerJobs` (Story 5.2).
- **Lapsed** → `goneCold()` / `expectedNextDate()` (Story 3.5).
- **Ledger eligibility** → `isLedgerEligible()` (Story 5.1) gates which jobs count toward revenue.

### Architecture guardrails (load-bearing)

- **AD-7 / AD-13 — derive on read, surfaces stay thin.** The page (`app/(operator)/page.tsx`) imports only from `./actions`. It never imports `lib/domain` or `lib/db`. All new metric math lives in `lib/domain/derive.ts` as pure functions; the DB read lives in `lib/db/queries.ts`; `actions.ts` is the only seam that touches both.
- **AD-9 / AR10 — operator-local time.** Month bucketing for MoM revenue and the 30-day windows for addendum-F are computed in the operator's local timezone (via `lib/domain/clock.ts`). `completedAt`/`createdAt` are UTC instants; convert at the boundary. The week boundary stays Mon–Sun.
- **AR9 — every read is `owner_id`-filtered.** No cross-owner leakage in any new query.
- **AD-7 (no cache) — `dynamic = 'force-dynamic'` stays.** Numbers must be live mid-call; never `use cache` an operator surface.
- **Repeat-rate reads timestamps, never scheduled date** (ARCHITECTURE-SPINE §AD-7): `Job.createdAt` + `Job.completedAt`. Both exist in schema (`lib/db/schema.ts:181,185`). Review G1 (HIGH) confirmed this is the ONLY correct input pair — using `date` silently corrupts the north-star metric.

### Scope boundaries (do NOT cross)

- **6.1 = the four headline numbers + utilization/repeat-rate math.** The **three leak-indicator conversion rates** (inquiry→booking, one-time→repeat conversion, caught-cold count) are **Story 6.2**. The **gone-cold list with win-back buttons** is **Story 6.3**. **CSV export** is **Story 6.4**. Ship 6.1 without them.
- "Repeat vs. lapsed **counts**" (6.1) are integer counts. "One-time → repeat **conversion**" (6.2) is a rate. They are different numbers — do not conflate.

### Absorb Epic-5 retrospective action item (owner: Developer, status: open)

> "Before Epic 6 dashboard (FR23) surfaces lapse at scale, address deferred perf: bounded/per-client `listJobs` projection, drop unused `clientName` join, de-dupe winback double-load."

This story is where that debt comes due (Task 3). The dashboard scans every job to compute lapse/repeat — an unbounded projection with a dead join is the wrong foundation to build on.

### Project Structure Notes

- New pure derives: `lib/domain/derive.ts` (append; keep the module pure — no I/O, no `Date.now()`; pass `now` in per `clock.ts` convention).
- New/extended read: `lib/db/queries.ts`.
- New action: `app/(operator)/actions.ts` (`getDashboardMetrics`).
- Surface: `app/(operator)/page.tsx` (extend, don't replace — the capacity table stays).
- Tests: `tests/derive.test.ts` (extend).

### Testing standards

- Pure derives are unit-tested with fabricated rows (no DB) — matches `tests/derive.test.ts`, `tests/ledger.test.ts`.
- Determinism: never call `Date.now()` in domain code; inject `now`. Tests pass fixed instants.
- Edge cases required: null-denominator repeat rate, addendum-F 30-day boundary (30 vs 31 days), month-boundary revenue in operator tz (a job completed 11:59pm local on the last of the month buckets to that month, not the next in UTC).

### References

- `_bmad-output/planning-artifacts/epics.md` — Epic 6 §Story 6.1; FR22, FR25, NFR1.
- `.../architecture/architecture-LovesCleaning-2026-07-15/ARCHITECTURE-SPINE.md:88-90` — AD-7 binding + repeat-rate rule.
- `.../reviews/review-reconcile-prd.md:18-29` — addendum-F exact definition (G1, HIGH, resolved).
- Prior derives: `lib/domain/derive.ts` (`outstanding`, `weekCapacity`, `roomLeft`, `goneCold`, `expectedNextDate`, `isLedgerEligible`).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
