<!-- Powered by BMAD-CORE™ -->

# Story 6.2: Leak indicators

**Status:** done

## Story

As the operator,
I want the three leak indicators front and center,
So that I can see which leak is closing.

## Acceptance Criteria

**AC1 — Three leak indicators surfaced**
**Given** logged inquiries, bookings, and completions
**When** the dashboard renders
**Then** it surfaces **inquiry → booking** conversion, **one-time → repeat** conversion, and the **count of regulars caught cold this week** (FR24, AR19), all derived on read.

**AC2 — Caught-cold is the FRESH-lapse count**
**Given** the caught-cold indicator
**When** computed
**Then** it counts gone-cold flags raised **within 7 days** of the missed expected-next-date this week (AR19) — a regular cold for months is a lapse (6.1) but is NOT "caught cold this week".

## Tasks / Subtasks

- [x] **Task 1 — Three pure derives** (AC1, AC2) — `lib/domain/derive.ts`
  - [x] `inquiryConversion(jobs, inquiries)` → bookings (consumesSlot, AD-2) ÷ distinctInquiryCount (AR12). Cumulative/all-time. `null` on zero inquiries.
  - [x] `oneTimeToRepeat(clients)` → one-time-cadence clients with ≥2 bookings ÷ one-time-cadence clients. `null` on zero one-time clients.
  - [x] `caughtColdThisWeek(clients, today)` → goneCold now AND expectedNextDate within the last 7 days.
- [x] **Task 2 — Dashboard action** (AC1) — `getLeakIndicators()` in `app/(operator)/actions.ts`; reads shared via request-scoped `cache()` with `getDashboardMetrics` (no extra round-trips).
- [x] **Task 3 — Surface** (AC1) — three tiles in a "Leak indicators" section, above the capacity table (`app/(operator)/page.tsx`). Rates render "—" on null (FR25). RSC, no client JS.
- [x] **Task 4 — Tests + gate** — `tests/derive.test.ts`: cancelled-not-a-booking, >100% uncapped, null denominators, caught-cold 7-day boundary. `vitest`/`tsc`/`next build` all green.

## Dev Notes

### Metric math (AR19), each reusing ONE canonical predicate

- **inquiry → booking** = bookings ÷ distinct inquiries. Numerator = jobs that consume a slot (`capacity.consumesSlot`, AD-2 — a `cancelled` booking was released, not "on the books"). Denominator = `distinctInquiryCount` (AR12/Story 4.4 — the seam that dedups a `link` auto-log and a manual log of the same contact). Cumulative (AR19: "ALL logged inquiries" — no rolling window).
- **one-time → repeat** = one-time-cadence clients with ≥2 bookings ÷ one-time-cadence clients. Denominator is the stored `cadence == 'one-time'` label (a public stranger is created one-time, Story 4.2). Numerator = ≥2 **bookings made** (`consumesSlot`).
- **caught cold (7d)** = clients gone-cold now (`goneCold`, Story 3.5) whose `expectedNextDate` is within `[today-7, today)`. The cold flag raises the day after expected; goneCold guarantees `expected < today`, so `expected >= today-7` captures a flag raised this week.

### Dev decisions (documented in derive.ts)

1. **inquiry rate is NOT capped at 100%** — a repeat client books again without filing a fresh inquiry, so lifetime bookings can honestly outrun lifetime inquiries. Capping would hide that the roster books beyond inbound demand.
2. **one-time "book" = a made booking (consuming job), not a completed one** — deliberately distinct from the 6.1 repeat COUNT (≥2 *completed*). 6.1 asks "did the work repeat?"; 6.2 asks "did the one-timer choose to come back?" — the choice (booking) is the conversion signal. Measures behavior (≥2 bookings) against the label (`one-time`), which IS the leak.
3. **null, never 0, on an empty denominator** (FR25) — "no inquiries / no one-time clients yet" ≠ "0% converted". Surface renders "—".

### Architecture guardrails

- **AD-7 / AD-13** — pure derives; the action is the only seam touching domain+db; the page imports only `./actions`; `dynamic = 'force-dynamic'` stays.
- **AR9** — every read owner-scoped; `getLeakIndicators` reuses the owner-scoped `listJobsForMetrics` / `listClients` / `listInquiries`.
- **Perf** — request-scoped `cache()` wrappers in `actions.ts` collapse the reads shared with `getDashboardMetrics` into one round-trip per render (continues the Epic-5 perf-debt discipline).

### Scope boundaries (held)

- 6.2 = the three RATES only. The **gone-cold list with win-back buttons** is Story 6.3. **CSV export** is Story 6.4. Not shipped here.
- "One-time → repeat conversion" (6.2, a rate) is a different number from the "repeat count" (6.1, an integer) and from the nudge-based `rebookingConversion` (FR13 nudge ratio) — not conflated.

## Dev Agent Record

### Agent Model Used
claude-opus-4-8[1m]

### Completion Notes List
- 3 pure derives (`inquiryConversion`, `oneTimeToRepeat`, `caughtColdThisWeek`) + `getLeakIndicators` action + 3-tile "Leak indicators" surface section.
- Refactored `getDashboardMetrics` onto shared request-scoped `cache()` readers + a `buildLifecycles` helper (removed duplicated per-client grouping).
- **Verification**: tsc clean, 334/334 tests (8 new for 6.2), `next build` green.

### File List
- `lib/domain/derive.ts` (inquiryConversion, oneTimeToRepeat, caughtColdThisWeek + types)
- `app/(operator)/actions.ts` (getLeakIndicators + LeakIndicators; cache() readers; buildLifecycles)
- `app/(operator)/page.tsx` (leak-indicators section + fmtRate)
- `tests/derive.test.ts` (8 new tests)

### Change Log
- 2026-07-18: Story 6.2 implemented, all gates green. Status → done.
